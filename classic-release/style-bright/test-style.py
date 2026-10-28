"""Verify the lossless style transform and actual atomic apply/rollback."""
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('style', HERE / 'apply-style.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OLD = b'<html><head><meta name="same"><script nonce="keep">const code="same";</script></head><body><button onclick="keep()">Same</button><script src="/same.js"></script></body></html>'


class StyleTests(unittest.TestCase):
    def test_transform_repeat_and_new_css_preserve_every_original_byte(self):
        first = m.transform(OLD, b'body{color:blue}')
        self.assertEqual(m.strip_style(first), OLD)
        self.assertEqual(m.transform(first, b'body{color:blue}'), first)
        second = m.transform(first, b'body{color:red}')
        self.assertEqual(m.strip_style(second), OLD)
        self.assertEqual(second.count(m.START), 1)

    def test_invalid_head_markers_and_css_are_rejected(self):
        for raw, css in [(OLD, b'</style><script>bad()</script>'), (OLD + m.START, b'x'), (b'<body>same</body>', b'x')]:
            with self.assertRaises(RuntimeError):
                m.transform(raw, css)

    def exercise(self, error=None):
        with tempfile.TemporaryDirectory() as folder:
            root, source = pathlib.Path(folder) / 'pb', pathlib.Path(folder) / 'package'
            for directory in ('pb_public/manager', 'pb_hooks', 'pb_migrations', 'pb_data'):
                (root / directory).mkdir(parents=True, exist_ok=True)
            source.mkdir()
            target = root / 'pb_public/index.html';target.write_bytes(OLD)
            protected = root / 'pb_data/karavay-test-access.json';protected.write_bytes(b'keep-users')
            database = root / 'pb_data/data.db';database.write_bytes(b'keep-passwords-and-orders')
            css = b'body{color:blue}'
            (source / 'bright.css').write_bytes(css)
            (source / 'style-release.json').write_text(json.dumps({'css_sha256': m.digest(css), 'known_base_html': [m.digest(OLD)]}))
            class Api:
                def get(self, path):
                    if path == '/api/health':return 200, b'{}'
                    if error:raise error
                    return 200, target.read_bytes()
                def accounts(self):return 200, ('test385buyer001',)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                if error:
                    with self.assertRaises(type(error)):m.apply(root, source, Api(), True)
                    self.assertEqual(target.read_bytes(), OLD)
                else:
                    m.apply(root, source, Api(), False);self.assertEqual(target.read_bytes(), OLD)
                    m.apply(root, source, Api(), True)
                    self.assertEqual(m.strip_style(target.read_bytes()), OLD)
                    m.apply(root, source, Api(), True)
                    self.assertIn('BRIGHT_STYLE_ALREADY_OK', output.getvalue())
            self.assertEqual(protected.read_bytes(), b'keep-users')
            self.assertEqual(database.read_bytes(), b'keep-passwords-and-orders')

    def test_actual_apply_read_only_and_repeat(self):self.exercise()
    def test_failed_verification_restores_original_html(self):self.exercise(RuntimeError('serve failed'))
    def test_ctrl_c_restores_original_html(self):self.exercise(KeyboardInterrupt())


if __name__ == '__main__':unittest.main(verbosity=2)
