import os
import sys
import json
import sqlite3
import io
import pytest
from unittest.mock import patch

# Add parent directory to path so we can import sqlite_mcp
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import sqlite_mcp

def test_query_db_readonly(tmp_path):
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INTEGER, name TEXT)")
    conn.execute("INSERT INTO test VALUES (1, 'Alice')")
    conn.commit()
    conn.close()

    # Query SELECT
    res = sqlite_mcp.query_db(str(db_path), "SELECT * FROM test")
    assert res == [{"id": 1, "name": "Alice"}]

    # Query INSERT should raise error since connection is URI with mode=ro
    res_write = sqlite_mcp.query_db(str(db_path), "INSERT INTO test VALUES (2, 'Bob')")
    assert isinstance(res_write, dict)
    assert "error" in res_write

def test_mcp_initialize():
    stdin_mock = io.StringIO(json.dumps({"method": "initialize", "id": 1}) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    output = json.loads(stdout_mock.getvalue().strip())
    assert output["id"] == 1
    assert output["result"]["serverInfo"]["name"] == "sqlite-readonly"

def test_mcp_tools_list():
    stdin_mock = io.StringIO(json.dumps({"method": "tools/list", "id": 2}) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    output = json.loads(stdout_mock.getvalue().strip())
    assert output["id"] == 2
    tools = output["result"]["tools"]
    assert len(tools) == 1
    assert tools[0]["name"] == "query_readonly"

def test_mcp_tools_call_select(tmp_path):
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE test (id INTEGER, name TEXT)")
    conn.execute("INSERT INTO test VALUES (1, 'Alice')")
    conn.commit()
    conn.close()

    req = {
        "method": "tools/call",
        "id": 3,
        "params": {
            "name": "query_readonly",
            "arguments": {
                "sql": "SELECT * FROM test WHERE id = 1",
                "db_path": str(db_path)
            }
        }
    }
    stdin_mock = io.StringIO(json.dumps(req) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    output = json.loads(stdout_mock.getvalue().strip())
    assert output["id"] == 3
    content = output["result"]["content"]
    assert len(content) == 1
    result_data = json.loads(content[0]["text"])
    assert result_data == [{"id": 1, "name": "Alice"}]

def test_mcp_tools_call_denied_write(tmp_path):
    db_path = tmp_path / "test.db"
    
    # Non-SELECT statement should be blocked before DB level
    req = {
        "method": "tools/call",
        "id": 4,
        "params": {
            "name": "query_readonly",
            "arguments": {
                "sql": "INSERT INTO test VALUES (2, 'Bob')",
                "db_path": str(db_path)
            }
        }
    }
    stdin_mock = io.StringIO(json.dumps(req) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    output = json.loads(stdout_mock.getvalue().strip())
    assert output["id"] == 4
    content = output["result"]["content"]
    assert "Error: Only SELECT statements are allowed." in content[0]["text"]

def test_mcp_tools_call_unknown():
    req = {
        "method": "tools/call",
        "id": 5,
        "params": {
            "name": "invalid_tool",
            "arguments": {}
        }
    }
    stdin_mock = io.StringIO(json.dumps(req) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    output = json.loads(stdout_mock.getvalue().strip())
    assert output["id"] == 5
    content = output["result"]["content"]
    assert "Unknown tool" in content[0]["text"]

def test_mcp_notification_ignored():
    stdin_mock = io.StringIO(json.dumps({"method": "notifications/initialized"}) + "\n")
    stdout_mock = io.StringIO()
    
    with patch("sys.stdin", stdin_mock), patch("sys.stdout", stdout_mock):
        sqlite_mcp.main()
        
    assert stdout_mock.getvalue() == ""
