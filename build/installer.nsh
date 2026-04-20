!include "LogicLib.nsh"

Var PreviousInstallDir

!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}

  StrCpy $PreviousInstallDir $0

  ${If} $0 == ""
    SetRegView 64
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\${APP_FILENAME}"
    SetRegView 32
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\${APP_FILENAME}"
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  SetOutPath "$PLUGINSDIR"
  File /oname=$PLUGINSDIR\update-user-path.ps1 "${BUILD_RESOURCES_DIR}\update-user-path.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action Add -InstallDir "$INSTDIR" -OldInstallDir "$PreviousInstallDir"' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装已完成，但更新当前用户 PATH 失败。请手动把安装目录加入 PATH 后再直接使用 dudeacc / dude-accounting。"
  ${EndIf}
!macroend

!macro customUnInstall
  SetOutPath "$PLUGINSDIR"
  File /oname=$PLUGINSDIR\update-user-path.ps1 "${BUILD_RESOURCES_DIR}\update-user-path.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action Remove -InstallDir "$INSTDIR"' $0
!macroend

!macro blockProtectedInstallDir protectedDir
  ${If} "${protectedDir}" != ""
    StrLen $1 "${protectedDir}"
    StrCpy $2 $0 $1
    ${If} $2 == "${protectedDir}"
      MessageBox MB_OK|MB_ICONSTOP "当前安装路径位于受保护目录：${protectedDir}$\r$\n$\r$\n请安装到当前用户可写目录，例如：$LOCALAPPDATA\${APP_FILENAME}"
      Abort
    ${EndIf}
  ${EndIf}
!macroend

Function .onVerifyInstDir
  Push $0
  Push $1
  Push $2

  StrCpy $0 $INSTDIR

  !insertmacro blockProtectedInstallDir "$PROGRAMFILES"
  !insertmacro blockProtectedInstallDir "$PROGRAMFILES32"
  !insertmacro blockProtectedInstallDir "$PROGRAMFILES64"
  !insertmacro blockProtectedInstallDir "$COMMONFILES"
  !insertmacro blockProtectedInstallDir "$COMMONFILES32"
  !insertmacro blockProtectedInstallDir "$COMMONFILES64"
  !insertmacro blockProtectedInstallDir "$WINDIR"

  Pop $2
  Pop $1
  Pop $0
FunctionEnd
