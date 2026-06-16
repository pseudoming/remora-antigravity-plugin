import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { findPluginRoot } from "../../bridge/paths";
import { makeDenyReason } from "@remora/core";
import * as path from "node:path";
import * as fs from "node:fs";

export const checkDefineSubagentOverrideRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
const BUILTIN_AGENTS: ReadonlySet<string> = new Set([
        "Remora_Deep_Diver",
        "Remora_ReadOnly_Extractor",
]);

function loadBuiltinAgentPerms(name: string): Record<string, boolean> | null {
        try {
                const pluginRoot = findPluginRoot();
                const filePath = path.join(pluginRoot, "agents", `${name}.json`);
                if (!fs.existsSync(filePath)) return null;
                const def = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                return {
                        enable_write_tools: !!def["enable_write_tools"],
                        enable_subagent_tools: !!def["enable_subagent_tools"],
                };
        } catch (e: any) {
                console.debug("[Hook Debug] loadBuiltinAgentPerms failed:", e);
                return null;
        }
}
	if (ctx.toolName !== "define_subagent") return undefined;
	const name = (ctx.args["name"] as string) ?? "";
	if (BUILTIN_AGENTS.has(name)) {
		const perms = loadBuiltinAgentPerms(name);
		if (perms) {
			const reqWrite = ctx.args["enable_write_tools"] !== false;
			const reqSubagent = ctx.args["enable_subagent_tools"] === true;
			if (
				reqWrite !== perms.enable_write_tools ||
				reqSubagent !== perms.enable_subagent_tools
			) {
				return {
					decision: "deny",
					reason: makeDenyReason(
						"CONFIG_OVERRIDE",
						`Cannot override built-in agent '${name}'. enable_write_tools must be ${perms.enable_write_tools}, enable_subagent_tools must be ${perms.enable_subagent_tools}.`,
						"Use a different name for custom agents.",
					),
				};
			}
		}
	}
	return undefined;
}
