@echo off
setlocal
set "DUDEACC_HOST=%~dp0dudeacc-host.exe"
set "DUDEACC_ARGS=%*"
if not "%~1"=="" goto checkPayloadStdin
"%DUDEACC_HOST%"
exit /b %ERRORLEVEL%

:checkPayloadStdin
echo.%DUDEACC_ARGS% | findstr /C:"--payload-stdin" >nul
if not errorlevel 1 goto payloadStdin
"%DUDEACC_HOST%" %*
exit /b %ERRORLEVEL%

:payloadStdin
powershell -NoProfile -ExecutionPolicy Bypass -Command "$payload = if ([Console]::IsInputRedirected) { [Console]::In.ReadToEnd() } else { '' }; $env:DUDEACC_PAYLOAD_STDIN_JSON = $payload; & $env:DUDEACC_HOST @args; exit $LASTEXITCODE" -- %*
exit /b %ERRORLEVEL%
