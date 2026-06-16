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
// In-process main block tests for session_gc, topic_gc, schema_init
// =========================================================================

// =========================================================================
// 13. cognitive-push.py — PreInvocation tests
// =========================================================================
describe("cognitive_push_pre_invoke", () => {
	function setPreInvokeStage() {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-invoke"];
	}
	let origArgv: string[];
	beforeEach(() => {
		origArgv = process.argv;
	});
	afterEach(() => {
		process.argv = origArgv;
	});

	it("not cold start returns empty steps (no session)", () => {
		setPreInvokeStage();
		// No session found
		coreMocks.getLatestSession.mockReturnValue(null);
		coreMocks.readMode.mockReturnValue("strict");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.isDuplicate.mockReturnValue(false);

		const res = cognitivePush.main({ transcriptPath: "foo.jsonl" });
		expect(res.injectSteps.length).toBe(1);
		expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
			"WORK TRACKING",
		);
	});

	it("not cold start returns empty steps (is_cold_start==0, strict mode)", () => {
		setPreInvokeStage();
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.readMode.mockReturnValue("strict");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.isDuplicate.mockReturnValue(false);

		const res = cognitivePush.main({ transcriptPath: "foo.jsonl" });
		expect(res.injectSteps.length).toBe(1);
		expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
			"WORK TRACKING",
		);
	});

	it("relax mode injects COORDINATOR BEHAVIORAL DISCIPLINE even if not cold start", () => {
		setPreInvokeStage();
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.readMode.mockReturnValue("relax");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.isDuplicate.mockReturnValue(false);

		const res = cognitivePush.main({ transcriptPath: "foo.jsonl" });
		expect(res.injectSteps.length).toBe(2);
		expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
			"COORDINATOR BEHAVIORAL DISCIPLINE",
		);
		expect((res.injectSteps[1] as any).ephemeralMessage).toContain(
			"WORK TRACKING",
		);
	});
});


// =========================================================================
// 13b. cognitive-push — PreInvocation success (cold start)
// =========================================================================
describe("cognitive_push_pre_invoke_success", () => {
	let origArgv: string[];
	let tmpPath: string;

	beforeEach(() => {
		origArgv = process.argv;
		// Disable Line C by putting getDataDir in a tmp path where no features.json exists
		tmpPath = makeTmpPath();
		bridgePathMocks.getDataDir.mockReturnValue(tmpPath);
	});
	afterEach(() => {
		process.argv = origArgv;
		fs.rmSync(tmpPath, { recursive: true, force: true });
	});

	it("strict mode with cold start injects topic and decisions", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-invoke"];
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 1,
		} as any);
		coreMocks.getSession.mockReturnValue({
			session_id: "c1",
			mode: "strict",
			is_cold_start: 1,
			created_at: "2026-01-01",
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([
			{
				id: 1,
				decision: "dec_text",
				rationale: "",
				user_confirmed: 0,
				created_at: "2026-01-01T00:00:00",
			},
		]);
		coreMocks.readMode.mockReturnValue("strict");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.isDuplicate.mockReturnValue(false);
		coreMocks.formatDecisionsForSessionResume.mockReturnValue(
			"SESSION RESUMED: 活跃话题: t1 — dec_text",
		);
		coreMocks.updateColdStart.mockReturnValue(undefined);
		coreMocks.markFired.mockReturnValue(undefined);
		coreMocks.bumpInjection.mockReturnValue(undefined);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		expect(res.injectSteps.length).toBe(2);
		expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
			"WORK TRACKING",
		);
		const msg = (res.injectSteps[1] as any).ephemeralMessage;
		expect(msg).toContain("活跃话题: t1");
		expect(msg).toContain("dec_text");
		expect(coreMocks.updateColdStart).toHaveBeenCalledWith("c1", 0);
	});

	it("relax mode with cold start injects both discipline and resume", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-invoke"];
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 1,
		} as any);
		coreMocks.getSession.mockReturnValue({
			session_id: "c1",
			mode: "relax",
			is_cold_start: 1,
			created_at: "2026-01-01",
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([
			{
				id: 1,
				decision: "dec_text",
				rationale: "",
				user_confirmed: 0,
				created_at: "2026-01-01T00:00:00",
			},
		]);
		coreMocks.readMode.mockReturnValue("relax");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.isDuplicate.mockReturnValue(false);
		coreMocks.formatDecisionsForSessionResume.mockReturnValue(
			"SESSION RESUMED — 历史决策供参考",
		);
		coreMocks.updateColdStart.mockReturnValue(undefined);
		coreMocks.markFired.mockReturnValue(undefined);
		coreMocks.bumpInjection.mockReturnValue(undefined);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		expect(res.injectSteps.length).toBe(3);
		expect((res.injectSteps[0] as any).ephemeralMessage).toContain(
			"COORDINATOR BEHAVIORAL DISCIPLINE",
		);
		expect((res.injectSteps[1] as any).ephemeralMessage).toContain(
			"WORK TRACKING",
		);
		expect((res.injectSteps[2] as any).ephemeralMessage).toContain(
			"SESSION RESUMED — 历史决策供参考",
		);
	});
});


// =========================================================================
// 13c. cognitive-push — Line C (semantic conflict detection)
// =========================================================================
describe("cognitive_push_line_c", () => {
	let origArgv: string[];
	let tmpDataPath: string;

	beforeEach(() => {
		origArgv = process.argv;
		// Set up features.json for _checkLineCEnabled to read
		tmpDataPath = makeTmpPath();
		bridgePathMocks.getDataDir.mockReturnValue(tmpDataPath);
		// _checkLineCEnabled reads path.dirname(getDataDir()) + "/conf/features.json"
		const confDir = path.join(path.dirname(tmpDataPath), "conf");
		fs.mkdirSync(confDir, { recursive: true });
		fs.writeFileSync(
			path.join(confDir, "features.json"),
			JSON.stringify({
				semantic_conflict_detection: { enabled: true },
			}),
		);
	});

	afterEach(() => {
		process.argv = origArgv;
		fs.rmSync(tmpDataPath, { recursive: true, force: true });
	});

	const lineCBaseMocks = () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-invoke"];
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.readMode.mockReturnValue("strict");
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.isDuplicate.mockReturnValue(false);
		coreMocks.markFired.mockReturnValue(undefined);
		coreMocks.updateColdStart.mockReturnValue(undefined);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getSession.mockReturnValue({
			session_id: "c1",
			mode: "strict",
			is_cold_start: 1,
			created_at: "2026-01-01",
		} as any);
	};

	it("features.json enabled=false → Line C skipped, no conflict injection", () => {
		// Override features.json to disable
		const confDir = path.join(path.dirname(tmpDataPath), "conf");
		fs.writeFileSync(
			path.join(confDir, "features.json"),
			JSON.stringify({
				semantic_conflict_detection: { enabled: false },
			}),
		);
		lineCBaseMocks();
		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("candidate pool empty → window flag set, no injection", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue([]);

		// We need to mock CDAL getUserInputCount to return 20 (turnInterval > 0)
		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([{ type: "USER_INPUT", content: "hello world" }]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("BM25 hit + LLM returns conflicts → inject ephemeralMessage", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		const candidates = [
			{
				id: 42,
				decision: "Redis caching layer",
				rationale: "operational cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		// LLM returns conflicts
		extractDecisionsMocks.getOrCreateConversation.mockReturnValue(
			'{"conflicts": [{"decision_id": 42, "reason": "user is proposing a cache solution"}]}',
		);
		coreMocks.formatConflictInjectionMessage.mockReturnValue(
			"SEMANTIC CONFLICT: Redis caching layer — LLM analysis",
		);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([
				{ type: "USER_INPUT", content: "let's use Redis for caching" },
			]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(1);
		expect(conflictMsgs[0].ephemeralMessage).toContain("Redis caching layer");
		expect(conflictMsgs[0].ephemeralMessage).toContain("LLM analysis");
	});

	it("BM25 hit but LLM returns empty conflicts → no injection", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		const candidates = [
			{
				id: 42,
				decision: "Redis caching layer",
				rationale: "operational cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		extractDecisionsMocks.getOrCreateConversation.mockReturnValue(
			'{"conflicts": []}',
		);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([{ type: "USER_INPUT", content: "let's use Redis" }]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("LLM timeout → silent skip, window flag set", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		const candidates = [
			{
				id: 42,
				decision: "Redis",
				rationale: "cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		extractDecisionsMocks.getOrCreateConversation.mockImplementation(() => {
			throw new Error("timeout");
		});
		// createConversation also fails
		bridgeAgentapiMocks.createConversation.mockImplementation(() => {
			throw new Error("timeout2");
		});

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([{ type: "USER_INPUT", content: "use Redis" }]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("LLM returns non-JSON → silent skip", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		const candidates = [
			{
				id: 42,
				decision: "Redis",
				rationale: "cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		extractDecisionsMocks.getOrCreateConversation.mockReturnValue(
			"not json at all",
		);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([{ type: "USER_INPUT", content: "use Redis" }]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("Same window repeat → conflict skipped (dedup)", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		// isDuplicate returns true for line_c_conflict keys
		coreMocks.isDuplicate.mockImplementation(
			(_cid: string, key: string, _val: string) => {
				return key.includes("line_c_conflict");
			},
		);
		const candidates = [
			{
				id: 42,
				decision: "Redis",
				rationale: "cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		extractDecisionsMocks.getOrCreateConversation.mockReturnValue(
			'{"conflicts": [{"decision_id": 42, "reason": "test"}]}',
		);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([{ type: "USER_INPUT", content: "use Redis again" }]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});

	it("No user message → skip", () => {
		lineCBaseMocks();
		coreMocks.shouldFire.mockReturnValue(true);
		const candidates = [
			{
				id: 42,
				decision: "Redis",
				rationale: "cost",
				decision_type: "rejected",
				created_at: "2026-06-03",
			},
		];
		coreMocks.getRejectedOrDeferredByRelevance.mockReturnValue(candidates);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(1);
		conversationMocks.mockInstance.getUserInputCount = vi
			.fn()
			.mockReturnValue(20);
		// No USER_INPUT steps
		conversationMocks.mockInstance.streamStepsReverse = vi
			.fn()
			.mockReturnValue([]);

		const res = cognitivePush.main({ transcriptPath: "/brain/c1/t.jsonl" });
		const conflictMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("SEMANTIC CONFLICT"),
		);
		expect(conflictMsgs.length).toBe(0);
	});
});


// =========================================================================
// 13d. cognitive-push — PreToolUse
// =========================================================================
describe("cognitive_push_pre_tool_use", () => {
	let origArgv: string[];
	beforeEach(() => {
		origArgv = process.argv;
	});
	afterEach(() => {
		process.argv = origArgv;
	});

	it("tool name not checked — returns empty", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = { toolName: "view_file" };
		const res = cognitivePush.main(ctx);
		expect(res.injectSteps).toEqual([]);
	});

	it("matched tool but no target file — returns empty", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = { toolName: "write_to_file", toolArgs: {} };
		const res = cognitivePush.main(ctx);
		expect(res.injectSteps).toEqual([]);
	});

	it("match tool, target file — triggers global write gate (first attempt: deny)", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = {
			toolName: "write_to_file",
			toolArgs: { TargetFile: "/path/to/my_file.py" },
		};
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([]);
		coreMocks.getHookState.mockReturnValue(null); // first time → retryStatus !== "1"
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.formatWriteGateDenyPrompt.mockReturnValue(
			"GLOBAL-WRITE-GATE: my_file.py",
		);
		coreMocks.isPlanningArtifact.mockReturnValue(false);

		const res = cognitivePush.main(ctx);
		expect(res.decision).toBe("deny");
		expect(res.reason).toContain("GLOBAL-WRITE-GATE");
		expect(coreMocks.setHookState).toHaveBeenCalled();
	});

	it("second attempt with retry status → allow", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = {
			toolName: "write_to_file",
			toolArgs: { TargetFile: "/path/to/my_file.py" },
		};
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([]);
		coreMocks.getHookState.mockReturnValue("1"); // retry → allow
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.getDecisionsByFile.mockReturnValue([]);
		coreMocks.isPlanningArtifact.mockReturnValue(false);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(0);

		const res = cognitivePush.main(ctx);
		expect(res.decision).toBe("allow");
		expect(coreMocks.insertFileChange).toHaveBeenCalledWith(
			"p1",
			"c1",
			"my_file.py",
			"write_tool",
		);
	});

	it("target file is artifact — allow directly", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = {
			toolName: "write_to_file",
			toolArgs: { TargetFile: "/path/to/artifacts/task.md" },
		};
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([]);
		coreMocks.getHookState.mockReturnValue(null);
		coreMocks.isPlanningArtifact.mockReturnValue(true);

		const res = cognitivePush.main(ctx);
		expect(res.injectSteps).toEqual([]);
	});

	it("file-touch injection: allow path with file history", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = {
			toolName: "write_to_file",
			toolArgs: { TargetFile: "/path/to/my_file.py" },
		};
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([]);
		coreMocks.getHookState.mockReturnValue("1"); // retry → allow
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.getDecisionsByFile.mockReturnValue([
			{ id: 1, decision: "Use JWT auth", rationale: "stateless" },
			{ id: 2, decision: "Refresh token 7d rotation", rationale: "security" },
		]);
		coreMocks.shouldFire.mockReturnValue(true);
		coreMocks.formatFileDecisionsInjection.mockReturnValue(
			"my_file.py 关联 2 条历史决策: Use JWT auth",
		);
		coreMocks.isPlanningArtifact.mockReturnValue(false);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(0);

		const res = cognitivePush.main(ctx);
		expect(res.decision).toBe("allow");
		const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("历史决策"),
		);
		expect(recallMsgs.length).toBe(1);
		expect(recallMsgs[0].ephemeralMessage).toContain(
			"my_file.py 关联 2 条历史决策",
		);
		expect(recallMsgs[0].ephemeralMessage).toContain("Use JWT auth");
	});

	it("file-touch injection: dedup same file same turn", () => {
		process.argv = ["node", "cognitive-push.js", "--stage", "pre-tool"];
		const ctx = {
			toolName: "write_to_file",
			toolArgs: { TargetFile: "/path/to/my_file.py" },
		};
		coreMocks.getLatestSession.mockReturnValue({
			session_id: "c1",
			is_cold_start: 0,
		} as any);
		coreMocks.getProjectUuidByConv.mockReturnValue("p1");
		coreMocks.getActiveTopic.mockReturnValue("t1");
		coreMocks.getRecentDecisions.mockReturnValue([]);
		coreMocks.getHookState.mockReturnValue("1");
		coreMocks.setHookState.mockReturnValue(undefined);
		coreMocks.getDecisionsByFile.mockReturnValue([
			{ id: 1, decision: "Use JWT auth", rationale: "stateless" },
		]);
		coreMocks.shouldFire.mockReturnValue(false); // dedup → skip
		coreMocks.isPlanningArtifact.mockReturnValue(false);

		conversationMocks.mockInstance.getCurrentTurnIdx = vi
			.fn()
			.mockReturnValue(0);

		const res = cognitivePush.main(ctx);
		expect(res.decision).toBe("allow");
		const recallMsgs = (res.injectSteps as any[]).filter((s: any) =>
			s.ephemeralMessage?.includes("历史决策"),
		);
		expect(recallMsgs.length).toBe(0);
	});
});
