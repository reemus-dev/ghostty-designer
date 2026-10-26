use std::io::IsTerminal as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use clap::{Parser, Subcommand};
use ghostty_designer_host::env::{Config, Env};
use ghostty_designer_host::{app_state, specimen};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};

/// `println!` that ignores write errors, which would otherwise abort the
/// process: `ghostty-designer --help | head -1` closes stdout early.
macro_rules! outln {
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let _ = writeln!(std::io::stdout(), $($arg)*);
    }};
}

/// `eprintln!` that ignores write errors.
macro_rules! errln {
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let _ = writeln!(std::io::stderr(), $($arg)*);
    }};
}

mod fonts;
mod instance;
mod launch;
mod panel;

use panel::{ActiveHost, CloseGuard};

const LABEL: &str = "panel";

/// Design Ghostty's appearance in a window, with your Ghostty windows as the
/// live preview.
#[derive(Parser)]
#[command(name = "ghostty-designer", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Cmd>,
    /// Edit this config file instead of Ghostty's, such as another app's
    /// built on libghostty. Without it, the designer edits the config it last
    /// edited
    #[arg(long, value_name = "FILE")]
    config: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the specimen pages in terminal colours
    Specimen,
}

fn main() {
    launch::init();
    let cli = Cli::parse();
    if let Some(Cmd::Specimen) = cli.command {
        let force = std::env::var_os("FORCE_COLOR");
        let color = match force {
            Some(force) => force != "0" && force != "false",
            None => {
                std::io::stdout().is_terminal()
                    && std::env::var_os("NO_COLOR").is_none_or(|v| v.is_empty())
            }
        };
        let text = specimen::render(color);
        outln!("{}", text.strip_suffix('\n').unwrap_or(&text));
        return;
    }

    let mut env = Env::from_process().unwrap_or_else(|error| launch::fail(&error));
    let requested = cli.config.map(|path| {
        env.config_file(&path)
            .unwrap_or_else(|error| launch::fail(&error))
    });
    env.config = match &requested {
        Some(path) => Config::File {
            path: path.clone(),
            ghostty_base: app_state::ghostty_base(&env, path),
        },
        None => app_state::opened(&env),
    };
    let state = env.state_dir.clone();
    launch::use_state_dir(&state);
    if launch::should_detach() && !instance::running(&state) {
        launch::detach(&state);
    }
    let request = instance::Request {
        token: std::env::var("XDG_ACTIVATION_TOKEN").ok(),
        config: requested,
    };
    let owner = match instance::runtime_dir()
        .and_then(|runtime| instance::claim(&state, &runtime, &request))
    {
        Ok(instance::Claim::Owner(owner)) => owner,
        Ok(instance::Claim::Focused) => return launch::report("focused"),
        Err(error) => launch::fail(&error),
    };
    if request.config.is_some()
        && let Err(error) = app_state::remember(&env, &env.config)
    {
        errln!("ghostty-designer: {error}");
    }

    let host = Arc::new(
        tauri::async_runtime::block_on(ActiveHost::start(env))
            .unwrap_or_else(|error| launch::fail(&error)),
    );
    // From here on, every exit path ends in the shutdown sequence.
    let on_panic = Arc::clone(&host);
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        report(info);
        let _ = on_panic.get().clear_now();
    }));

    let frame_path = state.join("window-frame");
    let exit_frame_path = frame_path.clone();
    let guard = Arc::new(CloseGuard::default());
    let (on_window, guard_on_close) = (Arc::clone(&host), Arc::clone(&guard));
    let on_request = Arc::clone(&host);

    let builder = tauri::Builder::default()
        .manage(Arc::clone(&host))
        .manage(guard)
        .invoke_handler(tauri::generate_handler![
            panel::connect,
            panel::call,
            panel::call_ordered,
            panel::close_prompt_shown,
            panel::close_window,
            panel::can_stay_on_top,
            panel::config_choices,
            panel::switch_config,
            panel::forget_config,
            panel::take_switch_request,
        ])
        .register_asynchronous_uri_scheme_protocol("font", fonts::serve)
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                errln!("[close] close requested");
                save_frame(window, &frame_path);
                if guard_on_close.holds(window, on_window.get().changes()) {
                    api.prevent_close();
                }
            } else if let WindowEvent::ThemeChanged(_) = event {
                // The window follows the system's appearance.
                on_window.get().appearance_changed();
            }
        })
        .setup(move |app| {
            open_panel(app.handle(), &state)?;
            tauri::async_runtime::spawn(exit_on_signal(app.handle().clone()));
            let app = app.handle().clone();
            owner.serve(move |request| {
                raise_panel(&app, request.token);
                if let Some(path) = request.config {
                    on_request.request(path);
                }
            });
            Ok(())
        });
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    // A dead renderer reloads the page, which connects again.
    #[cfg(target_os = "macos")]
    let builder = builder.on_web_content_process_terminate(|webview| {
        errln!("[renderer] the web content process ended, reloading");
        let _ = webview.reload();
    });

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(mac::menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => request_close(app, "Quit menu item"),
            "close" => request_close(app, "Window → Close menu item"),
            _ => {}
        });

    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            shut_down(&host);
            launch::fail(&format!("could not open the window: {error}"))
        });
    app.run(move |app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Ready => {
            let app = app.clone();
            mac::on_quit_event(move || request_close(&app, "quit Apple Event"));
        }
        // A signal exits without closing the window.
        RunEvent::ExitRequested { .. } => {
            if let Some(window) = app.get_webview_window(LABEL) {
                save_frame(&window.as_ref().window(), &exit_frame_path);
            }
        }
        RunEvent::Exit => {
            errln!("[close] exit");
            shut_down(&host);
        }
        _ => {}
    });
}

/// The shutdown sequence, bounded so a hung write cannot keep the process
/// alive: `close`, else `clear_now`.
fn shut_down(host: &ActiveHost) {
    const CLOSE_WAIT: Duration = Duration::from_secs(3);
    let host = host.get();
    let closed = tauri::async_runtime::block_on(async {
        tokio::time::timeout(CLOSE_WAIT, host.close()).await
    });
    let cleared = match closed {
        Ok(closed) => closed,
        Err(_) => {
            errln!("[close] the host did not close within {CLOSE_WAIT:?}");
            host.clear_now()
        }
    };
    if let Err(error) = cleared {
        errln!("ghostty-designer: could not clear the preview: {error}");
    }
}

/// SIGINT, SIGTERM and SIGHUP exit through the shutdown sequence without the
/// close guard: a signal means the process must end.
async fn exit_on_signal(app: AppHandle) {
    use tokio::signal::unix::{SignalKind, signal};

    let (Ok(mut int), Ok(mut term), Ok(mut hup)) = (
        signal(SignalKind::interrupt()),
        signal(SignalKind::terminate()),
        signal(SignalKind::hangup()),
    ) else {
        errln!("ghostty-designer: cannot handle exit signals");
        return;
    };
    let name = tokio::select! {
        _ = int.recv() => "SIGINT",
        _ = term.recv() => "SIGTERM",
        _ = hup.recv() => "SIGHUP",
    };
    errln!("[close] {name}");
    app.exit(0);
}

fn open_panel(app: &AppHandle, state: &Path) -> tauri::Result<()> {
    #[cfg(dev)]
    let origin = app
        .config()
        .build
        .dev_url
        .clone()
        .expect("devUrl in tauri.conf.json");
    #[cfg(not(dev))]
    let origin: Url = "tauri://localhost".parse().expect("a valid URL");

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Ghostty Designer")
        // WebKitGTK only automates the shared context, which incognito replaces.
        .incognito(std::env::var("TAURI_WEBVIEW_AUTOMATION").as_deref() != Ok("true"))
        .data_directory(state.join("webview"))
        // Tauri's file drop handler takes every native drag, so the page would
        // see no dragover or drop events and colour swatches could not swap.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            let same_origin = url.scheme() == origin.scheme()
                && url.host_str() == origin.host_str()
                && url.port_or_known_default() == origin.port_or_known_default();
            if !same_origin {
                open_in_browser(url);
            }
            same_origin
        })
        .on_new_window(|url, _| {
            open_in_browser(&url);
            NewWindowResponse::Deny
        });
    // The panel draws its own toolbar under the traffic lights, centred in its
    // top 48px.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 26.0));

    // Beside Ghostty on a 1440pt-wide MacBook screen, the minimum width leaves
    // Ghostty 80 columns at font sizes up to 18pt. The minimum height
    // fits the colour editor and the whole rail, and a quarter of a 13"
    // screen. A saved frame smaller than the minimum grows to it.
    let builder = builder.min_inner_size(540.0, 400.0);
    let builder = match restore_frame(app, &state.join("window-frame")) {
        Some([x, y, width, height]) => builder.position(x, y).inner_size(width, height),
        None => builder.inner_size(1200.0, 800.0),
    };
    #[cfg_attr(
        not(any(target_os = "linux", all(target_os = "macos", feature = "webdriver"))),
        expect(unused_variables, reason = "no webview setup on this build")
    )]
    let window = builder.build()?;
    // WebKit stops rendering a window it sees as covered, so the panel's
    // animations never end and a closing popup blocks input. Agents drive the
    // window in the background, so it keeps rendering.
    #[cfg(all(target_os = "macos", feature = "webdriver"))]
    window.with_webview(|webview| {
        // SAFETY: on macOS, `inner` is the window's live WKWebView.
        let view = unsafe { &*webview.inner().cast::<objc2::runtime::AnyObject>() };
        // SAFETY: WKWebView has this WebKit SPI, and it takes a BOOL.
        let () = unsafe { objc2::msg_send![view, _setWindowOcclusionDetectionEnabled: false] };
    })?;
    // A dead renderer reloads the page, which connects again.
    #[cfg(target_os = "linux")]
    window.with_webview(|webview| {
        use webkit2gtk::WebViewExt;
        webview
            .inner()
            .connect_web_process_terminated(|view, reason| {
                errln!("[renderer] the web process ended ({reason:?}), reloading");
                view.reload();
            });
    })?;
    Ok(())
}

/// Opens http(s) URLs in the default browser. Other schemes are dropped.
fn open_in_browser(url: &Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    match Command::new(opener).arg(url.as_str()).spawn() {
        Ok(mut child) => drop(std::thread::spawn(move || child.wait())),
        Err(error) => errln!("could not open {url}: {error}"),
    }
}

/// Brings the panel to the front for a later launch, and returns once done.
fn raise_panel(app: &AppHandle, token: Option<String>) {
    let (done, raised) = mpsc::channel();
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(LABEL) {
            let _ = window.unminimize();
            let _ = window.show();
            // tao's `set_focus` skips a window it still thinks is minimized,
            // and only the activation token lets Wayland raise it.
            #[cfg(target_os = "linux")]
            if let Ok(gtk_window) = window.gtk_window() {
                use gtk::prelude::GtkWindowExt;
                if let Some(token) = token {
                    gtk_window.set_startup_id(&token);
                }
                gtk_window.present();
            }
            // Also activates the app.
            #[cfg(target_os = "macos")]
            let _ = (token, window.set_focus());
        }
        let _ = done.send(());
    });
    if queued.is_ok() {
        let _ = raised.recv();
    }
}

/// Closes the panel the way its close button does, so every path meets the same checks.
#[cfg(target_os = "macos")]
fn request_close(app: &AppHandle, source: &str) {
    errln!("[close] {source}");
    match app.get_webview_window(LABEL) {
        Some(window) => drop(window.close()),
        None => app.exit(0),
    }
}

// The frame is "x y width height": the outer position and inner size in
// logical pixels, which match what the window builder takes. It lives in the
// state folder rather than `tauri-plugin-window-state`'s app config folder, so
// a sandbox keeps its own and nothing is written to `~/Library`.

fn save_frame(window: &Window, path: &Path) {
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    let (Ok(scale), Ok(position), Ok(size)) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
    ) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let _ = std::fs::write(
        path,
        format!(
            "{} {} {} {}\n",
            position.x, position.y, size.width, size.height
        ),
    );
}

/// The saved frame, if it still fits within a connected monitor.
fn restore_frame(app: &AppHandle, path: &Path) -> Option<[f64; 4]> {
    let text = std::fs::read_to_string(path).ok()?;
    let values: Vec<f64> = text
        .split_whitespace()
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let [x, y, width, height] = <[f64; 4]>::try_from(values).ok()?;
    let fits = app.available_monitors().ok()?.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        x >= origin.x
            && y >= origin.y
            && x + width <= origin.x + size.width
            && y + height <= origin.y + size.height
    });
    (fits && width > 0.0 && height > 0.0).then_some([x, y, width, height])
}

#[cfg(target_os = "macos")]
mod mac {
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::NSObject;
    use objc2::{ClassType, define_class, msg_send, sel};
    use objc2_foundation::{NSAppleEventDescriptor, NSAppleEventManager};
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::{AppHandle, Wry};

    /// The app, Edit and Window menus. Edit makes the standard shortcuts work
    /// in text fields.
    pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
        // [UNTIL] tauri#9198 https://github.com/tauri-apps/tauri/issues/9198
        // Tauri exits on `terminate:` without asking, so Quit closes the
        // window instead.
        let quit = MenuItem::with_id(
            app,
            "quit",
            "Quit Ghostty Designer",
            true,
            Some("CmdOrCtrl+Q"),
        )?;
        let close = MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?;
        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    "Ghostty Designer",
                    true,
                    &[
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &quit,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None)?,
                        &PredefinedMenuItem::maximize(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &close,
                    ],
                )?,
            ],
        )
    }

    static ON_QUIT: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "GhosttyDesignerQuitHandler"]
        struct QuitHandler;

        impl QuitHandler {
            #[unsafe(method(handleQuit:withReplyEvent:))]
            fn handle_quit(&self, _event: &NSAppleEventDescriptor, _reply: &NSAppleEventDescriptor) {
                if let Some(on_quit) = ON_QUIT.get() {
                    on_quit();
                }
            }
        }
    );

    /// Runs `on_quit` for the quit Apple Event (Dock → Quit, logout) instead
    /// of AppKit's handler, which exits at once. Call it after launch, when
    /// AppKit has installed its own.
    // [UNTIL] tauri#9198 https://github.com/tauri-apps/tauri/issues/9198
    pub fn on_quit_event(on_quit: impl Fn() + Send + Sync + 'static) {
        let _ = ON_QUIT.set(Box::new(on_quit));
        // SAFETY: `new` takes no arguments and returns a retained instance.
        let handler: Retained<QuitHandler> = unsafe { msg_send![QuitHandler::class(), new] };
        let manager = NSAppleEventManager::sharedAppleEventManager();
        // SAFETY: the arguments have the types setEventHandler:andSelector:
        // forEventClass:andEventID: takes, and the selector names a method of
        // `handler` with the signature the event manager calls.
        unsafe {
            let () = msg_send![
                &*manager,
                setEventHandler: &*handler,
                andSelector: sel!(handleQuit:withReplyEvent:),
                forEventClass: u32::from_be_bytes(*b"aevt"),
                andEventID: u32::from_be_bytes(*b"quit")
            ];
        }
        // The event manager does not retain its handlers.
        std::mem::forget(handler);
    }
}
