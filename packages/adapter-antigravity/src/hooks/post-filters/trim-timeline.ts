import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { trimStaleHookStates } from "@remora/core";

export const trimTimelineRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	trimStaleHookStates(ctx.convId, ctx.currentTurnIdx);
	return undefined;
}
