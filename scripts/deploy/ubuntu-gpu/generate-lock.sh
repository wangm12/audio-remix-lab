#!/usr/bin/env bash
set -Eeuo pipefail

# Regenerate the Linux/Python 3.12 CUDA 12.6 ACE deployment lock with uv 0.13.6.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root/acestep"
uv pip compile \
  --python-version 3.12 \
  --python-platform x86_64-manylinux_2_28 \
  --no-annotate \
  --no-header \
  --constraints ../scripts/deploy/ubuntu-gpu/constraints.txt \
  --overrides ../scripts/deploy/ubuntu-gpu/overrides.txt \
  --output-file ../ace-cu126-linux-py312.lock \
  ../scripts/deploy/ubuntu-gpu/requirements.in
