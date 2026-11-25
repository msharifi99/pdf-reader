; Quire registers as an "Open with" candidate and as a choosable default app. It never
; takes over a file type: no ".ext" default value is written (that is what Tauri's own
; fileAssociations would do), so Windows keeps whatever the user already chose.
;
;   HKCU\Software\Classes\Quire.<ext>                 ProgID: description, icon, open command
;   HKCU\Software\Classes\.<ext>\OpenWithProgids      Quire.<ext>  -> shows in the "Open with" list
;   HKCU\Software\Quire\Capabilities (+ RegisteredApplications)
;                                                     -> listed in Settings > Default apps for the
;                                                        book and comic types (not for images)

!macro QuireProgId EXT DESC
  WriteRegStr SHCTX "Software\Classes\Quire.${EXT}" "" "${DESC}"
  WriteRegStr SHCTX "Software\Classes\Quire.${EXT}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Quire.${EXT}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Quire.${EXT}" ""
!macroend

!macro QuireCapable EXT
  WriteRegStr SHCTX "Software\Quire\Capabilities\FileAssociations" ".${EXT}" "Quire.${EXT}"
!macroend

!macro QuireForget EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Quire.${EXT}"
  DeleteRegKey SHCTX "Software\Classes\Quire.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro QuireProgId "pdf" "PDF document"
  !insertmacro QuireProgId "epub" "EPUB book"
  !insertmacro QuireProgId "mobi" "Mobipocket book"
  !insertmacro QuireProgId "azw3" "Kindle book (AZW3)"
  !insertmacro QuireProgId "azw" "Kindle book (AZW)"
  !insertmacro QuireProgId "fb2" "FictionBook"
  !insertmacro QuireProgId "fbz" "FictionBook archive"
  !insertmacro QuireProgId "cbz" "Comic book archive (CBZ)"
  !insertmacro QuireProgId "cbr" "Comic book archive (CBR)"
  !insertmacro QuireProgId "png" "PNG image"
  !insertmacro QuireProgId "jpg" "JPEG image"
  !insertmacro QuireProgId "jpeg" "JPEG image"
  !insertmacro QuireProgId "webp" "WebP image"
  !insertmacro QuireProgId "avif" "AVIF image"
  !insertmacro QuireProgId "gif" "GIF image"
  !insertmacro QuireProgId "bmp" "Bitmap image"
  !insertmacro QuireProgId "tif" "TIFF image"
  !insertmacro QuireProgId "tiff" "TIFF image"
  !insertmacro QuireProgId "svg" "SVG image"

  WriteRegStr SHCTX "Software\Quire\Capabilities" "ApplicationName" "Quire"
  WriteRegStr SHCTX "Software\Quire\Capabilities" "ApplicationDescription" "A calm reader for books, PDFs and comics"
  !insertmacro QuireCapable "pdf"
  !insertmacro QuireCapable "epub"
  !insertmacro QuireCapable "mobi"
  !insertmacro QuireCapable "azw3"
  !insertmacro QuireCapable "azw"
  !insertmacro QuireCapable "fb2"
  !insertmacro QuireCapable "fbz"
  !insertmacro QuireCapable "cbz"
  !insertmacro QuireCapable "cbr"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Quire" "Software\Quire\Capabilities"

  ; SHCNE_ASSOCCHANGED
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro QuireForget "pdf"
  !insertmacro QuireForget "epub"
  !insertmacro QuireForget "mobi"
  !insertmacro QuireForget "azw3"
  !insertmacro QuireForget "azw"
  !insertmacro QuireForget "fb2"
  !insertmacro QuireForget "fbz"
  !insertmacro QuireForget "cbz"
  !insertmacro QuireForget "cbr"
  !insertmacro QuireForget "png"
  !insertmacro QuireForget "jpg"
  !insertmacro QuireForget "jpeg"
  !insertmacro QuireForget "webp"
  !insertmacro QuireForget "avif"
  !insertmacro QuireForget "gif"
  !insertmacro QuireForget "bmp"
  !insertmacro QuireForget "tif"
  !insertmacro QuireForget "tiff"
  !insertmacro QuireForget "svg"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Quire"
  DeleteRegKey SHCTX "Software\Quire"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
