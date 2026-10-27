#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm install
python3 prepare_assets.py
python3 make_audio.py
node render.mjs --stills
node render.mjs --output ../picture-draft.mp4
ffmpeg -y -hide_banner -loglevel error -i ../picture-draft.mp4 -i ../assets/audio/mix.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart '../纯过日子-72秒3D宣传片.mp4'
node render.mjs --end 8 --output ../opening-picture.mp4
ffmpeg -y -hide_banner -loglevel error -i ../opening-picture.mp4 -i ../assets/audio/mix.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -t 8 -movflags +faststart ../opening-3d-8s.mp4
rm ../opening-picture.mp4
python3 make_cover.py
python3 verify.py
