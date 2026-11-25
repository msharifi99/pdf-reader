//! Offline English dictionary (WordNet 3.1, built by `scripts/dictionary/build.mjs`) in a read-only
//! SQLite file bundled as a Tauri resource. One lazily opened connection; a lookup is a handful of
//! primary-key reads (well under a millisecond), so commands answer straight from the async runtime.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use tauri::State;
use unicode_normalization::UnicodeNormalization;

use crate::backend::error::{Error, ErrorCode, Res};

const MAX_DEFS: usize = 12;
const MAX_SYNONYMS: usize = 10;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DictDefinition {
    pub text: String,
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DictEntry {
    /// The dictionary headword this entry belongs to (differs from the result's `lemma` for e.g. "better" -> "good" + "better").
    pub lemma: String,
    /// "noun" | "verb" | "adjective" | "adverb"
    pub pos: String,
    pub definitions: Vec<DictDefinition>,
    pub synonyms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DictResult {
    /// Base form of the looked-up word ("running" -> "run").
    pub lemma: String,
    /// The folded form that was looked up (lower-case, no diacritics).
    pub form: String,
    pub entries: Vec<DictEntry>,
}

pub struct Dictionary {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

/// Lower-case, strip diacritics, and turn `_`/`-`/runs of whitespace into single spaces.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = true;
    for c in s.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).flat_map(char::to_lowercase) {
        if c.is_whitespace() || matches!(c, '_' | '-' | '\u{2010}'..='\u{2015}') {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out.truncate(out.trim_end().len());
    out
}

const POS: [(&str, &str); 4] = [("n", "noun"), ("v", "verb"), ("a", "adjective"), ("r", "adverb")];

/// WordNet's morphy detachment rules plus consonant un-doubling ("running" -> "run").
fn rules(pos: &str, w: &str) -> Vec<String> {
    let table: &[(&str, &str)] = match pos {
        "n" => &[("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")],
        "v" => &[("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""), ("ied", "y"), ("ing", "e"), ("ing", "")],
        "a" => &[("er", ""), ("est", ""), ("er", "e"), ("est", "e")],
        _ => &[],
    };
    let mut out = Vec::new();
    for (suf, rep) in table {
        if let Some(stem) = w.strip_suffix(suf) {
            if stem.is_empty() {
                continue;
            }
            let base = format!("{stem}{rep}");
            let b = base.as_bytes();
            let doubled = rep.is_empty() && b.len() > 2 && b[b.len() - 1] == b[b.len() - 2] && !b"aeiouls".contains(&b[b.len() - 1]);
            out.push(base.clone());
            if doubled {
                out.push(base[..base.len() - 1].to_string());
            }
        }
    }
    out
}

impl Dictionary {
    pub fn new(path: PathBuf) -> Self {
        Self { path, conn: Mutex::new(None) }
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> Res<T>) -> Res<T> {
        let mut g = self.conn.lock().map_err(|_| Error::new(ErrorCode::Db, "The dictionary is busy."))?;
        if g.is_none() {
            let c = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
                .map_err(|_| Error::new(ErrorCode::NotFound, "The dictionary isn't installed."))?;
            *g = Some(c);
        }
        f(g.as_ref().unwrap())
    }

    pub fn lookup(&self, word: &str) -> Res<Option<DictResult>> {
        let key = fold(word);
        if key.is_empty() {
            return Ok(None);
        }
        self.with(|c| lookup_in(c, &key))
    }

    pub fn suggest(&self, prefix: &str, limit: usize) -> Res<Vec<String>> {
        let p = fold(prefix);
        if p.is_empty() {
            return Ok(vec![]);
        }
        let hi = format!("{p}{}", char::MAX);
        self.with(|c| {
            let mut st = c.prepare_cached("SELECT COALESCE(word, key) FROM lemma WHERE key >= ?1 AND key < ?2 ORDER BY f DESC, length(key), key LIMIT ?3")?;
            let rows = st.query_map((&p, &hi, limit.clamp(1, 50) as i64), |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }
}

/// Entries of one headword, grouped by part of speech (senses are stored in n, v, a, r order).
fn load(c: &Connection, key: &str) -> Res<Vec<(String, DictEntry)>> {
    let Some((word, senses)) = c
        .prepare_cached("SELECT COALESCE(word, key), s FROM lemma WHERE key = ?1")?
        .query_row([key], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .optional()?
    else {
        return Ok(vec![]);
    };
    let mut st = c.prepare_cached("SELECT pos, def, ex, syn FROM synset WHERE id = ?1")?;
    let mut out: Vec<(String, DictEntry)> = Vec::new();
    for id in senses.split(',').filter_map(|s| s.parse::<i64>().ok()) {
        let (pos, def, ex, syn): (String, String, Option<String>, Option<String>) =
            st.query_row([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        let i = match out.iter().position(|(p, _)| *p == pos) {
            Some(i) => i,
            None => {
                let name = POS.iter().find(|(s, _)| *s == pos).map_or("noun", |(_, n)| n);
                out.push((pos, DictEntry { lemma: word.clone(), pos: name.into(), definitions: vec![], synonyms: vec![] }));
                out.len() - 1
            }
        };
        let e = &mut out[i].1;
        if e.definitions.len() < MAX_DEFS {
            e.definitions.push(DictDefinition { text: def, examples: ex.map(|x| x.split('\n').map(str::to_string).collect()).unwrap_or_default() });
        }
        for s in syn.iter().flat_map(|s| s.split('|')) {
            if fold(s) != key && e.synonyms.len() < MAX_SYNONYMS && !e.synonyms.iter().any(|x| x == s) {
                e.synonyms.push(s.to_string());
            }
        }
    }
    Ok(out)
}

fn lookup_in(c: &Connection, key: &str) -> Res<Option<DictResult>> {
    let exact = load(c, key)?;
    let mut out: Vec<DictEntry> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut push = |pos: &str, e: &DictEntry, out: &mut Vec<DictEntry>| {
        if seen.insert((e.lemma.clone(), pos.to_string())) {
            out.push(e.clone());
        }
    };
    let mut irregular: HashSet<String> = HashSet::new();
    {
        let mut st = c.prepare_cached("SELECT pos, base FROM exc WHERE form = ?1")?;
        let rows = st.query_map([key], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        for (pos, base) in rows {
            irregular.insert(pos.clone());
            for (p, e) in load(c, &base)? {
                if p == pos {
                    push(&p, &e, &mut out);
                }
            }
        }
    }
    for (pos, _) in POS {
        if irregular.contains(pos) || exact.iter().any(|(p, _)| p == pos) {
            continue;
        }
        'cand: for cand in rules(pos, key) {
            for (p, e) in load(c, &cand)? {
                if p == pos {
                    push(&p, &e, &mut out);
                    break 'cand;
                }
            }
        }
    }
    for (p, e) in &exact {
        push(p, e, &mut out);
    }
    Ok(out.first().map(|e| e.lemma.clone()).map(|lemma| DictResult { lemma, form: key.to_string(), entries: out }))
}

/// Look a word or phrase up. `null` when the dictionary has nothing for it.
#[tauri::command]
#[specta::specta]
pub async fn lookup_word(dict: State<'_, Dictionary>, word: String) -> Res<Option<DictResult>> {
    dict.lookup(&word)
}

/// Headwords starting with `prefix`, most common first.
#[tauri::command]
#[specta::specta]
pub async fn suggest_words(dict: State<'_, Dictionary>, prefix: String, limit: u32) -> Res<Vec<String>> {
    dict.suggest(&prefix, limit as usize)
}
