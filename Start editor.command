#!/bin/bash
# macOS: double-click this file to start the editor.
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Please install Node.js first: https://nodejs.org"; read -p "Press Enter to close"; exit 1; fi
node serve.mjs
