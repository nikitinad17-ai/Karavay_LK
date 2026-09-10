#!/usr/bin/env bash
# ============================================================
# Шаг 2. Публикация на GitHub.
# С установленным gh CLI создаёт репозиторий сам; без него —
# просит готовый URL и настраивает remote.
#
# Запуск:  bash scripts/02-publish.sh
#          bash scripts/02-publish.sh karavay-lk          # своё имя
#          bash scripts/02-publish.sh karavay-lk public   # публичный (не советую)
# ============================================================
set -uo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; DIM=$'\e[2m'; BLD=$'\e[1m'; OFF=$'\e[0m'

cd "$(dirname "$0")/.." || exit 1

REPO_NAME="${1:-karavay-lk}"
VISIBILITY="${2:-private}"
BRANCH="main"

die() { echo "${RED}Остановка:${OFF} $1"; exit 1; }

echo "${BLD}Публикация «Личного кабинета клиента» на GitHub${OFF}"
echo "  репозиторий: ${REPO_NAME}"
echo "  доступ:      ${VISIBILITY}"
echo

# ---------- предохранители ----------
command -v git >/dev/null 2>&1 || die "git не установлен."
[ -d .git ] || die "нет папки .git. Распакуйте архив целиком, вместе со скрытыми файлами."

if [ -n "$(git status --porcelain)" ]; then
  echo "${YEL}Есть незакоммиченные изменения:${OFF}"
  git status --short | sed 's/^/  /'
  read -r -p "Закоммитить их сейчас? [y/N] " a
  if [[ "$a" =~ ^[YyДд]$ ]]; then
    git add -A
    read -r -p "Текст коммита: " msg
    git commit -q -m "${msg:-Обновление перед публикацией}" || die "коммит не прошёл."
    echo "${GRN}Закоммичено.${OFF}"
  else
    die "сначала закоммитьте или откатите изменения."
  fi
fi

# Пароли в коде — публичный репозиторий требует осознанного согласия
pw=$(grep -c 'password:' app/api.js 2>/dev/null || echo 0)
if [ "$VISIBILITY" = "public" ] && [ "$pw" -gt 0 ]; then
  echo
  echo "${RED}Внимание.${OFF} В app/api.js ${pw} паролей открытым текстом,"
  echo "и они попадают в собранный index.html. В публичном репозитории"
  echo "их увидит кто угодно, а секретные сканеры GitHub поднимут тревогу."
  echo "Пароли вымышленные, но приватный репозиторий здесь уместнее."
  echo
  read -r -p "Всё равно публиковать открыто? Напечатайте ${BLD}публикую${OFF}: " confirm
  [ "$confirm" = "публикую" ] || die "отменено. Запустите без второго аргумента — будет приватный."
fi

# ---------- ветка ----------
cur="$(git rev-parse --abbrev-ref HEAD)"
if [ "$cur" != "$BRANCH" ]; then
  echo "Переименовываю ветку ${cur} → ${BRANCH}"
  git branch -M "$BRANCH"
fi

# ---------- remote ----------
if git remote get-url origin >/dev/null 2>&1; then
  echo "remote origin уже задан: ${DIM}$(git remote get-url origin)${OFF}"
  read -r -p "Заменить его? [y/N] " a
  [[ "$a" =~ ^[YyДд]$ ]] && git remote remove origin
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1; then
    echo
    echo "Создаю репозиторий через gh CLI…"
    if ! gh auth status >/dev/null 2>&1; then
      echo "Сначала войдите в GitHub:"
      gh auth login || die "авторизация не прошла."
    fi
    gh repo create "$REPO_NAME" \
      --"$VISIBILITY" \
      --source=. \
      --remote=origin \
      --description "Личный кабинет клиента ОАО «КАРАВАЙ» — демо на API КИС" \
      || die "не удалось создать репозиторий. Возможно, имя занято — передайте другое: bash scripts/02-publish.sh другое-имя"
    echo "${GRN}Репозиторий создан.${OFF}"
  else
    echo
    echo "${YEL}gh CLI не найден.${OFF} Создайте репозиторий вручную:"
    echo "  1. Откройте ${BLD}https://github.com/new${OFF}"
    echo "  2. Имя: ${BLD}${REPO_NAME}${OFF}, доступ: ${BLD}${VISIBILITY}${OFF}"
    echo "  3. ${RED}Не добавляйте${OFF} README, .gitignore и лицензию — они уже есть,"
    echo "     иначе первый push упрётся в конфликт."
    echo "  4. Скопируйте URL со страницы созданного репозитория."
    echo
    read -r -p "Вставьте URL: " url
    [ -n "$url" ] || die "URL не введён."
    git remote add origin "$url" || die "не удалось добавить remote."
  fi
fi

# ---------- push ----------
echo
echo "Отправляю ветку ${BRANCH}…"
git push -u origin "$BRANCH" || die "push не прошёл. Проверьте доступ к репозиторию и права SSH-ключа."

if [ -n "$(git tag)" ]; then
  echo "Отправляю теги: $(git tag | tr '\n' ' ')"
  git push origin --tags || echo "${YEL}Теги отправить не удалось — не критично.${OFF}"
fi

# ---------- итог ----------
remote_url="$(git remote get-url origin)"
web_url="$(echo "$remote_url" | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##')"

echo
echo "════════════════════════════════════════"
echo "${GRN}Готово.${OFF} Репозиторий: ${BLD}${web_url}${OFF}"
echo
echo "Дальше по желанию:"
echo "  • Демо по ссылке — Settings → Pages → Source: main, папка / (root)."
echo "    ${DIM}Откроется index.html из корня. Для приватного репозитория Pages${OFF}"
echo "    ${DIM}доступны только на платных тарифах, а на публичном демо увидят все.${OFF}"
echo "  • Правки и повседневная работа: bash scripts/03-build.sh"
