//! Ghostty Designer's native side, with no Tauri or GUI dependency.

pub mod api;
pub mod app_state;
mod config_file;
pub mod env;
mod fonts;
mod ghostty;
mod host;
mod preview;
pub mod sample;
mod save;
#[cfg(test)]
mod testkit;
mod themes;
mod watch;

pub use host::Host;
