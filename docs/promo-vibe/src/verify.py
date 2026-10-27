#!/usr/bin/env python3
from pathlib import Path
import json, re, subprocess
from PIL import Image, ImageChops, ImageStat, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "纯过日子-72秒3D宣传片.mp4"
OUT = ROOT / "assets/validation"
OUT.mkdir(parents=True, exist_ok=True)
for stale in OUT.glob("transition-*.jpg"):
    stale.unlink()

def clean(text):
    cleaned="\n".join(line.rstrip() for line in text.splitlines()).rstrip()
    return cleaned + "\n" if cleaned else ""

def run(args):
    p = subprocess.run(args, text=True, capture_output=True, check=True)
    (OUT / "command-transcript.txt").open("a").write("$ " + " ".join(map(str,args)) + "\n" + clean(p.stdout + p.stderr))
    return p.stdout + p.stderr

(OUT / "command-transcript.txt").write_text("")
probe = json.loads(run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(VIDEO)]))
v = next(s for s in probe["streams"] if s["codec_type"] == "video")
a = next(s for s in probe["streams"] if s["codec_type"] == "audio")
duration = float(probe["format"]["duration"])
assert (v["width"],v["height"],v["r_frame_rate"],v["nb_frames"]) == (1920,1080,"30/1","2160")
assert abs(duration-72) < .05 and a["sample_rate"] == "48000" and a["channels"] == 2
run(["ffmpeg","-hide_banner","-i",str(VIDEO),"-vf","blackdetect=d=0.15:pix_th=0.02","-an","-f","null","-"])
run(["ffmpeg","-hide_banner","-i",str(VIDEO),"-af","silencedetect=noise=-45dB:d=0.7","-vn","-f","null","-"])
loudness = run(["ffmpeg","-hide_banner","-nostats","-i",str(VIDEO),"-filter_complex","ebur128=peak=true","-f","null","-"])
(OUT / "loudness.txt").write_text(clean(loudness))
transcript = (OUT / "command-transcript.txt").read_text()
assert "black_start:" not in transcript, "black frame segment detected"
assert "silence_start:" not in transcript, "long silence detected"

srt = (ROOT / "captions.srt").read_text()
pat = re.compile(r"(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)")
times=[]
def seconds(g):
    h,m,s,ms=map(int,g); return h*3600+m*60+s+ms/1000
for m in pat.finditer(srt): times.append((seconds(m.groups()[:4]),seconds(m.groups()[4:])))
assert len(times)==10 and times[0][0]==0 and abs(times[-1][1]-72)<.001
assert all(b>a for a,b in times) and all(times[i][0]>=times[i-1][1] for i in range(1,len(times)))

scenes=[(0,7.2),(7.2,14.4),(14.4,21.6),(21.6,28.8),(28.8,36),(36,45.6),(45.6,55.2),(55.2,60),(60,67.2),(67.2,72)]
for i,(start,end) in enumerate(scenes,1):
    points={"first":start+.15,"middle":(start+end)/2,"last":end-.15}
    imgs=[]
    for label,t in points.items():
        target=OUT/f"scene-{i:02d}-{label}.jpg"
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",f"{t:.3f}","-i",str(VIDEO),"-frames:v","1","-q:v","2",str(target)])
        imgs.append(Image.open(target).convert("RGB").resize((640,360)))
    sheet=Image.new("RGB",(1920,390),"#102e28")
    for j,img in enumerate(imgs): sheet.paste(img,(j*640,30))
    ImageDraw.Draw(sheet).text((12,7),f"Scene {i:02d}  first / middle / last",fill="white")
    sheet.save(OUT/f"contact-{i:02d}.jpg",quality=90)
transition_points=[end for start,end in scenes[:-1]]+[3,4.8,6.2,8.0,40.8,47.8,61.5]
for point in transition_points:
    for label,t in (("before",point-.1),("after",point+.1)):
        run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",f"{t:.3f}","-i",str(VIDEO),"-frames:v","1","-q:v","2",str(OUT/f"transition-{point:04.1f}-{label}.jpg")])
transition_sheet=Image.new("RGB",(1920,len(transition_points)*390),"#091e1a")
for i,point in enumerate(transition_points):
    for j,label in enumerate(("before","after")):
        img=Image.open(OUT/f"transition-{point:04.1f}-{label}.jpg").convert("RGB").resize((960,360))
        transition_sheet.paste(img,(j*960,i*390+30))
    ImageDraw.Draw(transition_sheet).text((12,i*390+7),f"{point:04.1f}s  before / after",fill="white")
transition_sheet.save(OUT/"transition-contact.jpg",quality=90)

opening=ROOT/"opening-3d-8s.mp4"
opening_probe=json.loads(run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(opening)]))
opening_duration=float(opening_probe["format"]["duration"])
assert abs(opening_duration-8)<.05
assert any(s["codec_type"]=="audio" for s in opening_probe["streams"])
opening_dir=OUT/"opening-3d"
opening_dir.mkdir(exist_ok=True)
for stale in opening_dir.glob("*.jpg"):
    stale.unlink()
opening_sheet=Image.new("RGB",(2560,1520),"#091e1a")
for i in range(16):
    target=opening_dir/f"{i+1:02d}.jpg"
    run(["ffmpeg","-y","-hide_banner","-loglevel","error","-ss",f"{i*.5:.1f}","-i",str(opening),"-frames:v","1","-vf","scale=640:360","-q:v","2",str(target)])
    opening_sheet.paste(Image.open(target).convert("RGB"),((i%4)*640,(i//4)*380+20))
    ImageDraw.Draw(opening_sheet).text(((i%4)*640+8,(i//4)*380+3),f"{i*.5:.1f}s",fill="white")
opening_sheet.save(OUT/"opening-3d-contact.jpg",quality=92)
source=(ROOT/"src/opening3d.js").read_text()
for marker in ("WebGLRenderer","PerspectiveCamera","ExtrudeGeometry","LatheGeometry","TubeGeometry","PCFSoftShadowMap","ACESFilmicToneMapping"):
    assert marker in source,marker

def diff(pa,pb):
    ia,ib=Image.open(pa).convert("RGB"),Image.open(pb).convert("RGB")
    region=(600,320,1860,950)
    ia,ib=ia.crop(region),ib.crop(region)
    return sum(ImageStat.Stat(ImageChops.difference(ia,ib)).mean)/3
operation_diffs={
    "breakfast_click":diff(OUT/"scene-04-first.jpg",OUT/"scene-04-middle.jpg"),
    "manual_apply":diff(OUT/"scene-07-middle.jpg",OUT/"scene-07-last.jpg"),
    "share_readonly":diff(OUT/"scene-09-middle.jpg",OUT/"scene-09-last.jpg"),
}
assert operation_diffs["breakfast_click"]>3 and operation_diffs["manual_apply"]>5 and operation_diffs["share_readonly"]>5,operation_diffs
summary={"duration":duration,"video":{"width":v["width"],"height":v["height"],"fps":v["r_frame_rate"],"frames":int(v["nb_frames"]),"codec":v["codec_name"],"pixel_format":v["pix_fmt"]},"audio":{"codec":a["codec_name"],"sample_rate":a["sample_rate"],"channels":a["channels"]},"black_segments":0,"long_silence_segments":0,"subtitle_cues":len(times),"opening":{"duration":opening_duration,"contact_frames":16,"engine":"Three.js 0.160.1","geometry":["ExtrudeGeometry","LatheGeometry","TubeGeometry"],"shadows":"PCFSoftShadowMap"},"operation_mean_pixel_differences":operation_diffs,"status":"technical checks passed; visual review recorded separately"}
(ROOT/"assets/validation-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(summary,ensure_ascii=False,indent=2))
