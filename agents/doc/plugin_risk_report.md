# Remora Plugin 风险报告
> 评估对象：`~/.gemini/config/plugins/remora-plugin`
> 评估基准：`~/wsl_code/remora/` Remora 认知架构设计文档 (v6)
> 交叉校验：15 份架构 Review 决策历史 + 两轮代码审计
> 评估日期：2026-06-03（第二轮更新）

---

## 一、设计偏离风险（与 Remora 概念的差距）

### 1.1 话题管理：全自动 vs 用户控制

| 项目 | 描述 |
|------|------|
| **Remora 要求** | 手动打标为主（`/topic new/switch/close`），边界由用户显式管理。「不追求全自动话题切分。手动打标是经过深思熟虑的设计选择，不是临时妥协。」（`concept.md:105`） |
| **插件现状** | `compactor.py:453-465` 通过 LLM prompt 全自动提取话题和决策，`topic_id` 由 LLM 生成（`t_001`, `t_002`）。**已新增** `remora-topic.py` 支持手动 `new/switch/close` 命令，配合 `topic.md` workflow。 |
| **Review 历史佐证** | v1-gemini 将「话题解耦能力瓶颈」列为第一大巨坑。v2-gemini 将「半自动打标」评为最惊艳设计之一。v5-doubao 对「手动 Topic 为主」评分 10/10。 |
| **当前评估** | 手动控制基础设施已就位（`remora-topic.py` + topic workflow），但 `compactor.py` 的自动提取与手动打标之间**未建立互认关系**——手动创建的话题不会被 compactor 自动消费，compactor 仍独立生成自己的 topic。两条路径并行但割裂。 |
| **严重程度** | **中**（从「高」降级：控制面存在，整合未完成） |
| **剩余工作** | `compactor.py` 的 LLM 提取 prompt 中增加「优先匹配已有手动话题」的约束；或者将 compactor 的自动提取从「创建话题」降级为「为已有话题追加决策」。 |

### 1.2 硬锚点机制：基础设施就位，闭环待完善

| 项目 | 描述 |
|------|------|
| **Remora 要求** | `user_confirmed: true` 的决策进入「不可绕过的压缩保留校验清单」。压缩时强制保留，不可静默丢弃。（`concept.md:76`） |
| **插件现状** | `schema.sql:24` 已有 `user_confirmed` 列。`compactor.py:502` 正确读取 LLM 输出中的 `user_confirmed` 字段。`remora-topic.py:93-106` 支持 `/confirm <decision_id>` 手动打标。`consume_event_queue:671-736` 支持 Plan 审批后自动批量确认。`confirm.md` workflow 定义了 `/confirm` 指令的处理流程。 |
| **仍缺失** | ① compactor 的压缩逻辑中尚未对 `user_confirmed=1` 的决策做**强制保留校验**（即当前压缩从未发生，无此代码路径，但需在引入压缩功能时作为前置条件加入）；② 无 `/unconfirm` 撤销确认的能力。 |
| **严重程度** | **低**（从「致命」降级：核心数据流已贯通，剩余工作属于压缩阶段的防御性补充） |
| **剩余工作** | 未来引入压缩时，在 prompt 中明确标注 `user_confirmed=1` 的决策为「不可删除」并附交叉校验逻辑。 |

### 1.3 压缩可信度校验：仍未实现

| 项目 | 描述 |
|------|------|
| **Remora 要求** | 压缩前提取决策清单 → 压缩后计算 pass rate → 输出 `compression_confidence`（客观比值，不依赖 LLM 自我评估）。若 < 0.7，在下次回复中插入警告。（`architecture.md:165-166`） |
| **插件现状** | `schema.sql:10` 定义了 `compression_confidence` 列。`compactor.py` 从未计算或写入该值——始终为默认 1.0。 |
| **Review 历史佐证** | v2-gemini 将 Checksum 评为「最惊艳的设计之一」。v5-deepseek 警告 Checksum 的盲区。v5-qwen 将 Checksum 机制评为「神来之笔」。 |
| **严重程度** | **中** |
| **剩余工作** | `compactor.py` 在 LLM 提取前先对本次增量对话做关键决策清单快照；提取后做交叉比对，写入 `compression_confidence`；低于 0.7 时在 `intent-detector.py` 中注入 low-confidence 警告。 |

### 1.4 子代理执行隔离：合并侧完成，创建侧依赖平台

| 项目 | 描述 |
|------|------|
| **Remora 要求** | Git Worktree 隔离（三层回退）。用完即焚，变更差异由用户确认后应用。（`architecture.md:183-188`） |
| **插件现状** | ① `safety-check.py:280-293` 强制要求 `Deep_Diver` 指定 `Workspace='branch'` 或 `'share'`；② `sandbox-merge.sh` 实现了沙箱变更的自动合并；③ `remora-topic.py:107-126` 在 `/confirm` 时自动触发沙箱合并；④ Worktree 的**创建**由宿主平台（Antigravity）在 `invoke_subagent` 时自动完成，插件自身不负责创建。 |
| **严重程度** | **低**（从「中」降级：宿主导入解决了创建问题，合并闭环已由 sandbox-merge.sh + remora-topic.py 完成） |

### 1.5 平台依赖（已接受的设计取舍）

| 项目 | 描述 |
|------|------|
| **Remora 长期愿景** | 独立 CLI/TUI 客户端，可附加到任何 Coding Agent。 |
| **插件现状** | 完全依赖 Antigravity/Gemini 的 hook 机制、`agentapi` CLI、特定目录结构、`sidecar.json` 调度系统。 |
| **取舍理由** | 从零构建一个完整 coding agent 的成本远高于在现有平台上做 Remora 概念验证。hook/agentapi/sidecar 已提供了 PreInvocation、PreToolUse、PostInvocation、Stop 等注入点，等价于独立 agent 内置的拦截器框架。此依赖是务实的第一步，不是设计缺陷。Remora 概念文档定义的「独立 CLI」属于远期目标（Phase 3+），当前阶段优先验证核心记忆管线。 |
| **严重程度** | **不列为风险**（已接受的设计取舍；未来 Phase 3 独立化时需处理） |

---

## 二、高容错场景劣化风险

> 以下问题均已修复或大幅改善。

### ~~2.1 强制性语气注入~~ ✅ 已修复

`tone-injector.py` 现已通过 `/tmp/remora_session_modes/` 缓存读取由 `intent-detector.py` 写入的会话 mode。strict 模式才注入 tone 约束，relax 模式完全放行。

### ~~2.2 关键词误触发~~ ✅ 已修复（措辞可进一步软化，但不构成风险）

`keywords.json` 已拆分为 `hard_keywords` 和 `soft_keywords` 两组。`intent-detector.py:127-132` 实现了分级匹配：hard 词始终触发，soft 词仅在 strict 模式下触发。relax 模式（含 brainstorm/draft/design 等场景）中 soft 词不触发，消除了对发散性对话的打断。当前注入消息仍为 `STOP GUESSING`，措辞偏强制但功能上不会再误打断 relax 模式对话。

### ~~2.3 safety-check.py 过度阻断~~ ✅ 无需修改

`rot_reason`（~270 字符）之前在报告中被标记为「token 浪费建议缩短」。重新评估后撤回此建议：该消息不只是拒绝通知，它内嵌了两条合法替代路径的完整描述（ReadOnly_Extractor / Deep_Diver + Workspace 要求），本质上是**一次注入、多轮锚定的微型 workflow**。若缩为一行，agent 被拒后大概率换一种写法重试 → 再次被拒 → 形成拒绝-重试循环，总 token 消耗反而更高。长消息一次性支付、多轮摊销，ROI 为正。阻断逻辑本身范围精准（仅限 `.jsonl`/`.log`/`.sqlite` + 体积熔断），relax 模式下体积阈值放宽至 200KB。

### ~~2.4 action-gate.py 虚报检测误判~~ ✅ 已修复

`action-gate.py:246-248` 在 relax 模式下直接放行。`action-gate.py:281-287` 增加了未来时态/建议语态前缀过滤（`建议|可以|将|应该|考虑|不妨|不如|should|suggest|would|could|might|will|planning to|consider`），不再将讨论性文件引用误判为 phantom modification。

---

## 三、插件已正确实现的决策

| # | 设计决策 | 插件实现 | 状态 |
|---|---------|---------|------|
| 1 | **FTS5 trigram 分词器** | `schema.sql:53` — `tokenize='trigram'` | ✅ |
| 2 | **SQLite WAL 模式** | `schema.sql:1` — `PRAGMA journal_mode=WAL` | ✅ |
| 3 | **水位线增量处理 + Undo 自愈** | `compactor.py:251-333` | ✅ |
| 4 | **检索结果时序升序** | `remora-recall.sh:81` — `ORDER BY m.id ASC` | ✅ |
| 5 | **双通道召回** | `remora-recall.sh:70-110` — 通道 A FTS5 + 通道 B 直接匹配 | ✅ |
| 6 | **流式读取防 OOM** | 所有脚本均使用 `tail -n`，0 处 `f.readlines()` | ✅ |
| 7 | **意图检测「提示模式」** | `intent-detector.py` 注入 ephemeralMessage 而非硬拦截 | ✅ |
| 8 | **子代理分层（只读 + 读写）** | `remora_readonly_extractor.json` + `remora_deep_diver.json` | ✅ |
| 9 | **防御性降级（异常 = 放行）** | 所有脚本全局 try-except 返回 allow / 空 injectSteps | ✅ |
| 10 | **MD5 增量制品同步** | `compactor.py:546-615` | ✅ |
| 11 | **hard/soft 关键词分级** | `keywords.json` + `intent-detector.py:127-132` | ✅ |
| 12 | **relax/strict 模式自适应** | `intent-detector.py:109-116` 写入缓存，所有下游脚本读取 | ✅ |
| 13 | **action-gate 未来时态滤除** | `action-gate.py:281-287` | ✅ |
| 14 | **tone-injector 条件化** | `tone-injector.py:46` 仅在 strict 模式注入 | ✅ |
| 15 | **手动话题管理命令** | `remora-topic.py` new/switch/close | ✅ |
| 16 | **手动决策确认 `/confirm`** | `remora-topic.py` confirm + `consume_event_queue` 自动确认 | ✅ |
| 17 | **Workflow 指令体系** | `remora_coordinator.md` / `confirm.md` / `topic.md` / `retro.md` | ✅ |
| 18 | **Sandbox 强制隔离拦截** | `safety-check.py:280-293` + `sandbox-merge.sh` | ✅ |

---

## 四、综合评估

```
插件 vs Remora 概念匹配度（第二轮审计）：

  技术基础设施  ██████████████████████  95%  (SQLite/FTS5/水位线/cron/trigram/WAL + 全部 tail -n)
  防御性设计    ██████████████████░░░░  85%  (Anti-Context-Rot + 降级放行 + 分级触发 + 语气条件化 + 虚报过滤)
  记忆召回      ██████████████████████  95%  (双通道 FTS5 + LIKE + 时序升序 + 项目隔离)
  决策记录      ████████████████░░░░░░  80%  (decision + rationale + user_confirmed 读写 ✅；confidence ❌)
  执行隔离      ██████████████░░░░░░░░  60%  (子代理分层 + 强制 branch/share ✅；Worktree 由平台提供)
  用户控制      ██████████████░░░░░░░░  70%  (/topic + /confirm + /recall 全部有 ✅；compactor 自动提取未与手动整合)
  场景自适应    ████████████████░░░░░░  75%  (relax/strict 模式在 tone/action-gate/safety-check/intent 全部贯通 ✅)
  *平台依赖     已接受为设计取舍，不计入失分

综合匹配度 ~80%
```

---

## 五、最终结论

第二轮审计后，风险格局发生了实质性变化：

**第一轮报告中的 6 个高风险项，现仅剩 2 个（话题整合 + compression_confidence）。** 其余均已修复或降级：
- 2 项完全修复（语气注入、虚报检测误判）
- 3 项大幅改善（硬锚点、子代理隔离、关键词误触发）
- 1 项平台锁定属于架构性取舍，短期内不会改变

插件现在是一个**可用的 Remora 温存储+子代理分发+用户控制面板**。核心漏洞在 `compactor.py` 的自动提取与手动话题管理的整合，以及 `compression_confidence` 的计算——这两项对应 Remora concept 中最深的「Checksum」哲学，完成它们后插件与 Remora 概念的匹配度将超过 90%。
