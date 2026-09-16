#!/usr/bin/env python3
"""Download the credited Kevin MacLeod recording, verify it, and install atomically.
The SHA-1 is a content-integrity check against Commons, not a signature of trust.
Python standard library only. No credentials or account are required.
"""
from __future__ import annotations
import argparse
import hashlib
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Also_Sprach_Zarathustra_-_Einleitung.ogg'
SHA1 = 'ab5a1863b4fead3069445bdbcfd0f62ecfd09481'
SIZE = 4_307_636

def fetch_music(destination: Path = ROOT / 'assets' / 'zarathustra.ogg') -> Path:
    if destination.is_file() and hashlib.sha1(destination.read_bytes()).hexdigest() == SHA1:
        print(f'Score already verified: {destination}')
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.ogg.part')
    request = urllib.request.Request(URL, headers={'User-Agent': 'AetherOrbOdyssey/2.0 (credited CC-BY-3.0 music download)'})
    digest, total = hashlib.sha1(), 0
    try:
        with urllib.request.urlopen(request, timeout=45) as response, temporary.open('wb') as output:
            while chunk := response.read(64 * 1024):
                output.write(chunk)
                digest.update(chunk)
                total += len(chunk)
                if total > 12_000_000:
                    raise ValueError('Unexpected audio response size.')
        if total != SIZE or digest.hexdigest() != SHA1:
            raise ValueError('Recording does not match the documented Commons file. Existing audio was not replaced.')
        temporary.replace(destination)
        print(f'Installed {total:,} bytes: {destination}')
        print('Also Sprach Zarathustra — Einleitung. Richard Strauss / Kevin MacLeod. CC BY 3.0.')
        return destination
    finally:
        temporary.unlink(missing_ok=True)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'assets'/'zarathustra.ogg')
    args = parser.parse_args()
    try:
        fetch_music(args.output)
        return 0
    except (OSError, ValueError) as exc:
        print(f'Score download failed: {exc}', file=sys.stderr)
        print('The film can also fetch its score in the browser, or use Choose audio.', file=sys.stderr)
        return 1
if __name__ == '__main__':
    sys.exit(main())
