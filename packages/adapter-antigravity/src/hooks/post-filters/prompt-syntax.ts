import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { validatePromptSyntax, getHookState, setHookState } from "@remora/core";

export const checkPromptSyntaxRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "invoke_subagent") return undefined;
	const subagents =
		(ctx.args["Subagents"] as Array<Record<string, unknown>>) ?? [];
	const rawHistory = getHookState(
		ctx.convId,
		ctx.currentTurnIdx,
		"subagent_dispatch_history",
	);
	let history: Array<{ timestamp: number; role: string; promptHash: string }> =
		[];
	if (rawHistory) {
		try {
			history = JSON.parse(rawHistory);
			if (!Array.isArray(history)) history = [];
		} catch (e: any) {
			console.debug("[Hook Debug] JSON parse failed for rawHistory:", e);
			history = [];
		}
	}
	for (const sub of subagents) {
		const promptStr = (sub["Prompt"] as string) ?? "";
		const syntaxResult = validatePromptSyntax(promptStr);
		if (!syntaxResult.isValid) {
			return {
				decision: "deny",
				reason: `⛔ [REMORA SAFETY INTERCEPT] Subagent Prompt syntax truncation detected. ${syntaxResult.errorReason}. Action required: Verify prompt completeness.`,
			};
		}
	}
	setHookState(
		ctx.convId,
		ctx.currentTurnIdx,
		"subagent_dispatch_history",
		JSON.stringify(history),
	);
	return undefined;
}
