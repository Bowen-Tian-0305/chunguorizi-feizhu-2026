#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
RAW = REPO / "docs/promo-rework/assets/raw"
CLIPS = {
    "breakfast": ("03-breakfast.webm", 1.5, 8.0),
    "manual": ("07-manual.webm", 3.5, 12.5),
    "share": ("09-share.webm", 1.0, 8.0),
}
for name, (source, start, duration) in CLIPS.items():
    target = ROOT / "assets/dynamic" / name
    target.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(start), "-i", str(RAW / source), "-t", str(duration),
        "-vf", "fps=15,scale=1920:1080", "-q:v", "3",
        str(target / "%04d.jpg"),
    ], check=True)
    print(name, len(list(target.glob("*.jpg"))), "frames")
