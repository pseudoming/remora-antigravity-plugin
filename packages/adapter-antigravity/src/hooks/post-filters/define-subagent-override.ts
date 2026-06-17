import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { findPluginRoot } from "../../bridge/paths";
import { makeDenyReason, setHookState } from "@remora/core";
import * as path from "node:path";
import * as fs from "node:fs";

export const checkDefineSubagentOverrideRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	const BUILTIN_AGENTS: ReadonlySet<string> = new Set([
		"Remora_Deep_Diver",
		"Remora_ReadOnly_Extractor",
		"Remora_Merger",
	]);

	function loadBuiltinAgentConfig(name: string): any | null {
		try {
			const pluginRoot = findPluginRoot();
			const fileName = name.toLowerCase() + ".json";
			const filePath = path.join(pluginRoot, "agents", fileName);
			if (!fs.existsSync(filePath)) return null;
			return JSON.parse(fs.readFileSync(filePath, "utf-8"));
		} catch (e: any) {
			console.error("[Hook Error] loadBuiltinAgentConfig failed:", e);
			return null;
		}
	}

	if (ctx.toolName !== "define_subagent") return undefined;
	const name = (ctx.args["name"] as string) ?? "";
	if (BUILTIN_AGENTS.has(name)) {
		const config = loadBuiltinAgentConfig(name);
		if (config) {
			const reqWrite = ctx.args["enable_write_tools"] !== false;
			const reqSubagent = ctx.args["enable_subagent_tools"] === true;
			const reqMcp = ctx.args["enable_mcp_tools"] === true;
			const reqPrompt = (ctx.args["system_prompt"] as string) ?? "";

			const expectedWrite = !!config["enable_write_tools"];
			const expectedSubagent = !!config["enable_subagent_tools"];
			const expectedMcp = !!config["enable_mcp_tools"];
			const expectedPrompt = (config["system_prompt"] as string) ?? "";

			if (
				reqWrite !== expectedWrite ||
				reqSubagent !== expectedSubagent ||
				reqMcp !== expectedMcp
			) {
				return {
					decision: "deny",
					reason: makeDenyReason(
						"CONFIG_OVERRIDE",
						`Cannot override built-in agent '${name}' permissions. enable_write_tools must be ${expectedWrite}, enable_subagent_tools must be ${expectedSubagent}, enable_mcp_tools must be ${expectedMcp}.`,
						"Restore default permissions for built-in agents.",
					),
				};
			}

			const clean = (s: string) => s.replace(/\s+/g, "");
			if (clean(reqPrompt) !== clean(expectedPrompt)) {
				return {
					decision: "deny",
					reason: makeDenyReason(
						"CONFIG_OVERRIDE",
						`Cannot override built-in agent '${name}' system_prompt. System prompts must match the official config file exactly.`,
						"Restore default system_prompt for built-in agents.",
					),
				};
			}

			// 校验全部成功通过，打上已定义标记，防止后续回合 PreInvocation 重复向模型注入定义指引
			const stateKey = `remora_subagent_defined_${name}`;
			setHookState(ctx.convId, -1, stateKey, "1");
		}
	}
	return undefined;
};
