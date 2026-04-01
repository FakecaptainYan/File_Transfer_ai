!include "LogicLib.nsh"

!macro customInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=$PLUGINSDIR\cleanup-old-install.ps1 "${BUILD_RESOURCES_DIR}\cleanup-old-install.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-old-install.ps1" -ProductName "${PRODUCT_NAME}" -InstallDirName "${APP_PACKAGE_NAME}" -AppExecutableName "${APP_EXECUTABLE_FILENAME}"' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "${PRODUCT_NAME} could not clean a previous installation automatically. Please uninstall the old version manually and run this installer again."
    Abort
  ${EndIf}
!macroend
