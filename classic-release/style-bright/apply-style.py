#!/usr/bin/env python3
"""Inject only a CSS block into the existing HTML; preserve all application code."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import tempfile
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/pocketbase')
HERE = pathlib.Path(__file__).resolve().parent
PB = 'http://127.0.0.1:8090'
START = b'<!-- KARAVAY_BRIGHT_STYLE_20261028_START -->'
END = b'<!-- KARAVAY_BRIGHT_STYLE_20261028_END -->'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def strip_style(raw):
    if raw.count(START) != raw.count(END) or raw.count(START) > 1:
        raise RuntimeError('Unexpected bright style markers')
    return re.sub(re.escape(START) + rb'[\s\S]*?' + re.escape(END), b'', raw)


def transform(old, css):
    if b'</style' in css.lower() or b'<script' in css.lower():
        raise RuntimeError('Unexpected content in CSS')
    base = strip_style(old)
    if base.lower().count(b'</head>') != 1:
        raise RuntimeError('Expected one HTML head')
    block = START + b'<style id="karavay-bright-20261028">' + css + b'</style>' + END
    position = base.lower().index(b'</head>')
    new = base[:position] + block + base[position:]
    if strip_style(new) != base:
        raise RuntimeError('Application markup changed')
    scripts = lambda raw: re.findall(rb'<script\b[^>]*>[\s\S]*?</script\s*>', raw, re.I)
    if scripts(new) != scripts(old):
        raise RuntimeError('Application script changed')
    return new


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class Api:
    def __init__(self, base=PB):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path):
        if path not in ('/', '/api/health', '/service/test-access'):
            raise RuntimeError('Only HTML/health/demo-metadata GET allowed')
        request = urllib.request.Request(self.base + path, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read(8388609)
        if len(raw) > 8388608:
            raise RuntimeError('Response too large')
        return status, raw

    def accounts(self):
        status, raw = self.get('/service/test-access')
        if status != 200:
            return status, ()
        value = json.loads(raw)
        accounts = value.get('accounts') if isinstance(value, dict) else None
        if not isinstance(accounts, list) or any(not isinstance(a, dict) or not isinstance(a.get('id'), str) for a in accounts):
            raise RuntimeError('Invalid demo metadata')
        return status, tuple(sorted(a['id'] for a in accounts))


def protected(root):
    paths = [root / 'pb_data/karavay-test-access.json']
    for name in ('pb_hooks', 'pb_migrations', 'pb_public/manager'):
        paths.extend(p for p in (root / name).rglob('*') if p.is_file())
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in paths if p.is_file()}


def atomic(path, raw, owner):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.karavay-style-', delete=False) as stream:
        temporary = pathlib.Path(stream.name)
        try:
            os.fchmod(stream.fileno(), owner.st_mode & 0o777)
            os.fchown(stream.fileno(), owner.st_uid, owner.st_gid)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def apply(root, source, api, install):
    release = json.loads((source / 'style-release.json').read_text())
    css = (source / 'bright.css').read_bytes()
    if digest(css) != release.get('css_sha256'):
        raise RuntimeError('Style package checksum mismatch')
    target = root / 'pb_public/index.html'
    if target.is_symlink() or not target.is_file():
        raise RuntimeError('Unexpected client HTML path')
    old, owner = target.read_bytes(), target.stat()
    if digest(strip_style(old)) not in release['known_base_html']:
        raise RuntimeError('Unknown client retained; base SHA256=' + digest(strip_style(old)))
    new = transform(old, css)
    if api.get('/api/health')[0] != 200:
        raise RuntimeError('PocketBase unavailable')
    accounts, files = api.accounts(), protected(root)
    if not install:
        print('STYLE_PREFLIGHT_OK: scripts and existing markup retained; no changes')
        return
    if old == new:
        status, raw = api.get('/')
        if status != 200 or digest(raw) != digest(new):
            raise RuntimeError('Expected style is not being served')
        print('BRIGHT_STYLE_ALREADY_OK')
        return
    backup = root.parent / ('.karavay-style-before-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(target, backup / 'index.html')
    changed = False
    try:
        if target.is_symlink() or target.read_bytes() != old:
            raise RuntimeError('HTML changed during preflight')
        atomic(target, new, owner)
        changed = True
        status, raw = api.get('/')
        if status != 200 or raw != new:
            raise RuntimeError('Served style update differs')
        if api.accounts() != accounts or protected(root) != files:
            raise RuntimeError('Accounts/configuration/manager changed during verification')
    except BaseException:
        if changed:
            atomic(target, old, owner)
        raise
    print('BRIGHT_STYLE_READY: blue/yellow theme and embedded Ubuntu font; original scripts unchanged')
    print('TEST_LOGINS_RETAINED:', len(accounts[1]))
    print('BACKUP:', backup)
    print('Reload Ctrl+F5. No account changes, KIS requests, migrations or service restart.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Use sudo')
    with os.fdopen(os.open(ROOT / '.karavay-client-update.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        apply(ROOT, HERE, Api(), args.apply)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('STYLE_CANCELLED: previous HTML retained/restored') from None
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit('STYLE_STOP: ' + str(error)) from None
