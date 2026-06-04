import os
import sqlite3
import pytest
import sys
import json

# Ensure scripts dir is importable
scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

import lib.dao as dao
from maintenance.migrate_to_msg_id import run_migration

TEST_DB_PATH = "/tmp/test_remora_migration.db"

@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(dao, "get_db_path", lambda: TEST_DB_PATH)
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
        
    # Initialize the schema for testing
    import schema_init
    monkeypatch.setattr(schema_init, "DB_PATH", TEST_DB_PATH)
    schema_init.init_db()
    
    yield
    
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)

def test_migration_idempotency_and_accuracy():
    from contextlib import closing
    with closing(sqlite3.connect(TEST_DB_PATH)) as conn:
        with conn:
            # 1. Insert fake messages
            conn.execute("INSERT INTO messages (conversation_id, line_number, content) VALUES ('conv1', 10, 'msg 10')")
            conn.execute("INSERT INTO messages (conversation_id, line_number, content) VALUES ('conv1', 20, 'msg 20')")
            
            # Fetch native IDs
            id_10 = conn.execute("SELECT id FROM messages WHERE line_number=10").fetchone()[0]
            id_20 = conn.execute("SELECT id FROM messages WHERE line_number=20").fetchone()[0]
            
            # 2. Insert mock topic decisions (2 exact match, 1 orphan)
            # Match 1: evidence = [10], created_at_line = 20
            conn.execute("INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, decision, rationale, evidence_msg_ids, created_at_line) VALUES ('p1', 't1', 'conv1', 'd1', 'r1', '[10]', 20)")
            # Match 2: evidence = [10, 20], created_at_line = 10
            conn.execute("INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, decision, rationale, evidence_msg_ids, created_at_line) VALUES ('p1', 't2', 'conv1', 'd2', 'r2', '[10, 20]', 10)")
            # Orphan: evidence = [999], created_at_line = 888 (doesn't exist)
            conn.execute("INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, decision, rationale, evidence_msg_ids, created_at_line) VALUES ('p1', 't3', 'conv1', 'd3', 'r3', '[999]', 888)")
            
            # 3. Insert mock watermarks
            conn.execute("INSERT INTO watermarks (project_uuid, conversation_id, last_line_processed) VALUES ('p1', 'conv1', 20)")
            conn.execute("INSERT INTO watermarks (project_uuid, conversation_id, last_line_processed) VALUES ('p1', 'conv2', 999)")

    # Run migration
    run_migration()
    
    with closing(sqlite3.connect(TEST_DB_PATH)) as conn:
        # Assertions
        # Match 1
        d1 = conn.execute("SELECT evidence_msg_db_ids, created_at_msg_id FROM topic_decisions WHERE topic_id='t1'").fetchone()
        assert json.loads(d1[0]) == [id_10]
        assert d1[1] == id_20
        
        # Match 2
        d2 = conn.execute("SELECT evidence_msg_db_ids, created_at_msg_id FROM topic_decisions WHERE topic_id='t2'").fetchone()
        assert json.loads(d2[0]) == [id_10, id_20]
        assert d2[1] == id_10
        
        # Orphan
        d3 = conn.execute("SELECT evidence_msg_db_ids, created_at_msg_id FROM topic_decisions WHERE topic_id='t3'").fetchone()
        assert json.loads(d3[0]) == []
        assert d3[1] == -1
        
        # Watermarks
        w1 = conn.execute("SELECT last_msg_id FROM watermarks WHERE conversation_id='conv1'").fetchone()
        assert w1[0] == id_20
        w2 = conn.execute("SELECT last_msg_id FROM watermarks WHERE conversation_id='conv2'").fetchone()
        assert w2[0] == -1

    # Run migration again to test idempotency
    run_migration()
    
    # State should remain completely identical
    with closing(sqlite3.connect(TEST_DB_PATH)) as conn:
        d1_again = conn.execute("SELECT evidence_msg_db_ids, created_at_msg_id FROM topic_decisions WHERE topic_id='t1'").fetchone()
        assert json.loads(d1_again[0]) == [id_10]
        assert d1_again[1] == id_20

def test_migration_with_nulls():
    from contextlib import closing
    with closing(sqlite3.connect(TEST_DB_PATH)) as conn:
        with conn:
            conn.execute("INSERT INTO topic_decisions (project_uuid, topic_id, conversation_id, decision, rationale, created_at_line) VALUES ('p1', 't4', 'conv1', 'd4', 'r4', NULL)")
            conn.execute("INSERT INTO watermarks (project_uuid, conversation_id, last_line_processed) VALUES ('p1', 'conv_null', NULL)")
    run_migration()
