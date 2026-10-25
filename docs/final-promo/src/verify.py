#!/usr/bin/env python3
import json, re, subprocess
from pathlib import Path
from PIL import Image, ImageStat

ROOT=Path(__file__).resolve().parent.parent
VIDEO=ROOT/'纯过日子-最终宣传片.mp4'
OUT=ROOT/'assets'/'validation'; OUT.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ROOT/'assets'/'timeline.json').read_text())

def command(args):
    return subprocess.run([str(x) for x in args],text=True,capture_output=True,check=True)
def time_seconds(value):
    h,m,rest=value.split(':'); s,ms=rest.split(',')
    return int(h)*3600+int(m)*60+int(s)+int(ms)/1000

probe=json.loads(command(['ffprobe','-v','error','-show_format','-show_streams','-of','json',VIDEO]).stdout)
duration=float(probe['format']['duration'])
video=next(s for s in probe['streams'] if s['codec_type']=='video')
audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
srt=(ROOT/'captions.srt').read_text().strip()
blocks=re.split(r'\n\s*\n',srt)
cues=[]
for expected,block in enumerate(blocks,1):
    lines=block.splitlines(); assert int(lines[0])==expected
    match=re.fullmatch(r'(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)',lines[1]); assert match
    start,end=map(time_seconds,match.groups()); text=''.join(lines[2:])
    assert 0<=start<end<=duration+.03 and len(text)<=40
    if cues: assert start>=cues[-1]['end']-.15
    cues.append({'start':start,'end':end,'text':text})
assert abs(cues[-1]['end']-timeline['cues'][-1]['end'])<.03
scene_timing=[]
for scene in timeline['scenes']:
    path=ROOT/'assets'/'render'/f"scene-{scene['id']}.mp4"
    actual=float(command(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',path]).stdout)
    scene_timing.append({'id':scene['id'],'target':scene['duration'],'actual':actual})
    assert abs(actual-scene['duration'])<=0.05, f"scene {scene['id']} duration differs from timeline"

black=command(['ffmpeg','-i',VIDEO,'-vf','blackdetect=d=0.12:pix_th=0.06','-an','-f','null','-'])
silence=command(['ffmpeg','-i',VIDEO,'-af','silencedetect=noise=-45dB:d=1.8','-vn','-f','null','-'])
volume=command(['ffmpeg','-i',VIDEO,'-vn','-af','volumedetect','-f','null','-'])
loudness=command(['ffmpeg','-i',VIDEO,'-vn','-af','ebur128=peak=true','-f','null','-'])
for name,result in [('blackdetect',black),('silencedetect',silence),('volumedetect',volume),('ebur128',loudness)]:
    (OUT/f'{name}.log').write_text(re.sub(r'[ \t]+(?=\n|$)','',result.stderr))

for scene in timeline['scenes']:
    points={'first':scene['start']+.08,'middle':scene['start']+scene['duration']*.5,'last':scene['start']+scene['duration']-.08}
    contact=Image.new('RGB',(1920,360),'white')
    for index,(label,at) in enumerate(points.items()):
        target=OUT/f"scene-{scene['id']}-{label}.png"
        command(['ffmpeg','-y','-ss',at,'-i',VIDEO,'-frames:v','1',target])
        frame=Image.open(target).convert('RGB').resize((640,360),Image.Resampling.LANCZOS)
        contact.paste(frame,(index*640,0))
    contact.save(OUT/f"contact-{scene['id']}.jpg",quality=92)
command(['ffmpeg','-y','-sseof','-0.08','-i',VIDEO,'-frames:v','1',OUT/'last-frame.png'])
last=np_stat=ImageStat.Stat(Image.open(OUT/'last-frame.png').convert('RGB'))
assert sum(last.mean)>45, 'last frame is unexpectedly black'
black_intervals=re.findall(r'black_start:[^\n]+',black.stderr)
silence_intervals=re.findall(r'silence_start:[^\n]+|silence_end:[^\n]+',silence.stderr)
assert not any('black_start: 8' in x or 'black_start: 9' in x for x in black_intervals), 'black near tail'
summary={
    'duration_seconds':duration,'video_duration':video.get('duration'),'width':video['width'],'height':video['height'],'fps':video['avg_frame_rate'],
    'video_codec':video['codec_name'],'pixel_format':video['pix_fmt'],
    'audio_codec':audio['codec_name'],'sample_rate':audio['sample_rate'],'channels':audio['channels'],'audio_duration':audio.get('duration'),
    'subtitle_cues':len(cues),'black_intervals':black_intervals,'silence_events':silence_intervals,
    'last_frame_mean_rgb':last.mean,'scene_timing':scene_timing,
    'scene_contact_sheets':[f"contact-{s['id']}.jpg" for s in timeline['scenes']]
}
assert 70<=duration<=90
assert (video['width'],video['height'])==(1920,1080)
assert video['avg_frame_rate']=='30/1'
assert audio['sample_rate']=='48000' and audio['channels']==2
(OUT/'technical.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False,indent=2))
