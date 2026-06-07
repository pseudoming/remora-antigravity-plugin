import ast
import os
import glob

import pytest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _py_files(root):
    for f in glob.glob(f"{root}/**/*.py", recursive=True):
        if "__pycache__" not in f and not os.path.basename(f).startswith("__init__"):
            yield f


def _has_import(filepath, forbidden_prefix):
    with open(filepath) as fh:
        try:
            tree = ast.parse(fh.read())
        except SyntaxError:
            return None
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith(forbidden_prefix):
                return node.module
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith(forbidden_prefix):
                    return alias.name
    return None


def test_core_never_imports_adapter():
    offenders = []
    for fp in _py_files(os.path.join(PROJECT_ROOT, "scripts", "core")):
        bad = _has_import(fp, "adapter")
        if bad:
            offenders.append(f"{os.path.relpath(fp, PROJECT_ROOT)}  imports  {bad}")
    assert not offenders, "core/ must not import adapter/:\n" + "\n".join(offenders)


def test_adapter_never_imports_tests():
    offenders = []
    for fp in _py_files(os.path.join(PROJECT_ROOT, "scripts", "adapter")):
        bad = _has_import(fp, "tests")
        if bad:
            offenders.append(f"{os.path.relpath(fp, PROJECT_ROOT)}  imports  {bad}")
    assert not offenders, "adapter/ must not import tests/:\n" + "\n".join(offenders)
