//! The host over stdio, for the session scenarios (`ui/core/testing/host.ts`).
//! Each stdin line is a request named after the app's Tauri command, with its
//! argument: `{"id": 7, "call": {"command": "apply_save", "args": {...}}}`,
//! `{"id": 8, "call_ordered": {...}}` or `{"id": 1, "connect": null}`. Each
//! stdout line is a reply, `{"id": 7, "ok": ...}` or `{"id": 7, "error": ...}`,
//! or a host message, `{"message": ...}`. A `call` runs concurrently with
//! later requests, so a message can come before the reply it follows, as
//! through the app's channel. The others run in the order they arrive. The
//! host logs to stderr and closes at the end of stdin.

use std::io::Write;
use std::process::ExitCode;

use ghostty_designer_host::Host;
use ghostty_designer_host::api::{Command, OrderedCommand};
use ghostty_designer_host::env::Env;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Deserialize)]
struct Request {
    id: u64,
    #[serde(flatten)]
    command: AppCommand,
}

/// The app's Tauri commands that reach the host.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum AppCommand {
    Connect,
    Call(Command),
    CallOrdered(OrderedCommand),
}

/// Writes one line. The stdout lock keeps concurrent lines whole.
fn send(line: Value) {
    drop(writeln!(std::io::stdout().lock(), "{line}"));
}

#[tokio::main]
async fn main() -> ExitCode {
    let started = match Env::from_process() {
        Ok(env) => Host::start(env, |line| eprintln!("stdio-host: {line}")).await,
        Err(error) => Err(error),
    };
    let host = match started {
        Ok(host) => host,
        Err(error) => {
            eprintln!("stdio-host: {error}");
            return ExitCode::FAILURE;
        }
    };

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("stdio-host: bad request {line}: {error}");
                return ExitCode::FAILURE;
            }
        };
        let id = request.id;
        match request.command {
            AppCommand::Connect => {
                let info = host.connect(Box::new(|message| send(json!({"message": message}))));
                send(json!({"id": id, "ok": info}));
            }
            AppCommand::CallOrdered(command) => {
                host.run_ordered(command);
                send(json!({"id": id, "ok": null}));
            }
            AppCommand::Call(command) => {
                let host = host.clone();
                tokio::spawn(async move {
                    send(match host.run(command).await {
                        Ok(ok) => json!({"id": id, "ok": ok}),
                        Err(error) => json!({"id": id, "error": error}),
                    });
                });
            }
        }
    }

    if let Err(error) = host.close().await {
        eprintln!("stdio-host: cannot clear the preview: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
