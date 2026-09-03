#!/bin/bash
set -e

echo "==================================================="
echo "    ETS Invoice & Payment OCR - Launcher v.0.1.5"
echo "==================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not found on your system!"
    echo "Please install Node.js from https://nodejs.org/ (version 18 or higher)."
    exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] First-time setup: Installing required packages..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "[INFO] Creating .env from .env.example..."
    cp .env.example .env
    echo "[NOTICE] Please make sure to put your GEMINI_API_KEY inside the .env file!"
fi

echo "[INFO] Starting full-stack server on http://localhost:3000..."

# Try to open browser
(sleep 2 && (xdg-open http://localhost:3000 || open http://localhost:3000 || true)) &

npm run dev
