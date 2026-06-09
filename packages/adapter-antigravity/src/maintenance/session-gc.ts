import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { pruneExpiredWatermarks as _prune, setTraceId } from "@remora/core";

const BRAIN_DIR = path.join(os.homedir(), ".gemini", "antigravity", "brain");

export function pruneExpiredWatermarks(brainDir: string = BRAIN_DIR): void {
  _prune(brainDir);
}

export function main(): void {
  setTraceId(`c_${randomUUID().slice(0, 8)}`);
  pruneExpiredWatermarks(BRAIN_DIR);
}
