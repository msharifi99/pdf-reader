# Linux (Fedora first)

## Build the .rpm

```sh
sh scripts/linux/build-fedora.sh
```

Needs Docker (Docker Desktop on Windows/macOS works; run it from Git Bash on Windows). The build runs inside
`fedora:latest` (`scripts/linux/fedora.Dockerfile`), so the binary links against Fedora's own WebKitGTK and
glibc. The package lands in `src-tauri/target/fedora/` and installs on that Fedora release or newer:

```sh
sudo dnf install ./Quire-0.1.0-1.x86_64.rpm
```

Building natively on Fedora without Docker:

```sh
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libxdo-devel openssl-devel gcc gcc-c++ rust cargo nodejs npm
npm ci && npx tauri build --bundles rpm
```

`deb` and `appimage` build the same way on Debian/Ubuntu (`--bundles deb,appimage`).

## What differs from Windows

Linux-only settings live in `src-tauri/tauri.linux.conf.json`. Tauri merges that file over `tauri.conf.json`,
and arrays such as `app.windows` are replaced, not merged.

| Area | Linux behaviour |
|---|---|
| Webview | WebKitGTK 4.1. Internal files are served from `quire://localhost` instead of `http://quire.localhost` (`QUIRE_ORIGIN` in Rust, `convertFileSrc` in `core.ts`). |
| Window | Still frameless with Quire's own title bar, but opaque (`transparent: false`); there is no Mica. Snap-layout hover is Windows-only. |
| File types | The `.desktop` file (template: `src-tauri/linux/quire.desktop`, which adds the `%F` that Tauri's default template lacks) declares the book, comic and image MIME types from `fileAssociations`, so Quire shows under "Open with". Like the Windows installer, it never takes over a type. A second launch hands its files to the running window over D-Bus (single-instance plugin). |
| System fonts | Listed via `fc-list` (fontconfig). |
| OCR | Uses the `tesseract` CLI when it is installed. The rpm *recommends* `tesseract` and `tesseract-langpack-eng`; add other packs (`tesseract-langpack-deu`, ...) for more languages. Language tags are Tesseract codes (`eng`, `deu`). Without Tesseract, OCR reports that it needs installing and the rest of the app works. |

## Known issues

- Blank or flickering window on some NVIDIA/Wayland setups is a WebKitGTK bug. Launch with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 quire` to work around it.
- On Wayland, apps can't place their own windows, so restored window positions are ignored (sizes are kept).
