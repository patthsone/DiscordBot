#!/usr/bin/env bash
#
# update.sh — Обновление LuxeCS2 Discord Bot из GitHub
#
# Скачивает последние изменения, пересобирает образ и перезапускает контейнер.
# Runtime-данные (в data/) и .env сохраняются.
#
# Использование:
#   bash update.sh
#
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${YELLOW}[UPDATE]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "========================================"
echo "  🔄 Обновление LuxeCS2 Discord Bot"
echo "========================================"
echo ""

# ─── Проверка git ────────────────────────────────────────────────────────────
if ! command -v git &> /dev/null; then
    error "git не установлен. Установите: apt-get install git"
fi

# ─── Сохранение локальных изменений конфигов ─────────────────────────────────
info "Проверяю локальные изменения..."
if [ -n "$(git status --porcelain config.js welcome_config.js 2>/dev/null)" ]; then
    warn "Обнаружены локальные изменения в config.js/welcome_config.js — stash..."
    git stash push -m "auto-stash before update $(date)" -- config.js welcome_config.js || true
fi

# ─── Pull ────────────────────────────────────────────────────────────────────
info "Скачиваю обновления из GitHub..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    success "Уже актуальная версия — обновление не требуется."
    echo ""
    read -p "Пересобрать образ принудительно? (y/N): " FORCE
    if [[ ! "$FORCE" =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    git pull origin main
    success "Код обновлён: $LOCAL → $REMOTE"
fi

# Возвращаем локальные изменения конфигов
git stash pop 2>/dev/null || true

# ─── Пересборка и перезапуск ─────────────────────────────────────────────────
info "Пересобираю Docker-образ..."
docker compose up -d --build

success "Обновление завершено!"
echo ""
echo "📋 Логи: docker compose logs -f"
echo ""
