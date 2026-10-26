//! A temporary `Env` and a fake Ghostty CLI for tests.
//!
//! The fake answers `+version` and `+list-fonts` with Ghostty 1.3.1's output
//! (`tests/fixtures/ghostty-1.3.1/`), `+show-config --default` with one
//! documented key, and accepts every config in `+validate-config`. Tests change how an action behaves at any
//! time with [`FakeGhostty::set`], for all later calls or for one call.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tempfile::TempDir;

use crate::env::Env;

const FIXTURES: [(&str, &str); 2] = [
    (
        "version.txt",
        include_str!("../tests/fixtures/ghostty-1.3.1/version.txt"),
    ),
    (
        "list-fonts.txt",
        include_str!("../tests/fixtures/ghostty-1.3.1/list-fonts.txt"),
    ),
];

const BASELINE: &str = include_str!("../tests/fixtures/ghostty-1.3.1/baseline.conf");

/// A fresh root: `home/`, `xdg/` with the baseline config and the preview
/// include, `state/` and `tmp/`. No target PIDs. Ghostty is the fake in
/// `ghostty/`. Dropping it deletes the root.
pub struct TestEnv {
    pub env: Env,
    /// Canonical, so it matches the paths file watchers report.
    pub root: PathBuf,
    pub ghostty: FakeGhostty,
    _dir: TempDir,
}

impl Default for TestEnv {
    fn default() -> TestEnv {
        let base = fs::canonicalize(std::env::temp_dir()).unwrap();
        let dir = tempfile::Builder::new()
            .prefix("gd-test-")
            .tempdir_in(base)
            .unwrap();
        let root = dir.path().to_owned();
        let home = root.join("home");
        let xdg = root.join("xdg");
        let config = xdg.join("ghostty/config");
        for dir in [
            &home,
            &xdg.join("ghostty"),
            &root.join("state"),
            &root.join("tmp"),
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(
            &config,
            format!("{BASELINE}config-file = ?ghostty-designer.conf\n"),
        )
        .unwrap();
        let ghostty = FakeGhostty::create(&root);

        let mut vars = vec![
            ("HOME".into(), home.clone().into()),
            ("CFFIXED_USER_HOME".into(), home.clone().into()),
            ("XDG_CONFIG_HOME".into(), xdg.into()),
            ("XDG_STATE_HOME".into(), root.join("state").into()),
            ("XDG_CACHE_HOME".into(), home.join(".cache").into()),
            ("GHOSTTY_DESIGNER_TARGET_PID".into(), "".into()),
            ("TMPDIR".into(), root.join("tmp").into()),
        ];
        if let Some(path) = std::env::var_os("PATH") {
            vars.push(("PATH".into(), path));
        }
        let mut env = Env::from_vars(vars, None).unwrap();
        env.ghostty_bin = Some(ghostty.bin());
        TestEnv {
            env,
            root,
            ghostty,
            _dir: dir,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Version,
    ValidateConfig,
}

impl Action {
    fn name(self) -> &'static str {
        match self {
            Action::Version => "version",
            Action::ValidateConfig => "validate-config",
        }
    }
}

/// How an action answers. The default answers at once with the canned output.
#[derive(Clone, Debug, Default)]
pub struct Behaviour {
    pub delay: Option<Delay>,
    /// Replaces the canned output.
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    /// `+validate-config` rejects each line setting one of these keys, as
    /// Ghostty rejects an invalid value: `<file>:<line>:<key>: invalid value
    /// "<value>"` on stdout, exit 1.
    pub reject: Vec<String>,
}

#[derive(Clone, Copy, Debug)]
pub enum Delay {
    For(Duration),
    /// Until the process is killed.
    Hang,
}

pub struct FakeGhostty {
    dir: PathBuf,
}

impl FakeGhostty {
    fn create(root: &Path) -> FakeGhostty {
        let dir = root.join("ghostty");
        fs::create_dir(&dir).unwrap();
        for (name, text) in FIXTURES {
            fs::write(dir.join(name), text).unwrap();
        }
        let bin = dir.join("ghostty");
        let quoted = dir.to_str().unwrap().replace('\'', r"'\''");
        fs::write(&bin, SCRIPT.replace("<dir>", &quoted)).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        FakeGhostty { dir }
    }

    pub fn bin(&self) -> PathBuf {
        self.dir.join("ghostty")
    }

    /// Sets how `action` answers from now on: every call, or with `call` only
    /// its nth call, counted from 1. Settings of one call override those of
    /// every call.
    pub fn set(&self, action: Action, call: Option<usize>, behaviour: Behaviour) {
        let scope = match call {
            Some(n) => format!("{}.{n}", action.name()),
            None => action.name().to_owned(),
        };
        let delay = behaviour.delay.map(|delay| match delay {
            Delay::For(duration) => duration.as_secs_f64().to_string(),
            Delay::Hang => "hang".to_owned(),
        });
        let reject = (!behaviour.reject.is_empty()).then(|| behaviour.reject.join("\n") + "\n");
        let settings = [
            ("delay", delay),
            ("stdout", behaviour.stdout),
            ("stderr", behaviour.stderr),
            ("reject", reject),
        ];
        for (name, value) in settings {
            let file = self.dir.join(format!("{scope}.{name}"));
            match value {
                Some(value) => fs::write(file, value).unwrap(),
                None => drop(fs::remove_file(file)),
            }
        }
    }

    /// The PIDs of the calls of `action` so far, in the order they started.
    pub fn calls(&self, action: Action) -> Vec<u32> {
        fs::read_to_string(self.dir.join(format!("{}.calls", action.name())))
            .unwrap_or_default()
            .lines()
            .map(|pid| pid.parse().unwrap())
            .collect()
    }
}

const SCRIPT: &str = r#"#!/bin/sh
# Fake Ghostty CLI, written by the host crate's testkit.
dir='<dir>'
case $1 in
+version | +show-config | +validate-config | +list-fonts) action=${1#+} ;;
*)
  echo "fake ghostty: unknown action $1" >&2
  exit 2
  ;;
esac

# Each call appends its PID, so its line number counts the call without a lock.
echo $$ >>"$dir/$action.calls"
n=$(grep -nx "$$" "$dir/$action.calls" | tail -n 1 | cut -d: -f1)
setting() {
  for f in "$dir/$action.$n.$1" "$dir/$action.$1"; do
    if [ -e "$f" ]; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

if f=$(setting delay); then
  delay=$(cat "$f")
  # exec, so that killing this process ends the wait.
  [ "$delay" = hang ] && exec sleep 2147483647
  sleep "$delay"
fi

code=0
if f=$(setting stdout); then
  cat "$f"
else
  case $action in
  show-config)
    case " $* " in
    *" --default "*) printf '# The font size in points.\nfont-size = 13\n' ;;
    *)
      echo "fake ghostty: +show-config answers only --default" >&2
      code=2
      ;;
    esac
    ;;
  validate-config)
    for arg; do
      case $arg in --config-file=*) file=${arg#--config-file=} ;; esac
    done
    if f=$(setting reject); then
      awk '
        NR == FNR { reject[$0] = 1; next }
        {
          key = $0; sub(/^[ \t]+/, "", key); sub(/[ \t]*=.*/, "", key)
          value = $0; sub(/^[^=]*=[ \t]*/, "", value)
        }
        key in reject { printf "%s:%d:%s: invalid value \"%s\"\n", FILENAME, FNR, key, value; bad = 1 }
        END { exit bad }
      ' "$f" "$file" || code=1
    fi
    ;;
  *) cat "$dir/$action.txt" ;;
  esac
fi
if f=$(setting stderr); then cat "$f" >&2; fi
exit "$code"
"#;

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::ghostty::{self, CliOutput};

    async fn call(t: &TestEnv, args: &[&str]) -> CliOutput {
        let timeout = Duration::from_secs(10);
        ghostty::run(&t.env, &t.ghostty.bin(), args, timeout)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn answers_each_action() {
        let t = TestEnv::default();
        let version = call(&t, &["+version"]).await;
        assert!(version.stdout.contains("  - version: 1.3.1\n"));

        let defaults = call(&t, &["+show-config", "--default", "--docs"]).await;
        assert!(defaults.stdout.contains("\nfont-size = 13\n"));

        let fonts = call(&t, &["+list-fonts"]).await;
        assert!(fonts.stdout.starts_with("Courier New\n  Courier New\n"));

        let valid = call(&t, &["+validate-config", "--config-file=/nonexistent"]).await;
        assert!(valid.status.success());
        assert_eq!((valid.stdout.as_str(), valid.stderr.as_str()), ("", ""));
        assert_eq!(t.ghostty.calls(Action::ValidateConfig).len(), 1);
    }

    #[tokio::test]
    async fn rejects_keys_as_ghostty_does() {
        let t = TestEnv::default();
        let file = t.root.join("tmp/check.conf");
        fs::write(&file, "font-family = Menlo\nfont-size = abc\n").unwrap();
        let arg = format!("--config-file={}", file.display());
        let behaviour = Behaviour {
            reject: vec!["font-size".into(), "background".into()],
            ..Behaviour::default()
        };
        t.ghostty.set(Action::ValidateConfig, None, behaviour);

        let rejected = call(&t, &["+validate-config", &arg]).await;
        assert_eq!(rejected.status.code(), Some(1));
        let error = format!("{}:2:font-size: invalid value \"abc\"\n", file.display());
        assert_eq!(rejected.stdout, error);

        fs::write(&file, "font-family = Menlo\n").unwrap();
        assert!(call(&t, &["+validate-config", &arg]).await.status.success());
    }

    #[tokio::test]
    async fn delays_and_answers_per_call() {
        let t = TestEnv::default();
        let delay = Duration::from_millis(300);
        let delayed = Behaviour {
            delay: Some(Delay::For(delay)),
            ..Behaviour::default()
        };
        t.ghostty.set(Action::Version, Some(2), delayed);
        let complaining = Behaviour {
            stderr: Some("boom".into()),
            ..Behaviour::default()
        };
        t.ghostty.set(Action::Version, Some(3), complaining);

        let start = Instant::now();
        assert_eq!(call(&t, &["+version"]).await.stderr, "");
        assert!(start.elapsed() < delay);
        let start = Instant::now();
        assert_eq!(call(&t, &["+version"]).await.stderr, "");
        assert!(start.elapsed() >= delay);
        assert_eq!(call(&t, &["+version"]).await.stderr, "boom");
        assert_eq!(t.ghostty.calls(Action::Version).len(), 3);
    }
}
