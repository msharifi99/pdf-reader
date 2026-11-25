@echo off
rem Rebuilds app\src\main\jniLibs\armeabi-v7a\libmupdf_java.so from MuPDF source with NDK r23c (last NDK that targets API 17).
rem Usage: tools\build-mupdf.bat C:\path\to\mupdf-1.27.1-source
rem Notes learned the hard way:
rem  - Keep the source and output under a SHORT path (e.g. C:\mq); ndk-build mirrors absolute source paths into obj\ and exceeds MAX_PATH.
rem  - Run with Git's sh NOT on PATH (make then uses cmd.exe, which the NDK's make expects), hence the PATH override below.
rem  - The matching Java half is app\libs\mupdf-fitz-<ver>.jar = classes.jar from the com.artifex.mupdf:fitz:<ver> AAR on maven.ghostscript.com.
setlocal
set SRC=%~1
if "%SRC%"=="" (echo usage: build-mupdf.bat MUPDF_SOURCE_DIR & exit /b 1)
set NDK=%LOCALAPPDATA%\Android\Sdk\ndk\23.2.8568313
set PATH=%SystemRoot%\system32;%SystemRoot%
cd /d "%SRC%"
"%NDK%\prebuilt\windows-x86_64\bin\make.exe" -f "%NDK%\build\core\build-local.mk" -j8 APP_BUILD_SCRIPT=platform/java/Android.mk NDK_PROJECT_PATH=null NDK_OUT=C:/mq/out/obj NDK_LIBS_OUT=C:/mq/out/libs APP_ABI=armeabi-v7a APP_PLATFORM=android-17 APP_OPTIM=release
echo Result: C:\mq\out\libs\armeabi-v7a\libmupdf_java.so  -^> copy to app\src\main\jniLibs\armeabi-v7a\
