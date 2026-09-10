#!/usr/bin/env bash
# ============================================================
# Шаг 3. Повседневный цикл: собрать, проверить, закоммитить.
# Запускается после каждой правки в app/.
#
#   bash scripts/03-build.sh              собрать и прогнать тесты
#   bash scripts/03-build.sh --no-test    только собрать
#   bash scripts/03-build.sh --commit "Текст"   собрать, проверить, закоммитить
#   bash scripts/03-build.sh --release 2.1      то же плюс тег v2.1 и push
# ============================================================
set -uo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; DIM=$'\e[2m'; BLD=$'\e[1m'; OFF=$'\e[0m'
cd "$(dirname "$0")/.." || exit 1

RUN_TESTS=1; COMMIT_MSG=""; RELEASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-test) RUN_TESTS=0; shift ;;
    --commit)  COMMIT_MSG="${2:-}"; shift 2 ;;
    --release) RELEASE="${2:-}"; COMMIT_MSG="${COMMIT_MSG:-Версия v${2:-}}"; shift 2 ;;
    *) echo "Неизвестный аргумент: $1"; exit 1 ;;
  esac
done

die() { echo "${RED}Остановка:${OFF} $1"; exit 1; }

# ---------- 1. синтаксис ----------
echo "${BLD}1/4 Синтаксис${OFF}"
if command -v node >/dev/null 2>&1; then
  for f in app/app.js app/api.js; do
    node --check "$f" 2>/dev/null || die "синтаксическая ошибка в $f"
    echo "  ${GRN}✓${OFF} $f"
  done
else
  echo "  ${YEL}!${OFF} нет node, проверка пропущена"
fi

# ---------- 2. сборка ----------
echo
echo "${BLD}2/4 Сборка${OFF}"
command -v python3 >/dev/null 2>&1 || die "нужен python3."
( cd app && python3 ../build_inline.py ) || die "сборка не прошла."
cp app/standalone.html index.html || die "не удалось обновить index.html."
echo "  ${GRN}✓${OFF} index.html обновлён, $(( $(wc -c < index.html) / 1024 )) КБ"

# ---------- 3. тесты ----------
echo
echo "${BLD}3/4 Автотесты${OFF}"
if [ "$RUN_TESTS" -eq 0 ]; then
  echo "  ${DIM}пропущены (--no-test)${OFF}"
elif ! command -v node >/dev/null 2>&1; then
  echo "  ${YEL}!${OFF} нет node, тесты пропущены"
elif ! node -e "require('playwright')" 2>/dev/null && [ ! -d node_modules/playwright ]; then
  echo "  ${YEL}!${OFF} Playwright не установлен, тесты пропущены"
  echo "     ${DIM}Установка:  npm install -D playwright && npx playwright install chromium${OFF}"
else
  if node tests/t2.js; then
    echo "  ${GRN}✓${OFF} тесты пройдены"
  else
    die "тесты провалены. Правьте app/ и запустите скрипт снова."
  fi
fi

# ---------- 4. git ----------
echo
echo "${BLD}4/4 Git${OFF}"
if [ -z "$(git status --porcelain)" ]; then
  echo "  ${DIM}изменений нет${OFF}"
else
  git status --short | sed 's/^/  /'
  if [ -n "$COMMIT_MSG" ]; then
    git add -A
    git commit -q -m "$COMMIT_MSG" || die "коммит не прошёл."
    echo "  ${GRN}✓${OFF} закоммичено: ${COMMIT_MSG}"
  else
    echo "  ${DIM}не закоммичено. Чтобы сохранить:${OFF}"
    echo "     bash scripts/03-build.sh --commit \"Что изменилось\""
  fi
fi

if [ -n "$RELEASE" ]; then
  tag="v${RELEASE}"
  git rev-parse "$tag" >/dev/null 2>&1 && die "тег ${tag} уже существует."
  git tag -a "$tag" -m "Версия ${tag}" || die "не удалось создать тег."
  echo "  ${GRN}✓${OFF} создан тег ${tag}"
  if git remote get-url origin >/dev/null 2>&1; then
    git push origin "$(git rev-parse --abbrev-ref HEAD)" && git push origin "$tag" \
      && echo "  ${GRN}✓${OFF} отправлено на GitHub" \
      || echo "  ${YEL}!${OFF} push не прошёл — отправьте вручную: git push --follow-tags"
  else
    echo "  ${YEL}!${OFF} remote не задан. Сначала: bash scripts/02-publish.sh"
  fi
  echo
  echo "  ${DIM}Не забудьте дописать версию в README.md, раздел «История версий».${OFF}"
fi

echo
echo "${GRN}Готово.${OFF} Открыть демо: index.html"
