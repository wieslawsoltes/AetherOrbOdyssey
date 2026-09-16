"""Real local HTTP/subpath checks. No external services, music fixtures or GPU claims."""
from __future__ import annotations
import functools
import http.server
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_pages import FILES, stage
from publish_github import normalized_remote
from verify_site import verify

COMMIT = '1234567890abcdef1234567890abcdef12345678'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class PagesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'project'
        self.source.mkdir()
        for name in FILES:
            shutil.copy2(ROOT / name, self.source / name)
        for name in ('src', 'shaders'):
            shutil.copytree(ROOT / name, self.source / name)
        (self.source / 'assets').mkdir()

    def build(self):
        return stage(self.source / '_site', source=self.source,
                     allow_missing_music=True, commit=COMMIT)

    def serve(self):
        public = Path(self.tmp.name) / 'public'
        public.mkdir(exist_ok=True)
        mount = public / 'AetherOrbOdyssey'
        shutil.copytree(self.source / '_site', mount)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                    functools.partial(QuietHandler, directory=str(public)))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def cleanup():
            server.shutdown()
            server.server_close()
            worker.join()
        self.addCleanup(cleanup)
        return f'http://127.0.0.1:{server.server_port}/AetherOrbOdyssey/', mount

    def test_production_build_requires_music(self):
        with self.assertRaisesRegex(ValueError, 'score is missing'):
            stage(self.source / '_site', source=self.source, commit=COMMIT)

    def test_corrupt_audio_is_rejected_even_in_preview(self):
        (self.source / 'assets' / 'zarathustra.ogg').write_bytes(b'not a licensed score')
        with self.assertRaisesRegex(ValueError, 'verification'):
            self.build()

    def test_build_refuses_arbitrary_output_deletion(self):
        with self.assertRaisesRegex(ValueError, 'refusing arbitrary deletion'):
            stage(self.source, source=self.source, allow_missing_music=True)

    def test_only_runtime_files_are_published(self):
        manifest = self.build()
        self.assertFalse(manifest['musicBundled'])
        self.assertEqual(manifest['commit'], COMMIT)
        self.assertIn('shaders/particles.wgsl', manifest['files'])
        self.assertFalse(any(part.startswith('.') for name in manifest['files'] for part in Path(name).parts))
        for forbidden in ('tools', '.git', 'tests', 'docs', 'README.md', 'MANIFEST.json'):
            self.assertFalse((self.source / '_site' / forbidden).exists())

    def test_all_assets_verify_under_github_project_subpath(self):
        manifest = self.build()
        url, _ = self.serve()
        self.assertEqual(verify(url, COMMIT, allow_missing_music=True), len(manifest['files']))

    def test_wrong_revision_is_rejected(self):
        self.build()
        url, _ = self.serve()
        with self.assertRaisesRegex(ValueError, 'does not match'):
            verify(url, 'wrong-commit', allow_missing_music=True)

    def test_tampered_shader_is_rejected(self):
        self.build()
        url, mount = self.serve()
        (mount / 'shaders' / 'scene.wgsl').write_text('bad shader', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'integrity failure'):
            verify(url, COMMIT, allow_missing_music=True)

    def test_unbundled_score_is_not_a_production_success(self):
        self.build()
        url, _ = self.serve()
        with self.assertRaisesRegex(ValueError, 'does not contain its verified music'):
            verify(url, COMMIT)

    def test_manifest_cannot_escape_site_directory(self):
        self.build()
        url, mount = self.serve()
        p = mount / 'deployment.json'
        manifest = json.loads(p.read_text())
        manifest['files']['../secret'] = {'bytes': 0, 'sha256': ''}
        p.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Invalid published asset path'):
            verify(url, COMMIT, allow_missing_music=True)

    def test_origin_normalization_preserves_target_identity(self):
        self.assertEqual(normalized_remote('git@github.com:wieslawsoltes/AetherOrbOdyssey.git'),
                         normalized_remote('https://github.com/wieslawsoltes/AetherOrbOdyssey.git'))
        self.assertNotEqual(normalized_remote('https://github.com/other/other.git'),
                            normalized_remote('https://github.com/wieslawsoltes/AetherOrbOdyssey.git'))

if __name__ == '__main__':
    unittest.main()
