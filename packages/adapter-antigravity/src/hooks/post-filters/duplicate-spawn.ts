import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { getHookState, setHookState, SYSTEM_POLICY } from "@remora/core";

export const checkDuplicateSpawnRule: DynamicRule = (ctx: DynamicRuleContext, _now?: number): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "invoke_subagent") return undefined;
	const subagents = ctx.args["Subagents"];
	if (Array.isArray(subagents)) {
		for (const req of subagents) {
			const typeName = req["TypeName"];
			const role = req["Role"];
			const signature = typeName + "::" + role;

			let historyStr = getHookState(
				ctx.convId,
				ctx.currentTurnIdx,
				"subagent_spawns",
			);
			let history: any[] = [];
			try {
				if (historyStr) history = JSON.parse(historyStr);
			} catch (e: any) {
				console.debug("[Hook Debug] JSON parse failed for historyStr:", e);
			}
			if (!Array.isArray(history)) history = [];

			const now = _now ?? Date.now();
			const recentSpawns = history.filter(
				(h: any) =>
					h.signature === signature &&
					now - h.timestamp <
						SYSTEM_POLICY.ORCHESTRATION.REPEAT_SPAWN_WINDOW_MS,
			);

			if (recentSpawns.length > 0) {
				return {
					decision: "deny",
					reason:
						"⛔ [REMORA SAFETY INTERCEPT] High-frequency duplicate dispatch. Spawning '" +
						role +
						"' within 3 minutes for identical verification/extraction. ACTION REQUIRED: Please merge these tasks into a single subagent invocation (or use a self-contained verifier instruction in the developer prompt) to avoid cold startup latency.",
				};
			}

			const newHistory = history.filter(
				(h: any) => now - h.timestamp < 10 * 60 * 1000,
			);
			newHistory.push({ signature, timestamp: now });
			setHookState(
				ctx.convId,
				ctx.currentTurnIdx,
				"subagent_spawns",
				JSON.stringify(newHistory),
			);
		}
	}
	return undefined;
}
