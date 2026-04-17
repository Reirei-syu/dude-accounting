!include "LogicLib.nsh"
!include "WinMessages.nsh"

!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}

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

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  CreateDirectory "$INSTDIR\resources\installer"
  File /oname=$INSTDIR\resources\installer\update-user-path.ps1 "${BUILD_RESOURCES_DIR}\update-user-path.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\update-user-path.ps1" -Action Add -TargetPath "$INSTDIR"'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装已完成，但未能自动把 CLI 安装目录加入当前用户 PATH。你仍可以直接在安装目录使用 dudeacc.cmd / dude-accounting.cmd。"
  ${EndIf}
  System::Call 'user32::SendMessageTimeout(p ${HWND_BROADCAST}, i ${WM_WININICHANGE}, p 0, t "Environment", i 0, i 5000, *p .r0)'
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\resources\installer\update-user-path.ps1" 0 done
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\update-user-path.ps1" -Action Remove -TargetPath "$INSTDIR"'
    Pop $0
  done:
  System::Call 'user32::SendMessageTimeout(p ${HWND_BROADCAST}, i ${WM_WININICHANGE}, p 0, t "Environment", i 0, i 5000, *p .r0)'
!macroend
