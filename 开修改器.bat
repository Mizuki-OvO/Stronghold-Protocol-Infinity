@echo off
chcp 65001 >nul
title 卫戍协议 - 本地服 + 数值修改器
cd /d "%~dp0"

rem 找 Node：优先项目自带的 node22，其次系统 node
set NODE=node
if exist "E:\Stronghold-Protocol\node22\node.exe" set NODE=E:\Stronghold-Protocol\node22\node.exe
if exist "%~dp0node22\node.exe" set NODE=%~dp0node22\node.exe

echo.
echo ========================================================================
echo   正在启动：游戏服 (端口 3100) + 数值修改器面板 (端口 3101)
echo ========================================================================
echo.
echo   面板会自己打开浏览器；游戏在 http://localhost:3100
echo   改完数值后，回到游戏里创建一个房间开局即可。
echo.
echo   关掉这个窗口 = 停止服务器（覆盖会存进 dev-overrides.json）。
echo ========================================================================
echo.

"%NODE%" dev-launch.mjs
if errorlevel 1 (
  echo.
  echo   [启动失败] 上面是错误信息。
  echo   常见原因：Node 版本太旧（需要 20+）。项目自带的 node22 在 E:\Stronghold-Protocol\node22\node.exe
  echo.
)
pause
