import os
import sqlite3
import pytest

from core.storage.messages import get_latest_non_user_messages
import core.storage.connection as conn_module

TEST_DB_PATH = "/tmp/test_remora_messages.db"


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(conn_module, "get_db_path", lambda: TEST_DB_PATH)
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)

    conn = sqlite3.connect(TEST_DB_PATH, timeout=15)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            timestamp TIMESTAMP,
            role TEXT,
            content TEXT,
            topic_id TEXT,
            UNIQUE(conversation_id, line_number)
        )
    """)
    conn.commit()
    conn.close()
    yield
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)


def _insert_msg(conv_id, line_number, role, content, timestamp=None, topic_id=None):
    conn = sqlite3.connect(TEST_DB_PATH, timeout=15)
    cursor = conn.cursor()
    if timestamp is None:
        cursor.execute(
            "INSERT INTO messages (conversation_id, line_number, role, content, topic_id) VALUES (?, ?, ?, ?, ?)",
            (conv_id, line_number, role, content, topic_id)
        )
    else:
        cursor.execute(
            "INSERT INTO messages (conversation_id, line_number, timestamp, role, content, topic_id) VALUES (?, ?, ?, ?, ?, ?)",
            (conv_id, line_number, timestamp, role, content, topic_id)
        )
    conn.commit()
    conn.close()


class TestGetLatestNonUserMessages:
    def test_empty_db_returns_empty(self):
        result = get_latest_non_user_messages("conv_1")
        assert result == []

    def test_no_matching_conv_id(self):
        _insert_msg("conv_1", 1, "model", "hello")
        result = get_latest_non_user_messages("conv_2")
        assert result == []

    def test_filters_user_roles(self):
        _insert_msg("conv_1", 1, "model", "model msg")
        _insert_msg("conv_1", 2, "USER", "user msg")
        _insert_msg("conv_1", 3, "USER_INPUT", "input msg")
        _insert_msg("conv_1", 4, "user", "lower user")
        _insert_msg("conv_1", 5, "USER_EXPLICIT", "explicit")
        result = get_latest_non_user_messages("conv_1")
        assert len(result) == 1
        assert result[0]["content"] == "model msg"

    def test_filters_empty_content(self):
        _insert_msg("conv_1", 1, "model", "")
        _insert_msg("conv_1", 2, "model", None)
        _insert_msg("conv_1", 3, "model", "valid")
        result = get_latest_non_user_messages("conv_1")
        assert len(result) == 1
        assert result[0]["content"] == "valid"

    def test_respects_limit(self):
        for i in range(10):
            _insert_msg("conv_1", i, "model", f"msg_{i}")
        result = get_latest_non_user_messages("conv_1", limit=3)
        assert len(result) == 3

    def test_default_limit_is_5(self):
        for i in range(10):
            _insert_msg("conv_1", i, "tool", f"msg_{i}")
        result = get_latest_non_user_messages("conv_1")
        assert len(result) == 5

    def test_returns_newest_first(self):
        _insert_msg("conv_1", 1, "model", "oldest")
        _insert_msg("conv_1", 2, "model", "newer")
        _insert_msg("conv_1", 3, "model", "newest")
        result = get_latest_non_user_messages("conv_1")
        assert result[0]["content"] == "newest"
        assert result[1]["content"] == "newer"
        assert result[2]["content"] == "oldest"

    def test_includes_timestamp_and_role(self):
        import time
        ts = time.strftime('%Y-%m-%d %H:%M:%S')
        _insert_msg("conv_1", 1, "tool", "msg", timestamp=ts)
        result = get_latest_non_user_messages("conv_1")
        assert len(result) == 1
        assert result[0]["role"] == "tool"
        assert result[0]["timestamp"] is not None

    def test_db_connection_error_returns_empty(self, monkeypatch):
        def _raise_error(*args, **kwargs):
            raise sqlite3.OperationalError("db locked")
        monkeypatch.setattr("core.storage.connection.sqlite3.connect", _raise_error)
        result = get_latest_non_user_messages("conv_error")
        assert result == []
