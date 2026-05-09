# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [代码结构|代码模式|代码生成|构建方法|测试方法|依赖关系|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[确认产品命名为 PrismTrack]
- Date: 2026-05-04
- Context: 用户确认基于 Spleeter 的音乐分轨 Web 应用命名
- Instructions:
  - 项目名称统一使用 PrismTrack

[基于 Demucs 参考项目做 Spleeter 改造]
- Date: 2026-05-04
- Context: 用户要求参考现有源码开发并保持前端风格功能一致
- Instructions:
  - 前端风格与交互功能保持和参考项目一致
  - 后端分离模型从 Demucs 替换为 Spleeter
  - 相关文件夹命名改为 Spleeter 与 PrismTrack 相关，不保留原 Demucs 命名

[为项目增加 Windows 封装工作流]
- Date: 2026-05-04
- Context: 用户要求在不改原本 Web 应用代码的前提下，新增 GitHub Windows 应用封装能力
- Instructions:
  - 不修改原本 Web 应用业务代码，采用新增封装层的方式实现 Windows 应用
  - 安装程序需要支持用户选择安装路径
  - 生成符合标准的应用 ICO 多尺寸图标资源
  - 程序内超链接需使用 Windows 默认浏览器打开

[记录 Lazy Model Fetch 方案]
- Date: 2026-05-06
- Context: 用户要求先记住一个暂不实施的安装包优化方案，便于后续直接引用
- Instructions:
  - 方案名使用 Lazy Model Fetch
  - 该方案指 Windows 安装包不内置 Spleeter 模型权重文件
  - 用户首次使用某个 Spleeter 模型时再下载对应权重到本地缓存目录
  - 下载过程需要在现有 Web 状态区显示模型权重下载进度
  - 该方案后续实施时应尽量不改变原有 Web 项目的页面结构与主要交互

[SpleeterGUI Windows 运行时对照基线]
- Date: 2026-05-08
- Context: Agent 在执行 SpleeterGUI Windows 发布包实物分析时发现
- Category: 环境配置
- Instructions:
  - SpleeterGUI 2.9.4 的 Windows 运行时基线为 Python 3.7、Spleeter 2.3.1、TensorFlow 2.5.0
  - 发布包内置 python 目录与 ffmpeg.exe/ffprobe.exe/ffplay.exe，不依赖系统 PATH 提供这些可执行文件
  - 发布包预留 pretrained_models 目录但默认不内置模型，首次运行时下载模型到本地缓存
  - Windows 运行仍依赖系统已安装 VC Runtime，发布包内未发现 vcruntime140.dll 与 msvcp140.dll

[PrismTrack Spleeter 模型缓存目录约定]
- Date: 2026-05-08
- Context: Agent 在执行 PrismTrack 后端模型缓存接线时发现
- Category: 环境配置
- Instructions:
  - 后端统一使用环境变量 MODEL_PATH 或 SPLEETER_MODEL_PATH 指向 Spleeter 本地模型缓存根目录
  - 未显式配置时默认使用 PrismTrack-Spleeter/pretrained_models
  - 每个模型目录按 2stems、4stems、5stems 分目录存放，并以 checkpoint、model.data-00000-of-00001、model.index、model.meta 作为完整性检查基线

[PrismTrack Windows 桌面封装层约定]
- Date: 2026-05-08
- Context: Agent 在恢复最小 Windows Electron 宿主层时发现
- Category: 代码结构
- Instructions:
  - Windows 桌面层应保持最小职责，只负责启动本地 server.js 并在桌面窗口中承载 Web UI
  - 外部链接统一通过系统默认浏览器打开，不在应用内新开不受控窗口
  - 应用级运行目录使用 Electron userData，下挂 .runtime 与 pretrained_models，避免写入安装目录
  - Windows 安装包继续采用 NSIS，并允许用户自定义安装路径

[PrismTrack Windows 桌面启动前校验约定]
- Date: 2026-05-08
- Context: Agent 在补充 Electron 主进程错误提示时发现
- Category: 代码模式
- Instructions:
  - Windows 桌面主进程在启动本地 server.js 前，应先校验 python/python.exe、ffmpeg.exe、ffprobe.exe 与 scripts/spleeter_separate.py 是否存在
  - 若关键运行时文件缺失，应直接弹出包含缺失文件清单和检测目录的中文错误提示，而不是仅等待服务启动超时报错

[PrismTrack Windows CI 打包约定]
- Date: 2026-05-08
- Context: Agent 在修正 GitHub Actions Windows 打包流程时发现
- Category: 构建方法
- Instructions:
  - Windows 打包 workflow 位于仓库根目录 .github/workflows/build-windows.yml，工作目录固定为 PrismTrack-Spleeter
  - CI 在执行 npm run dist:win 前需校验 python/python.exe、ffmpeg.exe、ffprobe.exe、ffplay.exe、scripts/spleeter_separate.py 是否存在
  - CI 打包产物统一从 PrismTrack-Spleeter/dist 上传，至少包含 .exe 安装包

[PrismTrack Windows 桌面启动日志约定]
- Date: 2026-05-09
- Context: Agent 在处理 Windows 安装包启动超时时发现
- Category: 代码模式
- Instructions:
  - Windows 桌面主进程启动日志写入 Electron userData 下的 logs/desktop.log
  - Windows 预期日志路径为 %APPDATA%/PrismTrack/logs/desktop.log，启动失败弹窗应提示该路径
  - packaged Electron 使用 process.execPath 启动 server.js 时需要设置 ELECTRON_RUN_AS_NODE=1
  - 每次修改桌面启动链路时应更新 DESKTOP_RUNTIME_CHECK_REV，便于区分用户运行的安装包版本
