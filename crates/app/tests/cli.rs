use std::process::Command;

fn text(bytes: &[u8]) -> &str {
    std::str::from_utf8(bytes).expect("the CLI prints UTF-8")
}

#[test]
fn prints_the_demo_in_colour_only_when_forced() {
    let demo = |force: Option<&str>| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_ghostty-designer"));
        command
            .arg("demo")
            .env_remove("FORCE_COLOR")
            .env_remove("NO_COLOR");
        if let Some(force) = force {
            command.env("FORCE_COLOR", force);
        }
        let output = command.output().unwrap();
        assert_eq!(text(&output.stderr), "");
        assert_eq!(output.status.code(), Some(0));
        String::from_utf8(output.stdout).unwrap()
    };

    let plain = demo(None);
    assert_ne!(plain.trim(), "");
    assert!(!plain.contains('\x1b'), "{plain}");
    assert_eq!(demo(Some("0")), plain);
    assert!(demo(Some("1")).contains("\x1b["));
}
