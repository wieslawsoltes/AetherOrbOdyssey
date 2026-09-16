"""Real encoder tests use a temporary generated fixture, NEVER the credited score."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import encode_music

class EncodeTests(unittest.TestCase):
    def test_wrong_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'source.ogg';source.write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError,'verification'):
                encode_music.encode_mp3(source,root/'score.mp3')
            self.assertFalse((root/'score.mp3').exists())

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg required')
    def test_real_transcode_is_stereo_mp3_and_duration_aligned(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'fixture.ogg';destination=root/'fixture.mp3'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',
                            'sine=frequency=440:duration=4','-c:a','libvorbis',str(source)],check=True)
            data=source.read_bytes()
            # Override trust anchors ONLY in this test for this generated temporary fixture.
            with patch.object(encode_music,'SIZE',len(data)),patch.object(encode_music,'SHA1',hashlib.sha1(data).hexdigest()):
                encode_music.encode_mp3(source,destination)
            metadata=encode_music.probe(destination)
            self.assertEqual(metadata['streams'][0]['codec_name'],'mp3')
            self.assertEqual(metadata['streams'][0]['channels'],2)
            self.assertLess(abs(float(metadata['format']['duration'])-4),.2)
            self.assertFalse(destination.with_name(destination.name+'.part').exists())

    def test_missing_encoder_is_actionable(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'source.ogg'; source.write_bytes(b'fixture')
            with patch.object(encode_music,'SIZE',7),patch.object(encode_music,'SHA1',hashlib.sha1(b'fixture').hexdigest()),patch.object(encode_music.shutil,'which',return_value=None):
                with self.assertRaisesRegex(ValueError,'Install FFmpeg'):
                    encode_music.encode_mp3(source,root/'score.mp3')
