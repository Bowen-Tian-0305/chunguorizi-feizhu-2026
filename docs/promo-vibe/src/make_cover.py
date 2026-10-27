#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
img=Image.open(ROOT/"assets/frames/t-05.5.png").convert("RGB")
d=ImageDraw.Draw(img)
font="/System/Library/Fonts/Hiragino Sans GB.ttc"
d.rounded_rectangle((510,100,1410,300),radius=36,fill=(9,30,26,232),outline=(239,189,115,180),width=2)
d.text((960,177),"纯过日子",font=ImageFont.truetype(font,82),fill="#f7f0e3",anchor="mm")
d.text((960,260),"订酒店，也把饭算明白",font=ImageFont.truetype(font,32),fill="#efbd73",anchor="mm")
img.save(ROOT/"cover.png",optimize=True)
