"""Test environment variables. conftest.py imports this before anything from `app`."""

import os
import tempfile

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://remix:remix@localhost:5432/remix_studio_test"
)

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["JWT_SECRET"] = "test-only-secret-0123456789abcdef0123456789"
os.environ["STORAGE_PATH"] = tempfile.mkdtemp(prefix="remix-test-storage-")
os.environ["ACESTEP_API_BASE"] = "http://acestep.test"
os.environ["COOKIE_SECURE"] = "false"
os.environ["REGISTRATION_INVITE_CODE"] = ""
os.environ["FRONTEND_DIST"] = ""
