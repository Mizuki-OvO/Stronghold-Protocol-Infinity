@echo off
chcp 936 >nul
title Check tunnel
cd /d "%~dp0"
if "%~1"=="" (
  echo 用法: 把公网地址作为参数传进来，或者直接把地址粘贴到下面这行。
  echo   检查隧道.bat https://xxxx-yyyy.trycloudflare.com
  echo.
  set /p "URL=请粘贴公网地址: "
) else (
  set "URL=%~1"
)
echo.
"%~dp0node22\node.exe" "%~dp0检查隧道.cjs" "%URL%"
echo.
pause >nul