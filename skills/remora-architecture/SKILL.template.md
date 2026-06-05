---
name: remora-architecture
description: Executes tasks using Remora cognitive architecture. Use this skill when you encounter context-rot, memory loss, dirty environments, or need to orchestrate deep debugging and isolate massive logs.
---

# Remora Coordinator Mode Instructions

You are now in Remora Coordinator Mode. You must strictly follow these instructions to prevent context rot and maintain cognitive stability.

## 1. Subagent Delegation (Mandatory)
You MUST NOT execute shell commands that return large logs in your own context.
You MUST use the `invoke_subagent` tool with `TypeName: "Remora_Deep_Diver"`.
**CRITICAL**: You MUST pass `Workspace: "branch"` to physically isolate execution and protect the main workspace from dirty states.

## 2. Global State Database (Single Source of Truth)
The definitive long-term memory and architectural state of this project is stored in an SQLite database located at:
`sidecar_data/remora-plugin/memory-compactor/data/remora_memory.db`.
This database is automatically populated and maintained by the background `compactor.py` (running in singleton mode). You MUST treat this database as the ONLY Single Source of Truth (SSOT).
You MUST NOT manually write decisions to files like `decisions.md` for historical architecture anchoring.

## 3. Active Recall via Warm Storage
If you are unsure about past decisions, encounter an architectural keyword (e.g., 'compactor', 'database', 'agentapi'), or if a user challenges your memory, NEVER GUESS.
You MUST proactively use the `run_command` tool to execute the official retrieval script:
`{PYTHON} {PLUGIN_ROOT}/scripts/remora-recall.py "<YOUR_KEYWORD>"`
**CRITICAL**: You MUST NOT use `grep_search` on any legacy text logs to blindly guess historical context. The `remora-recall.py` script is the EXCLUSIVE authorized method to access the `remora_memory.db` SSOT.

## 4. Subagent Delegation Rules (Differentiated)
- **ANTI-CONTEXT-ROT**: For long-chain debugging, massive log analysis, or risky operations, you are STRICTLY PROHIBITED from executing commands directly. You MUST first use `view_file` to read the `remora-architecture` skill instructions, and then use `invoke_subagent` for isolated execution:
  * **Read-Only Log Analysis / Evidence Retrieval / DB Query**: Use `invoke_subagent` with `TypeName: "Remora_ReadOnly_Extractor"` and `Prompt` explaining the facts to retrieve.
  * **Sandbox Debugging / Build Verification / Code Modifying**: Use `invoke_subagent` with `TypeName: "Remora_Deep_Diver"` and `Prompt` specifying the diagnostic or writing tasks.
- **HEARTBEAT & ZOMBIE DETECTION (心跳与卡死探活防线)**:
  * Whenever you invoke a subagent, you MUST simultaneously call the `schedule` tool to set a 60-second one-shot timer (the exact `Prompt` command will be injected to you via a system reminder, use it exactly as provided).
  * If the subagent finishes earlier, the timer is automatically canceled.
  * If the timer fires and wakes you up, you MUST run the exact monitor command injected in the system reminder to assess the state.
  * If the monitor output JSON contains status "not_found" or "empty", assume initialization and wait by resetting a 60s schedule.
  * If status is "active", you MUST print a brief, user-facing liveness report to keep the user informed (e.g., "🔍 **心跳存活反馈**: 子特工正在执行工具 `<last_tool>`，目前正常运行").
    Then:
    1. Silently call the `schedule` tool to set a new 60-second timer.
    2. Exit the current turn immediately.
  * If zombie, check the `action_suggestion` in the monitor output:
    - If 'kill_and_retry': You MUST immediately call `manage_subagents(Action='kill', ConversationIds=['<subagent_id>'])` to terminate it, and then call `invoke_subagent` to spawn a new one to retry the task.
    - If 'escalate_to_human': You MUST immediately call `manage_subagents(Action='kill', ConversationIds=['<subagent_id>'])` to terminate it, stop automatic retries, report the double failure to the user, and request human intervention.
- **SANDBOX BOUNDARY**: Under Deep_Diver, match your actions to the blast radius. Do not use destructive shortcuts (e.g. bypass hooks, delete locks). Under ReadOnly_Extractor, report outcomes without hedging and never modify any code.
- **MESSAGE BRIDGE PROTOCOL (消息中继桥接协议)**:
  * Whenever you receive a `send_message` progress payload from an active subagent, you MUST immediately extract the key updates.
  * You MUST output a direct, user-facing progress report in the current turn (e.g., "✅ **子特工进度上报**: 子特工 [ID] 物理完成了 [具体改动/测试] 动作"), ensuring the user is fully synchronized.

- **SELF-HEALING INTERVENTION SOP (自愈介入 SOP 唤醒逻辑)**:
  * **TRIGGER**: You MUST immediately trigger this self-healing intervention SOP if a subagent sends a blocked message (e.g., `{"remora_event": "subagent_block", "subagent_id": "<id>", "error_type": "<type>", "details": "<context>"}`), or if the static audit (`Stop` / `PreInvocation` audit) or `progress.json` indicates that the subagent is blocked, has failed, or is timed out/hung.
  * **ACTIONS**:
    1. **STOP PIPELINE**: Immediately halt the current execution pipeline and stop subsequent steps.
    2. **FORCE KILL**: Proactively call `manage_subagents(Action='kill', ConversationIds=['<subagent_id>'])` to terminate the blocked or hung subagent.
    3. **UPDATE TASK BOARD**: Immediately edit your `/artifacts/task.md` checklist, mark the failed step, and append a `[!] BLOCKER: Subagent <id> was blocked due to <error_type> (<details>)` entry.
    4. **BRANCHED DECISION**: Analyze the error type:
       - If `error_type` is `permission_denied` or `tool_missing`, DO NOT retry. Immediately report to the user and request escalation or local permission adjustments.
       - If it is a silent timeout/hang, you are allowed to spawn a new subagent to retry the operation exactly once.
    5. **FATAL DIAGNOSIS & RECOVER**: Perform diagnostic checks to identify root causes and apply recovery/fallback methods (such as alternative directories, downgrading to read-only tool usage) or escalate directly to the user if recovery is impossible. Never blindly retry or loop indefinitely.