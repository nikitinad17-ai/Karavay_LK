#!/usr/bin/env bash
# ============================================================
# Шаг 1. Проверка перед публикацией.
# Ничего не меняет и никуда не отправляет — только смотрит.
# Запуск:  bash scripts/01-check.sh
# ============================================================
set -uo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; DIM=$'\e[2m'; OFF=$'\e[0m'
errors=0; warnings=0

ok()   { echo "  ${GRN}✓${OFF} $1"; }
bad()  { echo "  ${RED}✗${OFF} $1"; errors=$((errors+1)); }
warn() { echo "  ${YEL}!${OFF} $1"; warnings=$((warnings+1)); }

# Работаем от корня репозитория, откуда бы ни запустили скрипт
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
echo "Репозиторий: ${DIM}${ROOT}${OFF}"

echo
echo "── Инструменты ──"
if command -v git >/dev/null 2>&1; then ok "git $(git --version | awk '{print $3}')"
else bad "git не установлен — https://git-scm.com/downloads"; fi

if command -v python3 >/dev/null 2>&1; then ok "python3 $(python3 -V 2>&1 | awk '{print $2}')"
elif command -v python >/dev/null 2>&1; then warn "есть python, но не python3 — в скриптах правьте вызов на python"
else bad "python3 не установлен — нужен для сборки"; fi

if command -v node >/dev/null 2>&1; then ok "node $(node -v)"
else warn "node не установлен — сборка сработает, автотесты нет"; fi

if command -v gh >/dev/null 2>&1; then ok "gh $(gh --version | head -1 | awk '{print $3}') — репозиторий создастся автоматически"
else warn "gh CLI не установлен — репозиторий на GitHub создадите вручную (это нормально)"; fi

echo
echo "── Файлы проекта ──"
for f in app/app.js app/api.js app/styles.css app/products.js \
         app/index.template.html build_inline.py README.md .gitignore; do
  [ -f "$f" ] && ok "$f" || bad "нет файла $f"
done

echo
echo "── Синтаксис JavaScript ──"
if command -v node >/dev/null 2>&1; then
  for f in app/app.js app/api.js tests/t2.js; do
    if node --check "$f" 2>/dev/null; then ok "$f"; else bad "синтаксическая ошибка в $f"; fi
  done
else
  warn "пропущено, нет node"
fi

echo
echo "── Пробная сборка ──"
if command -v python3 >/dev/null 2>&1; then
  if ( cd app && python3 ../build_inline.py ) >/dev/null 2>&1; then
    size=$(wc -c < app/standalone.html)
    ok "собрано, $((size/1024)) КБ"
    if [ -f index.html ]; then
      if cmp -s app/standalone.html index.html; then
        ok "index.html в корне совпадает со сборкой"
      else
        warn "index.html устарел — обновите: bash scripts/03-build.sh"
      fi
    else
      warn "нет index.html в корне — создайте: bash scripts/03-build.sh"
    fi
  else
    bad "сборка упала — запустите вручную: cd app && python3 ../build_inline.py"
  fi
else
  warn "пропущено, нет python3"
fi

echo
echo "── Состояние git ──"
if [ -d .git ]; then
  ok "репозиторий инициализирован"
  echo "     ветка: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '—')"
  echo "     коммитов: $(git rev-list --count HEAD 2>/dev/null || echo 0)"
  echo "     теги: $(git tag | tr '\n' ' ' | sed 's/ $//' || echo '—')"
  if [ -n "$(git status --porcelain)" ]; then
    warn "есть незакоммиченные изменения:"
    git status --short | sed 's/^/       /'
  else
    ok "рабочее дерево чистое"
  fi
  if git remote get-url origin >/dev/null 2>&1; then
    warn "remote origin уже задан: $(git remote get-url origin)"
  else
    ok "remote не задан — его добавит шаг 2"
  fi
else
  bad "нет папки .git — распакуйте архив целиком, вместе со скрытыми файлами"
fi

echo
echo "── Безопасность ──"
pw=$(grep -c 'password:' app/api.js 2>/dev/null || echo 0)
if [ "$pw" -gt 0 ]; then
  warn "в app/api.js паролей открытым текстом: ${pw}"
  echo "       ${DIM}Пароли вымышленные и нужны только для демо, но они попадают${OFF}"
  echo "       ${DIM}и в собранный index.html. Публикуйте только в ПРИВАТНЫЙ репозиторий.${OFF}"
fi
if git -c core.quotepath=false ls-files 2>/dev/null | grep -qiE '\.(env|pem|key|p12|pfx)$'; then
  bad "в индексе есть файлы ключей или .env — уберите их до публикации"
else
  ok "файлов ключей и .env в индексе нет"
fi

echo
echo "════════════════════════════════════════"
if [ "$errors" -gt 0 ]; then
  echo "${RED}Ошибок: ${errors}${OFF}, предупреждений: ${warnings}"
  echo "Исправьте ошибки и запустите проверку снова."
  exit 1
fi
echo "${GRN}Проверка пройдена.${OFF} Предупреждений: ${warnings}"
echo "Дальше:  bash scripts/02-publish.sh"
