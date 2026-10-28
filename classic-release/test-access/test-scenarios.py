"""The requested multiple-recipient login must install even with EMPTY histories."""
import contextlib
import importlib.util
import io
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


td = load('scenario_http_fixture', HERE / 'test-diverse-history.py')
ns = load('scenarios', HERE / 'install-scenarios.py')


class ScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        td.DiverseTests.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        td.DiverseTests.tearDownClass.__func__(cls)

    save = td.DiverseTests.save
    make_root = td.DiverseTests.make_root
    insert_plan = td.DiverseTests.insert_plan

    def setUp(self):
        td.DiverseTests.setUp(self)
        self.base = td.m
        self.enterContext(patch.object(ns, 'base', self.base))
        self.enterContext(patch.object(self.base, 'MIGRATION', ns.MIGRATION))
        for route, value in self.server.docs.items():
            if route.startswith('/clients/') and route.endswith('/orders'):
                value['Orders'] = []

    def execute(self, root, lose_point=False):
        def start(action):
            if action == 'start':
                config = json.loads((root / self.base.CONFIG).read_text())
                if config.get('scenario') != 'multi-recipient-v385':
                    return  # rollback restart
                with sqlite3.connect(root / 'pb_data/data.db') as con:
                    count = con.execute('SELECT count(*) FROM users WHERE id=?', (config['accounts'][0]['id'],)).fetchone()[0]
                if not count:
                    self.insert_plan(root, config)
                    with sqlite3.connect(root / 'pb_data/data.db') as con:
                        con.execute('INSERT INTO _migrations VALUES(?)', (ns.MIGRATION,))
                if lose_point:
                    route = '/payers/' + str(config['payers'][1]['kid']) + '/clients'
                    self.server.docs[route] = [c for c in self.server.docs[route] if c['id'] == config['points'][1]['kid']]
        output = io.StringIO()
        with patch.object(ns, 'ROOT', root), patch.object(self.base, 'Api', return_value=self.api), \
             patch.object(self.base, 'service', side_effect=start), patch.object(sys, 'argv', ['install', '--apply']), \
             patch.object(self.base.os, 'geteuid', return_value=0), \
             patch.object(self.base.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'PocketBase 0.40.3')), \
             patch.object(self.base, 'verify'), contextlib.redirect_stdout(output):
            ns.main()
        return output.getvalue()

    def test_actual_apply_and_repeat_create_one_multiple_and_multi_buyer_scopes_without_history_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _ = self.make_root(folder)
            output = self.execute(root)
            config = json.loads((root / self.base.CONFIG).read_text())
            self.assertEqual(config['scenario'], 'multi-recipient-v385')
            self.assertEqual(len(set(config['multipleRecipients'])), 2)
            self.assertEqual(config['accounts'][1]['email'], 'demo.test.buyer.v385@example.test')
            self.assertIn('Несколько получателей', config['accounts'][1]['name'])
            for cid in config['multipleRecipients']:
                self.assertIn('C' + str(cid), config['accounts'][1]['description'])
            self.assertIn('MULTI_RECIPIENT_DEMO_READY:', output)
            self.assertIn('| recipients: 2', output)
            self.assertEqual(output.count('DEMO_HISTORY:'), 2)
            self.assertIn('returned orders 0', output)
            self.assertFalse(any('/matrix?' in path for _, path, _ in self.server.calls))
            with sqlite3.connect(root / 'pb_data/data.db') as con:
                before = list(con.execute('SELECT id,password_hash FROM users ORDER BY id'))
            self.assertIn('SCENARIOS_READY', self.execute(root))
            again = json.loads((root / self.base.CONFIG).read_text())
            for key in ('payers', 'points', 'accounts', 'multipleRecipients'):
                self.assertEqual(config[key], again[key])
            with sqlite3.connect(root / 'pb_data/data.db') as con:
                self.assertEqual(before, list(con.execute('SELECT id,password_hash FROM users ORDER BY id')))
            writes = [(method, path) for method, path, _ in self.server.calls if method == 'POST']
            self.assertTrue(all(path == '/service/test-access' for _, path in writes))

    def test_one_visible_recipient_never_passes_the_multiple_recipient_requirement(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _ = self.make_root(folder)
            before = (root / self.base.CONFIG).read_bytes()
            with self.assertRaisesRegex(RuntimeError, 'MULTI_RECIPIENT_CHECK_FAILED'):
                self.execute(root, lose_point=True)
            self.assertEqual((root / self.base.CONFIG).read_bytes(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
