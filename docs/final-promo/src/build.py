#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parent.parent
ASSETS=ROOT/'assets'; RAW=ASSETS/'raw'; OUT=ASSETS/'render'; OUT.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ASSETS/'timeline.json').read_text())
FONT='/System/Library/Fonts/Hiragino Sans GB.ttc'
GREEN='#17352e'; WARM='#f7f2e8'; RED='#b65335'; GOLD='#efcf92'; INK='#20352f'

def run(args):
    print(' '.join(str(x) for x in args[:9]),'...')
    subprocess.run([str(x) for x in args],check=True)

def face(size): return ImageFont.truetype(FONT,size,index=0)
def text(draw,xy,value,size,color=INK,anchor=None):
    draw.text(xy,value,font=face(size),fill=color,anchor=anchor)

def fit(im,box,size):
    crop=im.crop(box); target=Image.new('RGB',size,WARM)
    crop.thumbnail(size,Image.Resampling.LANCZOS)
    target.paste(crop,((size[0]-crop.width)//2,(size[1]-crop.height)//2))
    return target

def window(draw,rect,dark=False):
    x,y,w,h=rect
    draw.rounded_rectangle((x-10,y-10,x+w+10,y+h+10),radius=22,fill='#ffffff' if not dark else '#f7f2e8',outline='#d8cdb8',width=2)

def base(scene,dark=False,title=True,note=True):
    im=Image.new('RGB',(1920,1080),GREEN if dark else WARM); d=ImageDraw.Draw(im)
    if title:
        text(d,(64,45),scene['id'],24,RED)
        d.line((102,47,102,85),fill=RED,width=3)
        text(d,(124,39),scene['title'],38,'white' if dark else INK)
    if note and scene['id'] in ('01','04','05','06'):
        label='示例房价与预算 · 非实时报价'
        box=d.textbbox((0,0),label,font=face(22)); right=1840
        d.rounded_rectangle((right-(box[2]+36),40,right,84),radius=12,fill='#2b4a41' if dark else '#e7dfcf')
        text(d,(right-box[2]-18,49),label,22,'white' if dark else INK)
    return im

def save(im,name):
    path=OUT/name; im.save(path); return path

def still(name): return Image.open(ASSETS/'stills'/f'{name}.png').convert('RGB')

def hook_layout():
    im=base({'id':'01','title':''},dark=True,title=False); d=ImageDraw.Draw(im)
    text(d,(76,148),'含早套餐 · 全程多花',34,GOLD)
    text(d,(66,202),'¥240',142,'white')
    d.line((80,390,690,390),fill=RED,width=6)
    text(d,(80,438),'两位成人',38,'white')
    text(d,(78,500),'只吃 1 次',80,'#ef8b68')
    text(d,(80,630),'按真正会吃到的早晨计算',30,GOLD)
    text(d,(80,700),'不是把差价平均到每一晚',26,'#c5d3cc')
    window(d,(830,158,1000,690),True)
    real=fit(still('04-breakfast'),(390,540,1515,1010),(980,640))
    im.paste(real,(840,178))
    text(d,(858,830),'真实页面 · 1 天留给外出，1 天酒店早餐',25,'white')
    return save(im,'layout-01a.png')

def scene_layout(scene,phase='a'):
    sid=scene['id']; dark=sid in ('06','08','09','10')
    im=base(scene,dark=dark,note=sid!='01'); d=ImageDraw.Draw(im)
    if sid=='04' and phase=='b':
        text(d,(150,190),'条件可比，',62,INK)
        text(d,(150,280),'差价才是早餐成本',62,RED)
        text(d,(150,420),'两档全程价相差 ¥240',36,INK)
        window(d,(180,570,1500,190)); im.paste(fit(still('03-quotes'),(400,680,1190,785),(1500,190)),(180,570))
    elif sid=='05':
        d.rounded_rectangle((112,118,1808,196),radius=18,fill=GREEN)
        text(d,(960,133),'¥240  ÷  2 成人  ÷  1 次  =  ¥120 / 成人 / 次',42,'white',anchor='ma')
        window(d,(110,232,1700,680))
    elif sid=='06':
        text(d,(70,180),'未知金额',42,GOLD)
        text(d,(64,240),'≠ 0',112,'white')
        for y,label in [(430,'已核金额'),(540,'预算预留'),(650,'未知金额')]:
            d.line((76,y+18,116,y+18),fill=RED,width=5); text(d,(140,y),label,34,'white')
        text(d,(74,810),'没核清，就不算成零元',27,GOLD)
        window(d,(870,112,950,820),True)
    elif sid=='07':
        if phase=='a': window(d,(70,222,1780,480))
        else: window(d,(130,210,1660,680))
    elif sid=='08':
        text(d,(74,190),'只改这一顿',58,'white')
        text(d,(74,290),'先选店',32,GOLD)
        text(d,(74,350),'再看差异',32,GOLD)
        text(d,(74,410),'最后由你采用',32,GOLD)
        d.line((78,510,630,510),fill=RED,width=4)
        text(d,(74,560),'AI 提候选',30,'white')
        text(d,(74,616),'规则重算金额与条件',30,'white')
        text(d,(74,690),'其它餐次已锁定',27,'#c5d3cc')
        window(d,(892,92,820,850),True)
    elif sid=='09':
        text(d,(88,168),'手机上，继续核对',42,'white')
        d.rounded_rectangle((72,260,1060,660),radius=30,fill='#23483e')
        text(d,(126,316),'¥120',126,'white')
        text(d,(130,478),'/ 成人 / 次',44,GOLD)
        text(d,(130,566),'只在真正会吃到的早晨计算',31,'white')
        text(d,(86,740),'390px 真实页面',28,'#c5d3cc')
        text(d,(86,794),'未知项，仍然看得见',32,GOLD)
    elif sid=='10':
        text(d,(72,190),'给同行人看',52,'white')
        for y,label in [(320,'酒店与日期'),(410,'逐餐地点'),(500,'费用范围')]:
            text(d,(80,y),label,31,GOLD)
        d.line((78,610,620,610),fill=RED,width=4)
        text(d,(78,664),'不包含截图、录音',29,'white')
        text(d,(78,718),'和私人笔记',29,'white')
        window(d,(824,92,1000,850),True)
    return save(im,f'layout-{sid}{phase}.png')

def phases(scene):
    sid=scene['id']; dur=scene['duration']
    common={'a':{'source':scene['source'],'start':0}}
    if sid=='01': return [('a',3.0,None),('b',dur-3.0,{'source':'04-breakfast','start':7.0,'crop':(390,540,1130,470),'rect':(120,232,1680,700)})]
    if sid=='02': return [('a',dur,{'source':'01-home','crop':(370,110,1200,675),'rect':(240,130,1440,810),'push':True})]
    if sid=='03': return [('a',3.28,{'source':'02-input','crop':(380,350,820,480),'rect':(260,150,1400,820)}),('b',dur-3.28,{'source':'02-input','start':3.28,'crop':(380,390,820,480),'rect':(260,150,1400,820)})]
    if sid=='04': return [('a',5.65,{'source':'03-quotes','start':4.0,'crop':(400,250,790,430),'rect':(190,170,1540,840),'push':True}),('b',dur-5.65,None)]
    if sid=='05': return [('a',dur,{'source':'04-breakfast','start':3.5,'crop':(390,540,1130,470),'rect':(120,242,1680,660)})]
    if sid=='06': return [('a',dur,{'source':'05-package','start':4.8,'crop':(390,140,520,460),'rect':(880,122,930,800),'push':True})]
    if sid=='07': return [('a',3.9,{'source':'10-discover','start':2.0,'crop':(400,100,1120,260),'rect':(80,232,1760,430),'push':True}),('b',dur-3.9,{'source':'10-discover','start':3.3,'crop':(400,350,1120,450),'rect':(140,220,1640,660)})]
    if sid=='08': return [('a',5.4,{'source':'07-manual-preview','start':4.2,'crop':(650,180,620,716),'rect':(902,102,800,830)}),('b',dur-5.4,{'source':'07-manual-preview','start':7.7,'crop':(650,180,620,716),'rect':(902,102,800,830)})]
    if sid=='09': return [('a',dur,{'source':'08-mobile','start':4.6,'crop':(0,0,390,844),'rect':(1280,22,500,1036),'mobile':True})]
    if sid=='10': return [('a',3.4,{'source':'09-share','start':5.0,'play':2.0,'crop':(650,180,620,716),'rect':(834,102,980,830)}),('b',dur-3.4,{'source':'09-share','start':11.0,'crop':(600,100,720,620),'rect':(834,102,980,830),'push':True})]
    return [('a',dur,common['a'])]

def render_phase(scene,phase,dur,spec):
    sid=scene['id']; target=OUT/f'scene-{sid}{phase}.mp4'
    layout=OUT/f'layout-{sid}{phase}.png' if (OUT/f'layout-{sid}{phase}.png').exists() else save(base(scene),f'layout-{sid}{phase}.png')
    if not spec:
        run(['ffmpeg','-y','-loop','1','-i',layout,'-t',dur,'-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-an',target]); return target
    x,y,w,h=spec['crop']; rx,ry,rw,rh=spec['rect']
    source=RAW/f"{spec['source']}.webm"; start=spec.get('start',0)
    if spec.get('mobile'):
        vf=f'[0:v]fps=30,crop={w}:{h}:{x}:{y},scale={rw}:{rh},setsar=1,tpad=stop_mode=clone:stop_duration=20[win];[1:v][win]overlay={rx}:{ry}:shortest=1,fps=30,format=yuv420p'
    else:
        actions=[]
        if spec.get('play'): actions.append(f"trim=duration={spec['play']}")
        if spec.get('push'): actions.append(f"zoompan=z='min(zoom+0.00025,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={rw}x{rh}:fps=30")
        actions.append('tpad=stop_mode=clone:stop_duration=20')
        vf=f"[0:v]fps=30,crop={w}:{h}:{x}:{y},scale={rw}:{rh}:force_original_aspect_ratio=decrease,pad={rw}:{rh}:(ow-iw)/2:(oh-ih)/2:color=0xffffff,setsar=1,{','.join(actions)}[win];[1:v][win]overlay={rx}:{ry}:shortest=1,fps=30,format=yuv420p"
    run(['ffmpeg','-y','-ss',start,'-i',source,'-loop','1','-i',layout,'-t',dur,'-filter_complex',vf,'-c:v','libx264','-preset','fast','-crf','18','-an',target])
    return target

hook_layout()
for scene in timeline['scenes']:
    if scene['id'] not in ('01','11'):
        scene_layout(scene,'a')
        if scene['id'] in ('04','07','08','10'): scene_layout(scene,'b')
end=Image.open(ASSETS/'stills'/'01-home.png').convert('RGB').resize((1920,1080)).filter(ImageFilter.GaussianBlur(12))
end=Image.alpha_composite(end.convert('RGBA'),Image.new('RGBA',end.size,(20,48,42,226))); d=ImageDraw.Draw(end)
d.rounded_rectangle((110,220,1810,865),radius=38,fill=(20,48,42,225),outline=(207,179,118,180),width=2)
text(d,(960,330),'纯过日子',92,'#fffaf0',anchor='mm'); text(d,(960,465),'订酒店，也把饭算明白',36,GOLD,anchor='mm')
d.line((750,535,1170,535),fill='#bda36e',width=2)
text(d,(960,620),'https://47.238.228.164/',29,'white',anchor='mm')
text(d,(960,700),'酒店 · 早餐 · 三餐  /  杭州深度示范',23,'#d7e2dc',anchor='mm')
text(d,(960,820),'示例数据不代替平台与商家最终确认',23,'#b9c9c1',anchor='mm')
end.convert('RGB').save(OUT/'layout-11a.png')

only=os.environ.get('PROMO_SCENE_ONLY','').split(',')
clips=[]
for scene in timeline['scenes']:
    if only[0] and scene['id'] not in only: continue
    parts=[]
    for phase,dur,spec in phases(scene):
        if scene['id']=='11': spec=None
        parts.append(render_phase(scene,phase,dur,spec))
    target=OUT/f"scene-{scene['id']}.mp4"
    concat=OUT/f"scene-{scene['id']}.txt"; concat.write_text(''.join(f"file '{p}'\n" for p in parts))
    run(['ffmpeg','-y','-f','concat','-safe','0','-i',concat,'-c','copy',target]); clips.append(target)
if only[0]: sys.exit(0)
concat=OUT/'concat.txt'; concat.write_text(''.join(f"file '{p}'\n" for p in clips))
run(['ffmpeg','-y','-f','concat','-safe','0','-i',concat,'-c','copy',OUT/'picture.mp4'])

overlays=[]
for index,cue in enumerate(timeline['cues']):
    layer=Image.new('RGBA',(1920,1080),(0,0,0,0)); draw=ImageDraw.Draw(layer)
    subtitle=cue['text']; box=draw.textbbox((0,0),subtitle,font=face(40)); width=box[2]-box[0]; left=(1920-width)/2
    draw.rounded_rectangle((left-28,966,left+width+28,1036),radius=16,fill=(16,35,30,238))
    text(draw,(left,978),subtitle,40,'white')
    target=OUT/f'overlay-cue-{index:02}.png'; layer.save(target); overlays.append((target,cue['start'],cue['end']+.12))
final=ROOT/'纯过日子-最终宣传片.mp4'
args=['ffmpeg','-y','-i',OUT/'picture.mp4','-i',ASSETS/'audio'/'narration.wav','-i',ASSETS/'audio'/'music.wav']
for target,_,_ in overlays: args+=['-loop','1','-i',target]
previous='base'; chains=['[0:v]tpad=stop_mode=clone:stop_duration=0.5[base]']
for index,(_,start,end) in enumerate(overlays,3):
    output=f'v{index}'; chains.append(f"[{previous}][{index}:v]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[{output}]"); previous=output
chains+=['[2:a]volume=0.70[m]','[1:a][m]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=9[a]']
args+=['-filter_complex',';'.join(chains),'-map',f'[{previous}]','-map','[a]','-t',timeline['duration'],'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',final]
run(args)
print(final)
