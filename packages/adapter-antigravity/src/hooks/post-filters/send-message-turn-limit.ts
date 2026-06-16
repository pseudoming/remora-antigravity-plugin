import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { getHookState, setHookState } from "@remora/core";

export const checkSendMessageTurnLimitRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "send_message") return undefined;
	const recipient = (ctx.args["Recipient"] as string) ?? "";
	if (recipient) {
		const stateKey = `subagent_turn_limit_${recipient}`;
		const currentCount = parseInt(
			getHookState(ctx.convId, 0, stateKey) || "0",
			10,
		);
		setHookState(ctx.convId, 0, stateKey, String(currentCount + 1));
	}
	return undefined;
}
