import os
import sys
import json
import sqlite3
import logging

scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from lib.dao import _get_conn
from contextlib import closing

def migrate_topic_decisions(conn):
    cursor = conn.cursor()
    # Find all decisions that haven't been fully migrated
    cursor.execute("SELECT id, conversation_id, evidence_msg_ids, created_at_line FROM topic_decisions WHERE evidence_msg_db_ids IS NULL OR created_at_msg_id = 0")
    rows = cursor.fetchall()
    
    updated_count = 0
    for row_id, conv_id, evidence_json, created_line in rows:
        db_ids = []
        if evidence_json:
            try:
                line_nums = json.loads(evidence_json)
                for ln in line_nums:
                    res = cursor.execute("SELECT id FROM messages WHERE conversation_id=? AND line_number=?", (conv_id, ln)).fetchone()
                    if res:
                        db_ids.append(res[0])
            except Exception as e:
                logging.warning(f"Failed to parse evidence_msg_ids for decision {row_id}: {e}")
                
        created_msg_id = -1  # Default to -1 so we don't re-process orphans
        if created_line and created_line > 0:
            res = cursor.execute("SELECT id FROM messages WHERE conversation_id=? AND line_number=?", (conv_id, created_line)).fetchone()
            if res:
                created_msg_id = res[0]
                
        # Update record
        cursor.execute(
            "UPDATE topic_decisions SET evidence_msg_db_ids=?, created_at_msg_id=? WHERE id=?",
            (json.dumps(db_ids), created_msg_id, row_id)
        )
        updated_count += 1
        
    return updated_count

def migrate_watermarks(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT project_uuid, conversation_id, last_line_processed FROM watermarks WHERE last_msg_id = 0 OR last_msg_id IS NULL")
    rows = cursor.fetchall()
    
    updated_count = 0
    for uuid, conv_id, line_processed in rows:
        if line_processed and line_processed > 0:
            res = cursor.execute("SELECT id FROM messages WHERE conversation_id=? AND line_number=?", (conv_id, line_processed)).fetchone()
            if res:
                cursor.execute(
                    "UPDATE watermarks SET last_msg_id=? WHERE project_uuid=? AND conversation_id=?",
                    (res[0], uuid, conv_id)
                )
                updated_count += 1
            else:
                cursor.execute(
                    "UPDATE watermarks SET last_msg_id=-1 WHERE project_uuid=? AND conversation_id=?",
                    (uuid, conv_id)
                )
                updated_count += 1
        else:
            # line_processed is NULL or 0, mark as processed with -1
            cursor.execute(
                "UPDATE watermarks SET last_msg_id=-1 WHERE project_uuid=? AND conversation_id=?",
                (uuid, conv_id)
            )
            updated_count += 1
    return updated_count

def run_migration():
    with closing(_get_conn()) as conn:
        with conn:
            conn.execute("BEGIN EXCLUSIVE")
            decisions_updated = migrate_topic_decisions(conn)
            watermarks_updated = migrate_watermarks(conn)
            print(f"Migration complete. Decisions updated: {decisions_updated}, Watermarks updated: {watermarks_updated}")

if __name__ == "__main__":
    run_migration()
