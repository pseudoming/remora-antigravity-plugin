import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib import dao

def fix_db():
    print("Connecting to DB...")
    count = dao.cleanup_ghost_messages()
    if count > 0:
        print(f"Deleted {count} ghost records. FTS index rebuilt.")
    else:
        print("No ghost records to clean up.")

if __name__ == "__main__":
    fix_db()
