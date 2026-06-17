/**
 * Remora Memory Compactor V2.2 (Modular Split Version)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir, getAntigravityDir } from "../bridge/paths";
import { initDb } from "../schema/schema-init";

import { pruneExpiredWatermarks, pruneDeadSubagentWorktrees } from "../maintenance/session-gc";
import { runGarbageCollection } from "../maintenance/topic-gc";

import { acquireLock, releaseLock } from "./sidecar-lock";
import { processSessions, AgentApiError } from "./extract-decisions";
import { scanAndIngestArtifacts } from "./sync-artifacts";
import { checkPlanApproval } from "./check-approval";
import { consumeEventQueue } from "./consume-events";
import { getConn, getAllProjectUuids } from "@remora/core";

export function pruneSidecarEvents(): void {
	try {
		const pluginName = process.env.ANTIGRAVITY_PLUGIN_NAME ?? "remora-plugin";
		const eventsDir = path.join(
			getAntigravityDir(),
			"sidecar_data",
			pluginName,
			"memory-compactor",
			"events",
		);
		if (fs.existsSync(eventsDir)) {
			const files = fs.readdirSync(eventsDir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => {
					const filePath = path.join(eventsDir, f);
					return {
						name: f,
						path: filePath,
						mtime: fs.statSync(filePath).mtimeMs,
					};
				});

			if (files.length > 10) {
				// 按修改时间升序排列 (最旧的在前)
				files.sort((a, b) => a.mtime - b.mtime);
				const toDelete = files.slice(0, files.length - 10);
				for (const file of toDelete) {
					try {
						fs.unlinkSync(file.path);
					} catch (e) {
						console.error("[Remora Daemon Error] Exception in prune loop:", e);
					}
				}
			}
		}
	} catch (e) {
		console.error("[Remora Daemon Error] Exception initializing sidecar events pruning:", e);
	}
}

function main(): void {
	const args = process.argv.slice(2);
	const eventDriven = args.includes("--event-driven");

	initDb();

	if (eventDriven) {
		try {
			const stdin = fs.readFileSync(process.stdin.fd, "utf-8");
			const context = JSON.parse(stdin);
			scanAndIngestArtifacts(context);
		} catch (e) {
			console.error("[Remora Daemon Error] Exception initializing event driven mode:", e);
		}
	} else {
		acquireLock();
		const cycleStart = Date.now() / 1000;
		try {
			pruneExpiredWatermarks();
			pruneDeadSubagentWorktrees();
			processSessions(cycleStart);

			const conn = getConn();
			try {
				const activeProjects = getAllProjectUuids(conn);
				for (const pUuid of activeProjects) {
					checkPlanApproval(pUuid, conn);
				}
				consumeEventQueue(cycleStart, conn);
				runGarbageCollection(conn);
			} finally {
				conn.close();
			}
		} catch (e) {
			if (e instanceof AgentApiError) {
				process.stderr.write(String(e) + "\n");
				releaseLock();
				process.exit(1);
			}
			console.error(e);
		} finally {
			pruneSidecarEvents();
			releaseLock();
		}
	}
}

export { main };

if (typeof require !== "undefined" && require.main === module) {
	main();
}
