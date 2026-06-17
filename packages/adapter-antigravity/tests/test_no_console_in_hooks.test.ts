/**
 * Hook stdout purity guard.
 *
 * Hooks communicate with the Antigravity runtime via stdout JSON.
 * Any console.log() in hook source code pollutes the output channel
 * and causes the runtime to reject the response (fallback to "allow").
 * This test enforces that no hook file contains console.log().
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ADAPTER_SRC = path.resolve(__dirname, "..", "src");

// Directories whose .ts files run inside the hook process (all PreToolUse/PreInvocation stages)
// Directories containing .ts files that run inside hook processes
const HOOK_DIRS = [
	"hooks",
	"hooks/post-filters",
	"hooks/command-auditors",
	"sandbox/check-subagents-liveness.ts",  // runs as PreInvocation hook
	"bridge/context.ts",   // wraps every hook invocation
	"bridge/progress.ts",  // ProgressSentinel called by context.ts
];

function collectTsFiles(entries: string[]): string[] {
	const results: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(ADAPTER_SRC, entry);
		if (!fs.existsSync(fullPath)) continue;
		const stat = fs.statSync(fullPath);
		if (stat.isFile()) {
			if (fullPath.endsWith(".ts")) results.push(fullPath);
		} else if (stat.isDirectory()) {
			for (const dirent of fs.readdirSync(fullPath, { recursive: true })) {
				const fp = path.join(fullPath, dirent);
				if (fp.endsWith(".ts") && fs.statSync(fp).isFile()) {
					results.push(fp);
				}
			}
		}
	}
	return results;
}

describe("Hook stdout guard", () => {
	it("hook files must not contain console.log()", () => {
		const files = collectTsFiles(HOOK_DIRS);
		expect(files.length).toBeGreaterThan(0);

		const violations: string[] = [];
		for (const fp of files) {
			const content = fs.readFileSync(fp, "utf-8");
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const trimmed = lines[i].trim();
				// Skip comments
				if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
				if (trimmed.includes("console.log(")) {
					violations.push(
						`${path.relative(ADAPTER_SRC, fp)}:${i + 1}  →  ${trimmed.slice(0, 120)}`,
					);
				}
			}
		}

		if (violations.length > 0) {
			expect.fail(
				"🚨 HOOK STDOUT POLLUTION: console.log() detected in hook files!\n\n" +
					"Hook processes communicate via stdout JSON. Any console.log()\n" +
					"corrupts the output and causes the runtime to reject the response.\n" +
					"Use info() from @remora/core for structured logging instead.\n\n" +
					"Offending lines:\n" +
					violations.map((v) => `  • ${v}`).join("\n"),
			);
		} else {
			expect(violations).toEqual([]);
		}
	});
});
