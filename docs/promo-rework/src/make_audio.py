#!/usr/bin/env python3
import json, math, subprocess, wave
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'assets'/'audio'; OUT.mkdir(parents=True,exist_ok=True)
SR=48000; TOTAL=93.0; VOICE='Eddy (中文（中国大陆）)'
scenes=json.loads((ROOT/'src'/'scenes.json').read_text())

def run(args): subprocess.run([str(x) for x in args],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def duration(path): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)]))
def pcm(path):
    with wave.open(str(path),'rb') as w: return np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').reshape(-1,w.getnchannels()).astype(np.float32)/32768
def save(path,audio):
    audio=np.asarray(audio,dtype=np.float32)
    if audio.ndim==1: audio=np.column_stack([audio,audio])
    if np.max(np.abs(audio))>.999: audio=audio*(.999/np.max(np.abs(audio)))
    with wave.open(str(path),'wb') as w:
        w.setnchannels(audio.shape[1]);w.setsampwidth(2);w.setframerate(SR);w.writeframes((audio*32767).astype('<i2').tobytes())
def srt_time(t):
    ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

narration=np.zeros((round(TOTAL*SR),2),np.float32); cues=[]; report=[]
for scene in scenes:
    rate=190 if scene['id'] in ('02','03','05','08','11','12') else 182
    files=[]
    for index,text in enumerate(scene['phrases']):
        stem=OUT/f"voice-{scene['id']}-{index}"
        run(['say','-v',VOICE,'-r',rate,'-o',stem.with_suffix('.aiff'),text])
        run(['ffmpeg','-y','-i',stem.with_suffix('.aiff'),'-af','silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.08,areverse,highpass=f=70,equalizer=f=2800:t=q:w=1:g=1.2,loudnorm=I=-19:TP=-3:LRA=7','-ar',SR,'-ac',2,stem.with_suffix('.wav')])
        files.append(stem.with_suffix('.wav'))
    gap=.18; available=scene['duration']-.58; total=sum(duration(x) for x in files)+gap*(len(files)-1)
    tempo=max(1.0,total/available)
    if tempo>1.0:
        if tempo>1.13: raise RuntimeError(f"Scene {scene['id']} narration too long: {tempo}")
        adjusted=[]
        for file in files:
            target=file.with_name(file.stem+'-fit.wav')
            run(['ffmpeg','-y','-i',file,'-af',f'atempo={tempo:.6f}','-ar',SR,'-ac',2,target]);adjusted.append(target)
        files=adjusted
    start=scene['start']+(.48 if scene['id']=='01' else .30); lengths=[]
    for index,(text,file) in enumerate(zip(scene['phrases'],files)):
        audio=pcm(file); at=round(start*SR); narration[at:at+len(audio)]+=audio
        end=start+duration(file); cues.append({'start':round(start,3),'end':round(end,3),'text':text,'scene':scene['id']});lengths.append(round(end-start,3));start=end+gap
    report.append({'scene':scene['id'],'voice':VOICE,'rate':rate,'fit_tempo':round(tempo,4),'phrase_durations':lengths,'end':round(start-gap,3)})
save(OUT/'narration.wav',narration)

rng=np.random.default_rng(20261026); music=np.zeros_like(narration); bpm=76; beat=60/bpm
chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]]
def hz(midi): return 440*2**((midi-69)/12)
def add(start,signal,pan=.5,level=1):
    at=round(start*SR)
    if at>=len(music): return
    signal=signal[:len(music)-at];music[at:at+len(signal),0]+=level*signal*math.sqrt(1-pan);music[at:at+len(signal),1]+=level*signal*math.sqrt(pan)
for bar in range(math.ceil(TOTAL/(beat*4))):
    chord=chords[bar%4]; start=bar*4*beat; length=min(4*beat,TOTAL-start)
    if length<=0: continue
    t=np.arange(round(length*SR))/SR; env=np.minimum(t/.55,1)*np.minimum((length-t)/.85,1)
    for note in chord:
        pad=(np.sin(2*np.pi*hz(note)*t)+.16*np.sin(2*np.pi*hz(note)*2*t))*np.exp(-t*.22)*env
        add(start,pad,.28+.15*(note%3),.010)
    for b in range(4):
        st=start+b*beat
        if st>=TOTAL: continue
        length=min(1.1,TOTAL-st);t=np.arange(round(length*SR))/SR;note=chord[(b*2+bar)%4]+24
        pluck=(np.sin(2*np.pi*hz(note)*t)+.22*np.sin(2*np.pi*hz(note)*2.003*t))*np.exp(-t*5.2)*np.minimum(t/.009,1)
        add(st,pluck,.30 if (bar+b)%2 else .70,.026)
    if bar%2:
        t=np.arange(round(.22*SR))/SR;noise=rng.normal(0,1,len(t));soft=np.convolve(noise,np.ones(35)/35,mode='same')*np.exp(-t*20)
        add(start,soft,.65,.008)
for st,kind in [(11.65,'paper'),(17.85,'warm'),(70.7,'confirm'),(82.75,'warm')]:
    length=.55;t=np.arange(round(length*SR))/SR
    if kind=='paper':
        noise=rng.normal(0,1,len(t));sig=np.convolve(noise,np.ones(10)/10,mode='same')*np.sin(np.pi*t/length)**2*.018
    else:
        freqs=[523.25,659.25] if kind=='confirm' else [392,587.33];sig=sum(np.sin(2*np.pi*f*t)*np.exp(-t*(12+i*3)) for i,f in enumerate(freqs))*.018
    add(st,sig,.62,1)
fade=np.minimum(np.arange(len(music))/(SR*.7),1)*np.minimum((len(music)-np.arange(len(music)))/(SR*2.0),1);music*=fade[:,None]
save(OUT/'music.wav',music)
(ROOT/'captions.srt').write_text('\n\n'.join(f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}" for i,c in enumerate(cues,1))+'\n')
(ROOT/'assets'/'timeline.json').write_text(json.dumps({'duration':TOTAL,'scenes':scenes,'cues':cues},ensure_ascii=False,indent=2))
(ROOT/'assets'/'audio-report.json').write_text(json.dumps({'auditions':[{'voice':'Eddy (中文（中国大陆）)','rate':178},{'voice':'Flo (中文（中国大陆）)','rate':170},{'voice':'Reed (中文（中国大陆）)','rate':178}],'selected':VOICE,'reason':' warmer and more restrained Mandarin delivery; phrase-level pauses added ','segments':report},ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
