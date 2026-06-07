import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


_KEYWORDS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "adapter", "hooks", "keywords.json"
)


@pytest.fixture(autouse=True)
def _protect_keywords_json():
    """Save and restore keywords.json around each test.

    session_guardian tests write mock keywords to the source tree file.
    This fixture prevents tests from corrupting the canonical version.
    """
    if os.path.exists(_KEYWORDS_PATH):
        with open(_KEYWORDS_PATH, "r") as f:
            backup = f.read()
    else:
        backup = None

    yield

    if backup is not None:
        with open(_KEYWORDS_PATH, "w") as f:
            f.write(backup)
    elif os.path.exists(_KEYWORDS_PATH):
        os.remove(_KEYWORDS_PATH)
