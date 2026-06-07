import os
import sys
import uuid
import inspect
from datetime import datetime, timedelta
from pathlib import Path

LOG_DIR = "/tmp/remora/log"
MAX_AGE_DAYS = 3
_TRACE_ID = f"s_{uuid.uuid4().hex[:8]}"

_HOOKS_PROFILE_LOG = os.environ.get(
    "REMORA_HOOKS_PROFILE_LOG",
    os.path.join(os.path.expanduser("~"), ".remora", "data", "hooks_profile.log")
)

_LEVEL_ENV = os.environ.get("REMORA_LOG_LEVEL", "INFO").upper()
_LEVELS = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3, "OFF": 4}
_LEVEL = _LEVELS.get(_LEVEL_ENV, 1)

_init_done = False
_log_file = None


def set_trace_id(tid):
    global _TRACE_ID
    _TRACE_ID = tid
    os.environ["REMORA_TRACE_ID"] = tid


def init():
    global _init_done, _log_file
    if _init_done:
        return

    # Inherit trace ID from parent process if available
    env_tid = os.environ.get("REMORA_TRACE_ID")
    if env_tid:
        set_trace_id(env_tid)

    os.makedirs(LOG_DIR, exist_ok=True)

    today_str = datetime.now().strftime("%Y-%m-%d")
    log_path = os.path.join(LOG_DIR, "system.log")

    if os.path.exists(log_path):
        mtime = datetime.fromtimestamp(os.path.getmtime(log_path))
        if mtime.strftime("%Y-%m-%d") != today_str:
            archive_path = os.path.join(LOG_DIR, f"system.{mtime.strftime('%Y-%m-%d')}.log")
            os.rename(log_path, archive_path)

    _log_file = log_path
    _init_done = True

    cutoff = datetime.now() - timedelta(days=MAX_AGE_DAYS)
    try:
        for fname in os.listdir(LOG_DIR):
            if fname.startswith("system.") and fname.endswith(".log") and fname != "system.log":
                fpath = os.path.join(LOG_DIR, fname)
                try:
                    if datetime.fromtimestamp(os.path.getmtime(fpath)) < cutoff:
                        os.remove(fpath)
                except Exception:
                    pass
    except Exception:
        pass


def _format_caller():
    frame = inspect.currentframe()
    try:
        caller = frame.f_back.f_back.f_back
        if caller is None:
            caller = frame.f_back.f_back
        if caller is None:
            return "unknown:0"
        filename = os.path.basename(caller.f_code.co_filename)
        lineno = caller.f_lineno
        return f"{filename}:{lineno}"
    finally:
        del frame


def _should_log(level):
    return _LEVELS.get(level, 1) >= _LEVEL


def _log(level, msg):
    global _init_done, _log_file
    if not _should_log(level):
        return
    if not _init_done:
        init()
    if _log_file is None:
        return

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    caller = _format_caller()
    line = f"[TID:{_TRACE_ID}] [{ts}] [{level:5s}] [{caller}] {msg}\n"

    try:
        with open(_log_file, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def _write_raw(log_path, content, max_bytes=1024 * 1024):
    try:
        path = Path(log_path)
        if path.exists() and path.stat().st_size > max_bytes:
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"=== Log Rotated at {datetime.now().isoformat()} ===\n")
        with open(path, "a", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        pass


def debug(msg):
    _log("DEBUG", msg)


def info(msg):
    _log("INFO", msg)


def warn(msg):
    _log("WARN", msg)
    print(f"[WARN] {msg}", file=sys.stderr)


def error(msg):
    _log("ERROR", msg)
    print(f"[ERROR] {msg}", file=sys.stderr)


def profile(msg, log_path=None):
    if log_path is not None:
        _write_raw(log_path, msg)
    elif isinstance(msg, str) and msg.strip().startswith("==="):
        try:
            _write_raw(_HOOKS_PROFILE_LOG, msg)
        except Exception:
            pass
    else:
        _log("PROF", msg)
