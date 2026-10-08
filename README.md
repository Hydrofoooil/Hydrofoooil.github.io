# Hydrofoooil.github.io

个人主页，通过 GitHub Pages 从 `main` 分支根目录发布到 https://hydrofoooil.github.io/。
首页照片使用 `assets/portrait-222.webp`，滚动后的背景使用 `assets/background-333.webp`。原始大图、旧素材和论文源 PDF 已移到本地 `archive/`，清单见 `archive/README.md`。归档素材不上传至 GitHub Pages。
照片只去除外围透明空白、等比例缩小和压缩；艺术效果通过 CSS alpha 蒙版叠加，不重绘照片。

## 本地墨迹工作台

工作台提供「预览图片」选择器，可切换 `mmexport1774798073197.png`、带 `(1)` 后缀的备选图和 `222.png`。
备选图使用 `assets/portrait-alternate.webp`，保留原图透明区域，仅裁去外围透明空白并等比例缩小。
`222.png` 使用相同方式转换为 `assets/portrait-222.webp`，预览与导出尺寸为 2528 × 1673。
切图保留同一套归一化轮廓与库参数，记住图片选择；JSON 导入/导出也包含照片 ID。

工作台替换了原来的 UI Layouts 固定 SVG 素材选择器。10 个库均在浏览器中实际执行，
共享用户自定义的封闭轮廓：拖动节点、整体移动、双击加点/删点、自由手绘、撤销/重做。
切换库会保留轮廓，各库参数独立保存。照片原来的透明区域仍然透明。

| 库 | 实际调用 | 原生效果 |
| --- | --- | --- |
| Ink Trace 0.1.0 | `createInkTrace().render()` | 8 种墨笔、原生飞溅、笔锋 |
| p5.brush 2.2.3 | standalone WebGL2 画布、`beginShape` | 水彩填充、铅笔、炭笔、喷笔 |
| Watercolorizer 2.2.0 | `watercolorize()` | 多层水彩多边形扩散 |
| Washes 2.3.0 | `traceSVG()`、原生水/颜料模拟 | 湿笔、干刷、蜡笔、盐析、飞溅 |
| Hokusai | 官方 WASM、`strokeTo()` | 4 个官方示例 MyPaint 笔刷 |
| Easy-Brush 0.5.0 | `Brush`、Spread / DynamicShape 模块 | 散布盖印、笔尖动态 |
| Rough.js 4.6.6 | `rough.canvas().path()` | 7 种原生填充、手绘线条 |
| Perfect Freehand 1.2.2 | `getStroke()` | 压感笔锋与平滑轮廓 |
| Fabric.js 6.9.0 | Spray / Circle / PencilBrush | 喷点、圆点、铅笔 |
| Aquarelle | 原版 `renderMask`、`AquarellePass` | 原生水彩噪声着色器 |

界面是工作台制作的，不是库自带 GUI。大多数控件对应原生 API，但范围、初始值、
尺寸换算、固定压感输入、透明度转换和内部填充由工作台决定。每个库下的
「参数来源与换算说明」逐项标注对应关系；完整核对见 `tools/splash-editor/PARAMETER-AUDIT.md`。
Watercolorizer 的每层浓度、Washes 的模拟帧数是工作台控制；切换 Ink Trace 预设会恢复其原生笔刷参数。

`tools/splash-editor/engines.js` 仅将轮廓和参数转换为各库 API 输入，
不包含自编的泼溅/水彩艺术算法。共同的内部填充和羽化是蒙版合成选项。
关闭“填满轮廓内部”可以查看库生成的原始笔迹、透明纹理和排线。
Aquarelle 上游着色器的噪声尺度固定；提供可编辑输入轮廓与原生扩展参数。
随机种子只对提供相应接口的库显示，其他库生成过程中的自然变化保留。

### 启动与构建

```sh
cd tools/splash-editor
npm ci --ignore-scripts
npm run build
cd ../..
/usr/bin/python3 -m pip install -r scripts/editor-requirements.txt
/usr/bin/python3 scripts/serve_splash_editor.py --port 8765
```

访问 http://127.0.0.1:8765/。现有本地服务名称为 `hydrofoooil-splash-editor`。
编辑前端源文件后执行 `npm run build`；改服务端后执行
`systemctl --user restart hydrofoooil-splash-editor`。
停止：`systemctl --user stop hydrofoooil-splash-editor`。

服务启动后，在 `tools/splash-editor` 运行 `npm run check`，使用 Chrome 检查全部 10 个库、35 个
笔刷/填充选项、自定义轮廓、原生参数、GUI 操作、PNG 导出、参数往返和手机布局。
检查会备份并恢复本地主页蒙版与设置。`npm run check:presets` 单独检查多组方案、原样蒙版恢复、覆盖隔离、快速切换、跨浏览器地址读取及手机布局，测试后删除自己创建的方案。可用 `CHROME_PATH` 指定 Chrome 路径。

工作台使用本地打包的 npm 库、Washes 源码、Hokusai WASM 和 Aquarelle/Three.js，
打开页面不依赖在线 CDN。版本锁定于 `package-lock.json`，上游来源、哈希与许可证记录在
`tools/splash-editor/vendor/`。Ink Trace npm 包没有声明许可证，来源清单据实记录。
旧 UI Layouts 固定蒙版及授权已归档到 `archive/legacy/ui-layouts/`，已退出工作台的效果列表。

### 首页姓名排版

在工作台右侧点击「首页排版」。英文名和中文名可分别拖动、用方向键微调，也可在左侧调整文字、字体、字号、字重、颜色、字距和横纵位置。
预览使用真实首页页面和样式，支持当前浏览器窗口、桌面、手机、横屏与自定义尺寸；预览按比例缩小，字号仍以网页实际 px 表示。
位置按窗口百分比保存。英文衬线体提供 EB Garamond、TeX Gyre Pagella / Termes / Schola / Bonum、Noto Serif、Liberation Serif 和 DejaVu Serif，内置字体文件，工作台预览和首页使用相同字体列表。Georgia、Times 等系统字体仍可选择。
中文默认华文中宋，内置「毛挺」两个字的字体子集，其他汉字使用电脑上的华文中宋或备用字体。字体来源、授权说明和子集生成脚本见 `assets/fonts/` 与 `scripts/build_name_fonts.py`。
调整文字不会重新生成墨迹。保存方案及参数 JSON 都包含姓名排版；旧方案未包含排版时保留当前文字设置。

姓名下方提供 Email、Google Scholar、GitHub、WeChat、CV。工作台「首页排版 → 个人链接」可编辑地址、字体、字号、颜色、间距与按钮风格。默认跟随中文名，也可以直接拖动整组链接自由摆放；链接设置随方案保存。留空的地址显示为待配置入口，微信号或二维码通过点击 WeChat 展示。
圆角描边和悬停下划线参考并改编自 [UI Layouts Creative Buttons](https://www.ui-layouts.com/components/buttons)，使用静态 HTML/CSS，原始示例与 MIT 授权保存在 `assets/vendor/ui-layouts/`。微信二维码使用浏览器原生弹出卡片，可点空白处、关闭按钮或按 Escape 关闭。

首页底部中央的浮动箭头使用 [Lucide Arrow Down](https://lucide.dev/icons/arrow-down)，配磨砂圆钮和轻缓 CSS 动效。点击可在同一窗口中展开个人介绍，也支持滚轮、触摸和键盘浏览。系统开启减少动效时停止浮动并直接跳转。图标源文件与授权见 `assets/vendor/lucide/`。工作台排版预览固定在第一屏，可通过「打开首页测试链接」体验滚动。

首页雾化过渡使用 Three.js 0.134.0 的透明着色器与 GSAP 3.15.0 内置的 [Observer](https://gsap.com/docs/v3/Plugins/Observer/)。网页固定为一个窗口的高度，滚轮和触摸手势直接推进同一场景中的动画。`assets/living-ink-mask.js` 从工作台保存的墨迹蒙版生成距离场，直接改变照片的透明度轮廓：边缘流动、羽化、变成浅色雾丝并逐步向内消散；暂停滚动时，过渡中的边缘仍缓慢流动。`assets/hero-transition.js` 同步让照片围绕人像缩小、333.png 背景逐渐显现、姓名向上离开，个人介绍和后续内容从窗口底部升起；文字所在容器完全透明，不携带第二页背景。反向操作恢复人像和原始墨迹轮廓。支持方向键、Page Up/Down、Home/End 和原有锚点链接。活动蒙版是本项目的自定义着色器，未使用另一个雾层覆盖固定照片。Three.js 与 GSAP 保存在 `assets/vendor/`，运行不依赖外部 CDN；授权见对应目录。工作台 iframe、减少动效模式或不支持 WebGL 的环境保留原有滚动页面。

个人介绍包含英文正文、Research Experience、Publications 与 Selected Honors；经历按倒序展示 Kinetix AI 和 ScaleLab，论文展示 OmniHOI 与 EgoMatrix。论文采用左侧文字、右侧方形预览图：OmniHOI 使用项目主页 Real-world deployment 的上下视频对比，EgoMatrix 使用论文第一页主图，两者均水平循环滚动并在悬停时暂停。桌面端方框大小随文字高度调整，顶部和底部对齐，并带有柔和投影。素材位于 `assets/publications/`，`preview.js` 同步重复视频，并在不可见或系统要求减少动效时暂停播放。内容位于 `index.html`，样式位于 `styles.css`，修改首页图片或排版时保留个人介绍内容。
点击「应用到本地主页」同时写入姓名文字和 `assets/homepage-layout.css` / `assets/homepage-layout.json`；网页作为静态站点运行，视频与滚动动效通过本地 JavaScript 增强。
本地预览地址为工作台同一端口下的 `/homepage/`。
`npm run check:layout` 检查实际拖动、键盘定位、方案往返及桌面/手机预览与网页一致性，检查后恢复本地主页并删除测试方案。
单页布局从首帧启用；活动蒙版渲染器、照片和蒙版加载期间只阻止普通页面滚动，不积累或回放滚动输入，准备完成后保持人像首页。刷新也回到首页；通过新链接打开具体章节仍支持锚点定位。加载失败或超过 15 秒则释放单页控制，恢复可阅读的普通页面。

`npm run check:scene` 检查加载期间多次滚轮/触摸/键盘输入不会在就绪后自动跳转、带锚点的刷新回到首页、就绪后的首次滚轮/触摸输入、失败/超时/取消初始化后的恢复、窗口高度不变、人像缩小且焦点固定、文字透明上升、完整浏览荣誉、反向恢复、箭头和锚点跳转，以及减少动效时的正文访问。

### 保存与导出

左侧「参数方案」可命名保存多组设置，点击列表即时切换对比；「覆盖所选方案」更新选中的方案（也可修改名称），删除方案不会清空当前预览。
每组包含图片选择、自定义轮廓、全部库的参数、姓名排版，以及当次生成的 PNG 蒙版；载入时复用保存的蒙版，避免随机墨迹重新生成后影响对比。
方案存于本地服务的 `tools/splash-editor/.local/presets/`（不进入 Git），刷新和端口重连仍可读取，不会更改主页。

当前参数仍自动保存在浏览器，也可导入/导出版本 3 JSON。旧固定贴图设置不会载入，
独立存储键保留旧数据。效果可选 700/1000/1400 px 生成；Washes 使用 400 px 流体模拟。
透明 PNG 蒙版和照片按所选图尺寸导出：原图 2528 × 1763，备选图 2528 × 1518，222.png 为 2528 × 1673。
蒙版从当前效果分辨率放大。
SVG 导出是内嵌当前 PNG 的 SVG 容器，**不是纯矢量路径**。
预览、导出和应用复用同一次生成的蒙版，不重新随机生成。

“应用到本地主页”保存 `assets/contour-splash-mask.svg` 和 `assets/splash-settings.json`，
并将主页照片 `src`、尺寸和 CSS 宽高比更新为所选图，
不会自动提交或发布。主页仍是静态页面，不加载工作台运行时库。
初始蒙版和旧生成器已保存在 `archive/legacy/`，工作台不再调用它们。
在仓库根目录运行 `python3 -m http.server 8000` 可预览本地主页。
