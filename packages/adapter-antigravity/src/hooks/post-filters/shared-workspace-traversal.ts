import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { resolveSecurePath } from "../../bridge/paths";
import { makeDenyReason } from "@remora/core";
import * as path from "node:path";
import * as fs from "node:fs";

export const checkSharedWorkspaceTraversalRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	const WRITE_TOOLS = [
		"write_to_file",
		"replace_file_content",
		"multi_replace_file_content",
	];
	if (!WRITE_TOOLS.includes(ctx.toolName)) return undefined;
	const tp = (ctx.args["TargetFile"] as string) ?? "";
	if (tp.includes("parent_shared")) {
		if (ctx.isReadonlySub) {
			return {
				decision: "deny",
				reason: makeDenyReason(
					"READONLY",
					"ReadOnly subagents cannot write to shared scratch.",
					"Read scripts from parent_shared via run_command instead.",
				),
			};
		}
		if (tp.includes("..") || tp.includes("~")) {
			return {
				decision: "deny",
				reason: makeDenyReason(
					"PATH_TRAVERSAL",
					"Path traversal detected in parent_shared target.",
					"Write only within the shared scratch directory.",
				),
			};
		}
		const realPath = resolveSecurePath(tp);
		let realBase: string;
		try {
			realBase = fs.realpathSync(
				path.join(process.cwd(), "scratch", "parent_shared"),
			);
		} catch (e: any) {
			console.warn("[Hook Warn] Shared scratch symlink resolution failed:", e);
			return {
				decision: "deny",
				reason: makeDenyReason(
					"LINK_BROKEN",
					"Shared scratch symlink is broken or missing.",
					"The parent_shared link may need to be recreated.",
				),
			};
		}
		if (!realPath.startsWith(realBase)) {
			return {
				decision: "deny",
				reason: makeDenyReason(
					"DIRECTORY_ESCAPE",
					"Write target resolves outside the shared scratch directory.",
					"Write only within scratch/parent_shared/.",
				),
			};
		}
	}
	return undefined;
}
