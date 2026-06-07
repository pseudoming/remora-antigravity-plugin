import sqlite3
from contextlib import closing
from adapter.bridge import paths
from core.logger import debug

def _get_conn():
    import time as _time
    _t0 = _time.perf_counter()
    conn = sqlite3.connect(paths.get_db_path(), timeout=15)
    debug(f"db connect: {(_time.perf_counter() - _t0)*1000:.1f}ms")
    return conn

def check_db_exists():
    import os
    return os.path.exists(paths.get_db_path())
