import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// =============================
// Hoisted mocks
// =============================

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: mockReadFileSync,
  };
});

vi.mock("../src/bridge/proto-decoder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bridge/proto-decoder")>();
  return {
    ...actual,
    extractStepPayload: vi.fn((blob: Buffer) => actual.extractStepPayload(blob)),
  };
});

vi.mock("../src/bridge/progress", () => ({
  ProgressSentinel: {
    update: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("../src/bridge/profiler", () => {
  function MockHookProfiler(this: any, ..._args: any[]) {
    this.step = vi.fn();
    this.finish = vi.fn();
  }
  return {
    HookProfiler: MockHookProfiler,
  };
});

vi.mock("@remora/core", () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  profile: vi.fn(),
  HOOKS_PROFILE_LOG: "/tmp/test_hooks_profile.log",
  setTraceId: vi.fn(),
}));

// =============================
// Imports under test
// =============================

import { ConversationDataAccessLayer } from "../src/bridge/conversation";
import { hookEntrypoint, SystemExit } from "../src/bridge/context";
import { ProgressSentinel } from "../src/bridge/progress";
import * as protoDecoder from "../src/bridge/proto-decoder";

// =============================
// Helpers
// =============================

function createMockDb(dbPath: string, stepsData?: Array<[number, number, Buffer]>): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS steps (
      idx INTEGER PRIMARY KEY,
      status INTEGER,
      step_payload BLOB
    )
  `);
  if (stepsData) {
    const insert = db.prepare("INSERT INTO steps (idx, status, step_payload) VALUES (?, ?, ?)");
    for (const [idx, status, payload] of stepsData) {
      insert.run(idx, status, payload);
    }
  }
  db.close();
}

// =============================
// Tests: ConversationDataAccessLayer
// =============================

describe("ConversationDataAccessLayer", () => {
  let tempHome: string;
  let origHome: string | undefined;

  function convDir(): string {
    return path.join(tempHome, ".gemini", "antigravity", "conversations");
  }

  function dbPath(convId: string): string {
    return path.join(convDir(), `${convId}.db`);
  }

  beforeEach(() => {
    origHome = process.env.HOME;
    tempHome = path.join(os.tmpdir(), `test_conv_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
    const cd = convDir();
    fs.mkdirSync(cd, { recursive: true });
  });

  afterEach(() => {
    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
    process.env.HOME = origHome;
  });

  it("test_db_not_exist", () => {
    const cdal = new ConversationDataAccessLayer("non_existent");
    expect(cdal.getCompactionWatermark()).toBe(-1);
    expect(cdal.getMaxStepIndex()).toBe(0);
    expect(cdal.getDbMtime()).toBe(0);
    expect([...cdal.streamStepsReverse()]).toEqual([]);
    expect([...cdal.streamStepsForward()]).toEqual([]);
  });

  it("test_get_compaction_watermark", () => {
    const convId = "test_conv_1";
    const dp = dbPath(convId);

    // 1. Empty DB
    createMockDb(dp);
    const cdal1 = new ConversationDataAccessLayer(convId);
    expect(cdal1.getCompactionWatermark()).toBe(-1);

    // 2. Populated DB
    const steps: Array<[number, number, Buffer]> = [
      [1, 1, Buffer.from("payload1")],
      [2, 5, Buffer.from("payload2")],
      [3, 5, Buffer.from("payload3")],
      [4, 2, Buffer.from("payload4")],
    ];
    createMockDb(dp, steps);
    const cdal2 = new ConversationDataAccessLayer(convId);
    expect(cdal2.getCompactionWatermark()).toBe(3);
  });

  it("test_get_compaction_watermark_exception", () => {
    const convId = "test_conv_exception";
    const dp = dbPath(convId);

    // Create DB with wrong schema
    const db = new Database(dp);
    db.exec("CREATE TABLE steps (not_idx INTEGER)");
    db.close();

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getCompactionWatermark()).toBe(-1);
  });

  it("test_get_max_step_index", () => {
    const convId = "test_conv_2";
    const dp = dbPath(convId);

    // 1. Empty DB
    createMockDb(dp);
    const cdal1 = new ConversationDataAccessLayer(convId);
    expect(cdal1.getMaxStepIndex()).toBe(0);

    // 2. Populated DB
    const steps: Array<[number, number, Buffer]> = [
      [1, 1, Buffer.from("payload1")],
      [5, 2, Buffer.from("payload2")],
    ];
    createMockDb(dp, steps);
    const cdal2 = new ConversationDataAccessLayer(convId);
    expect(cdal2.getMaxStepIndex()).toBe(5);
  });

  it("test_get_max_step_index_exception", () => {
    const convId = "test_conv_exception_max";
    const dp = dbPath(convId);

    // Create DB with wrong schema
    const db = new Database(dp);
    db.exec("CREATE TABLE steps (not_idx INTEGER)");
    db.close();

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getMaxStepIndex()).toBe(0);
  });

  it("test_get_db_mtime", () => {
    const convId = "test_conv_mtime";
    const dp = dbPath(convId);
    createMockDb(dp);

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getDbMtime()).toBeGreaterThan(0);
  });

  it("test_stream_steps_reverse", () => {
    const convId = "test_conv_reverse";
    const dp = dbPath(convId);

    const steps: Array<[number, number, Buffer]> = [
      [1, 1, Buffer.from("p1")],
      [2, 1, Buffer.from("p2")],
      [3, 1, Buffer.from("p3")],
    ];
    createMockDb(dp, steps);

    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockImplementation((blob: Buffer) => ({ raw: blob.toString("utf-8") }));

    const cdal = new ConversationDataAccessLayer(convId);
    const results = [...cdal.streamStepsReverse(2)];

    expect(results).toHaveLength(2);
    // Should be DESC order
    expect(results[0]).toEqual({ raw: "p3", step_index: 3 });
    expect(results[1]).toEqual({ raw: "p2", step_index: 2 });
  });

  it("test_stream_steps_reverse_exception", () => {
    const convId = "test_conv_reverse_exc";
    const dp = dbPath(convId);
    // wrong schema triggers exception in query
    const db = new Database(dp);
    db.exec("CREATE TABLE steps (not_idx INTEGER)");
    db.close();

    const cdal = new ConversationDataAccessLayer(convId);
    expect([...cdal.streamStepsReverse()]).toEqual([]);
  });

  it("test_stream_steps_forward", () => {
    const convId = "test_conv_forward";
    const dp = dbPath(convId);

    const steps: Array<[number, number, Buffer]> = [
      [10, 1, Buffer.from("p10")],
      [11, 1, Buffer.from("p11")],
      [12, 1, Buffer.from("p12")],
    ];
    createMockDb(dp, steps);

    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockImplementation((blob: Buffer) => ({ raw: blob.toString("utf-8") }));

    const cdal = new ConversationDataAccessLayer(convId);
    const results = [...cdal.streamStepsForward(11)];

    expect(results).toHaveLength(2);
    // Should be ASC order starting from start_idx
    expect(results[0]).toEqual({ raw: "p11", step_index: 11 });
    expect(results[1]).toEqual({ raw: "p12", step_index: 12 });
  });

  it("test_stream_steps_forward_exception", () => {
    const convId = "test_conv_forward_exc";
    const dp = dbPath(convId);
    const db = new Database(dp);
    db.exec("CREATE TABLE steps (not_idx INTEGER)");
    db.close();

    const cdal = new ConversationDataAccessLayer(convId);
    expect([...cdal.streamStepsForward()]).toEqual([]);
  });

  it("test_get_latest_user_message", () => {
    const convId = "test_conv_user";
    const dp = dbPath(convId);

    const steps: Array<[number, number, Buffer]> = [
      [1, 1, Buffer.from("p1")],
      [2, 1, Buffer.from("p2")],
    ];
    createMockDb(dp, steps);

    // Mock return values for reversed order
    // idx 2 is NOT USER_INPUT, idx 1 IS USER_INPUT
    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockReturnValueOnce({ type: "PLANNER_RESPONSE", content: "planner message" });
    mockExtract.mockReturnValueOnce({ type: "USER_INPUT", content: "hello user" });

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getLatestUserMessage()).toBe("hello user");
  });

  it("test_get_latest_user_message_none", () => {
    const convId = "test_conv_user_none";
    const dp = dbPath(convId);
    createMockDb(dp, [[1, 1, Buffer.from("p1")]]);

    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockReturnValue({ type: "OTHER" });

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getLatestUserMessage()).toBe(null);
  });

  it("test_get_latest_planner_response", () => {
    const convId = "test_conv_planner";
    const dp = dbPath(convId);

    const steps: Array<[number, number, Buffer]> = [
      [1, 1, Buffer.from("p1")],
      [2, 1, Buffer.from("p2")],
    ];
    createMockDb(dp, steps);

    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockReturnValueOnce({ type: "PLANNER_RESPONSE", content: "planner message" });
    mockExtract.mockReturnValueOnce({ type: "USER_INPUT", content: "hello user" });

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getLatestPlannerResponse()).toBe("planner message");
  });

  it("test_get_latest_planner_response_none", () => {
    const convId = "test_conv_planner_none";
    const dp = dbPath(convId);
    createMockDb(dp, [[1, 1, Buffer.from("p1")]]);

    const mockExtract = vi.mocked(protoDecoder.extractStepPayload);
    mockExtract.mockReturnValue({ type: "OTHER" });

    const cdal = new ConversationDataAccessLayer(convId);
    expect(cdal.getLatestPlannerResponse()).toBe(null);
  });
});

// =====================================================================
// Tests for bridge/context.ts: hookEntrypoint decorator
// =====================================================================

describe("hookEntrypoint", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  function getStdoutOutput(): string {
    return stdoutSpy.mock.calls.map((c) => c[0]).join("").trim();
  }

  beforeEach(() => {
    mockReadFileSync.mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | null) => {
      throw new Error(`EXIT_${code}`);
    });
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function callHook(cb: (inputData: Record<string, unknown>) => Record<string, unknown>, fallback?: Record<string, unknown>): void {
    const decorated = hookEntrypoint(fallback)(cb);
    try {
      decorated();
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith("EXIT_"))) throw e;
    }
  }

  it("test_hook_entrypoint_default_fallback", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "test" } }));

    callHook(() => ({ decision: "allow" }));

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
  });

  it("test_hook_entrypoint_none_fallback_uses_default", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "test" } }));

    callHook(() => ({ decision: "deny", reason: "test" }), undefined);

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("deny");
  });

  it("test_hook_entrypoint_stdin_json_error", () => {
    mockReadFileSync.mockReturnValue("not valid json {{{");

    callHook(() => ({ decision: "allow" }));

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
  });

  it("test_hook_entrypoint_stdin_json_error_with_log_file", () => {
    mockReadFileSync.mockReturnValue("not valid json {{{");

    callHook(() => ({ decision: "allow" }));

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
  });

  it("test_hook_entrypoint_status_completed", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ transcriptPath: "/tmp/t.jsonl" }));

    callHook(() => ({ decision: "allow", status: "completed", details: "all done" }));

    expect(ProgressSentinel.update).toHaveBeenCalledWith("/tmp/t.jsonl", "completed", undefined, "all done");
  });

  it("test_hook_entrypoint_invocation_non_dict_result", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ invocationNum: 1 }));

    callHook(() => "not a dict" as unknown as Record<string, unknown>);

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({});
  });

  it("test_hook_entrypoint_invocation_with_inject_steps", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ invocationNum: 1 }));

    callHook(() => ({ injectSteps: [{ ephemeralMessage: "hello" }] }));

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({ injectSteps: [{ ephemeralMessage: "hello" }] });
  });

  it("test_hook_entrypoint_system_exit_code_zero_tool_use", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "test" } }));

    callHook(() => {
      throw new SystemExit(0);
    });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
  });

  it("test_hook_entrypoint_system_exit_nonzero_non_tool", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ invocationNum: 1 }));

    callHook(() => {
      throw new SystemExit(1);
    });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({ injectSteps: [] });
  });

  it("test_hook_entrypoint_exception_with_decision_fallback", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "test" } }));

    callHook(() => {
      throw new Error("something broke");
    }, { decision: "allow" });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
    expect("decision_reason" in result).toBe(true);
    expect(result["decision_reason"]).toContain("Remora Fallback");
  });

  it("test_hook_entrypoint_exception_no_decision_fallback", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "test" } }));

    callHook(() => {
      throw new Error("other error");
    }, { injectSteps: [] as unknown[] });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["injectSteps"]).toEqual([]);
  });

  it("test_hook_entrypoint_base_exception_non_tool", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ invocationNum: 1 }));

    callHook(() => {
      // Simulate BaseException (non-Error throw) — use a plain object with custom name
      const exc = { constructor: { name: "SystemError" }, message: "critical" };
      throw exc;
    });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({});
  });

  it("test_hook_entrypoint_stop_hook", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ executionNum: 1 }));

    callHook(() => ({ decision: "allow" }));

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
  });

  it("test_hook_entrypoint_post_tool_use", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ postTool: true }));

    callHook(() => ({ some: "value" }));

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({});
  });

  it("test_hook_entrypoint_exception_with_tool_use", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ toolCall: { name: "write" } }));

    callHook(() => {
      throw new Error("test error");
    });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result["decision"]).toBe("allow");
    expect(result["decision_reason"]).toContain("Remora Fallback");
  });

  it("test_hook_entrypoint_system_exit_zero_non_tool", () => {
    // Python: sys.exit(0) — in the TS wrapper, process.exit(0) is mocked to throw SystemExit-like error
    // But here the user function calls process.exit(0) directly which we mock as a throw.
    // The wrapper would catch the EXIT_0 error inside the inner try block.
    // Actually, in the test, we mock process.exit to throw, and the wrapper's catch(e) catches
    // the thrown error. Since it's not instanceof SystemExit, it falls to the Error handler.
    // The test in Python calls sys.exit(0) inside the user function, which raises SystemExit.
    // The decorator catches it as SystemExit code 0 and handles it.
    // In TS, we throw new SystemExit(0):
    mockReadFileSync.mockReturnValue(JSON.stringify({ invocationNum: 1 }));

    callHook(() => {
      throw new SystemExit(0);
    });

    const output = getStdoutOutput();
    const result = JSON.parse(output);
    expect(result).toEqual({});
  });
});
