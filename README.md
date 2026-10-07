# Hydrofoooil.github.io

个人主页，通过 GitHub Pages 发布到 https://hydrofoooil.github.io/。

## 项目状态

纯 HTML/CSS 静态页面，从 `main` 分支根目录发布。

主页照片使用原图的 WebP 导出版本，去除全景照片的空白边界并压缩体积。
`assets/splash-mask.svg` 是手写水滴泼溅蒙版，通过 CSS `mask-image` 裁切照片边缘，未使用生成图片。

## 本地预览

在仓库根目录运行 `python3 -m http.server 8000`，访问 http://localhost:8000/。
