import sys
import json
import sqlite3

def query_db(db_path, sql_query):
    # 动态转换与拼接 URI 只读模式，确保防写
    if not db_path.startswith("file:"):
        db_uri = f"file:{db_path}?mode=ro"
    else:
        if "?mode=" not in db_path:
            db_uri = f"{db_path}?mode=ro"
        else:
            db_uri = db_path

    conn = sqlite3.connect(db_uri, uri=True)
    cursor = conn.cursor()
    try:
        cursor.execute(sql_query)
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()
        return [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()

def main():
    for line in sys.stdin:
        try:
            req = json.loads(line.strip())
            if "id" not in req:
                continue
            method = req.get("method")
            req_id = req.get("id")
            
            if method == "initialize":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {"name": "sqlite-readonly", "version": "1.0.0"}
                    }
                }
            elif method == "tools/list":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "query_readonly",
                                "description": "Execute a readonly SELECT SQL query on a specified SQLite database.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "sql": {"type": "string", "description": "SELECT query to run"},
                                        "db_path": {"type": "string", "description": "Absolute file path to the SQLite database"}
                                    },
                                    "required": ["sql", "db_path"]
                                }
                            }
                        ]
                    }
                }
            elif method == "tools/call":
                params = req.get("params", {})
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                if tool_name == "query_readonly":
                    sql = arguments.get("sql", "")
                    db_path = arguments.get("db_path", "")
                    
                    if not sql.strip().upper().startswith("SELECT"):
                        result = {"content": [{"type": "text", "text": "Error: Only SELECT statements are allowed."}]}
                    elif not db_path:
                        result = {"content": [{"type": "text", "text": "Error: db_path is required."}]}
                    else:
                        db_result = query_db(db_path, sql)
                        result = {"content": [{"type": "text", "text": json.dumps(db_result, indent=2, ensure_ascii=False)}]}
                else:
                    result = {"content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}]}
                
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": result
                }
            else:
                resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}}
                
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")

if __name__ == "__main__":
    main()
