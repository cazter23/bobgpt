@echo off
rem Starts BobGPT (the built version, which uses much less memory than "npm run dev") and opens it in your browser.
rem Double-click it. It builds the app first if the code has changed, and starts the server in the background
rem (no window). Use stop-bobgpt.bat to stop it.
rem With "startup" after the file name it doesn't open the browser; that is how it runs when you log in.

cd /d "%~dp0"
if "%BOBGPT_PORT%"=="" set BOBGPT_PORT=5173

if not exist node_modules\vite\bin\vite.js (
  echo BobGPT isn't set up yet. Open a terminal in this folder and run:  npm install
  pause
  exit /b 1
)

rem Build when there is no build yet, or when the code is newer than it.
powershell -NoProfile -Command "$built = Get-Item dist\index.html -ErrorAction SilentlyContinue; if (-not $built) { exit 1 }; $newest = Get-ChildItem src, public, index.html, package.json, vite.config.ts -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($newest.LastWriteTime -gt $built.LastWriteTime) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo Building BobGPT...
  call node node_modules\vite\bin\vite.js build >nul
  if errorlevel 1 (
    echo The build failed, so BobGPT wasn't started. Run  npm run build  to see why.
    pause
    exit /b 1
  )
)

rem Start the server, unless something is already answering on the port.
netstat -ano | findstr /R /C:":%BOBGPT_PORT% .*LISTENING" >nul
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'node_modules\vite\bin\vite.js','preview','--port','%BOBGPT_PORT%','--strictPort'"
  for /l %%i in (1,1,20) do (
    netstat -ano | findstr /R /C:":%BOBGPT_PORT% .*LISTENING" >nul
    if not errorlevel 1 goto ready
    ping -n 2 127.0.0.1 >nul
  )
  echo BobGPT's server didn't start.
  pause
  exit /b 1
)

:ready
if /i not "%~1"=="startup" start "" "http://localhost:%BOBGPT_PORT%"
