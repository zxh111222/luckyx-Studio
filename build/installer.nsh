; luckyx. Studio NSIS policy: upgrades and silent uninstall always preserve user data.
; Only the visible unchecked checkbox can request removal of app-owned records/cache.
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; electron-builder's installer otherwise forwards --delete-app-data to the old uninstaller.
; Keep the other generated flag predicates unchanged, and always forward --updated.
!ifdef isDeleteAppData
  !undef isDeleteAppData
!endif
!define isDeleteAppData `"" LuckyxNeverDeleteCli ""`
!macro _LuckyxNeverDeleteCli _a _b _t _f
  Goto `${_f}`
!macroend

!include "installer-ui.nsh"

!ifdef BUILD_UNINSTALLER
  Var LuckyxDeleteData
  Var LuckyxDataDialog
  Var LuckyxDeleteCheckbox

  ; The builder's built-in unconditional data deletion is disabled, including its CLI path.
  !ifdef DELETE_APP_DATA_ON_UNINSTALL
    !undef DELETE_APP_DATA_ON_UNINSTALL
  !endif
  !macro LuckyxGetOptions PARAMETERS OPTION RESULT
    !if "${OPTION}" == "--delete-app-data"
      StrCpy ${RESULT} ""
      SetErrors
    !else
      !insertmacro GetOptionsCall "${PARAMETERS}" "${OPTION}" ${RESULT}
    !endif
  !macroend
  !macro customHeader
    !undef GetOptions
    !define GetOptions "!insertmacro LuckyxGetOptions"
    !insertmacro LuckyxSharedUiFunctions "un."
    !insertmacro LuckyxUninstallUiFunctions
    !insertmacro LuckyxUninstallFunctions
  !macroend

  !macro customUnInit
    StrCpy $LuckyxDeleteData ${BST_UNCHECKED}
  !macroend

  ; Generate functions only in customHeader, after builder plugin directories are registered.
  !macro LuckyxUninstallFunctions
  ; Called ONLY for the fixed cache subdirectories listed below. Skip every reparse point.
  ; Never use RMDir /r: directory junctions must not lead cleanup outside the app cache.
  Function un.LuckyxRemoveCacheTree
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4
    System::Call 'kernel32::GetFileAttributesW(w "$0") i .r4'
    IntCmp $4 -1 luckyx_cache_done
    IntOp $4 $4 & 0x400
    IntCmp $4 0 luckyx_cache_scan luckyx_cache_done luckyx_cache_done
    luckyx_cache_scan:
      ClearErrors
      FindFirst $1 $2 "$0\*"
      IfErrors luckyx_cache_done
    luckyx_cache_loop:
      StrCmp $2 "" luckyx_cache_finish
      StrCmp $2 "." luckyx_cache_next
      StrCmp $2 ".." luckyx_cache_next
      System::Call 'kernel32::GetFileAttributesW(w "$0\$2") i .r3'
      IntOp $4 $3 & 0x400
      IntCmp $4 0 luckyx_cache_classify luckyx_cache_next luckyx_cache_next
    luckyx_cache_classify:
      IntOp $4 $3 & 0x10
      IntCmp $4 0 luckyx_cache_file luckyx_cache_dir luckyx_cache_dir
    luckyx_cache_dir:
      Push "$0\$2"
      Call un.LuckyxRemoveCacheTree
      Goto luckyx_cache_next
    luckyx_cache_file:
      Delete "$0\$2"
    luckyx_cache_next:
      FindNext $1 $2
      Goto luckyx_cache_loop
    luckyx_cache_finish:
      FindClose $1
      RMDir "$0"
    luckyx_cache_done:
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
  FunctionEnd

  !macroend

  !macro LuckyxClearCache NAME
    Push "$APPDATA\luckyx-studio\${NAME}"
    Call un.LuckyxRemoveCacheTree
  !macroend

  !macro customUnInstall
    ${If} ${isUpdated}
      StrCpy $LuckyxDeleteData ${BST_UNCHECKED}
    ${ElseIf} ${Silent}
      StrCpy $LuckyxDeleteData ${BST_UNCHECKED}
    ${ElseIf} $LuckyxDeleteData == ${BST_CHECKED}
      SetShellVarContext current
      ; Reject a redirected userData directory before touching any app-owned file.
      System::Call 'kernel32::GetFileAttributesW(w "$APPDATA\luckyx-studio") i .r0'
      IntOp $0 $0 & 0x400
      ${If} $0 == 0
        System::Call 'kernel32::GetFileAttributesW(w "$APPDATA\luckyx-studio\studio") i .r0'
        IntOp $0 $0 & 0x400
        ${If} $0 == 0
          Delete "$APPDATA\luckyx-studio\studio\studio.sqlite"
          Delete "$APPDATA\luckyx-studio\studio\studio.sqlite.tmp"
          Delete "$APPDATA\luckyx-studio\studio\studio.sqlite-wal"
          Delete "$APPDATA\luckyx-studio\studio\studio.sqlite-shm"
          Delete "$APPDATA\luckyx-studio\studio\close-preferences.json"
          Delete "$APPDATA\luckyx-studio\studio\close-preferences.json.tmp"
          Delete "$APPDATA\luckyx-studio\studio\bootstrap-progress.json"
        ${EndIf}
        Delete "$APPDATA\luckyx-studio\Preferences"
        Delete "$APPDATA\luckyx-studio\Local State"
        !insertmacro LuckyxClearCache "Cache"
        !insertmacro LuckyxClearCache "Code Cache"
        !insertmacro LuckyxClearCache "GPUCache"
        !insertmacro LuckyxClearCache "DawnCache"
        !insertmacro LuckyxClearCache "DawnWebGPUCache"
        !insertmacro LuckyxClearCache "Session Storage"
        !insertmacro LuckyxClearCache "Local Storage"
        !insertmacro LuckyxClearCache "IndexedDB"
        !insertmacro LuckyxClearCache "blob_storage"
        !insertmacro LuckyxClearCache "Network"
        !insertmacro LuckyxClearCache "Partitions"
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif

!macro customInstall
  ; Use a dedicated icon path so old executable icon caches cannot replace the brand.
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\app-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\app-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\resources\app-icon.ico"
!macroend



