#!/usr/bin/env python3
"""Final original 72-second, 100 BPM score and seven synthesized UI sounds."""

from __future__ import annotations

import json
import math
import wave
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48_000
DURATION = 72.0
BEAT = 0.6
BAR = 2.4
N = int(SR * DURATION)
RNG = np.random.default_rng(20261027)
OUT = Path(__file__).resolve().parents[1] / "assets" / "audio"


def midi(note: float) -> float:
    return 440.0 * 2.0 ** ((note - 69.0) / 12.0)


def pan_gains(pan: float) -> tuple[float, float]:
    angle = (pan + 1.0) * math.pi / 4.0
    return math.cos(angle), math.sin(angle)


def envelope(length: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(length)
    a = min(length, int(attack * SR))
    r = min(length, int(release * SR))
    if a:
        env[:a] = np.sin(np.linspace(0, math.pi / 2, a)) ** 2
    if r:
        env[-r:] *= np.cos(np.linspace(0, math.pi / 2, r)) ** 2
    return env


def add(track: np.ndarray, start: float, sound: np.ndarray, gain: float = 1.0,
        pan: float = 0.0) -> None:
    first = int(round(start * SR))
    if first >= N or first + len(sound) <= 0:
        return
    source_start = max(0, -first)
    first = max(0, first)
    count = min(len(sound) - source_start, N - first)
    left, right = pan_gains(pan)
    stereo = sound[source_start:source_start + count, None]
    track[first:first + count, 0] += gain * left * stereo[:, 0]
    track[first:first + count, 1] += gain * right * stereo[:, 0]


def pluck(note: float, duration: float = 1.1) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    f = midi(note)
    body = np.zeros_like(t)
    for harmonic, level in [(1, 1.0), (2, 0.38), (3, 0.19), (4, 0.08), (6, 0.035)]:
        body += level * np.sin(2 * np.pi * f * harmonic * t) * np.exp(
            -t * (3.3 + harmonic * 1.35))
    body *= (1.0 - np.exp(-t * 850.0))
    pick = RNG.normal(0, 1, len(t))
    pick = signal.lfilter([1, -0.82], [1], pick) * np.exp(-t * 95) * 0.055
    return (body + pick) * envelope(len(t), 0.002, 0.08) * 0.42


def bell(note: float, duration: float = 2.5) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    f = midi(note)
    sound = np.zeros_like(t)
    for ratio, level, decay in [(1, 1, 1.8), (2.01, 0.28, 3.2),
                                (3.98, 0.12, 4.8), (6.12, 0.035, 7.0)]:
        sound += level * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * decay)
    return sound * (1 - np.exp(-t * 1100)) * envelope(len(t), 0.003, 0.2) * 0.24


def pad_note(note: float, duration: float, phase: float) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    f = midi(note)
    vibrato = 0.0015 * np.sin(2 * np.pi * 0.23 * t + phase)
    tone = np.zeros_like(t)
    for detune, level in [(-0.0025, 0.42), (0, 0.62), (0.0025, 0.42)]:
        instant_f = f * (1 + detune + vibrato)
        angle = 2 * np.pi * np.cumsum(instant_f) / SR + phase
        tone += level * (np.sin(angle) + 0.12 * np.sin(2 * angle))
    return tone * envelope(len(t), 0.32, 0.5) * 0.12


def bass(note: float, duration: float = 1.3) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    f = midi(note)
    env = (1 - np.exp(-t * 75)) * np.exp(-t * 2.0)
    env *= envelope(len(t), 0.008, 0.16)
    return (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t)) * env * 0.46


def kick() -> np.ndarray:
    t = np.arange(int(0.48 * SR)) / SR
    phase = 2 * np.pi * (47 * t + 63 * (1 - np.exp(-t * 25)) / 25)
    return (np.sin(phase) * np.exp(-t * 10) + 0.025 * RNG.normal(size=len(t)) * np.exp(-t * 150)) * 0.56


def rim() -> np.ndarray:
    t = np.arange(int(0.24 * SR)) / SR
    noise = signal.sosfilt(signal.butter(2, [900, 7200], btype="bandpass", fs=SR, output="sos"),
                           RNG.normal(size=len(t)))
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 32)
    return (0.2 * noise * np.exp(-t * 24) + 0.22 * body) * envelope(len(t), 0.001, 0.05)


def shaker(accent: bool = False) -> np.ndarray:
    t = np.arange(int(0.15 * SR)) / SR
    noise = signal.sosfilt(signal.butter(2, [5200, 12500], btype="bandpass", fs=SR, output="sos"),
                           RNG.normal(size=len(t)))
    env = (1 - np.exp(-t * 900)) * np.exp(-t * (34 if accent else 46))
    return noise * env * (0.105 if accent else 0.067)


CHORDS = [
    ([50, 57, 61, 64, 66], 38),   # Dmaj9
    ([47, 54, 57, 61, 64], 35),   # Bm9
    ([43, 50, 54, 57, 59], 31),   # Gmaj9
    ([45, 52, 57, 61, 64], 33),   # Aadd9
]
MELODY = [
    [(0, 74), (1.5, 78), (2.5, 81)],
    [(0.5, 78), (1.5, 76), (3, 74)],
    [(0, 71), (1, 74), (2, 78), (3.25, 76)],
    [(0.5, 73), (1.5, 76), (2.5, 78)],
]


def intensity(bar: int) -> float:
    """Thirty bars, with dynamics aligned to the ten picture scenes."""
    if bar < 3:
        return [0.38, 0.5, 0.62][bar]
    if bar < 6:
        return [0.72, 0.8, 0.88][bar - 3]
    if bar < 9:
        return 0.76
    if bar < 12:
        return 0.9
    if bar < 15:
        return 0.98
    if bar < 19:
        return [1.06, 1.1, 1.14, 1.18][bar - 15]
    if bar < 23:
        return 1.22
    if bar < 25:
        return 0.88
    if bar < 28:
        return [0.94, 0.82, 0.7][bar - 25]
    return [0.56, 0.4][bar - 28]


def make_music() -> np.ndarray:
    music = np.zeros((N, 2))
    for bar in range(30):
        start = bar * BAR
        notes, root = CHORDS[bar % 4]
        level = intensity(bar)
        if bar >= 28:
            notes, root = [50, 57, 61, 64, 66], 38
        for i, note in enumerate(notes):
            pan = (i - 2) * 0.24
            add(music, start - (0.12 if bar else 0), pad_note(note, BAR + 0.36, i * 0.7),
                level * 0.73, pan)
        if 2 <= bar < 28:
            add(music, start, bass(root, 1.25), level * 0.65, -0.04)
            if bar not in (6, 23, 24):
                add(music, start + 2 * BEAT, bass(root + (7 if bar % 4 == 3 else 0), 1.1),
                    level * 0.43, 0.04)
        if bar < 2 or bar >= 28:
            continue
        for beat, note in MELODY[bar % 4]:
            if bar in (3, 6, 9, 15, 19, 23, 25, 27) and beat > 2:
                continue
            pan = 0.24 * math.sin((bar * 4 + beat) * 0.8)
            add(music, start + beat * BEAT, pluck(note), level * 0.66, pan)
        if bar >= 3 and bar % 2 == 1 and bar < 28:
            add(music, start + 0.02, bell(notes[-1] + 12), level * 0.44, -0.3)
        if 6 <= bar < 27 and bar not in (9, 15, 23, 25):
            answer = MELODY[(bar + 1) % 4][-1][1] - 12
            answer_beat = 2.5 if bar < 15 else 3.5
            add(music, start + answer_beat * BEAT, bell(answer, 1.8), level * 0.3, 0.38)
        if bar < 3 or bar >= 25:
            continue
        add(music, start, kick(), level * 0.62)
        if bar not in (6, 23, 24):
            add(music, start + 2 * BEAT, kick(), level * 0.48)
        if 12 <= bar < 23 and bar % 2 == 0:
            add(music, start + 3.5 * BEAT, kick(), level * 0.23)
        add(music, start + BEAT, rim(), level * 0.52, 0.12)
        add(music, start + 3 * BEAT, rim(), level * 0.58, -0.12)
        for eighth in range(8):
            if bar < 9 and eighth % 2:
                continue
            if bar in (23, 24) and eighth not in (0, 4, 6):
                continue
            add(music, start + eighth * BEAT / 2, shaker(eighth % 2 == 0),
                level * 0.48, 0.38 if eighth % 2 else -0.38)
    for index, bar in enumerate((3, 6, 9, 12, 15, 19, 23, 25, 28)):
        transition_note = CHORDS[bar % 4][0][-1] + 12
        add(music, bar * BAR - 0.3, bell(transition_note, 2.8),
            0.22 + index * 0.012, -0.2 if index % 2 else 0.2)
    add(music, 69.6, bell(86, 2.4), 0.55, 0.15)
    music *= np.minimum(1, np.arange(N) / (0.45 * SR))[:, None]
    music *= np.minimum(1, (N - 1 - np.arange(N)) / (0.8 * SR))[:, None]
    return music


def whoosh(duration: float = 0.72) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    noise = RNG.normal(size=len(t))
    sos = signal.butter(2, [500, 7000], btype="bandpass", fs=SR, output="sos")
    airy = signal.sosfilt(sos, noise)
    env = np.sin(np.pi * t / duration) ** 1.7
    sweep = signal.chirp(t, 500, duration, 4200, method="quadratic")
    return (airy * 0.22 + sweep * 0.025) * env * envelope(len(t), 0.025, 0.08)


def click(bright: bool = False) -> np.ndarray:
    t = np.arange(int(0.19 * SR)) / SR
    f = 1450 if bright else 920
    tone = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 1.5 * t)
    return tone * np.exp(-t * (48 if bright else 65)) * (1 - np.exp(-t * 1800)) * 0.32


EVENTS = [
    {"id": "page-turn", "name": "翻页 whoosh", "time": 0.6, "duration": 0.72, "kind": "whoosh"},
    {"id": "number-chime", "name": "数字 chime", "time": 4.8, "duration": 1.0, "kind": "chime"},
    {"id": "confirm-click", "name": "确认 click", "time": 10.8, "duration": 0.19, "kind": "click"},
    {"id": "date-tick", "name": "日期 tick", "time": 24.0, "duration": 0.19, "kind": "tick"},
    {"id": "route-whoosh", "name": "路线 whoosh", "time": 40.8, "duration": 0.72, "kind": "whoosh"},
    {"id": "adopt-confirm", "name": "采用 confirm", "time": 55.2, "duration": 1.0, "kind": "confirm"},
    {"id": "brand-resolve", "name": "品牌 resolve", "time": 67.2, "duration": 1.8, "kind": "resolve"},
]


def make_effects() -> tuple[np.ndarray, list[dict]]:
    effects = np.zeros((N, 2))
    manifest = []
    for index, event in enumerate(EVENTS):
        start = event["time"]
        kind = event["kind"]
        if kind == "whoosh":
            add(effects, start, whoosh(), 0.48 if index == 0 else 0.56,
                -0.3 if index == 0 else 0.3)
        elif kind == "chime":
            add(effects, start, bell(86, 1.0), 0.38, -0.12)
            add(effects, start + 0.12, bell(90, 0.88), 0.26, 0.18)
        elif kind == "click":
            add(effects, start, click(), 0.38)
        elif kind == "tick":
            add(effects, start, click(True), 0.26, 0.15)
        elif kind == "confirm":
            add(effects, start, pluck(81, 0.8), 0.32, -0.12)
            add(effects, start + 0.14, bell(86, 0.86), 0.31, 0.15)
        elif kind == "resolve":
            for offset, note, pan in [(0, 74, -0.25), (0.16, 78, 0), (0.32, 81, 0.25)]:
                add(effects, start + offset, bell(note, 1.48), 0.3, pan)
        manifest.append({**event, "source": "original numpy/scipy synthesis", "peak_gain": "under dialogue-free subtitles"})
    return effects, manifest


def k_weighted(x: np.ndarray) -> np.ndarray:
    high_shelf = ([1.53512485958697, -2.69169618940638, 1.19839281085285],
                  [1.0, -1.69065929318241, 0.73248077421585])
    high_pass = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
    y = signal.lfilter(*high_shelf, x, axis=0)
    return signal.lfilter(*high_pass, y, axis=0)


def integrated_loudness(x: np.ndarray) -> float:
    weighted = k_weighted(x)
    block = int(0.4 * SR)
    hop = int(0.1 * SR)
    powers = np.array([np.mean(weighted[i:i + block] ** 2) * 2
                       for i in range(0, len(x) - block + 1, hop)])
    loud = -0.691 + 10 * np.log10(np.maximum(powers, 1e-12))
    keep = loud > -70
    if not np.any(keep):
        return -math.inf
    relative = -0.691 + 10 * np.log10(np.mean(powers[keep])) - 10
    keep &= loud > relative
    return -0.691 + 10 * np.log10(np.mean(powers[keep]))


def true_peak(x: np.ndarray) -> float:
    peaks = [np.max(np.abs(signal.resample_poly(x[:, channel], 4, 1))) for channel in range(2)]
    return 20 * math.log10(max(peaks))


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = np.clip(np.rint(x * 8_388_607), -8_388_608, 8_388_607).astype(np.int32)
    packed = np.empty((N, 2, 3), dtype=np.uint8)
    packed[:, :, 0] = pcm & 255
    packed[:, :, 1] = (pcm >> 8) & 255
    packed[:, :, 2] = (pcm >> 16) & 255
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(3)
        wav.setframerate(SR)
        wav.writeframes(packed.tobytes())


def master(x: np.ndarray, target: float = -16.0) -> np.ndarray:
    x = x - np.mean(x, axis=0)
    ceiling = 10 ** (-1.7 / 20)
    for _ in range(4):
        x *= 10 ** ((target - integrated_loudness(x)) / 20)
        if np.max(np.abs(x)) > ceiling:
            x = ceiling * np.tanh(x / ceiling)
    peak = true_peak(x)
    if peak > -1.7:
        x *= 10 ** ((-1.7 - peak) / 20)
    return x


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    music = master(make_music())
    effects, manifest = make_effects()
    mix = master(music + effects)
    write_wav(OUT / "draft-music.wav", music)
    write_wav(OUT / "mix.wav", mix)
    metadata = {
        "sample_rate": SR,
        "channels": 2,
        "duration_seconds": DURATION,
        "tempo_bpm": 100,
        "event_count": len(manifest),
        "events": manifest,
    }
    (OUT / "audio-events.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    for name, audio in [("draft-music.wav", music), ("mix.wav", mix)]:
        print(f"{name}: {DURATION:.3f}s, {integrated_loudness(audio):.2f} LUFS, "
              f"{true_peak(audio):.2f} dBTP")


if __name__ == "__main__":
    main()
