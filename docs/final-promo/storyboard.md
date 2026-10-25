# 镜头表与素材对应

成片约 88 秒；精确时间以配音对齐后的 `captions.srt` 与 `validation.md` 为准。镜头均为短切、局部推近或真实点击，不做从头滚屏。

| 镜号 | 预计时长 | 真实画面 / 操作 | 当前代码中的功能 |
|---|---:|---|---|
| 01 | 4s | 首页早餐视觉与“酒店和三餐”标题快速推近，紧接核心金额特写 | `public/index.html` 首页与 `public/app.js` 早餐比较器 |
| 02 | 7s | 当前首页首屏，截图/语音/文字入口依次轻强调 | `#quickStart`、`#uploadEntry`、`#voiceWorkspace` |
| 03 | 7s | 在 `#tripVoiceText` 输入旅行想法，短切截图示例与核对说明 | `#understandTrip`、`#screenshot`、`#showExample` |
| 04 | 8s | 点“查看示例方案”后回“核对套餐”，展示 A/B 全程价、份数、可比确认 | `#tryDemo`、`[data-quote-slot]`、`#comparable` |
| 05 | 11s | 在结果页取消一个 `[data-breakfast-date]`，展示日期、¥140/¥310 和 ¥120 | `public/breakfast-decision.js`、`#breakfastComparison` |
| 06 | 8s | “房费和餐费，放在一起看”，已知金额/预算/未知项与总额待核同屏 | `#mealStrategyChoices`、`.mw-package-comparison` |
| 07 | 8s | 当前“杭州好好吃”页，片儿川与特色早餐/门店资料；保留照片署名，不把资料说成实时菜单 | `#discoverNav`、`#cityFoodModes`、`#cityFoodResults` |
| 08 | 10s | 当前本地未配置 AI，故展示真实手动换店：先锁定其它餐次，再更换目标午餐，重算后只显示这一处差异与采用按钮；不伪装 AI 返回 | `.meal-row [data-action="lock"]`、`.meal-row [data-action="replace"]`、`#mealReplaceCandidate`、`#mealWorkspaceDialog` |
| 09 | 7s | 390px 手机结果页，放大核心金额或逐餐调整，保证中文可读 | 同一响应式页面，无另做 UI |
| 10 | 8s | 点“分享只读方案”，展示摘要、隐私范围，再生成并打开只读页 | `public/app.js`、`public/share.html`、`public/plan-share.js` |
| 11 | 6s | 当前首页品牌收束，项目名与公开体验入口；必要署名列于说明文件 | 品牌首页；`https://47.238.228.164/` |

## 统一视觉

- 1920×1080、30fps。以网页玉绿、米白和暖橙为主，字幕位于底部深色半透明安全条，关键金额与按钮避开字幕区域。
- 桌面网页用局部特写；手机不做缩小整页，采用大幅设备画面与独立放大信息卡。
- 不使用旧版 `docs/screenshots` 或旧 MP4 充当当前页面。
- 项目内早餐氛围图只随真实首页出现；不在旁白或画面中区分图像生成方式。片儿川照片如使用，保留 `N509FZ / CC BY-SA 4.0` 署名。
- 无账号、订单、地址簿、密钥、控制台或浏览器隐私。地址栏不入镜，本地 URL 不作为体验链接。
