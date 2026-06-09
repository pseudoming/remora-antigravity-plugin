import { getConn } from "./connection";

export function getRuntimeHookValue(
  sessionId: string,
  turnIdx: number,
  key: string
): string | null {
  const conn = getConn();
  try {
    const row = conn
      .prepare(
        "SELECT value FROM runtime_hook_state WHERE session_id = ? AND turn_idx = ? AND key = ?"
      )
      .get(sessionId, turnIdx, key) as { value: string } | undefined;
    return row ? row.value : null;
  } catch (e) {
    console.warn(`getRuntimeHookValue: ${e}`);
    return null;
  } finally {
    conn.close();
  }
}

export function setRuntimeHookValue(
  sessionId: string,
  turnIdx: number,
  key: string,
  value: string
): void {
  const conn = getConn();
  try {
    conn.prepare("BEGIN EXCLUSIVE").run();
    conn
      .prepare(
        "INSERT INTO runtime_hook_state (session_id, turn_idx, key, value) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(session_id, turn_idx, key) DO UPDATE SET value = excluded.value"
      )
      .run(sessionId, turnIdx, key, value);
    conn.prepare("COMMIT").run();
  } catch (e) {
    console.warn(`setRuntimeHookValue: ${e}`);
  } finally {
    conn.close();
  }
}

export function deleteRuntimeHookValue(
  sessionId: string,
  turnIdx: number,
  key: string
): void {
  const conn = getConn();
  try {
    conn.prepare("BEGIN EXCLUSIVE").run();
    conn
      .prepare(
        "DELETE FROM runtime_hook_state WHERE session_id = ? AND turn_idx = ? AND key = ?"
      )
      .run(sessionId, turnIdx, key);
    conn.prepare("COMMIT").run();
  } catch (e) {
    console.warn(`deleteRuntimeHookValue: ${e}`);
  } finally {
    conn.close();
  }
}

export function trimRuntimeHookStates(
  sessionId: string,
  currentTurnIdx: number
): void {
  const conn = getConn();
  try {
    conn.prepare("BEGIN EXCLUSIVE").run();
    conn
      .prepare(
        "DELETE FROM runtime_hook_state WHERE session_id = ? AND turn_idx >= ?"
      )
      .run(sessionId, currentTurnIdx);
    conn.prepare("COMMIT").run();
  } catch (e) {
    console.warn(`trimRuntimeHookStates: ${e}`);
  } finally {
    conn.close();
  }
}

export function getHookState(
  sessionId: string,
  turnIdx: number,
  key: string
): string | null {
  return getRuntimeHookValue(sessionId, turnIdx, key);
}

export function setHookState(
  sessionId: string,
  turnIdx: number,
  key: string,
  value: string
): void {
  setRuntimeHookValue(sessionId, turnIdx, key, value);
}

export function deleteHookState(
  sessionId: string,
  turnIdx: number,
  key: string
): void {
  deleteRuntimeHookValue(sessionId, turnIdx, key);
}

export function trimHookStates(
  sessionId: string,
  currentTurnIdx: number
): void {
  trimRuntimeHookStates(sessionId, currentTurnIdx);
}
