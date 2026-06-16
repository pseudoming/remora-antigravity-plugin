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
// 6. read-session-log.py
// =========================================================================
describe("read_session_log", () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let logSpy: ReturnType<typeof vi.spyOn>;
	let origArgv: string[];

	beforeEach(() => {
		origArgv = process.argv;
		exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("EXIT");
		}) as any);
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => {
		process.argv = origArgv;
		exitSpy.mockRestore();
		logSpy.mockRestore();
	});

	function mockDbExists(tmpPath: string): string {
		const dbFile = path.join(tmpPath, "mock.db");
		fs.writeFileSync(dbFile, "");
		conversationMocks.mockInstance.dbPath = dbFile;
		return dbFile;
	}

	it("read_session_log_no_db — db path not found, exits with error", () => {
		const tmpPath = makeTmpPath();
		try {
			// dbPath points to a non-existent file
			conversationMocks.mockInstance.dbPath = path.join(
				tmpPath,
				"nonexistent.db",
			);
			process.argv = ["node", "read-session-log", "conv_1"];
			expect(() => readSessionLog()).toThrow("EXIT");
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: db path not found"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_success — reads and prints rounds to console", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([
					{ role: "user", content: "hello" },
					{ role: "assistant", content: "hi there" },
				]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi there" },
			]);
			process.argv = ["node", "read-session-log", "conv_1"];
			readSessionLog();
			expect(coreMocks.filterUserAiRounds).toHaveBeenCalled();
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("[USER]: hello"),
			);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("[ASSISTANT]: hi there"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_empty_content — no rounds, prints nothing", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([]);
			process.argv = ["node", "read-session-log", "conv_1"];
			readSessionLog();
			expect(coreMocks.filterUserAiRounds).toHaveBeenCalled();
			// Only usage message would be printed if no results — verify no data printed
			const dataCalls = logSpy.mock.calls.filter(
				(c: any[]) => typeof c[0] === "string" && c[0].includes("["),
			);
			expect(dataCalls.length).toBe(0);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_exception_handling — streamStepsReverse throws, exits with error", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockImplementation(() => {
					throw new Error("db corrupt");
				});
			process.argv = ["node", "read-session-log", "conv_1"];
			expect(() => readSessionLog()).toThrow("EXIT");
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error reading db"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_main_block_no_args — exits with usage", () => {
		process.argv = ["node", "read-session-log"];
		expect(() => readSessionLog()).toThrow("EXIT");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Usage: read-session-log.ts"),
		);
	});

	it("read_session_log_main_block_with_args — conv_id from argv[2]", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([]);
			process.argv = ["node", "read-session-log", "conv_1", "5"];
			readSessionLog();
			// Should parse rounds=5 and pass to filterUserAiRounds
			expect(coreMocks.filterUserAiRounds).toHaveBeenCalled();
			const callArgs = coreMocks.filterUserAiRounds.mock.calls[0];
			expect(callArgs[1]).toBe(5);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_main_block_path_arg — /brain/ path extracts conv_id", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([]);
			process.argv = [
				"node",
				"read-session-log",
				"/brain/conv_1/transcript.jsonl",
			];
			readSessionLog();
			// Should extract "conv_1" from the brain path
			expect(coreMocks.filterUserAiRounds).toHaveBeenCalled();
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_limit_break — streamStepsReverse limit = rounds * 50", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([]);
			process.argv = ["node", "read-session-log", "conv_1", "3"];
			readSessionLog();
			// filterUserAiRounds is called with (steps, 3)
			expect(coreMocks.filterUserAiRounds).toHaveBeenCalled();
			expect(coreMocks.filterUserAiRounds.mock.calls[0][1]).toBe(3);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_rounds_break — default rounds=10 when no argv[3]", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([]);
			coreMocks.filterUserAiRounds = vi.fn().mockReturnValue([]);
			process.argv = ["node", "read-session-log", "conv_1"];
			readSessionLog();
			expect(coreMocks.filterUserAiRounds.mock.calls[0][1]).toBe(10);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_cli_no_args — no arguments, exits with usage", () => {
		process.argv = ["node", "read-session-log"];
		expect(() => readSessionLog()).toThrow("EXIT");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(logSpy).toHaveBeenCalledWith(
			"Usage: read-session-log.ts <conversation_id> [rounds]",
		);
	});

	it("read_session_log_cli_path_arg — brain path with /brain/ prefix extracts conv_id", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ role: "user", content: "test" }]);
			coreMocks.filterUserAiRounds = vi
				.fn()
				.mockReturnValue([{ role: "user", content: "test" }]);
			process.argv = [
				"node",
				"read-session-log",
				"/brain/abc123/transcript.jsonl",
			];
			readSessionLog();
			expect(logSpy).toHaveBeenCalledWith("[USER]: test");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("read_session_log_cli_main — full path with rounds param", () => {
		const tmpPath = makeTmpPath();
		try {
			mockDbExists(tmpPath);
			conversationMocks.mockInstance.streamStepsReverse = vi
				.fn()
				.mockReturnValue([{ role: "assistant", content: "response" }]);
			coreMocks.filterUserAiRounds = vi
				.fn()
				.mockReturnValue([{ role: "assistant", content: "response" }]);
			process.argv = [
				"node",
				"read-session-log",
				"/brain/sess_42/transcript.jsonl",
				"20",
			];
			readSessionLog();
			expect(coreMocks.filterUserAiRounds.mock.calls[0][1]).toBe(20);
			expect(logSpy).toHaveBeenCalledWith("[ASSISTANT]: response");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});
