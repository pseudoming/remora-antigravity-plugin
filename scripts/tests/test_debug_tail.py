import os
import sys
import importlib.util
import pytest
from unittest.mock import patch


def load_module(module_name, file_name):
    scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    file_path = os.path.join(scripts_dir, file_name)
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


tail_mod = load_module("tail_mod", "debug/tail.py")


def _setup_logdir(monkeypatch, tmp_path):
    log_dir = str(tmp_path)
    monkeypatch.setattr(tail_mod, "LOG_DIR", log_dir)
    monkeypatch.setattr(tail_mod, "BASE_LOG", os.path.join(log_dir, "system.log"))
    monkeypatch.setattr(tail_mod, "ARCHIVE_GLOB", os.path.join(log_dir, "system.*.log"))
    return tmp_path


def _make_log_entry(tid="T1", timestamp="2026-01-01 12:00:00", level="INFO",
                    source="test", message="hello"):
    return "[TID:%s] [%s] [%s] [%s] %s\n" % (tid, timestamp, level, source, message)


def _out_lines(capsys):
    captured = capsys.readouterr()
    return [l for l in captured.out.strip().split("\n") if l]


class TestDefaultRun:
    def test_five_entries(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(timestamp="2026-01-01 12:00:%02d" % i, message="msg%d" % i)
            for i in range(1, 6)
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py"]):
            tail_mod.main()

        lines = _out_lines(capsys)
        assert len(lines) == 5


class TestLevelFilter:
    def test_only_error(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(level="INFO", message="info msg"),
            _make_log_entry(level="ERROR", message="error msg"),
            _make_log_entry(level="WARN", message="warn msg"),
            _make_log_entry(level="ERROR", message="another error"),
            _make_log_entry(level="DEBUG", message="debug msg"),
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py", "--level", "ERROR"]):
            tail_mod.main()

        out = capsys.readouterr().out
        assert "error msg" in out
        assert "another error" in out
        assert "info msg" not in out
        assert "warn msg" not in out
        assert "debug msg" not in out


class TestGrep:
    def test_filter_by_substring(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(message="this has abc in it"),
            _make_log_entry(message="this does not"),
            _make_log_entry(message="ABC should also match"),
            _make_log_entry(message="no match here either"),
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py", "--grep", "abc"]):
            tail_mod.main()

        out = capsys.readouterr().out.lower()
        assert "this has abc" in out
        assert "abc should also match" in out
        assert "this does not" not in out
        assert "no match" not in out


class TestLinesLimit:
    def test_two_most_recent(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(timestamp="2026-01-01 12:00:%02d" % i, message="msg%d" % i)
            for i in range(10)
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py", "--lines", "2"]):
            tail_mod.main()

        lines = _out_lines(capsys)
        assert len(lines) == 2
        assert "msg9" in lines[0]
        assert "msg8" in lines[1]


class TestAscOrder:
    def test_oldest_first(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(timestamp="2026-01-01 12:00:03", message="third"),
            _make_log_entry(timestamp="2026-01-01 12:00:01", message="first"),
            _make_log_entry(timestamp="2026-01-01 12:00:02", message="second"),
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py", "--asc"]):
            tail_mod.main()

        lines = _out_lines(capsys)
        assert len(lines) == 3
        assert "first" in lines[0]
        assert "second" in lines[1]
        assert "third" in lines[2]


class TestTodayFlag:
    def test_skips_archive(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        (log_dir / "system.log").write_text(
            _make_log_entry(message="today entry"))
        (log_dir / "system.2026-01-01.log").write_text(
            _make_log_entry(message="archive entry"))

        with patch("sys.argv", ["tail.py", "--today"]):
            tail_mod.main()

        out = capsys.readouterr().out
        assert "today entry" in out
        assert "archive entry" not in out


class TestMultipleFiles:
    def test_reads_all_by_default(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        (log_dir / "system.log").write_text(
            _make_log_entry(message="from system"))
        (log_dir / "system.2026-01-01.log").write_text(
            _make_log_entry(message="from archive"))

        with patch("sys.argv", ["tail.py"]):
            tail_mod.main()

        out = capsys.readouterr().out
        assert "from system" in out
        assert "from archive" in out


class TestEmptyDir:
    def test_no_crash_empty_output(self, monkeypatch, tmp_path, capsys):
        _setup_logdir(monkeypatch, tmp_path)

        with patch("sys.argv", ["tail.py"]):
            with pytest.raises(SystemExit) as exc_info:
                tail_mod.main()

        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "No log files found" in captured.err
        assert captured.out == ""


class TestCombinedFlags:
    def test_level_warn_grep_timeout_lines_3(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(timestamp="2026-01-01 12:00:01", level="WARN",
                            message="timeout on server"),
            _make_log_entry(timestamp="2026-01-01 12:00:02", level="WARN",
                            message="normal warn"),
            _make_log_entry(timestamp="2026-01-01 12:00:03", level="ERROR",
                            message="timeout error"),
            _make_log_entry(timestamp="2026-01-01 12:00:04", level="WARN",
                            message="another timeout"),
            _make_log_entry(timestamp="2026-01-01 12:00:05", level="WARN",
                            message="timeout yet again"),
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py", "--level", "WARN", "--grep", "timeout",
                                "--lines", "3"]):
            tail_mod.main()

        lines = _out_lines(capsys)
        assert len(lines) == 3
        for line in lines:
            assert "WARN" in line
            assert "timeout" in line.lower()


class TestColorCodes:
    def test_error_has_red_ansi(self, monkeypatch, tmp_path, capsys):
        log_dir = _setup_logdir(monkeypatch, tmp_path)
        entries = [
            _make_log_entry(level="ERROR", message="error msg"),
            _make_log_entry(level="INFO", message="info msg"),
        ]
        (log_dir / "system.log").write_text("".join(entries))

        with patch("sys.argv", ["tail.py"]):
            tail_mod.main()

        out = capsys.readouterr().out
        assert "\033[31m" in out
        assert len(out.strip()) > 0
