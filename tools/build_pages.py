#!/usr/bin/env python3
"""Stage only public runtime files. Production builds require the verified score."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from fetch_music import SHA1, SIZE
from encode_music import encode_mp3

ROOT = Path(__file__).resolve().parents[1]
FILES = ('index.html', 'style.css', 'Aether-Orb-Odyssey.html', 'NOTICE.md')
TREES = ('src', 'shaders')

def stage(output: Path, *, allow_missing_music: bool = False, source: Path = ROOT,
          commit: str | None = None) -> dict:
    source, output = source.resolve(), output.resolve()
    if output != source / '_site':
        raise ValueError('Output must be the project-local _site directory; refusing arbitrary deletion.')
    music = source / 'assets' / 'zarathustra.ogg'
    music_present = music.is_file()
    if music_present:
        data = music.read_bytes()
        if len(data) != SIZE or hashlib.sha1(data).hexdigest() != SHA1:
            raise ValueError('The local score failed its documented size/SHA-1 verification.')
    elif not allow_missing_music:
        raise ValueError('The score is missing. Run python3 tools/fetch_music.py before publishing.')
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in FILES:
        p = source / name
        if p.is_symlink():
            raise ValueError(f'Refusing symlink: {name}')
        shutil.copy2(p, output / name)
    for name in TREES:
        for p in sorted((source / name).rglob('*')):
            if p.is_symlink():
                raise ValueError(f'Refusing symlink: {p}')
            if p.is_file():
                rel = p.relative_to(source)
                (output / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, output / rel)
    (output / 'assets').mkdir()
    if music_present:
        shutil.copy2(music, output / 'assets' / music.name)
        encode_mp3(music, output / 'assets' / 'zarathustra.mp3')
    if commit is None:
        result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=source, text=True,
                                capture_output=True, check=False)
        commit = result.stdout.strip() if result.returncode == 0 else 'uncommitted'
    contents = {}
    for path in sorted(output.rglob('*')):
        if path.is_file():
            data = path.read_bytes()
            contents[path.relative_to(output).as_posix()] = {
                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    manifest = {'schema': 1, 'project': 'AetherOrbOdyssey', 'commit': commit,
                'musicBundled': music_present, 'musicFormats': ['mp3', 'ogg'] if music_present else [], 'files': contents}
    (output / 'deployment.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-missing-music', action='store_true',
                        help='Local visual-only validation; NOT a production publication.')
    args = parser.parse_args()
    try:
        manifest = stage(ROOT / '_site', allow_missing_music=args.allow_missing_music)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        parser.exit(1, f'Pages build failed: {exc}\n')
    print(f"Staged {len(manifest['files'])} files; musicBundled={manifest['musicBundled']}; commit={manifest['commit']}")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
