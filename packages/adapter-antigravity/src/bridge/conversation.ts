import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";
import { extractStepPayload } from "./proto-decoder";

export class ConversationDataAccessLayer {
  convId: string;
  brainDir: string;
  dbPath: string;

  constructor(convId: string) {
    this.convId = convId;
    const homeDir = process.env.HOME ?? os.homedir();
    this.brainDir = path.join(homeDir, ".gemini", "antigravity", "brain");
    this.dbPath = path.join(homeDir, ".gemini", "antigravity", "conversations", `${convId}.db`);
  }

  // ---------------------------------------------------------
  // 1. Database Metadata
  // ---------------------------------------------------------

  getCompactionWatermark(): number {
    if (!fs.existsSync(this.dbPath)) {
      return -1;
    }
    try {
      const db = new Database(this.dbPath, { timeout: 15000 });
      try {
        const row = db.prepare("SELECT MAX(idx) FROM steps WHERE status = 5;").get() as { "MAX(idx)": number | null } | undefined;
        return (row && row["MAX(idx)"] !== null) ? row["MAX(idx)"] : -1;
      } finally {
        db.close();
      }
    } catch {
      return -1;
    }
  }

  getMaxStepIndex(): number {
    if (!fs.existsSync(this.dbPath)) {
      return 0;
    }
    try {
      const db = new Database(this.dbPath, { timeout: 15000 });
      try {
        const row = db.prepare("SELECT MAX(idx) FROM steps").get() as { "MAX(idx)": number | null } | undefined;
        return (row && row["MAX(idx)"] !== null) ? row["MAX(idx)"] : 0;
      } finally {
        db.close();
      }
    } catch {
      return 0;
    }
  }

  getDbMtime(): number {
    if (fs.existsSync(this.dbPath)) {
      return fs.statSync(this.dbPath).mtimeMs / 1000;
    }
    return 0;
  }

  // ---------------------------------------------------------
  // 2. Native SQLite Payload Extraction
  // ---------------------------------------------------------

  *streamStepsReverse(limit: number = 1000): Generator<Record<string, any>> {
    if (!fs.existsSync(this.dbPath)) {
      return;
    }

    try {
      const db = new Database(this.dbPath, { timeout: 15000 });
      try {
        const rows = db.prepare("SELECT idx, step_payload FROM steps ORDER BY idx DESC LIMIT ?").all(limit) as Array<{ idx: number; step_payload: Buffer }>;
        for (const row of rows) {
          const entry = extractStepPayload(row.step_payload);
          entry["step_index"] = row.idx;
          yield entry;
        }
      } finally {
        db.close();
      }
    } catch {
      return;
    }
  }

  *streamStepsForward(startIdx: number = 0): Generator<Record<string, any>> {
    if (!fs.existsSync(this.dbPath)) {
      return;
    }

    try {
      const db = new Database(this.dbPath, { timeout: 15000 });
      try {
        const rows = db.prepare("SELECT idx, step_payload FROM steps WHERE idx >= ? ORDER BY idx ASC").all(startIdx) as Array<{ idx: number; step_payload: Buffer }>;
        for (const row of rows) {
          const entry = extractStepPayload(row.step_payload);
          entry["step_index"] = row.idx;
          yield entry;
        }
      } finally {
        db.close();
      }
    } catch {
      return;
    }
  }

  getLatestUserMessage(): string | null {
    for (const step of this.streamStepsReverse(50)) {
      if (step["type"] === "USER_INPUT") {
        return step["content"] ?? "";
      }
    }
    return null;
  }

  getLatestPlannerResponse(): string | null {
    for (const step of this.streamStepsReverse(50)) {
      if (step["type"] === "PLANNER_RESPONSE") {
        return step["content"] ?? "";
      }
    }
    return null;
  }

  getCurrentTurnIdx(): number {
    for (const step of this.streamStepsReverse(1000)) {
      if (step["type"] === "USER_INPUT") {
        return step["step_index"] ?? 0;
      }
    }
    return 0;
  }

  getUserInputCount(): number {
    let count = 0;
    for (const step of this.streamStepsForward()) {
      if (step["type"] === "USER_INPUT") {
        count += 1;
      }
    }
    return count;
  }
}
