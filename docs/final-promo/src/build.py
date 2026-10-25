#!/usr/bin/env python3
import json, os, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parent.parent
ASSETS=ROOT/'assets'; RAW=ASSETS/'raw'; OUT=ASSETS/'render'; OUT.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ASSETS/'timeline.json').read_text())
report=json.loads((ASSETS/'capture-report.json').read_text())
font='/System/Library/Fonts/Hiragino Sans GB.ttc'

def run(args):
    print(' '.join(str(x) for x in args[:8]),'...')
    subprocess.run([str(x) for x in args],check=True)

def esc(text):
    return text.replace('\\','\\\\').replace(',','，').replace('{','（').replace('}','）').replace('\n','\\N')

def ass_time(t):
    cs=round(t*100); h,cs=divmod(cs,360000); m,cs=divmod(cs,6000); s,cs=divmod(cs,100)
    return f'{h}:{m:02}:{s:02}.{cs:02}'

ass=['[Script Info]','PlayResX: 1920','PlayResY: 1080','WrapStyle: 0','ScaledBorderAndShadow: yes','', '[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
'Style: Title,Hiragino Sans GB,38,&H00FFFFFF,&H902A3B35,&H902A3B35,-1,0,0,0,100,100,0,0,3,1,0,7,64,64,52,1',
'Style: Note,Hiragino Sans GB,23,&H00F7F4EA,&H902A3B35,&H902A3B35,0,0,0,0,100,100,0,0,3,1,0,9,64,64,38,1',
'Style: Subtitle,Hiragino Sans GB,27,&H00FFFFFF,&HC0182723,&HC0182723,-1,0,0,0,100,100,0,0,3,1,0,2,100,100,37,1','', '[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
for scene in timeline['scenes']:
    if scene['id']=='11': continue
    start=scene['start']+.16; end=scene['start']+scene['duration']-.2
    ass.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,{esc(scene['title'])}")
    if scene['id'] in ('01','04','05','06'):
        ass.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Note,,0,0,0,,示例房价与预算 · 非实时报价")
for cue in timeline['cues']:
    ass.append(f"Dialogue: 1,{ass_time(cue['start'])},{ass_time(cue['end']+.12)},Subtitle,,0,0,0,,{esc(cue['text'])}")
(OUT/'overlay.ass').write_text('\n'.join(ass)+'\n')

# Closing frame is a graphic treatment of the real homepage, never a local URL screenshot.
image=Image.open(ASSETS/'stills'/'01-home.png').convert('RGB').resize((1920,1080)).filter(ImageFilter.GaussianBlur(12))
overlay=Image.new('RGBA',image.size,(20,48,42,218)); image=Image.alpha_composite(image.convert('RGBA'),overlay)
d=ImageDraw.Draw(image)
f1=ImageFont.truetype(font,92,index=0); f2=ImageFont.truetype(font,36,index=0); f3=ImageFont.truetype(font,29,index=0); f4=ImageFont.truetype(font,23,index=0)
d.rounded_rectangle((110,220,1810,865),radius=38,fill=(20,48,42,218),outline=(207,179,118,180),width=2)
d.text((960,330),'纯过日子',font=f1,anchor='mm',fill='#fffaf0')
d.text((960,465),'订酒店，也把饭算明白',font=f2,anchor='mm',fill='#f5dfac')
d.line((750,535,1170,535),fill='#bda36e',width=2)
d.text((960,620),'https://47.238.228.164/',font=f3,anchor='mm',fill='white')
d.text((960,700),'酒店 · 早餐 · 三餐  /  杭州深度示范',font=f4,anchor='mm',fill='#d7e2dc')
d.text((960,820),'示例数据不代替平台与商家最终确认',font=f4,anchor='mm',fill='#b9c9c1')
image.convert('RGB').save(OUT/'end.png')
card=Image.new('RGBA',(950,320),(0,0,0,0)); cd=ImageDraw.Draw(card)
cd.rounded_rectangle((0,0,949,319),radius=24,fill=(23,53,46,235))
cd.text((60,75),'¥120 / 成人 / 次',font=ImageFont.truetype(font,72,index=0),fill='white')
cd.text((60,200),'只在真正会吃到的早晨计算',font=ImageFont.truetype(font,32,index=0),fill='#f5dfac')
card.save(OUT/'mobile-card.png')

clips=[]
for scene in timeline['scenes']:
    target=OUT/f"scene-{scene['id']}.mp4"; clips.append(target)
    if os.environ.get('PROMO_FINAL_ONLY') == '1': continue
    dur=scene['duration']
    if scene['id']=='11':
        run(['ffmpeg','-y','-loop','1','-i',OUT/'end.png','-t',dur,'-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-an',target])
        continue
    source=scene['source']
    if scene['id']=='08':
        entry=next((x for x in report if x['name']=='07-refine'),{})
        if not entry.get('livePreview'): source='07-manual-preview'
    if scene['id']=='09':
        vf="[0:v]fps=30,scale=1920:1080,gblur=sigma=22,eq=brightness=-0.12[bg];[1:v]fps=30,scale=390:844,pad=430:884:20:20:color=0xf4eee2,tpad=stop_mode=clone:stop_duration=20[phone];[bg][phone]overlay=1190:78:shortest=1[tmp];[tmp][2:v]overlay=90:250:shortest=1"
        run(['ffmpeg','-y','-loop','1','-i',ASSETS/'stills'/'01-home.png','-i',RAW/f'{source}.webm','-loop','1','-i',OUT/'mobile-card.png','-t',dur,'-filter_complex',vf,'-c:v','libx264','-preset','fast','-crf','18','-an',target])
    else:
        vf='fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,tpad=stop_mode=clone:stop_duration=20,format=yuv420p'
        run(['ffmpeg','-y',*(['-ss','4.5'] if scene['id']=='01' else []),'-i',RAW/f'{source}.webm','-t',dur,'-vf',vf,'-c:v','libx264','-preset','fast','-crf','18','-an',target])
concat=OUT/'concat.txt'; concat.write_text(''.join(f"file '{p}'\n" for p in clips))
run(['ffmpeg','-y','-f','concat','-safe','0','-i',concat,'-c','copy',OUT/'picture.mp4'])
final=ROOT/'纯过日子-最终宣传片.mp4'
overlays=[]
def text_layer(name, start, end, title='', note='', subtitle=''):
    layer=Image.new('RGBA',(1920,1080),(0,0,0,0)); draw=ImageDraw.Draw(layer)
    if title:
        face=ImageFont.truetype(font,38,index=0); box=draw.textbbox((0,0),title,font=face)
        draw.rounded_rectangle((44,34,88+box[2],100),radius=14,fill=(28,56,49,225))
        draw.text((66,48),title,font=face,fill='white')
    if note:
        face=ImageFont.truetype(font,23,index=0); box=draw.textbbox((0,0),note,font=face)
        draw.rounded_rectangle((1828-box[2],1030,1880,1076),radius=10,fill=(28,56,49,220))
        draw.text((1854-box[2],1038),note,font=face,fill='#f7f4ea')
    if subtitle:
        face=ImageFont.truetype(font,40,index=0); box=draw.textbbox((0,0),subtitle,font=face)
        width=box[2]-box[0]; left=(1920-width)/2
        draw.rounded_rectangle((left-28,966,left+width+28,1036),radius=16,fill=(16,35,30,232))
        draw.text((left,978),subtitle,font=face,fill='white')
    target=OUT/f'overlay-{name}.png'; layer.save(target); overlays.append((target,start,end))
for scene in timeline['scenes']:
    if scene['id']!='11':
        text_layer(f"title-{scene['id']}",scene['start']+.16,scene['start']+scene['duration']-.2,title=scene['title'],note='示例房价与预算 · 非实时报价' if scene['id'] in ('01','04','05','06') else '')
for index,cue in enumerate(timeline['cues']):
    text_layer(f'cue-{index:02}',cue['start'],cue['end']+.12,subtitle=cue['text'])
args=['ffmpeg','-y','-i',OUT/'picture.mp4','-i',ASSETS/'audio'/'narration.wav','-i',ASSETS/'audio'/'music.wav']
for target,_,_ in overlays: args+=['-loop','1','-i',target]
previous='base'; chains=['[0:v]tpad=stop_mode=clone:stop_duration=0.5[base]']
for index,(_,start,end) in enumerate(overlays,3):
    output=f'v{index}'; chains.append(f"[{previous}][{index}:v]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[{output}]"); previous=output
chains.append('[2:a]volume=0.70[m]')
chains.append(f'[1:a][m]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=9[a]')
args+=['-filter_complex',';'.join(chains),'-map',f'[{previous}]','-map','[a]','-t',timeline['duration'],'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',final]
run(args)
print(final)
