#!/usr/bin/env python3
"""Replace only the served client HTML. No restart, DB changes or KIS requests."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import tempfile
import urllib.error
import urllib.request

ROOT = pathlib.Path('/opt/pocketbase')
HERE = pathlib.Path(__file__).resolve().parent
PB = 'http://127.0.0.1:8090'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


class Api:
    def __init__(self, base=PB):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, path):
        if path not in ('/', '/api/health', '/service/test-access'):
            raise RuntimeError('Only client/health/test-metadata GET is allowed')
        request = urllib.request.Request(self.base + path, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw = response.status, response.read(4194305)
        if len(raw) > 4194304:
            raise RuntimeError('Response exceeds limit')
        return status, raw

    def health(self):
        if self.get('/api/health')[0] != 200:
            raise RuntimeError('PocketBase health check failed')

    def accounts(self):
        status, raw = self.get('/service/test-access')
        if status != 200:
            return status, ()
        value = json.loads(raw)
        accounts = value.get('accounts') if isinstance(value, dict) else None
        if not isinstance(accounts, list) or any(not isinstance(a, dict) or not isinstance(a.get('id'), str) for a in accounts):
            raise RuntimeError('Invalid test access metadata')
        return status, tuple(sorted(a['id'] for a in accounts))


def protected(root):
    # Compare digests only. Never copy account configuration or user data.
    paths = [root / 'pb_data/karavay-test-access.json']
    for name in ('pb_hooks', 'pb_migrations', 'pb_public/manager'):
        paths.extend(p for p in (root / name).rglob('*') if p.is_file())
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in paths if p.is_file()}


def atomic(path, raw, owner):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.karavay-client-', delete=False) as stream:
        temp = pathlib.Path(stream.name)
        try:
            os.fchmod(stream.fileno(), owner.st_mode & 0o777)
            os.fchown(stream.fileno(), owner.st_uid, owner.st_gid)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def update(root, source, api, apply):
    release = json.loads((source / 'release.json').read_text())
    new = (source / 'index.html').read_bytes()
    if release.get('version') != '3.8.5' or digest(new) != release.get('html_sha256'):
        raise RuntimeError('Client package hash/version mismatch')
    target = root / 'pb_public/index.html'
    if target.is_symlink() or not target.is_file():
        raise RuntimeError('Unexpected client HTML path')
    old, owner = target.read_bytes(), target.stat()
    if digest(old) not in set(release['known_html']) | {digest(new)}:
        raise RuntimeError('Unknown installed HTML retained; SHA256=' + digest(old))
    api.health()
    before_accounts, before_files = api.accounts(), protected(root)
    if not apply:
        print('CLIENT_3_8_5_PREFLIGHT_OK: known HTML; read-only')
        return
    if old == new:
        if digest(api.get('/')[1]) != digest(new):
            raise RuntimeError('The expected HTML is not being served')
        print('CLIENT_3_8_5_ALREADY_OK')
        return
    backup = root.parent / ('.karavay-client-repeat-before-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(target, backup / 'index.html')
    changed = False
    try:
        if target.is_symlink() or target.read_bytes() != old:
            raise RuntimeError('Client HTML changed during preflight')
        atomic(target, new, owner)
        changed = True
        api.health()
        status, served = api.get('/')
        if status != 200 or digest(served) != digest(new):
            raise RuntimeError('Served HTML does not match the new client')
        if api.accounts() != before_accounts:
            raise RuntimeError('Demo login list changed during verification')
        if protected(root) != before_files:
            raise RuntimeError('Hooks/configuration/manager files changed during verification')
    except BaseException:
        if changed:
            atomic(target, old, owner)
        raise
    print('CLIENT_3_8_5_UPDATED: history rows and repeat-order actions ready; served HTML verified')
    print('TEST_LOGINS_RETAINED:', len(before_accounts[1]))
    print('BACKUP:', backup)
    print('No service restart, migrations, account changes or KIS requests. Reload with Ctrl+F5.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run through sudo')
    with os.fdopen(os.open(ROOT / '.karavay-client-update.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(ROOT, HERE, Api(), args.apply)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('CLIENT_UPDATE_CANCELLED: previous HTML retained/restored') from None
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit('CLIENT_UPDATE_STOP: ' + str(error)) from None
