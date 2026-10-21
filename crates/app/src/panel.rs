//! The panel's commands, and the close guard that asks the panel before the
//! window closes with unsaved changes.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use ghostty_designer_host::Host;
use ghostty_designer_host::api::{
    Command, CommandResult, Error, HostInfo, HostMessage, OrderedCommand,
};
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

impl CloseGuard {
    /// Whether to keep the window open for a close request. With unsaved
    /// changes and a connected panel, it asks the panel instead, and closes
    /// the window when the panel does not acknowledge in time. A second
    /// request while one is unacknowledged closes.
    pub fn holds(self: &Arc<Self>, window: &Window, changes: usize) -> bool {
        if changes == 0 || self.confirmed.load(Ordering::SeqCst) {
            return false;
        }
        let Some(panel) = lock(&self.panel).clone() else {
            return false;
        };
        let prompt = {
            let mut asking = lock(&self.asking);
            if asking.take().is_some() {
                errln!("[close] the panel did not answer the last request");
                return false;
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
    host: State<'_, Host>,
    guard: State<'_, Arc<CloseGuard>>,
) -> Result<HostInfo, Error> {
    *lock(&guard.panel) = Some(events.clone());
    // A new page never saw an earlier page's prompt.
    lock(&guard.asking).take();
    let connected = host.connect(Box::new(move |message| drop(events.send(message))));
    crate::launch::report("ready");
    Ok(connected)
}

#[tauri::command]
pub async fn call(command: Command, host: State<'_, Host>) -> Result<CommandResult, Error> {
    logged(host.run(command).await)
}

/// Not async: Tauri runs a sync command as it arrives, so these keep the
/// panel's order. An async command runs in a spawned task.
#[tauri::command]
pub fn call_ordered(command: OrderedCommand, host: State<'_, Host>) {
    host.run_ordered(command);
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
