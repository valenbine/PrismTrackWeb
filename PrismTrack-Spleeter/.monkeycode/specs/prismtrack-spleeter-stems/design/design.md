# 歌曲分轨 Web 应用技术设计

## 1. 描述

项目名称: DemucsSeparater
功能: 基于 Demucs V4 的音乐源分离 Web 应用
技术栈: Node.js (后端) + 原生 HTML/CSS/JS (前端)
风格: 沿用 Chordino Web 深色霓虹主题

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Upload  │  │ Model   │  │ Progress│  │ Stems   │       │
│  │ Card    │  │ Select  │  │ Display │  │ Display │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
│       └────────────┴────────────┴─────────────┘            │
│                         │                                   │
│                    /api/stems                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                    Node.js Server                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Upload  │  │ Demucs  │  │ File    │  │ Zip     │       │
│  │ Handler │  │ Wrapper │  │ Manager │  │ Packer  │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
└───────┼───────────┼────────────┼────────────────────────────┘
        │           │            │
        ▼           ▼            ▼
   .runtime/   demucs cmd   separated/
   uploads     process      {job_id}/
                            ├── vocals.wav
                            ├── drums.wav
                            ├── bass.wav
                            └── other.wav
```

## 3. 前端组件

### 3.1 页面结构

- **Hero Section**: 标题与视觉装饰
- **Upload Card**: 文件上传区域
- **Model Selector**: Demucs 模型选择下拉框
- **Status Card**: 处理状态与进度
- **Stems Grid**: 分轨结果网格（4轨卡片）
- **Waveform Display**: 波形可视化

### 3.2 模型选择

支持以下 Demucs 模型:
- `htdemucs`: 标准 4 轨 (vocals/drums/bass/other)
- `htdemucs_ft`: Fine-tuned 版本
- `htdemucs_6s`: 6 轨版本 (含钢琴等)
- `mdx`: MDX 基础模型
- `mdx_q`: 量化版本

### 3.3 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 检查 Demucs 可用性 |
| `/api/models` | GET | 获取可用模型列表 |
| `/api/stems` | POST | 上传并处理分轨 |
| `/api/stems/:jobId` | GET | 查询处理状态 |
| `/api/download/:jobId/:stem` | GET | 下载单个音轨 |
| `/api/download/:jobId/all` | GET | 下载全部音轨 zip |

## 4. 后端实现

### 4.1 Demucs 调用

```javascript
// Demucs 命令行调用
demucs --out /path/to/output --model {model_name} {input_file}
```

输出目录结构:
```
separated/{job_id}/
  └── {model_name}/
      └── {filename}/
          ├── vocals.wav
          ├── drums.wav
          ├── bass.wav
          └── other.wav
```

### 4.2 进度追踪

使用 Server-Sent Events (SSE) 或轮询 `/api/stems/:jobId` 获取进度。

## 5. 安全性

- 文件大小限制: 120MB
- 文件类型验证: audio/*
- 路径遍历防护: 使用 job_id 而非用户输入路径
- 临时文件清理: 处理完成后删除原始上传文件

## 6. 参考

- Demucs GitHub: https://github.com/facebookresearch/demucs
- Chordino Web 源项目结构
