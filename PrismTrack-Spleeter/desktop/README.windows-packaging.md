# PrismTrack Windows Packaging

本目录用于在不改动原有 Web 业务代码的前提下，为 PrismTrack 提供 Windows 桌面封装层。

## 封装方式

- 使用 Electron 作为桌面壳
- 应用启动后自动拉起本地 `server.js`
- 使用 NSIS 生成安装包
- 安装时允许用户自定义安装路径
- 应用内外链通过系统默认浏览器打开

## 关键文件

- `desktop/main.cjs`: Electron 主进程，负责启动本地服务与窗口
- `.github/workflows/build-windows.yml`: GitHub Actions Windows 打包工作流
- `scripts/generate-icons.cjs`: 生成标准尺寸 PNG 与 `.ico` 图标集

## 图标输出

执行以下命令可生成 Windows 封装所需图标：

```bash
npm run generate:icons
```

输出目录：`build/icons/`

包含尺寸：`16, 24, 32, 48, 64, 128, 256`
