#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm install
node capture.mjs
node render-3d.mjs
python3 make_audio.py
python3 build.py
python3 verify.py
