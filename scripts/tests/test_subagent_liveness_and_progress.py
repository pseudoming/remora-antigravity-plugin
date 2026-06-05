import os
import sys
import json
import time
import sqlite3
import pytest
from pathlib import Path
from unittest.mock import patch
import importlib.util
from datetime import datetime, timezone

# Ensure scripts dir and lib are importable
scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from lib.progress import ProgressSentinel
import lib.paths as paths

# Dynamically import hyphenated script: check-subagents-liveness.py
liveness_script_path = os.path.join(scripts_dir, "check-subagents-liveness.py")
spec = importlib.util.spec_from_file_location("liveness_checker", liveness_script_path)
liveness_checker = importlib.util.module_from_spec(spec)
sys.modules["liveness_checker"] = liveness_checker
spec.loader.exec_module(liveness_checker)

@pytest.fixture
def mock_env(tmp_path, monkeypatch):
    # Mock HOME environment variable
    monkeypatch.setenv("HOME", str(tmp_path))
    
    # Mock db path to use a temporary db inside tmp_path
    temp_db_path = os.path.join(tmp_path, "test_remora_memory.db")
    monkeypatch.setattr(paths, "get_db_path", lambda: temp_db_path)
    
    # Initialize the temp DB structure
    conn = sqlite3.connect(temp_db_path, timeout=15)
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
    
    return tmp_path, temp_db_path

def test_progress_sentinel_update(mock_env):
    tmp_path, _ = mock_env
    conv_id = "test_conv_123"
    transcript_path = os.path.join(tmp_path, ".gemini", "antigravity", "brain", conv_id, ".system_generated", "transcript.jsonl")
    
    # Test update with running
    success = ProgressSentinel.update(transcript_path, "running", step_index=5, details="Initial test step")
    assert success is True
    
    progress_file = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch" / "progress.json"
    assert progress_file.exists()
    
    with open(progress_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        assert data["status"] == "running"
        assert data["step_index"] == 5
        assert data["details"] == "Initial test step"
        assert "last_updated_at" in data
        
    # Test update without step_index, should reuse the old one
    success = ProgressSentinel.update(transcript_path, "blocked", details="Encountered error")
    assert success is True
    
    with open(progress_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        assert data["status"] == "blocked"
        assert data["step_index"] == 5
        assert data["details"] == "Encountered error"

def test_liveness_completed(mock_env, monkeypatch, capsys):
    tmp_path, _ = mock_env
    conv_id = "conv_completed"
    
    # Setup completed progress.json
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "completed",
            "last_updated_at": int(time.time() - 150),  # expired but completed
            "step_index": 10,
            "details": "Done"
        }, f)
        
    # Run checker
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 0
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "alive"
    assert "completed" in res["reason"]

def test_liveness_blocked(mock_env, monkeypatch, capsys):
    tmp_path, _ = mock_env
    conv_id = "conv_blocked"
    
    # Setup blocked progress.json
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "blocked",
            "last_updated_at": int(time.time() - 10),
            "step_index": 2,
            "details": "Blocked by lock"
        }, f)
        
    # Run checker
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 1
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "dead"
    assert "blocked" in res["reason"]

def test_liveness_timeout_progress(mock_env, monkeypatch, capsys):
    tmp_path, _ = mock_env
    conv_id = "conv_timeout"
    
    # Setup expired running progress.json
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "running",
            "last_updated_at": int(time.time() - 150),  # 150s ago (> 120s)
            "step_index": 3,
            "details": "Long step"
        }, f)
        
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 1
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "dead"
    assert "Liveness timeout" in res["reason"]

def test_liveness_active_progress(mock_env, monkeypatch, capsys):
    tmp_path, _ = mock_env
    conv_id = "conv_active"
    
    # Setup fresh running progress.json
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "running",
            "last_updated_at": int(time.time() - 30),  # 30s ago (< 120s)
            "step_index": 3,
            "details": "Step normal"
        }, f)
        
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 0
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "alive"

def test_liveness_db_timeout(mock_env, monkeypatch, capsys):
    tmp_path, db_path = mock_env
    conv_id = "conv_db_timeout"
    
    # Setup expired running progress.json
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "running",
            "last_updated_at": int(time.time() - 150),
            "step_index": 1,
            "details": "Running test"
        }, f)
        
    # Setup db message: also expired (150s ago)
    # SQLite CURRENT_TIMESTAMP format is YYYY-MM-DD HH:MM:SS (UTC)
    expired_utc_str = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() - 150))
    
    conn = sqlite3.connect(db_path, timeout=15)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (conversation_id, line_number, timestamp, role, content) VALUES (?, ?, ?, ?, ?)",
        (conv_id, 1, expired_utc_str, "model", "Old subagent response")
    )
    conn.commit()
    conn.close()
    
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 1
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "dead"
    assert "Liveness timeout" in res["reason"]

def test_liveness_db_active(mock_env, monkeypatch, capsys):
    tmp_path, db_path = mock_env
    conv_id = "conv_db_active"
    
    # Setup expired running progress.json (150s ago)
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "running",
            "last_updated_at": int(time.time() - 150),
            "step_index": 1,
            "details": "Running test"
        }, f)
        
    # Setup db message: fresh (30s ago)
    fresh_utc_str = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() - 30))
    
    conn = sqlite3.connect(db_path, timeout=15)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (conversation_id, line_number, timestamp, role, content) VALUES (?, ?, ?, ?, ?)",
        (conv_id, 1, fresh_utc_str, "model", "Fresh subagent response")
    )
    conn.commit()
    conn.close()
    
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 0
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "alive"

def test_liveness_no_signals(mock_env, monkeypatch, capsys):
    tmp_path, _ = mock_env
    conv_id = "conv_no_signals"
    
    # progress.json does not exist
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py", conv_id])
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 0
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert res["liveness"] == "alive"
    assert "No liveness signals yet" in res["reason"]

def test_liveness_hook_mode_auto_detect(mock_env, monkeypatch, capsys):
    tmp_path, db_path = mock_env
    parent_conv_id = "parent_conv_123"
    sub_conv_id = "eb6fe685-f656-4edd-83f9-1fe05d851143"
    
    import io
    stdin_content = json.dumps({
        "transcriptPath": f"/home/agent/.gemini/antigravity/brain/{parent_conv_id}/.system_generated/logs/transcript.jsonl"
    })
    monkeypatch.setattr(sys, "stdin", io.StringIO(stdin_content))
    
    import select
    monkeypatch.setattr(select, "select", lambda r, w, x, t: ([sys.stdin], [], []))
    monkeypatch.setattr(sys, "argv", ["check-subagents-liveness.py"])
    
    progress_dir = Path(tmp_path) / ".gemini" / "antigravity" / "brain" / sub_conv_id / "scratch"
    progress_dir.mkdir(parents=True, exist_ok=True)
    progress_file = progress_dir / "progress.json"
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump({
            "status": "running",
            "last_updated_at": int(time.time() - 30),
            "step_index": 1,
            "details": "Active step"
        }, f)
        
    from lib.conversation import ConversationDataAccessLayer
    
    def mock_stream(self):
        yield {
            "type": "SYSTEM",
            "content": f"Launched subagent with conversationId: {sub_conv_id}"
        }
        
    monkeypatch.setattr(ConversationDataAccessLayer, "stream_steps_forward", mock_stream)
    
    with pytest.raises(SystemExit) as excinfo:
        liveness_checker.main()
        
    assert excinfo.value.code == 0
    
    captured = capsys.readouterr()
    res = json.loads(captured.out.strip())
    assert "decision" not in res
    assert res == {}
