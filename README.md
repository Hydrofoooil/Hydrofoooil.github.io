# Hydrofoooil.github.io

个人主页，通过 GitHub Pages 发布到 https://hydrofoooil.github.io/。

## 项目状态

纯 HTML/CSS 静态页面，从 `main` 分支根目录发布。

主页照片来自 `mmexport1774798073197.png`，导出为 `assets/portrait-v2.webp`。
仅去除外围完全透明的空白、等比例缩小和压缩，保留图像原本的透明轮廓。
`assets/contour-splash-mask.svg` 沿原图的 Alpha 边界构造细小泼溅和水滴，
通过 CSS `mask-image` 罩在照片上；人物与背景未做重绘。

## 重建蒙版

安装 Pillow、NumPy、OpenCV 后运行 `python3 scripts/build_contour_mask.py`。
脚本使用固定随机种子，在原始轮廓内沿边缘添加多尺度扰动和细小水滴。
照片中心不受影响，网页只加载导出的 WebP 和 SVG，不依赖运行时效果库。

参考调研：

- [UI Layouts Image Masking](https://www.ui-layouts.com/components/image-masking)：提供 Water Splash 固定形状组件。
- [Rough.js](https://roughjs.com/)：提供手绘线条和 SVG 路径效果。
- [SVG 噪声与位移](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence)：可用于程序化边缘纹理。

本项目使用基于真实透明轮廓的静态蒙版，未引入上述库的代码。

## 本地预览

在仓库根目录运行 `python3 -m http.server 8000`，访问 http://localhost:8000/。
