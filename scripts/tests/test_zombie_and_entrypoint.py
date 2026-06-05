#!/usr/bin/env python3
import sys
import os
import json
import unittest
from unittest.mock import patch, MagicMock
import importlib.util

# Inject paths
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# Dynamically import hyphenated script
spec = importlib.util.spec_from_file_location(
    "zombie_detector", 
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "zombie-detector.py"))
)
zombie_detector = importlib.util.module_from_spec(spec)
sys.modules["zombie_detector"] = zombie_detector
spec.loader.exec_module(zombie_detector)

from lib.context import hook_entrypoint

class TestHookEntrypointRefactor(unittest.TestCase):
    @patch("sys.stdin")
    @patch("sys.stdout")
    def test_system_exit_non_zero(self, mock_stdout, mock_stdin):
        mock_stdin.read.return_value = '{"test": "data"}'
        mock_stdin.isatty.return_value = False
        
        with patch("json.load", return_value={"toolCall": {"name": "test"}, "test": "data"}):
            @hook_entrypoint(fallback_result={"decision": "allow"})
            def dummy_hook(context):
                sys.exit(1)
                
            with self.assertRaises(SystemExit) as cm:
                dummy_hook()
            self.assertEqual(cm.exception.code, 0)
            
            printed = "".join(call[0][0] for call in mock_stdout.write.call_args_list)
            data = json.loads(printed.strip())
            self.assertEqual(data.get("decision"), "deny")
            self.assertIn("SystemExit with code 1", data.get("reason", ""))

    @patch("sys.stdin")
    @patch("sys.stdout")
    def test_system_exit_zero(self, mock_stdout, mock_stdin):
        with patch("json.load", return_value={"test": "data"}):
            @hook_entrypoint(fallback_result={"decision": "allow"})
            def dummy_hook(context):
                sys.exit(0)
                
            with self.assertRaises(SystemExit) as cm:
                dummy_hook()
            self.assertEqual(cm.exception.code, 0)
            
            printed = "".join(call[0][0] for call in mock_stdout.write.call_args_list)
            self.assertNotIn("decision", printed)

    @patch("sys.stdin")
    @patch("sys.stdout")
    def test_base_exception_fatal(self, mock_stdout, mock_stdin):
        with patch("json.load", return_value={"toolCall": {"name": "test"}, "test": "data"}):
            @hook_entrypoint(fallback_result={"decision": "allow"})
            def dummy_hook(context):
                raise KeyboardInterrupt("interrupted")
                
            with self.assertRaises(SystemExit) as cm:
                dummy_hook()
            self.assertEqual(cm.exception.code, 0)
            
            printed = "".join(call[0][0] for call in mock_stdout.write.call_args_list)
            data = json.loads(printed.strip())
            self.assertEqual(data.get("decision"), "deny")
            self.assertIn("Fatal Exception: KeyboardInterrupt: interrupted", data.get("reason", ""))

class TestZombieDetectorInterception(unittest.TestCase):
    @patch("zombie_detector.os.getuid", return_value=1000)
    @patch("zombie_detector.os.listdir", return_value=["1234"])
    @patch("zombie_detector.os.stat")
    @patch("zombie_detector.get_sys_uptime", return_value=100.0)
    @patch("zombie_detector.os.sysconf", return_value=100)
    @patch("zombie_detector.clean_whitelist", return_value=set())
    @patch("sys.stdout")
    @patch("os.replace")
    def test_zombie_detected_pre_tool_use(self, mock_replace, mock_stdout, mock_clean, mock_sysconf, mock_uptime, mock_stat, mock_listdir, mock_getuid):
        mock_stat.return_value.st_uid = 1000
        
        def mock_open_file(filepath, mode="r", *args, **kwargs):
            m = MagicMock()
            m.__enter__.return_value = m
            m.fileno.return_value = 1
            filepath = str(filepath)
            if "environ" in filepath:
                m.read.return_value = b"ANTIGRAVITY_AGENT=true\x00"
            elif "stat" in filepath:
                stat_fields = ["0"] * 50
                stat_fields[21] = "5000"
                m.read.return_value = " ".join(stat_fields)
            elif "cmdline" in filepath:
                m.read.return_value = b"python3 custom-process.py\x00"
            return m

        with patch("builtins.open", side_effect=mock_open_file):
            # 1. PreToolUse stage (context has toolCall)
            context_tool = {"toolCall": {"name": "run_command", "args": {"CommandLine": "ls"}}}
            with patch("json.load", return_value=context_tool):
                with self.assertRaises(SystemExit) as cm:
                    zombie_detector.main()
                self.assertEqual(cm.exception.code, 0)
                
            printed_tool = "".join(call[0][0] for call in mock_stdout.write.call_args_list)
            data_tool = json.loads(printed_tool.strip())
            self.assertEqual(data_tool.get("decision"), "deny")
            self.assertIn("安全拦截", data_tool.get("reason", ""))
            self.assertIn("1234", data_tool.get("reason", ""))
            
            # Reset mock
            mock_stdout.write.reset_mock()

            # 2. PreInvocation stage (context has no toolCall)
            context_invoke = {"transcriptPath": "/tmp/brain/mock-conv-id/transcript.jsonl", "invocationNum": 1}
            with patch("json.load", return_value=context_invoke):
                with self.assertRaises(SystemExit) as cm:
                    zombie_detector.main()
                self.assertEqual(cm.exception.code, 0)
                
            printed_invoke = "".join(call[0][0] for call in mock_stdout.write.call_args_list)
            data_invoke = json.loads(printed_invoke.strip())
            self.assertIn("injectSteps", data_invoke)
            steps = data_invoke["injectSteps"]
            self.assertEqual(len(steps), 1)
            msg = steps[0]["ephemeralMessage"]
            self.assertIn("警告：检测到未托管衍生后台进程", msg)
            self.assertIn("1234", msg)

if __name__ == "__main__":
    unittest.main()
