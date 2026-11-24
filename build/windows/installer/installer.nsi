# D-PKG-002 - real NSIS installer + thorough uninstaller for amazingwhats (Wails v3).
#
# Build from the repository root (see build/windows/Taskfile.yml:package:installer):
#   makensis /DAPP_EXE=..\..\..\bin\amazingwhats.exe build/windows/installer/installer.nsi
#
# NSIS sets its compiler working directory to the folder of this script, so all
# relative paths below are relative to build/windows/installer/:
#   ..\icon.ico           -> build/windows/icon.ico
#   ..\..\..\LICENSE      -> <repo root>/LICENSE          (real AGPL-3.0 text)
#   ..\..\..\bin\...      -> <repo root>/bin/amazingwhats.exe
#   ..\..\..\bin\...      -> <repo root>/bin/amazingwhats-setup.exe (output)

Unicode true

!include "MUI.nsh"
!include "Sections.nsh"
!include "FileFunc.nsh"

# ---------------------------------------------------------------------------
# Product identity. No fabricated data: values match wails.json (publisher,
# version) and the Go binary name; the exe default matches `go build -o`.
# ---------------------------------------------------------------------------
!define PRODUCT_NAME      "amazingwhats"
!define PUBLISHER         "lugvitc"
!define VERSION           "1.0.0"
!define APP_DIR_NAME      "amazingwhats"     # $LOCALAPPDATA\Programs\amazingwhats
!define APP_DATA_DIR      "amazingwhats"     # %APPDATA%\amazingwhats + %LOCALAPPDATA%\amazingwhats
!define APP_EXE_NAME      "amazingwhats.exe" # built binary name

# Compile-time input: path to the built exe. Overridable with
#   makensis /DAPP_EXE=<path> ...
# The default resolves to <repo root>/bin/amazingwhats.exe.
!ifndef APP_EXE
  !define APP_EXE "..\..\..\bin\amazingwhats.exe"
!endif

# Standard per-user Add/Remove Programs key (no custom/vendor registry keys).
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

# Per-user install: no UAC prompt, no Program Files write.
RequestExecutionLevel user

VIProductVersion "${VERSION}.0"
VIFileVersion    "${VERSION}.0"
VIAddVersionKey "ProductName"     "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName"     "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "LegalCopyright"  "Copyright (c) lugvitc. Licensed under AGPL-3.0."

ManifestDPIAware true
SetCompressor /SOLID lzma

Name "${PRODUCT_NAME}"
OutFile "..\..\..\bin\amazingwhats-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_DIR_NAME}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
ShowInstDetails show
ShowUninstDetails show

# ---------------------------------------------------------------------------
# UI: AGPL-3.0 license text comes from the real repository-root LICENSE file.
# ---------------------------------------------------------------------------
!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Close amazingwhats before uninstalling. All application data and cache will be permanently deleted."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

# ---------------------------------------------------------------------------
# Install: core application (always) + optional desktop shortcut.
# ---------------------------------------------------------------------------
Section "!${PRODUCT_NAME} (required)" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  DetailPrint "Installing ${PRODUCT_NAME} ${VERSION} to $INSTDIR"

  # The production binary, built by `wails3 task build` / `wails3 task package`.
  File "/oname=${APP_EXE_NAME}" "${APP_EXE}"

  # AGPL-3.0 obligation: ship the actual license text with the binary.
  File "/oname=LICENSE" "..\..\..\LICENSE"

  # Start Menu folder + shortcut (per-user because of SetShellVarContext).
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" \
      "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0
  DetailPrint "Start Menu shortcut: $SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"

  # Add/Remove Programs entry under HKCU (per-user, no admin rights needed).
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$\"$INSTDIR\${APP_EXE_NAME},0$\""
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  DetailPrint "Installed executable: $INSTDIR\${APP_EXE_NAME}"
  DetailPrint "AGPL-3.0 license: $INSTDIR\LICENSE"
SectionEnd

Section /o "Desktop shortcut" SEC_DESKTOP
  SetShellVarContext current
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" \
      "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0
  DetailPrint "Desktop shortcut: $DESKTOP\${PRODUCT_NAME}.lnk"
SectionEnd

Function .onInit
  SetShellVarContext current
  # Core install is mandatory; the user may only toggle the desktop shortcut.
  IntOp $0 ${SF_SELECTED} | ${SF_RO}
  SectionSetFlags ${SEC_MAIN} $0
FunctionEnd

# ---------------------------------------------------------------------------
# Uninstall: shortcuts, ARP key, install dir, and ALL app data/cache.
# Verified footprint (from source):
#   %APPDATA%\amazingwhats       settings.json, custom.css, custom.js,
#                               app_settings.json, messages.db, app.db,
#                               session.wa (+ SQLite -wal/-shm sidecars)
#   %LOCALAPPDATA%\amazingwhats  images\, idxdb (+ SQLite -wal/-shm sidecars)
# RMDIR /r removes the whole trees, so no DB or session can be left behind.
# ---------------------------------------------------------------------------
Function un.onInit
  SetShellVarContext current
  IfSilent un_skip_warning 0
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "Close amazingwhats before uninstalling.$\r$\n$\r$\nUninstalling ${PRODUCT_NAME} will permanently delete all application data and cache, including your session (session.wa) and message databases (messages.db, app.db). Continue?" \
      IDYES un_skip_warning
    Abort
  un_skip_warning:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  DetailPrint "Uninstalling ${PRODUCT_NAME} ${VERSION}"

  DetailPrint "Removing Start Menu shortcut: $SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete /REBOOTOK "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir /REBOOTOK "$SMPROGRAMS\${PRODUCT_NAME}"

  DetailPrint "Removing desktop shortcut: $DESKTOP\${PRODUCT_NAME}.lnk"
  Delete /REBOOTOK "$DESKTOP\${PRODUCT_NAME}.lnk"

  DetailPrint "Removing Add/Remove Programs entry: HKCU\${UNINST_KEY}"
  DeleteRegKey HKCU "${UNINST_KEY}"

  DetailPrint "Removing install directory: $INSTDIR"
  RMDIR /r /REBOOTOK "$INSTDIR"

  DetailPrint "Removing app data: $APPDATA\${APP_DATA_DIR}"
  DetailPrint "  (settings.json, custom.css, custom.js, app_settings.json, messages.db, app.db, session.wa + SQLite sidecars)"
  RMDIR /r /REBOOTOK "$APPDATA\${APP_DATA_DIR}"

  DetailPrint "Removing app cache: $LOCALAPPDATA\${APP_DATA_DIR}"
  DetailPrint "  (images\ and idxdb + SQLite sidecars)"
  RMDIR /r /REBOOTOK "$LOCALAPPDATA\${APP_DATA_DIR}"

  DetailPrint "Uninstall complete."
SectionEnd
