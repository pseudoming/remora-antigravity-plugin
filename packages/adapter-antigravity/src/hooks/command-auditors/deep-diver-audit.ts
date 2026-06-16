import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { checkGitCommitEscape } from "./git-commit-escape";

export const auditDeepDiverCmdRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (
		ctx.toolName !== "run_command" ||
		!ctx.isSub ||
		ctx.isMergerSub ||
		ctx.isReadonlySub
	) {
		return undefined;
	}
	const cmd = (ctx.args["CommandLine"] as string) ?? "";
	const escapeResult = checkGitCommitEscape(cmd);
	if (escapeResult) return escapeResult;


	return { decision: "allow" };
}
