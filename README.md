# Apple Media Converter

一个本地运行的媒体格式转换工具，界面为现代化苹果风格，支持：

- 视频格式转换
- 音频格式转换
- 图片格式转换
- 视频转音频
- 视频、音频、图片压缩
- `webp -> gif`
- 动画 WebP 转 GIF 浏览器回退
- `jxr / wdp / hdp` 输入图片转常见格式

## 技术栈

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js 本地服务
- 桌面壳：Electron
- 转换引擎：本机 FFmpeg
- JXR 解码：Windows PresentationCore / WIC

## 安装依赖

```bash
npm install
```

## Web 方式运行

```bash
node server.js
```

Windows 可以手动打开：

```powershell
start http://localhost:3000
```

macOS 可以手动打开：

```bash
open http://localhost:3000
```

## Electron 桌面版

开发启动：

```bash
npm run start:desktop
```

如果你需要指定自定义 Electron 分发目录，也仍然可以继续使用：

```bash
ELECTRON_OVERRIDE_DIST_PATH=/path/to/electron/dist npm run start:desktop
```

## 打包

打 Windows 包：

```bash
npm run dist:win
```

打 macOS 包：

```bash
npm run dist:mac
```

自动按当前参数选择平台：

```bash
npm run dist
```

生成产物会输出到 `dist/`。

## FFmpeg 说明

- 开发环境下会优先从 PATH 查找 FFmpeg
- 也支持把可执行文件放到本地 `bin/` 目录
- Windows 使用 `bin/ffmpeg.exe`
- macOS / Linux 使用 `bin/ffmpeg`
- 打包时 `bin/` 会作为额外资源一并带进桌面应用

macOS 如果还没安装 FFmpeg，推荐：

```bash
brew install ffmpeg
```

## JXR 支持说明

- Windows 下支持把 `.jxr`、`.wdp`、`.hdp` 作为输入图片
- 当前输出目标支持：`png`、`jpg`、`webp`、`gif`、`bmp`、`tiff`
- JXR 解码走的是 Windows 自带图像编解码器回退，再交给 FFmpeg 处理后续格式转换
- macOS 当前不支持直接解码 JXR / WDP / HDP，请先转成 PNG 或 JPG 再导入
