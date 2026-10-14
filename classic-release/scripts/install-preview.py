#!/usr/bin/env python3
"""Install the separately addressed classic UI preview. Does not replace index or manager."""
import hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TARGET=Path('/opt/pocketbase/pb_public/classic-preview')
def main():
    if os.geteuid()!=0:raise SystemExit('Запустите через sudo.')
    manifest=json.loads((ROOT/'MANIFEST.json').read_text())
    source=ROOT/'pb_public/index.html'
    if hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['html_sha256']:raise SystemExit('Контрольная сумма не совпала.')
    if not TARGET.parent.is_dir() or TARGET.is_symlink():raise SystemExit('Неожиданный путь установки.')
    if TARGET.exists():raise SystemExit('classic-preview уже существует. Существующий каталог не изменён.')
    stage=Path(tempfile.mkdtemp(prefix='.classic-preview-',dir=TARGET.parent))
    try:
        shutil.copyfile(source,stage/'index.html');(stage/'index.html').chmod(0o644);stage.chmod(0o755);stage.rename(TARGET)
    finally:
        if stage.exists():shutil.rmtree(stage)
    print('CLASSIC_PREVIEW_INSTALLED: http://192.168.25.98:8090/classic-preview/')
    print('Установлен только HTML для просмотра. Для отправки и истории требуется backend пакета 3.8.0.')
if __name__=='__main__':main()
