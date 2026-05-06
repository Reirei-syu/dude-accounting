@echo off
setlocal
set "DUDEACC_APP=%~dp0dude-app.exe"
set "DUDEACC_ARGS=%*"
echo.%DUDEACC_ARGS% | findstr /C:"--payload-stdin" >nul
if errorlevel 1 (
  "%DUDEACC_APP%" --cli %*
  exit /b %ERRORLEVEL%
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$payload = if ([Console]::IsInputRedirected) { [Console]::In.ReadToEnd() } else { '' }; $env:DUDEACC_PAYLOAD_STDIN_JSON = $payload; & $env:DUDEACC_APP --cli @args; exit $LASTEXITCODE" -- %*
exit /b %ERRORLEVEL%
