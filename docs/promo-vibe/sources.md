# 素材与音乐来源

## 产品与事实

- 事实源：仓库 v1.3.2 `README.md`、`docs/showcase/issue-179.md`。
- 页面图与真实操作依据：`docs/promo-rework/assets/stills/`、`assets/raw/`、`assets/capture-report.json`。只复用真实产品原始录屏/截图，不复用旧宣传片画面、模板、配音、音乐、木块酒店或镜头。
- ¥1200 / ¥1440 / ¥240 / ¥120 均为示例输入及规则计算，不是实时房价。
- 单餐段为真实手动修改预览；没有伪造 AI 候选。餐饮、营业、菜单、忌口与儿童费用保持待核边界。

## 摄影

- 片儿川：N509FZ，Wikimedia Commons，CC BY-SA 4.0。沿用项目 `public/hangzhou-noodles-photo.jpg`，原始来源及许可见 `docs/image-credits.md`。本片中作近全屏视频构图裁切与遮罩路线转场，保留署名。

## 原创图形、3D 与配乐

- 动画、价格牌、日期牌、陶瓷碗、面条、路线、纹理和图形转场由 `docs/promo-vibe/src/` 确定性生成，未复制参考项目源代码或素材。
- 0–7.2 秒片头入口为 `src/opening3d.js`。使用本地固定依赖 **three@0.160.1**，由 `index.html` 经典脚本加载；真实 `PerspectiveCamera` / `WebGLRenderer` 配合 `ExtrudeGeometry` 价格牌、`LatheGeometry` 陶瓷碗、`TubeGeometry` 面条、暖色灯光、PCF Soft 阴影和 ACES 色调映射。三维空间中的旋转、退让和相机推进不是 2D `rotate` 伪 3D。
- `render.mjs` 继续按绝对时间逐帧输出。中后段真实页面、摄影遮罩、浅暖纸背景、手机线条和分享隐私图形均来自本工程 Canvas 合成。为兼容 `file://` 的 WebGL 纹理安全限制，`opening3d.js` 内嵌同一张真实首页 PNG 作为本地纹理；它不是新生成或伪造页面，也没有远程图像请求。
- 当前音乐为本工程原创合成的**正式定稿配乐**，不是《千年之后（氛围版）（爱喵版）》的任何版本或仿作；7 个音效也由振荡器与噪声合成。
- 用户已明确选择原创配乐定稿，不再等待或引用指定商业曲目。未从抖音、B站或流媒体抓取/录制该曲，也没有将其嵌入本片。
- 无旁白；未使用 macOS `say`，未调用百炼或任何付费生成服务。本轮视觉终修保持原有时长、场景边界、SRT 和音源边界不变。

## 设计参考（仅原则）

- [vibe-knowledge-video-skill](https://github.com/LuZhong-Li/vibe-knowledge-video-skill)：图形作为演员、每屏一个中心观点、声音回应动作、逐帧验收。
- [vibe-knowledge](https://github.com/worlds3/vibe-knowledge)：Canvas 按时间确定性绘制、音乐节拍驱动、逐帧导出。
- 本片叙事、造型、代码、配色、镜头与音频均重新创作。
