import { getConn } from "./connection";

/**
 * Returns last message timestamp of implementation_plan.md for this project, or null.
 */
export function getPlanChangeTime(
  projectUuid: string
): string | null {
  const conn = getConn();
  try {
    const row = conn
      .prepare(
        "SELECT MAX(timestamp) as max_ts FROM messages WHERE conversation_id=? AND role='implementation_plan.md'"
      )
      .get(`artifact_sync_${projectUuid}`) as
      | { max_ts: string | null }
      | undefined;
    return row && row.max_ts ? row.max_ts : null;
  } finally {
    conn.close();
  }
}

export function getUserMessagesAfter(
  timestamp: string,
  projectUuid: string
): string[] {
  const conn = getConn();
  try {
    const rows = conn
      .prepare(
        `SELECT m.content FROM messages m
         JOIN watermarks w ON m.conversation_id = w.conversation_id
         WHERE m.timestamp > ?
           AND m.role IN ('USER', 'USER_INPUT', 'USER_EXPLICIT', 'user')
           AND w.project_uuid = ?`
      )
      .all(timestamp, projectUuid) as Array<{ content: string }>;
    return rows.map((r) => r.content);
  } finally {
    conn.close();
  }
}

export function getPlanContent(
  projectUuid: string
): string {
  const conn = getConn();
  try {
    const row = conn
      .prepare(
        "SELECT content FROM messages WHERE conversation_id=? AND role='implementation_plan.md' LIMIT 1"
      )
      .get(`artifact_sync_${projectUuid}`) as
      | { content: string }
      | undefined;
    return row ? row.content : "";
  } finally {
    conn.close();
  }
}

export function enqueueEvent(
  projectUuid: string,
  eventType: string,
  payload: string
): void {
  const conn = getConn();
  try {
    conn
      .prepare(
        "INSERT INTO remora_event_queue (project_uuid, event_type, payload) VALUES (?, ?, ?)"
      )
      .run(projectUuid, eventType, payload);
  } finally {
    conn.close();
  }
}

export function getPendingEvents(): Array<{
  id: number;
  project_uuid: string;
  event_type: string;
  payload: string;
}> {
  const conn = getConn();
  try {
    return conn
      .prepare(
        "SELECT id, project_uuid, event_type, payload FROM remora_event_queue WHERE status='pending' ORDER BY id ASC"
      )
      .all() as Array<{
      id: number;
      project_uuid: string;
      event_type: string;
      payload: string;
    }>;
  } finally {
    conn.close();
  }
}

export function markEventProcessed(
  eventId: number
): void {
  const conn = getConn();
  try {
    conn
      .prepare("UPDATE remora_event_queue SET status='processed' WHERE id=?")
      .run(eventId);
  } finally {
    conn.close();
  }
}

export function getArtifactHash(
  filePath: string
): string | null {
  const conn = getConn();
  try {
    const row = conn
      .prepare("SELECT hash FROM artifact_hashes WHERE file_path=?")
      .get(filePath) as { hash: string } | undefined;
    return row ? row.hash : null;
  } finally {
    conn.close();
  }
}

export function upsertArtifactHash(
  filePath: string,
  fileHash: string
): void {
  const conn = getConn();
  try {
    conn
      .prepare(
        "INSERT OR REPLACE INTO artifact_hashes (file_path, hash, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)"
      )
      .run(filePath, fileHash);
  } finally {
    conn.close();
  }
}

export function deleteArtifactMessages(
  syncConvId: string,
  filename: string
): void {
  const conn = getConn();
  try {
    conn
      .prepare("DELETE FROM messages WHERE conversation_id=? AND role=?")
      .run(syncConvId, filename);
  } finally {
    conn.close();
  }
}

export function insertArtifactMessage(
  syncConvId: string,
  lineNumber: number,
  role: string,
  content: string,
  topicId: string
): void {
  const conn = getConn();
  try {
    conn
      .prepare(
        `INSERT INTO messages (conversation_id, line_number, timestamp, role, content, topic_id)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`
      )
      .run(syncConvId, lineNumber, role, content, topicId);
  } finally {
    conn.close();
  }
}

export function upsertArtifactTopic(
  projectUuid: string,
  topicId: string,
  summary: string
): void {
  const conn = getConn();
  try {
    conn
      .prepare(
        `INSERT INTO project_topics (uuid, topic_id, status, summary, source)
         VALUES (?, ?, 'closed', ?, 'auto')
         ON CONFLICT(uuid, topic_id) DO UPDATE SET
             status='closed',
             summary=excluded.summary,
             updated_at=CURRENT_TIMESTAMP`
      )
      .run(projectUuid, topicId, summary);
  } finally {
    conn.close();
  }
}
