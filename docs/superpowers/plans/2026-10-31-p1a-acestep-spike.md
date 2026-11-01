# Phase 1a — ACE-Step Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run ACE-Step 1.5 v0.1.8 for real on the M4 Max and pin down the contract that P1b builds on. The spike records sanitized JSON fixtures that P1b replays with respx, and measures time and peak memory for turbo and XL turbo. It also settles seed, extend, analysis and restart behaviour, and writes the answers to `docs/superpowers/spikes/2026-10-31-acestep-contract.md`.

**Architecture:**
- A small developer tool, `song-remix-backend/tools/acestep_spike/` (run as `python -m tools.acestep_spike`), talks to ACE-Step on `127.0.0.1:8001`. Its parts are a sanitizer, an httpx client, a footprint sampler, synthesized sources, audio helpers and a CLI.
- Every request, poll and download it makes for a run is measured and appended as one JSON line to `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl`. Responses it is asked to keep are written as fixtures under `song-remix-backend/tests/fixtures/acestep/`.
- Tasks 1–4 build the tool test-first, with respx and no engine. Tasks 5–12 run experiments against the real engine. Each of them first adds shape tests for the fixtures it is about to record (they fail because the files are missing), then records them, then runs the tests again. Task 13 writes the findings.
- No app code changes in this phase.

**Tech Stack:** Python 3.12 backend venv (httpx, pytest, respx, ruff from P0), macOS `footprint`, `sysctl` and `pgrep`, FFmpeg 8, ACE-Step v0.1.8 via `make acestep` (uv, MLX), and Node 24 for the unchanged UI gate.

**Spec:** `docs/superpowers/specs/2026-10-31-remix-studio-v2-design.md`, mainly section 3 (corrections) and section 6 (ACE-Step contract). This phase checks the spec against reality. When the engine disagrees with the spec, record what the engine did and report it; don't change the spec, the tests or the fixtures to make them agree.

## Global Constraints

- **Prerequisite:** P0 is merged into `main`. `git ls-tree main acestep` shows `160000 commit dce621408bee8c31b4fcf4811682eb9359e1bc94`, and the P0 gate passes on `main` (backend `118 passed`, UI `Tests  18 passed (18)`).
- **Python and Node:** Python 3.12 with the backend venv at `song-remix-backend/.venv`, installed from `song-remix-backend/requirements.lock`. Node 24 with npm 11, installed by P0's controller setup (`nvm install 24`); run `source ~/.nvm/nvm.sh && nvm use 24` before any `npm` command.
- **Machine and disk:** Apple M4 Max with 64 GB. At least 60 GB free in `$HOME` before Task 5. The models and the ACE-Step venv take roughly 30–40 GB.
- **ACE-Step process:**
  - Submodule `acestep` at v0.1.8 (`dce621408bee8c31b4fcf4811682eb9359e1bc94`).
  - Started only with `make acestep` from the worktree root, in the background with `nohup`, and logged to `song-remix-backend/data/spike/logs/<name>.log`. It binds `127.0.0.1:8001`. Never use `start_api_server_macos.sh`.
  - Every shell that runs `make acestep`, `make acestep-download` or `uv run acestep-download` first runs `export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"`. The models are then shared with later worktrees instead of being downloaded again.
- **Start ACE-Step** (turbo + 1.7B unless a task says otherwise):

  ```bash
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
  ```

- **Stop ACE-Step.** The `[a]` keeps `pkill` from matching the shell that runs it:

  ```bash
  pkill -f "[a]cestep-api --host" || true
  for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
  pkill -9 -f "[a]cestep-api --host" || true
  ```

- **Is it running?** `(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30)` exits 0 and prints `ready after … model=… lm=…`.
- **Spike commands:**
  - They run from the worktree root as `(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike <command> …)`.
  - A `run` blocks until the task finishes. It can take up to 50 minutes on XL, so give the shell a timeout of at least an hour. Don't interrupt a `run`: ACE-Step keeps the job, and the record is never written.
  - Every request sends `audio_format=flac`, `lm_backend=mlx` and `vocal_language=en`, plus the tool's default caption and original lyrics.
- **Data that is never committed:** everything under `song-remix-backend/data/` (audio, downloads, logs, the generated report) and everything inside `acestep/`.
  - `REAL_SOURCE_AUDIO` is an `os.pathsep`-separated list of local files that the user may provide. Those files appear only as `real-1`, `real-2`, …; their names never reach a fixture, a record or a commit, and their lyrics are redacted.
- **Fixtures:**
  - Location and format: `song-remix-backend/tests/fixtures/acestep/<name>.json`, each `{"request": {method, path, body}, "response": {status_code, json}, "recorded_with": {acestep, model, lm_model, recorded_on}}`.
  - They are written only by the spike CLI (`--save…` options) and never edited by hand.
  - They contain no home paths, usernames, host names or temp paths. Those become `<REPO>`, `<HOME>`, `<TMP>`, `<USER>` and `<HOST>`, URL-encoded inside URLs.
- **Run records:** `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl`, one line per `run`, appended by the CLI and never edited. A failed attempt keeps its line; labels tell attempts apart.
- **Tests:** they never contact ACE-Step. Tool tests use respx, and fixture tests only read files.
- **When the engine disagrees with the spec or with a shape test:**
  - Do not edit the test, the fixture or the spec. Finish the remaining steps of the task where you can.
  - Then report DONE_WITH_CONCERNS with the exact command output. The controller decides whether the spec and test change.
  - A test that still fails blocks the commit.
- **Gate after every task.** Both commands must pass:
  - `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
  - `cd song-remix-ui && npm test && npm run lint && npm run build`
- **Commits:** one commit per task with the message given in the task, and `git add` with the explicit paths listed. Never `git add -A` or `git add .`, and never add anything under `song-remix-backend/data/` or `acestep/`.

---

## Controller setup (before Task 1)

Run these once, as the controller, from the main checkout `/Users/mingjie/Documents/github/personal-projects/audio-remix-lab` on `main`:

1. Check that P0 is merged and pinned:

   ```bash
   git checkout main && git log --oneline -1 && git ls-tree main acestep
   ```

   Expected: `160000 commit dce621408bee8c31b4fcf4811682eb9359e1bc94	acestep`.

2. Create the worktree and enter it (`.worktrees/` and `.superpowers/` are already in `.git/info/exclude` from P0):

   ```bash
   git worktree add .worktrees/phase-1a-acestep-spike -b phase/1a-acestep-spike main
   cd .worktrees/phase-1a-acestep-spike
   ```

3. Check out the ACE-Step submodule in the worktree (this needs network access):

   ```bash
   git submodule update --init acestep && git -C acestep rev-parse HEAD
   ```

   Expected: `dce621408bee8c31b4fcf4811682eb9359e1bc94`.

4. Create the worktree's `.env` with the main checkout's Compose project, a random `JWT_SECRET`, and PostgreSQL running:

   ```bash
   cp .env.example .env && printf 'COMPOSE_PROJECT_NAME=audio-remix-lab\n' >> .env && make env
   docker compose up -d postgres && until docker compose exec -T postgres pg_isready -U remix -d remix_studio; do sleep 1; done
   ```

5. Install the backend and the UI:

   ```bash
   python3.12 -m venv song-remix-backend/.venv && song-remix-backend/.venv/bin/pip install -r song-remix-backend/requirements.lock
   source ~/.nvm/nvm.sh && nvm use 24 && (cd song-remix-ui && npm ci)
   ```

6. Prepare the shared checkpoint directory and check the disk:

   ```bash
   mkdir -p "$HOME/.cache/audio-remix-lab/acestep-checkpoints" && df -h "$HOME"
   ```

   Expected: at least 60 GB available.

7. Create the progress ledger:

   ```bash
   mkdir -p .superpowers/sdd && printf '# Phase 1a progress\n' > .superpowers/sdd/progress.md
   ```

8. Run the baseline gate. Expected: backend `118 passed`, UI `Tests  18 passed (18)`, lint and build pass.

9. Ask the user whether they want to provide up to three local songs for the `full_analysis_only` check in Task 10. If so, pass `REAL_SOURCE_AUDIO=<path>:<path>:<path>` to the Task 10 implementer. The files stay where they are and are never copied into the repo.

Every task below runs inside `.worktrees/phase-1a-acestep-spike`, and all paths are relative to it. Tasks 5–12 share one running ACE-Step. Each of those tasks starts by checking that it is up and ends with it running, except where the task says otherwise. Give each implementer only their own task plus the Global Constraints. After each task, one reviewer gives two verdicts (spec compliance and code quality). For Tasks 5–12 the reviewer checks the recorded fixtures and JSONL lines against the commands that were run. Allow at most 2 fix rounds before escalating to the user.

## How edits are written

- "Create `path`:" — create a new file with exactly the block's content.
- "Append to `path`:" — add the block at the end of the file.

Blocks are exact. Don't reformat, reorder imports or "improve" neighbouring code.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `song-remix-backend/tools/__init__.py`, `song-remix-backend/tools/acestep_spike/__init__.py` | developer-tools packages (not imported by the app) | 1 |
| `song-remix-backend/tools/acestep_spike/sanitize.py` | `Sanitizer`: replace repo, home, temp, user and host strings (raw and URL-encoded, also inside JSON strings), redact lyrics, shorten `audio_codes`, detect leaks | 1 |
| `song-remix-backend/tools/acestep_spike/client.py` | `AceStepClient` (JSON and multipart submit, query, download), `Exchange`, `QueryItem`, `parse_query`, `unwrap`, `wait_for_task` | 2 |
| `song-remix-backend/tools/acestep_spike/memory.py` | `PeakMemorySampler` over `footprint`, swap usage | 3 |
| `song-remix-backend/tools/acestep_spike/sources.py` | three 30 s synthesized songs with known key and BPM, `REAL_SOURCE_AUDIO` | 3 |
| `song-remix-backend/tools/acestep_spike/audio.py` | duration, PCM hash, RMS difference in dB | 3 |
| `song-remix-backend/tools/acestep_spike/report.py` | JSONL records and Markdown tables | 4 |
| `song-remix-backend/tools/acestep_spike/cli.py`, `__main__.py` | the commands `sources`, `wait-ready`, `snapshot`, `submit`, `query`, `run`, `wait-progress`, `task-id`, `compare`, `report` | 4 |
| `song-remix-backend/tests/test_spike_sanitize.py`, `test_spike_client.py`, `test_spike_memory.py`, `test_spike_sources.py`, `test_spike_cli.py` | tool tests (respx, no engine) | 1–4 |
| `song-remix-backend/tests/test_acestep_fixtures.py` | envelope and leak check for every fixture, plus one shape test per recorded fixture | 5 (grown in 6–12) |
| `song-remix-backend/tests/fixtures/acestep/*.json` | recorded, sanitized responses | 5–12 |
| `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` | one measured record per run | 6–12 |
| `docs/superpowers/spikes/2026-10-31-acestep-contract.md` | findings and answers for P1b | 13 |

Fixtures by task:

| Task | Fixtures |
|---|---|
| 5 | `health`, `models`, `stats` |
| 6 | `release_task_queued`, `query_running`, `query_text2music_success` |
| 7 | `query_failure`, `query_unknown`, `release_task_429`, `query_queued` |
| 8 | `query_seed_list_success` |
| 9 | `query_cover_success`, `query_extend_success` |
| 10 | `query_full_analysis_success` |
| 11 | `query_after_restart`, `query_interrupted_after_restart` |
| 12 | `models_xl_turbo` |

### Task 1: Spike package and the response sanitizer

**Files:**
- Create:
  - `song-remix-backend/tools/__init__.py`
  - `song-remix-backend/tools/acestep_spike/__init__.py`
  - `song-remix-backend/tools/acestep_spike/sanitize.py`
- Test: `song-remix-backend/tests/test_spike_sanitize.py`

**Interfaces:**
- Consumes: nothing from the app. `pyproject.toml` already sets `pythonpath = ["."]`, so `tools` is importable from tests.
- Produces:
  - `Sanitizer.from_pairs(pairs: Iterable[tuple[str, str]], redact_keys: Iterable[str] = ()) -> Sanitizer`
  - `Sanitizer.for_machine(repo_root: Path, redact_keys: Iterable[str] = ()) -> Sanitizer`
  - `Sanitizer.__call__(value: Any) -> Any`
  - `Sanitizer.leaks(value: Any) -> list[str]`
  - `REDACTED = "<redacted>"`
- Rules:
  - Replacements apply longest needle first, both raw and URL-encoded. An encoded needle gets the encoded token (`%3CREPO%3E`).
  - A path under `/private/` also matches without that prefix, because macOS reaches `/private/tmp` and `/private/var` through `/tmp` and `/var`.
  - Strings that parse as a JSON list or object (such as ACE-Step's `result`) are sanitized recursively and re-serialized with `json.dumps(..., ensure_ascii=False)`.
  - Keys in `redact_keys` with non-empty string values become `<redacted>`.
  - `audio_codes` longer than 32 characters becomes its first 32 characters followed by `...(N chars)`.
  - Needles shorter than 3 characters are ignored, and so are the host names `localhost` and `127.0.0.1`.

- [ ] **Step 1: Write the failing tests**

Create `song-remix-backend/tests/test_spike_sanitize.py`:

```python
import json
from pathlib import Path
from urllib.parse import quote

from tools.acestep_spike.sanitize import REDACTED, Sanitizer

REPO = "/Users/alice/code/audio-remix-lab"
SANITIZER = Sanitizer.from_pairs(
    [(REPO, "<REPO>"), ("/Users/alice", "<HOME>"), ("alice-mbp", "<HOST>"), ("alice", "<USER>")]
)


def test_paths_are_replaced_longest_first():
    assert SANITIZER(f"{REPO}/acestep/.cache/a.flac") == "<REPO>/acestep/.cache/a.flac"
    assert SANITIZER("/Users/alice/.cache/x") == "<HOME>/.cache/x"
    assert SANITIZER("ran on alice-mbp as alice") == "ran on <HOST> as <USER>"


def test_url_encoded_paths_get_encoded_tokens():
    url = "/v1/audio?path=" + quote(f"{REPO}/acestep/.cache/acestep/tmp/api_audio/x.flac", safe="")
    assert SANITIZER(url) == "/v1/audio?path=%3CREPO%3E%2Facestep%2F.cache%2Facestep%2Ftmp%2Fapi_audio%2Fx.flac"


def test_json_strings_inside_values_are_sanitized_and_redacted():
    sanitizer = Sanitizer.from_pairs([(REPO, "<REPO>")], redact_keys=("lyrics",))
    result = json.dumps([{"file": f"{REPO}/a.flac", "lyrics": "real words", "audio_codes": "x" * 100}])
    cleaned = sanitizer({"data": [{"result": result}]})
    assert json.loads(cleaned["data"][0]["result"]) == [
        {"file": "<REPO>/a.flac", "lyrics": REDACTED, "audio_codes": "x" * 32 + "...(100 chars)"}
    ]


def test_numbers_booleans_and_unrelated_text_are_untouched():
    value = {"status": 1, "ok": True, "progress": 0.5, "stage": "succeeded", "none": None, "empty": ""}
    assert SANITIZER(value) == value


def test_leaks_reports_machine_values_and_generic_home_paths():
    assert SANITIZER.leaks({"a": "<REPO>/x", "b": "%3CHOME%3E%2Fx"}) == []
    assert "alice" in SANITIZER.leaks({"a": "hello alice"})
    assert Sanitizer.from_pairs([]).leaks({"a": "/Users/bob/x"}) == ["/Users/(?!<)"]
    assert Sanitizer.from_pairs([]).leaks({"a": "path=%2FUsers%2Fbob"}) == ["%2FUsers%2F(?!%3C)"]


def test_machine_sanitizer_covers_repo_home_and_temp(tmp_path):
    repo_root = Path(__file__).resolve().parents[2]
    sanitizer = Sanitizer.for_machine(repo_root)
    cleaned = sanitizer({"repo": f"{repo_root}/acestep", "home": f"{Path.home()}/.cache", "temp": str(tmp_path)})
    assert cleaned["repo"] == "<REPO>/acestep"
    assert cleaned["home"] == "<HOME>/.cache"
    assert cleaned["temp"].startswith("<TMP>/")
    assert sanitizer.leaks(cleaned) == []
    aliased = Sanitizer.for_machine(Path("/private/tmp/spike-repo"))
    assert aliased("/tmp/spike-repo/acestep") == "<REPO>/acestep"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_sanitize.py`
Expected: `E   ModuleNotFoundError: No module named 'tools'` and `1 error`.

- [ ] **Step 3: Create the packages**

Create `song-remix-backend/tools/__init__.py`:

```python
"""Developer tools. Nothing in `app` imports from here."""
```

Create `song-remix-backend/tools/acestep_spike/__init__.py`:

```python
"""P1a ACE-Step spike: records fixtures and measurements from a running ACE-Step (`python -m tools.acestep_spike`)."""
```

- [ ] **Step 4: Implement the sanitizer**

Create `song-remix-backend/tools/acestep_spike/sanitize.py`:

```python
"""Remove machine-specific details from recorded ACE-Step responses."""

import getpass
import json
import os
import re
import socket
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

REDACTED = "<redacted>"
AUDIO_CODES_KEEP = 32
MIN_NEEDLE_LENGTH = 3
IGNORED_HOSTS = frozenset({"localhost", "127.0.0.1"})
GENERIC_LEAKS = (
    re.compile(r"/Users/(?!<)"),
    re.compile(r"/home/(?!<)"),
    re.compile(r"/var/folders/"),
    re.compile(r"%2FUsers%2F(?!%3C)"),
    re.compile(r"%2Fvar%2Ffolders%2F"),
)


def _aliases(path: str) -> list[str]:
    """macOS reaches /private/tmp and /private/var through /tmp and /var; cover both spellings."""
    if path.startswith("/private/"):
        return [path, path.removeprefix("/private")]
    return [path]


@dataclass(frozen=True)
class Sanitizer:
    replacements: tuple[tuple[str, str], ...]
    redact_keys: frozenset[str] = frozenset()

    @classmethod
    def from_pairs(cls, pairs: Iterable[tuple[str, str]], redact_keys: Iterable[str] = ()) -> "Sanitizer":
        expanded: dict[str, str] = {}
        for needle, token in pairs:
            needle = needle.rstrip("/")
            if len(needle) < MIN_NEEDLE_LENGTH:
                continue
            expanded.setdefault(needle, token)
            encoded = quote(needle, safe="")
            if encoded != needle:
                expanded.setdefault(encoded, quote(token, safe=""))
        ordered = tuple(sorted(expanded.items(), key=lambda item: len(item[0]), reverse=True))
        return cls(ordered, frozenset(redact_keys))

    @classmethod
    def for_machine(cls, repo_root: Path, redact_keys: Iterable[str] = ()) -> "Sanitizer":
        temp_dir = tempfile.gettempdir()
        pairs = [(alias, "<REPO>") for path in (str(repo_root.resolve()), str(repo_root)) for alias in _aliases(path)]
        pairs += [(alias, "<TMP>") for path in (os.path.realpath(temp_dir), temp_dir) for alias in _aliases(path)]
        pairs.append((str(Path.home()), "<HOME>"))
        host = socket.gethostname()
        for name in (host, host.split(".")[0]):
            if name.lower() not in IGNORED_HOSTS:
                pairs.append((name, "<HOST>"))
        pairs.append((getpass.getuser(), "<USER>"))
        return cls.from_pairs(pairs, redact_keys)

    def __call__(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {key: self._field(key, item) for key, item in value.items()}
        if isinstance(value, list):
            return [self(item) for item in value]
        if isinstance(value, str):
            return self._text(value)
        return value

    def _field(self, key: str, value: Any) -> Any:
        if key in self.redact_keys and isinstance(value, str) and value:
            return REDACTED
        if key == "audio_codes" and isinstance(value, str) and len(value) > AUDIO_CODES_KEEP:
            return f"{value[:AUDIO_CODES_KEEP]}...({len(value)} chars)"
        return self(value)

    def _text(self, text: str) -> str:
        if text.lstrip()[:1] in ("[", "{"):
            try:
                parsed = json.loads(text)
            except ValueError:
                parsed = None
            if isinstance(parsed, (list, dict)):
                return json.dumps(self(parsed), ensure_ascii=False)
        for needle, token in self.replacements:
            text = text.replace(needle, token)
        return text

    def leaks(self, value: Any) -> list[str]:
        text = json.dumps(value, ensure_ascii=False)
        found = [needle for needle, _ in self.replacements if needle in text]
        found += [pattern.pattern for pattern in GENERIC_LEAKS if pattern.search(text)]
        return found
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_sanitize.py`
Expected: `6 passed`.

- [ ] **Step 6: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `124 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 7: Commit**

```bash
git add song-remix-backend/tools/__init__.py song-remix-backend/tools/acestep_spike/__init__.py song-remix-backend/tools/acestep_spike/sanitize.py song-remix-backend/tests/test_spike_sanitize.py
git commit -m "feat(spike): response sanitizer for ACE-Step fixtures"
```

### Task 2: ACE-Step HTTP client

**Files:**
- Create: `song-remix-backend/tools/acestep_spike/client.py`
- Test: `song-remix-backend/tests/test_spike_client.py`

**Interfaces:**
- Consumes: `httpx` (runtime dependency) and `respx` (dev dependency), both already in `requirements.lock`.
- Produces:
  - `STATUS_PENDING = 0`, `STATUS_SUCCEEDED = 1`, `STATUS_FAILED = 2`.
  - `Exchange(method, path, request, status_code, body)` with `.as_fixture() -> {"request": {...}, "response": {"status_code", "json"}}`.
  - `AceStepError(exchange)` for HTTP status 400 and above. Its subclass `QueueFull` is raised for 429. Both carry `.exchange`.
  - `QueryItem(task_id, status, result: list[dict], progress_text)` with `.first`, which is `result[0]` or `{}`.
  - `unwrap(body)` returns `body["data"]` when the body has both `data` and `code`, and the body unchanged otherwise.
  - `parse_query(body) -> list[QueryItem]` decodes the `result` JSON string.
  - `AceStepClient(base_url, timeout=120.0)`, a context manager with:
    - `.get(path)`
    - `.submit(fields, src_audio=None, upload_name=None)`: JSON without a file; multipart with file field `src_audio` and every value stringified (`true`/`false` for booleans) with one.
    - `.query(task_ids)`
    - `.download(file_url, destination)`
  - `wait_for_task(client, task_id, *, poll_interval=1.0, timeout=3000.0, clock=time.monotonic, sleep=time.sleep) -> PollTrace`.
    - It returns at the first status other than 0 and raises `TimeoutError` after `timeout`.
    - `PollTrace` fields: `final`, `final_exchange`, `first_running` (the first status-0 poll with `progress > 0`), `first_progress_s`, `elapsed_s`, `polls` and `progress`, a list of `(elapsed, progress, stage)` entries recorded each time progress or stage changes.

- [ ] **Step 1: Write the failing tests**

Create `song-remix-backend/tests/test_spike_client.py`:

```python
import json

import httpx
import pytest
import respx

from tools.acestep_spike.client import (
    AceStepClient,
    AceStepError,
    QueueFull,
    parse_query,
    unwrap,
    wait_for_task,
)

BASE = "http://acestep.test"


def wrapped(data):
    return {"data": data, "code": 200, "error": None, "timestamp": 1, "extra": None}


def query_body(task_id, status, items, progress_text=""):
    return wrapped([{"task_id": task_id, "status": status, "result": json.dumps(items), "progress_text": progress_text}])


@respx.mock
def test_submit_without_a_source_sends_json():
    route = respx.post(f"{BASE}/release_task").respond(
        json=wrapped({"task_id": "t1", "status": "queued", "queue_position": 1})
    )
    fields = {"task_type": "text2music", "batch_size": 2, "use_random_seed": False}
    with AceStepClient(BASE) as client:
        exchange = client.submit(fields)
    assert json.loads(route.calls.last.request.content) == fields
    assert unwrap(exchange.body)["task_id"] == "t1"
    assert exchange.as_fixture() == {
        "request": {"method": "POST", "path": "/release_task", "body": fields},
        "response": {"status_code": 200, "json": exchange.body},
    }


@respx.mock
def test_submit_with_a_source_sends_multipart_strings(tmp_path):
    source = tmp_path / "My Song.wav"
    source.write_bytes(b"RIFF....WAVE")
    route = respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "t2"}))
    with AceStepClient(BASE) as client:
        exchange = client.submit(
            {"task_type": "cover", "use_random_seed": False, "audio_cover_strength": 0.6}, source, "real-1.wav"
        )
    body = route.calls.last.request.read()
    assert b'name="use_random_seed"\r\n\r\nfalse\r\n' in body
    assert b'name="audio_cover_strength"\r\n\r\n0.6\r\n' in body
    assert b'name="src_audio"; filename="real-1.wav"' in body
    assert b"RIFF....WAVE" in body
    assert exchange.request["src_audio"] == "<upload real-1.wav>"


@respx.mock
def test_a_full_queue_raises_queue_full_with_the_exchange():
    respx.post(f"{BASE}/release_task").respond(429, json={"detail": "Server busy: queue is full"})
    with AceStepClient(BASE) as client, pytest.raises(QueueFull) as error:
        client.submit({"task_type": "text2music"})
    assert error.value.exchange.status_code == 429
    assert error.value.exchange.body == {"detail": "Server busy: queue is full"}


@respx.mock
def test_other_http_errors_raise_acestep_error():
    respx.post(f"{BASE}/release_task").respond(415, text="Unsupported Content-Type")
    with AceStepClient(BASE) as client, pytest.raises(AceStepError) as error:
        client.submit({"task_type": "text2music"})
    assert not isinstance(error.value, QueueFull)
    assert error.value.exchange.body == "Unsupported Content-Type"


def test_parse_query_decodes_result_strings_and_unknown_ids():
    body = wrapped(
        [
            {
                "task_id": "a",
                "status": 1,
                "result": json.dumps([{"file": "/v1/audio?path=x", "stage": "succeeded"}]),
                "progress_text": "done",
            },
            {"task_id": "b", "result": "[]", "status": 0},
        ]
    )
    done, unknown = parse_query(body)
    assert (done.status, done.first["file"], done.progress_text) == (1, "/v1/audio?path=x", "done")
    assert (unknown.status, unknown.result, unknown.first, unknown.progress_text) == (0, [], {}, None)


@respx.mock
def test_wait_for_task_tracks_progress_until_the_task_finishes():
    respx.post(f"{BASE}/query_result").mock(
        side_effect=[
            httpx.Response(200, json=query_body("t", 0, [{"progress": 0.0, "stage": "queued"}])),
            httpx.Response(200, json=query_body("t", 0, [{"progress": 0.4, "stage": "inference"}])),
            httpx.Response(200, json=query_body("t", 0, [{"progress": 0.4, "stage": "inference"}])),
            httpx.Response(200, json=query_body("t", 1, [{"file": "/v1/audio?path=a", "progress": 1.0, "stage": "succeeded"}])),
        ]
    )
    ticks = iter([0.0, 1.0, 2.0, 3.0, 4.0])
    sleeps = []
    with AceStepClient(BASE) as client:
        trace = wait_for_task(client, "t", poll_interval=0.5, clock=lambda: next(ticks), sleep=sleeps.append)
    assert trace.final.status == 1
    assert trace.polls == 4
    assert trace.first_progress_s == 2.0
    assert parse_query(trace.first_running.body)[0].first["progress"] == 0.4
    assert trace.progress == [(1.0, 0.0, "queued"), (2.0, 0.4, "inference"), (4.0, 1.0, "succeeded")]
    assert sleeps == [0.5, 0.5, 0.5]


@respx.mock
def test_wait_for_task_gives_up_after_the_timeout():
    respx.post(f"{BASE}/query_result").respond(json=query_body("t", 0, []))
    ticks = iter([0.0, 5.0, 11.0])
    with AceStepClient(BASE) as client, pytest.raises(TimeoutError):
        wait_for_task(client, "t", timeout=10.0, clock=lambda: next(ticks), sleep=lambda seconds: None)


@respx.mock
def test_download_writes_the_audio_file(tmp_path):
    respx.get(f"{BASE}/v1/audio").respond(content=b"fLaC-bytes")
    with AceStepClient(BASE) as client:
        path = client.download("/v1/audio?path=%2Fx%2Fa.flac", tmp_path / "out" / "0.flac")
    assert path.read_bytes() == b"fLaC-bytes"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_client.py`
Expected: `E   ModuleNotFoundError: No module named 'tools.acestep_spike.client'` and `1 error`.

- [ ] **Step 3: Implement the client**

Create `song-remix-backend/tools/acestep_spike/client.py`:

```python
"""Synchronous ACE-Step HTTP client used by the P1a spike."""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

STATUS_PENDING = 0
STATUS_SUCCEEDED = 1
STATUS_FAILED = 2


@dataclass(frozen=True)
class Exchange:
    method: str
    path: str
    request: dict[str, Any] | None
    status_code: int
    body: Any

    def as_fixture(self) -> dict[str, Any]:
        return {
            "request": {"method": self.method, "path": self.path, "body": self.request},
            "response": {"status_code": self.status_code, "json": self.body},
        }


class AceStepError(RuntimeError):
    def __init__(self, exchange: Exchange):
        super().__init__(f"{exchange.method} {exchange.path} returned HTTP {exchange.status_code}: {exchange.body}")
        self.exchange = exchange


class QueueFull(AceStepError):
    pass


@dataclass(frozen=True)
class QueryItem:
    task_id: str
    status: int
    result: list[dict[str, Any]]
    progress_text: str | None

    @property
    def first(self) -> dict[str, Any]:
        return self.result[0] if self.result else {}


def unwrap(body: Any) -> Any:
    if isinstance(body, dict) and "data" in body and "code" in body:
        return body["data"]
    return body


def parse_query(body: Any) -> list[QueryItem]:
    items = []
    for raw in unwrap(body) or []:
        result = raw.get("result")
        parsed = json.loads(result) if isinstance(result, str) and result else result or []
        items.append(
            QueryItem(
                task_id=raw["task_id"],
                status=int(raw.get("status", STATUS_PENDING)),
                result=parsed if isinstance(parsed, list) else [parsed],
                progress_text=raw.get("progress_text"),
            )
        )
    return items


def form_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class AceStepClient:
    def __init__(self, base_url: str, timeout: float = 120.0):
        self._http = httpx.Client(base_url=base_url, timeout=timeout)

    def __enter__(self) -> "AceStepClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._http.close()

    def _send(self, method: str, path: str, record: dict[str, Any] | None, **kwargs: Any) -> Exchange:
        response = self._http.request(method, path, **kwargs)
        try:
            body = response.json()
        except ValueError:
            body = response.text
        exchange = Exchange(method, path, record, response.status_code, body)
        if response.status_code == 429:
            raise QueueFull(exchange)
        if response.status_code >= 400:
            raise AceStepError(exchange)
        return exchange

    def get(self, path: str) -> Exchange:
        return self._send("GET", path, None)

    def submit(self, fields: dict[str, Any], src_audio: Path | None = None, upload_name: str | None = None) -> Exchange:
        if src_audio is None:
            return self._send("POST", "/release_task", dict(fields), json=fields)
        name = upload_name or src_audio.name
        record = {**fields, "src_audio": f"<upload {name}>"}
        with src_audio.open("rb") as handle:
            return self._send(
                "POST",
                "/release_task",
                record,
                data={key: form_value(value) for key, value in fields.items()},
                files={"src_audio": (name, handle, "application/octet-stream")},
            )

    def query(self, task_ids: list[str]) -> Exchange:
        payload = {"task_id_list": task_ids}
        return self._send("POST", "/query_result", payload, json=payload)

    def download(self, file_url: str, destination: Path) -> Path:
        response = self._http.get(file_url)
        if response.status_code != 200:
            raise AceStepError(Exchange("GET", file_url, None, response.status_code, response.text[:200]))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(response.content)
        return destination


@dataclass
class PollTrace:
    task_id: str
    final: QueryItem
    final_exchange: Exchange
    first_running: Exchange | None = None
    first_progress_s: float | None = None
    elapsed_s: float = 0.0
    polls: int = 0
    progress: list[tuple[float, float | None, str | None]] = field(default_factory=list)


def wait_for_task(
    client: AceStepClient,
    task_id: str,
    *,
    poll_interval: float = 1.0,
    timeout: float = 3000.0,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> PollTrace:
    start = clock()
    first_running: Exchange | None = None
    first_progress_s: float | None = None
    progress: list[tuple[float, float | None, str | None]] = []
    polls = 0
    while True:
        exchange = client.query([task_id])
        polls += 1
        elapsed = clock() - start
        item = parse_query(exchange.body)[0]
        sample = (round(elapsed, 1), item.first.get("progress"), item.first.get("stage"))
        if not progress or progress[-1][1:] != sample[1:]:
            progress.append(sample)
        if item.status != STATUS_PENDING:
            return PollTrace(task_id, item, exchange, first_running, first_progress_s, elapsed, polls, progress)
        value = item.first.get("progress")
        if first_running is None and isinstance(value, (int, float)) and value > 0:
            first_running = exchange
            first_progress_s = elapsed
        if elapsed >= timeout:
            raise TimeoutError(f"task {task_id} still pending after {timeout:.0f} s")
        sleep(poll_interval)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_client.py`
Expected: `8 passed`.

- [ ] **Step 5: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `132 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 6: Commit**

```bash
git add song-remix-backend/tools/acestep_spike/client.py song-remix-backend/tests/test_spike_client.py
git commit -m "feat(spike): ACE-Step HTTP client with polling trace"
```

### Task 3: Memory sampler, synthesized sources and audio helpers

**Files:**
- Create:
  - `song-remix-backend/tools/acestep_spike/memory.py`
  - `song-remix-backend/tools/acestep_spike/sources.py`
  - `song-remix-backend/tools/acestep_spike/audio.py`
- Test: `song-remix-backend/tests/test_spike_memory.py`, `song-remix-backend/tests/test_spike_sources.py`

**Interfaces:**
- Consumes: macOS `footprint`, `sysctl`, `pgrep`, plus `ffprobe` and `ffmpeg` on `PATH`.
- Produces (`memory`):
  - `Footprint(current, peak)`, `parse_footprint(output) -> Footprint`, `parse_swap_used(output) -> int` (bytes).
  - `read_footprint(pid)`, `swap_used()`, `find_pids(pattern="acestep-api") -> list[int]`.
  - `PeakMemorySampler(pids=find_pids, reader=read_footprint, interval=1.0)` with `.sample_once() -> int`, `.peak_bytes`, `.lifetime_peak_bytes` and `.samples`. As a context manager it samples on a background thread and once more on exit. Processes that disappear between `pgrep` and `footprint` are skipped.
- Produces (`sources`):
  - `SourceSpec(label, tonic, mode, bpm, seconds=30.0)` with `.key_scale` (for example `"A minor"`).
  - `SYNTH_SOURCES`: `synth-a-minor-90`, `synth-c-major-120` and `synth-e-minor-140`.
  - `Source(label, path, spec)`, where `spec` is `None` for real files.
  - `synthesize(spec, path, sample_rate=44100) -> Path` writes a deterministic stereo 16-bit WAV: one tonic-first triad per bar, a bass root, a kick on every beat and a hi-hat off the beat.
  - `real_sources(env=os.environ)` reads `REAL_SOURCE_AUDIO` and labels the files `real-N`.
  - `ensure_sources(directory, env=os.environ)` synthesizes missing files and appends the real sources.
  - `find_source(sources, label)` raises `KeyError` for an unknown label.
- Produces (`audio`):
  - `probe_seconds(path) -> float` (3 decimals).
  - `decode_mono(path, start=None, end=None) -> array('h')` at 16 kHz.
  - `pcm_sha256(path)`.
  - `difference_db(reference, other) -> float`: the RMS of the difference relative to the reference, in dB, over the shorter length; `-inf` when identical.

- [ ] **Step 1: Write the failing tests**

Create `song-remix-backend/tests/test_spike_memory.py`:

```python
import subprocess

import pytest

from tools.acestep_spike.memory import Footprint, PeakMemorySampler, parse_footprint, parse_swap_used

FOOTPRINT_OUTPUT = """======================================================================
python3.12 [4242]: 64-bit    Footprint: 21474836480 B (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 21474836480 B
    phys_footprint_peak: 32212254720 B
"""


def test_parse_footprint_reads_current_and_peak_bytes():
    assert parse_footprint(FOOTPRINT_OUTPUT) == Footprint(current=21474836480, peak=32212254720)


def test_parse_footprint_rejects_unexpected_output():
    with pytest.raises(ValueError):
        parse_footprint("footprint: no process found")


def test_parse_swap_used_converts_megabytes():
    output = "vm.swapusage: total = 26624.00M  used = 25618.06M  free = 1005.94M  (encrypted)"
    assert parse_swap_used(output) == int(25618.06 * 1024 * 1024)


def test_sampler_sums_processes_keeps_the_maximum_and_skips_vanished_pids():
    readings = {
        1: iter([Footprint(100, 150), Footprint(300, 400)]),
        2: iter([Footprint(10, 20), Footprint(5, 20)]),
    }

    def reader(pid):
        if pid == 3:
            raise subprocess.CalledProcessError(1, "footprint")
        return next(readings[pid])

    sampler = PeakMemorySampler(pids=lambda: [1, 2, 3], reader=reader)
    assert sampler.sample_once() == 110
    assert sampler.sample_once() == 305
    assert (sampler.peak_bytes, sampler.lifetime_peak_bytes, sampler.samples) == (305, 420, 2)


def test_sampler_context_samples_in_the_background_and_once_more_on_exit():
    sampler = PeakMemorySampler(pids=lambda: [7], reader=lambda pid: Footprint(64, 128), interval=60.0)
    with sampler:
        pass
    assert sampler.samples in (1, 2)
    assert (sampler.peak_bytes, sampler.lifetime_peak_bytes) == (64, 128)
```

Create `song-remix-backend/tests/test_spike_sources.py`:

```python
import os
import wave
from array import array

import pytest

from tools.acestep_spike import audio, sources
from tools.acestep_spike.sources import (
    SourceSpec,
    bar_frequencies,
    ensure_sources,
    find_source,
    real_sources,
    synthesize,
)


def test_synthesize_writes_a_stereo_wav_of_the_requested_length(tmp_path):
    path = synthesize(SourceSpec("t", "A", "minor", 120, seconds=1.0), tmp_path / "t.wav")
    with wave.open(str(path)) as handle:
        assert (handle.getnchannels(), handle.getsampwidth(), handle.getframerate()) == (2, 2, 44100)
        assert handle.getnframes() == 44100
    assert audio.probe_seconds(path) == 1.0


def test_synthesis_is_deterministic(tmp_path):
    spec = SourceSpec("t", "E", "minor", 140, seconds=0.5)
    first = synthesize(spec, tmp_path / "a.wav").read_bytes()
    second = synthesize(spec, tmp_path / "b.wav").read_bytes()
    assert first == second


def test_the_first_chord_is_the_tonic_triad():
    c_major_chord, c_bass = bar_frequencies(SourceSpec("c", "C", "major", 120))[0]
    assert [round(f, 2) for f in c_major_chord] == [261.63, 329.63, 392.0]
    assert round(c_bass, 2) == 65.41
    a_minor_chord, _ = bar_frequencies(SourceSpec("a", "A", "minor", 90))[0]
    assert [round(f, 2) for f in a_minor_chord] == [440.0, 523.25, 659.26]


def test_real_sources_come_from_the_env_with_anonymous_labels(tmp_path):
    first = tmp_path / "Somebody - Song.mp3"
    second = tmp_path / "other.flac"
    first.write_bytes(b"x")
    second.write_bytes(b"y")
    found = real_sources({"REAL_SOURCE_AUDIO": f"{first}{os.pathsep}{second}{os.pathsep}"})
    assert [(source.label, source.path, source.spec) for source in found] == [
        ("real-1", first, None),
        ("real-2", second, None),
    ]


def test_a_missing_real_source_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        real_sources({"REAL_SOURCE_AUDIO": str(tmp_path / "missing.wav")})


def test_ensure_sources_synthesizes_once_and_finds_by_label(tmp_path, monkeypatch):
    calls = []

    def fake_synthesize(spec, path):
        calls.append(spec.label)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"wav")
        return path

    monkeypatch.setattr(sources, "synthesize", fake_synthesize)
    ensure_sources(tmp_path, env={})
    found = ensure_sources(tmp_path, env={})
    assert calls == ["synth-a-minor-90", "synth-c-major-120", "synth-e-minor-140"]
    assert find_source(found, "synth-c-major-120").spec.bpm == 120
    with pytest.raises(KeyError):
        find_source(found, "synth-nope")


def test_difference_db_is_relative_to_the_reference():
    reference = array("h", [1000, -1000] * 100)
    assert audio.difference_db(reference, array("h", reference)) == float("-inf")
    assert audio.difference_db(reference, array("h", [0] * 200)) == 0.0
    assert audio.difference_db(reference, array("h", [500, -500] * 100)) == -6.02
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_memory.py tests/test_spike_sources.py`
Expected: `2 errors`:
- `E   ModuleNotFoundError: No module named 'tools.acestep_spike.memory'`
- `E   ImportError: cannot import name 'audio' from 'tools.acestep_spike'`

- [ ] **Step 3: Implement the memory sampler**

Create `song-remix-backend/tools/acestep_spike/memory.py`:

```python
"""Physical-footprint sampling for the ACE-Step processes (macOS `footprint`)."""

import re
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass

ACESTEP_PATTERN = "acestep-api"
FOOTPRINT_RE = re.compile(r"phys_footprint:\s+(\d+) B")
FOOTPRINT_PEAK_RE = re.compile(r"phys_footprint_peak:\s+(\d+) B")
SWAP_USED_RE = re.compile(r"used = ([\d.]+)M")


@dataclass(frozen=True)
class Footprint:
    current: int
    peak: int


def parse_footprint(output: str) -> Footprint:
    current = FOOTPRINT_RE.search(output)
    peak = FOOTPRINT_PEAK_RE.search(output)
    if current is None or peak is None:
        raise ValueError("footprint output has no phys_footprint lines")
    return Footprint(int(current.group(1)), int(peak.group(1)))


def parse_swap_used(output: str) -> int:
    match = SWAP_USED_RE.search(output)
    if match is None:
        raise ValueError("vm.swapusage output has no 'used =' field")
    return int(float(match.group(1)) * 1024 * 1024)


def read_footprint(pid: int) -> Footprint:
    result = subprocess.run(
        ["footprint", "--noCategories", "-f", "bytes", "-p", str(pid)],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    return parse_footprint(result.stdout)


def swap_used() -> int:
    result = subprocess.run(["sysctl", "vm.swapusage"], capture_output=True, text=True, check=True)
    return parse_swap_used(result.stdout)


def find_pids(pattern: str = ACESTEP_PATTERN) -> list[int]:
    result = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return sorted(int(line) for line in result.stdout.split())


class PeakMemorySampler:
    """Sums the footprint of every matching process once per interval and keeps the maximum."""

    def __init__(
        self,
        pids: Callable[[], list[int]] = find_pids,
        reader: Callable[[int], Footprint] = read_footprint,
        interval: float = 1.0,
    ):
        self._pids = pids
        self._reader = reader
        self._interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.peak_bytes = 0
        self.lifetime_peak_bytes = 0
        self.samples = 0

    def sample_once(self) -> int:
        total = 0
        lifetime = 0
        for pid in self._pids():
            try:
                footprint = self._reader(pid)
            except (OSError, ValueError, subprocess.SubprocessError):
                continue
            total += footprint.current
            lifetime += footprint.peak
        self.peak_bytes = max(self.peak_bytes, total)
        self.lifetime_peak_bytes = max(self.lifetime_peak_bytes, lifetime)
        self.samples += 1
        return total

    def _loop(self) -> None:
        while not self._stop.is_set():
            self.sample_once()
            self._stop.wait(self._interval)

    def __enter__(self) -> "PeakMemorySampler":
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
        self.sample_once()
```

- [ ] **Step 4: Implement the sources**

Create `song-remix-backend/tools/acestep_spike/sources.py`:

```python
"""Synthesized test songs with known tempo and key, plus optional local files from REAL_SOURCE_AUDIO."""

import math
import os
import wave
from array import array
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 44100
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJOR_PROGRESSION = ((0, "major"), (7, "major"), (9, "minor"), (5, "major"))
MINOR_PROGRESSION = ((0, "minor"), (8, "major"), (3, "major"), (10, "major"))


@dataclass(frozen=True)
class SourceSpec:
    label: str
    tonic: str
    mode: str
    bpm: int
    seconds: float = 30.0

    @property
    def key_scale(self) -> str:
        return f"{self.tonic} {self.mode}"


SYNTH_SOURCES = (
    SourceSpec("synth-a-minor-90", "A", "minor", 90),
    SourceSpec("synth-c-major-120", "C", "major", 120),
    SourceSpec("synth-e-minor-140", "E", "minor", 140),
)


@dataclass(frozen=True)
class Source:
    label: str
    path: Path
    spec: SourceSpec | None


def midi_to_hz(note: int) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def bar_frequencies(spec: SourceSpec) -> list[tuple[list[float], float]]:
    tonic = NOTE_NAMES.index(spec.tonic)
    progression = MAJOR_PROGRESSION if spec.mode == "major" else MINOR_PROGRESSION
    bars = []
    for degree, quality in progression:
        root = 60 + tonic + degree
        third = 4 if quality == "major" else 3
        bars.append(([midi_to_hz(root), midi_to_hz(root + third), midi_to_hz(root + 7)], midi_to_hz(root - 24)))
    return bars


def synthesize(spec: SourceSpec, path: Path, sample_rate: int = SAMPLE_RATE) -> Path:
    """Write a stereo 16-bit WAV: one triad per bar, a bass root, a kick on every beat and a hi-hat off the beat."""
    beat = 60.0 / spec.bpm
    bars = bar_frequencies(spec)
    frames = int(spec.seconds * sample_rate)
    samples = array("h")
    noise = 22222
    two_pi = 2 * math.pi
    for n in range(frames):
        t = n / sample_rate
        chord, bass = bars[int(t // (4 * beat)) % len(bars)]
        pad = (math.sin(two_pi * chord[0] * t) + math.sin(two_pi * chord[1] * t) + math.sin(two_pi * chord[2] * t)) / 3
        since_beat = t % beat
        kick = math.sin(two_pi * 55.0 * since_beat) * math.exp(-since_beat * 18)
        noise = (noise * 1103515245 + 12345) & 0x7FFFFFFF
        hat = (noise / 0x3FFFFFFF - 1.0) * math.exp(-((t + beat / 2) % beat) * 60)
        value = 0.30 * pad + 0.25 * math.sin(two_pi * bass * t) + 0.40 * kick + 0.06 * hat
        sample = int(max(-1.0, min(1.0, value * 0.9)) * 32767)
        samples.append(sample)
        samples.append(sample)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.tobytes())
    return path


def real_sources(env: Mapping[str, str] = os.environ) -> list[Source]:
    sources = []
    for raw in env.get("REAL_SOURCE_AUDIO", "").split(os.pathsep):
        if not raw.strip():
            continue
        path = Path(raw.strip()).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"REAL_SOURCE_AUDIO entry does not exist: {path}")
        sources.append(Source(f"real-{len(sources) + 1}", path, None))
    return sources


def ensure_sources(directory: Path, env: Mapping[str, str] = os.environ) -> list[Source]:
    sources = []
    for spec in SYNTH_SOURCES:
        path = directory / f"{spec.label}.wav"
        if not path.exists():
            synthesize(spec, path)
        sources.append(Source(spec.label, path, spec))
    return sources + real_sources(env)


def find_source(sources: list[Source], label: str) -> Source:
    for source in sources:
        if source.label == label:
            return source
    raise KeyError(f"unknown source {label!r}; known: {', '.join(source.label for source in sources)}")
```

- [ ] **Step 5: Implement the audio helpers**

Create `song-remix-backend/tools/acestep_spike/audio.py`:

```python
"""ffprobe and ffmpeg helpers for measuring and comparing spike outputs."""

import hashlib
import math
import subprocess
from array import array
from pathlib import Path

COMPARE_RATE = 16000


def probe_seconds(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return round(float(result.stdout.strip()), 3)


def decode_mono(path: Path, start: float | None = None, end: float | None = None) -> array:
    command = ["ffmpeg", "-v", "error", "-i", str(path)]
    if start is not None:
        command += ["-ss", str(start)]
    if end is not None:
        command += ["-to", str(end)]
    command += ["-ac", "1", "-ar", str(COMPARE_RATE), "-f", "s16le", "-"]
    result = subprocess.run(command, capture_output=True, check=True)
    samples = array("h")
    samples.frombytes(result.stdout)
    return samples


def pcm_sha256(path: Path) -> str:
    return hashlib.sha256(decode_mono(path).tobytes()).hexdigest()


def difference_db(reference: array, other: array) -> float:
    """RMS of (other - reference) relative to the RMS of reference, in dB; -inf when identical."""
    length = min(len(reference), len(other))
    if length == 0:
        raise ValueError("nothing to compare")
    signal = sum(reference[i] * reference[i] for i in range(length))
    error = sum((other[i] - reference[i]) ** 2 for i in range(length))
    if error == 0:
        return float("-inf")
    if signal == 0:
        return float("inf")
    return round(10 * math.log10(error / signal), 2)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_memory.py tests/test_spike_sources.py`
Expected: `12 passed`.

- [ ] **Step 7: Check the real footprint reader once**

Run: `cd song-remix-backend && .venv/bin/python -c "import os; from tools.acestep_spike.memory import read_footprint, swap_used; print(read_footprint(os.getpid()), swap_used())"`
Expected: something like `Footprint(current=12345678, peak=12345678) 26862542274`, with two positive integers. This reads this Python process, not ACE-Step.

- [ ] **Step 8: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `144 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 9: Commit**

```bash
git add song-remix-backend/tools/acestep_spike/memory.py song-remix-backend/tools/acestep_spike/sources.py song-remix-backend/tools/acestep_spike/audio.py song-remix-backend/tests/test_spike_memory.py song-remix-backend/tests/test_spike_sources.py
git commit -m "feat(spike): footprint sampler, synthesized sources and audio comparison"
```

### Task 4: Spike command line and run report

**Files:**
- Create:
  - `song-remix-backend/tools/acestep_spike/report.py`
  - `song-remix-backend/tools/acestep_spike/cli.py`
  - `song-remix-backend/tools/acestep_spike/__main__.py`
- Test: `song-remix-backend/tests/test_spike_cli.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (`report`): `append_record(path, record)`, `read_records(path)`, `table(headers, rows)` and `render(records) -> str`. `render` builds three tables: "Runs", "Seeds", and "full_analysis_only" (the last only when there are analysis records).
- Produces (`cli`): `main(argv=None) -> int`, `build_parser()`, `build_fields(args)`, `DEFAULT_CAPTION`, `DEFAULT_LYRICS` (original lyrics), `REPO_ROOT` and `BACKEND_DIR`.
- Global options:
  - `--base-url` (default `$ACESTEP_SPIKE_URL` or `http://127.0.0.1:8001`)
  - `--data-dir` (default `song-remix-backend/data/spike`)
  - `--fixtures-dir` (default `song-remix-backend/tests/fixtures/acestep`)
  - `--runs-file` (default `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl`)
- Request options (for `submit` and `run`):
  - `--task-type` (default `text2music`), `--caption`, `--lyrics`, `--language` (default `en`)
  - `--duration`, `--batch`, `--seed`, `--use-random-seed true|false`
  - `--src LABEL`, `--cover-strength`, `--repaint-start`, `--repaint-end`
  - `--bpm`, `--key-scale`, `--time-signature`, `--steps`
  - `--param KEY=VALUE`, repeatable. `true`/`false`, integers and floats are parsed.
  - `audio_format=flac`, `lm_backend=mlx` and `vocal_language` are always sent.
- Commands:

| Command | Effect | Exit code |
|---|---|---|
| `sources` | Synthesize the sources into `data/spike/sources/` and list them with their known key and BPM. | 0 |
| `wait-ready [--timeout S] [--interval S] [--no-llm]` | Poll `/health` until `models_initialized` (and `llm_initialized`) is true. | 0, or 1 on timeout |
| `snapshot health\|models\|stats [--save NAME]` | `GET` the endpoint, print it, optionally save it as a fixture. | 0 |
| `submit [request options] [--count N] [--save NAME] [--save-429 NAME]` | Submit N times back to back. Each attempt prints `#i HTTP <code> task_id=… status=… queue_position=…` or `#i HTTP 429 {…}`. | 0 |
| `query ID… [--save NAME] [--download NAME]` | Print `status`, `items`, `stage`, `progress`, `error` and `progress_text` per id. Optionally save the response, and download result files to `data/spike/runs/NAME/<id>/`. | 0 |
| `run --label L [request options] [--expect-status 1] [--save-submit N] [--save-running N] [--save-final N] [--poll-interval 1] [--timeout 3000] [--memory-interval 1] [--no-memory]` | Read `/health`, submit, poll and sample the footprint until the task finishes. Download the outputs to `data/spike/runs/L/`, append one record to the runs file, and print `L: status=… wall=…s outputs=[…] seed_value=… peak=…GiB`. Fixtures are saved only if the final status equals `--expect-status`. | 0 when it matches, 2 when the submit is rejected, 3 when it doesn't match |
| `wait-progress ID [--timeout 600] [--interval 0.5]` | Wait until the task reports `progress > 0` while still pending. | 0, or 1 if it finished first or timed out |
| `task-id LABEL` | Print the task id of the latest run with that label. | 0, or 1 if there is none |
| `compare A B [--start] [--end] [--other-start] [--other-end]` | Print `difference_db=… identical=… reference_s=… other_s=…`. | 0 |
| `report [--output FILE]` | Render the run tables. | 0 |

- Record fields written by `run`:
  - `label`, `recorded_at`, `engine{model,lm_model}`, `request` (without lyrics, plus `lyrics_chars`), `source{label,seconds,truth}`, `task_id`, `status`
  - `submit_s`, `wall_s`, `first_progress_s`, `polls`, `stages`, `items`, `result_keys`
  - `seed_value`, `dit_model`, `lm_model`, `metas` (without lyrics), `error`, `progress_text`, `generation_info`
  - `outputs[{file,seconds,pcm_sha256}]`
  - `analysis`: the analysis fields, plus `bpm_error` and `key_match` for synthesized sources
  - `memory{peak_bytes,lifetime_peak_bytes,samples,swap_before_bytes,swap_after_bytes}`, `expected_status`
  - The whole record is sanitized; lyrics are redacted for real sources.

- [ ] **Step 1: Write the failing tests**

Create `song-remix-backend/tests/test_spike_cli.py`:

```python
import json
from pathlib import Path
from urllib.parse import quote

import httpx
import pytest
import respx

from tools.acestep_spike import cli, sources
from tools.acestep_spike.report import append_record, render
from tools.acestep_spike.sources import SourceSpec, synthesize

BASE = "http://acestep.test"
HEALTH = {
    "data": {
        "status": "ok",
        "service": "ACE-Step API",
        "version": "1.0",
        "models_initialized": True,
        "llm_initialized": True,
        "loaded_model": "acestep-v15-turbo",
        "loaded_lm_model": "acestep-5Hz-lm-1.7B",
    },
    "code": 200,
    "error": None,
    "timestamp": 1,
    "extra": None,
}


def wrapped(data):
    return {"data": data, "code": 200, "error": None, "timestamp": 1, "extra": None}


def poll(task_id, status, items, progress_text=""):
    return httpx.Response(
        200, json=wrapped([{"task_id": task_id, "status": status, "result": json.dumps(items), "progress_text": progress_text}])
    )


def audio_url(name):
    return "/v1/audio?path=" + quote(f"{cli.REPO_ROOT}/acestep/.cache/acestep/tmp/api_audio/{name}", safe="")


@pytest.fixture
def spike(tmp_path):
    options = [
        "--base-url",
        BASE,
        "--data-dir",
        str(tmp_path / "data"),
        "--fixtures-dir",
        str(tmp_path / "fixtures"),
        "--runs-file",
        str(tmp_path / "runs.jsonl"),
    ]
    return lambda *args: cli.main([*options, *args])


@pytest.fixture
def short_sources(monkeypatch):
    monkeypatch.setattr(sources, "SYNTH_SOURCES", (SourceSpec("synth-c-major-120", "C", "major", 120, seconds=2.0),))


def records(tmp_path):
    return [json.loads(line) for line in (tmp_path / "runs.jsonl").read_text().splitlines()]


def fixture(tmp_path, name):
    return json.loads((tmp_path / "fixtures" / f"{name}.json").read_text())


def test_build_fields_always_asks_for_flac_and_mlx():
    args = cli.build_parser().parse_args(
        ["run", "--label", "x", "--duration", "30", "--batch", "2", "--seed", "1234,5678", "--use-random-seed", "false"]
        + ["--param", "thinking=true", "--param", "inference_steps=8"]
    )
    fields = cli.build_fields(args)
    assert (fields["audio_format"], fields["lm_backend"], fields["task_type"]) == ("flac", "mlx", "text2music")
    assert (fields["audio_duration"], fields["batch_size"]) == (30.0, 2)
    assert (fields["seed"], fields["use_random_seed"]) == ("1234,5678", False)
    assert (fields["thinking"], fields["inference_steps"]) == (True, 8)
    assert "audio_cover_strength" not in fields
    assert cli.build_fields(cli.build_parser().parse_args(["run", "--label", "x", "--seed", "42"]))["seed"] == 42


def test_a_param_without_a_value_is_rejected():
    args = cli.build_parser().parse_args(["run", "--label", "x", "--param", "novalue"])
    with pytest.raises(SystemExit):
        cli.build_fields(args)


@respx.mock
def test_run_measures_records_and_saves_sanitized_fixtures(tmp_path, spike):
    wav = synthesize(SourceSpec("o", "C", "major", 120, seconds=1.0), tmp_path / "o.wav").read_bytes()
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "job-1", "status": "queued", "queue_position": 1}))
    variants = [
        {
            "file": audio_url(f"v{index}.flac"),
            "status": 1,
            "seed_value": "11,22",
            "dit_model": "acestep-v15-turbo",
            "lm_model": "acestep-5Hz-lm-1.7B",
            "metas": {"bpm": 120, "duration": 30, "lyrics": "la la"},
            "progress": 1.0,
            "stage": "succeeded",
            "generation_info": f"saved under {Path.home()}/tmp",
        }
        for index in range(2)
    ]
    respx.post(f"{BASE}/query_result").mock(
        side_effect=[
            poll("job-1", 0, [{"progress": 0.3, "stage": "inference"}], "step 3/8"),
            poll("job-1", 1, variants, "done"),
        ]
    )
    respx.get(f"{BASE}/v1/audio").respond(content=wav)

    code = spike(
        "run", "--label", "t2m-test", "--duration", "30", "--batch", "2", "--no-memory", "--poll-interval", "0",
        "--save-submit", "release_task_queued", "--save-running", "query_running", "--save-final", "query_success",
    )

    assert code == 0
    saved = sorted(path.name for path in (tmp_path / "fixtures").iterdir())
    assert saved == ["query_running.json", "query_success.json", "release_task_queued.json"]
    final = fixture(tmp_path, "query_success")
    assert final["recorded_with"]["model"] == "acestep-v15-turbo"
    assert final["response"]["status_code"] == 200
    text = json.dumps(final)
    assert str(Path.home()) not in text
    assert "%3CREPO%3E%2Facestep%2F.cache" in text
    [record] = records(tmp_path)
    assert (record["status"], record["items"], record["task_id"]) == (1, 2, "job-1")
    assert (record["seed_value"], record["dit_model"]) == ("11,22", "acestep-v15-turbo")
    assert [output["seconds"] for output in record["outputs"]] == [1.0, 1.0]
    assert record["outputs"][0]["file"] == "runs/t2m-test/0.flac"
    assert record["request"]["lyrics_chars"] == len(cli.DEFAULT_LYRICS)
    assert "lyrics" not in record["request"]
    assert record["metas"] == {"bpm": 120, "duration": 30}
    assert record["generation_info"] == "saved under <HOME>/tmp"
    assert [change[1] for change in record["stages"]] == ["inference", "succeeded"]
    assert (record["memory"], record["analysis"], record["expected_status"]) == (None, None, 1)


@respx.mock
def test_an_expected_failure_is_saved(tmp_path, spike):
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "job-2", "status": "queued"}))
    respx.post(f"{BASE}/query_result").mock(side_effect=[poll("job-2", 2, [{"status": 2, "stage": "failed"}], "boom")])
    code = spike(
        "run", "--label", "fail", "--task-type", "cover", "--no-memory", "--poll-interval", "0",
        "--expect-status", "2", "--save-final", "query_failure",
    )
    assert code == 0
    assert fixture(tmp_path, "query_failure")["response"]["json"]["data"][0]["status"] == 2
    [record] = records(tmp_path)
    assert (record["status"], record["outputs"], record["progress_text"]) == (2, [], "boom")


@respx.mock
def test_an_unexpected_status_saves_no_fixtures(tmp_path, spike):
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "job-3", "status": "queued"}))
    respx.post(f"{BASE}/query_result").mock(side_effect=[poll("job-3", 1, [{"status": 1, "stage": "succeeded"}])])
    code = spike("run", "--label", "fail", "--no-memory", "--poll-interval", "0", "--expect-status", "2", "--save-final", "query_failure")
    assert code == 3
    assert not (tmp_path / "fixtures").exists()
    assert records(tmp_path)[0]["expected_status"] == 2


@respx.mock
def test_a_rejected_submit_returns_2(tmp_path, spike):
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/release_task").respond(400, json={"detail": "cover requires source audio"})
    assert spike("run", "--label", "bad", "--task-type", "cover", "--no-memory", "--save-submit", "release_task_rejected") == 2
    assert fixture(tmp_path, "release_task_rejected")["response"]["status_code"] == 400
    assert not (tmp_path / "runs.jsonl").exists()


@respx.mock
def test_analysis_runs_are_compared_with_the_synth_truth(tmp_path, spike, short_sources):
    analysis = {
        "status_message": "Full Hardware Analysis Success",
        "bpm": 118,
        "keyscale": "C Major",
        "timesignature": "4",
        "duration": 2.0,
        "genre": "pop",
        "prompt": "bright pop",
        "lyrics": "",
        "language": "en",
        "metas": {},
        "audio_codes": "<|audio_code_1|>" * 50,
    }
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    submit = respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "job-4", "status": "queued"}))
    respx.post(f"{BASE}/query_result").mock(side_effect=[poll("job-4", 1, [analysis])])
    code = spike(
        "run", "--label", "analysis-c", "--src", "synth-c-major-120", "--param", "full_analysis_only=true",
        "--no-memory", "--poll-interval", "0", "--save-final", "query_full_analysis_success",
    )
    assert code == 0
    assert b'filename="synth-c-major-120.wav"' in submit.calls.last.request.read()
    [record] = records(tmp_path)
    assert record["source"] == {"label": "synth-c-major-120", "seconds": 2.0, "truth": {"bpm": 120, "key_scale": "C major"}}
    assert record["analysis"] == {
        "bpm": 118,
        "keyscale": "C Major",
        "timesignature": "4",
        "duration": 2.0,
        "genre": "pop",
        "language": "en",
        "prompt": "bright pop",
        "bpm_error": 2,
        "key_match": True,
    }
    saved = json.loads(fixture(tmp_path, "query_full_analysis_success")["response"]["json"]["data"][0]["result"])
    assert saved[0]["audio_codes"].endswith("...(800 chars)")


@respx.mock
def test_real_sources_are_uploaded_under_their_label_and_lyrics_are_redacted(tmp_path, spike, short_sources, monkeypatch):
    song = tmp_path / "Private Artist - Song.wav"
    synthesize(SourceSpec("x", "A", "minor", 90, seconds=1.0), song)
    monkeypatch.setenv("REAL_SOURCE_AUDIO", str(song))
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    submit = respx.post(f"{BASE}/release_task").respond(json=wrapped({"task_id": "job-5", "status": "queued"}))
    result = {"status_message": "Full Hardware Analysis Success", "bpm": 90, "keyscale": "A minor", "lyrics": "real words"}
    respx.post(f"{BASE}/query_result").mock(side_effect=[poll("job-5", 1, [result])])
    code = spike(
        "run", "--label", "analysis-real-1", "--src", "real-1", "--param", "full_analysis_only=true",
        "--no-memory", "--poll-interval", "0", "--save-final", "query_real",
    )
    assert code == 0
    body = submit.calls.last.request.read()
    assert b'filename="real-1.wav"' in body and b"Private Artist" not in body
    assert "real words" not in (tmp_path / "fixtures" / "query_real.json").read_text()
    [record] = records(tmp_path)
    assert record["source"]["truth"] is None
    assert "bpm_error" not in record["analysis"]


@respx.mock
def test_submit_bursts_report_a_full_queue(tmp_path, spike, capsys):
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/release_task").mock(
        side_effect=[
            httpx.Response(200, json=wrapped({"task_id": "a", "status": "queued", "queue_position": 1})),
            httpx.Response(200, json=wrapped({"task_id": "b", "status": "queued", "queue_position": 1})),
            httpx.Response(429, json={"detail": "Server busy: queue is full"}),
        ]
    )
    assert spike("submit", "--count", "3", "--duration", "180", "--save", "release_task_first", "--save-429", "release_task_429") == 0
    out = capsys.readouterr().out
    assert "#1 HTTP 200 task_id=a status=queued queue_position=1" in out
    assert "#2 HTTP 200 task_id=b" in out
    assert '#3 HTTP 429 {"detail": "Server busy: queue is full"}' in out
    assert fixture(tmp_path, "release_task_429")["response"] == {
        "status_code": 429,
        "json": {"detail": "Server busy: queue is full"},
    }
    assert fixture(tmp_path, "release_task_first")["response"]["json"]["data"]["task_id"] == "a"


@respx.mock
def test_query_prints_and_saves_unknown_ids(tmp_path, spike, capsys):
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/query_result").respond(json=wrapped([{"task_id": "nope", "result": "[]", "status": 0}]))
    assert spike("query", "nope", "--save", "query_unknown") == 0
    assert "nope status=0 items=0 stage=None progress=None" in capsys.readouterr().out
    assert fixture(tmp_path, "query_unknown")["request"]["body"] == {"task_id_list": ["nope"]}


@respx.mock
def test_query_can_download_result_files(tmp_path, spike):
    wav = synthesize(SourceSpec("o", "C", "major", 120, seconds=1.0), tmp_path / "o.wav").read_bytes()
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.post(f"{BASE}/query_result").respond(
        json=wrapped([{"task_id": "old", "status": 1, "result": json.dumps([{"file": audio_url("a.flac")}])}])
    )
    respx.get(f"{BASE}/v1/audio").respond(content=wav)
    assert spike("query", "old", "--download", "after-restart") == 0
    assert (tmp_path / "data" / "runs" / "after-restart" / "old" / "0.flac").exists()


@respx.mock
def test_wait_ready_retries_until_models_are_loaded(spike, capsys):
    not_ready = {**HEALTH, "data": {**HEALTH["data"], "models_initialized": False}}
    respx.get(f"{BASE}/health").mock(
        side_effect=[httpx.ConnectError("refused"), httpx.Response(200, json=not_ready), httpx.Response(200, json=HEALTH)]
    )
    assert spike("wait-ready", "--interval", "0", "--timeout", "30") == 0
    assert "model=acestep-v15-turbo lm=acestep-5Hz-lm-1.7B" in capsys.readouterr().out


@respx.mock
def test_wait_progress_stops_at_the_first_progress(spike):
    respx.post(f"{BASE}/query_result").mock(
        side_effect=[poll("t", 0, []), poll("t", 0, [{"progress": 0.0}]), poll("t", 0, [{"progress": 0.2, "stage": "inference"}])]
    )
    assert spike("wait-progress", "t", "--interval", "0") == 0


@respx.mock
def test_wait_progress_fails_when_the_task_finishes_first(spike):
    respx.post(f"{BASE}/query_result").mock(side_effect=[poll("t", 1, [{"progress": 1.0}])])
    assert spike("wait-progress", "t", "--interval", "0") == 1


@respx.mock
def test_snapshot_saves_the_models_inventory(tmp_path, spike):
    models = {"models": [{"name": "acestep-v15-turbo", "is_default": True, "is_loaded": True, "supported_task_types": ["text2music"]}]}
    respx.get(f"{BASE}/health").respond(json=HEALTH)
    respx.get(f"{BASE}/v1/models").respond(json=wrapped(models))
    assert spike("snapshot", "models", "--save", "models") == 0
    saved = fixture(tmp_path, "models")
    assert saved["request"] == {"method": "GET", "path": "/v1/models", "body": None}
    assert saved["recorded_with"]["acestep"] == "v0.1.8 (dce6214)"


def test_task_id_finds_the_latest_run_with_a_label(tmp_path, spike, capsys):
    append_record(tmp_path / "runs.jsonl", {"label": "a", "task_id": "first"})
    append_record(tmp_path / "runs.jsonl", {"label": "a", "task_id": "second"})
    assert spike("task-id", "a") == 0
    assert capsys.readouterr().out == "second\n"
    assert spike("task-id", "missing") == 1


def test_compare_reports_identical_files(tmp_path, spike, capsys):
    path = synthesize(SourceSpec("o", "C", "major", 120, seconds=1.0), tmp_path / "o.wav")
    assert spike("compare", str(path), str(path)) == 0
    assert "difference_db=-inf identical=True" in capsys.readouterr().out


def test_render_builds_run_seed_and_analysis_tables():
    gib = 1024**3
    run = {
        "label": "t2m-turbo-30-a",
        "engine": {"model": "acestep-v15-turbo", "lm_model": "acestep-5Hz-lm-1.7B"},
        "request": {"task_type": "text2music", "audio_duration": 30.0, "batch_size": 2, "use_random_seed": False, "seed": 1234},
        "status": 1,
        "wall_s": 41.25,
        "first_progress_s": 3.0,
        "memory": {"peak_bytes": 12 * gib, "lifetime_peak_bytes": 14 * gib, "swap_before_bytes": gib, "swap_after_bytes": 2 * gib},
        "outputs": [{"seconds": 30.0, "pcm_sha256": "abcdef0123456789"}, {"seconds": 30.0, "pcm_sha256": "0123456789abcdef"}],
        "seed_value": "1234,1234",
        "analysis": None,
    }
    analysis = {
        "label": "analysis-synth-c-major-120",
        "engine": run["engine"],
        "request": {"task_type": "text2music"},
        "status": 1,
        "wall_s": 9.0,
        "source": {"label": "synth-c-major-120", "truth": {"bpm": 120, "key_scale": "C major"}},
        "analysis": {"bpm": 118, "keyscale": "C Major", "timesignature": "4", "language": "en", "duration": 30.0},
    }
    markdown = render([run, analysis])
    assert (
        "| t2m-turbo-30-a | acestep-v15-turbo | acestep-5Hz-lm-1.7B | text2music | 30.0 | 2 | 1 | 41.2 | 3.0 | 12.0 | 14.0 | 1.0 | 30.0, 30.0 |"
        in markdown
    )
    assert "| t2m-turbo-30-a | False | 1234 | 1234,1234 | abcdef012345, 0123456789ab |" in markdown
    assert "| analysis-synth-c-major-120 | synth-c-major-120 | 120 | 118 | C major | C Major | 4 | en | 30.0 | 9.0 |" in markdown
    assert markdown.index("### Runs") < markdown.index("### Seeds") < markdown.index("### full_analysis_only")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_cli.py`
Expected: `E   ImportError: cannot import name 'cli' from 'tools.acestep_spike'` and `1 error`.

- [ ] **Step 3: Implement the records and tables**

Create `song-remix-backend/tools/acestep_spike/report.py`:

```python
"""JSONL run records and the Markdown tables the findings document is built from."""

import json
from pathlib import Path
from typing import Any

GIB = 1024**3


def append_record(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _gib(value: int | None) -> str:
    return "" if value is None else f"{value / GIB:.1f}"


def _seconds(value: float | None) -> str:
    return "" if value is None else f"{value:.1f}"


def _cell(value: Any) -> str:
    return "" if value is None else str(value).replace("|", "/")


def table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(_cell(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def render(records: list[dict[str, Any]]) -> str:
    runs = [record for record in records if record.get("analysis") is None]
    analyses = [record for record in records if record.get("analysis") is not None]
    run_rows = []
    seed_rows = []
    for record in runs:
        request = record["request"]
        memory = record.get("memory") or {}
        swap_delta = None
        if memory.get("swap_after_bytes") is not None and memory.get("swap_before_bytes") is not None:
            swap_delta = memory["swap_after_bytes"] - memory["swap_before_bytes"]
        outputs = record.get("outputs") or []
        run_rows.append(
            [
                record["label"],
                record["engine"].get("model"),
                record["engine"].get("lm_model"),
                request.get("task_type"),
                request.get("audio_duration"),
                request.get("batch_size"),
                record["status"],
                _seconds(record.get("wall_s")),
                _seconds(record.get("first_progress_s")),
                _gib(memory.get("peak_bytes")),
                _gib(memory.get("lifetime_peak_bytes")),
                _gib(swap_delta),
                ", ".join(f"{output['seconds']:.1f}" for output in outputs),
            ]
        )
        if outputs:
            seed_rows.append(
                [
                    record["label"],
                    request.get("use_random_seed"),
                    request.get("seed"),
                    record.get("seed_value"),
                    ", ".join(output["pcm_sha256"][:12] for output in outputs),
                ]
            )
    sections = [
        "### Runs\n\n"
        + table(
            [
                "Label",
                "DiT",
                "LM",
                "Task",
                "Requested s",
                "Batch",
                "Status",
                "Wall s",
                "First progress s",
                "Peak GiB",
                "Lifetime peak GiB",
                "Swap delta GiB",
                "Output s",
            ],
            run_rows,
        ),
        "### Seeds\n\n"
        + table(["Label", "use_random_seed", "seed", "seed_value", "Output PCM sha256 (first 12)"], seed_rows),
    ]
    if analyses:
        analysis_rows = []
        for record in analyses:
            analysis = record["analysis"]
            truth = (record.get("source") or {}).get("truth") or {}
            analysis_rows.append(
                [
                    record["label"],
                    record["source"]["label"],
                    truth.get("bpm"),
                    analysis.get("bpm"),
                    truth.get("key_scale"),
                    analysis.get("keyscale"),
                    analysis.get("timesignature"),
                    analysis.get("language"),
                    analysis.get("duration"),
                    _seconds(record.get("wall_s")),
                ]
            )
        sections.append(
            "### full_analysis_only\n\n"
            + table(
                ["Label", "Source", "True BPM", "BPM", "True key", "Key", "Time signature", "Language", "Duration", "Wall s"],
                analysis_rows,
            )
        )
    return "\n\n".join(sections) + "\n"
```

- [ ] **Step 4: Implement the command line**

Create `song-remix-backend/tools/acestep_spike/cli.py`:

```python
"""Command line for the P1a ACE-Step spike: `python -m tools.acestep_spike <command>`."""

import argparse
import json
import os
import time
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from tools.acestep_spike import audio, memory
from tools.acestep_spike.client import (
    STATUS_SUCCEEDED,
    AceStepClient,
    AceStepError,
    Exchange,
    QueueFull,
    parse_query,
    unwrap,
    wait_for_task,
)
from tools.acestep_spike.report import append_record, read_records, render
from tools.acestep_spike.sanitize import Sanitizer
from tools.acestep_spike.sources import Source, ensure_sources, find_source

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
ACESTEP_VERSION = "v0.1.8 (dce6214)"
ANALYSIS_SUCCESS = "Full Hardware Analysis Success"
ANALYSIS_FIELDS = ("bpm", "keyscale", "timesignature", "duration", "genre", "language", "prompt")
SNAPSHOT_PATHS = {"health": "/health", "models": "/v1/models", "stats": "/v1/stats"}
DEFAULT_CAPTION = "warm indie pop, acoustic guitar, soft drums, gentle female vocals"
DEFAULT_LYRICS = """[Verse]
Paper lanterns on the river
Drifting slowly out of sight
Every ripple holds a whisper
Of the things we said tonight

[Chorus]
Hold on, hold on to the morning
Let the quiet carry us home
Hold on, hold on, without warning
We were never really alone"""


@dataclass(frozen=True)
class Paths:
    data_dir: Path
    fixtures_dir: Path
    runs_file: Path


def parse_scalar(value: str) -> Any:
    lowered = value.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    for cast in (int, float):
        try:
            return cast(value)
        except ValueError:
            pass
    return value


def build_fields(args: argparse.Namespace) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "task_type": args.task_type,
        "prompt": args.caption,
        "lyrics": args.lyrics,
        "vocal_language": args.language,
        "audio_format": "flac",
        "lm_backend": "mlx",
    }
    optional = {
        "audio_duration": args.duration,
        "batch_size": args.batch,
        "seed": None if args.seed is None else parse_scalar(args.seed),
        "use_random_seed": None if args.use_random_seed is None else args.use_random_seed == "true",
        "audio_cover_strength": args.cover_strength,
        "repainting_start": args.repaint_start,
        "repainting_end": args.repaint_end,
        "bpm": args.bpm,
        "key_scale": args.key_scale,
        "time_signature": args.time_signature,
        "inference_steps": args.steps,
    }
    fields.update({key: value for key, value in optional.items() if value is not None})
    for item in args.param:
        key, separator, value = item.partition("=")
        if not separator or not key:
            raise SystemExit(f"--param expects KEY=VALUE, got {item!r}")
        fields[key] = parse_scalar(value)
    return fields


def sanitizer_for(source: Source | None) -> Sanitizer:
    real = source is not None and source.spec is None
    return Sanitizer.for_machine(REPO_ROOT, redact_keys=("lyrics",) if real else ())


def upload_name(source: Source) -> str:
    return source.path.name if source.spec is not None else f"{source.label}{source.path.suffix}"


def recorded_with(health: dict[str, Any]) -> dict[str, Any]:
    return {
        "acestep": ACESTEP_VERSION,
        "model": health.get("loaded_model"),
        "lm_model": health.get("loaded_lm_model"),
        "recorded_on": date.today().isoformat(),
    }


def save_fixture(paths: Paths, name: str, exchange: Exchange, health: dict[str, Any], sanitizer: Sanitizer) -> Path:
    fixture = sanitizer({**exchange.as_fixture(), "recorded_with": recorded_with(health)})
    leaks = sanitizer.leaks(fixture)
    if leaks:
        raise SystemExit(f"fixture {name} still contains machine details: {leaks}")
    path = paths.fixtures_dir / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved fixture {path.name}")
    return path


def output_suffix(file_url: str) -> str:
    raw = parse_qs(urlparse(file_url).query).get("path", [""])[0]
    return Path(raw).suffix or ".flac"


def download_outputs(client: AceStepClient, items: list[dict[str, Any]], directory: Path, paths: Paths) -> list[dict]:
    outputs = []
    for index, item in enumerate(items):
        file_url = item.get("file") or ""
        if not file_url:
            continue
        target = client.download(file_url, directory / f"{index}{output_suffix(file_url)}")
        outputs.append(
            {
                "file": str(target.relative_to(paths.data_dir)),
                "seconds": audio.probe_seconds(target),
                "pcm_sha256": audio.pcm_sha256(target),
            }
        )
    return outputs


def normalize(value: Any) -> str:
    return " ".join(str(value).lower().split())


def analysis_of(first: dict[str, Any], source: Source | None) -> dict[str, Any] | None:
    if first.get("status_message") != ANALYSIS_SUCCESS:
        return None
    analysis = {key: first.get(key) for key in ANALYSIS_FIELDS}
    if source is not None and source.spec is not None:
        if isinstance(analysis["bpm"], (int, float)):
            analysis["bpm_error"] = round(abs(analysis["bpm"] - source.spec.bpm), 1)
        analysis["key_match"] = normalize(analysis["keyscale"]) == normalize(source.spec.key_scale)
    return analysis


def stage_changes(progress: list[tuple[float, float | None, str | None]]) -> list[list[Any]]:
    changes: list[list[Any]] = []
    for elapsed, value, stage in progress:
        if not changes or changes[-1][1] != stage:
            changes.append([elapsed, stage, value])
    return changes


def command_sources(args: argparse.Namespace, paths: Paths) -> int:
    for source in ensure_sources(paths.data_dir / "sources"):
        truth = f"{source.spec.key_scale}, {source.spec.bpm} BPM" if source.spec else "unknown (REAL_SOURCE_AUDIO)"
        print(f"{source.label}\t{audio.probe_seconds(source.path):.1f} s\t{truth}")
    return 0


def command_wait_ready(args: argparse.Namespace, paths: Paths) -> int:
    start = time.monotonic()
    with AceStepClient(args.base_url) as client:
        while time.monotonic() - start < args.timeout:
            try:
                health = unwrap(client.get("/health").body)
            except (httpx.TransportError, AceStepError):
                health = {}
            if health.get("models_initialized") and (health.get("llm_initialized") or args.no_llm):
                print(
                    f"ready after {time.monotonic() - start:.0f} s: "
                    f"model={health.get('loaded_model')} lm={health.get('loaded_lm_model')}"
                )
                return 0
            time.sleep(args.interval)
    print(f"ACE-Step was not ready after {args.timeout:.0f} s")
    return 1


def command_snapshot(args: argparse.Namespace, paths: Paths) -> int:
    with AceStepClient(args.base_url) as client:
        health = unwrap(client.get("/health").body)
        exchange = client.get(SNAPSHOT_PATHS[args.endpoint])
    print(json.dumps(unwrap(exchange.body), indent=2, ensure_ascii=False)[:2000])
    if args.save:
        save_fixture(paths, args.save, exchange, health, sanitizer_for(None))
    return 0


def resolve_source(args: argparse.Namespace, paths: Paths) -> Source | None:
    if not args.src:
        return None
    return find_source(ensure_sources(paths.data_dir / "sources"), args.src)


def command_submit(args: argparse.Namespace, paths: Paths) -> int:
    source = resolve_source(args, paths)
    fields = build_fields(args)
    sanitizer = sanitizer_for(source)
    saved = saved_429 = False
    with AceStepClient(args.base_url) as client:
        health = unwrap(client.get("/health").body)
        for index in range(1, args.count + 1):
            try:
                exchange = client.submit(
                    fields, source.path if source else None, upload_name(source) if source else None
                )
            except QueueFull as error:
                print(f"#{index} HTTP 429 {json.dumps(error.exchange.body, ensure_ascii=False)}")
                if args.save_429 and not saved_429:
                    save_fixture(paths, args.save_429, error.exchange, health, sanitizer)
                    saved_429 = True
                continue
            except AceStepError as error:
                print(f"#{index} HTTP {error.exchange.status_code} {json.dumps(error.exchange.body, ensure_ascii=False)}")
                continue
            data = unwrap(exchange.body)
            print(
                f"#{index} HTTP {exchange.status_code} task_id={data.get('task_id')} "
                f"status={data.get('status')} queue_position={data.get('queue_position')}"
            )
            if args.save and not saved:
                save_fixture(paths, args.save, exchange, health, sanitizer)
                saved = True
    return 0


def command_query(args: argparse.Namespace, paths: Paths) -> int:
    sanitizer = sanitizer_for(None)
    with AceStepClient(args.base_url) as client:
        health = unwrap(client.get("/health").body)
        exchange = client.query(args.task_ids)
        for item in parse_query(exchange.body):
            first = item.first
            print(
                f"{item.task_id} status={item.status} items={len(item.result)} stage={first.get('stage')} "
                f"progress={first.get('progress')} error={first.get('error')!r} "
                f"progress_text={(item.progress_text or '')[:80]!r}"
            )
            if args.download:
                directory = paths.data_dir / "runs" / args.download / item.task_id
                for output in download_outputs(client, item.result, directory, paths):
                    print(f"  downloaded {output['file']} ({output['seconds']:.1f} s)")
        if args.save:
            save_fixture(paths, args.save, exchange, health, sanitizer)
    return 0


def command_run(args: argparse.Namespace, paths: Paths) -> int:
    source = resolve_source(args, paths)
    fields = build_fields(args)
    sanitizer = sanitizer_for(source)
    sampler = memory.PeakMemorySampler(interval=args.memory_interval) if args.memory else None
    with AceStepClient(args.base_url) as client:
        health = unwrap(client.get("/health").body)
        swap_before = memory.swap_used() if args.memory else None
        with sampler or nullcontext():
            started = time.monotonic()
            try:
                submitted = client.submit(
                    fields, source.path if source else None, upload_name(source) if source else None
                )
            except AceStepError as error:
                print(f"submit rejected: HTTP {error.exchange.status_code} {json.dumps(error.exchange.body)}")
                if args.save_submit:
                    save_fixture(paths, args.save_submit, error.exchange, health, sanitizer)
                return 2
            submit_s = time.monotonic() - started
            task_id = unwrap(submitted.body)["task_id"]
            trace = wait_for_task(client, task_id, poll_interval=args.poll_interval, timeout=args.timeout)
        swap_after = memory.swap_used() if args.memory else None
        first = trace.final.first
        outputs = []
        if trace.final.status == STATUS_SUCCEEDED:
            outputs = download_outputs(client, trace.final.result, paths.data_dir / "runs" / args.label, paths)
    matched = trace.final.status == args.expect_status
    if matched:
        if args.save_submit:
            save_fixture(paths, args.save_submit, submitted, health, sanitizer)
        if args.save_running and trace.first_running is not None:
            save_fixture(paths, args.save_running, trace.first_running, health, sanitizer)
        if args.save_final:
            save_fixture(paths, args.save_final, trace.final_exchange, health, sanitizer)
    request = {key: value for key, value in fields.items() if key != "lyrics"}
    request["lyrics_chars"] = len(fields.get("lyrics", ""))
    metas = first.get("metas")
    record = {
        "label": args.label,
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "engine": {"model": health.get("loaded_model"), "lm_model": health.get("loaded_lm_model")},
        "request": request,
        "source": None
        if source is None
        else {
            "label": source.label,
            "seconds": audio.probe_seconds(source.path),
            "truth": None if source.spec is None else {"bpm": source.spec.bpm, "key_scale": source.spec.key_scale},
        },
        "task_id": task_id,
        "status": trace.final.status,
        "submit_s": round(submit_s, 2),
        "wall_s": round(trace.elapsed_s, 1),
        "first_progress_s": None if trace.first_progress_s is None else round(trace.first_progress_s, 1),
        "polls": trace.polls,
        "stages": stage_changes(trace.progress),
        "items": len(trace.final.result),
        "result_keys": sorted(first),
        "seed_value": first.get("seed_value"),
        "dit_model": first.get("dit_model"),
        "lm_model": first.get("lm_model"),
        "metas": {key: value for key, value in metas.items() if key != "lyrics"} if isinstance(metas, dict) else metas,
        "error": first.get("error"),
        "progress_text": trace.final.progress_text,
        "generation_info": first.get("generation_info"),
        "outputs": outputs,
        "analysis": analysis_of(first, source),
        "memory": None
        if sampler is None
        else {
            "peak_bytes": sampler.peak_bytes,
            "lifetime_peak_bytes": sampler.lifetime_peak_bytes,
            "samples": sampler.samples,
            "swap_before_bytes": swap_before,
            "swap_after_bytes": swap_after,
        },
        "expected_status": args.expect_status,
    }
    append_record(paths.runs_file, sanitizer(record))
    peak = "" if sampler is None else f" peak={sampler.peak_bytes / 1024**3:.1f}GiB"
    print(
        f"{args.label}: status={trace.final.status} wall={trace.elapsed_s:.1f}s "
        f"outputs={[output['seconds'] for output in outputs]} seed_value={first.get('seed_value')!r}{peak}"
    )
    if not matched:
        print(f"expected status {args.expect_status}; no fixtures were saved")
        return 3
    return 0


def command_wait_progress(args: argparse.Namespace, paths: Paths) -> int:
    start = time.monotonic()
    with AceStepClient(args.base_url) as client:
        while time.monotonic() - start < args.timeout:
            [item] = parse_query(client.query([args.task_id]).body)
            progress = item.first.get("progress")
            if item.status != 0:
                print(f"{args.task_id} finished with status {item.status} before any progress was seen")
                return 1
            if isinstance(progress, (int, float)) and progress > 0:
                print(f"{args.task_id} progress={progress} stage={item.first.get('stage')}")
                return 0
            time.sleep(args.interval)
    print(f"{args.task_id} showed no progress within {args.timeout:.0f} s")
    return 1


def command_task_id(args: argparse.Namespace, paths: Paths) -> int:
    matches = [record["task_id"] for record in read_records(paths.runs_file) if record["label"] == args.label]
    if not matches:
        print(f"no run labelled {args.label!r} in {paths.runs_file.name}")
        return 1
    print(matches[-1])
    return 0


def command_compare(args: argparse.Namespace, paths: Paths) -> int:
    reference = audio.decode_mono(Path(args.reference), args.start, args.end)
    other = audio.decode_mono(Path(args.other), args.other_start, args.other_end)
    difference = audio.difference_db(reference, other)
    print(
        f"difference_db={difference} identical={difference == float('-inf')} "
        f"reference_s={len(reference) / audio.COMPARE_RATE:.2f} other_s={len(other) / audio.COMPARE_RATE:.2f}"
    )
    return 0


def command_report(args: argparse.Namespace, paths: Paths) -> int:
    markdown = render(read_records(paths.runs_file))
    if args.output:
        Path(args.output).write_text(markdown, encoding="utf-8")
        print(f"wrote {args.output}")
    else:
        print(markdown, end="")
    return 0


def add_request_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--task-type", default="text2music")
    parser.add_argument("--caption", default=DEFAULT_CAPTION)
    parser.add_argument("--lyrics", default=DEFAULT_LYRICS)
    parser.add_argument("--language", default="en")
    parser.add_argument("--duration", type=float)
    parser.add_argument("--batch", type=int)
    parser.add_argument("--seed")
    parser.add_argument("--use-random-seed", choices=("true", "false"))
    parser.add_argument("--src", help="source label from the `sources` command")
    parser.add_argument("--cover-strength", type=float)
    parser.add_argument("--repaint-start", type=float)
    parser.add_argument("--repaint-end", type=float)
    parser.add_argument("--bpm", type=int)
    parser.add_argument("--key-scale")
    parser.add_argument("--time-signature")
    parser.add_argument("--steps", type=int)
    parser.add_argument("--param", action="append", default=[], help="extra request field KEY=VALUE")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m tools.acestep_spike")
    parser.add_argument("--base-url", default=os.environ.get("ACESTEP_SPIKE_URL", "http://127.0.0.1:8001"))
    parser.add_argument("--data-dir", type=Path, default=BACKEND_DIR / "data" / "spike")
    parser.add_argument("--fixtures-dir", type=Path, default=BACKEND_DIR / "tests" / "fixtures" / "acestep")
    parser.add_argument(
        "--runs-file", type=Path, default=REPO_ROOT / "docs" / "superpowers" / "spikes" / "2026-10-31-acestep-runs.jsonl"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("sources", help="synthesize the test sources and list REAL_SOURCE_AUDIO files")

    wait_ready = commands.add_parser("wait-ready", help="poll /health until the models are loaded")
    wait_ready.add_argument("--timeout", type=float, default=3600.0)
    wait_ready.add_argument("--interval", type=float, default=5.0)
    wait_ready.add_argument("--no-llm", action="store_true")

    snapshot = commands.add_parser("snapshot", help="GET /health, /v1/models or /v1/stats")
    snapshot.add_argument("endpoint", choices=sorted(SNAPSHOT_PATHS))
    snapshot.add_argument("--save")

    submit = commands.add_parser("submit", help="POST /release_task one or more times without waiting")
    add_request_options(submit)
    submit.add_argument("--count", type=int, default=1)
    submit.add_argument("--save")
    submit.add_argument("--save-429")

    query = commands.add_parser("query", help="POST /query_result once")
    query.add_argument("task_ids", nargs="+")
    query.add_argument("--save")
    query.add_argument("--download", help="download any result files under data/spike/runs/<name>/")

    run = commands.add_parser("run", help="submit, wait, download, measure and record one task")
    add_request_options(run)
    run.add_argument("--label", required=True)
    run.add_argument("--expect-status", type=int, default=STATUS_SUCCEEDED)
    run.add_argument("--save-submit")
    run.add_argument("--save-running")
    run.add_argument("--save-final")
    run.add_argument("--poll-interval", type=float, default=1.0)
    run.add_argument("--timeout", type=float, default=3000.0)
    run.add_argument("--memory-interval", type=float, default=1.0)
    run.add_argument("--no-memory", dest="memory", action="store_false")

    wait_progress = commands.add_parser("wait-progress", help="poll one task until it reports progress > 0")
    wait_progress.add_argument("task_id")
    wait_progress.add_argument("--timeout", type=float, default=600.0)
    wait_progress.add_argument("--interval", type=float, default=0.5)

    task_id = commands.add_parser("task-id", help="print the ACE-Step task id of a recorded run")
    task_id.add_argument("label")

    compare = commands.add_parser("compare", help="RMS difference of two audio files (mono, 16 kHz)")
    compare.add_argument("reference")
    compare.add_argument("other")
    compare.add_argument("--start", type=float)
    compare.add_argument("--end", type=float)
    compare.add_argument("--other-start", type=float)
    compare.add_argument("--other-end", type=float)

    report = commands.add_parser("report", help="Markdown tables from the runs file")
    report.add_argument("--output")
    return parser


COMMANDS = {
    "sources": command_sources,
    "wait-ready": command_wait_ready,
    "snapshot": command_snapshot,
    "submit": command_submit,
    "query": command_query,
    "run": command_run,
    "wait-progress": command_wait_progress,
    "task-id": command_task_id,
    "compare": command_compare,
    "report": command_report,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    paths = Paths(args.data_dir, args.fixtures_dir, args.runs_file)
    return COMMANDS[args.command](args, paths)
```

Create `song-remix-backend/tools/acestep_spike/__main__.py`:

```python
import sys

from tools.acestep_spike.cli import main

sys.exit(main())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_spike_cli.py`
Expected: `18 passed`.

- [ ] **Step 6: Synthesize the sources once**

Run: `cd song-remix-backend && .venv/bin/python -m tools.acestep_spike sources`
Expected, after a few seconds:

```text
synth-a-minor-90	30.0 s	A minor, 90 BPM
synth-c-major-120	30.0 s	C major, 120 BPM
synth-e-minor-140	30.0 s	E minor, 140 BPM
```

The WAV files land in `song-remix-backend/data/spike/sources/`, which `git status` doesn't show because `data/` is ignored.

- [ ] **Step 7: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `162 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 8: Commit**

```bash
git add song-remix-backend/tools/acestep_spike/report.py song-remix-backend/tools/acestep_spike/cli.py song-remix-backend/tools/acestep_spike/__main__.py song-remix-backend/tests/test_spike_cli.py
git commit -m "feat(spike): command line for recording ACE-Step runs and fixtures"
```

### Task 5: Download the default models, boot turbo + 1.7B, record `/health`, `/v1/models` and `/v1/stats`

**Files:**
- Create: `song-remix-backend/tests/test_acestep_fixtures.py`
- Recorded: `song-remix-backend/tests/fixtures/acestep/health.json`, `models.json`, `stats.json`
- Not committed: `song-remix-backend/data/spike/logs/acestep-turbo.log`

**Interfaces:**
- Consumes: `make acestep-download` and `make acestep` (P0 Task 15), plus the spike CLI.
- Produces:
  - `tests/test_acestep_fixtures.py` with `FIXTURES`, `load(name)`, `response(name)`, `query_item(name)` (the single item of a recorded `/query_result`) and `audio_path(file_url)`.
  - A parametrized envelope and leak test that covers every `*.json` fixture.
  - ACE-Step left running (turbo + 1.7B) for Task 6.

- [ ] **Step 1: Write the failing fixture tests**

Create `song-remix-backend/tests/test_acestep_fixtures.py`:

```python
"""Shape checks for the ACE-Step v0.1.8 responses recorded by the P1a spike."""

import json
from pathlib import Path
from urllib.parse import unquote

import pytest

from tools.acestep_spike.client import QueryItem, parse_query, unwrap
from tools.acestep_spike.sanitize import Sanitizer

FIXTURES = Path(__file__).parent / "fixtures" / "acestep"
REPO_ROOT = Path(__file__).resolve().parents[2]
TURBO_TASK_TYPES = {"text2music", "cover", "repaint"}


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def response(name: str) -> dict:
    return load(name)["response"]


def query_item(name: str) -> QueryItem:
    [item] = parse_query(response(name)["json"])
    return item


def audio_path(file_url: str) -> str:
    return unquote(file_url.split("path=", 1)[1])


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.json")), ids=lambda path: path.stem)
def test_every_fixture_is_a_sanitized_envelope(path):
    fixture = json.loads(path.read_text(encoding="utf-8"))
    assert set(fixture) == {"request", "response", "recorded_with"}
    assert set(fixture["response"]) == {"status_code", "json"}
    assert fixture["recorded_with"]["acestep"] == "v0.1.8 (dce6214)"
    assert Sanitizer.for_machine(REPO_ROOT).leaks(fixture) == []


def test_health_reports_the_loaded_models():
    health = unwrap(response("health")["json"])
    assert health["status"] == "ok"
    assert health["models_initialized"] is True
    assert health["llm_initialized"] is True
    assert health["loaded_model"] == "acestep-v15-turbo"
    assert health["loaded_lm_model"] == "acestep-5Hz-lm-1.7B"


def test_models_lists_the_turbo_task_types():
    inventory = unwrap(response("models")["json"])
    turbo = next(model for model in inventory["models"] if model["name"] == "acestep-v15-turbo")
    assert turbo["is_loaded"] is True
    assert TURBO_TASK_TYPES <= set(turbo["supported_task_types"])


def test_stats_reports_the_queue():
    stats = unwrap(response("stats")["json"])
    assert {"jobs", "queue_size", "queue_maxsize"} <= set(stats)
    assert stats["queue_maxsize"] == 200
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `3 failed, 1 skipped`. The three shape tests fail with `FileNotFoundError: … fixtures/acestep/health.json` (and `models.json`, `stats.json`). The envelope test is skipped because there are no fixtures yet ("got empty parameter set").

- [ ] **Step 3: Pre-flight checks**

```bash
df -h "$HOME"
git -C acestep rev-parse HEAD
test ! -d acestep/checkpoints && echo "no local checkpoints"
```

Expected:
- At least 60 GB available.
- `dce621408bee8c31b4fcf4811682eb9359e1bc94`.
- `no local checkpoints`.

If the disk has less than 60 GB free, stop and report BLOCKED.

- [ ] **Step 4: Download the default models (first run: about 10–40 minutes)**

This also creates `acestep/.venv`, which installs PyTorch, MLX and the other ACE-Step dependencies.

```bash
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
make acestep-download
ls "$ACESTEP_CHECKPOINTS_DIR"
```

Expected: the command ends without a traceback, and the listing contains `acestep-5Hz-lm-1.7B`, `acestep-v15-turbo`, `vae` and `Qwen3-Embedding-0.6B`.

If the models land in `acestep/checkpoints/` instead, ACE-Step ignored `ACESTEP_CHECKPOINTS_DIR`. Note it in the ledger as a finding and continue; the server will read them from there.

- [ ] **Step 5: Start ACE-Step and wait until both models are loaded**

```bash
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
mkdir -p song-remix-backend/data/spike/logs
nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
```

Expected: `ready after … s: model=acestep-v15-turbo lm=acestep-5Hz-lm-1.7B`.

If it times out, read the end of the log (`tail -n 80 song-remix-backend/data/spike/logs/acestep-turbo.log`), stop ACE-Step with the Global Constraints command, and report BLOCKED with that output.

- [ ] **Step 6: Record which backend the DiT and VAE use**

```bash
rg -n "MLX|MPS|mps|fall(ing)? back|non-fatal" song-remix-backend/data/spike/logs/acestep-turbo.log | head -n 40
```

Copy the matching lines into `.superpowers/sdd/progress.md` under "Task 5 MLX lines". `[MLX-DiT]` and `[MLX-VAE]` lines mean MLX. "MLX not available … skipping" or "Failed to initialize MLX decoder (non-fatal)" means PyTorch/MPS. Task 13 uses these lines.

- [ ] **Step 7: Record the snapshots**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike snapshot health --save health)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike snapshot models --save models)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike snapshot stats --save stats)
```

Expected: each command prints the JSON and then `saved fixture health.json` (then `models.json`, then `stats.json`).

- [ ] **Step 8: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `6 passed`.

- [ ] **Step 9: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `168 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 10: Commit (ACE-Step stays running)**

```bash
git status --short
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/health.json song-remix-backend/tests/fixtures/acestep/models.json song-remix-backend/tests/fixtures/acestep/stats.json
git commit -m "test(spike): record ACE-Step health, models and stats fixtures"
```

`git status --short` must list only the test file and the three fixtures. The `acestep` submodule must not appear as modified.

### Task 6: text2music timing and memory at 30 s and 180 s (batch 2, turbo)

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/release_task_queued.json`, `query_running.json`, `query_text2music_success.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (created by the first run)

**Interfaces:**
- Consumes: the running ACE-Step from Task 5.
- Produces:
  - Run records `t2m-turbo-30-a`, `t2m-turbo-30-b` (the warm repeat), `t2m-turbo-180` and `t2m-turbo-30-thinking` (`thinking=true`).
  - The first text2music fixtures.

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

Expected: `ready after … model=acestep-v15-turbo lm=acestep-5Hz-lm-1.7B`.

- [ ] **Step 2: Write the failing fixture tests**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_release_task_answers_with_a_wrapped_queued_task():
    fixture = response("release_task_queued")
    assert fixture["status_code"] == 200
    data = fixture["json"]["data"]
    assert data["status"] == "queued"
    assert data["task_id"]
    assert isinstance(data["queue_position"], int)


def test_a_running_poll_reports_progress_and_stage():
    item = query_item("query_running")
    assert item.status == 0
    assert 0 < item.first["progress"] < 1
    assert item.first["stage"]


def test_text2music_success_has_one_item_per_variant():
    item = query_item("query_text2music_success")
    assert item.status == 1
    assert len(item.result) == 2
    for variant in item.result:
        assert {"file", "status", "metas", "stage"} <= set(variant)
        assert variant["stage"] == "succeeded"
        assert audio_path(variant["file"]).startswith("<REPO>/acestep/.cache/acestep/tmp/api_audio/")
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `3 failed, 6 passed`, each failure a `FileNotFoundError` for the new fixture names.

- [ ] **Step 4: Measure 30 s text2music twice, then 180 s, then 30 s with the LM planner**

Each command prints one summary line. The first 30 s run includes warm-up, which is why it is repeated. Typical wall times are unknown; that's what this measures.

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-turbo-30-a --duration 30 --batch 2 --save-submit release_task_queued --save-final query_text2music_success)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-turbo-30-b --duration 30 --batch 2)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-turbo-180 --duration 180 --batch 2 --save-running query_running)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-turbo-30-thinking --duration 30 --batch 2 --param thinking=true)
```

Expected for each: `<label>: status=1 wall=…s outputs=[…, …] seed_value='…' peak=…GiB`, with two outputs whose lengths are close to the requested 30 or 180 s. The first and third commands also print `saved fixture …` lines.

If an output length differs from the request by more than 1 s, or a `peak=` is missing, note it in the ledger; it's a finding, not a reason to re-run.

- [ ] **Step 5: Look at the tables**

Run: `cd song-remix-backend && .venv/bin/python -m tools.acestep_spike report`
Expected: a "Runs" table with the four labels and a "Seeds" table. Copy the "Runs" rows into the ledger under "Task 6".

- [ ] **Step 6: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `12 passed`.

- [ ] **Step 7: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `174 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 8: Commit (ACE-Step stays running)**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/release_task_queued.json song-remix-backend/tests/fixtures/acestep/query_running.json song-remix-backend/tests/fixtures/acestep/query_text2music_success.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git commit -m "test(spike): text2music fixtures and turbo timing at 30 s and 180 s"
```

### Task 7: Failure, queue-full (429), unknown and queued tasks

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/query_failure.json`, `query_unknown.json`, `release_task_429.json`, `query_queued.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (append)
- Not committed: `song-remix-backend/data/spike/logs/acestep-turbo-queue1.log`, `song-remix-backend/data/spike/queue-test.txt`

**Interfaces:**
- Consumes: the running ACE-Step from Task 6.
- Produces:
  - Evidence for spec §3.1 (where failure text comes from), §3.2 (the 429 body) and §3.3 (whether queued and unknown tasks look the same).
  - ACE-Step restarted with the default queue at the end.

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

- [ ] **Step 2: Write the failing fixture tests**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_a_failed_task_reports_status_2():
    item = query_item("query_failure")
    assert item.status == 2
    assert len(item.result) == 1


def test_unknown_task_ids_look_pending_with_an_empty_result():
    item = query_item("query_unknown")
    assert item.status == 0
    assert item.result == []


def test_a_full_queue_answers_429_without_a_wrapper():
    fixture = response("release_task_429")
    assert fixture["status_code"] == 429
    assert fixture["json"] == {"detail": "Server busy: queue is full"}


def test_a_queued_task_is_pending():
    item = query_item("query_queued")
    assert item.status == 0
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `4 failed, 12 passed`, each failure a `FileNotFoundError`.

- [ ] **Step 4: Provoke a failure**

Three candidates are tried in order, and the first one that ends with status 2 saves `query_failure`. A rejected submit exits 2, and a task that doesn't fail exits 3; either way the next candidate runs.

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label fail-cover-no-source --task-type cover --batch 1 --expect-status 2 --save-final query_failure) \
|| (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label fail-repaint-no-source --task-type repaint --batch 1 --expect-status 2 --save-final query_failure) \
|| (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label fail-repaint-reversed --task-type repaint --src synth-a-minor-90 --repaint-start 25 --repaint-end 5 --batch 1 --expect-status 2 --save-final query_failure)
```

Expected per spec §3.1: the first candidate's submit is accepted, and the task ends with `status=2`, followed by `saved fixture query_failure.json`.
- Copy every printed line into the ledger under "Task 7 failure". A `submit rejected: HTTP …` line is itself a finding: it means ACE-Step validates that task type at submit time.
- If all three exit non-zero, stop and report BLOCKED with the output.

- [ ] **Step 5: Query an id that ACE-Step never issued**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike query 00000000-0000-0000-0000-000000000000 --save query_unknown)
```

Expected: `00000000-0000-0000-0000-000000000000 status=0 items=0 stage=None progress=None …` and `saved fixture query_unknown.json`.

- [ ] **Step 6: Restart ACE-Step with a one-slot queue**

```bash
pkill -f "[a]cestep-api --host" || true
for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
pkill -9 -f "[a]cestep-api --host" || true
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
ACESTEP_QUEUE_MAXSIZE=1 nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo-queue1.log 2>&1 &
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike snapshot stats)
```

Expected: `ready after …`, and the stats show `"queue_maxsize": 1`.

- [ ] **Step 7: Fill the worker, fill the queue, overflow it**

ACE-Step runs one worker by default (`ACESTEP_QUEUE_WORKERS=1`). The first task occupies the worker, the second waits in the one-slot queue, and the third must get 429. The output goes to `song-remix-backend/data/spike/queue-test.txt`, so line 1 holds the running task and line 2 the queued one.

```bash
cd song-remix-backend
.venv/bin/python -m tools.acestep_spike submit --duration 180 --batch 2 | tee data/spike/queue-test.txt
RUNNING=$(sed -n 's/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/queue-test.txt)
.venv/bin/python -m tools.acestep_spike wait-progress "$RUNNING"
.venv/bin/python -m tools.acestep_spike submit --count 2 --duration 180 --batch 2 --save-429 release_task_429 | tee -a data/spike/queue-test.txt
cd ..
```

Expected:
- `#1 HTTP 200 task_id=<A> status=queued queue_position=…`
- `<A> progress=… stage=…`
- `#1 HTTP 200 task_id=<B> status=queued queue_position=…`
- `#2 HTTP 429 {"detail": "Server busy: queue is full"}`
- `saved fixture release_task_429.json`

If the second submit gets 429 too, the queue was already full. Note that in the ledger. Step 8 then has no queued task to record: report DONE_WITH_CONCERNS after Step 9.

- [ ] **Step 8: Compare the queued, running and unknown answers**

```bash
cd song-remix-backend
RUNNING=$(sed -n '1s/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/queue-test.txt)
QUEUED=$(sed -n '2s/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/queue-test.txt)
.venv/bin/python -m tools.acestep_spike query "$QUEUED" --save query_queued
.venv/bin/python -m tools.acestep_spike query "$RUNNING"
.venv/bin/python -m tools.acestep_spike query 00000000-0000-0000-0000-000000000000
cd ..
```

Expected: three lines of `status=0`, one per task. Copy them into the ledger under "Task 7 queued vs unknown". If the queued line has the same `items=0 stage=None` as the unknown one, the two cannot be told apart (spec §3.3).

- [ ] **Step 9: Restart ACE-Step with the default queue**

This also discards the two 180 s tasks.

```bash
pkill -f "[a]cestep-api --host" || true
for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
pkill -9 -f "[a]cestep-api --host" || true
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
```

Expected: `ready after … model=acestep-v15-turbo lm=acestep-5Hz-lm-1.7B`.

- [ ] **Step 10: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `20 passed`.

- [ ] **Step 11: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `182 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 12: Commit (ACE-Step stays running)**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/query_failure.json song-remix-backend/tests/fixtures/acestep/query_unknown.json song-remix-backend/tests/fixtures/acestep/release_task_429.json song-remix-backend/tests/fixtures/acestep/query_queued.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git commit -m "test(spike): failure, unknown, queued and queue-full fixtures"
```

### Task 8: `use_random_seed` and `seed` behaviour

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/query_seed_list_success.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (append)

**Interfaces:**
- Consumes: the running ACE-Step (turbo).
- Produces:
  - Run records `seed-fixed-a`, `seed-fixed-b`, `seed-list`, `seed-random-flag` and `seed-default`.
  - Answers to:
    - Does `use_random_seed=false` with one integer seed reproduce the same audio?
    - Do the two variants of a batch differ?
    - Does a comma-separated seed list set one seed per variant?
    - Is `seed` ignored when `use_random_seed=true`?
    - What does `seed_value` contain?
  - All runs are 30 s text2music at batch 2 with the same caption and lyrics.

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

- [ ] **Step 2: Write the failing fixture test**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_a_seed_list_is_echoed_per_variant():
    item = query_item("query_seed_list_success")
    assert item.status == 1
    assert [variant["seed_value"] for variant in item.result] == ["1234,5678", "1234,5678"]
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `1 failed, 20 passed`, the failure a `FileNotFoundError` for `query_seed_list_success.json`.

- [ ] **Step 4: Run the five seed runs**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label seed-fixed-a --duration 30 --batch 2 --use-random-seed false --seed 1234)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label seed-fixed-b --duration 30 --batch 2 --use-random-seed false --seed 1234)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label seed-list --duration 30 --batch 2 --use-random-seed false --seed 1234,5678 --save-final query_seed_list_success)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label seed-random-flag --duration 30 --batch 2 --use-random-seed true --seed 1234)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label seed-default --duration 30 --batch 2)
```

Expected: five `status=1` lines. Each prints its `seed_value`; copy all five into the ledger under "Task 8".

- [ ] **Step 5: Compare the outputs**

```bash
cd song-remix-backend
echo "fixed a/0 vs fixed b/0 (same seed, separate tasks)"
.venv/bin/python -m tools.acestep_spike compare data/spike/runs/seed-fixed-a/0.flac data/spike/runs/seed-fixed-b/0.flac
echo "fixed a/0 vs fixed a/1 (variants of one batch)"
.venv/bin/python -m tools.acestep_spike compare data/spike/runs/seed-fixed-a/0.flac data/spike/runs/seed-fixed-a/1.flac
echo "fixed a/0 vs list/0 (1234 vs first seed of the list)"
.venv/bin/python -m tools.acestep_spike compare data/spike/runs/seed-fixed-a/0.flac data/spike/runs/seed-list/0.flac
echo "fixed a/0 vs random-flag/0 (seed 1234 sent with use_random_seed=true)"
.venv/bin/python -m tools.acestep_spike compare data/spike/runs/seed-fixed-a/0.flac data/spike/runs/seed-random-flag/0.flac
cd ..
```

Expected: four `difference_db=… identical=…` lines. Copy them with their captions into the ledger. The spike records the result; it does not prescribe it. For reference, `identical=True` on the first line means that a fixed seed reproduces the audio. The "Seeds" table in `report` shows the `pcm_sha256` of each output for the same check.

- [ ] **Step 6: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `22 passed`.

If `seed_value` does not echo `1234,5678`, leave the test failing, keep the fixture, and report DONE_WITH_CONCERNS with the printed `seed_value` (Global Constraints: disagreements).

- [ ] **Step 7: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `184 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 8: Commit (ACE-Step stays running)**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/query_seed_list_success.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git commit -m "test(spike): seed and use_random_seed behaviour"
```

### Task 9: Cover and extend semantics on a source

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/query_cover_success.json`, `query_extend_success.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (append)

**Interfaces:**
- Consumes: the running ACE-Step (turbo), and `synth-a-minor-90` (30 s) from `sources`. The source is uploaded as multipart `src_audio`.
- Produces run records:
  - `cover-turbo-30`: cover, strength 0.6.
  - `extend-turbo-25-45`: repaint from 25 s to 45 s, past the 30 s end of the source.
  - `repaint-turbo-10-end`: repaint from 10 s with `repainting_end=-1`.
  - `repaint-turbo-10-20`: repaint from 10 s to 20 s.
- Answers:
  - How long is a cover?
  - Does a repaint window that ends past the source extend it, and is the audio before `repainting_start` preserved?
  - What does `-1` mean?

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

- [ ] **Step 2: Write the failing fixture tests**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_a_cover_returns_both_variants():
    item = query_item("query_cover_success")
    assert item.status == 1
    assert len(item.result) == 2


def test_an_extend_repaint_succeeds():
    item = query_item("query_extend_success")
    assert item.status == 1
    assert item.result
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `2 failed, 22 passed`, each failure a `FileNotFoundError`.

- [ ] **Step 4: Cover, extend and the two repaints**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label cover-turbo-30 --task-type cover --src synth-a-minor-90 --cover-strength 0.6 --batch 2 --save-final query_cover_success)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label extend-turbo-25-45 --task-type repaint --src synth-a-minor-90 --repaint-start 25 --repaint-end 45 --batch 2 --save-final query_extend_success)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label repaint-turbo-10-end --task-type repaint --src synth-a-minor-90 --repaint-start 10 --repaint-end -1 --batch 2)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label repaint-turbo-10-20 --task-type repaint --src synth-a-minor-90 --repaint-start 10 --repaint-end 20 --batch 2)
```

Expected: four `status=1` lines. Copy the `outputs=[…]` lengths into the ledger under "Task 9". For example, a 45 s output from `extend-turbo-25-45` means the window extends the source.

If a run ends with `status=2`, the CLI prints `expected status 1; no fixtures were saved` and exits 3. The run record, including `error` and `progress_text`, is still appended to the runs file.
- Copy the printed lines into the ledger.
- Also copy the output of the command below, with `cover-turbo-30` replaced by the label that failed.
- Run the remaining commands, then report DONE_WITH_CONCERNS after the gate.

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike query "$(.venv/bin/python -m tools.acestep_spike task-id cover-turbo-30)")
```

- [ ] **Step 5: Check what was kept from the source**

The audio before `repainting_start` should be close to the source if the repaint preserves it. Compare the first 10 s (or 25 s for the extend) of each variant with the same span of the source, and compare the cover against the whole source.

```bash
cd song-remix-backend
SRC=data/spike/sources/synth-a-minor-90.wav
echo "extend: 0-25 s vs source"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/extend-turbo-25-45/0.flac --start 0 --end 25 --other-start 0 --other-end 25
echo "repaint 10-end: 0-10 s vs source"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/repaint-turbo-10-end/0.flac --start 0 --end 10 --other-start 0 --other-end 10
echo "repaint 10-20: 0-10 s vs source"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/repaint-turbo-10-20/0.flac --start 0 --end 10 --other-start 0 --other-end 10
echo "repaint 10-20: 20-30 s vs source"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/repaint-turbo-10-20/0.flac --start 20 --end 30 --other-start 20 --other-end 30
echo "repaint 10-20: 10-20 s vs source (the repainted window)"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/repaint-turbo-10-20/0.flac --start 10 --end 20 --other-start 10 --other-end 20
echo "cover vs source"
.venv/bin/python -m tools.acestep_spike compare "$SRC" data/spike/runs/cover-turbo-30/0.flac
cd ..
```

Expected: six `difference_db=…` lines; copy them with their captions into the ledger.
- Read a preserved span as roughly −20 dB or lower and the repainted window as roughly −6 dB or higher.
- Values in between mean that the span is re-encoded but similar, which is a finding for P1b's extend UI.
- Also listen to `extend-turbo-25-45/0.flac` around the 25 s mark. Write "audible seam" or "no audible seam" in the ledger.

- [ ] **Step 6: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `26 passed`.

- [ ] **Step 7: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `188 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 8: Commit (ACE-Step stays running)**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/query_cover_success.json song-remix-backend/tests/fixtures/acestep/query_extend_success.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git commit -m "test(spike): cover and extend semantics on a synthesized source"
```

### Task 10: `full_analysis_only` on three sources

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/query_full_analysis_success.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (append)

**Interfaces:**
- Consumes: the running ACE-Step (turbo), the three synthesized sources, and the optional `REAL_SOURCE_AUDIO` from the controller.
- Produces:
  - Run records `analysis-synth-a-minor-90`, `analysis-synth-c-major-120`, `analysis-synth-e-minor-140`, plus `analysis-real-N` for each real file.
  - Each record's `analysis` holds what ACE-Step reported (`bpm`, `keyscale`, `timesignature`, `duration`, `genre`, `language`, `prompt`).
  - For synthesized sources, `analysis` also holds `bpm_error` (reported minus true BPM) and `key_match` (case-insensitive equality with the true key).
  - Real sources have no ground truth; their lyrics are redacted and only their labels are recorded.

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

- [ ] **Step 2: Write the failing fixture test**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_full_analysis_returns_one_summary_item():
    item = query_item("query_full_analysis_success")
    assert item.status == 1
    [summary] = item.result
    assert summary["status_message"] == "Full Hardware Analysis Success"
    assert {"bpm", "keyscale", "timesignature", "duration"} <= set(summary)
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `1 failed, 26 passed`, the failure a `FileNotFoundError` for `query_full_analysis_success.json`.

- [ ] **Step 4: Analyse the synthesized sources**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label analysis-synth-a-minor-90 --src synth-a-minor-90 --batch 1 --param full_analysis_only=true)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label analysis-synth-c-major-120 --src synth-c-major-120 --batch 1 --param full_analysis_only=true --save-final query_full_analysis_success)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label analysis-synth-e-minor-140 --src synth-e-minor-140 --batch 1 --param full_analysis_only=true)
```

Expected: three `status=1 … outputs=[]` lines (an analysis has no audio), and `saved fixture query_full_analysis_success.json` after the second.

- [ ] **Step 5: Analyse the real sources, if the controller provided any**

`REAL_SOURCE_AUDIO` must be exported in this shell when the controller passed it on. Without it, the loop does nothing.

```bash
cd song-remix-backend
for LABEL in $(.venv/bin/python -m tools.acestep_spike sources | cut -f1 | grep '^real-'); do
  .venv/bin/python -m tools.acestep_spike run --label "analysis-$LABEL" --src "$LABEL" --batch 1 --param full_analysis_only=true
done
cd ..
```

Expected: one `analysis-real-N: status=1 …` line per real file, or no output. Real sources never get a fixture.

- [ ] **Step 6: Look at the accuracy table**

Run: `cd song-remix-backend && .venv/bin/python -m tools.acestep_spike report`
Expected: a "full_analysis_only" table with one row per analysis run. Copy it into the ledger under "Task 10".

- [ ] **Step 7: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `28 passed`.

- [ ] **Step 8: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `190 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 9: Check that nothing from the real files leaked, then commit (ACE-Step stays running)**

```bash
git status --short
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/query_full_analysis_success.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git diff --cached --stat
```

- `git status --short` must not list any audio file.
- If real sources were analysed, read `git diff --cached` once. Records of real sources name them only as `real-N`; they carry ACE-Step's analysis fields and no lyrics.
- If a real file name or a line of lyrics appears anywhere, stop and report BLOCKED instead of committing.
- Otherwise:

```bash
git commit -m "test(spike): full_analysis_only accuracy on synthesized and real sources"
```

### Task 11: Result persistence across an ACE-Step restart

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/query_after_restart.json`, `query_interrupted_after_restart.json`
- Not committed: `song-remix-backend/data/spike/restart-test.txt`, `song-remix-backend/data/spike/logs/acestep-turbo-restart.log`

**Interfaces:**
- Consumes:
  - The `t2m-turbo-30-a` run from Task 6, a task that finished before the restart.
  - A new 180 s task that is interrupted mid-run.
- Produces evidence for spec §3.4 (stale running entries) and §6.5 (persistence):
  - After a restart, does a finished task still answer with `status 1`?
  - Can its audio still be downloaded?
  - What does an interrupted task look like?

- [ ] **Step 1: Make sure ACE-Step (turbo) is running**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 30) || {
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  mkdir -p song-remix-backend/data/spike/logs
  nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
}
```

- [ ] **Step 2: Write the failing fixture tests**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_a_finished_task_survives_a_restart():
    item = query_item("query_after_restart")
    assert item.status == 1
    assert len(item.result) == 2
    assert all(variant["file"] for variant in item.result)


def test_an_interrupted_task_stays_pending_after_a_restart():
    item = query_item("query_interrupted_after_restart")
    assert item.status == 0
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `2 failed, 28 passed`, each failure a `FileNotFoundError`.

- [ ] **Step 4: Start a long task and wait until it is generating**

```bash
cd song-remix-backend
.venv/bin/python -m tools.acestep_spike task-id t2m-turbo-30-a
.venv/bin/python -m tools.acestep_spike submit --duration 180 --batch 2 | tee data/spike/restart-test.txt
INTERRUPTED=$(sed -n '1s/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/restart-test.txt)
.venv/bin/python -m tools.acestep_spike wait-progress "$INTERRUPTED"
cd ..
```

Expected:
- The id of `t2m-turbo-30-a`.
- `#1 HTTP 200 task_id=<id> status=queued queue_position=…`.
- `<id> progress=… stage=…`.

- [ ] **Step 5: Restart ACE-Step while the task is running**

```bash
pkill -f "[a]cestep-api --host" || true
for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
pkill -9 -f "[a]cestep-api --host" || true
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
nohup make acestep > song-remix-backend/data/spike/logs/acestep-turbo-restart.log 2>&1 &
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
```

Expected: `ready after … model=acestep-v15-turbo lm=acestep-5Hz-lm-1.7B`.

- [ ] **Step 6: Query both tasks after the restart**

The fixture is saved before the download is attempted, so a missing audio file still leaves the evidence.

```bash
cd song-remix-backend
FINISHED=$(.venv/bin/python -m tools.acestep_spike task-id t2m-turbo-30-a)
INTERRUPTED=$(sed -n '1s/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/restart-test.txt)
.venv/bin/python -m tools.acestep_spike query "$FINISHED" --save query_after_restart
.venv/bin/python -m tools.acestep_spike query "$INTERRUPTED" --save query_interrupted_after_restart
.venv/bin/python -m tools.acestep_spike query "$FINISHED" --download after-restart || echo "download after restart failed"
cd ..
```

Expected:
- `<finished id> status=1 items=2 stage=succeeded …`, then `saved fixture query_after_restart.json`.
- `<interrupted id> status=0 …`, then `saved fixture query_interrupted_after_restart.json`.
- Two `downloaded runs/after-restart/<id>/0.flac (30.0 s)` lines (and `1.flac`), or `download after restart failed` with an `AceStepError` above it.

Copy all of the lines into the ledger under "Task 11".

- [ ] **Step 7: Check that the interrupted entry is frozen**

```bash
sleep 120
cd song-remix-backend
INTERRUPTED=$(sed -n '1s/^#1 HTTP 200 task_id=\([^ ]*\) .*/\1/p' data/spike/restart-test.txt)
.venv/bin/python -m tools.acestep_spike query "$INTERRUPTED"
cd ..
```

Expected: the same `status`, `stage` and `progress` as in Step 6. Spec §3.4 says it only flips to `status 2` 3600 s after creation. Copy the line into the ledger.

- [ ] **Step 8: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `32 passed`.

- [ ] **Step 9: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `194 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 10: Commit (ACE-Step stays running)**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/query_after_restart.json song-remix-backend/tests/fixtures/acestep/query_interrupted_after_restart.json
git commit -m "test(spike): result persistence across an ACE-Step restart"
```

### Task 12: XL turbo timing and memory (and an optional 4B LM run)

**Files:**
- Modify: `song-remix-backend/tests/test_acestep_fixtures.py` (append)
- Recorded: `song-remix-backend/tests/fixtures/acestep/models_xl_turbo.json`
- Recorded: `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl` (append)
- Not committed: `song-remix-backend/data/spike/logs/acestep-xl-turbo.log`, `acestep-xl-turbo-lm4b.log`

**Interfaces:**
- Consumes: `make acestep ACESTEP_MODEL=…` (P0 Task 15) and `uv run acestep-download --model …` in `acestep/`.
- Produces:
  - Run records `t2m-xl-30-a`, `t2m-xl-30-b`, `t2m-xl-180`, `t2m-xl-30-thinking` and `cover-xl-30`.
  - Optionally `t2m-xl-lm4b-30-thinking`.
  - ACE-Step stopped at the end.

- [ ] **Step 1: Write the failing fixture test**

Append to `song-remix-backend/tests/test_acestep_fixtures.py`:

```python


def test_models_lists_the_xl_turbo_task_types():
    inventory = unwrap(response("models_xl_turbo")["json"])
    xl = next(model for model in inventory["models"] if model["name"] == "acestep-v15-xl-turbo")
    assert xl["is_loaded"] is True
    assert TURBO_TASK_TYPES <= set(xl["supported_task_types"])
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `1 failed, 32 passed`, the failure a `FileNotFoundError` for `models_xl_turbo.json`.

- [ ] **Step 3: Stop turbo and download XL turbo (about 10 GB)**

```bash
pkill -f "[a]cestep-api --host" || true
for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
pkill -9 -f "[a]cestep-api --host" || true
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
(cd acestep && uv run acestep-download --model acestep-v15-xl-turbo)
ls "$ACESTEP_CHECKPOINTS_DIR"
df -h "$HOME"
```

Expected: the listing now also contains `acestep-v15-xl-turbo`. Note the free space in the ledger.

- [ ] **Step 4: Start XL turbo + 1.7B and record the model inventory**

```bash
export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
nohup make acestep ACESTEP_MODEL=acestep-v15-xl-turbo > song-remix-backend/data/spike/logs/acestep-xl-turbo.log 2>&1 &
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike snapshot models --save models_xl_turbo)
rg -n "MLX|MPS|mps|fall(ing)? back|non-fatal" song-remix-backend/data/spike/logs/acestep-xl-turbo.log | head -n 40
```

Expected:
- `ready after … model=acestep-v15-xl-turbo lm=acestep-5Hz-lm-1.7B`.
- The inventory JSON, then `saved fixture models_xl_turbo.json`.
- The backend lines, which go into the ledger under "Task 12 MLX lines".

- [ ] **Step 5: Measure XL turbo**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-xl-30-a --duration 30 --batch 2)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-xl-30-b --duration 30 --batch 2)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-xl-180 --duration 180 --batch 2)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-xl-30-thinking --duration 30 --batch 2 --param thinking=true)
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label cover-xl-30 --task-type cover --src synth-a-minor-90 --cover-strength 0.6 --batch 2)
```

Expected: five `status=1` lines with a `peak=…GiB` each.

- [ ] **Step 6: Decide whether the 4B LM fits**

```bash
cd song-remix-backend
.venv/bin/python -c "
import json, sys
records = [json.loads(line) for line in open('../docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl', encoding='utf-8')]
memory = [r for r in records if r['label'] == 't2m-xl-180'][-1]['memory']
peak = memory['lifetime_peak_bytes'] / 1024**3
swap = (memory['swap_after_bytes'] - memory['swap_before_bytes']) / 1024**3
fits = peak < 40 and swap < 1
print(f'peak={peak:.1f}GiB swap_delta={swap:.2f}GiB', 'RUN_4B' if fits else 'SKIP_4B')
sys.exit(0 if fits else 1)
" && touch data/spike/run-4b || rm -f data/spike/run-4b
cd ..
```

Expected: `peak=…GiB swap_delta=…GiB RUN_4B` or `… SKIP_4B`. Copy the line into the ledger.

- [ ] **Step 7: Optional — XL turbo with the 4B LM (only after `RUN_4B`)**

```bash
if [ -f song-remix-backend/data/spike/run-4b ]; then
  pkill -f "[a]cestep-api --host" || true
  for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
  pkill -9 -f "[a]cestep-api --host" || true
  export ACESTEP_CHECKPOINTS_DIR="$HOME/.cache/audio-remix-lab/acestep-checkpoints"
  (cd acestep && uv run acestep-download --model acestep-5Hz-lm-4B)
  nohup make acestep ACESTEP_MODEL=acestep-v15-xl-turbo ACESTEP_LM_MODEL=acestep-5Hz-lm-4B > song-remix-backend/data/spike/logs/acestep-xl-turbo-lm4b.log 2>&1 &
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike wait-ready --timeout 1800)
  (cd song-remix-backend && .venv/bin/python -m tools.acestep_spike run --label t2m-xl-lm4b-30-thinking --duration 30 --batch 2 --param thinking=true)
else
  echo "skipped the 4B LM run"
fi
```

Expected: `ready after … model=acestep-v15-xl-turbo lm=acestep-5Hz-lm-4B` and one `status=1` line, or `skipped the 4B LM run`.

- [ ] **Step 8: Stop ACE-Step**

```bash
pkill -f "[a]cestep-api --host" || true
for i in $(seq 1 30); do pgrep -f "[a]cestep-api --host" > /dev/null || break; sleep 1; done
pkill -9 -f "[a]cestep-api --host" || true
pgrep -f "[a]cestep-api --host" || echo "ACE-Step stopped"
```

Expected: `ACE-Step stopped`.

- [ ] **Step 9: Run the fixture tests to verify they pass**

Run: `cd song-remix-backend && .venv/bin/pytest -q tests/test_acestep_fixtures.py`
Expected: `34 passed`.

- [ ] **Step 10: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `196 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 11: Commit**

```bash
git add song-remix-backend/tests/test_acestep_fixtures.py song-remix-backend/tests/fixtures/acestep/models_xl_turbo.json docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl
git commit -m "test(spike): XL turbo timing and memory"
```

### Task 13: Findings document for P1b

**Files:**
- Create: `docs/superpowers/spikes/2026-10-31-acestep-contract.md`
- Not committed: `song-remix-backend/data/spike/report.md`, `machine.md`, `fixtures.md`

**Interfaces:**
- Consumes:
  - The run records.
  - The fixtures.
  - The ledger notes from Tasks 5–12: MLX lines, failure attempts, the queued/unknown comparison, seeds, comparisons, the extend seam, restart behaviour and the 4B decision.
- Produces the contract document that the P1b plan is written from. It contains:
  - A summary of the decisions.
  - The measurement tables.
  - Answers to 17 questions, each with evidence.
  - Spec corrections.
  - The fixture index.

ACE-Step stays stopped in this task.

- [ ] **Step 1: Generate the tables**

```bash
(cd song-remix-backend && .venv/bin/python -m tools.acestep_spike report --output data/spike/report.md)
{
  printf -- '- Machine: %s, %s GB RAM, macOS %s\n' "$(sysctl -n machdep.cpu.brand_string)" "$(( $(sysctl -n hw.memsize) / 1073741824 ))" "$(sw_vers -productVersion)"
  printf -- '- ACE-Step: v0.1.8 (`%s`), started with `make acestep`; %s\n' "$(git -C acestep rev-parse --short HEAD)" "$(uv --version)"
  printf -- '- Records: %s runs in `docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl`, %s fixtures in `song-remix-backend/tests/fixtures/acestep/`\n' "$(wc -l < docs/superpowers/spikes/2026-10-31-acestep-runs.jsonl | tr -d ' ')" "$(ls song-remix-backend/tests/fixtures/acestep/*.json | wc -l | tr -d ' ')"
} > song-remix-backend/data/spike/machine.md
cd song-remix-backend
.venv/bin/python - <<'EOF'
import json
from pathlib import Path

rows = ["| Fixture | Request | HTTP | Recorded with |", "|---|---|---|---|"]
for path in sorted(Path("tests/fixtures/acestep").glob("*.json")):
    fixture = json.loads(path.read_text(encoding="utf-8"))
    request, recorded = fixture["request"], fixture["recorded_with"]
    rows.append(
        f"| `{path.stem}` | `{request['method']} {request['path']}` | {fixture['response']['status_code']} "
        f"| {recorded['model']} + {recorded['lm_model']}, {recorded['recorded_on']} |"
    )
Path("data/spike/fixtures.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
print(f"wrote {len(rows) - 2} fixture rows")
EOF
cd ..
```

Expected: `wrote data/spike/report.md` and `wrote 17 fixture rows`.

- [ ] **Step 2: Create the document from the template**

Create `docs/superpowers/spikes/2026-10-31-acestep-contract.md`:

````markdown
# ACE-Step v0.1.8 contract — P1a spike findings

This is what ACE-Step v0.1.8 actually did on the M4 Max, recorded by the P1a spike. P1b's engine client, timeouts and fixtures follow it. Where it disagrees with the spec, see "Spec corrections".

<paste data/spike/machine.md>

## Summary for P1b

<answer: 4–8 bullets, one decision each. Cover the default model and LM, the generation timeout, the poll interval, how to detect failure and read its reason, how to treat status 0 with an empty result, seeds, and how to request an extend.>

## Measurements

- **Wall s:** from submit to the final poll.
- **First progress s:** the time to the first poll with `progress > 0`.
- **Peak GiB:** the highest sum of `phys_footprint` over the ACE-Step processes during the run.
- **Lifetime peak GiB:** the highest sum of their `phys_footprint_peak`, the peak since each process started.
- **Swap delta GiB:** the change in `vm.swapusage` used, from before the run to after it.
- **Output s:** the length of each downloaded variant.

<paste data/spike/report.md>

## Answers

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Do the DiT and VAE run on MLX, or fall back to PyTorch/MPS, for turbo and XL turbo? | <answer> | <evidence> |
| 2 | Are models read from and downloaded to `ACESTEP_CHECKPOINTS_DIR`? | <answer> | <evidence> |
| 3 | Which responses are wrapped in `{data, code, …}` and which are not (including 429)? | <answer> | <evidence> |
| 4 | Where does a failed task's reason appear (`error`, `progress_text`, nowhere), and what is the text? | <answer> | <evidence> |
| 5 | When does `/release_task` answer 429, and with which body? | <answer> | <evidence> |
| 6 | Can a queued task be told apart from an unknown id? | <answer> | <evidence> |
| 7 | Which fields change while a task runs (`progress`, `stage`, `progress_text`), and how often? | <answer> | <evidence> |
| 8 | Is a fixed seed reproducible? Do batch variants differ? Does a seed list set one seed per variant? Is `seed` ignored when `use_random_seed=true`? | <answer> | <evidence> |
| 9 | Are `seed_value`, `dit_model`, `lm_model` and `generation_info` present on success, and what do they contain? | <answer> | <evidence> |
| 10 | How long is a cover of a 30 s source, and how far does strength 0.6 move from the source? | <answer> | <evidence> |
| 11 | Does a repaint window that ends past the source extend it? Is the audio before `repainting_start` preserved? Is the seam audible? | <answer> | <evidence> |
| 12 | What does `repainting_end=-1` do? | <answer> | <evidence> |
| 13 | How accurate are the `full_analysis_only` BPM and key on the synthesized sources (and plausible on real ones)? | <answer> | <evidence> |
| 14 | After a restart: do finished results and their audio survive, and what does an interrupted task report (immediately and after 120 s)? | <answer> | <evidence> |
| 15 | How much memory headroom is left with turbo and with XL turbo at 180 s, batch 2, and did swap grow? | <answer> | <evidence> |
| 16 | How long do 30 s and 180 s at batch 2 take on turbo and XL turbo, what does `thinking=true` add, and what generation timeout follows (spec §3.4 caps it below 3600 s)? | <answer> | <evidence> |
| 17 | Which DiT and LM should P1b default to, and should XL turbo be offered? | <answer> | <evidence> |

## Spec corrections

<answer: one bullet per spec statement that the engine contradicted, as "§N: the spec says … ; the engine did … (evidence)". Write "None." if there are none.>

## Fixture index

<paste data/spike/fixtures.md>
````

- [ ] **Step 3: Paste the generated tables into the document**

```bash
cd song-remix-backend
.venv/bin/python - <<'EOF'
from pathlib import Path

doc = Path("../docs/superpowers/spikes/2026-10-31-acestep-contract.md")
text = doc.read_text(encoding="utf-8")
for name in ("machine.md", "report.md", "fixtures.md"):
    marker = f"<paste data/spike/{name}>\n"
    assert text.count(marker) == 1, marker
    text = text.replace(marker, Path("data/spike", name).read_text(encoding="utf-8"))
doc.write_text(text, encoding="utf-8")
print("pasted machine.md, report.md and fixtures.md")
EOF
cd ..
```

Expected: `pasted machine.md, report.md and fixtures.md`.

- [ ] **Step 4: Write the answers**

Edit the document and replace every `<answer…>` and `<evidence>` slot.
- **Evidence:**
  - Name fixtures in backticks (`query_failure`).
  - Name run labels in backticks (`t2m-turbo-180`), so that a reader can find the line in the runs file.
  - Quote ledger output verbatim, in a short code span or a fenced block below the table.
  - "Not observed" is an acceptable answer when the evidence says so, for example question 5 if the queue never filled.
- **Numbers:** quote them exactly as the report shows them; don't round them again.
- **Question 16, the timeout:** propose a generation timeout. Take the slowest measured 180 s run (wall time), multiply it by 1.5 and round up to the next minute. If the result is 3600 s or more, cap it at 3300 s and say so.

- [ ] **Step 5: Check that no slot is left and nothing leaked**

```bash
if rg -n "<answer|<evidence|<paste" docs/superpowers/spikes/2026-10-31-acestep-contract.md; then echo "slots left"; else echo "no slots left"; fi
if rg -n "/Users/|/var/folders/|$(whoami)" docs/superpowers/spikes/2026-10-31-acestep-contract.md; then echo "machine details left"; else echo "no machine details"; fi
```

Expected: `no slots left` and `no machine details`. If `machine details left` appears, replace those strings with `<HOME>`, `<TMP>` or `<USER>` by hand and run the check again.

- [ ] **Step 6: Run the gate**

Run: `cd song-remix-backend && .venv/bin/ruff check . && .venv/bin/pytest -q`
Expected: `All checks passed!` and `196 passed`.

Run: `cd song-remix-ui && npm test && npm run lint && npm run build`
Expected: `Tests  18 passed (18)`; lint and build pass.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/spikes/2026-10-31-acestep-contract.md
git commit -m "docs(spike): ACE-Step v0.1.8 contract findings for P1b"
```

---

## Phase completion (controller)

After Task 13's review passes, run these from the worktree:

1. `git log --oneline main..HEAD` lists 13 commits.
2. `git status --short` is empty, and `git diff --stat main..HEAD -- song-remix-backend/app song-remix-ui acestep` is empty, so no app code or submodule changed.
3. Both gates pass: backend `196 passed`, UI `Tests  18 passed (18)`, lint and build pass.
4. `ls song-remix-backend/tests/fixtures/acestep/*.json | wc -l` prints `17`.
5. `git ls-files | rg -i "\.(wav|flac|mp3|ogg|m4a)$"` prints nothing.
6. `pgrep -f "[a]cestep-api --host"` prints nothing.
7. Read the contract document end to end. For every answer, check that its evidence exists: the fixture file, the run label in the JSONL, or the ledger line.
8. Report to the user:
   - The summary bullets and the spec corrections.
   - Every task that ended DONE_WITH_CONCERNS.
   - The choice to merge `phase/1a-acestep-spike` into `main` before the P1b plan is written.

---

## Self-review

### How this plan was checked

- **Tool tasks (1–4).**
  - The tool code and tests in this plan were written and run first in a copy of the post-P0 tree (ruff clean, 44 tests).
  - The plan's blocks are those files verbatim.
  - Each "verify it fails" output was observed by applying the task's tests on top of the previous task.
- **Engine tasks (5–13).** A script replayed the whole plan in order on a clone of the replayed post-P0 tree (backend `118 passed`). It:
  - applied every "Create" and "Append to" block;
  - ran every `Run:` command and every bash block, including the commits;
  - checked the expected test counts after every task.
- **The fake ACE-Step.** It replaced the real one through a `make`/`uv` shim on `PATH`. It is a small FastAPI app that mimics v0.1.8's documented shapes:
  - the wrapped responses;
  - the 429 body;
  - `[]` for unknown ids;
  - cached failure items without `error`;
  - seed lists;
  - `full_analysis_only`;
  - state that survives a restart.
- **What the replay proves:**
  - Every command line in the plan parses and runs.
  - Each fixture is saved under the name its test reads.
  - The sanitizer leaves no machine path in any fixture or record.
  - A "real" source named `Private Artist - Secret Song.wav` never reaches a commit.
  - The counts below are exact.
- **What it does not prove:** anything about the real engine, including timing, memory, MLX, model downloads, and whether the spec's claims hold. That is what Tasks 5–12 are for.
- **The machine-only commands** (`df`, `ls` of the checkpoint directory, `git -C acestep`, the MLX log search) ran but their output was not checked. `sleep 120` was shortened in the replay.

### Requirement coverage

| Requirement | Task |
|---|---|
| Start ACE-Step locally on the M4 Max, first-run model downloads | 5 |
| Initial config: default turbo DiT + 1.7B LM | 5–11 |
| Then XL turbo | 12 (plus an optional 4B LM run, gated on measured memory) |
| Real calls, recorded as sanitized JSON fixtures under `song-remix-backend/tests/fixtures/acestep/` | 5–12 (sanitizer: 1; leak check on every fixture: 5) |
| Fixtures: success | 6 (text2music), 9 (cover, extend), 10 (analysis), 11 (after restart) |
| Fixtures: failure | 7 |
| Fixtures: running with progress | 6 |
| Fixtures: 429 if reproducible | 7 (`ACESTEP_QUEUE_MAXSIZE=1`) |
| Fixtures: `/v1/models`, `/health` | 5 (and `/v1/models` again for XL in 12) |
| Time and peak memory for 30 s and 180 s at batch 2 | 6 (turbo), 12 (XL turbo) |
| Extend semantics | 9 |
| `use_random_seed` / `seed` behaviour | 8 |
| `full_analysis_only` on 3 synthesized or user-provided sources (`REAL_SOURCE_AUDIO`, audio never committed) | 10; Global Constraints; phase completion check 5 |
| Result persistence across an ACE-Step restart | 11 |
| Findings in `docs/superpowers/spikes/2026-10-31-acestep-contract.md` | 13 |
| Executed by an implementer, verified by the controller | Controller setup, the per-task review, phase completion |

### Placeholder scan

`rg -n -i "\bTBD\b|\bTODO\b|FIXME|implement later|similar to task|fill in"` over this file prints only this line. The only slots are the `<answer>`, `<evidence>` and `<paste …>` markers inside the Task 13 template. They are filled from measured data, and Task 13 Step 5 fails while any remain.

### Name consistency

- **Tool:** `Sanitizer`, `REDACTED`, `AceStepClient`, `Exchange`, `AceStepError`, `QueueFull`, `QueryItem`, `parse_query`, `unwrap`, `wait_for_task`, `PollTrace`, `PeakMemorySampler`, `Footprint`, `SourceSpec`, `SYNTH_SOURCES`, `ensure_sources`, `find_source`, `difference_db`, `render`.
- **Commands:** `sources`, `wait-ready`, `snapshot`, `submit`, `query`, `run`, `wait-progress`, `task-id`, `compare`, `report`.
- **Run labels and fixture names:** as listed in each task and in "Fixtures by task". Tests read fixtures only through `response(name)`.

### Expected gate counts

| After task | Backend `pytest -q` | `tests/test_acestep_fixtures.py` | UI `npm test` |
|---|---|---|---|
| 1 | 124 passed | — | 18 passed |
| 2 | 132 passed | — | 18 passed |
| 3 | 144 passed | — | 18 passed |
| 4 | 162 passed | — | 18 passed |
| 5 | 168 passed | 6 passed | 18 passed |
| 6 | 174 passed | 12 passed | 18 passed |
| 7 | 182 passed | 20 passed | 18 passed |
| 8 | 184 passed | 22 passed | 18 passed |
| 9 | 188 passed | 26 passed | 18 passed |
| 10 | 190 passed | 28 passed | 18 passed |
| 11 | 194 passed | 32 passed | 18 passed |
| 12 | 196 passed | 34 passed | 18 passed |
| 13 | 196 passed | 34 passed | 18 passed |

How the fixture-test count grows:
- Every fixture adds one envelope test as well as its shape test.
- A fixture that the engine could not produce changes the counts. The likeliest cases are `query_queued` (Task 7) and a failure that no candidate provokes.
- That is a DONE_WITH_CONCERNS report, not a reason to edit tests.

### Known deviations and gaps

- **Committed tool.** `song-remix-backend/tools/acestep_spike/` and its tests are committed so that the fixtures can be re-recorded after an ACE-Step upgrade. Nothing in `app/` imports it, and the backend's runtime dependencies are unchanged.
- **Shape tests encode the spec's expectations.** For example, a seed list is echoed per variant, and an interrupted task stays at `status 0` after a restart. If the engine disagrees, the implementer reports DONE_WITH_CONCERNS and the test stays red until the controller decides. That blocks the commit for that task by design.
- **Failure provocation.** Spec §3.1 says that a cover without a source is accepted and then fails. Task 7 tries that first, then two other candidates, so that the failure fixture is recorded even if the spec is wrong about which one fails.
- **Memory numbers.** The sampler sums `phys_footprint` over every process whose command line contains `acestep-api` (the `make` shell, `uv` and the server), sampled once per second, so short spikes between samples are missed. `Lifetime peak` covers them, but it includes model loading and earlier runs. The machine already had about 25 GB of swap in use while this plan was written; the swap delta per run is recorded for that reason.
- **Analysis ground truth** exists only for the synthesized sources, which are simple: one triad per bar, bass, kick and hi-hat. Accuracy on them is an upper bound.
- **Network and disk.** Tasks 5 and 12 download roughly 30–40 GB of models and dependencies into `$HOME/.cache/audio-remix-lab/acestep-checkpoints` and `acestep/.venv`.
