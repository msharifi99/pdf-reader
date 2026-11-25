# Quire (e-ink Android)

Native Java reader for a low-end Android 4.2 e-ink device (Fidibook F1, API 17, armeabi-v7a, 512 MB). See `COORDINATION.md` for the plan.
Licence note: MuPDF is AGPL; this is a private app, keep it that way or comply.

## Prerequisites
- JDK 17+ (tested with Temurin 21), Android SDK with `platforms;android-35` and `build-tools;35.0.0` (`ANDROID_HOME` set or `local.properties` with `sdk.dir`).
- Nothing else for a normal build: Gradle comes from the wrapper (Gradle 8.9, AGP 8.7.3), MuPDF is prebuilt in the repo.
- Only to rebuild MuPDF natively: NDK **23.2.8568313** (`sdkmanager "ndk;23.2.8568313"`) and the MuPDF source tarball.

## Build / install / run
```
./gradlew assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease          # R8-minified, debug-signed (private use)
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell mkdir -p /sdcard/QuireTest && adb push some.epub /sdcard/QuireTest/
adb shell am start -n app.quire.eink/.MainActivity -e path /sdcard/QuireTest/some.epub
```
Spike extras: `-e fmt argb|gray` (565 is NOT supported by MuPDF's AndroidDrawDevice), `--ef em 12` (reflow font size, pt),
`-e css "'p{line-height:1.6}'"` (user CSS; note adb shell re-parses the string, so wrap it in single quotes).
Page turns: PAGE_DOWN/UP (`adb shell input keyevent 93` / `92`), volume, DPAD, or tap (left third = back). Logs: `adb logcat -s QuireSpike QuireEpd`.
The device must be awake for `input` to reach the app (the spike sets keep-screen-on/turn-screen-on flags).

## MuPDF
- Version **1.27.1**, Java half = `app/libs/mupdf-fitz-1.27.1.jar` (the `classes.jar` of the official `com.artifex.mupdf:fitz:1.27.1` AAR from maven.ghostscript.com).
- Native half = `app/src/main/jniLibs/armeabi-v7a/libmupdf_java.so`, **built from the 1.27.1 source** (mupdf.com/downloads/archive) with NDK r23c, `APP_PLATFORM=android-17`, see `tools/build-mupdf.bat`.
  The prebuilt Maven AARs are unusable here: every version from 1.20 on is built for API 21 and fails to `dlopen` on Android 4.2
  (`cannot locate symbol "__strrchr_chk"`). 1.19.0 and older load but lack `Context.setUserCSS` and MOBI.
- Capabilities verified on device: PDF, EPUB 2/3 (nav TOC works), FB2, MOBI, AZW3 (opens), CBZ, XPS/images (built in), `Context.setUserCSS`, `Document.layout(w,h,em)`, `loadOutline`.
  Not opened by MuPDF: CBR (RAR), FBZ (zipped FB2): handle outside MuPDF (unzip FBZ, RAR library for CBR) if wanted.

## Layout
- `engine/Doc.java`: open, page count, `layout(em)`, `setUserCss`, `toc()`, `render(n, bitmap, mode)`.
- `eink/Keys.java`: key to page-delta mapping. `eink/Epd.java`: vendor refresh API (reflection, no-op when absent).
- `MainActivity.java`: spike viewer.

## Vendor e-ink API (found in `/system/framework/framework.jar`)
`boolean android.view.View.requestEpdMode(android.view.View$EINK_MODE mode, boolean force)`; modes `EPD_FULL, EPD_PART, EPD_A2, EPD_AUTO, EPD_TEXT, EPD_BLOCK, EPD_BLACK_WHITE, EPD_DIRECT_A2, EPD_DIRECT_PART, EPD_FULL_DITHER, EPD_FULL_WIN, EPD_OED_PART, EPD_NULL, EPD_RESET, EPD_STANDBY, EPD_POWEROFF`.
The mode is stored on the view and applied by ViewRootImpl on the next draw (it sends the dirty rect to SurfaceFlinger). Also `View.requestEpdFullMode(int,int)` (raw SurfaceFlinger transaction 1018).
