import os
import sys
import json
import time
import sqlite3
import re

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts")))
from schema_init import DB_PATH

from scan_sessions import is_subagent_session

MAX_PROMPT_LENGTH = 8000

def format_timestamp(ts_str):
    """
    统一时间戳为 SQLite 标准 'YYYY-MM-DD HH:MM:SS' 字符串，以消除类型与格式失配 bug
    """
    if not ts_str:
        return time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
    ts_str = ts_str.replace('T', ' ').replace('Z', '')
    return ts_str[:19]

def extract_key_content(transcript_path, last_line, line_to_msg_id):
    """按行解析 JSONL，提取核心内容并附带数据库原生的 msg_id"""
    key_content = []
    current_line = 0
    total_length = 0

    with open(transcript_path, 'r', encoding='utf-8') as f:
        for line in f:
            current_line += 1
            if current_line <= last_line:
                continue
            try:
                obj = json.loads(line)
                step_type = obj.get('type', '')
                content = obj.get('content', '')
                if not content:
                    continue
                # 注入 [msg_xxx] 前缀，向 LLM 物理透传 messages.id
                if step_type in ('USER_INPUT', 'PLANNER_RESPONSE'):
                    msg_id = line_to_msg_id.get(current_line)
                    if msg_id is not None:
                        snippet = f"[msg_{msg_id}] {content[:500]}"
                        key_content.append(snippet)
                        total_length += len(snippet)
                        if total_length >= MAX_PROMPT_LENGTH:
                            break
            except json.JSONDecodeError:
                continue

    return "\n".join(key_content)

def read_incremental_logs(conn, session):
    """利用 SQLite 水位线进行增量读取，并将原日志叙写存入 messages 表"""
    is_sub = is_subagent_session(session['transcript_path'])
    
    cursor = conn.execute(
        "SELECT last_msg_id FROM watermarks WHERE project_uuid=? AND conversation_id=?",
        (session['project_uuid'], session['conversation_id']))
    watermark_row = cursor.fetchone()
    last_msg_id = watermark_row[0] if watermark_row else 0

    # Derive last physical line from messages table to avoid reading from start
    cursor = conn.execute("SELECT MAX(line_number) FROM messages WHERE conversation_id=?", (session['conversation_id'],))
    max_line_row = cursor.fetchone()
    last_line = max_line_row[0] if max_line_row and max_line_row[0] else 0

    # 持续运行 JSONL 写入 messages 表
    current_line = 0
    with open(session['transcript_path'], 'r', encoding='utf-8') as f:
        for line in f:
            current_line += 1
            if current_line > last_line:
                try:
                    log_obj = json.loads(line)
                    step_type = log_obj.get('type', '')
                    
                    if is_sub and step_type not in ('USER_INPUT', 'PLANNER_RESPONSE'):
                        continue
                        
                    conn.execute(
                        "INSERT OR IGNORE INTO messages (conversation_id, line_number, timestamp, role, content) VALUES (?, ?, ?, ?, ?)",
                        (session['conversation_id'], current_line,
                         format_timestamp(log_obj.get('timestamp', '')), log_obj.get('source', ''),
                         log_obj.get('content', '')))
                except Exception:
                    pass

    # 逆缩（Undo）自愈拦截线
    if current_line < last_line:
        target_rollback_line = max(0, current_line - 1)
        
        # Get target_msg_id safely by looking for the MAX(id) <= target_rollback_line
        cursor = conn.execute("SELECT MAX(id) FROM messages WHERE conversation_id=? AND line_number<=?", (session['conversation_id'], target_rollback_line))
        msg_row = cursor.fetchone()
        target_msg_id = msg_row[0] if msg_row and msg_row[0] is not None else 0
        
        conn.execute(
            "DELETE FROM messages WHERE conversation_id=? AND line_number > ?",
            (session['conversation_id'], target_rollback_line))
        conn.execute(
            "DELETE FROM topic_decisions WHERE conversation_id=? AND created_at_msg_id > ?",
            (session['conversation_id'], target_msg_id))
        conn.execute(
            "DELETE FROM remora_event_queue WHERE project_uuid=? AND status='pending'",
            (session['project_uuid'],))
            
        conn.execute(
            "UPDATE watermarks SET last_msg_id=? WHERE project_uuid=? AND conversation_id=?",
            (target_msg_id, session['project_uuid'], session['conversation_id']))
            
        print(f"[Remora] 检测到会话 Undo 回滚，温存储已自愈水位线至 msg_id: {target_msg_id}")
        last_line = target_rollback_line
        last_msg_id = target_msg_id

    # Create mapping of line_number to msg_id for the increment
    cursor = conn.execute("SELECT line_number, id FROM messages WHERE conversation_id=? AND id > ?", (session['conversation_id'], last_msg_id))
    line_to_msg_id = {row[0]: row[1] for row in cursor.fetchall()}
    
    current_msg_id = last_msg_id
    if line_to_msg_id:
        current_msg_id = max(line_to_msg_id.values())

    if not watermark_row:
        conn.execute(
            "INSERT INTO watermarks (project_uuid, conversation_id, last_line_processed, last_msg_id) VALUES (?, ?, 0, 0)",
            (session['project_uuid'], session['conversation_id']))

    # 提取核心内容（附带 msg_id）
    key_content = extract_key_content(session['transcript_path'], last_line, line_to_msg_id)

    return key_content, current_msg_id, last_msg_id
