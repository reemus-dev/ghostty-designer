//! Installed fonts: the background scan and the face files it found.
//!
//! Ghostty's `+list-fonts` names the families it can use. The platform's font
//! catalog (CoreText or fontconfig) maps each to its faces' files, and each
//! file is read for the family's features, variable axes and Nerd glyphs.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::SystemTime;

use indexmap::IndexMap;
use skrifa::raw::tables::layout::{FeatureList, ScriptList};
use skrifa::raw::{FileRef, FontRef, ReadError, TableProvider};
use skrifa::{MetadataProvider, string::StringId};
use tokio::sync::Notify;

use crate::api::{FontAxis, FontFace, FontFamily};
use crate::env::Env;
use crate::ghostty::Ghostty;

/// Powerline separator and Font Awesome home, present in every Nerd Font.
const NERD_CODEPOINTS: [u32; 2] = [0xe0b0, 0xf015];

/// The face files of the latest scan, by id: the only files ever served.
#[derive(Clone, Default)]
pub struct FontIndex(Arc<RwLock<HashMap<String, FaceFile>>>);

#[derive(Clone)]
struct FaceFile {
    path: PathBuf,
    /// The face's index in a collection.
    index: u32,
    /// The file as the scan read it.
    stamp: Stamp,
}

/// A regular file's size and modification time.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
}

impl Stamp {
    /// None for anything but a regular file, so a FIFO or device never
    /// blocks a read.
    fn of(path: &Path) -> Option<Stamp> {
        let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file)?;
        Some(Stamp {
            len: meta.len(),
            modified: meta.modified().ok(),
        })
    }
}

/// One face as a standalone font file.
pub struct FontData {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

impl FontIndex {
    /// A face of the latest scan, split out of its collection. None for an
    /// unknown id, or a file that changed since the scan or is not a font,
    /// so a path swapped after the scan serves nothing.
    pub fn face(&self, id: &str) -> Option<FontData> {
        let file = self
            .0
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
            .cloned()?;
        if Stamp::of(&file.path) != Some(file.stamp) {
            return None;
        }
        let bytes = fs::read(&file.path).ok()?;
        if bytes.len() as u64 != file.stamp.len || FileRef::new(&bytes).is_err() {
            return None;
        }
        let bytes = if bytes.starts_with(b"ttcf") {
            extract_face(&bytes, file.index)?
        } else {
            bytes
        };
        let content_type = if bytes.starts_with(b"OTTO") {
            "font/otf"
        } else {
            "font/ttf"
        };
        Some(FontData {
            bytes,
            content_type,
        })
    }

    fn replace(&self, files: HashMap<String, FaceFile>) {
        *self.0.write().unwrap_or_else(PoisonError::into_inner) = files;
    }
}

// ─── Scan ───

/// The background font scan. Dropping it stops scanning.
pub struct FontScan {
    index: FontIndex,
    /// Requests for a scan. All requests made before a scan starts share it.
    requests: Arc<Notify>,
    task: tokio::task::AbortHandle,
}

impl FontScan {
    /// Starts the first scan at once, on the current tokio runtime. `on_scan`
    /// receives each scan's families, or why it failed, in which case the
    /// previous families and faces stay current. It runs on a runtime
    /// worker, so it must not block.
    pub fn start(
        env: Env,
        ghostty: Ghostty,
        mut on_scan: impl FnMut(Result<Vec<FontFamily>, String>) + Send + 'static,
    ) -> FontScan {
        let index = FontIndex::default();
        let requests = Arc::new(Notify::new());
        requests.notify_one();
        let task = tokio::spawn({
            let (index, requests) = (index.clone(), Arc::clone(&requests));
            async move {
                loop {
                    requests.notified().await;
                    on_scan(scan(&env, &ghostty).await.map(|scan| {
                        index.replace(scan.files);
                        scan.families
                    }));
                }
            }
        });
        FontScan {
            index,
            requests,
            task: task.abort_handle(),
        }
    }

    /// Scans again after the running scan, once however often it is asked.
    pub fn rescan(&self) {
        self.requests.notify_one();
    }

    pub fn index(&self) -> FontIndex {
        self.index.clone()
    }
}

impl Drop for FontScan {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct Scan {
    families: Vec<FontFamily>,
    files: HashMap<String, FaceFile>,
}

async fn scan(env: &Env, ghostty: &Ghostty) -> Result<Scan, String> {
    let listed = ghostty
        .run(env, ["+list-fonts"])
        .await
        .map_err(|error| format!("cannot list fonts: {error}"))?;
    if !listed.status.success() {
        return Err(format!("cannot list fonts: {}", listed.stderr.trim()));
    }
    let names = parse_families(&listed.stdout);
    let faces = platform_faces(env, &names).await?;

    tokio::task::spawn_blocking(move || {
        let mut by_family: HashMap<String, Vec<ScannedFace>> = HashMap::new();
        for face in faces {
            by_family.entry(face.family.clone()).or_default().push(face);
        }
        let mut files = HashMap::new();
        let families: Vec<FontFamily> = names
            .iter()
            .filter_map(|name| describe_family(name, by_family.get(name)?, &mut files))
            .collect();
        Scan { families, files }
    })
    .await
    .map_err(|error| format!("font scan stopped: {error}"))
}

/// `+list-fonts` prints each family unindented, then its faces indented.
fn parse_families(output: &str) -> Vec<String> {
    output
        .split('\n')
        .filter(|line| !line.is_empty() && !line.starts_with(' '))
        .map(String::from)
        .collect()
}

/// A face found by the platform scan.
struct ScannedFace {
    family: String,
    style: String,
    path: PathBuf,
    /// Collection face index, when the scan reports it (fontconfig).
    index: Option<u32>,
    /// Identifies the face inside a collection (CoreText).
    postscript: Option<String>,
}

/// Reads a family's faces into `files`, the first readable one per style.
/// None when no face is readable.
fn describe_family(
    name: &str,
    scanned: &[ScannedFace],
    files: &mut HashMap<String, FaceFile>,
) -> Option<FontFamily> {
    // Faces of one family share files (collections, variable instances), so
    // read each file once. Scoped per family to bound memory.
    let mut opened: HashMap<&Path, Option<OpenedFile>> = HashMap::new();
    let mut faces: Vec<FontFace> = Vec::new();
    let mut features = BTreeSet::new();
    let mut axes: IndexMap<String, FontAxis> = IndexMap::new();
    let mut nerd = false;

    for face in scanned {
        // CoreText lists some faces twice, and fontconfig lists one style
        // from several files, such as Type 1 and OpenType copies.
        if faces.iter().any(|known| known.style == face.style) {
            continue;
        }
        let Some(file) = opened
            .entry(&face.path)
            .or_insert_with(|| open_file(&face.path))
        else {
            continue;
        };
        let Some((font, index)) = resolve_face(&file.data, face) else {
            continue;
        };

        let id = face_id(&face.path, index, &face.style, file.stamp);
        files.insert(
            id.clone(),
            FaceFile {
                path: face.path.clone(),
                index,
                stamp: file.stamp,
            },
        );
        faces.push(FontFace {
            style: face.style.clone(),
            id,
        });

        features.extend(available_features(&font));
        for axis in variation_axes(&font) {
            axes.entry(axis.tag.clone()).or_insert(axis);
        }
        nerd = nerd || has_nerd_glyphs(&font);
    }

    if faces.is_empty() {
        return None;
    }
    Some(FontFamily {
        family: name.to_owned(),
        faces,
        nerd,
        // Byte order.
        features: features.into_iter().collect(),
        axes: axes.into_values().collect(),
    })
}

struct OpenedFile {
    data: Vec<u8>,
    stamp: Stamp,
}

fn open_file(path: &Path) -> Option<OpenedFile> {
    let stamp = Stamp::of(path)?;
    Some(OpenedFile {
        data: fs::read(path).ok()?,
        stamp,
    })
}

fn resolve_face<'a>(data: &'a [u8], face: &ScannedFace) -> Option<(FontRef<'a>, u32)> {
    match FileRef::new(data).ok()? {
        FileRef::Font(font) => Some((font, 0)),
        FileRef::Collection(collection) => {
            let index = match face.index {
                Some(index) => index,
                None => {
                    let postscript = face.postscript.as_deref()?;
                    (0..collection.len()).find(|&index| {
                        collection
                            .get(index)
                            .is_ok_and(|font| postscript_name(&font).as_deref() == Some(postscript))
                    })?
                }
            };
            Some((collection.get(index).ok()?, index))
        }
    }
}

fn postscript_name(font: &FontRef<'_>) -> Option<String> {
    let name = font
        .localized_strings(StringId::POSTSCRIPT_NAME)
        .english_or_first()?;
    Some(name.chars().collect())
}

fn face_id(path: &Path, index: u32, style: &str, stamp: Stamp) -> String {
    let mut hasher = DefaultHasher::new();
    (path, index, style, stamp).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ─── Font tables ───

fn tag_text(tag: skrifa::Tag) -> String {
    String::from_utf8_lossy(&tag.to_be_bytes()).into_owned()
}

/// The features a font offers: AAT `morx` features mapped to OpenType tags
/// when the font has `morx`, otherwise the GSUB and GPOS features of the
/// default script, or else Latin. The legacy `kern` table is not read.
fn available_features(font: &FontRef<'_>) -> Vec<String> {
    let mut tags = Vec::new();
    if let Ok(morx) = font.morx() {
        for chain in morx.chains().iter().flatten() {
            tags.extend(chain.features().iter().filter_map(|feature| {
                aat_feature(feature.feature_type(), feature.feature_settings())
            }));
        }
        return tags;
    }
    if let Ok(gsub) = font.gsub() {
        default_script_features(gsub.script_list(), gsub.feature_list(), &mut tags);
    }
    if let Ok(gpos) = font.gpos() {
        default_script_features(gpos.script_list(), gpos.feature_list(), &mut tags);
    }
    tags
}

/// The default language's features of the first of DFLT, dflt and latn.
fn default_script_features(
    scripts: Result<ScriptList<'_>, ReadError>,
    features: Result<FeatureList<'_>, ReadError>,
    tags: &mut Vec<String>,
) {
    let (Ok(scripts), Ok(features)) = (scripts, features) else {
        return;
    };
    let script_records = scripts.script_records();
    let script = [b"DFLT", b"dflt", b"latn"].iter().find_map(|tag| {
        script_records
            .iter()
            .find(|record| record.script_tag().to_be_bytes() == **tag)
    });
    let Some(Ok(script)) = script.map(|record| record.script(scripts.offset_data())) else {
        return;
    };
    let Some(Ok(language)) = script.default_lang_sys() else {
        return;
    };
    let feature_records = features.feature_records();
    for index in language.feature_indices() {
        if let Some(record) = feature_records.get(usize::from(index.get())) {
            tags.push(tag_text(record.feature_tag()));
        }
    }
}

/// The OpenType tag of an AAT feature setting. Where several tags map to
/// one setting, the last of them names it.
fn aat_feature(kind: u16, setting: u16) -> Option<String> {
    const CHARACTER_ALTERNATIVES: u16 = 17;
    const STYLISTIC_ALTERNATIVES: u16 = 35;
    const MAPPED: [(u16, u16, &str); 53] = [
        (1, 0, "rlig"),
        (1, 2, "liga"),
        (1, 4, "dlig"),
        (1, 18, "clig"),
        (1, 20, "hist"),
        (2, 2, "curs"),
        (4, 0, "vert"),
        (6, 0, "tnum"),
        (6, 1, "pnum"),
        (8, 0, "init"),
        (8, 2, "fina"),
        (8, 8, "med2"),
        (10, 1, "sups"),
        (10, 2, "subs"),
        (10, 3, "ordn"),
        (11, 1, "afrc"),
        (11, 2, "numr"),
        (14, 4, "zero"),
        (15, 10, "mgrk"),
        (19, 4, "titl"),
        (20, 0, "trad"),
        (20, 1, "smpl"),
        (20, 2, "jp78"),
        (20, 3, "jp83"),
        (20, 4, "jp90"),
        (20, 10, "expt"),
        (20, 11, "jp04"),
        (20, 12, "hojo"),
        (20, 13, "nlck"),
        (20, 14, "tnam"),
        (21, 0, "onum"),
        (21, 1, "lnum"),
        (22, 0, "fwid"),
        (22, 2, "hwid"),
        (22, 3, "twid"),
        (22, 4, "qwid"),
        (22, 5, "palt"),
        (22, 6, "halt"),
        (25, 1, "pkna"),
        (27, 0, "ccmp"),
        (28, 2, "ruby"),
        (31, 0, "valt"),
        (32, 2, "ital"),
        (33, 0, "case"),
        (34, 0, "hkna"),
        (34, 2, "vkna"),
        (36, 0, "calt"),
        (36, 2, "swsh"),
        (36, 4, "cswh"),
        (37, 1, "smcp"),
        (37, 2, "pcap"),
        (38, 1, "c2sc"),
        (38, 2, "c2pc"),
    ];
    match (kind, setting) {
        (CHARACTER_ALTERNATIVES, 1..=99) => Some(format!("cv{setting:02}")),
        (STYLISTIC_ALTERNATIVES, 2..=40) if setting.is_multiple_of(2) => {
            Some(format!("ss{:02}", setting / 2))
        }
        _ => MAPPED
            .iter()
            .find(|&&(k, s, _)| k == kind && s == setting)
            .map(|&(_, _, tag)| tag.to_owned()),
    }
}

/// fvar axes in font order, named in English.
fn variation_axes(font: &FontRef<'_>) -> Vec<FontAxis> {
    let Ok(axes) = font.fvar().and_then(|fvar| fvar.axes()) else {
        return Vec::new();
    };
    axes.iter()
        .map(|axis| {
            let tag = tag_text(axis.axis_tag()).trim().to_owned();
            let name = font
                .localized_strings(axis.axis_name_id())
                .english_or_first()
                .map_or_else(|| tag.clone(), |name| name.chars().collect());
            FontAxis {
                tag,
                name,
                min: axis.min_value().to_f64(),
                max: axis.max_value().to_f64(),
                default: axis.default_value().to_f64(),
            }
        })
        .collect()
}

fn has_nerd_glyphs(font: &FontRef<'_>) -> bool {
    let charmap = font.charmap();
    NERD_CODEPOINTS.iter().any(|&codepoint| {
        charmap
            .map(codepoint)
            .is_some_and(|glyph| glyph.to_u32() != 0)
    })
}

// ─── Platform scans ───

#[cfg(target_os = "macos")]
async fn platform_faces(_env: &Env, families: &[String]) -> Result<Vec<ScannedFace>, String> {
    let families = families.to_vec();
    tokio::task::spawn_blocking(move || core_text::faces(&families))
        .await
        .map_err(|error| format!("font scan stopped: {error}"))
}

#[cfg(target_os = "macos")]
mod core_text {
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::ptr;

    use objc2_core_foundation::{
        CFArray, CFDictionary, CFRetained, CFSet, CFString, CFType, CFURL, kCFTypeSetCallBacks,
    };
    use objc2_core_text::{
        CTFontDescriptor, kCTFontFamilyNameAttribute, kCTFontNameAttribute,
        kCTFontStyleNameAttribute, kCTFontURLAttribute,
    };

    use super::ScannedFace;

    /// Each family's faces in CoreText's order, one per PostScript name, as
    /// `NSFontManager`'s `availableMembersOfFontFamily:` lists them.
    pub(super) fn faces(families: &[String]) -> Vec<ScannedFace> {
        // SAFETY: CoreText's attribute keys are immutable CFStrings.
        let family_key = unsafe { kCTFontFamilyNameAttribute };
        let mut keys = [ptr::from_ref(family_key).cast::<c_void>()];
        // SAFETY: one valid CFString, retained by the CFType callbacks.
        let mandatory =
            unsafe { CFSet::new(None, keys.as_mut_ptr(), 1, &raw const kCFTypeSetCallBacks) };
        let Some(mandatory) = mandatory else {
            return Vec::new();
        };

        let mut faces = Vec::new();
        for family in families {
            let name = CFString::from_str(family);
            let attributes =
                CFDictionary::<CFString, CFType>::from_slices(&[family_key], &[name.as_ref()]);
            // SAFETY: the dictionary maps a descriptor attribute to a CFString.
            let descriptor = unsafe { CTFontDescriptor::with_attributes(attributes.as_ref()) };
            // SAFETY: the set holds a descriptor attribute.
            let matches = unsafe { descriptor.matching_font_descriptors(Some(&mandatory)) };
            let Some(matches) = matches else { continue };
            // SAFETY: matching returns an array of font descriptors.
            let matches: CFRetained<CFArray<CTFontDescriptor>> =
                unsafe { CFRetained::cast_unchecked(matches) };

            let mut seen = HashSet::new();
            for member in matches.iter() {
                // SAFETY: CoreText's attribute keys are immutable CFStrings.
                let (name_key, style_key) =
                    unsafe { (kCTFontNameAttribute, kCTFontStyleNameAttribute) };
                let (Some(postscript), Some(style)) =
                    (string(&member, name_key), string(&member, style_key))
                else {
                    continue;
                };
                if !seen.insert(postscript.clone()) {
                    continue;
                }
                let Some(path) = file_of(&postscript) else {
                    continue;
                };
                faces.push(ScannedFace {
                    family: family.clone(),
                    style,
                    path,
                    index: None,
                    postscript: Some(postscript),
                });
            }
        }
        faces
    }

    fn string(descriptor: &CTFontDescriptor, key: &CFString) -> Option<String> {
        // SAFETY: the key is a font descriptor attribute.
        let value = unsafe { descriptor.attribute(key) }?;
        Some(value.downcast_ref::<CFString>()?.to_string())
    }

    /// The file CoreText resolves a PostScript name to. Where several files
    /// define one name, this picks the one the name opens.
    fn file_of(postscript: &str) -> Option<std::path::PathBuf> {
        let name = CFString::from_str(postscript);
        // SAFETY: a name and size describe a font.
        let descriptor = unsafe { CTFontDescriptor::with_name_and_size(&name, 12.0) };
        // SAFETY: the URL key is a descriptor attribute.
        let url = unsafe { descriptor.attribute(kCTFontURLAttribute) }?;
        url.downcast::<CFURL>().ok()?.to_file_path()
    }
}

#[cfg(not(target_os = "macos"))]
async fn platform_faces(env: &Env, families: &[String]) -> Result<Vec<ScannedFace>, String> {
    const FC_LIST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
    // family[0] is the name Ghostty reports (src/font/DeferredFace.zig:107).
    let listed = crate::ghostty::run(
        env,
        Path::new("fc-list"),
        ["--format", "%{family[0]}\t%{style[0]}\t%{file}\t%{index}\n"],
        FC_LIST_TIMEOUT,
    )
    .await
    .map_err(|error| format!("cannot run fc-list: {error}"))?;
    if !listed.status.success() {
        return Err(format!("fc-list failed: {}", listed.stderr.trim()));
    }
    Ok(parse_fontconfig(&listed.stdout, families))
}

#[cfg_attr(
    all(target_os = "macos", not(test)),
    expect(dead_code, reason = "Linux scans with it; a test pins it everywhere")
)]
fn parse_fontconfig(output: &str, families: &[String]) -> Vec<ScannedFace> {
    output
        .split('\n')
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let (family, style, path, index) = (
                fields.next()?,
                fields.next()?,
                fields.next()?,
                fields.next()?,
            );
            if family.is_empty() || style.is_empty() || path.is_empty() || index.is_empty() {
                return None;
            }
            if !families.iter().any(|name| name == family) {
                return None;
            }
            Some(ScannedFace {
                family: family.to_owned(),
                style: style.to_owned(),
                path: path.into(),
                // The high 16 bits number a variable font's named instance.
                index: Some((index.trim().parse::<u64>().unwrap_or(0) & 0xffff) as u32),
                postscript: None,
            })
        })
        .collect()
}

// ─── Collection splitting ───

/// Copies one face of a TTC/OTC (its table directory and tables) into a
/// standalone sfnt. Table checksums stay valid because table bytes are
/// unchanged; head.checkSumAdjustment is left stale, which browsers ignore.
fn extract_face(bytes: &[u8], index: u32) -> Option<Vec<u8>> {
    let index = usize::try_from(index).ok()?;
    if index >= be32(bytes, 8)? {
        return None;
    }

    let dir = be32(bytes, 12 + index.checked_mul(4)?)?;
    let count = be16(bytes, dir.checked_add(4)?)?;
    let header_size = 12 + count * 16;
    let header = bytes.get(dir..dir.checked_add(header_size)?)?;
    let tables = (0..count)
        .map(|table| {
            let record = 12 + table * 16;
            Some((be32(header, record + 8)?, be32(header, record + 12)?))
        })
        .collect::<Option<Vec<_>>>()?;
    // A face's tables are distinct parts of the file, so a face larger than
    // the file, allowing for each table's padding, has overlapping records.
    let size = tables.iter().try_fold(header_size, |size, &(_, length)| {
        size.checked_add(length.checked_next_multiple_of(4)?)
    })?;
    if size > bytes.len().checked_add(3 * count)? {
        return None;
    }

    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(header);
    for (table, &(offset, length)) in tables.iter().enumerate() {
        let placed = u32::try_from(out.len()).ok()?.to_be_bytes();
        out[12 + table * 16 + 8..][..4].copy_from_slice(&placed);
        out.extend_from_slice(bytes.get(offset..offset.checked_add(length)?)?);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    Some(out)
}

fn be32(bytes: &[u8], at: usize) -> Option<usize> {
    let field = bytes.get(at..at.checked_add(4)?)?;
    usize::try_from(u32::from_be_bytes(field.try_into().ok()?)).ok()
}

fn be16(bytes: &[u8], at: usize) -> Option<usize> {
    let field = bytes.get(at..at.checked_add(2)?)?;
    Some(usize::from(u16::from_be_bytes(field.try_into().ok()?)))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::{Value, json};

    use super::*;

    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fonts")
    }

    #[test]
    fn parses_the_families_ghostty_lists() {
        let courier = include_str!("../tests/fixtures/ghostty-1.3.1/list-fonts.txt");
        let cases: [(&str, &[&str]); 3] = [
            (courier, &["Courier New", "Menlo", "Monaco"]),
            ("", &[]),
            ("A\n  A Bold\n\nB\n\tTabbed\n\n", &["A", "B", "\tTabbed"]),
        ];
        for (output, families) in cases {
            assert_eq!(parse_families(output), families, "{output:?}");
        }
    }

    /// Each face id with the face it names, across every case, so ids can be
    /// checked one to one with faces.
    type Ids = HashMap<String, (PathBuf, u32, String)>;

    /// The family as the panel gets it. Face ids are opaque, so each face
    /// shows the file it serves instead.
    fn describe(family: &str, faces: &Value, ids: &mut Ids) -> Value {
        let fonts = fixtures();
        let scanned: Vec<ScannedFace> = faces
            .as_array()
            .unwrap()
            .iter()
            .map(|face| ScannedFace {
                family: family.to_owned(),
                style: face["style"].as_str().unwrap().to_owned(),
                path: fonts.join(face["file"].as_str().unwrap()),
                index: face["index"]
                    .as_u64()
                    .map(|index| u32::try_from(index).unwrap()),
                postscript: face["postscript"].as_str().map(String::from),
            })
            .collect();
        let mut files = HashMap::new();
        let Some(described) = describe_family(family, &scanned, &mut files) else {
            return Value::Null;
        };
        let mut output = serde_json::to_value(&described).unwrap();
        output["faces"] = described
            .faces
            .iter()
            .map(|face| {
                let file = &files[&face.id];
                let named = (file.path.clone(), file.index, face.style.clone());
                assert_eq!(
                    *ids.entry(face.id.clone()).or_insert_with(|| named.clone()),
                    named,
                    "one id for two faces"
                );
                json!({
                    "style": face.style,
                    "file": file.path.strip_prefix(&fonts).unwrap(),
                    "index": file.index,
                })
            })
            .collect();
        output
    }

    #[test]
    fn describes_a_family_from_its_face_files() {
        let face = |style: &str, file: &str, index: u32| json!({"style": style, "file": file, "index": index});
        let axis = |tag: &str, name: &str, [min, default, max]: [f64; 3]| json!({"tag": tag, "name": name, "min": min, "default": default, "max": max});
        let karla_weight = axis("wght", "Weight", [200.0, 400.0, 800.0]);
        let inconsolata_axes = [
            axis("wght", "Weight", [100.0, 400.0, 900.0]),
            axis("wdth", "Width", [50.0, 100.0, 200.0]),
        ];
        let karla_features = [
            "aalt", "case", "ccmp", "dnom", "frac", "kern", "liga", "lnum", "numr", "onum", "ordn",
            "pnum", "sinf", "subs", "sups", "tnum",
        ];
        let dm_mono_features = ["aalt", "ordn", "ss02", "ss04", "ss05", "sups"];
        let karla = face("Regular", "KarlaVariable.ttf", 0);
        let missing = face("Regular", "missing.ttf", 0);
        let dm_mono = json!({
            "family": "DM Mono",
            "faces": [face("Regular", "DMMono.ttc", 0), face("Italic", "DMMono.ttc", 1)],
            "nerd": false,
            "features": dm_mono_features,
            "axes": [],
        });
        let cases = [
            (
                "Inconsolata",
                json!([
                    face("Regular", "InconsolataVariable.ttf", 0),
                    face("Bold", "InconsolataVariable.ttf", 0),
                ]),
                json!({
                    "family": "Inconsolata",
                    "faces": [
                        face("Regular", "InconsolataVariable.ttf", 0),
                        face("Bold", "InconsolataVariable.ttf", 0),
                    ],
                    "nerd": false,
                            "features": ["aalt", "dlig", "dnom", "frac", "numr", "ordn", "ss02", "subs", "sups", "zero"],
                    "axes": inconsolata_axes,
                }),
            ),
            (
                "Karla",
                json!([karla]),
                json!({
                    "family": "Karla",
                    "faces": [karla],
                    "nerd": false,
                    "features": karla_features,
                    "axes": [karla_weight],
                }),
            ),
            // fontconfig names collection faces by index.
            (
                "DM Mono",
                json!([
                    face("Regular", "DMMono.ttc", 0),
                    face("Italic", "DMMono.ttc", 1),
                    face("Missing", "DMMono.ttc", 2),
                ]),
                dm_mono.clone(),
            ),
            // CoreText names them by PostScript name.
            (
                "DM Mono",
                json!([
                    {"style": "Italic", "file": "DMMono.ttc", "postscript": "DMMono-Italic"},
                    {"style": "Regular", "file": "DMMono.ttc", "postscript": "DMMono-Regular"},
                    {"style": "Other", "file": "DMMono.ttc", "postscript": "DMMono-Bold"},
                ]),
                {
                    let mut family = dm_mono.clone();
                    family["faces"] = json!([
                        face("Italic", "DMMono.ttc", 1),
                        face("Regular", "DMMono.ttc", 0),
                    ]);
                    family
                },
            ),
            (
                "Nerd Stand-In",
                json!([face("Regular", "NerdStandIn.ttf", 0)]),
                json!({
                    "family": "Nerd Stand-In",
                    "faces": [face("Regular", "NerdStandIn.ttf", 0)],
                    "nerd": true,
                            "features": ["XALT", "ordn", "ss02", "ss04", "ss05", "sups"],
                    "axes": [],
                }),
            ),
            (
                "Mixed",
                json!([
                    karla,
                    face("Wide", "InconsolataVariable.ttf", 0),
                    face("Icons", "NerdStandIn.ttf", 0),
                    face("Gone", "missing.ttf", 0),
                    face("Licence", "OFL-Karla.txt", 0),
                ]),
                json!({
                    "family": "Mixed",
                    "faces": [
                        karla,
                        face("Wide", "InconsolataVariable.ttf", 0),
                        face("Icons", "NerdStandIn.ttf", 0),
                    ],
                    "nerd": true,
                    "features": [
                        "XALT", "aalt", "case", "ccmp", "dlig", "dnom", "frac", "kern", "liga",
                        "lnum", "numr", "onum", "ordn", "pnum", "sinf", "ss02", "ss04", "ss05",
                        "subs", "sups", "tnum", "zero",
                    ],
                    "axes": [karla_weight, inconsolata_axes[1]],
                }),
            ),
            ("Unreadable", json!([missing]), Value::Null),
            (
                "Duplicate",
                json!([
                    missing,
                    karla,
                    face("Regular", "InconsolataVariable.ttf", 0)
                ]),
                json!({
                    "family": "Duplicate",
                    "faces": [karla],
                    "nerd": false,
                    "features": karla_features,
                    "axes": [karla_weight],
                }),
            ),
        ];
        let mut ids = Ids::new();
        for (family, faces, expected) in cases {
            assert_eq!(describe(family, &faces, &mut ids), expected, "{faces}");
        }
        let faces: HashSet<_> = ids.values().collect();
        assert_eq!(faces.len(), ids.len(), "one face under two ids");
    }

    #[test]
    fn parses_fontconfig_faces_of_the_listed_families() {
        let output = "\
            DejaVu Sans Mono\tBold\t/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf\t0\n\
            DejaVu Sans Mono\tBook\t/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf\t0\n\
            Nimbus Mono PS\tBold\t/usr/share/fonts/X11/Type1/NimbusMonoPS-Bold.pfb\t0\n\
            Nimbus Mono PS\tBold\t/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Bold.otf\t0\n\
            Nimbus Mono PS\tBold\t/usr/share/fonts/type1/urw-base35/NimbusMonoPS-Bold.t1\t0\n\
            Noto Sans\tRegular\t/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf\t0\n\
            Iosevka\tExtended\t/x/Iosevka.ttc\t65537\n\
            Iosevka\tHuge\t/x/Iosevka.ttc\t4294967298\n\
            Iosevka\tSpaced\t/x/Iosevka.ttc\t 3 \n\
            Iosevka\tOdd\t/x/Iosevka.ttc\tabc\n\
            Iosevka\tExtra\t/x/Iosevka.ttc\t4\tmore\n\
            Iosevka\t\t/x/Iosevka.ttc\t0\n\
            Iosevka\tShort\t/x/Iosevka.ttc\n";
        let families = ["DejaVu Sans Mono", "Nimbus Mono PS", "Iosevka"].map(String::from);
        let dejavu = "/usr/share/fonts/truetype/dejavu";
        let nimbus = "NimbusMonoPS-Bold";
        let expected = [
            (
                "DejaVu Sans Mono",
                "Bold",
                &format!("{dejavu}/DejaVuSansMono-Bold.ttf"),
                0,
            ),
            (
                "DejaVu Sans Mono",
                "Book",
                &format!("{dejavu}/DejaVuSansMono.ttf"),
                0,
            ),
            (
                "Nimbus Mono PS",
                "Bold",
                &format!("/usr/share/fonts/X11/Type1/{nimbus}.pfb"),
                0,
            ),
            (
                "Nimbus Mono PS",
                "Bold",
                &format!("/usr/share/fonts/opentype/urw-base35/{nimbus}.otf"),
                0,
            ),
            (
                "Nimbus Mono PS",
                "Bold",
                &format!("/usr/share/fonts/type1/urw-base35/{nimbus}.t1"),
                0,
            ),
            ("Iosevka", "Extended", &"/x/Iosevka.ttc".to_owned(), 1),
            ("Iosevka", "Huge", &"/x/Iosevka.ttc".to_owned(), 2),
            ("Iosevka", "Spaced", &"/x/Iosevka.ttc".to_owned(), 3),
            ("Iosevka", "Odd", &"/x/Iosevka.ttc".to_owned(), 0),
            ("Iosevka", "Extra", &"/x/Iosevka.ttc".to_owned(), 4),
        ];
        let parsed: Vec<_> = parse_fontconfig(output, &families)
            .into_iter()
            .map(|face| (face.family, face.style, face.path, face.index))
            .collect();
        let expected: Vec<_> = expected
            .into_iter()
            .map(|(family, style, path, index)| {
                (
                    family.into(),
                    style.into(),
                    PathBuf::from(path),
                    Some(index),
                )
            })
            .collect();
        assert_eq!(parsed, expected);
    }

    #[test]
    fn maps_aat_features_to_opentype_tags() {
        let cases = [
            ((1, 2), Some("liga")),
            ((17, 1), Some("cv01")),
            ((17, 99), Some("cv99")),
            ((17, 0), None),
            ((35, 2), Some("ss01")),
            ((35, 40), Some("ss20")),
            ((35, 3), None),
            ((1, 1), None),
        ];
        for ((kind, setting), tag) in cases {
            assert_eq!(
                aat_feature(kind, setting).as_deref(),
                tag,
                "{kind} {setting}"
            );
        }
    }

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
            .collect()
    }

    /// The length and FNV-1a hash of each face, None where splitting fails.
    #[test]
    fn splits_collections_into_faces() {
        let dm_mono = fs::read(fixtures().join("DMMono.ttc")).unwrap();
        // One face whose 64 table records all point at the same 1 KiB.
        let mut overlapping = hex("74746366000100000000000100000010000100000040000000000000");
        for _ in 0..64 {
            overlapping.extend(hex("7461626c000000000000000000000400"));
        }
        overlapping.resize(1100, 0);
        let cases = [
            (
                "face 0",
                dm_mono.clone(),
                0,
                Some((4432, "b3885cc0f8bcd43b")),
            ),
            (
                "face 1",
                dm_mono.clone(),
                1,
                Some((4572, "0d61cda81c88ec94")),
            ),
            ("past the last face", dm_mono.clone(), 2, None),
            ("truncated", dm_mono[..600].to_vec(), 0, None),
            (
                "tables past the end",
                hex(&format!(
                    "{:0<128}",
                    "7474636600010000000000010000001000010000ffff"
                )),
                0,
                None,
            ),
            (
                "huge offset",
                hex(&format!(
                    "{:0<128}",
                    "747463660001000000000001000000100001000000010000000000007461626c00000000fffffff000000010"
                )),
                0,
                None,
            ),
            ("overlapping records", overlapping, 0, None),
        ];
        for (label, bytes, index, expected) in cases {
            let face = extract_face(&bytes, index).map(|face| {
                let fnv1a = face.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, &byte| {
                    (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
                });
                (face.len(), format!("{fnv1a:016x}"))
            });
            let expected = expected.map(|(len, fnv1a)| (len, fnv1a.to_owned()));
            assert_eq!(face, expected, "{label}");
        }
    }
}
