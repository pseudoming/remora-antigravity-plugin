import sqlite3
import os
import sys

scripts_dir = os.path.abspath(os.path.dirname(__file__))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)
from lib.paths import get_data_dir

DATA_DIR = get_data_dir()
DB_PATH = os.path.join(DATA_DIR, "remora_memory.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")

def init_db():
    from contextlib import closing
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with closing(sqlite3.connect(DB_PATH, timeout=15.0)) as conn:
        with conn:
            with open(SCHEMA_PATH, 'r') as f:
                conn.executescript(f.read())
            # Schema 动态迁移升级防线：如果 created_at_line 字段不存在，自动 Alter Table 动态加入该列
            try:
                conn.execute("SELECT created_at_line FROM topic_decisions LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute("ALTER TABLE topic_decisions ADD COLUMN created_at_line INTEGER DEFAULT 0")

            # Schema 动态迁移升级防线二：如果 user_confirmed 字段不存在，自动 Alter Table 动态加入该列
            try:
                conn.execute("SELECT user_confirmed FROM topic_decisions LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute("ALTER TABLE topic_decisions ADD COLUMN user_confirmed INTEGER DEFAULT 0")

            # Schema 动态迁移升级防线三：扩展 project_topics 列以支持 Phase 17 机制
            for col, col_def in [("source", "TEXT DEFAULT 'auto'"), 
                                 ("last_accessed_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
                                 ("associated_files", "TEXT DEFAULT '[]'"),
                                 ("referenced_files", "TEXT DEFAULT '[]'")]:
                try:
                    conn.execute(f"SELECT {col} FROM project_topics LIMIT 1")
                except sqlite3.OperationalError:
                    conn.execute(f"ALTER TABLE project_topics ADD COLUMN {col} {col_def}")

            # Schema 动态迁移升级防线四：新增 session_state 跨进程状态同步表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS session_state (
                    session_id TEXT PRIMARY KEY,
                    mode TEXT DEFAULT 'relax',
                    is_cold_start INTEGER DEFAULT 1,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Schema 动态迁移升级防线五：扩展 topic_decisions 列以支持语义类型与实体映射
            for col, col_def in [("decision_type", "TEXT DEFAULT 'approved'"),
                                 ("associated_files", "TEXT DEFAULT '[]'"),
                                 ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")]:
                try:
                    conn.execute(f"SELECT {col} FROM topic_decisions LIMIT 1")
                except sqlite3.OperationalError:
                    conn.execute(f"ALTER TABLE topic_decisions ADD COLUMN {col} {col_def}")

            # Schema 动态迁移升级防线六 (Phase 30): 双轨并行写入过渡列
            try:
                conn.execute("SELECT evidence_msg_db_ids FROM topic_decisions LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute("ALTER TABLE topic_decisions ADD COLUMN evidence_msg_db_ids TEXT")

            try:
                conn.execute("SELECT created_at_msg_id FROM topic_decisions LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute("ALTER TABLE topic_decisions ADD COLUMN created_at_msg_id INTEGER DEFAULT 0")

            try:
                conn.execute("SELECT last_msg_id FROM watermarks LIMIT 1")
            except sqlite3.OperationalError:
                conn.execute("ALTER TABLE watermarks ADD COLUMN last_msg_id INTEGER DEFAULT 0")

            # Phase 33: 单轨 ID 无损迁移与重构 (Table Remodeling)
            try:
                cursor = conn.execute("PRAGMA table_info(topic_decisions)")
                columns = [row[1] for row in cursor.fetchall()]
                if "evidence_msg_db_ids" in columns:
                    # 1. 物理新建临时表
                    conn.execute("""
                        CREATE TABLE IF NOT EXISTS topic_decisions_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            project_uuid TEXT NOT NULL,
                            topic_id TEXT NOT NULL,
                            conversation_id TEXT NOT NULL,
                            decision TEXT NOT NULL,
                            rationale TEXT NOT NULL,
                            evidence_msg_ids TEXT,
                            user_confirmed INTEGER DEFAULT 0,
                            created_at_line INTEGER DEFAULT 0,
                            created_at_msg_id INTEGER DEFAULT 0,
                            decision_type TEXT DEFAULT 'approved',
                            associated_files TEXT DEFAULT '[]',
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY(project_uuid, topic_id) REFERENCES project_topics(uuid, topic_id)
                        )
                    """)
                    
                    # 2. 数据迁移：将旧过渡列 evidence_msg_db_ids 的主键ID合并写入新表的单轨 evidence_msg_ids 列中
                    conn.execute("""
                        INSERT INTO topic_decisions_new (
                            id, project_uuid, topic_id, conversation_id, decision, rationale,
                            evidence_msg_ids, user_confirmed, created_at_line, created_at_msg_id, decision_type,
                            associated_files, created_at, updated_at
                        )
                        SELECT 
                            id, project_uuid, topic_id, conversation_id, decision, rationale,
                            COALESCE(evidence_msg_db_ids, evidence_msg_ids), user_confirmed, created_at_line, COALESCE(created_at_msg_id, 0), decision_type,
                            associated_files, created_at, updated_at
                        FROM topic_decisions
                    """)
                    
                    # 3. 表的物理更替
                    conn.execute("DROP TABLE topic_decisions")
                    conn.execute("ALTER TABLE topic_decisions_new RENAME TO topic_decisions")
                    print("[Remora] Database migrated to single-track ID (evidence_msg_ids) successfully.")
            except Exception as me:
                print(f"Error during single-track migration: {str(me)}", file=sys.stderr)
