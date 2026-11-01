import re

from tests.helpers import BACKEND_DIR


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_names(filename: str) -> set[str]:
    names = set()
    for raw in (BACKEND_DIR / filename).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        match = re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", line)
        assert match, f"unparseable requirement line in {filename}: {raw!r}"
        names.add(_normalize(match.group(0)))
    return names


def _locked_versions() -> dict[str, str]:
    pins = {}
    for raw in (BACKEND_DIR / "requirements.lock").read_text().splitlines():
        match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s;]+)", raw)
        if match:
            pins[_normalize(match.group(1))] = match.group(2)
    return pins


def test_bcrypt_is_a_direct_dependency_and_passlib_pydub_are_gone():
    names = _requirement_names("requirements.txt")
    assert "bcrypt" in names
    assert "passlib" not in names
    assert "pydub" not in names


def test_dev_requirements_cover_the_test_tooling():
    assert {"pytest", "pytest-asyncio", "respx", "ruff"} <= _requirement_names("requirements-dev.txt")


def test_lock_pins_every_direct_requirement():
    pins = _locked_versions()
    direct = _requirement_names("requirements.txt") | _requirement_names("requirements-dev.txt")
    missing = sorted(direct - pins.keys())
    assert not missing, f"not pinned in requirements.lock: {missing}"
    assert "passlib" not in pins
