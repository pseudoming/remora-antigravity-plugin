import { getConn } from "./connection";

export function getProjectUuidByConv(sessionId: string): string | null {
  const conn = getConn();
  try {
    const row = conn.prepare(
      "SELECT project_uuid FROM watermarks WHERE conversation_id=? LIMIT 1"
    ).get(sessionId) as { project_uuid: string | null } | undefined;
    return row ? row.project_uuid : null;
  } catch (e) {
    console.warn(`getProjectUuidByConv: ${e}`);
    return null;
  } finally {
    conn.close();
  }
}

export function watermarkExists(projectUuid: string, conversationId: string): boolean {
  const conn = getConn();
  try {
    const row = conn.prepare(
      "SELECT 1 FROM watermarks WHERE project_uuid=? AND conversation_id=? LIMIT 1"
    ).get(projectUuid, conversationId);
    return row !== undefined;
  } catch (e) {
    console.warn(`watermarkExists: ${e}`);
    return false;
  } finally {
    conn.close();
  }
}

export function getActiveTopicCreatedAt(projectUuid: string): string | null {
  const { getActiveTopicCreatedAt: impl } = require("./topics");
  return impl(projectUuid);
}
