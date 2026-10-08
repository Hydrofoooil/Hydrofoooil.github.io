# 参数来源核对

库算法是真实运行的；界面、中文名称、滑条范围、默认值及照片蒙版合成由工作台制作，不是各库提供的原版 GUI。

“库原生 API”表示值对应库的接口；“原生 API 的换算／组合”表示先换算尺寸、构造固定输入或组合调用；“工作台自定义”表示绘制/停止模拟的外层控制。

所有尺寸滑条使用 1000 px 画布作为基准，再随效果分辨率缩放。

## 会改变视觉风格的外层处理

- 封闭轮廓、曲线平滑、轨迹采样由工作台构造；笔刷库沿该轨迹自动绘制。
- Hokusai 和 Perfect Freehand 使用全路径固定压感。Hokusai 的倾角和每点时间间隔也是固定输入，不等同真实手写。
- p5.brush 与 Hokusai 的黑色笔迹按亮度转换成蒙版透明度，不保留库原来的彩色/纸张表现。
- “填满轮廓内部”是工作台合成，会填实原生纹理的透明空隙。关闭后可查看由库输出提取的蒙版纹理。
- “蒙版羽化”是 Canvas 模糊；“轮廓曲线平滑”是输入几何平滑，两者都不是各库原生艺术参数。
- Washes 固定在 400 px 模拟，再放大；“模拟帧数”是工作台决定停止时刻。盐笔刷先画湿底，再使用库的盐笔刷。
- Aquarelle 的原生噪声尺度固定；当前只提供输入轮廓和原生 offset，不虚构粒度/噪声强度参数。

## 本次纠正

- Washes 的 paintLoad 原先同时传给 traceSVG 的 strength，导致负载重复放大。现在只传给 paintLoad，描绘强度沿用库的压力值。
- Watercolorizer 原先取采样数组前 48 项，部分轮廓末段会被截断。现在在整个闭合边界均匀采样。
- Ink Trace 选择预设时，现在从实际安装版本的 INK_TRACE_PRESETS 恢复笔宽、粗糙度和飞溅参数，再允许手动调整。已有保存的参数不自动重置。

## 逐项对应

| 库 | 界面参数 | 来源 | 接口／处理 |
| --- | --- | --- | --- |
| Ink Trace | 原生笔刷 | 库原生 API | preset / INK_TRACE_PRESETS |
| Ink Trace | 笔锋宽度 | 原生 API 的换算／组合 | settings.nib.width · 随分辨率缩放 |
| Ink Trace | 边缘毛糙 | 库原生 API | settings.jitter.edgeRoughness |
| Ink Trace | 飞溅强度 | 库原生 API | settings.splatter.intensity |
| Ink Trace | 飞溅密度 | 库原生 API | settings.splatter.density |
| Ink Trace | 飞溅距离倍率 | 库原生 API | settings.splatter.spread |
| p5.brush | 绘制方式 | 原生 API 的换算／组合 | fill() / set() · 工作台组合选择 |
| p5.brush | 笔刷重量 | 原生 API 的换算／组合 | set(name, color, weight) · 随分辨率缩放 |
| p5.brush | 向外渗色 | 库原生 API | fillBleed(strength) |
| p5.brush | 纸张纹理 | 库原生 API | fillTexture(textureStrength) |
| p5.brush | 边缘纹理 | 库原生 API | fillTexture(_, borderIntensity) |
| p5.brush | 水彩浓度 | 库原生 API | fill(color, opacity) |
| Watercolorizer | 轮廓扩散 | 原生 API 的换算／组合 | vertexWeights · 统一应用于所有顶点 |
| Watercolorizer | 扩散迭代 | 库原生 API | evolutions |
| Watercolorizer | 叠染层数 | 库原生 API | layersPerEvolution |
| Watercolorizer | 每层浓度 | 工作台自定义 | CanvasRenderingContext2D.globalAlpha · 每层绘制透明度 |
| Washes | 原生笔刷 | 原生 API 的换算／组合 | brushMode() · salt 先绘制湿底再调用盐笔刷 |
| Washes | 纸张湿度 | 库原生 API | paperWetness() |
| Washes | 笔刷尺寸 | 库原生 API | brushSize() · 短边比例 |
| Washes | 颜料负载 | 库原生 API | paintLoad() |
| Washes | 水量 | 库原生 API | waterLoad() |
| Washes | 模拟帧数 | 工作台自定义 | onFrame() · 工作台计数后暂停模拟 |
| Hokusai / MyPaint | MyPaint 原生笔刷 | 库原生 API | 官方示例 .myb 笔刷 |
| Hokusai / MyPaint | 笔刷半径倍率 | 原生 API 的换算／组合 | setRadiusLog(base + log2(multiplier × scale)) |
| Hokusai / MyPaint | 压感 | 原生 API 的换算／组合 | strokeTo(pressure) · 全路径固定输入 |
| Hokusai / MyPaint | 笔倾角 | 原生 API 的换算／组合 | strokeTo(xtilt, ytilt) · x 固定、y=0 |
| Easy-Brush | 笔刷大小 | 原生 API 的换算／组合 | Brush.size · 随分辨率缩放 |
| Easy-Brush | 散布范围倍率 | 库原生 API | SpreadModule.spreadRange |
| Easy-Brush | 每次盖印数量 | 库原生 API | SpreadModule.count |
| Easy-Brush | 尺寸抖动 | 库原生 API | DynamicShapeModule.sizeJitter |
| Easy-Brush | 笔尖圆度 | 库原生 API | Brush.roundness |
| Easy-Brush | 盖印间距 | 库原生 API | Brush.spacing |
| Rough.js | 原生填充 | 库原生 API | fillStyle |
| Rough.js | 手绘粗糙度 | 库原生 API | roughness |
| Rough.js | 轮廓线宽 | 原生 API 的换算／组合 | strokeWidth · 随分辨率缩放 |
| Rough.js | 排线间距 | 原生 API 的换算／组合 | hachureGap · 随分辨率缩放 |
| Rough.js | 排线角度 | 库原生 API | hachureAngle |
| Rough.js | 排线粗细 | 原生 API 的换算／组合 | fillWeight · 随分辨率缩放 |
| Perfect Freehand | 笔锋宽度 | 原生 API 的换算／组合 | getStroke.size · 随分辨率缩放 |
| Perfect Freehand | 压感变细 | 库原生 API | getStroke.thinning |
| Perfect Freehand | 笔锋平滑 | 库原生 API | getStroke.smoothing |
| Perfect Freehand | 路径稳定 | 库原生 API | getStroke.streamline |
| Perfect Freehand | 压感 | 原生 API 的换算／组合 | 每点 pressure 固定输入，simulatePressure=false |
| Fabric.js Brushes | 原生笔刷 | 库原生 API | SprayBrush / CircleBrush / PencilBrush |
| Fabric.js Brushes | 喷笔宽度 | 原生 API 的换算／组合 | brush.width · 随分辨率缩放 |
| Fabric.js Brushes | 每笔喷点数 | 库原生 API | SprayBrush.density |
| Fabric.js Brushes | 墨点大小 | 原生 API 的换算／组合 | SprayBrush.dotWidth · 随分辨率缩放 |
| Fabric.js Brushes | 墨点大小变化 | 原生 API 的换算／组合 | SprayBrush.dotWidthVariance · 随分辨率缩放 |
| Fabric.js Brushes | 墨点透明度 | 库原生 API | SprayBrush.randomOpacity |
| Aquarelle | 原生轮廓扩展 | 原生 API 的换算／组合 | mask.offset / renderMask() · 随分辨率缩放 |
