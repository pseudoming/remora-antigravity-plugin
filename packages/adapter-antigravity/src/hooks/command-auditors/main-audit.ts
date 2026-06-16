import { PreToolUseResponse, DynamicRuleContext, DynamicRule } from "../../types";
import { inspectCommand, makeDenyReason } from "@remora/core";
import { checkGitCommitEscape } from "./git-commit-escape";
import { getHookState, setHookState } from "@remora/core";
import { ConversationDataAccessLayer } from "../../bridge/conversation";

const rotReason = makeDenyReason(
	"ANTI-ROT",
	"Direct cat/grep or view_file on large logs in main context is prohibited to prevent context explosion.",
	"Invoke 'Remora_ReadOnly_Extractor' for queries, or 'Remora_Deep_Diver' for modifications.",
);

export const auditMainCmdRule: DynamicRule = (ctx: DynamicRuleContext): PreToolUseResponse | undefined => {
	if (ctx.toolName !== "run_command" || ctx.isSub) return undefined;
	const cmd = (ctx.args["CommandLine"] as string) ?? "";
	const escapeResult = checkGitCommitEscape(cmd);
	if (escapeResult) return escapeResult;


	const rotPattern =
		/\b(?:cat|tail|grep|jq|awk|sed|sqlite3)\b.*?(?:\.jsonl|\.log|\.sqlite)\b|\bremora-recall\.(?:py|ts)\b/i;
	const hasRotFeature = rotPattern.test(cmd);
	const isRecallCall = /\bremora-recall\b/i.test(cmd);

	const [decision, category] = inspectCommand(cmd);

	if (hasRotFeature) {
		if (isRecallCall) {
			return { decision: "allow" };
		}
		return { decision: "deny", reason: rotReason };
	} else {
		if (decision === "deny") {if (category === "test" || category === "build") {
				return {
					decision: "deny",
					reason:
						"⛔ REMORA SAFETY LIMIT [DELEGATION-BLOCKED]: DIRECT COMMAND RUNS BLOCKED!\n" +
						"============================================================\n" +
						"!!! WARNING: UNTRUSTED CODE EXECUTION PREVENTED !!!\n" +
						"TO PROTECT THE ACTIVE WORKING TREE AND PRESERVE MASTER BRANCH INTEGRITY FROM UNSAFE STATE CHANGES OR UNREVIEWED CODE EXECUTION DURING BUILD/TEST PHASES, DIRECT EXECUTION OF pytest/build IS PROHIBITED.\n\n" +
						"YOU MUST RUN THESE COMMANDS IN AN ISOLATED WORKSPACE:\n" +
						'- FOR TESTING/DIAGNOSTICS: DELEGATE VIA `invoke_subagent` USING `Remora_Deep_Diver` WITH `Workspace: "branch"`.\n' +
						'- FOR COMPILING/BUILDING: DELEGATE VIA `invoke_subagent` USING `Remora_Deep_Diver` WITH `Workspace: "share"`.\n\n' +
						"DO NOT ATTEMPT TO BYPASS THIS DEFENSE BY ALIASING, SHELL SCRIPT WRAPPING, OR ALTERNATIVE PATH RUNS! ALL BYPASS ATTEMPTS WILL BE LOGGED AND BLOCKED.\n" +
						"============================================================",
				};
			} else {
				const trimmed = cmd.trim();
				const isGitMergeOrControl = [
					"git checkout",
					"git merge",
					"git am",
					"git apply",
					"git cherry-pick",
					"git rebase",
				].some((prefix) => trimmed.startsWith(prefix));

				if (isGitMergeOrControl) {
					return {
						decision: "deny",
						reason: makeDenyReason(
							"DELEGATION",
							"Version control merge or checkout commands cannot be run directly in main context.",
							"Please delegate to 'Remora_Merger' subagent with Workspace: 'inherit' and use 'remora-git-mcp' tools safely.",
						),
					};
				}

				return {
					decision: "deny",
					reason: makeDenyReason(
						"DELEGATION",
						"Command verification failed due to syntax parser error.",
						"Please delegate to a subagent under (Workspace: 'branch')!",
					),
				};
			}
		} else {
			const blastDone = getHookState(
				ctx.convId,
				ctx.currentTurnIdx,
				"blast_radius",
			);
			if (!blastDone) {
				const cdal = new ConversationDataAccessLayer(ctx.convId);
				const latestResp = cdal.getLatestPlannerResponse() ?? "";
				const alreadyAware =
					/(?:blast radius|reversible|undo|shared state|no-?verify|force push|irreversible)/i.test(
						latestResp,
					);
				if (!alreadyAware) {
					setHookState(ctx.convId, ctx.currentTurnIdx, "blast_radius", "1");
					return {
						decision: "allow",
						injectSteps: [
							{
								ephemeralMessage:
									"BLAST RADIUS CHECK:\n" +
									"- Does this command affect only your workspace, or shared state?\n" +
									"- If it goes wrong, can you undo it?\n" +
									"- Do NOT use --no-verify, --force, or rm -rf to bypass problems.\n" +
									'- If "shared" or "irreversible", delegate to a subagent with Workspace: branch.',
							},
						],
					};
				}
			}
			return { decision: "allow" };
		}
	}
}
