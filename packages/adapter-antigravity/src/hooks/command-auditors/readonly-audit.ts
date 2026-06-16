import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { inspectCommand, makeDenyReason } from "@remora/core";
import { checkGitCommitEscape } from "./git-commit-escape";

export const auditReadonlyCmdRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "run_command" || !ctx.isReadonlySub) return undefined;
	const cmd = (ctx.args["CommandLine"] as string) ?? "";
	const escapeResult = checkGitCommitEscape(cmd);
	if (escapeResult) return escapeResult;


	const [decision] = inspectCommand(cmd);
	if (decision !== "allow") {
		return {
			decision: "deny",
			reason: makeDenyReason(
				"READONLY",
				"Remora_ReadOnly_Extractor is strictly read-only.",
				"Do not run write/test/build commands!",
			),
		};
	}
	return { decision: "allow" };
}
