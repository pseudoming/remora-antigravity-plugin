import os
import sys

scripts_dir = os.path.abspath(os.path.dirname(__file__))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)
from lib.dao import prune_expired_watermarks

BRAIN_DIR = os.path.expanduser("~/.gemini/antigravity/brain")

if __name__ == "__main__":
    prune_expired_watermarks(BRAIN_DIR)
