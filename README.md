# PrismTrack

PrismTrack 是一个基于 Spleeter 的音乐分轨项目，提供：

- Web 版分轨体验
- Windows 桌面安装包构建流程
- 多模型音轨分离与结果下载能力

当前仓库主要围绕 `PrismTrack-Spleeter/` 目录展开，包含前端页面、Node.js 后端、Spleeter 集成，以及 Electron Windows 打包配置。

## 核心能力

- 上传常见音频文件并执行分轨
- 支持 `spleeter:2stems`、`spleeter:4stems`、`spleeter:5stems`
- 支持试听、静音、单轨播放、音量控制
- 支持单独下载音轨或打包下载全部结果
- 提供 GitHub Actions Windows 安装包构建流程

## 仓库结构

- `PrismTrack-Spleeter/`: 主应用目录
- `.github/workflows/`: GitHub Actions 工作流
- `.monkeycode/`: 项目记忆、规范和规格文档

## 快速开始

Web 应用入口说明见：

- `PrismTrack-Spleeter/README.md`

在本地运行主应用：

```bash
# Install dependencies
cd PrismTrack-Spleeter && npm install

# Start the app
npm start
```

默认访问地址：`http://127.0.0.1:8000/`

## Windows 构建

仓库已包含 Windows 桌面应用打包 workflow，入口位置：

- `.github/workflows/build-windows.yml`

## 当前状态

当前分支正在持续完善：

- Windows 桌面运行时打包
- Spleeter 运行时集成
- 安装包产物整理

如果你要快速了解具体应用实现，请优先阅读：

- `PrismTrack-Spleeter/README.md`
- `PrismTrack-Spleeter/server.js`
- `PrismTrack-Spleeter/src/main.js`
