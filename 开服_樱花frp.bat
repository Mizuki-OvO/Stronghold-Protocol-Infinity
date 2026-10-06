@echo off
chcp 936 >nul
title Stronghold Protocol - via SakuraFrp
cd /d "%~dp0"
"%~dp0node22\node.exe" "%~dp0launcher.mjs" --frp %*
echo.
echo [launcher exited] press any key to close ...
pause >nul
