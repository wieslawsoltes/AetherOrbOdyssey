#!/usr/bin/env python3
"""Produce the iPhone-compatible MP3 from the hash-verified credited recording."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from fetch_music import SHA1, SIZE


def probe(path: Path) -> dict:
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                             '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration',
                             '-of', 'json', str(path)], capture_output=True, text=True,
                            check=True, timeout=30)
    return json.loads(result.stdout)


def encode_mp3(source: Path, destination: Path) -> None:
    """Fail closed: never publish a different recording, empty encode, or truncated encode."""
    data = source.read_bytes()
    if len(data) != SIZE or hashlib.sha1(data).hexdigest() != SHA1:
        raise ValueError('MP3 source failed recording size/SHA-1 verification.')
    if not all(shutil.which(tool) for tool in ('ffmpeg', 'ffprobe')):
        raise ValueError('MP3 publication needs ffmpeg and ffprobe. Install FFmpeg and rebuild.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.part')
    try:
        subprocess.run([
            'ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', str(source),
            '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame',
            '-q:a', '2', '-ar', '44100', '-ac', '2', '-id3v2_version', '3',
            '-metadata', 'title=Also Sprach Zarathustra - Einleitung',
            '-metadata', 'artist=Kevin MacLeod', '-metadata', 'composer=Richard Strauss',
            '-metadata', 'copyright=CC BY 3.0; https://creativecommons.org/licenses/by/3.0/',
            '-metadata', 'comment=Transcoded from the credited Wikimedia Commons Ogg; see NOTICE.md',
            '-write_xing', '1', '-f', 'mp3', str(temporary)
        ], check=True, timeout=120)
        original, encoded = probe(source), probe(temporary)
        stream = encoded['streams'][0]
        duration = float(encoded['format']['duration'])
        if (stream.get('codec_name') != 'mp3' or stream.get('channels') != 2
                or stream.get('sample_rate') != '44100' or duration <= 0
                or abs(duration - float(original['format']['duration'])) > .2
                or temporary.stat().st_size < 10000):
            raise ValueError('MP3 compatibility encode failed codec/duration/size validation.')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
