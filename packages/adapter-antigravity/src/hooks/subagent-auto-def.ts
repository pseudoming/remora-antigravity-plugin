import * as fs from "node:fs";
import * as path from "node:path";
import { error, getHookState } from "@remora/core";
import { findPluginRoot } from "../bridge/paths";

interface AntigravityHookContext {
	conversationId: string;
	[key: string]: any;
}

export function main(context: AntigravityHookContext): { injectSteps: any[] } {
	const injectSteps: any[] = [];
	try {
		const conversationId = context.conversationId;
		const pluginRoot = findPluginRoot();
		const targetAgents = ["remora_deep_diver", "remora_readonly_extractor", "remora_merger"];
		const undefinedAgents: string[] = [];

		for (const agentName of targetAgents) {
			const agentPath = path.join(pluginRoot, "agents", `${agentName}.json`);
			if (fs.existsSync(agentPath)) {
				const config = JSON.parse(fs.readFileSync(agentPath, "utf-8"));
				const typeName = config.name;

				const stateKey = `remora_subagent_defined_${typeName}`;
				const isDefined = getHookState(conversationId, -1, stateKey);

				if (isDefined !== "1") {
					undefinedAgents.push(typeName);
				}
			}
		}

		if (undefinedAgents.length > 0) {
			const prompt =
				"<system-reminder>\n" +
				"REMORA SYSTEM NOTICE: THE FOLLOWING BUILT-IN SUBAGENTS ARE NOT YET DEFINED IN THIS SESSION:\n" +
				undefinedAgents.map((name) => `- ${name} (CONFIG FILE: agents/${name.toLowerCase()}.json)`).join("\n") + "\n" +
				"YOU ARE STRICTLY PROHIBITED FROM CALLING 'invoke_subagent' BEFORE DEFINING THEM. " +
				"YOU MUST EXECUTE 'define_subagent' FIRST WITH THEIR RESPECTIVE CONFIGURATIONS IN YOUR VERY FIRST STEP!\n" +
				"</system-reminder>";
			injectSteps.push({
				ephemeralMessage: prompt,
			});
		}
	} catch (err: any) {
		error(`[Hook Error] JIT subagent auto-define failed: ${err?.message || err}`);
	}
	return { injectSteps };
}

// Stdio 入口
if (require.main === module) {
	const chunks: Buffer[] = [];
	process.stdin.on("data", (chunk) => chunks.push(chunk));
	process.stdin.on("end", () => {
		try {
			const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
			const output = main(input);
			process.stdout.write(JSON.stringify(output));
		} catch (e) {
			process.stdout.write(JSON.stringify({ injectSteps: [] }));
		}
	});
}
