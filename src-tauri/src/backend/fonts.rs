//! Installed font families (DirectWrite on Windows, fontconfig on Linux), deduped and sorted; computed once.
use std::sync::OnceLock;

static FONTS: OnceLock<Vec<String>> = OnceLock::new();

pub fn list_system_fonts() -> Vec<String> {
    FONTS.get_or_init(load).clone()
}

#[cfg(windows)]
fn load() -> Vec<String> {
    use windows::core::{w, BOOL};
    use windows::Win32::Graphics::DirectWrite::*;
    let mut out: Vec<String> = vec![];
    let _ = (|| -> windows::core::Result<()> {
        unsafe {
            let f: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let mut col = None;
            f.GetSystemFontCollection(&mut col, false)?;
            let Some(col) = col else { return Ok(()) };
            for i in 0..col.GetFontFamilyCount() {
                let names = col.GetFontFamily(i)?.GetFamilyNames()?;
                let (mut idx, mut exists) = (0u32, BOOL(0));
                let _ = names.FindLocaleName(w!("en-us"), &mut idx, &mut exists);
                if !exists.as_bool() { idx = 0; }
                let len = names.GetStringLength(idx)? as usize;
                let mut buf = vec![0u16; len + 1];
                names.GetString(idx, &mut buf)?;
                out.push(String::from_utf16_lossy(&buf[..len]));
            }
        }
        Ok(())
    })();
    out.sort_by_key(|s| s.to_lowercase());
    out.dedup();
    out
}

#[cfg(target_os = "linux")]
fn load() -> Vec<String> {
    // fontconfig ships with every GTK desktop; first family name of each installed face
    let out = std::process::Command::new("fc-list").args(["--format", "%{family[0]}\n"]).output();
    let mut v: Vec<String> = out
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

#[cfg(not(any(windows, target_os = "linux")))]
fn load() -> Vec<String> {
    vec![]
}
