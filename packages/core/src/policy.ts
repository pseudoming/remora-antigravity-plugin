/**
 * Unified operational thresholds and limits (Magic Numbers)
 * Centralizing Policy distinct from Mechanism.
 */
export const SYSTEM_POLICY = {
	SANDBOX: {
		// Zombie process and tool execution limits
		HEAVY_TOOL_TIMEOUT_SEC: 180,
		NORMAL_TOOL_TIMEOUT_SEC: 60,
		ZOMBIE_TIMEOUT_SEC: 300,
	},
	ORCHESTRATION: {
		// Subagent and execution limits
		REPEAT_SPAWN_WINDOW_MS: 3 * 60 * 1000, // 3 minutes
		MAX_EXECUTION_SEC: 300, // extract-decisions max time
		STREAM_HISTORY_DEPTH: 300, // session-guardian step limit
	},
	SAFETY: {
		// Context and I/O limits
		MAX_PROMPT_CHARS: 1500,
		FILE_READ_WARN_BYTES: 80 * 1024, // 80KB
		FILE_READ_DENY_BYTES: 160 * 1024, // 160KB
		SOURCE_LIMIT_BYTES: 400 * 1024, // 400KB accumulated
		DATA_LIMIT_BYTES: 150 * 1024, // 150KB accumulated
		PROMPT_DENSITY_LIMIT: 500, // chars per density check
		VIEW_FILE_LINE_LIMIT: 300,
	},
	GREP: {
		// Pre-allocation sizes for text processing
		DIR_DEFAULT_BYTES: 15 * 1024,
		DIR_SMALL_BYTES: 5 * 1024,
		FILE_MAX_BYTES: 10 * 1024,
	},
	DISPLAY: {
		// Snippet length for telemetry/display
		WARM_SNIPPET_CHARS: 500,
	},
} as const;
