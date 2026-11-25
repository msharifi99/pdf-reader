fn main() {
    // Test executables link tauri's comctl32 v6 imports; without this manifest they fail to start
    // (STATUS_ENTRYPOINT_NOT_FOUND). Real binaries get their manifest from tauri-build.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{dir}/test.manifest");
    }
    tauri_build::build()
}
