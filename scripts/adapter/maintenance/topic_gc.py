import os
import sys

scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)
from lib.dao import run_topic_garbage_collection

def run_garbage_collection(conn=None):
    run_topic_garbage_collection()

def main():
    from core.logger import set_trace_id
    import uuid
    set_trace_id(f"c_{uuid.uuid4().hex[:8]}")
    run_garbage_collection()

if __name__ == "__main__":
    main()

