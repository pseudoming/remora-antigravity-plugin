from core.logger import error as log_error
from core.storage.connection import get_conn, closing

USER_ROLES = ("USER", "USER_INPUT", "USER_EXPLICIT", "user")


def get_latest_non_user_messages(conv_id, limit=5):
    try:
        with closing(get_conn()) as conn:
            with conn:
                rows = conn.execute(
                    "SELECT timestamp, role, content FROM messages "
                    "WHERE conversation_id = ? "
                    "AND role NOT IN (?, ?, ?, ?) "
                    "AND content IS NOT NULL AND content != '' "
                    "ORDER BY line_number DESC, id DESC "
                    "LIMIT ?",
                    (conv_id, *USER_ROLES, limit)
                ).fetchall()
                return [
                    {"timestamp": r[0], "role": r[1], "content": r[2]}
                    for r in rows
                ]
    except Exception as e:
        log_error(f"get_latest_non_user_messages failed: {e}")
        return []
