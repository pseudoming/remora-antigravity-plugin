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
// 9. sandbox-merge.py
// =========================================================================
describe("sandbox_merge", () => {
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

	it("missing args causes error exit", () => {
		process.argv = ["node", "sandbox-merge"];
		expect(() => sandboxMerge()).toThrow("EXIT");
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Usage: sandbox-merge"),
		);
	});

	it("worktree missing causes error exit", () => {
		const tmpPath = makeTmpPath();
		try {
			osHomedirOverride.path = tmpPath;
			// No brain dir exists → worktree not found
			process.argv = [
				"node",
				"sandbox-merge",
				"subagent-123",
				"--target-cwd",
				tmpPath,
			];
			expect(() => sandboxMerge()).toThrow("EXIT");
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Could not find isolated worktree"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("sandbox_merge_success — finds worktree, runs git merge", () => {
		const tmpPath = makeTmpPath();
		try {
			osHomedirOverride.path = tmpPath;
			const wtDir = path.join(
				tmpPath,
				".gemini",
				"antigravity",
				"brain",
				"proj1",
				".system_generated",
				"worktrees",
				"subagent-123",
			);
			fs.mkdirSync(wtDir, { recursive: true });
			const targetCwd = path.join(tmpPath, "target");
			fs.mkdirSync(targetCwd, { recursive: true });

			// Mock execSync: first call returns branch name, second returns diff
			vi.mocked(execSync)
				.mockReturnValueOnce("feature-branch" as any)
				.mockReturnValueOnce("file_a.py\nfile_b.py" as any)
				.mockReturnValueOnce("Merge complete" as any);

			process.argv = [
				"node",
				"sandbox-merge",
				"subagent-123",
				"--target-cwd",
				targetCwd,
			];
			sandboxMerge();

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Merging branch feature-branch"),
			);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("[PHYSICAL_CHANGES] file_a.py"),
			);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("[PHYSICAL_CHANGES] file_b.py"),
			);
			expect(logSpy).toHaveBeenCalledWith("Sandbox merged successfully.");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("sandbox_merge_empty_branch — branch name empty, exits with error", () => {
		const tmpPath = makeTmpPath();
		try {
			osHomedirOverride.path = tmpPath;
			const wtDir = path.join(
				tmpPath,
				".gemini",
				"antigravity",
				"brain",
				"proj1",
				".system_generated",
				"worktrees",
				"subagent-456",
			);
			fs.mkdirSync(wtDir, { recursive: true });

			vi.mocked(execSync).mockReturnValueOnce("" as any);

			process.argv = [
				"node",
				"sandbox-merge",
				"subagent-456",
				"--target-cwd",
				tmpPath,
			];
			expect(() => sandboxMerge()).toThrow("EXIT");
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Could not determine branch name"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("sandbox_merge_diff_exception — git diff fails, does not crash", () => {
		const tmpPath = makeTmpPath();
		try {
			osHomedirOverride.path = tmpPath;
			const wtDir = path.join(
				tmpPath,
				".gemini",
				"antigravity",
				"brain",
				"proj1",
				".system_generated",
				"worktrees",
				"subagent-789",
			);
			fs.mkdirSync(wtDir, { recursive: true });

			// First execSync returns branch, second throws
			vi.mocked(execSync)
				.mockReturnValueOnce("feature-x" as any)
				.mockImplementationOnce(() => {
					throw new Error("diff failed");
				})
				.mockReturnValueOnce("Merged" as any);

			process.argv = [
				"node",
				"sandbox-merge",
				"subagent-789",
				"--target-cwd",
				tmpPath,
			];
			sandboxMerge();

			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to detect physical changes"),
			);
			expect(logSpy).toHaveBeenCalledWith("Sandbox merged successfully.");
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});

	it("sandbox_merge_merge_exception — git merge fails, exits with error", () => {
		const tmpPath = makeTmpPath();
		try {
			osHomedirOverride.path = tmpPath;
			const wtDir = path.join(
				tmpPath,
				".gemini",
				"antigravity",
				"brain",
				"proj1",
				".system_generated",
				"worktrees",
				"subagent-999",
			);
			fs.mkdirSync(wtDir, { recursive: true });

			// First returns branch, second returns diff, third (merge) throws
			vi.mocked(execSync)
				.mockReturnValueOnce("buggy-branch" as any)
				.mockReturnValueOnce("conflict.py" as any)
				.mockImplementationOnce(() => {
					throw new Error("merge conflict");
				});

			process.argv = [
				"node",
				"sandbox-merge",
				"subagent-999",
				"--target-cwd",
				tmpPath,
			];
			expect(() => sandboxMerge()).toThrow("EXIT");
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Git merge failed"),
			);
		} finally {
			fs.rmSync(tmpPath, { recursive: true, force: true });
		}
	});
});
