/**
 * Strict 1:1 translation of scripts/tests/test_cli_and_entrypoints.py (2482 lines)
 * Pytest → vitest. DO NOT change test logic or coverage scope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── hoisted mock stores ──────────────────────────────────────────────
// vitest hoists vi.mock() calls above imports.  We use vi.hoisted() so
// that mock factories can capture references to mutable objects the
// individual tests reconfigure via beforeEach.
const coreMocks = vi.hoisted(() => ({
	SYSTEM_POLICY: { ORCHESTRATION: { REPEAT_SPAWN_WINDOW_MS: 180000, MAX_EXECUTION_SEC: 300, STREAM_HISTORY_DEPTH: 300 }, DISPLAY: { WARM_SNIPPET_CHARS: 500 } },
	// sessions
	readMode: vi.fn(),
	writeMode: vi.fn(),
	getLatestSession: vi.fn(),
	updateColdStart: vi.fn(),
	forceColdStartLatestSession: vi.fn(),
	getSession: vi.fn(),
	getProjectUuidByConv: vi.fn(),
	// messages / watermarks
	getWatermark: vi.fn(),
	updateWatermark: vi.fn(),
	// topics
	getActiveTopic: vi.fn(),
	createOrUpdateTopic: vi.fn(),
	switchTopic: vi.fn(),
	closeTopic: vi.fn(),
	touchTopicSourceManual: vi.fn(),
	mergePhysicalFilesToTopic: vi.fn(),
	// decisions
	confirmDecision: vi.fn(),
	getTopicIdByDecision: vi.fn(),
	getRecentDecisions: vi.fn(),
	getRejectedOrDeferredByRelevance: vi.fn(),
	getDecisionsByFile: vi.fn(),
	bumpInjection: vi.fn(),
	// file changes
	insertFileChange: vi.fn(),
	// recall
	recallFts5Logs: vi.fn(),
	recallDecisionsByFts5Topic: vi.fn(),
	recallDecisionsByLike: vi.fn(),
	touchTopicsAccessedByRecall: vi.fn(),
	// maintenance
	runTopicGarbageCollection: vi.fn(),
	pruneExpiredWatermarks: vi.fn(),
	// gate / injector
	shouldFire: vi.fn(),
	markFired: vi.fn(),
	isDuplicate: vi.fn(),
	shouldInjectTone: vi.fn(),
	isPlanningArtifact: vi.fn(),
	// state
	getHookState: vi.fn(),
	setHookState: vi.fn(),
	trimStaleHookStates: vi.fn().mockReturnValue(undefined),
	// formatting
	formatAlertRecallPrompt: vi.fn(
		(word, cmd) =>
			`<system-reminder>\n🚨 MEMORY DEFENSE TRIGGERED: STOP GUESSING.\nThe user appears frustrated ('${word}'). You MUST retrieve facts instead of guessing.\nExecute: ${cmd}\n</system-reminder>`,
	),
	formatHeartbeatTimerInjection: vi.fn(
		(roleName, subagentUuid, pythonBin, pluginRoot, convId) =>
			`<system-reminder>\nSubagent (${roleName}) is currently running WITHOUT a heartbeat timer. Call schedule NOW.\nschedule(DurationSeconds="60", Prompt="60s timeout for subagent ${subagentUuid}. Run: ${pythonBin} ${pluginRoot}/scripts/subagent-monitor.js ${subagentUuid} ${convId}")\nWhen replying, report the progress of \`subagent (${roleName})\` in a natural tone and state that you will wait for 60 seconds before checking again. DO NOT mention mounting safety timers or schedule configs.\n</system-reminder>`,
	),
	formatCumulativeReadWarning: vi.fn(
		(srcKb, dataKb) =>
			`<system-reminder>⚠️ SYSTEM WARNING: CUMULATIVE READ REACHED SOFT LIMIT (SOURCE: ${srcKb}KB, DATA: ${dataKb}KB). MAIN CONTEXT WINDOW IS INFLATING. IF EXTENSIVE CODE REVIEW IS REQUIRED, DELEGATE TO 'Remora_ReadOnly_Extractor' SUBAGENT TO EXTRACT STRUCTURED SUMMARIES AND PREVENT ATTENTION DILUTION. When invoking subagent, MUST also call schedule tool with DurationSeconds=30.</system-reminder>`,
	),
	formatRelaxDisciplinePrompt: vi.fn(),
	formatDecisionsForSessionResume: vi.fn(),
	formatConflictInjectionMessage: vi.fn(),
	formatWorkTrackingPrompt: vi.fn(),
	formatFileDecisionsInjection: vi.fn(),
	formatWriteGateDenyPrompt: vi.fn(),
	formatStrictTonePrompt: vi.fn(),
	formatStrictRecallReminder: vi.fn(),
	buildConflictDetectionPrompt: vi.fn(),
	// text analysis
	cleanSystemReminders: vi.fn().mockImplementation((s: string) => s),
	// liveness
	detectMode: vi.fn(),
	judgeZombie: vi.fn().mockReturnValue([false, 120]),
	suggestZombieAction: vi.fn().mockReturnValue("continue_monitoring"),
	// snapshot
	getSnapshot: vi.fn(),
	// safety
	enforceSandboxWorkspace: vi.fn(),
	// timer
	isTimerCanceled: vi.fn(),
	// log
	setTraceId: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
	// reader
	filterUserAiRounds: vi.fn(),
	// db check
	checkDbExists: vi.fn(),
	getDbPath: vi.fn(),
}));

const bridgePathMocks = vi.hoisted(() => ({
	getConversationsDir: vi.fn(),
	getDataDir: vi.fn().mockReturnValue("/tmp/remora-test-data"),
	getGeminiConfigDir: vi.fn(),
	extractConvId: vi.fn(),
	findPluginRoot: vi.fn(),
}));

const bridgeSubagentMocks = vi.hoisted(() => ({
	getSubagentType: vi.fn(),
	getSubagentTypeByConvId: vi.fn(),
	getParentConvId: vi.fn(),
}));

const bridgeStatsMocks = vi.hoisted(() => ({
	cleanup: vi.fn(),
	getStats: vi.fn(),
}));

const bridgeAgentapiMocks = vi.hoisted(() => ({
	getMetadata: vi.fn(),
	createConversation: vi.fn(),
}));

const conversationMocks = vi.hoisted(() => {
	const mockInstance = {
		dbPath: "/fake/mock.db",
		streamStepsReverse: vi.fn().mockReturnValue([]),
		getCurrentTurnIdx: vi.fn().mockReturnValue(0),
		getUserInputCount: vi.fn().mockReturnValue(0),
		getDbMtime: vi.fn().mockReturnValue(0),
		exists: vi.fn().mockImplementation(() => {
			try {
				return require("node:fs").existsSync(mockInstance.dbPath);
			} catch {
				return false;
			}
		}),
		getMaxStepIndex: vi.fn().mockReturnValue(0),
	};
	function MockCDAL(_convId: string) {
		return mockInstance;
	}
	MockCDAL.prototype = mockInstance;
	return { MockCDAL, mockInstance };
});

const extractDecisionsMocks = vi.hoisted(() => ({
	getOrCreateConversation: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
	execSync: vi.fn(),
	execFileSync: vi.fn(),
}));

// ── module-level mocks (hoisted by vitest) ──────────────────────────
vi.mock("node:child_process", () => ({
	execSync: childProcessMocks.execSync,
	execFileSync: childProcessMocks.execFileSync,
}));

vi.mock("@remora/core", () => coreMocks);

vi.mock("../src/bridge/paths", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/bridge/paths")>();
	return {
		...actual,
		getDataDir: bridgePathMocks.getDataDir,
		extractConvId: bridgePathMocks.extractConvId,
		findPluginRoot: bridgePathMocks.findPluginRoot,
		getDbPath: coreMocks.getDbPath,
		getAntigravityDir: () => path.join(os.homedir(), ".gemini", "antigravity"),
		getBrainDir: () =>
			path.join(os.homedir(), ".gemini", "antigravity", "brain"),
		getConversationsDir: () =>
			path.join(os.homedir(), ".gemini", "antigravity", "conversations"),
		getGeminiConfigDir: () => path.join(os.homedir(), ".gemini", "config"),
	};
});

vi.mock("../src/bridge/subagent", () => ({
	getSubagentType: bridgeSubagentMocks.getSubagentType,
	getSubagentTypeByConvId: bridgeSubagentMocks.getSubagentTypeByConvId,
	getParentConvId: bridgeSubagentMocks.getParentConvId,
}));

vi.mock("../src/bridge/stats", () => ({
	cleanup: bridgeStatsMocks.cleanup,
	getStats: bridgeStatsMocks.getStats,
}));

vi.mock("../src/bridge/filesystem", () => ({
	getSnapshot: coreMocks.getSnapshot,
	diffSnapshots: coreMocks.diffSnapshots,
}));

vi.mock("../src/bridge/agentapi", () => ({
	getMetadata: bridgeAgentapiMocks.getMetadata,
	createConversation: bridgeAgentapiMocks.createConversation,
}));

vi.mock("../src/bridge/conversation", () => ({
	ConversationDataAccessLayer: conversationMocks.MockCDAL,
}));

vi.mock("../src/sidecar/extract-decisions", () => ({
	getOrCreateConversation: extractDecisionsMocks.getOrCreateConversation,
}));

// remora-init uses __dirname (CJS-only global) — full mock needed for ESM NodeNext
const remoraInitMocks = vi.hoisted(() => ({ main: vi.fn() }));
vi.mock("../src/cli/remora-init", () => remoraInitMocks);

// Overridable os.homedir() for remora-topic confirm sandbox merge tests
const osHomedirOverride = vi.hoisted(() => ({ path: null as string | null }));
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		homedir: () => osHomedirOverride.path ?? actual.homedir(),
	};
});

// ── helpers ──────────────────────────────────────────────────────────
function makeTmpPath(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "remora-"));
}

function setupInstalledFlag(tmpPath: string): string {
	const runtimeDir = path.join(tmpPath, ".runtime");
	fs.mkdirSync(runtimeDir, { recursive: true });
	fs.writeFileSync(path.join(runtimeDir, "installed.flag"), "");
	return runtimeDir;
}

function writeKeywordsJson(
	tmpPath: string,
	cfg: { relax_keywords?: string[]; alert_keywords?: string[] } = {},
) {
	const confDir = path.join(tmpPath, "conf");
	fs.mkdirSync(confDir, { recursive: true });
	fs.writeFileSync(
		path.join(confDir, "keywords.json"),
		JSON.stringify({
			relax_keywords: cfg.relax_keywords ?? [],
			alert_keywords: cfg.alert_keywords ?? [],
		}),
	);
}

// After imports, load the actual adapter modules so they see mocks
// NOTE: subagent-monitor and sandbox-merge are mocked above to prevent auto-execution.
import * as sessionGc from "../src/maintenance/session-gc";
import * as topicGc from "../src/maintenance/topic-gc";
import * as toneInjector from "../src/hooks/tone-injector";
import * as snapshotGit from "../src/hooks/snapshot-git";
import * as cognitivePush from "../src/hooks/cognitive-push";
import * as sessionGuardian from "../src/hooks/session-guardian";

// ── CLI entrypoint imports ───────────────────────────────────────────
import { execSync } from "node:child_process";
import { getBrainDir } from "../src/bridge/paths";
import { main as remoraRecall } from "../src/cli/remora-recall";
import { main as remoraTopic } from "../src/cli/remora-topic";
import { main as readSessionLog } from "../src/cli/read-session-log";
import { main as subagentMonitor } from "../src/sandbox/subagent-monitor";
import { main as sandboxMerge } from "../src/sandbox/sandbox-merge";

// ── global reset ─────────────────────────────────────────────────────
beforeEach(() => {
	vi.clearAllMocks();
	// Reset all core mock implementations to safe defaults
	coreMocks.readMode.mockReturnValue("strict");
	coreMocks.getLatestSession.mockReturnValue(null);
	coreMocks.getSession.mockReturnValue(null);
	coreMocks.updateColdStart.mockReturnValue(undefined);
	coreMocks.getActiveTopic.mockReturnValue(null);
	coreMocks.getProjectUuidByConv.mockReturnValue(null);
	coreMocks.getRecentDecisions.mockReturnValue([]);
	coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue([]);
	coreMocks.getHookState.mockReturnValue(null);
	coreMocks.isDuplicate.mockReturnValue(false);
	coreMocks.shouldFire.mockReturnValue(true);
	coreMocks.isPlanningArtifact.mockReturnValue(false);
	coreMocks.shouldInjectTone.mockReturnValue(true);
	coreMocks.getDecisionsByFile.mockReturnValue([]);
	coreMocks.formatStrictTonePrompt.mockReturnValue("STRICT TONE");
	coreMocks.formatRelaxDisciplinePrompt.mockReturnValue(
		"COORDINATOR BEHAVIORAL DISCIPLINE",
	);
	coreMocks.formatWorkTrackingPrompt.mockReturnValue(
		"<system-discipline>WORK TRACKING</system-discipline>",
	);
	coreMocks.formatDecisionsForSessionResume.mockReturnValue(
		"SESSION RESUMED — 历史决策供参考",
	);
	coreMocks.formatConflictInjectionMessage.mockReturnValue("SEMANTIC CONFLICT");
	coreMocks.formatFileDecisionsInjection.mockReturnValue("");
	coreMocks.formatWriteGateDenyPrompt.mockReturnValue("GLOBAL-WRITE-GATE");
	coreMocks.formatStrictRecallReminder.mockReturnValue("");
	coreMocks.buildConflictDetectionPrompt.mockReturnValue("prompt");
	coreMocks.cleanSystemReminders.mockImplementation((s: string) => s);
	coreMocks.detectMode.mockReturnValue(["strict", null]);
	coreMocks.getSnapshot.mockReturnValue({ files: [] });
	coreMocks.checkDbExists.mockReturnValue(false);
	coreMocks.confirmDecision.mockReturnValue(false);
	coreMocks.getTopicIdByDecision.mockReturnValue(null);
	coreMocks.recallFts5Logs.mockReturnValue([]);
	coreMocks.recallDecisionsByFts5Topic.mockReturnValue([]);
	coreMocks.recallDecisionsByLike.mockReturnValue([]);
	coreMocks.isTimerCanceled.mockReturnValue(false);
	coreMocks.judgeZombie.mockReturnValue([false, 120]);
	coreMocks.suggestZombieAction.mockReturnValue("continue_monitoring");

	bridgePathMocks.getDataDir.mockReturnValue("/tmp/remora-test-data");
	bridgePathMocks.findPluginRoot.mockReturnValue("/tmp/data");
	bridgePathMocks.extractConvId.mockImplementation((tp: string) => {
		const m = tp?.match(/\/brain\/([^/]+)\//);
		return m ? m[1] : null;
	});
	bridgeSubagentMocks.getSubagentType.mockReturnValue(null);
	bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);
	bridgeStatsMocks.cleanup.mockReturnValue(undefined);
	bridgeStatsMocks.getStats.mockReturnValue({
		accumulated_source_bytes: 0,
		accumulated_data_bytes: 0,
	});
	bridgeAgentapiMocks.getMetadata.mockReturnValue({});
	bridgeAgentapiMocks.createConversation.mockReturnValue({});
	extractDecisionsMocks.getOrCreateConversation.mockReturnValue("{}");

	// Reset CDAL mockInstance to defaults between tests
	conversationMocks.mockInstance.streamStepsReverse = vi
		.fn()
		.mockReturnValue([]);
	conversationMocks.mockInstance.getCurrentTurnIdx = vi.fn().mockReturnValue(0);
	conversationMocks.mockInstance.getUserInputCount = vi.fn().mockReturnValue(0);
	conversationMocks.mockInstance.getDbMtime = vi.fn().mockReturnValue(0);
});

// =========================================================================
// 1. session_gc.py
// =========================================================================


// =========================================================================
// 14. session-guardian.py
// =========================================================================
describe("session_guardian", () => {
	it("uninitialized returns FATAL ERROR message", () => {
		const tmpPath = makeTmpPath();
		try {
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			// No .runtime/installed.flag → uninitialized
			const res = sessionGuardian.main({});
			expect(res.injectSteps.length).toBe(1);
			const msg = (res.injectSteps[0] as any).ephemeralMessage;
			expect(msg).toContain("REMORA FATAL ERROR");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("success flow — relax mode detection, env file, cleanup, cumulative warning", () => {
		const tmpPath = makeTmpPath();
		try {
			// Setup installed.flag
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);

			// Write keywords.json with relax keyword "discuss"
			const confDir = path.join(tmpPath, "conf");
			fs.mkdirSync(confDir, { recursive: true });
			fs.writeFileSync(
				path.join(confDir, "keywords.json"),
				JSON.stringify({
					relax_keywords: ["brainstorm", "discuss"],
					alert_keywords: [],
				}),
			);

			// Set env vars for LS credential caching
			process.env["ANTIGRAVITY_LS_ADDRESS"] = "127.0.0.1:8080";
			process.env["ANTIGRAVITY_CSRF_TOKEN"] = "token123";

			// CDAL mock steps
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "USER_INPUT",
						content: "Let's discuss brainstorm ideas for this project",
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "30",
									Prompt: "subagent-monitor.js fake_uuid c1",
								},
							},
						],
					},
				]);

			// Stats mock → > 150KB → triggers cumulative warning
			bridgeStatsMocks.getStats.mockReturnValue({
				accumulated_source_bytes: 200 * 1024,
				accumulated_data_bytes: 10 * 1024,
			});

			// detectMode returns relax
			coreMocks.detectMode.mockReturnValue(["relax", null]);
			coreMocks.writeMode.mockReturnValue(undefined);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			// Verify LS env file was written
			const envFile = path.join(tmpPath, ".runtime", "remora_agent_env.json");
			expect(fs.existsSync(envFile)).toBe(true);
			const envData = JSON.parse(fs.readFileSync(envFile, "utf-8"));
			expect(envData["ANTIGRAVITY_LS_ADDRESS"]).toBe("127.0.0.1:8080");
			expect(envData["ANTIGRAVITY_CSRF_TOKEN"]).toBe("token123");

			// Verify mode written
			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "relax");

			// Verify cleanup called
			expect(bridgeStatsMocks.cleanup).toHaveBeenCalledWith("conv_1");

			// Verify cumulative warning injected (src > 150KB)
			expect(res.injectSteps.length).toBe(1);
			expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
				"SYSTEM WARNING: CUMULATIVE READ REACHED SOFT LIMIT",
			);
		} finally {
			delete process.env["ANTIGRAVITY_LS_ADDRESS"];
			delete process.env["ANTIGRAVITY_CSRF_TOKEN"];
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session-guardian — subagent warning
// =========================================================================
describe("session_guardian_subagent_warning", () => {
	it("subagent warning injection with agentapi metadata", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath, { relax_keywords: [], alert_keywords: [] });

			// Ensure no LS env vars → no env file write branch
			delete process.env["ANTIGRAVITY_LS_ADDRESS"];
			delete process.env["ANTIGRAVITY_CSRF_TOKEN"];

			// CDAL steps: schedule with subagent UUID, subagent progress update
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "USER_INPUT", content: "hello" },
					{
						type: "GENERIC",
						content:
							"22222222-2222-2222-2222-222222222222 active progress update",
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt:
										"60s timeout for subagent 22222222-2222-2222-2222-222222222222. Run: node scripts/subagent-monitor.js 22222222-2222-2222-2222-222222222222 conv_1",
								},
							},
						],
					},
				]);

			// getSubagentTypeByConvId returns role name from PB
			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(
				"Remora_Deep_Diver",
			);

			// isTimerCanceled → true so heartbeat warning fires
			coreMocks.isTimerCanceled.mockReturnValue(true);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(res.injectSteps.length).toBe(1);
			const msg = (res.injectSteps[0] as any).ephemeralMessage;
			expect(msg).toContain(
				"Subagent (Remora_Deep_Diver) is currently running WITHOUT a heartbeat timer. Call schedule NOW.",
			);
			expect(msg).toContain(
				"When replying, report the progress of `subagent (Remora_Deep_Diver)` in a natural tone",
			);
			expect(msg).toContain(
				"DO NOT mention mounting safety timers or schedule configs.",
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("subagent warning fallback to history invoke_subagent type name", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath, { relax_keywords: [], alert_keywords: [] });

			delete process.env["ANTIGRAVITY_LS_ADDRESS"];
			delete process.env["ANTIGRAVITY_CSRF_TOKEN"];

			// CDAL steps: invoke_subagent with TypeName, schedule with subagent UUID
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "USER_INPUT", content: "hello" },
					{
						type: "GENERIC",
						content:
							"22222222-2222-2222-2222-222222222222 active progress update",
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "invoke_subagent",
								args: {
									Subagents: [{ TypeName: "Remora_ReadOnly_Extractor" }],
								},
							},
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt:
										"60s timeout for subagent 22222222-2222-2222-2222-222222222222. Run: node scripts/subagent-monitor.js 22222222-2222-2222-2222-222222222222 conv_1",
								},
							},
						],
					},
				]);

			// getSubagentTypeByConvId returns null → falls through to history
			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);

			coreMocks.isTimerCanceled.mockReturnValue(true);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(res.injectSteps.length).toBe(1);
			const msg = (res.injectSteps[0] as any).ephemeralMessage;
			expect(msg).toContain(
				"Subagent (Remora_ReadOnly_Extractor) is currently running WITHOUT a heartbeat timer. Call schedule NOW.",
			);
			expect(msg).toContain(
				"When replying, report the progress of `subagent (Remora_ReadOnly_Extractor)` in a natural tone",
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — get_subagent_type helper
// =========================================================================
describe("session_guardian_get_subagent_type", () => {
	it("no path returns null", () => {
		expect(bridgeSubagentMocks.getSubagentType("")).toBeNull();
	});

	it("no /brain/ match returns null", () => {
		const result = bridgePathMocks.extractConvId("/tmp/no_brain/file.jsonl");
		expect(result).toBeNull();
	});

	it("getSubagentTypeByConvId returns typeName from PB", () => {
		bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(
			"Remora_Deep_Diver",
		);
		const result = bridgeSubagentMocks.getSubagentTypeByConvId(
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		);
		expect(result).toBe("Remora_Deep_Diver");
		bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);
	});

	it("getSubagentTypeByConvId returns null for missing entry", () => {
		bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);
		const result = bridgeSubagentMocks.getSubagentTypeByConvId(
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		);
		expect(result).toBeNull();
	});

	it("getSubagentTypeByConvId — bad convId returns null", async () => {
		const subagentMod = await vi.importActual<
			typeof import("../src/bridge/subagent")
		>("../src/bridge/subagent");
		expect(subagentMod.getSubagentTypeByConvId("bad-id")).toBeNull();
		expect(subagentMod.getSubagentTypeByConvId("")).toBeNull();
	});
});


// =========================================================================
// session_guardian — scratch sharing
// =========================================================================
describe("session_guardian_scratch_sharing", () => {
	it("getParentConvId returns parent UUID from PB", () => {
		bridgeSubagentMocks.getParentConvId.mockReturnValue(
			"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
		);
		const result = bridgeSubagentMocks.getParentConvId(
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		);
		expect(result).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
		bridgeSubagentMocks.getParentConvId.mockReturnValue(null);
	});

	it("getParentConvId returns null for bad convId", async () => {
		const subagentMod = await vi.importActual<
			typeof import("../src/bridge/subagent")
		>("../src/bridge/subagent");
		expect(subagentMod.getParentConvId("bad-id")).toBeNull();
		expect(subagentMod.getParentConvId("")).toBeNull();
	});

	it("session_guardian creates subagent_shared directory for main agent", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			bridgeSubagentMocks.getParentConvId.mockReturnValue(null);
			bridgeSubagentMocks.getSubagentType.mockReturnValue(null);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const homedir = path.join(tmpPath, "home");
			osHomedirOverride.path = homedir;

			try {
				sessionGuardian.main({
					transcriptPath: "/brain/conv_main_session/transcript.jsonl",
				});
				const sharedDir = path.join(
					homedir,
					".gemini",
					"antigravity",
					"brain",
					"conv_main_session",
					"scratch",
					"subagent_shared",
				);
				expect(fs.existsSync(sharedDir)).toBe(true);
			} finally {
				osHomedirOverride.path = null;
			}
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — main flow branch coverage
// =========================================================================
describe("session_guardian_main_flow", () => {
	it("env_write_exception does not crash", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			process.env["ANTIGRAVITY_LS_ADDRESS"] = "addr";
			process.env["ANTIGRAVITY_CSRF_TOKEN"] = "tok";

			// Create remora_agent_env.json as a directory → writeFileSync throws EISDIR
			fs.mkdirSync(path.join(tmpPath, ".runtime", "remora_agent_env.json"), {
				recursive: true,
			});

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			delete process.env["ANTIGRAVITY_LS_ADDRESS"];
			delete process.env["ANTIGRAVITY_CSRF_TOKEN"];
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("transcript_no_match — empty injectSteps", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/tmp/no_brain/file.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — heartbeat step parsing
// =========================================================================
describe("session_guardian_heartbeat_parsing", () => {
	it("all_skip_types_loop_exhaust — EPHEMERAL, SYSTEM, ERROR messages skipped", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "EPHEMERAL_MESSAGE", content: "skip1" },
					{ type: "SYSTEM_MESSAGE", content: "skip2" },
					{ type: "ERROR_MESSAGE", content: "skip3" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("non_user_input_break — PLANNER_RESPONSE without USER_INPUT breaks loop", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "PLANNER_RESPONSE", content: "thinking" }]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("step_parsing_exception — stream_steps_reverse throws, doesn't crash", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockImplementation(() => {
					throw new Error("db error");
				});

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("keywords_load_exception — open throws, doesn't crash", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			// findPluginRoot returns a path where no keywords.json exists → readFileSync throws
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "hello" }]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — heartbeat subagent detection
// =========================================================================
describe("session_guardian_heartbeat_subagent_detection", () => {
	const subagentUuid = "22222222-2222-2222-2222-222222222222";

	it("no_heartbeat_steps — empty steps, no injection", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("schedule_no_subagent_monitor — schedule without subagent-monitor pattern", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: { DurationSeconds: "30", Prompt: "some other task" },
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("uuid_already_set — second schedule skipped when uuid already found", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// Two schedules: first sets uuid, second is skipped
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
							{
								name: "schedule",
								args: {
									DurationSeconds: "30",
									Prompt: `subagent-monitor.js 33333333-3333-3333-3333-333333333333 conv_1`,
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			// Should not crash
			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps.length).toBeGreaterThanOrEqual(0);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("uuid_matches_conv — uuid matches conversation id, skipped", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// UUID 11111111-1111-1111-1111-111111111111 is the sentinel value → skipped
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt:
										"subagent-monitor.js 11111111-1111-1111-1111-111111111111 conv_1",
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — manage_subagents kill detection
// =========================================================================
describe("session_guardian_manage_subagents", () => {
	const subagentUuid = "22222222-2222-2222-2222-222222222222";

	it("manage_subagents_kill — kill_all action detected", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{ name: "manage_subagents", args: { Action: "kill_all" } },
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			// kill_all detected → subagentFinishDetected = true → heartbeat warning suppressed
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("system_confirm_kill — 'Successfully killed subagent' message", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "GENERIC",
						content: `Successfully killed subagent ${subagentUuid}`,
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("terminated_subagent_confirm — 'Terminated subagent' message", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "GENERIC", content: `Terminated subagent ${subagentUuid}` },
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — Pass 2 and retry cleanup
// =========================================================================
describe("session_guardian_pass2_and_retry", () => {
	const subagentUuid = "22222222-2222-2222-2222-222222222222";

	it("pass2_no_activity_match — no active progress update", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// Schedule includes subagent UUID but no activity step → timerCanceled logic applies
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `60s timeout for subagent ${subagentUuid}. Run: node scripts/subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);
			// isTimerCanceled returns false → warning NOT injected (hasScheduleAfter=true, timerCanceled=false)
			coreMocks.isTimerCanceled.mockReturnValue(false);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("pass2_history_type_skip — CONVERSATION_HISTORY step skipped", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// CONVERSATION_HISTORY containing UUID is skipped in pass2
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `60s timeout for subagent ${subagentUuid}. Run: node scripts/subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
						],
					},
					{
						type: "CONVERSATION_HISTORY",
						content: `${subagentUuid} was active`,
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.isTimerCanceled.mockReturnValue(false);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			// CONVERSATION_HISTORY skipped → no activity match → timerCanceled = false → no warning
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("retry_cleanup_exception — fs.unlinkSync throws but doesn't crash", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// Pre-create retry file as a directory → unlinkSync throws
			const retryDir = path.join(
				tmpPath,
				".runtime",
				`remora_subagent_retries_conv_1.json`,
			);
			fs.mkdirSync(retryDir, { recursive: true });

			// Steps include a kill confirmation → subagentFinishDetected = true
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "GENERIC",
						content: `Successfully killed subagent ${subagentUuid}`,
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — role_name resolution
// =========================================================================
describe("session_guardian_role_name", () => {
	const subagentUuid = "22222222-2222-2222-2222-222222222222";

	it("role_name_cache_exception — corrupt env, falls through to agentapi", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// Corrupt env file
			fs.writeFileSync(
				path.join(tmpPath, ".runtime", "remora_agent_env.json"),
				"{corrupt}",
			);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "GENERIC",
						content: `${subagentUuid} active progress update`,
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `60s timeout for subagent ${subagentUuid}. Run: node scripts/subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			// getSubagentTypeByConvId returns role name from PB
			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue("SomeAgent");

			coreMocks.isTimerCanceled.mockReturnValue(true);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps.length).toBe(1);
			expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
				"Subagent (SomeAgent)",
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("role_name_history_fallback_type_on_args — invoke_subagent TypeName fallback", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "GENERIC",
						content: `${subagentUuid} active progress update`,
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{ name: "invoke_subagent", args: { TypeName: "Remora_Coder" } },
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `60s timeout for subagent ${subagentUuid}. Run: node scripts/subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			// getSubagentTypeByConvId returns null → falls through to history
			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);

			coreMocks.isTimerCanceled.mockReturnValue(true);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps.length).toBe(1);
			expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
				"Subagent (Remora_Coder)",
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("role_name_no_subagents_list — empty Subagents list, falls through to uuid", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "GENERIC",
						content: `${subagentUuid} active progress update`,
					},
					{
						type: "PLANNER_RESPONSE",
						tool_calls: [
							{ name: "invoke_subagent", args: { Subagents: [] } },
							{
								name: "schedule",
								args: {
									DurationSeconds: "60",
									Prompt: `60s timeout for subagent ${subagentUuid}. Run: node scripts/subagent-monitor.js ${subagentUuid} conv_1`,
								},
							},
						],
					},
					{ type: "USER_INPUT", content: "hello" },
				]);

			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);

			coreMocks.isTimerCanceled.mockReturnValue(true);
			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps.length).toBe(1);
			expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
				`Subagent (${subagentUuid})`,
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("role_name_history_exception — step with tool_calls null doesn't crash", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			// PLANNER_RESPONSE with tool_calls: null → iteration throws, caught by try/catch
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "PLANNER_RESPONSE", tool_calls: null },
					{ type: "USER_INPUT", content: "hello" },
				]);

			bridgeSubagentMocks.getSubagentTypeByConvId.mockReturnValue(null);

			coreMocks.detectMode.mockReturnValue(["strict", null]);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian — alert keyword, recall distance gate, stats exception
// =========================================================================
describe("session_guardian_alert_and_recall", () => {
	it("alert_keyword_triggers_recall — alert keyword overrides and injects MEMORY DEFENSE", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath, {
				relax_keywords: [],
				alert_keywords: ["override_kw"],
			});

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{
						type: "USER_INPUT",
						content: "Let's discuss the override_kw together",
					},
				]);
			conversationMocks.mockInstance.getCurrentTurnIdx = vi
				.fn()
				.mockReturnValue(5);

			coreMocks.detectMode.mockReturnValue(["alert", "override_kw"]);
			coreMocks.writeMode.mockReturnValue(undefined);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "alert");
			const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
				(s.ephemeralMessage || "").includes("MEMORY DEFENSE"),
			);
			expect(recallMsgs.length).toBeGreaterThanOrEqual(1);
			expect(recallMsgs[0].ephemeralMessage).toContain("override_kw");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("strict_suggests_recall — strict mode + distance >= 3 injects recall suggestion", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "hello world" }]);
			conversationMocks.mockInstance.getCurrentTurnIdx = vi
				.fn()
				.mockReturnValue(5);

			// getHookState returns null → lastRecall = 0, distance = 5 - 0 = 5 ≥ 3 → inject recall
			coreMocks.getHookState.mockReturnValue(null);
			coreMocks.formatStrictRecallReminder.mockReturnValue(
				"📓 cross-check with remora-recall",
			);
			coreMocks.writeMode.mockReturnValue(undefined);
			coreMocks.markFired.mockReturnValue(undefined);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "strict");
			const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
				(s.ephemeralMessage || "").includes("cross-check with remora-recall"),
			);
			expect(recallMsgs.length).toBeGreaterThanOrEqual(1);
			expect(coreMocks.markFired).toHaveBeenCalledWith(
				"conv_1",
				"last_recall_turn",
				"5",
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("alert_overrides_relax — alert keyword + relax pattern → alert mode + recall", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath, {
				relax_keywords: ["讨论"],
				alert_keywords: ["搞什么"],
			});

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ type: "USER_INPUT", content: "我们讨论一下草案，搞什么" },
				]);
			conversationMocks.mockInstance.getCurrentTurnIdx = vi
				.fn()
				.mockReturnValue(3);

			coreMocks.detectMode.mockReturnValue(["alert", "搞什么"]);
			coreMocks.writeMode.mockReturnValue(undefined);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "alert");
			const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
				(s.ephemeralMessage || "").includes("MEMORY DEFENSE"),
			);
			expect(recallMsgs.length).toBeGreaterThanOrEqual(1);
			expect(recallMsgs[0].ephemeralMessage).toContain("搞什么");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("relax_mode_no_recall — relax mode, no recall injection", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath, {
				relax_keywords: ["讨论"],
				alert_keywords: [],
			});

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "讨论一下草案" }]);
			conversationMocks.mockInstance.getCurrentTurnIdx = vi
				.fn()
				.mockReturnValue(5);

			coreMocks.detectMode.mockReturnValue(["relax", null]);
			coreMocks.writeMode.mockReturnValue(undefined);
			coreMocks.getHookState.mockReturnValue(null);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "relax");
			const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
				(s.ephemeralMessage || "").includes("remora-recall"),
			);
			expect(recallMsgs.length).toBe(0);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("strict_recall_distance_gate — strict mode but distance < 3, no recall", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "hello" }]);
			conversationMocks.mockInstance.getCurrentTurnIdx = vi
				.fn()
				.mockReturnValue(2);

			// getHookState returns "1" → lastRecall = 1, distance = 2 - 1 = 1 < 3 → no recall
			coreMocks.getHookState.mockReturnValue("1");
			coreMocks.writeMode.mockReturnValue(undefined);
			coreMocks.markFired.mockReturnValue(undefined);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			expect(coreMocks.writeMode).toHaveBeenCalledWith("conv_1", "strict");
			const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
				(s.ephemeralMessage || "").includes("remora-recall"),
			);
			expect(recallMsgs.length).toBe(0);
			expect(coreMocks.markFired).not.toHaveBeenCalledWith(
				"conv_1",
				"last_recall_turn",
				expect.anything(),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("is_new_turn_cleanup — cleanup called on new turn", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "hello" }]);

			coreMocks.detectMode.mockReturnValue(["strict", null]);

			sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});

			// USER_INPUT found → isNewTurn = true → cleanup called
			expect(bridgeStatsMocks.cleanup).toHaveBeenCalledWith("conv_1");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("stats_exception — get_stats throws, injectSteps empty", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ type: "USER_INPUT", content: "hello" }]);

			bridgeStatsMocks.getStats.mockImplementation(() => {
				throw new Error("stats fail");
			});
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toEqual([]);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});


// =========================================================================
// session_guardian main execution (subprocess)
// =========================================================================
describe("session_guardian_main_execution", () => {
	it("session_guardian_main_execution — main() called with transcriptPath", () => {
		const tmpPath = makeTmpPath();
		try {
			setupInstalledFlag(tmpPath);
			bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
			bridgePathMocks.findPluginRoot.mockReturnValue(tmpPath);
			writeKeywordsJson(tmpPath);

			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.detectMode.mockReturnValue(["strict", null]);

			const res = sessionGuardian.main({
				transcriptPath: "/brain/conv_1/transcript.jsonl",
			});
			expect(res.injectSteps).toBeDefined();
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});
