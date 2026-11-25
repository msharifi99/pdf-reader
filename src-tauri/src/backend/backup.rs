//! `.quire-backup`: a zip of a consistent DB snapshot, the covers folder and a manifest.

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use serde_json::json;
use zip::write::SimpleFileOptions;

use super::db::{Db, SCHEMA_VERSION};
use super::error::{Error, ErrorCode, Res};
use super::model::now_ms;

impl Db {
    pub fn backup(&self, dest: &Path) -> Res<()> {
        let snap = self.dir.join("backup-snapshot.db");
        let _ = std::fs::remove_file(&snap);
        self.with(|c| Ok(c.execute("VACUUM INTO ?1", [snap.to_string_lossy().as_ref()]).map(|_| ())?))?;
        let tmp = dest.with_extension("quire-backup.tmp");
        let r = (|| -> Res<()> {
            let mut z = zip::ZipWriter::new(File::create(&tmp)?);
            let deflate = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            z.start_file("manifest.json", deflate)?;
            let manifest = json!({"app": "quire", "appVersion": env!("CARGO_PKG_VERSION"), "schemaVersion": SCHEMA_VERSION, "createdAt": now_ms()});
            z.write_all(manifest.to_string().as_bytes())?;
            z.start_file("quire.db", deflate)?;
            std::io::copy(&mut File::open(&snap)?, &mut z)?;
            if let Ok(rd) = std::fs::read_dir(self.covers_dir()) {
                for e in rd.flatten().filter(|e| e.path().is_file()) {
                    z.start_file(format!("covers/{}", e.file_name().to_string_lossy()), stored)?;
                    std::io::copy(&mut File::open(e.path())?, &mut z)?;
                }
            }
            z.finish()?;
            Ok(())
        })();
        let _ = std::fs::remove_file(&snap);
        r?;
        let _ = std::fs::remove_file(dest);
        std::fs::rename(&tmp, dest)?;
        Ok(())
    }

    /// Replace the database and covers with a backup. The previous ones are kept as `.bak` until the
    /// swap succeeds, and put back if it fails.
    pub fn restore(&self, src: &Path) -> Res<()> {
        let bad = |m: &str| Error::new(ErrorCode::Corrupt, m.to_string());
        let mut z = zip::ZipArchive::new(File::open(src)?).map_err(|_| bad("That doesn't look like a Quire backup."))?;
        let manifest: serde_json::Value = {
            let mut s = String::new();
            z.by_name("manifest.json").map_err(|_| bad("That doesn't look like a Quire backup."))?.read_to_string(&mut s)?;
            serde_json::from_str(&s)?
        };
        if manifest["app"] != "quire" || z.by_name("quire.db").is_err() {
            return Err(bad("That doesn't look like a Quire backup."));
        }
        if manifest["schemaVersion"].as_i64().unwrap_or(i64::MAX) > SCHEMA_VERSION as i64 {
            return Err(Error::new(ErrorCode::Unsupported, "That backup was made by a newer version of Quire."));
        }

        let tmp = self.dir.join("restore-tmp");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("covers"))?;
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let Some(name) = e.enclosed_name() else { continue };
            if e.is_dir() || !(name == Path::new("quire.db") || name.starts_with("covers")) { continue }
            let out = tmp.join(&name);
            if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
            std::io::copy(&mut e, &mut File::create(out)?)?;
        }
        // Make sure the extracted DB is usable (and migrate it) before touching the live one.
        {
            let c = rusqlite::Connection::open(tmp.join("quire.db"))?;
            super::db::migrate(&c)?;
            c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .ok().filter(|s| s == "ok").ok_or_else(|| bad("That backup's data is damaged."))?;
        }

        let (live, covers) = (self.db_path(), self.covers_dir());
        let (bak, cbak) = (self.dir.join("quire.db.bak"), self.dir.join("covers.bak"));
        let res = self.replace_connection(|| {
            let _ = std::fs::remove_file(&bak);
            let _ = std::fs::remove_dir_all(&cbak);
            for ext in ["-wal", "-shm"] { let _ = std::fs::remove_file(self.dir.join(format!("quire.db{ext}"))); }
            std::fs::rename(&live, &bak)?;
            if let Err(e) = std::fs::rename(tmp.join("quire.db"), &live) {
                let _ = std::fs::rename(&bak, &live);
                return Err(e.into());
            }
            let had_covers = covers.exists();
            if had_covers { std::fs::rename(&covers, &cbak)?; }
            if let Err(e) = std::fs::rename(tmp.join("covers"), &covers) {
                if had_covers { let _ = std::fs::rename(&cbak, &covers); }
                let _ = std::fs::remove_file(&live);
                let _ = std::fs::rename(&bak, &live);
                return Err(e.into());
            }
            Ok(())
        });
        let _ = std::fs::remove_dir_all(&tmp);
        res?;
        let _ = std::fs::remove_file(&bak);
        let _ = std::fs::remove_dir_all(&cbak);
        Ok(())
    }
}
