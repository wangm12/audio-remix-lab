#!/usr/bin/env python3
"""Prepare the shared checkpoint directory and the pinned API's local alias."""

from __future__ import annotations

import sys
from pathlib import Path


def prepare(acestep_dir: Path, requested_cache: Path) -> Path:
    checkout = acestep_dir.expanduser().resolve()
    cache = requested_cache.expanduser().resolve()
    alias = checkout / "checkpoints"

    if cache == alias or alias in cache.parents:
        raise ValueError(f"checkpoint cache must not be the same as or nested under {alias}")

    if alias.is_symlink():
        if alias.resolve() != cache:
            raise ValueError(f"{alias} already points to a different target; resolve it manually before continuing")
    elif alias.exists():
        raise ValueError(f"{alias} already exists and is not a symlink; move it manually before continuing")

    cache.mkdir(parents=True, exist_ok=True)
    if not alias.is_symlink():
        try:
            alias.symlink_to(cache, target_is_directory=True)
        except FileExistsError as exc:
            raise ValueError(f"{alias} appeared during setup; inspect it manually before continuing") from exc
    return cache


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: prepare_acestep_checkpoints.py ACESTEP_DIR CACHE_DIR", file=sys.stderr)
        return 2
    try:
        print(prepare(Path(sys.argv[1]), Path(sys.argv[2])))
    except (OSError, ValueError) as exc:
        print(f"ACE-Step checkpoint setup failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
