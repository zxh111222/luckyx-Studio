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

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用 luckyx. Studio"
  !define MUI_WELCOMEPAGE_TEXT "更简单的本地视频创作。$\r$\n$\r$\n安装启动器，连接已有 ComfyUI 环境。模型保留在原目录，无需重复下载。$\r$\n$\r$\n升级会保留你的设置、任务记录和工作流。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

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
    !insertmacro LuckyxUninstallFunctions
  !macroend

  !macro customUnInit
    StrCpy $LuckyxDeleteData ${BST_UNCHECKED}
  !macroend

  !macro customUnWelcomePage
    !define MUI_UNWELCOMEPAGE_TITLE "卸载 luckyx. Studio"
    !define MUI_UNWELCOMEPAGE_TEXT "卸载启动器，保留你的创作。$\r$\n$\r$\n默认保留设置、历史记录和工作流副本，重新安装后可继续使用。$\r$\n$\r$\n下一页可选择清理本应用记录与缓存。视频、原图、模型和 ComfyUI 环境不会被清理。"
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.LuckyxDataPage un.LuckyxDataLeave
  !macroend

  ; Generate functions only in customHeader, after builder plugin directories are registered.
  !macro LuckyxUninstallFunctions
  Function un.LuckyxDataPage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${Silent}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "保留或清理应用数据" "默认保留，下次安装可以继续使用。"
    nsDialogs::Create 1018
    Pop $LuckyxDataDialog
    ${If} $LuckyxDataDialog == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 4u 100% 34u "卸载只移除启动器。外部模型、ComfyUI、生成视频和原图都会保留。"
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 28u "删除本应用的设置、历史记录、工作流副本及缓存"
    Pop $LuckyxDeleteCheckbox
    ${NSD_SetState} $LuckyxDeleteCheckbox ${BST_UNCHECKED}
    ${NSD_CreateLabel} 0 92u 100% 48u "此项默认不选。勾选后，本应用记录无法恢复。$\r$\n保留视频、原图和已有模型；不会跟随外部目录链接。"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function un.LuckyxDataLeave
    ${NSD_GetState} $LuckyxDeleteCheckbox $LuckyxDeleteData
  FunctionEnd

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



