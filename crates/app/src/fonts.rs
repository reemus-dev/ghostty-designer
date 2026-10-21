//! `font://localhost/<id>`: font files for the panel's `FontFace`s.
//!
//! Any registered scheme counts as a local origin for IPC, so this serves font
//! bytes for ids from the latest font scan and nothing else.

use ghostty_designer_host::Host;
use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    // wry registers custom schemes as secure but not CORS-enabled, so the
    // page's fetch of a face is cross-origin.
    #[cfg(dev)]
    let origin = ctx
        .app_handle()
        .config()
        .build
        .dev_url
        .as_ref()
        .map_or_else(String::new, |url| url.origin().ascii_serialization());
    #[cfg(not(dev))]
    let origin = "tauri://localhost".to_owned();

    let fonts = ctx.app_handle().state::<Host>().fonts();
    let id = (request.method() == Method::GET)
        .then(|| request.uri().path().strip_prefix('/').map(str::to_owned))
        .flatten();
    tauri::async_runtime::spawn_blocking(move || {
        let response = match id.and_then(|id| fonts.face(&id)) {
            Some(face) => Response::builder()
                .header(header::CONTENT_TYPE, face.content_type)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(face.bytes),
            None => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Vec::new()),
        };
        // The headers are constant or come from the app's own URLs, so the
        // builder cannot fail.
        responder.respond(response.unwrap_or_default());
    });
}
