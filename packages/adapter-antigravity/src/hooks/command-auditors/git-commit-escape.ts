import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { inspectCommand, makeDenyReason } from "@remora/core";

export function checkGitCommitEscape(cmd: string): PreToolUseResponse | undefined {
	if (cmd.trim().startsWith("git commit")) {
		const [decision, category] = inspectCommand(cmd);
		if (decision === "deny" && category === "git_escape") {
			return {
				decision: "deny",
				reason: makeDenyReason(
					"GIT_COMMIT_ESCAPE",
					"Git commit message containing newline characters or consecutive asterisks is blocked to prevent escape vulnerabilities.",
					"Avoid using newline characters or consecutive asterisks in git commit message.",
				),
			};
		}
		return { decision: "allow" };
	}
	return undefined;
}
