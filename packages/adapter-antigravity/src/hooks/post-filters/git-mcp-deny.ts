import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { makeDenyReason } from "@remora/core";

export const checkGitMcpRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	const isLazyMcpMatch =
		ctx.toolName === "call_mcp_tool" &&
		((ctx.args["ServerName"] as string) || "").replace(/_/g, "-") ===
			"remora-git-mcp";
	const isEagerMcpMatch =
		ctx.toolName.startsWith("mcp_") &&
		/^mcp_remora[-_]git[-_]mcp_/i.test(ctx.toolName);

	if (isLazyMcpMatch || isEagerMcpMatch) {
		let actionName = "";
		let actionArgs: Record<string, unknown> = {};

		if (isLazyMcpMatch) {
			actionName = (ctx.args["ToolName"] as string) || "";
			actionArgs = (ctx.args["Arguments"] as Record<string, unknown>) || {};
		} else {
			actionName = ctx.toolName.replace(/^mcp_remora[-_]git[-_]mcp_/i, "");
			actionArgs = ctx.args;
		}

		const isWriteMcpTool = ["git_checkout", "git_merge", "git_commit"].includes(
			actionName,
		);

		if (isWriteMcpTool && !ctx.isMergerSub) {
			return {
				decision: "deny",
				reason: makeDenyReason(
					"MCP_GIT_DENY",
					`Write operation '${actionName}' via Git MCP is restricted to Remora_Merger.`,
					"Please delegate Git merge, checkout, or commit tasks to 'Remora_Merger' subagent.",
				),
			};
		}

		if (actionName === "git_commit") {
			const commitMsg = (actionArgs["message"] as string) || "";
			if (/[\r\n]|\*\*\*|(\&\&|;|\||`|\$\()/.test(commitMsg)) {
				return {
					decision: "deny",
					reason: makeDenyReason(
						"GIT_ESCAPE",
						"Git commit message contains forbidden characters (newlines, consecutive asterisks, or shell command separators).",
						"Ensure the commit message is clean and does not contain command injections.",
					),
				};
			}
		}
	}
	return undefined;
}
