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
