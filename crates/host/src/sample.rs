//! The sample pages as a terminal prints them, in its own colours, plus rows
//! only a real terminal can show. The content is the `pages` section of
//! `sample.json`. The panel renders its `card` section, in the same format.

use std::fmt::Write;

use serde::Deserialize;

const WIDTH: usize = 80;
const LABEL_WIDTH: usize = 11;

/// A hue wheel at even lightness and chroma: OKLCH(0.72 0.16 h) for h in
/// 5.625° steps, clamped to sRGB.
const TRUECOLOR_RAMP: [[u8; 3]; 64] = [
    [242, 117, 160],
    [245, 117, 150],
    [247, 117, 139],
    [248, 117, 128],
    [249, 119, 117],
    [249, 120, 106],
    [248, 122, 94],
    [246, 125, 83],
    [244, 127, 70],
    [242, 131, 57],
    [238, 134, 43],
    [234, 138, 24],
    [229, 142, 0],
    [221, 147, 0],
    [214, 151, 0],
    [207, 155, 0],
    [200, 159, 0],
    [193, 163, 0],
    [185, 166, 0],
    [177, 170, 0],
    [167, 174, 0],
    [156, 177, 30],
    [145, 180, 47],
    [132, 183, 62],
    [118, 186, 75],
    [104, 188, 88],
    [87, 190, 100],
    [67, 192, 112],
    [39, 194, 124],
    [0, 194, 136],
    [0, 193, 148],
    [0, 192, 159],
    [0, 191, 168],
    [0, 190, 176],
    [0, 189, 183],
    [0, 188, 191],
    [0, 187, 198],
    [0, 185, 205],
    [0, 184, 212],
    [0, 183, 220],
    [0, 181, 228],
    [0, 179, 238],
    [0, 177, 248],
    [38, 174, 255],
    [71, 171, 255],
    [91, 168, 255],
    [106, 165, 255],
    [118, 161, 255],
    [130, 158, 255],
    [140, 155, 255],
    [150, 151, 255],
    [159, 147, 255],
    [169, 143, 255],
    [178, 140, 251],
    [186, 137, 245],
    [194, 134, 239],
    [202, 131, 233],
    [209, 128, 225],
    [215, 126, 217],
    [221, 123, 209],
    [227, 122, 200],
    [231, 120, 191],
    [236, 118, 181],
    [239, 117, 171],
];

#[derive(Deserialize)]
struct Content {
    pages: Vec<Page>,
}

#[derive(Deserialize)]
struct Page {
    name: String,
    lines: Vec<Vec<Segment>>,
}

#[derive(Deserialize)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "each flag is an independent SGR attribute in sample.json"
)]
struct Segment {
    text: String,
    fg: Option<Color>,
    bg: Option<Color>,
    #[serde(default)]
    bold: bool,
    #[serde(default)]
    dim: bool,
    #[serde(default)]
    italic: bool,
    #[serde(default)]
    underline: bool,
    #[serde(default)]
    inverse: bool,
}

/// A palette index, or the theme's `"fg"` or `"bg"`.
#[derive(Deserialize)]
#[serde(untagged)]
enum Color {
    Index(u8),
    Slot(serde::de::IgnoredAny),
}

/// An SGR escape, or nothing when `color` is off.
fn sgr(color: bool, codes: &str) -> String {
    if color {
        format!("\x1b[{codes}m")
    } else {
        String::new()
    }
}

/// "fg" and "bg" are the defaults a reset restores; SGR cannot name the other
/// channel's default.
fn color_codes(color: Option<&Color>, base: u8) -> Vec<String> {
    match color {
        Some(&Color::Index(i)) if i < 8 => vec![(base + i).to_string()],
        Some(&Color::Index(i)) if i < 16 => vec![(base + 60 + i - 8).to_string()],
        Some(&Color::Index(i)) => vec![(base + 8).to_string(), "5".into(), i.to_string()],
        _ => vec![],
    }
}

/// Selection and cursor colours belong to the terminal, so those cells print plain.
fn style_sgr(color: bool, segment: &Segment) -> String {
    let mut codes = vec!["0".to_string()];
    codes.extend(color_codes(segment.fg.as_ref(), 30));
    codes.extend(color_codes(segment.bg.as_ref(), 40));
    for (on, code) in [
        (segment.bold, "1"),
        (segment.dim, "2"),
        (segment.italic, "3"),
        (segment.underline, "4"),
        (segment.inverse, "7"),
    ] {
        if on {
            codes.push(code.into());
        }
    }
    sgr(color, &codes.join(";"))
}

/// A label followed by blanks: a swatch row, which is only colour.
fn is_swatch_row(line: &[Segment]) -> bool {
    line.len() > 1 && line[1..].iter().all(|s| s.text.bytes().all(|b| b == b' '))
}

fn render_line(color: bool, line: &[Segment]) -> String {
    let body: String = line.iter().map(|s| style_sgr(color, s) + &s.text).collect();
    body + &sgr(color, "0")
}

// ─── Terminal-only rows ───

fn label(color: bool, text: &str) -> String {
    format!(
        "{}{text:<LABEL_WIDTH$}{}",
        sgr(color, "0;90"),
        sgr(color, "0")
    )
}

/// Colon sub-parameters get their own sequence, because some parsers reject
/// them mixed with semicolons.
fn decorated(color: bool, text: &str, codes: &[&str]) -> String {
    let codes: String = codes.iter().map(|code| sgr(color, code)).collect();
    format!("{codes}{text}{}", sgr(color, "0"))
}

/// The 6×6×6 cube, one green level per row, and the truecolor ramp. They are
/// only colour, so they print only with colour on.
fn swatch_rows() -> Vec<String> {
    let mut rows: Vec<String> = (0..6u8)
        .map(|green| {
            let cells = (0..36u8).fold(String::new(), |mut cells, i| {
                let (red, blue) = (i / 6, i % 6);
                let _ = write!(cells, "\x1b[48;5;{}m ", 16 + 36 * red + 6 * green + blue);
                cells
            });
            let name = if green == 0 { "Full cube" } else { "" };
            label(true, name) + &cells + &sgr(true, "0")
        })
        .collect();
    let ramp = TRUECOLOR_RAMP
        .iter()
        .fold(String::new(), |mut ramp, [r, g, b]| {
            let _ = write!(ramp, "\x1b[48;2;{r};{g};{b}m ");
            ramp
        });
    rows.push(label(true, "Truecolor") + &ramp + &sgr(true, "0"));
    rows
}

fn terminal_rows(color: bool) -> Vec<String> {
    let decorations = label(color, "Decoration")
        + &[
            decorated(color, "strikethrough", &["9"]),
            decorated(color, "double", &["4:2"]),
            decorated(color, "curly", &["4:3", "58;5;1"]),
            decorated(color, "dotted", &["4:4"]),
            decorated(color, "dashed", &["4:5"]),
            decorated(color, "overline", &["53"]),
        ]
        .join(" ");
    let mut rows = vec![decorations];
    if color {
        rows.extend(swatch_rows());
    }

    // Every grid row is 40 cells ending in "|", so mis-sized glyphs push their
    // bar off the ruler.
    rows.push(label(color, "Grid") + &sgr(color, "90") + &"····|".repeat(8) + &sgr(color, "0"));
    rows.push(label(color, "") + &"i".repeat(39) + "|");
    rows.push(label(color, "") + &"W".repeat(39) + "|");
    rows.push(label(color, "") + &"M".repeat(39) + "|");
    rows.push(label(color, "Wide CJK") + "日本語のテキスト漢字한국어中文简体全角 |");
    rows.push(label(color, "Wide emoji") + "😀😎🚀🔥✅❌⭐🎉👍🏽👩‍💻🇯🇵🇺🇸❤️⚠️✨🌈🍕🐙🧪 |");
    rows.push(String::new());
    rows.push(
        sgr(color, "90")
            + "Select some text to see the selection colours. The cursor shows its style."
            + &sgr(color, "0"),
    );
    rows
}

// ─── Output ───

fn heading(color: bool, title: &str) -> String {
    let rule = "─".repeat(WIDTH - 1 - title.len() - 1);
    format!(
        "{}{title} {}{rule}{}",
        sgr(color, "0;1"),
        sgr(color, "0;90"),
        sgr(color, "0")
    )
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// Every page and the terminal-only rows, ending in a newline. With `color`
/// off the escapes, swatch rows and trailing blanks are dropped.
pub fn render(color: bool) -> String {
    let content: Content =
        serde_json::from_str(include_str!("sample.json")).expect("sample.json matches Content");
    let mut sections: Vec<Vec<String>> = content
        .pages
        .iter()
        .map(|page| {
            let mut lines = vec![heading(color, &capitalize(&page.name))];
            lines.extend(
                page.lines
                    .iter()
                    .filter(|line| color || !is_swatch_row(line))
                    .map(|line| render_line(color, line)),
            );
            lines
        })
        .collect();
    let mut terminal = vec![heading(color, "Terminal")];
    terminal.extend(terminal_rows(color));
    sections.push(terminal);
    let text = sections
        .iter()
        .map(|lines| lines.join("\n"))
        .collect::<Vec<_>>()
        .join("\n\n")
        + "\n";

    if color {
        // Restores the configured cursor style in case a program changed it.
        return format!("\x1b[0 q{text}");
    }
    text.split('\n')
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}
