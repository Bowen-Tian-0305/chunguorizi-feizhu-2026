#!/usr/bin/env python3
import json, math, re, subprocess, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio'
OUT.mkdir(parents=True, exist_ok=True)
SR = 48000
scenes = json.loads((ROOT / 'src' / 'scenes.json').read_text())

def run(args):
    subprocess.run([str(x) for x in args], check=True, stdout=subprocess.DEVNULL)

def duration(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)]))

def pcm(path):
    with wave.open(str(path), 'rb') as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, w.getnchannels()).astype(np.float32) / 32768

def save(path, audio):
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 1: audio = np.column_stack([audio, audio])
    audio = np.clip(audio, -0.98, 0.98)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(audio.shape[1]); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((audio * 32767).astype('<i2').tobytes())

def srt_time(t):
    ms = round(t * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

voice_segments = []
timeline = []
cursor = 0.0
for scene in scenes:
    aiff = OUT / f"voice-{scene['id']}.aiff"
    wav = OUT / f"voice-{scene['id']}.wav"
    run(['say','-v','Tingting','-r','250','-o',aiff,scene['narration']])
    run(['ffmpeg','-y','-i',aiff,'-af','highpass=f=75,loudnorm=I=-17:TP=-2:LRA=7','-ar',SR,'-ac',2,wav])
    dur = duration(wav)
    start = cursor + 0.28
    scene.update(start=cursor, voice_start=start, voice_duration=dur, duration=dur+0.66)
    timeline.append(scene)
    voice_segments.append((start, wav))
    cursor += scene['duration']
total = cursor + 0.4
narration = np.zeros((math.ceil(total*SR),2),np.float32)
for start, path in voice_segments:
    audio = pcm(path); at = round(start*SR); narration[at:at+len(audio)] += audio
save(OUT/'narration.wav', narration)

rng = np.random.default_rng(20261025)
music = np.zeros_like(narration)
bpm = 82
beat = 60/bpm
chords = [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]]
def hz(midi): return 440*2**((midi-69)/12)
for bar in range(math.ceil(total/(beat*4))):
    chord = chords[bar%4]
    for note in chord:
        start = bar*4*beat; length = min(4*beat, total-start)
        if length <= 0: continue
        t = np.arange(round(length*SR))/SR
        tone = (np.sin(2*np.pi*hz(note)*t)+0.25*np.sin(2*np.pi*hz(note)*2*t))*np.exp(-t*0.5)
        env = np.minimum(t/0.35,1)*np.minimum((length-t)/0.7,1)
        at=round(start*SR); music[at:at+len(t),0]+=0.016*tone*env; music[at:at+len(t),1]+=0.014*tone*env
    for b in range(4):
        start=(bar*4+b)*beat
        if start>=total: continue
        note=chord[(b*2)%len(chord)]+24
        length=min(1.25,total-start); t=np.arange(round(length*SR))/SR
        pluck=(np.sin(2*np.pi*hz(note)*t)+0.35*np.sin(2*np.pi*hz(note)*2.005*t))*np.exp(-t*4.8)
        env=np.minimum(t/0.012,1)
        at=round(start*SR); pan=0.25+0.5*((bar+b)%2)
        music[at:at+len(t),0]+=0.045*pluck*env*(1-pan); music[at:at+len(t),1]+=0.045*pluck*env*pan
    for b in (0,2):
        start=(bar*4+b)*beat
        if start>=total: continue
        length=min(.18,total-start); t=np.arange(round(length*SR))/SR
        kick=np.sin(2*np.pi*(75*t-24*t*t))*np.exp(-t*25)
        at=round(start*SR); music[at:at+len(t)]+=0.035*kick[:,None]
for scene in timeline[1:]:
    start=scene['start']; length=.35; t=np.arange(round(length*SR))/SR
    chime=np.sin(2*np.pi*880*t)*np.exp(-t*15)+.4*np.sin(2*np.pi*1320*t)*np.exp(-t*18)
    at=round(start*SR); music[at:at+len(t),0]+=.018*chime; music[at:at+len(t),1]+=.025*chime
fade=np.minimum(np.arange(len(music))/(SR*.5),1)*np.minimum((len(music)-np.arange(len(music)))/(SR*1.8),1)
music*=fade[:,None]
save(OUT/'music.wav',music)

cues=[]
for scene in timeline:
    text=scene['narration']
    parts=[p for p in re.split(r'(?<=[。；？！])',text) if p]
    expanded=[]
    for part in parts:
        while len(part)>30:
            cuts=[m.end() for m in re.finditer('[，、；]',part[:30])]
            cut=cuts[-1] if cuts else 30
            expanded.append(part[:cut]); part=part[cut:]
        if part: expanded.append(part)
    weights=[max(1,len(re.sub(r'\s','',p))) for p in expanded]
    t=scene['voice_start']
    for part,weight in zip(expanded,weights):
        d=scene['voice_duration']*weight/sum(weights)
        cues.append({'start':t,'end':t+d,'text':part}); t+=d
(ROOT/'captions.srt').write_text('\n\n'.join(f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}" for i,c in enumerate(cues,1))+'\n')
(ROOT/'assets'/'timeline.json').write_text(json.dumps({'duration':total,'scenes':timeline,'cues':cues},ensure_ascii=False,indent=2))
print(json.dumps({'duration':total,'scenes':[{ 'id':s['id'],'start':round(s['start'],3),'duration':round(s['duration'],3)} for s in timeline]},ensure_ascii=False,indent=2))
