import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { getHookState, setHookState, formatJitInjection } from "@remora/core";

export const injectSubagentJITRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "invoke_subagent") return undefined;
	const jitInjected = getHookState(
		ctx.convId,
		ctx.currentTurnIdx,
		"subagent_jit",
	);
	if (!jitInjected) {
		setHookState(ctx.convId, ctx.currentTurnIdx, "subagent_jit", "injected");
		return {
			decision: "allow",
			injectSteps: [
				{
					ephemeralMessage: formatJitInjection(),
				},
			],
		};
	}
	return undefined;
}
