; Native silver gallery pages. Keep electron-builder's installation engine.
!include "MUI2.nsh"
!define MUI_BGCOLOR "F6F7F8"
!define MUI_TEXTCOLOR "1D2327"
!define MUI_INSTFILESPAGE_COLORS "1D2327 F6F7F8"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.LuckyxGuiInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT LuckyxGuiInit
!endif
!ifdef MUI_HEADERIMAGE
  !undef MUI_HEADERIMAGE
!endif
!ifdef MUI_HEADERIMAGE_RIGHT
  !undef MUI_HEADERIMAGE_RIGHT
!endif
!ifdef MUI_HEADERIMAGE_BITMAP
  !undef MUI_HEADERIMAGE_BITMAP
!endif
!ifdef MUI_WELCOMEFINISHPAGE_BITMAP
  !undef MUI_WELCOMEFINISHPAGE_BITMAP
!endif
!ifdef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!endif
Var LuckyxBodyFont
Var LuckyxTitleFont
Var LuckyxSmallFont
Var LuckyxDialog
Var LuckyxBrandImage
Var LuckyxBrandHandle

!macro LuckyxStyleControl HANDLE
  SendMessage ${HANDLE} ${WM_SETFONT} $LuckyxBodyFont 1
  SetCtlColors ${HANDLE} "1D2327" "F6F7F8"
!macroend
!macro LuckyxTitle TEXT Y
  ${NSD_CreateLabel} 0u ${Y} 100% 25u "${TEXT}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LuckyxTitleFont 1
  SetCtlColors $0 "1D2327" "F6F7F8"
!macroend
!macro LuckyxCopy TEXT Y HEIGHT
  ${NSD_CreateLabel} 0u ${Y} 100% ${HEIGHT} "${TEXT}"
  Pop $0
  !insertmacro LuckyxStyleControl $0
!macroend
!macro LuckyxCaption TEXT Y HEIGHT
  ${NSD_CreateLabel} 0u ${Y} 100% ${HEIGHT} "${TEXT}"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LuckyxSmallFont 1
  SetCtlColors $0 "657079" "F6F7F8"
!macroend
!macro LuckyxBrand
  ${NSD_CreateBitmap} 0u 0u 24u 24u ""
  Pop $LuckyxBrandImage
  ; Resize to the DPI-scaled control rectangle, rather than the bitmap dimensions.
  ${NSD_SetStretchedImage} $LuckyxBrandImage "$PLUGINSDIR\luckyx-logo.bmp" $LuckyxBrandHandle
  ${NSD_CreateLabel} 33u 3u 88% 24u "luckyx. Studio"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $LuckyxTitleFont 1
  SetCtlColors $0 "1D2327" "F6F7F8"
!macroend
!macro LuckyxSharedUiFunctions PREFIX
  Function ${PREFIX}LuckyxGuiInit
    CreateFont $LuckyxBodyFont "Microsoft YaHei UI" 10 400
    CreateFont $LuckyxTitleFont "Microsoft YaHei UI" 16 600
    CreateFont $LuckyxSmallFont "Microsoft YaHei UI" 9 400
    SetCtlColors $HWNDPARENT "1D2327" "F6F7F8"
    InitPluginsDir
    File "/oname=$PLUGINSDIR\luckyx-logo.bmp" "${BUILD_RESOURCES_DIR}\installer-logo.bmp"
  FunctionEnd
  Function ${PREFIX}LuckyxProgressShow
    SetCtlColors $mui.InstFilesPage "1D2327" "F6F7F8"
    SendMessage $mui.InstFilesPage.Text ${WM_SETFONT} $LuckyxBodyFont 1
    SetCtlColors $mui.InstFilesPage.Text "1D2327" "F6F7F8"
    ; The NSIS engine updates this progress bar; no decorative timer.
    SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 0x00B3D857
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0x00ECE8E5
    SendMessage $mui.InstFilesPage.Log ${WM_SETFONT} $LuckyxSmallFont 1
  FunctionEnd
!macroend

!ifndef BUILD_UNINSTALLER
  Var LuckyxDirectoryField
  Var LuckyxLaunchCheckbox
  Var LuckyxLaunchState
  !macroundef MUI_PAGE_DIRECTORY
  !macro MUI_PAGE_DIRECTORY
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !define LUCKYX_DIRECTORY_PRE "${MUI_PAGE_CUSTOMFUNCTION_PRE}"
    !endif
    Page custom LuckyxDirectoryPage LuckyxDirectoryLeave
    !insertmacro MUI_UNSET MUI_PAGE_CUSTOMFUNCTION_PRE
  !macroend
  !macro customWelcomePage
    Page custom LuckyxWelcomePage
  !macroend
  !macro customFinishPage
    Page custom LuckyxFinishPage LuckyxFinishLeave
  !macroend
  !macro customInstallMode
    ; Preserve existing scope; new installations require no admin access.
    ${If} $hasPerMachineInstallation == "1"
    ${AndIf} $hasPerUserInstallation == "0"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !macroend
  !macro customPageAfterChangeDir
    !define MUI_PAGE_HEADER_TEXT "luckyx. Studio"
    !define MUI_PAGE_HEADER_SUBTEXT "正在安装应用，请稍候。"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW LuckyxProgressShow
  !macroend
  !macro customHeader
    !insertmacro LuckyxSharedUiFunctions ""
    !insertmacro LuckyxInstallerUiFunctions
  !macroend
  !macro LuckyxInstallerUiFunctions
  Function LuckyxWelcomePage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "安装应用" "连接你的本地创作空间"
    nsDialogs::Create 1018
    Pop $LuckyxDialog
    ${If} $LuckyxDialog == error
      Abort
    ${EndIf}
    SetCtlColors $LuckyxDialog "1D2327" "F6F7F8"
    !insertmacro LuckyxBrand
    !insertmacro LuckyxTitle "灵感，在这里开始。" 38u
    !insertmacro LuckyxCopy "安装视频工作流启动器，开始你的本地创作。" 69u 20u
    !insertmacro LuckyxCopy "简洁的工作台 · 自由导入工作流 · 管理每一次创作" 96u 22u
    !insertmacro LuckyxCaption "升级保留设置、历史记录与工作流。$\r$\nComfyUI 与模型将在应用内按设备配置准备。" 128u 32u
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:继续"
    nsDialogs::Show
  FunctionEnd
  Function LuckyxDirectoryPage
    !ifdef LUCKYX_DIRECTORY_PRE
      Call "${LUCKYX_DIRECTORY_PRE}"
    !endif
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "安装位置" "为 luckyx. Studio 选择一个位置"
    nsDialogs::Create 1018
    Pop $LuckyxDialog
    ${If} $LuckyxDialog == error
      Abort
    ${EndIf}
    SetCtlColors $LuckyxDialog "1D2327" "F6F7F8"
    !insertmacro LuckyxTitle "为创作，留一个位置。" 0u
    !insertmacro LuckyxCaption "这里只安装启动器。模型与作品目录可稍后在应用内选择。" 35u 32u
    !insertmacro LuckyxCopy "应用安装目录" 75u 18u
    ${NSD_CreateDirRequest} 0u 99u 77% 22u "$INSTDIR"
    Pop $LuckyxDirectoryField
    SendMessage $LuckyxDirectoryField ${WM_SETFONT} $LuckyxBodyFont 1
    ${NSD_CreateBrowseButton} 81% 99u 19% 22u "浏览…"
    Pop $0
    SendMessage $0 ${WM_SETFONT} $LuckyxBodyFont 1
    ${NSD_OnClick} $0 LuckyxBrowseDirectory
    !insertmacro LuckyxCaption "更新替换程序文件，保留你的设置和创作记录。" 134u 25u
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:安装"
    nsDialogs::Show
  FunctionEnd
  Function LuckyxBrowseDirectory
    Pop $0
    ${NSD_GetText} $LuckyxDirectoryField $0
    nsDialogs::SelectFolderDialog "选择应用安装目录" "$0"
    Pop $0
    ${If} $0 != error
      ${NSD_SetText} $LuckyxDirectoryField "$0"
    ${EndIf}
  FunctionEnd
  Function LuckyxDirectoryLeave
    ${NSD_GetText} $LuckyxDirectoryField $INSTDIR
    ${If} $INSTDIR == ""
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择应用安装目录。"
      Abort
    ${EndIf}
    System::Call 'shlwapi::PathIsRelativeW(w "$INSTDIR") i .r0'
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择完整的本地安装路径。"
      Abort
    ${EndIf}
    ; Builder's instFilesPre still adds the app-name folder when necessary.
  FunctionEnd
  Function LuckyxFinishPage
    !insertmacro MUI_HEADER_TEXT "安装完成" "创作，从一个灵感开始"
    nsDialogs::Create 1018
    Pop $LuckyxDialog
    ${If} $LuckyxDialog == error
      Abort
    ${EndIf}
    SetCtlColors $LuckyxDialog "1D2327" "F6F7F8"
    !insertmacro LuckyxBrand
    IfAbort luckyx_install_failed
    !insertmacro LuckyxTitle "准备好，开始创作。" 38u
    !insertmacro LuckyxCopy "luckyx. Studio 已安装完成。" 69u 20u
    !insertmacro LuckyxCaption "首次打开可按电脑配置准备环境，$\r$\n也可以连接已有的 ComfyUI。" 98u 32u
    !ifndef HIDE_RUN_AFTER_FINISH
      ${NSD_CreateCheckbox} 0u 141u 100% 20u "现在打开 luckyx. Studio"
      Pop $LuckyxLaunchCheckbox
      !insertmacro LuckyxStyleControl $LuckyxLaunchCheckbox
      ${NSD_SetState} $LuckyxLaunchCheckbox ${BST_CHECKED}
    !endif
    Goto luckyx_install_finish_controls
    luckyx_install_failed:
      !insertmacro LuckyxTitle "安装尚未完成。" 38u
      !insertmacro LuckyxCopy "请查看安装错误，处理后再尝试。" 69u 30u
      StrCpy $LuckyxLaunchCheckbox ""
    luckyx_install_finish_controls:
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
      GetDlgItem $0 $HWNDPARENT 3
      EnableWindow $0 0
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_HIDE}
      nsDialogs::Show
  FunctionEnd
  Function LuckyxFinishLeave
    !ifndef HIDE_RUN_AFTER_FINISH
      ${If} $LuckyxLaunchCheckbox != ""
        ${NSD_GetState} $LuckyxLaunchCheckbox $LuckyxLaunchState
        ${If} $LuckyxLaunchState == ${BST_CHECKED}
          ${If} ${isUpdated}
            StrCpy $1 "--updated"
          ${Else}
            StrCpy $1 ""
          ${EndIf}
          ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
        ${EndIf}
      ${EndIf}
    !endif
  FunctionEnd
  !macroend
!else
  !macroundef MUI_UNPAGE_INSTFILES
  !macro MUI_UNPAGE_INSTFILES
    !define MUI_PAGE_HEADER_TEXT "luckyx. Studio"
    !define MUI_PAGE_HEADER_SUBTEXT "正在卸载应用，请稍候。"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.LuckyxProgressShow
    !insertmacro MUI_UNPAGE_INIT
    !insertmacro MUI_PAGEDECLARATION_INSTFILES
  !macroend
  !macroundef MUI_UNPAGE_FINISH
  !macro MUI_UNPAGE_FINISH
    UninstPage custom un.LuckyxFinishPage
  !macroend
  !macro customUnWelcomePage
    UninstPage custom un.LuckyxDataPage un.LuckyxDataLeave
  !macroend
  !macro LuckyxUninstallUiFunctions
  Function un.LuckyxDataPage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${Silent}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "卸载应用" "默认保留你的创作记录"
    nsDialogs::Create 1018
    Pop $LuckyxDataDialog
    ${If} $LuckyxDataDialog == error
      Abort
    ${EndIf}
    SetCtlColors $LuckyxDataDialog "1D2327" "F6F7F8"
    !insertmacro LuckyxTitle "暂别，创作依然在。" 0u
    !insertmacro LuckyxCaption "卸载启动器，默认保留设置、历史记录和工作流副本。$\r$\n重新安装后，可以继续使用这些记录。" 35u 36u
    ${NSD_CreateCheckbox} 0u 83u 100% 28u "同时删除设置、历史记录、工作流副本和应用缓存"
    Pop $LuckyxDeleteCheckbox
    !insertmacro LuckyxStyleControl $LuckyxDeleteCheckbox
    ${NSD_SetState} $LuckyxDeleteCheckbox ${BST_UNCHECKED}
    !insertmacro LuckyxCaption "勾选后，应用记录无法恢复。$\r$\n视频、原图、模型、下载缓存与 ComfyUI 环境始终保留。" 125u 34u
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:卸载"
    nsDialogs::Show
  FunctionEnd
  Function un.LuckyxDataLeave
    ${NSD_GetState} $LuckyxDeleteCheckbox $LuckyxDeleteData
  FunctionEnd
  Function un.LuckyxFinishPage
    !insertmacro MUI_HEADER_TEXT "卸载完成" "感谢使用 luckyx. Studio"
    nsDialogs::Create 1018
    Pop $LuckyxDialog
    ${If} $LuckyxDialog == error
      Abort
    ${EndIf}
    SetCtlColors $LuckyxDialog "1D2327" "F6F7F8"
    !insertmacro LuckyxBrand
    IfAbort luckyx_uninstall_failed
    !insertmacro LuckyxTitle "创作，下次再见。" 38u
    !insertmacro LuckyxCopy "luckyx. Studio 已从电脑移除。" 70u 20u
    ${If} $LuckyxDeleteData == ${BST_CHECKED}
      !insertmacro LuckyxCaption "已按选择清理应用记录与缓存。$\r$\n视频、素材、模型与 ComfyUI 环境保留。" 106u 40u
    ${Else}
      !insertmacro LuckyxCaption "设置、历史记录和工作流副本保留。$\r$\n重新安装后，继续你的创作。" 106u 40u
    ${EndIf}
    Goto luckyx_uninstall_finish_controls
    luckyx_uninstall_failed:
      !insertmacro LuckyxTitle "卸载尚未完成。" 38u
      !insertmacro LuckyxCopy "请查看卸载错误，处理后再尝试。" 70u 30u
    luckyx_uninstall_finish_controls:
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
      GetDlgItem $0 $HWNDPARENT 3
      EnableWindow $0 0
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_HIDE}
      nsDialogs::Show
  FunctionEnd
  !macroend
!endif
