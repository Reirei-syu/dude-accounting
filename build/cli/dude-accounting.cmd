@echo off
setlocal
"%~dp0dude-app.exe" --cli %*
exit /b %ERRORLEVEL%
