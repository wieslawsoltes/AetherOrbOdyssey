#!/usr/bin/env python3
"""Verify the deployed revision and every published runtime byte, including music."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import PurePosixPath
import time
import urllib.parse
import urllib.request

MAX_FILE_BYTES = 16 * 1024 * 1024

def read(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        'User-Agent': 'AetherOrbOdyssey-PublicationCheck/1.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = response.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise ValueError('Unexpectedly large published asset.')
        return data

def verify(base: str, commit: str, *, allow_missing_music: bool = False) -> int:
    base = base.rstrip('/') + '/'
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in {'http', 'https'} or parsed.query or parsed.fragment:
        raise ValueError('Site URL must be an HTTP(S) directory URL without a query or fragment.')
    if parsed.scheme != 'https' and parsed.hostname not in {'localhost', '127.0.0.1'}:
        raise ValueError('Public publication verification requires HTTPS.')
    stamp = int(time.time() * 1000)
    manifest = json.loads(read(base + f'deployment.json?revision={commit}&t={stamp}'))
    if manifest.get('project') != 'AetherOrbOdyssey' or manifest.get('schema') != 1:
        raise ValueError('Wrong deployment identity.')
    if manifest.get('commit') != commit:
        raise ValueError(f"Published revision {manifest.get('commit')} does not match {commit}.")
    if not allow_missing_music and manifest.get('musicBundled') is not True:
        raise ValueError('Published site does not contain its verified music.')
    files = manifest.get('files', {})
    if not isinstance(files, dict) or not 10 <= len(files) <= 100:
        raise ValueError('Unexpected asset inventory.')
    required = {'index.html', 'style.css', 'src/app.js', 'shaders/scene.wgsl',
                'shaders/particles.wgsl', 'Aether-Orb-Odyssey.html', 'NOTICE.md'}
    if not allow_missing_music:
        required.update({'assets/zarathustra.ogg', 'assets/zarathustra.mp3', 'src/audio.js'})
    if not required.issubset(files):
        raise ValueError('Published site is missing required runtime files.')
    for name, expected in sorted(files.items()):
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or '?' in name or '#' in name:
            raise ValueError(f'Invalid published asset path: {name}')
        data = read(base + urllib.parse.quote(name, safe='/') + f'?revision={commit}')
        if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise ValueError(f'Published asset integrity failure: {name}')
    print(f"Verified {len(files)} published files at {base}; revision {commit}; music={manifest['musicBundled']}")
    return len(files)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--attempts', type=int, default=1)
    parser.add_argument('--allow-missing-music', action='store_true')
    args = parser.parse_args()
    for attempt in range(max(1, args.attempts)):
        try:
            verify(args.url, args.commit, allow_missing_music=args.allow_missing_music)
            return 0
        except (OSError, ValueError, KeyError) as exc:
            print(f'Publication check {attempt+1}/{args.attempts}: {exc}', flush=True)
            if attempt+1 < args.attempts:
                time.sleep(5)
    return 1

if __name__ == '__main__':
    raise SystemExit(main())
