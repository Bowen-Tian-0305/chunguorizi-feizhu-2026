# 纯过日子 · 72 秒 3D 宣传片定稿

72 秒、1920×1080、30fps、100 BPM / 30 小节、无旁白。画面采用真实 Three.js 3D 片头、真实操作舞台、摄影遮罩、手机与分享页构图；音乐与 7 个音效均为本工程原创合成并已正式定稿。早餐、单餐修改和分享分别使用 7.2 / 9.6 / 7.2 秒真实 WebM 原始操作逐帧组合，不以静态截图冒充操作。

## 交付文件

- `纯过日子-72秒3D宣传片.mp4`：最终 72 秒主片，完整画面 + 正式原创配乐/7 音效。
- `opening-3d-8s.mp4`：0–8 秒有声预览，含 0–7.2 秒真实 3D 片头及 scene2 首页承接。
- `captions.srt`：与 72 秒版本边界一致的 10 段中文字幕；本轮未改。
- `cover.png`：1920×1080 封面。
- `script.md`、`beat-map.json`：视觉终修分镜与 100 BPM / 30 小节节拍表。
- `sources.md`：事实、摄影、3D 实现、参考原则与音源边界。
- `assets/audio/`：原创配乐的事件清单；WAV 由复现命令在本地生成。
- `assets/validation/`：MP4 场景首/中/尾与关键转场抽帧、校验和；详细日志由验收脚本在本地生成。
- `validation.md`：本轮 3D 片头、全片看图、技术检查与回归测试记录。
- `src/`：可复现 Three.js + Canvas 工程、录屏帧提取、音乐、封面和验收脚本。

原创配乐已定稿，不再等待或引用《千年之后（氛围版）（爱喵版）》。本片未使用该商业曲目，无旁白，以中文字幕讲解。

## 片头与工程

`src/opening3d.js` 是 0–7.2 秒片头入口：0–3 秒为 ¥1200 / ¥1440 价格牌与中央 ¥240、早餐吃 1 次；3–4.8 秒价格牌在三维空间中旋转退让，陶瓷碗和面条长成；4.8–6.2 秒日期牌归位并呈现算式；6.2–7.2 秒真实首页升起，相机推进，随后 scene2 承接。使用真实 `PerspectiveCamera`、`WebGLRenderer`、`ExtrudeGeometry`、`LatheGeometry`、`TubeGeometry`、暖色灯光、PCF Soft 阴影和 ACES 色调映射，不是以 2D `rotate` 冒充 3D。

`index.html` 通过经典 `<script src>` 依次加载本地 Three.js 与 `opening3d.js`，不使用 CDN 或模块导入；Three.js 固定为 **0.160.1**。`render.mjs` 仍按绝对时间逐帧绘制并逐帧送入 ffmpeg。为兼容 `file://` 下 Chrome 的 WebGL 纹理安全限制，`opening3d.js` 内嵌同一张真实首页 PNG 仅作本地纹理，未引入其他图像或远程资源。

## 复现

需要 macOS Chrome、Node.js 20+、Python 3、numpy、scipy、Pillow、ffmpeg/ffprobe。Node 依赖由 `src/package.json` / `package-lock.json` 固定，其中 `three@0.160.1`、`playwright@1.64.1`。工程不读取业务密钥，不启动或修改云端服务。

```bash
cd docs/promo-vibe/src
npm ci
python3 prepare_assets.py
python3 make_audio.py
node render.mjs --output ../picture-draft.mp4
ffmpeg -y -i ../picture-draft.mp4 -i ../assets/audio/mix.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart '../纯过日子-72秒3D宣传片.mp4'
node render.mjs --end 8 --output ../opening-picture.mp4
ffmpeg -y -i ../opening-picture.mp4 -i ../assets/audio/mix.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -t 8 -movflags +faststart ../opening-3d-8s.mp4
rm ../opening-picture.mp4
python3 make_cover.py
python3 verify.py
```

也可直接执行 `bash reproduce.sh` 完成依赖安装、抽帧、音频、静帧、全片、8 秒预览、封面与验收。

`prepare_assets.py` 从既有真实 WebM 提取 15fps 操作帧，最终封装为 30fps；提取缓存位于 `assets/dynamic/`。`make_audio.py` 以固定随机种子生成定稿原创配乐的 WAV，复现时在本地重新生成。

业务测试在仓库根目录运行 `npm test`。公开版只收录正式主片和 8 秒预览；过程视频和可重新生成的 WAV 缓存留在本地。
