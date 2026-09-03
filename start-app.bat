@echo off
title ETS Invoice & Payment OCR Server
echo ===================================================
echo     ETS Invoice & Payment OCR - Launcher v.0.1.3
echo ===================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/ (version 18 or higher).
    echo.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist node_modules (
    echo [INFO] First-time setup: Installing required packages...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: Check if .env file exists
if not exist .env (
    if exist .env.example (
        echo [INFO] Creating .env from .env.example...
        copy .env.example .env >nul
        echo [NOTICE] Please make sure to put your GEMINI_API_KEY inside the .env file!
    )
)

echo [INFO] Starting full-stack server (Frontend + Backend OCR) on port 3000...
echo [INFO] Once started, open: http://localhost:3000
echo.

:: Open browser automatically after 2 seconds in the background
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Start the server
call npm run dev
pause
