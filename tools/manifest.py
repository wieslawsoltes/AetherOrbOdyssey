#!/usr/bin/env python3
"""Create/check the complete source tree's SHA-256 inventory (stdlib only)."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {'.git', '_site', '__pycache__', 'node_modules', 'capture', '.pytest_cache'}
SKIP_NAMES = {'MANIFEST.json', '.DS_Store', 'zarathustra.ogg'}

def inventory(root: Path = ROOT) -> dict:
    files = {}
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.name in SKIP_NAMES or path.suffix in {'.pyc', '.part', '.bundle'}:
            continue
        if path.name == '.env' or path.name.startswith('.env.'):
            continue
        if path.is_symlink():
            raise ValueError(f'Symlinks are not accepted in the source inventory: {rel}')
        if path.is_file():
            data = path.read_bytes()
            files[rel.as_posix()] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    return files

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['write', 'check'])
    args = parser.parse_args()
    manifest = ROOT / 'MANIFEST.json'
    actual = inventory()
    if args.command == 'write':
        manifest.write_text(json.dumps(actual, indent=2) + '\n', encoding='utf-8')
        print(f'Wrote {len(actual)} source hashes.')
        return 0
    expected = json.loads(manifest.read_text(encoding='utf-8'))
    changed = sorted(k for k in expected.keys() | actual.keys() if expected.get(k) != actual.get(k))
    if changed:
        for name in changed:
            print(f'MANIFEST MISMATCH: {name}')
        print('After reviewing intentional changes, run python3 tools/manifest.py write.')
        return 1
    print(f'Verified {len(actual)} source files; no missing, changed, or untracked source files.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
