#!/usr/bin/env python3
import json,re,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent.parent;ASSETS=ROOT/'assets';OUT=ASSETS/'validation';OUT.mkdir(parents=True,exist_ok=True)
VIDEO=ROOT/'纯过日子-3D宣传片.mp4';timeline=json.loads((ASSETS/'timeline.json').read_text())
def run(args,log=None):
    result=subprocess.run([str(x) for x in args],capture_output=True,text=True,check=True)
    if log:(OUT/log).write_text(result.stdout+result.stderr)
    return result.stdout+result.stderr
probe=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',VIDEO]));(OUT/'technical.json').write_text(json.dumps(probe,ensure_ascii=False,indent=2))
video=next(s for s in probe['streams'] if s['codec_type']=='video');audio=next(s for s in probe['streams'] if s['codec_type']=='audio');duration=float(probe['format']['duration'])
assert (video['width'],video['height'])==(1920,1080);assert video['r_frame_rate']=='30/1';assert abs(duration-timeline['duration'])<.12;assert audio['sample_rate']=='48000' and audio['channels']==2
run(['ffmpeg','-v','error','-i',VIDEO,'-f','null','-'],'full-decode.log')
run(['ffmpeg','-i',VIDEO,'-vf','blackdetect=d=0.25:pix_th=0.10','-an','-f','null','-'],'blackdetect.log')
run(['ffmpeg','-i',VIDEO,'-af','silencedetect=noise=-45dB:d=1.8','-vn','-f','null','-'],'silencedetect.log')
run(['ffmpeg','-i',VIDEO,'-af','volumedetect','-vn','-f','null','-'],'volumedetect.log')
run(['ffmpeg','-i',VIDEO,'-filter_complex','ebur128=peak=true','-f','null','-'],'ebur128.log')
assert 'black_start' not in (OUT/'blackdetect.log').read_text();assert 'silence_start' not in (OUT/'silencedetect.log').read_text()
ebur=(OUT/'ebur128.log').read_text();integrated=float(re.search(r'Integrated loudness:.*?I:\s*(-[\d.]+) LUFS',ebur,re.S).group(1));peak=float(re.search(r'True peak:\s*Peak:\s*(-[\d.]+) dBFS',ebur,re.S).group(1));assert -17<=integrated<=-15 and peak<=-1.45
srt=(ROOT/'captions.srt').read_text().strip().split('\n\n');assert len(srt)==len(timeline['cues'])
def seconds(t):
    h,m,rest=t.split(':');s,ms=rest.split(',');return int(h)*3600+int(m)*60+int(s)+int(ms)/1000
previous=0
for index,(block,cue) in enumerate(zip(srt,timeline['cues']),1):
    lines=block.splitlines();assert int(lines[0])==index;start,end=map(seconds,lines[1].split(' --> '));assert start>=previous and end>start and end<=duration;assert lines[2]==cue['text'];assert abs(start-cue['start'])<.002 and abs(end-cue['end'])<.002;previous=end
font=ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc',24)
manifest=[]
for scene in timeline['scenes']:
    points=[('first',scene['start']+.12),('middle',scene['start']+scene['duration']/2),('last',scene['start']+scene['duration']-.12)]
    images=[]
    for label,t in points:
        path=OUT/f"scene-{scene['id']}-{label}.png";run(['ffmpeg','-y','-ss',f'{t:.3f}','-i',VIDEO,'-frames:v','1',path]);images.append((label,Image.open(path).convert('RGB'),t))
    contact=Image.new('RGB',(1440,320),'#17352e');d=ImageDraw.Draw(contact)
    for i,(label,im,t) in enumerate(images):
        im.thumbnail((460,265));x=(i%3)*480+10;contact.paste(im,(x,45));d.text((x,12),f"{label} · {t:.2f}s",font=font,fill='white')
    contact.save(OUT/f"contact-{scene['id']}.jpg",quality=91);manifest.append({'scene':scene['id'],'times':[x[1] for x in points]})
run(['ffmpeg','-y','-ss','19.0','-i',VIDEO,'-frames:v','1',OUT/'scene-04-ai-caption.png'])
run(['ffmpeg','-y','-ss','69.5','-i',VIDEO,'-frames:v','1',OUT/'scene-09-preview.png'])
run(['ffmpeg','-y','-ss','81.8','-i',VIDEO,'-frames:v','1',OUT/'scene-11-dialog.png'])
summary={'duration':duration,'video':{'width':1920,'height':1080,'fps':30,'codec':video['codec_name'],'pixel_format':video['pix_fmt']},'audio':{'codec':audio['codec_name'],'sample_rate':48000,'channels':2,'integrated_lufs':integrated,'true_peak_dbtp':peak},'black_frames':'none detected','silence_over_1_8s':'none detected','captions':len(srt),'full_decode':'passed','contacts':manifest}
(ASSETS/'validation-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False,indent=2))
