# CLAUDE.md

## 项目概述

**remora-plugin** — 面向 Antigravity AI Agent 运行时的认知安全插件。通过生命周期钩子（Hook）在 Agent 执行的关键阶段注入拦截逻辑，配合 SQLite 温存储层，实现上下文防腐（Anti-Context-Rot）、幻影写入检测（Phantom Detection）、子代理死锁自愈、僵尸进程清理、跨会话记忆持久化等功能。

### 仓库结构

```
remora-plugin/
├── packages/
│   ├── core/                          @remora/core — 纯逻辑层，零平台依赖
│   │   ├── src/
│   │   │   ├── storage/               SQLite DAO（11 个模块）
│   │   │   ├── rules/                 声明式安全规则引擎
│   │   │   ├── dao.ts                 DAO 统一出口（门面模式）
│   │   │   ├── index.ts               公开 API barrel export
│   │   │   ├── injection-formatting.ts  提示词模板（15+ 格式化函数）
│   │   │   ├── safety-policy.ts       安全策略常量与校验函数
│   │   │   ├── phantom.ts            幻影文件检测正则 + 差集算法
│   │   │   ├── liveness.ts            存活判定逻辑
│   │   │   ├── zombie.ts             僵尸进程判定（纯逻辑）
│   │   │   ├── policy.ts             统一魔术数字策略（SYSTEM_POLICY）
│   │   │   ├── gate.ts               去重门控（shouldFire/markFired）
│   │   │   ├── injector.ts           决策截断
│   │   │   ├── reader.ts             会话读取
│   │   │   ├── state-trim.ts         Hook 状态清理
│   │   │   ├── text-analysis.ts      文本分析（冲突检测 Prompt 构建）
│   │   │   ├── filesystem.ts         文件快照 / MD5 / diff
│   │   │   ├── coverage.ts           置信度计算 / UUID 继承链验证
│   │   │   └── logger.ts             结构化日志
│   │   ├── schema/schema.sql         DDL + FTS5 trigram 触发器
│   │   ├── conf/                     配置文件（keywords.json, features.json, approval.json）
│   │   └── tests/                    21 个测试文件，~381 个用例
│   │
│   └── adapter-antigravity/          @remora/antigravity-plugin — Antigravity 绑定层
│       ├── src/
│       │   ├── hooks/                8 个生命周期钩子
│       │   │   ├── zombie-detector.ts    扫描 /proc 查找僵尸进程
│       │   │   ├── snapshot-git.ts       调用前 git diff 快照
│       │   │   ├── session-guardian.ts   会话状态管理 + 子代理心跳续期
│       │   │   ├── tone-injector.ts      语气纪律注入
│       │   │   ├── cognitive-push.ts     冷启动决策注入 + 写门禁 + 语义冲突(Line C)
│       │   │   ├── safety-check.ts       双层安全防线（规则引擎 + CoR 动态链）
│       │   │   ├── action-gate.ts        PostInvocation 幻影检测
│       │   │   └── rule-runner.ts        规则引擎懒加载运行器
│       │   ├── bridge/               11 个 Antigravity API 桥接模块
│       │   ├── sidecar/              8 个守护进程模块（compactor, sync, extract 等）
│       │   ├── sandbox/              4 个沙箱模块（探活、监控、合并、僵尸清理）
│       │   ├── cli/                  6 个 CLI 工具
│       │   ├── debug/                3 个调试工具
│       │   ├── maintenance/          4 个 GC/清理模块
│       │   ├── mcp/                  1 个 MCP 服务（git-mcp, stdio JSON-RPC 2.0）
│       │   ├── schema/               schema-init.ts（增量迁移）
│       │   └── install.ts            物理隔离部署脚本
│       ├── conf/remora-rules.json    声明式安全规则（9 条 JSON 规则）
│       └── tests/                    22 个测试文件，~499 个用例
│
├── conf/                             项目级配置
├── hooks.json                        渲染后的 Hook 注册表
├── plugin.json                       插件元数据（含中文触发关键词）
├── mcp_config.json                    MCP 服务配置
├── biome.json                        格式化/lint 配置
├── deploy.sh                         一键构建 + 部署脚本
├── docs/                             项目文档
└── .github/                          CI/CD 配置
```

## 构建与测试

```bash
# 构建
cd packages/core && npm run build                # tsc → dist/
cd packages/adapter-antigravity && npm run build # tsup/esbuild → dist/
./deploy.sh                                      # 一键构建 + 物理部署

# 测试（总计 ~880 个用例，零 skip）
cd packages/core && npm test                    # vitest，~381 个用例
cd packages/adapter-antigravity && npm test      # vitest，~499 个用例

# 代码质量
npx biome format --write .                       # 格式化（tab 缩进，双引号）
npx biome lint .                                 # 静态检查
```

## 架构规则（强制）

### 1. Core 禁止依赖 Adapter
`core/src/**` 中的任何 `.ts` 文件不得 import `adapter-antigravity`。由 `packages/core/tests/test_architecture.test.ts` 静态扫描强制执行，违反即构建失败。

### 2. 所有 DB 访问通过 DAO 门面
数据库读写必须经过 `packages/core/src/dao.ts` 的统一入口（再导出全部 storage 模块函数）。禁止在 DAO 之外直接调用 `better-sqlite3`。

### 3. 禁止硬编码路径
使用 `findPluginRoot()`、`getDataDir()`、`getBrainDir()` 或环境变量 `REMORA_DB_PATH`。不得假定 `{PLUGIN_ROOT}` 或 `/tmp/`。

### 4. Hook 响应结构严格约束
Hook 的 JSON 输出必须符合 `PreToolUseResponse` / `PreInvocationResponse` 类型定义（位于 `adapter-antigravity/src/types.ts`）。未识别的 JSON key 会导致 Antigravity 的 `protojson` 反序列化器崩溃。调试输出走 `stderr`（`console.error` / `console.debug`），不得混入 payload。

### 5. 新代码归属规则

| 如果依赖... | 放在... |
|---|---|
| `conversation.db`、agentapi、Hook 协议、`/proc` 扫描、Antigravity API | `packages/adapter-antigravity/src/` |
| 纯数据结构、算法、SQLite DAO、规则引擎、提示词模板 | `packages/core/src/` |

## Hook 生命周期

Hook 在 `hooks.json` 中注册。按阶段顺序执行：

| 阶段 | Hook（按执行序） | 触发时机 |
|---|---|---|
| **PreInvocation** | zombie-detector → snapshot-git → session-guardian → tone-injector → cognitive-push (pre-invoke) → check-subagents-liveness | 每次 Agent 调用开始前 |
| **PreToolUse** | zombie-detector（全工具）、safety-check（危险工具）、cognitive-push（写工具） | 每次工具调用前，支持 matcher 过滤 |
| **PostInvocation** | action-gate（幻影检测） | 每次 Agent 调用完成后 |
| **Stop** | compactor（事件驱动）、clean-session-stats、check-subagents-liveness | Agent 会话停止时 |

### safety-check.ts — 双层安全防线（核心 Hook）

1. **规则引擎层**（声明式）：JSON 规则（`remora-rules.json`，9 条规则）由 `RuleEngine` 按优先级降序评估，match 即返回。引擎异常 → fail-closed → deny。
2. **动态规则链**（命令式）：13 个 `DynamicRule` 纯函数组成责任链（CoR），依次执行，首个非 undefined 结果胜出。覆盖：
   - 时间线清理（`trimStaleHookStates`）
   - 子代理重复 spawn 检测（3 分钟窗口去重）
   - Prompt 语法截断校验
   - JIT 子代理调度注入
   - 内置 Agent 权限覆盖防护
   - 共享工作区路径穿越检测
   - `send_message` 轮次限制
   - 统一读取累积熔断（view_file + grep_search）
   - Git MCP 写操作权限门禁（仅 Merger 子代理可写）
   - 按子代理类型的命令审计（Merger / ReadOnly / DeepDiver / Main）

## 数据库

SQLite，WAL 模式 + NORMAL 同步。FTS5 trigram 分词器支持中文全文检索。

### 核心表

| 表名 | 用途 |
|---|---|
| `project_topics` | 按项目 UUID 隔离的话题，含状态、摘要、来源、关联文件 |
| `topic_decisions` | 架构决策记录，含决策文本、原因、证据消息 ID、用户确认标记、注入计数 |
| `messages` + `messages_fts` | 原始消息 + FTS5 全文索引（trigram 分词） |
| `watermarks` | 项目-会话维度的消息处理水位线 |
| `artifact_hashes` | 制品文件 MD5 缓存，用于增量搜刮 |
| `session_state` | 会话模式（strict/relax）、冷启动标记 |
| `runtime_hook_state` | 跨进程 Hook 状态存储（session, turn, key, value） |
| `file_changes` | 文件物理变更追踪 |
| `remora_event_queue` | 物理事件同步队列（多项目隔离） |

### 数据库迁移

增量迁移策略：`schema-init.ts` 通过 try-catch `ALTER TABLE ADD COLUMN` 探测缺失列并补充。迁移前自动创建 `.db.bak` 冷备份。`data/` 目录在 rsync 部署时排除，用户数据不会被覆盖。

## 部署

开发目录（`~/wsl_code/remora-plugin`）和运行目录（`{PLUGIN_ROOT}`）物理分离。

`./deploy.sh` 流程：
1. `npm --prefix packages/core run build`（tsc）
2. `npm --prefix packages/adapter-antigravity run build`（tsup/esbuild）
3. `node packages/adapter-antigravity/bin/install.js --force`（rsync 同步 + 清除源文件）

运行目录清理项：`src/`、`tests/`、`tsconfig*.json`、`*.d.ts`、`node_modules/.vite/`

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `REMORA_DB_PATH` | `~/.remora/data/remora_memory.db` | SQLite 数据库路径 |
| `REMORA_LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `REMORA_LOG_DIR` | `$TMPDIR/remora/log` | 日志目录 |
| `REMORA_TRACE_ID` | 自动生成 `s_<8-hex>` | 追踪关联 ID |
| `REMORA_HOOKS_PROFILE_LOG` | `~/.remora/data/hooks_profile.log` | Hook 耗时分析日志 |

## 关键设计模式

- **DAO 门面**（`core/src/dao.ts`）：所有 storage 模块的单一 barrel 再出口 + gate + connection。所有 DB 操作流经此入口。
- **Barrel Export**（`core/src/index.ts`）：`@remora/core` 的完整公开 API 面。
- **责任链（CoR）**（`safety-check.ts`）：`dynamicRules` 数组，每个函数签名为 `(DynamicRuleContext) => PreToolUseResponse | undefined`，首个非 undefined 即为最终裁决。
- **JIT 注入**：一次性临时消息注入模型上下文（如子代理启动后的调度提醒），通过 `runtime_hook_state` 标记防止重复注入。
- **去重门控**（`core/src/gate.ts`）：`shouldFire()` / `markFired()` / `isDuplicate()` — 基于 `runtime_hook_state` 的字符串值比较去重。
- **Fail-Closed 安全原则**：规则引擎异常 → deny；动态规则链异常 → throw → 上层 catch → deny。
- **文件快照 diff**（`action-gate.ts`）：PreInvocation 时拍快照，PostInvocation 时 diff 比对，交叉验证模型声称修改 vs 物理实际修改。
- **特征开关**：`conf/features.json` 控制注入行为，如 `semantic_conflict_detection`（实验性，当前 OFF）。

## 幻影检测机制

`action-gate.ts` 在 PostInvocation 阶段执行，通过四层设计实现：

1. **正则匹配**：7 组中英文动词正则（`ACTION_PATTERNS`）从模型 PLANNER_RESPONSE 文本中提取"声称已修改"的文件名
2. **工具调用提取**：从 transcript 中提取实际 `write_to_file` / `replace_file_content` / `multi_replace_file_content` 调用的 TargetFile
3. **物理快照 diff**：`getPhysicalModifications()` 对比 pre/post 文件快照，获取实际变更文件集合
4. **差集计算**：`resolvePhantomModifications(claimed, actual)` → phantom 文件集合

发现 phantom → 首次注入警告 + `force_continue`；重复 phantom → 注入更强警告。

## 子代理存活自愈

`check-subagents-liveness.ts` 实现的分级探活机制：

- **数据源**：progress.json（进度哨兵）+ SQLite messages 表（最新非用户消息）
- **分级超时**：60s（常规工具）/ 180s（集成测试/构建等重工具）
- **判定逻辑**：`blocked` 状态 → dead；最后活跃时间超过阈值 → zombie → dead
- **自愈 SOP**：检测到死代理 → 注入 `manage_subagents(Action='kill')` 指令 + 僵尸进程清理 + 数据库锁检查
- **心跳续期**：`session-guardian.ts` 检测到子代理活跃但缺少 schedule 定时器 → 注入 `schedule(DurationSeconds="60")` 指令

## 写门禁（Write Gate）

`cognitive-push.ts` 的 `_handlePreToolUse()` 实现：

- **首次写入**：非规划制品文件 → deny + 注入 `formatWriteGateDenyPrompt()`（要求解释意图）
- **二次重试**：同回合内再次调用同一文件的写入工具 → 自动放行 + 注入关联历史决策
- **规划制品豁免**：`/artifacts/task.md`、`implementation_plan.md`、`walkthrough.md` 等文件直接放行

## 测试架构

- Core 测试：纯逻辑单元测试，mock 数据库连接
- Adapter 测试：集成测试，`vitest.setup.ts` 在测试前后备份/恢复 `conf/keywords.json`
- `test_architecture.test.ts`：静态 AST 扫描所有 core 源文件，确保无 adapter 依赖

## 提交规范

```
[Phase XX Report] <简要标题>

Changelog:
- <文件路径>:
  * <详细变更条目>
  * ...

Co-Authored-By: Claude <noreply@anthropic.com>
```
