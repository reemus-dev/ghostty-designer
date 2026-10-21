//! Ghostty Designer's native side, with no Tauri or GUI dependency.

pub mod api;
mod config_file;
pub mod env;
mod fonts;
mod ghostty;
mod host;
mod preview;
mod save;
pub mod specimen;
#[cfg(test)]
mod testkit;
mod themes;
mod watch;

pub use host::Host;
