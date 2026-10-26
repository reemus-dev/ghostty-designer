//! The panel's commands, the host they reach, which a config switch
//! replaces, and the close guard that asks the panel before the window closes
//! with unsaved changes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use ghostty_designer_host::api::{
    Command, CommandResult, ConfigChoice, Error, HostInfo, HostMessage, OrderedCommand,
};
use ghostty_designer_host::env::{Config, Env};
use ghostty_designer_host::{Host, app_state};
use tauri::ipc::Channel;
use tauri::{State, Window};

/// How long the panel has to acknowledge a close prompt. A crashed or hung
/// page must never trap the window.
const PROMPT_WAIT: Duration = Duration::from_secs(2);

/// Decides close requests on the main thread, from the change count the
/// panel last reported.
#[derive(Default)]
pub struct CloseGuard {
    /// The connected panel's channel.
    panel: Mutex<Option<Channel<HostMessage>>>,
    /// The close prompt sent and not yet acknowledged, by number.
    asking: Mutex<Option<u64>>,
    prompts: AtomicU64,
    /// Set once the window may close without asking.
    confirmed: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The host for the config the panel edits.
pub struct ActiveHost {
    host: Mutex<Host>,
    /// Switches and forgetting recent files, which both write `app.json`, run
    /// one at a time.
    switching: tokio::sync::Mutex<()>,
    /// The config file a later launch asked for, until the panel takes it.
    requested: Mutex<Option<PathBuf>>,
}

/// What the host reports that the user cannot act on in the panel.
fn log(line: &str) {
    errln!("ghostty-designer: {line}");
}

impl ActiveHost {
    pub async fn start(env: Env) -> Result<ActiveHost, String> {
        Ok(ActiveHost {
            host: Mutex::new(Host::start(env, log).await?),
            switching: tokio::sync::Mutex::default(),
            requested: Mutex::default(),
        })
    }

    pub fn get(&self) -> Host {
        lock(&self.host).clone()
    }

    /// Closes the host, which clears its preview, then starts one for
    /// `config`. When either fails, it starts one for the old config again,
    /// which recovers a preview the close left. Either way the panel must
    /// connect again.
    async fn switch(&self, config: Config) -> Result<(), Error> {
        let _one = self.switching.lock().await;
        let old = self.get();
        let mut env = old.env().clone();
        let previous = std::mem::replace(&mut env.config, config);
        let started = match old.close().await {
            Ok(()) => Host::start(env.clone(), log).await,
            Err(error) => Err(format!("Could not clear the preview: {error}")),
        };
        let (host, result) = match started {
            Ok(host) => (host, Ok(())),
            Err(error) => {
                env.config = previous;
                // It started with this config before, so only a broken Ghostty fails here.
                let host = Host::start(env.clone(), log)
                    .await
                    .unwrap_or_else(|error| crate::launch::fail(&error));
                (host, Err(Error::Internal(error)))
            }
        };
        *lock(&self.host) = host;
        if let Err(error) = app_state::remember(&env, &env.config) {
            log(&error);
        }
        result
    }

    /// Keeps the config file a later launch asked for, and tells the panel.
    pub fn request(&self, path: PathBuf) {
        *lock(&self.requested) = Some(path);
        self.get().switch_requested();
    }

    /// Takes `path` off the recent files.
    async fn forget(&self, path: &Path) {
        let _one = self.switching.lock().await;
        if let Err(error) = app_state::forget(self.get().env(), path) {
            log(&error);
        }
    }
}

impl CloseGuard {
    /// Whether to keep the window open for a close request. With unsaved
    /// changes and a connected panel, it asks the panel instead, and closes
    /// the window when the panel does not acknowledge in time. A request
    /// while one is unacknowledged waits on that one.
    pub fn holds(self: &Arc<Self>, window: &Window, changes: usize) -> bool {
        if changes == 0 || self.confirmed.load(Ordering::SeqCst) {
            return false;
        }
        let Some(panel) = lock(&self.panel).clone() else {
            return false;
        };
        let prompt = {
            let mut asking = lock(&self.asking);
            if asking.is_some() {
                return true;
            }
            let prompt = self.prompts.fetch_add(1, Ordering::SeqCst);
            *asking = Some(prompt);
            prompt
        };
        if panel.send(HostMessage::CloseRequested).is_err() {
            lock(&self.asking).take();
            return false;
        }
        errln!("[close] asking the panel");
        let (guard, window) = (Arc::clone(self), window.clone());
        thread::spawn(move || {
            thread::sleep(PROMPT_WAIT);
            if lock(&guard.asking)
                .take_if(|asked| *asked == prompt)
                .is_some()
            {
                errln!("[close] the panel did not answer within {PROMPT_WAIT:?}");
                guard.confirmed.store(true, Ordering::SeqCst);
                let _ = window.close();
            }
        });
        true
    }
}

/// Logs failed operations. Refused requests are the panel's to show.
fn logged<T>(result: Result<T, Error>) -> Result<T, Error> {
    if let Err(Error::Internal(message)) = &result {
        errln!("ghostty-designer: {message}");
    }
    result
}

#[tauri::command]
pub async fn connect(
    events: Channel<HostMessage>,
    host: State<'_, Arc<ActiveHost>>,
    guard: State<'_, Arc<CloseGuard>>,
) -> Result<HostInfo, Error> {
    *lock(&guard.panel) = Some(events.clone());
    // A new page never saw an earlier page's prompt.
    lock(&guard.asking).take();
    let connected = host
        .get()
        .connect(Box::new(move |message| drop(events.send(message))));
    Ok(connected)
}

/// Reports the launch once the panel has drawn its session, or the error that
/// stopped the session from starting.
#[tauri::command]
pub fn report_start(error: Option<String>) {
    match error {
        None => crate::launch::report("ready"),
        Some(error) => {
            errln!("ghostty-designer: {error}");
            crate::launch::report(&format!("error {error}"));
        }
    }
}

#[tauri::command]
pub async fn call(
    command: Command,
    host: State<'_, Arc<ActiveHost>>,
) -> Result<CommandResult, Error> {
    logged(host.get().run(command).await)
}

/// Not async: Tauri runs a sync command as it arrives, so these keep the
/// panel's order. An async command runs in a spawned task.
#[tauri::command]
pub fn call_ordered(command: OrderedCommand, host: State<'_, Arc<ActiveHost>>) {
    host.get().run_ordered(command);
}

#[tauri::command]
pub fn config_choices(host: State<'_, Arc<ActiveHost>>) -> Vec<ConfigChoice> {
    host.get().config_choices()
}

/// Edits Ghostty's config without `path`, else the file at `path`, with
/// Ghostty's config as its base as `ghostty_base` says, else as last chosen.
/// The panel loads again once it resolves, or fails with an internal error:
/// a refused path changes nothing.
#[tauri::command]
pub async fn switch_config(
    path: Option<PathBuf>,
    ghostty_base: Option<bool>,
    host: State<'_, Arc<ActiveHost>>,
) -> Result<(), Error> {
    let config = match path {
        None => Config::Ghostty,
        Some(path) => {
            let current = host.get();
            let env = current.env();
            let path = env.config_file(&path).map_err(Error::Input)?;
            Config::File {
                ghostty_base: ghostty_base.unwrap_or_else(|| app_state::ghostty_base(env, &path)),
                path,
            }
        }
    };
    errln!("[config] switching to {config:?}");
    logged(host.switch(config).await)
}

/// The config file a later launch asked for, once.
#[tauri::command]
pub fn take_switch_request(host: State<'_, Arc<ActiveHost>>) -> Option<PathBuf> {
    lock(&host.requested).take()
}

#[tauri::command]
pub async fn forget_config(path: PathBuf, host: State<'_, Arc<ActiveHost>>) -> Result<(), Error> {
    host.forget(&path).await;
    Ok(())
}

/// The panel shows the close prompt, so the window stays open.
#[tauri::command]
pub fn close_prompt_shown(guard: State<'_, Arc<CloseGuard>>) {
    lock(&guard.asking).take();
}

/// The user chose to discard the changes.
#[tauri::command]
pub fn close_window(window: Window, guard: State<'_, Arc<CloseGuard>>) -> Result<(), Error> {
    errln!("[close] discard and close");
    guard.confirmed.store(true, Ordering::SeqCst);
    logged(
        window
            .close()
            .map_err(|error| Error::Internal(error.to_string())),
    )
}

/// Whether the window can stay above other windows. GTK 3 ignores the request
/// on Wayland. Not async, so GTK runs on the main thread.
#[tauri::command]
pub fn can_stay_on_top() -> bool {
    #[cfg(target_os = "linux")]
    let supported = {
        use gtk::prelude::ObjectExt;
        gtk::gdk::Display::default()
            .is_none_or(|display| display.type_().name() != "GdkWaylandDisplay")
    };
    #[cfg(not(target_os = "linux"))]
    let supported = true;
    supported
}
