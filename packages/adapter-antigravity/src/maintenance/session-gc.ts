import { randomUUID } from "node:crypto";
import {
	pruneExpiredWatermarks as _prune,
	setTraceId,
	judgeZombie,
} from "@remora/core";
import { getBrainDir } from "../bridge/paths";
import { ConversationDataAccessLayer } from "../bridge/conversation";
import { getParentConvId } from "../bridge/subagent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

export function pruneExpiredWatermarks(brainDir?: string): void {
	const dir = brainDir ?? getBrainDir();
	_prune(dir);
}

export function pruneDeadSubagentWorktrees(brainDir?: string): void {
	const dir = brainDir ?? getBrainDir();
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const convId = entry.name;
		if (convId.length !== 36) continue;

		const parentId = getParentConvId(convId);
		if (!parentId) continue;

		const cdal = new ConversationDataAccessLayer(convId);
		let isDead = false;

		let steps: any[] = [];
		try {
			steps = Array.from(cdal.streamStepsReverse(200));
		} catch {
			isDead = true;
		}

		if (!isDead) {
			if (steps.length === 0) {
				const SPAWN_TIMEOUT_SEC = 30;
				const mtime = cdal.getDbMtime();
				const now = Date.now() / 1000;
				const ageSeconds = mtime > 0 ? now - mtime : 0;
				if (mtime > 0 && ageSeconds > SPAWN_TIMEOUT_SEC) {
					isDead = true;
				}
			} else {
				let lastToolName: string | null = null;
				for (const step of steps) {
					const stepType = step["type"];
					if (
						[
							"RUN_COMMAND",
							"VIEW_FILE",
							"CODE_ACTION",
							"GREP_SEARCH",
							"FIND",
							"LIST_DIR",
							"LIST_DIRECTORY",
						].includes(stepType)
					) {
						lastToolName = stepType.toLowerCase();
						break;
					}
				}
				const mtime = cdal.getDbMtime();
				const idleSeconds = Math.floor((Date.now() - mtime * 1000) / 1000);
				const [isZombie] = judgeZombie(
					idleSeconds,
					lastToolName || "",
					new Set(["run_command", "grep_search"]),
				);
				if (isZombie) {
					isDead = true;
				}
			}
		}

		if (isDead) {
			const parentWorktreeDir = path.join(
				os.homedir(),
				".gemini/antigravity/brain",
				parentId,
				".system_generated",
				"worktrees",
			);
			if (fs.existsSync(parentWorktreeDir)) {
				const shortId = convId.slice(0, 8);
				const dirs = fs.readdirSync(parentWorktreeDir);
				for (const dirName of dirs) {
					if (dirName.includes(shortId) || dirName === convId) {
						const worktreePath = path.join(parentWorktreeDir, dirName);
						try {
							const stat = fs.statSync(worktreePath);
							const ageMs = Date.now() - stat.mtimeMs;
							if (ageMs > 3600000) {
								fs.rmSync(worktreePath, { recursive: true, force: true });
							}
						} catch (e: any) {
							console.debug("[Remora FS/DB Debug] Omission expected: ", e.message || e);
						}
					}
				}
			}
		}
	}

	try {
		execSync("git worktree prune", { stdio: "ignore" });
	} catch (err: any) {
		console.debug("[Remora FS/DB Debug] Omission expected: ", err.message || err);
	}

	try {
		const output = execSync('git branch --list "subagent-*"').toString();
		const branches = output.split('\n').map(b => b.replace('*', '').trim()).filter(Boolean);
		for (const branch of branches) {
			try {
				execSync(`git branch -D ${branch}`, { stdio: 'ignore' });
			} catch {
				// Branch in use by active worktree, safely ignored
			}
		}
	} catch (e: any) {
		console.debug("[Remora FS/DB Debug] Branch cleanup failed: ", e.message || e);
	}
}

export function main(): void {
	setTraceId(`c_${randomUUID().slice(0, 8)}`);
	pruneExpiredWatermarks();
	pruneDeadSubagentWorktrees();
}
