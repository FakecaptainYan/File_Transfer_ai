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

## 现在怎么直接打开

真正的 Electron 桌面版入口：

- [Apple Media Converter Desktop.vbs](C:\0_Project\Apple%20Media%20Converter%20Desktop.vbs)

它会直接使用你本机的 `electron.exe` 启动当前项目。

备用的独立窗口启动器：

Windows 下可以直接双击这个文件：

- [Apple Media Converter.vbs](C:\0_Project\Apple Media Converter.vbs)

它会自动：

- 启动本地服务
- 用独立应用窗口打开界面
- 不需要你手工开浏览器标签页

## Web 方式运行

```powershell
cd C:\0_Project
node server.js
start http://localhost:3000
```

## Electron 桌面版

项目已经补好了 Electron 桌面壳和打包配置：

- [desktop/electron-main.js](C:\0_Project\desktop\electron-main.js)
- [desktop/electron-preload.js](C:\0_Project\desktop\electron-preload.js)

如果依赖安装和外网下载正常，可以用下面命令打包 Windows 桌面版：

```powershell
cd C:\0_Project
cmd /c npm run start:desktop
cmd /c npm run dist:win
```

## JXR 支持说明

- 已支持把 `.jxr`、`.wdp`、`.hdp` 作为输入图片
- 当前输出目标支持：`png`、`jpg`、`webp`、`gif`、`bmp`、`tiff`
- JXR 解码走的是 Windows 自带图像编解码器回退，再交给 FFmpeg 处理后续格式转换

## 技术说明

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js 本地服务
- 桌面壳：Electron 代码已接入
- 转换引擎：本机 FFmpeg
- JXR 回退：Windows PresentationCore / WIC
