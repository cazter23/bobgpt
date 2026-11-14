@echo off
rem Stops BobGPT's background server (the one start-bobgpt.bat starts), for example to free its memory,
rem or to run "npm run dev" on the same address. Only a Node program listening on BobGPT's port is stopped.

if "%BOBGPT_PORT%"=="" set BOBGPT_PORT=5173

powershell -NoProfile -Command "$found = $false; Get-NetTCPConnection -LocalPort %BOBGPT_PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force; $found = $true } }; if ($found) { 'BobGPT stopped.' } else { 'BobGPT was not running.' }"
ping -n 3 127.0.0.1 >nul
