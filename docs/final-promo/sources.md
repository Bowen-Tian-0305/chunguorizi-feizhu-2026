# 素材、声音与公开使用说明

## 产品画面与数据

- 网页、图形界面与示例数据：当前项目提交 `157b4a0713af18eeeef02deab3ea26aeb1f9ca09`，由最终代码本地运行后录制。
- 示例房价 ¥1200 / ¥1440、早餐预算 ¥35 与套餐条件为虚构测试输入；不是酒店实时价格、交易记录或用户评价。
- 页面中的地图为坐标方位示意；门店、步行时间、供餐、菜单、营业和儿童条件以页面标注及最终核对为准。

## 图像与字体

- `public/hangzhou-breakfast-hero.webp`：项目随附早餐氛围图，仅作为真实首页组成出现；不称为某酒店或门店实拍。
- `public/hangzhou-noodles-photo.jpg`：成片“杭州好好吃”真实页面选用，作者 N509FZ，2019-08-07，Wikimedia Commons，CC BY-SA 4.0。来源与许可见 `docs/image-credits.md`，页面和本说明均保留署名。
- 字幕与图形：macOS 系统 Hiragino Sans GB（冬青黑体简体中文）；没有下载或打包第三方字体。公开视频为栅格化输出，不再分发字体文件。

## 配音、音乐与音效

- 旁白：macOS 中文系统合成声 Tingting，制作脚本 `src/make_audio.py`；旁白文本为本项目原创，不冒称真人录音或真人试用。
- 配乐：`src/make_audio.py` 使用数学振荡器原创合成的轻节拍、和声与尾声，不采样、不复用旧演示音乐。
- UI 音效：同一脚本原创合成的短促提示音，不取自第三方音效库。

## 可复现性

制作源代码位于 `docs/final-promo/src/`。浏览器自动化使用 Playwright（Apache-2.0）驱动本机 Chrome；编码使用 FFmpeg。它们只是制作工具，不加入网页运行依赖。

在项目根目录先启动 `node server.mjs`（或按 README 使用自己的本地环境配置），再执行：

```bash
cd docs/final-promo/src
npm install
python3 -m pip install -r requirements.txt
npx playwright install ffmpeg   # 首次录制需要
npm run capture                # 重新生成网页视频和静帧
npm run audio                  # macOS 中文系统声 + 原创配乐 + SRT
npm run build                  # 1080p MP4、烧录字幕、混音
npm run verify                 # 技术参数、黑帧、静音、字幕和关键帧
```

`assets/raw`、`assets/audio` 与 `assets/render` 是可重新生成的中间文件，不作为发布依赖。最终署名与实际上用素材以本文件和成片为准。片儿川照片随真实“杭州好好吃”页面出现，署名保留在页面与本说明中。
