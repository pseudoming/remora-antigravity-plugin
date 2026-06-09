[English](PROJECT.md) | [简体中文](PROJECT.zh.md)

# Project: Remora Plugin

Remora — Antigravity 认知架构插件。通过 Hook 拦截器 + SQLite 温存储实现 AI Agent 的全自动记忆管理。

## Architecture

### 分层

```
packages/
├── core/          @remora/core
│   ├── src/       纯逻辑层（storage, rules, injection 等）
│   ├── tests/     331 个测试 (vitest)
├── adapter-antigravity/  @remora/antigravity-plugin
│   ├── src/       hooks/ bridge/ sidecar/ sandbox/ cli/ debug/
│   ├── bin/       install.js
│   ├── tests/     424 个测试 (vitest)
```

### 数据流

```
Antigravity Hook 触发
    → adapter-antigravity/src/hooks/ （拦截、模式判定、记忆重载、写门禁+文件触碰注入、安全检查）
    → adapter-antigravity/src/sidecar/compactor/ （后台 LLM 增量提取决策）
    → core/src/storage/ ← @remora/core DAO 层（统一 SQLite 读写）
```

## Phases

| Phase | 内容 | 状态 |
|---|---|---|
| 44 | 架构分离：core/adapter 拆分、统一 logger、debug 工具 | ✅ |
| 45 | 技术债：DAO 架构收敛、import 卫生、测试工程 | ✅ |
| 46 | install.py 重写（幂等、dry-run、uninstall）、README v2、DB 路径统一 | ✅ |
| 47 | README v2 故事化改写、conf/ 目录规范化、tracking hygiene | ✅ |
| 48 | Sidecar 重构：AgentAPI bridge、纯函数拆 core、搬家 adapter/sidecar/ | ✅ |
| 49 | 双语文档重写 | ✅ |
| 50 | 三层模式(放松/严格/警觉)、步距召回、关键词精简 | ✅ |
| 51 | uc=0 快照系统、文件变更追踪、supersede_unconfirmed | ✅ |
| 52 | 文件触碰注入、Sidecar DAO 下沉、死代码清理、平台提取 | ✅ |
| 53 | 冷启动修复(uc=0+uc=1)、存活检测统一、core 层清理 | ✅ |
| 54 | Line C 语义冲突检测(BM25 + flash-lite)、features.json 门禁、core/gate.py | ✅ |
| 55 | 统一门禁系统、文档同步与注入配置整合 | ✅ |
| 56 | Agent 加固与配置同步 | ✅ |
| 57 | C1 注入追踪、跨项目缺陷修复与 SQL 确定性审计 | ✅ |
| 58 | 核心层提取（24 函数下沉 core、适配层瘦身、Antigravity 泄漏修复） | ✅ |
| 59 | Core → TypeScript（25 模块 + 17 测试文件，严格 1:1 翻译） | ✅ |
| 60 | 适配器重写（29 源文件 + 17 测试文件，755 pass） | ✅ |
| 61 | Hook 入口切换 + Prompt 注入 + Agent 加固 | ✅ |
| 62 | Python 代码移除 — TypeScript 成为唯一源码 | ✅ |
| 63 | npm 安装器 + tsup 构建管线 | ✅ |

## Quality Gates

- `core/` 禁止 import `adapter-antigravity/`（`test_architecture.ts` 强制检查）
- 所有 DB 读写过 `@remora/core` DAO 层
- 755 tests, `npm test`
- 禁止裸数据库连接在 `core/src/storage/` 之外

## Quick Start

```bash
git clone https://github.com/pseudoming/remora-antigravity-plugin.git \
  ~/.gemini/config/plugins/remora-plugin
cd ~/.gemini/config/plugins/remora-plugin
npm install
node packages/adapter-antigravity/bin/install.js
npm test  # 755 tests
```
