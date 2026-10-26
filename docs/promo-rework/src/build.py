#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent.parent; ASSETS=ROOT/'assets'; RAW=ASSETS/'raw'; OUT=ASSETS/'render';OUT.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ASSETS/'timeline.json').read_text()); scenes=timeline['scenes']; TOTAL=timeline['duration']
FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'; GREEN='#17352e';WARM='#f7f2e8';RED='#b65335';GOLD='#efcf92';INK='#20352f';BG='#e9ede6'
def face(size): return ImageFont.truetype(FONT,size,index=0)
def run(args): print(' '.join(str(x) for x in args[:8]),'...');subprocess.run([str(x) for x in args],check=True)
def layout(scene,mode='main'):
    sid=scene['id'];dark=sid in ('09','10','12');im=Image.new('RGB',(1920,1080),GREEN if dark else BG);d=ImageDraw.Draw(im)
    if sid=='12':
        d.rounded_rectangle((110,150,1810,880),radius=42,fill='#1c3d34',outline='#8e865e',width=2)
        d.line((740,300,960,175,1180,300),fill=GOLD,width=8);d.line((790,285,790,390,1130,390,1130,285),fill=GOLD,width=8)
        d.arc((855,280,1065,420),0,180,fill='#f7f2e8',width=7)
        for x in (930,975,1020): d.arc((x-15,205,x+15,285),80,270,fill='#f7f2e8',width=4)
        d.text((960,490),'纯过日子',font=face(88),fill=WARM,anchor='mm');d.text((960,610),'订酒店，也把饭算明白',font=face(38),fill=GOLD,anchor='mm')
        d.line((730,670,1190,670),fill='#8e865e',width=2);d.text((960,730),'https://47.238.228.164/',font=face(30),fill='white',anchor='mm')
        d.text((960,810),'酒店 · 早餐 · 三餐  /  示例输入不代替最终确认',font=face(23),fill='#c5d3cc',anchor='mm')
    else:
        d.text((68,38),f"{sid} / 纯过日子",font=face(22),fill=GOLD if dark else RED)
        d.text((68,76),scene['title'],font=face(38),fill=WARM if dark else INK)
        note='当前 v1.3.1 · 真实页面录制'
        d.text((1848,54),note,font=face(21),fill='#c5d3cc' if dark else '#596c63',anchor='ra')
        if sid in ('05','06','07','09','11'):
            d.rounded_rectangle((1515,92,1850,132),radius=10,fill='#2b4a41' if dark else '#d9dfd4');d.text((1682,101),'示例输入 · 非实时报价',font=face(20),fill=WARM if dark else INK,anchor='ma')
    path=OUT/f"layout-{sid}-{mode}.png";im.save(path);return path

def window(scene,rect,mode='main',side=False):
    path=layout(scene,mode);im=Image.open(path).convert('RGB');d=ImageDraw.Draw(im);x,y,w,h=rect
    d.rounded_rectangle((x-12,y-52,x+w+12,y+h+12),radius=22,fill='#fbfaf5',outline='#c9c3b4',width=2)
    for i,c in enumerate(('#b65335','#d4b36c','#668273')):d.ellipse((x+8+i*28,y-34,x+20+i*28,y-22),fill=c)
    d.text((x+112,y-38),'真实操作 · 原始页面像素',font=face(18),fill='#6f7b73')
    if side:
        d.text((80,245),'其它餐次，先锁定。',font=face(44),fill=WARM)
        d.text((80,330),'只换 11-02 午餐',font=face(32),fill=GOLD)
        for yy,text in [(430,'① 选择具体门店'),(505,'② 预览费用与安排'),(580,'③ 由你决定采用')]:d.text((82,yy),text,font=face(28),fill=WARM)
        d.line((84,660,600,660),fill=RED,width=4);d.text((82,700),'手动操作 · 不伪造 AI 响应',font=face(23),fill='#c5d3cc')
    im.save(path);return path

def render_web(scene,start,duration,crop,rect,target,source=None,pan=None,side=False):
    source=source or scene['source'];x,y,w,h=crop;rx,ry,rw,rh=rect;bg=window(scene,rect,side=side)
    cy=f"'min({pan[1]},max({pan[0]},(t-{pan[2]})*{pan[3]}))'" if pan else str(y)
    vf=f"[0:v]fps=30,crop=w={w}:h={h}:x={x}:y={cy},scale={rw}:{rh}:force_original_aspect_ratio=decrease,pad={rw}:{rh}:(ow-iw)/2:(oh-ih)/2:color=0xfbfaf5,setsar=1,tpad=stop_mode=clone:stop_duration=2[win];[1:v][win]overlay={rx}:{ry}:shortest=1,fps=30,format=yuv420p"
    run(['ffmpeg','-y','-ss',start,'-i',RAW/f'{source}.webm','-loop','1','-i',bg,'-t',duration,'-filter_complex',vf,'-c:v','libx264','-preset','fast','-crf','17','-an',target]);return target

def concat_xfade(a,b,duration_a,target,transition='smoothleft'):
    run(['ffmpeg','-y','-i',a,'-i',b,'-filter_complex',f'[0:v][1:v]xfade=transition={transition}:duration=0.45:offset={duration_a-.45:.3f},fps=30,format=yuv420p[v]','-map','[v]','-c:v','libx264','-preset','fast','-crf','17','-an',target]);return target

clips=[]
for scene in ([] if os.environ.get('PROMO_MIX_ONLY') else scenes):
    sid=scene['id'];rawdur=scene['duration']+(0 if sid=='12' else .45);target=OUT/f'scene-{sid}.mp4'
    if scene['kind']=='3d':
        run(['ffmpeg','-y','-ss',scene['start'],'-i',OUT/'3d.mp4','-t',rawdur,'-vf','tpad=stop_mode=clone:stop_duration=0.5,fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','17','-an',target])
    elif sid=='04':render_web(scene,1.0,rawdur,(160,90,1600,810),(160,180,1600,740),target)
    elif sid=='05':render_web(scene,2.0,rawdur,(360,0,1180,660),(260,180,1400,740),target,pan=(0,300,3.4,90))
    elif sid=='06':render_web(scene,1.35,rawdur,(370,130,1180,660),(260,180,1400,740),target,pan=(130,390,3.0,75))
    elif sid=='07':render_web(scene,2.0,rawdur,(370,20,1180,800),(300,180,1320,740),target)
    elif sid=='08':
        a=render_web(scene,1.2,4.2,(0,0,1920,1000),(100,180,1720,740),OUT/'08a.mp4')
        b=render_web(scene,4.5,5.7,(0,0,1920,1000),(100,180,1720,740),OUT/'08b.mp4',source=scene['source2'])
        concat_xfade(a,b,4.2,target)
    elif sid=='09':
        a=render_web(scene,2.0,4.5,(250,0,1420,900),(250,180,1420,740),OUT/'09a.mp4')
        b=render_web(scene,6.0,8.4,(510,0,900,900),(930,180,760,740),OUT/'09b.mp4',side=True)
        concat_xfade(a,b,4.5,target)
    elif sid=='10':
        path=layout(scene);im=Image.open(path).convert('RGB');d=ImageDraw.Draw(im)
        d.text((95,230),'手机上，',font=face(56),fill=WARM);d.text((95,305),'继续核对每一顿。',font=face(42),fill=WARM)
        d.rounded_rectangle((90,410,1050,680),radius=28,fill='#23483e');d.text((140,455),'¥240 ÷ 2 ÷ 1',font=face(40),fill=GOLD);d.text((135,515),'¥120',font=face(112),fill='white');d.text((535,580),'/ 成人 / 次',font=face(36),fill=GOLD)
        d.text((98,745),'390px 真实页面 · 未知项仍可见',font=face(26),fill='#c5d3cc');im.save(path)
        vf='[0:v]fps=30,scale=420:906:force_original_aspect_ratio=decrease,tpad=stop_mode=clone:stop_duration=2[phone];[1:v][phone]overlay=1330:55:shortest=1,fps=30,format=yuv420p'
        run(['ffmpeg','-y','-ss','2.0','-i',RAW/'08-mobile.webm','-loop','1','-i',path,'-t',rawdur,'-filter_complex',vf,'-c:v','libx264','-preset','fast','-crf','17','-an',target])
    elif sid=='11':
        a=render_web(scene,2.0,3.3,(420,0,1080,900),(420,180,1080,740),OUT/'11a.mp4')
        b=render_web(scene,7.0,4.1,(520,0,880,1000),(510,180,900,740),OUT/'11b.mp4')
        concat_xfade(a,b,3.3,target,'fade')
    elif sid=='12':
        path=layout(scene);run(['ffmpeg','-y','-loop','1','-i',path,'-t',rawdur,'-vf',"zoompan=z='min(zoom+0.00008,1.018)':d=1:s=1920x1080:fps=30,format=yuv420p",'-c:v','libx264','-preset','fast','-crf','17','-an',target])
    clips.append(target);print('finished scene',sid)

picture=OUT/'picture.mp4';current=clips[0] if clips else picture
for index,next_clip in enumerate(clips[1:],1):
    output=OUT/f'join-{index:02}.mp4';offset=scenes[index]['start'];transition='smoothleft' if index in (7,8) else 'fade'
    run(['ffmpeg','-y','-i',current,'-i',next_clip,'-filter_complex',f'[0:v][1:v]xfade=transition={transition}:duration=0.45:offset={offset:.3f},fps=30,format=yuv420p[v]','-map','[v]','-t',TOTAL,'-c:v','libx264','-preset','fast','-crf','17','-an',output]);current=output
if clips: run(['ffmpeg','-y','-i',current,'-c','copy',picture])

overlays=[]
for index,cue in enumerate(timeline['cues']):
    layer=Image.new('RGBA',(1920,1080),(0,0,0,0));d=ImageDraw.Draw(layer);f=face(38);box=d.textbbox((0,0),cue['text'],font=f);width=box[2]-box[0];left=(1920-width)/2
    d.rounded_rectangle((left-26,974,left+width+26,1038),radius=15,fill=(16,35,30,240));d.text((960,985),cue['text'],font=f,fill='white',anchor='ma')
    path=OUT/f'caption-{index:02}.png';layer.save(path);overlays.append((path,cue['start'],cue['end']+.08))
final=ROOT/'纯过日子-3D宣传片.mp4';args=['ffmpeg','-y','-i',picture,'-i',ASSETS/'audio'/'narration.wav','-i',ASSETS/'audio'/'music.wav']
for path,_,_ in overlays:args+=['-loop','1','-i',path]
chains=[];previous='0:v'
for index,(_,start,end) in enumerate(overlays,3):
    output=f'v{index}';chains.append(f"[{previous}][{index}:v]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[{output}]");previous=output
chains+=['[2:a][1:a]sidechaincompress=threshold=0.018:ratio=7:attack=25:release=420[duck]','[1:a][duck]amix=inputs=2:normalize=0,alimiter=limit=0.93,loudnorm=I=-16:TP=-2:LRA=9,alimiter=limit=0.82:level=0[a]']
args+=['-filter_complex',';'.join(chains),'-map',f'[{previous}]','-map','[a]','-t',TOTAL,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',final]
run(args);print(final)
