#!/usr/bin/env bash
# Use the owner's authenticated local GitHub CLI; never paste tokens into ChatGPT.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
exec python3 tools/publish_github.py "$@"
