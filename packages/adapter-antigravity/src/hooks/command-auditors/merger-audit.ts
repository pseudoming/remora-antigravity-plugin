import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { makeDenyReason } from "@remora/core";
import { checkGitCommitEscape } from "./git-commit-escape";

export const auditMergerCmdRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "run_command" || !ctx.isMergerSub) return undefined;
	const cmd = (ctx.args["CommandLine"] as string) ?? "";
	const escapeResult = checkGitCommitEscape(cmd);
	if (escapeResult) return escapeResult;

	const trimmed = cmd.trim();
	const isGitAllowed = [
		"git checkout",
		"git merge",
		"git am",
		"git apply",
		"git add",
		"git commit",
		"git diff",
		"git status",
	].some((prefix) => trimmed.startsWith(prefix));

	const hasRestrictedKeywords = [
		"npm run",
		"vitest",
		"npm test",
		"jest",
		"pytest",
		"sh ",
		"bash ",
		"./",
		"source ",
		"exec ",
	].some((kw) => trimmed.includes(kw));

	if (!isGitAllowed || hasRestrictedKeywords) {
		return {
			decision: "deny",
			reason: makeDenyReason(
				"MERGER_DENY",
				"Remora_Merger is strictly restricted to approved version control actions.",
				"Only approved git commands (checkout, merge, am, apply, add, commit, diff, status) are allowed.",
			),
		};
	}
	return { decision: "allow" };
}
