from tests._env import TEST_DATABASE_URL
from tests.helpers import DEFAULT_PASSWORD, register_user, run_alembic


async def test_register_login_and_me(client):
    user = await register_user(client)
    login = await client.post("/api/auth/login", json={"email": user.email, "password": DEFAULT_PASSWORD})
    assert login.status_code == 200
    token = login.json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


async def test_tables_are_truncated_between_tests(client):
    # Registering the same email again only works because db_clean truncated the previous test's rows.
    await register_user(client)


def test_test_database_is_at_alembic_head():
    assert "(head)" in run_alembic(TEST_DATABASE_URL, "current")
