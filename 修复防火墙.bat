@echo off
chcp 936 >nul
title Stronghold Protocol - Firewall Setup

net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限，正在请求提权 ... 请在弹窗中点"是"
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo   Stronghold Protocol - 防火墙一键配置
echo ============================================================
echo.

netsh advfirewall firewall delete rule name="Stronghold Protocol" >nul 2>&1
netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=3000 profile=private,domain >nul 2>&1
if errorlevel 1 (
  echo [FAIL] 按端口添加失败
) else (
  echo [OK] 已放行 TCP 3000 ^(专用/域网络^)
)

netsh advfirewall firewall delete rule name="Stronghold Protocol (node22)" >nul 2>&1
netsh advfirewall firewall add rule name="Stronghold Protocol (node22)" dir=in action=allow program="E:\Stronghold-Protocol\node22\node.exe" enable=yes profile=private,domain >nul 2>&1
if errorlevel 1 (
  echo [FAIL] 按程序添加失败
) else (
  echo [OK] 已放行 node22 程序 ^(专用/域网络^)
)

echo.
echo --- 当前规则 ---
netsh advfirewall firewall show rule name="Stronghold Protocol"
echo.
echo ============================================================
echo   完成。现在双击 开服_樱花frp用.bat 启动游戏，
echo   再到樱花frp启动器里启动隧道。
echo ============================================================
echo.
pause