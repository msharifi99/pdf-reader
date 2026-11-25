use quire_lib::protocol::*;
use std::fs::File;
use tauri::http::header;
use std::io::Write;

#[test]
fn range_parsing() {
    assert_eq!(parse_range(None, 1000), RangeSel::Full);
    assert_eq!(parse_range(Some("bytes=0-99"), 1000), RangeSel::Partial(0, 99));
    assert_eq!(parse_range(Some("bytes=100-"), 1000), RangeSel::Partial(100, 999));
    assert_eq!(parse_range(Some("bytes=-50"), 1000), RangeSel::Partial(950, 999));
    assert_eq!(parse_range(Some("bytes=900-5000"), 1000), RangeSel::Partial(900, 999));
    assert_eq!(parse_range(Some("bytes=-5000"), 1000), RangeSel::Partial(0, 999));
    assert_eq!(parse_range(Some("bytes=1000-"), 1000), RangeSel::Unsatisfiable);
    assert_eq!(parse_range(Some("bytes=5000-6000"), 1000), RangeSel::Unsatisfiable);
    assert_eq!(parse_range(Some("bytes=-0"), 1000), RangeSel::Unsatisfiable);
    assert_eq!(parse_range(Some("bytes=0-1,5-9"), 1000), RangeSel::Full);
    assert_eq!(parse_range(Some("garbage"), 1000), RangeSel::Full);
}

#[test]
fn serves_ranges_from_disk() {
    let p = std::env::temp_dir().join(format!("quire-range-{}.pdf", std::process::id()));
    let data: Vec<u8> = b"%PDF-".iter().copied().chain((0..995u32).map(|i| (i % 251) as u8)).collect();
    File::create(&p).unwrap().write_all(&data).unwrap();

    let r = serve_file(&p, None, false);
    assert_eq!(r.status(), 200);
    assert_eq!(r.body().len(), 1000);
    assert_eq!(r.headers()[header::CONTENT_TYPE], "application/pdf");
    assert_eq!(r.headers()[header::ACCEPT_RANGES], "bytes");

    let r = serve_file(&p, Some("bytes=0-99"), false);
    assert_eq!(r.status(), 206);
    assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes 0-99/1000");
    assert_eq!(r.body().as_slice(), &data[0..100]);

    let r = serve_file(&p, Some("bytes=100-"), false);
    assert_eq!(r.status(), 206);
    assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes 100-999/1000");
    assert_eq!(r.body().as_slice(), &data[100..]);

    let r = serve_file(&p, Some("bytes=-50"), false);
    assert_eq!(r.status(), 206);
    assert_eq!(r.body().as_slice(), &data[950..]);

    let r = serve_file(&p, Some("bytes=2000-"), false);
    assert_eq!(r.status(), 416);
    assert_eq!(r.headers()[header::CONTENT_RANGE], "bytes */1000");

    let r = serve_file(&p, Some("bytes=0-9"), true);
    assert_eq!(r.status(), 206);
    assert!(r.body().is_empty());
    assert_eq!(r.headers()[header::CONTENT_LENGTH], "10");

    assert_eq!(serve_file(&p.with_extension("nope"), None, false).status(), 404);
    std::fs::remove_file(&p).unwrap();
}
