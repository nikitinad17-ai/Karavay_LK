"""Actual HTTP and atomic filesystem checks; no user's PB/VM/KIS is called."""
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('client_update', HERE / 'update-client.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        raise AssertionError('Unexpected write request')

    def do_GET(self):
        self.server.calls.append(self.path)
        if self.path == '/api/health':
            raw, status = b'{}', 200
        elif self.path == '/service/test-access':
            if self.server.no_demos:
                raw, status = b'{"code":"TEST_ACCESS_DISABLED"}', 404
            else:
                raw, status = json.dumps({'accounts': [{'id': 'test383point001'}, {'id': 'test383buyer001'}, {'id': 'test383multi001'}]}).encode(), 200
        else:
            assert self.path == '/'
            raw, status = (self.server.root / 'pb_public/index.html').read_bytes(), 200
            if self.server.bad_served and raw == b'new client':
                raw = b'wrong served client'
            if self.server.modify_manager and raw == b'new client':
                (self.server.root / 'pb_public/manager/index.html').write_bytes(b'concurrent manager change')
        self.send_response(status)
        self.end_headers()
        self.wfile.write(raw)


class UpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / 'pb'
        self.source = pathlib.Path(self.temp.name) / 'package'
        for folder in ('pb_public/manager', 'pb_hooks', 'pb_migrations', 'pb_data'):
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        self.source.mkdir()
        self.target = self.root / 'pb_public/index.html'
        self.target.write_bytes(b'old client')
        (self.source / 'index.html').write_bytes(b'new client')
        (self.source / 'release.json').write_text(json.dumps({'version': '3.8.5', 'html_sha256': m.digest(b'new client'), 'known_html': [m.digest(b'old client')]}))
        for file in ('pb_hooks/keep.js', 'pb_migrations/unapplied.js', 'pb_data/data.db', 'pb_data/karavay-test-access.json', 'pb_public/manager/index.html'):
            (self.root / file).write_bytes(('retain ' + file).encode())
        self.server.root = self.root
        self.server.calls = []
        self.server.bad_served = self.server.modify_manager = self.server.no_demos = False
        self.api = m.Api('http://127.0.0.1:' + str(self.server.server_port))

    def run_update(self, apply=True):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            m.update(self.root, self.source, self.api, apply)
        return output.getvalue()

    def test_apply_and_repeat_keep_database_manager_and_accounts(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file() and p != self.target}
        mode = self.target.stat().st_mode
        output = self.run_update()
        self.assertIn('CLIENT_3_8_5_UPDATED', output)
        self.assertEqual(self.target.read_bytes(), b'new client')
        self.assertEqual(self.target.stat().st_mode, mode)
        self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file() and p != self.target})
        self.assertIn('CLIENT_3_8_5_ALREADY_OK', self.run_update())
        self.assertEqual(len(list(self.root.parent.glob('.karavay-client-repeat-before-*'))), 1)
        self.assertTrue(set(self.server.calls) <= {'/', '/api/health', '/service/test-access'})

    def test_read_only_preflight_writes_nothing(self):
        self.assertIn('PREFLIGHT_OK', self.run_update(False))
        self.assertEqual(self.target.read_bytes(), b'old client')
        self.assertEqual(list(self.root.parent.glob('.karavay-client-repeat-before-*')), [])

    def test_unrelated_pending_migration_is_not_executed(self):
        # No PB restart or migrate command exists in this updater.
        self.run_update()
        self.assertEqual((self.root / 'pb_migrations/unapplied.js').read_bytes(), b'retain pb_migrations/unapplied.js')
        self.assertEqual((self.root / 'pb_data/data.db').read_bytes(), b'retain pb_data/data.db')

    def test_wrong_served_html_rolls_back_only_html(self):
        self.server.bad_served = True
        before = m.protected(self.root)
        with self.assertRaisesRegex(RuntimeError, 'Served HTML'):
            self.run_update()
        self.assertEqual(self.target.read_bytes(), b'old client')
        self.assertEqual(m.protected(self.root), before)

    def test_ctrl_c_after_replacement_restores_old_html(self):
        count = [0]
        def interrupt():
            count[0] += 1
            if count[0] == 2:
                raise KeyboardInterrupt()
        with patch.object(self.api, 'health', side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_update()
        self.assertEqual(self.target.read_bytes(), b'old client')

    def test_concurrent_manager_change_is_preserved_when_html_rolls_back(self):
        self.server.modify_manager = True
        with self.assertRaisesRegex(RuntimeError, 'manager files changed'):
            self.run_update()
        self.assertEqual(self.target.read_bytes(), b'old client')
        self.assertEqual((self.root / 'pb_public/manager/index.html').read_bytes(), b'concurrent manager change')

    def test_unknown_html_tampered_package_and_symlink_stop_before_update(self):
        self.target.write_bytes(b'unknown installed HTML')
        with self.assertRaisesRegex(RuntimeError, 'Unknown installed HTML'):
            self.run_update()
        self.assertEqual(self.server.calls, [])
        self.target.unlink()
        self.target.symlink_to(self.source / 'index.html')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected client HTML path'):
            self.run_update()
        self.target.unlink()
        self.target.write_bytes(b'old client')
        (self.source / 'index.html').write_bytes(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'package hash/version'):
            self.run_update()
        self.assertEqual(self.target.read_bytes(), b'old client')

    def test_ordinary_email_login_without_demo_metadata_is_supported(self):
        self.server.no_demos = True
        self.assertIn('CLIENT_3_8_5_UPDATED', self.run_update())

    def test_other_paths_are_rejected_before_network(self):
        with self.assertRaisesRegex(RuntimeError, 'Only client'):
            self.api.get('/service/orders')
        self.assertEqual(self.server.calls, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
