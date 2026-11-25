use std::path::Path;
use std::time::Instant;

use quire_lib::dictionary::Dictionary;

fn dict() -> Dictionary {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/dictionary.sqlite");
    assert!(p.exists(), "run `npm run build:dictionary` first");
    Dictionary::new(p)
}

#[test]
fn lookups() {
    let d = dict();
    let run = d.lookup("run").unwrap().unwrap();
    assert_eq!(run.lemma, "run");
    assert!(run.entries.iter().any(|e| e.pos == "verb") && run.entries.iter().any(|e| e.pos == "noun"));
    assert!(run.entries[0].definitions.iter().all(|x| !x.text.is_empty()));

    assert_eq!(d.lookup("running").unwrap().unwrap().lemma, "run");
    assert_eq!(d.lookup("Running").unwrap().unwrap().lemma, "run");
    assert_eq!(d.lookup("geese").unwrap().unwrap().lemma, "goose");
    let better = d.lookup("better").unwrap().unwrap();
    assert_eq!(better.lemma, "good");
    assert!(better.entries.iter().any(|e| e.lemma == "better"));
    assert_eq!(d.lookup("Café").unwrap().unwrap().lemma, "cafe");
    assert_eq!(d.lookup("stopped").unwrap().unwrap().lemma, "stop");
    assert_eq!(d.lookup("studies").unwrap().unwrap().lemma, "study");

    let ic = d.lookup("ice cream").unwrap().unwrap();
    assert_eq!(ic.lemma, "ice cream");
    assert!(ic.entries[0].definitions[0].text.contains("cream"));
    assert_eq!(d.lookup("Ice-Cream").unwrap().unwrap().lemma, "ice cream");

    let dog = d.lookup("dog").unwrap().unwrap();
    assert!(dog.entries[0].synonyms.iter().any(|s| s == "domestic dog"));
    assert!(d.lookup("xyzzyqq").unwrap().is_none());
    assert!(d.lookup("  ").unwrap().is_none());
}

#[test]
fn suggestions() {
    let d = dict();
    let s = d.suggest("ice cr", 5).unwrap();
    assert!(s.iter().any(|w| w == "ice cream"), "{s:?}");
    assert!(d.suggest("pho", 10).unwrap().len() > 3);
    assert!(d.suggest("zzzzqq", 10).unwrap().is_empty());
}

#[test]
fn fast() {
    let d = dict();
    d.lookup("warmup").unwrap();
    for w in ["run", "running", "geese", "better", "ice cream", "unknownword"] {
        let t = Instant::now();
        d.lookup(w).unwrap();
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        assert!(ms < 5.0, "{w} took {ms} ms");
    }
    let t = Instant::now();
    d.suggest("a", 10).unwrap();
    assert!(t.elapsed().as_millis() < 20);
}
