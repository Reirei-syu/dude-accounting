@echo off
setlocal
"%~dp0dudeacc-host.exe" %*
exit /b %ERRORLEVEL%
