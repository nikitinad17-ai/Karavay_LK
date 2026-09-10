#!/usr/bin/env python3
"""Собирает всё в один self-contained HTML: css/products/api/app inline."""
import re, pathlib

root = pathlib.Path(__file__).resolve().parent
app_dir = root / "app"

html = (app_dir / "index.template.html").read_text(encoding="utf-8")
css      = (app_dir / "styles.css").read_text(encoding="utf-8")
products = (app_dir / "products.js").read_text(encoding="utf-8")
api      = (app_dir / "api.js").read_text(encoding="utf-8")
app      = (app_dir / "app.js").read_text(encoding="utf-8")

# заменить <link rel="stylesheet" href="styles.css"> на inline <style>
html = re.sub(
    r'<link\s+rel="stylesheet"\s+href="styles\.css"\s*/?>',
    lambda _m: f'<style>\n{css}\n</style>',
    html
)

# заменить script src на inline
def inline_script(src_pattern, code):
    global html
    pat = r'<script\s+src="' + re.escape(src_pattern) + r'"\s*></script>'
    html = re.sub(pat, lambda _m: f'<script>\n{code}\n</script>', html)

inline_script("products.js", products)
inline_script("api.js",      api)
inline_script("app.js",      app)

# логотип тоже встраиваем как data-url, чтобы не было отдельного запроса
logo = (root / "shared" / "logo-official.svg").read_text(encoding="utf-8")
import base64
logo_b64 = base64.b64encode(logo.encode("utf-8")).decode("ascii")
data_url = f"data:image/svg+xml;base64,{logo_b64}"
# путь ../shared/logo-official.svg используется в app.js внутри viewLogin
# заменим ссылку и в html, и в JS-строках
html = html.replace('../shared/logo-official.svg', data_url)

# favicon тоже встроим, чтобы не было лишнего запроса
try:
    fav = (app_dir / "favicon.svg").read_text(encoding="utf-8")
    fav_b64 = base64.b64encode(fav.encode("utf-8")).decode("ascii")
    fav_url = f"data:image/svg+xml;base64,{fav_b64}"
    html = re.sub(r'href="favicon\.svg"', f'href="{fav_url}"', html)
except Exception:
    pass

# запись single-file (в отдельный файл, чтобы не терять источники)
out = app_dir / "standalone.html"
out.write_text(html, encoding="utf-8")
print(f"OK: single-file {out} ({len(html)} bytes)")
