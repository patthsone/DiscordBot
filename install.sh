#!/usr/bin/env bash
#
# install.sh — Автоустановка LuxeCS2 Discord Bot через Docker
#
# Использование:
#   curl -sL https://raw.githubusercontent.com/patthsone/DiscordBot/main/install.sh | bash
#
# Или клонировать и запустить:
#   git clone https://github.com/patthsone/DiscordBot.git
#   cd DiscordBot
#   bash install.sh
#
set -e

# ─── Цвета ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "========================================"
echo "  🎮 LuxeCS2 Discord Bot — Установка"
echo "========================================"
echo ""

# ─── Проверка root ───────────────────────────────────────────────────────────
if [ "$EUID" -eq 0 ]; then
    warn "Запущено от root — это нормально для установки Docker"
fi

# ─── Установка Docker (если нет) ─────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
    info "Docker не найден. Устанавливаю..."
    
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        success "Docker установлен"
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        success "Docker установлен"
    else
        error "Не удалось определить пакетный менеджер. Установите Docker вручную: https://docs.docker.com/get-docker/"
    fi
else
    success "Docker уже установлен: $(docker --version)"
fi

# ─── Docker Compose (plugin) ─────────────────────────────────────────────────
if ! docker compose version &> /dev/null; then
    warn "Docker Compose plugin не найден. Устанавливаю..."
    if command -v apt-get &> /dev/null; then
        apt-get update -qq && apt-get install -y -qq docker-compose-plugin
        success "Docker Compose установлен"
    else
        error "Установите docker-compose-plugin вручную"
    fi
else
    success "Docker Compose доступен"
fi

# ─── Проверка .env ───────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    info "Файл .env не найден. Создаю из шаблона..."
    cp .env.example .env
    warn "⚠️  ВАЖНО: отредактируйте .env перед запуском!"
    warn "   nano .env  — впишите DISCORD_TOKEN, DB_*, API-ключи"
    echo ""
    warn "После редактирования .env запустите:"
    echo "   docker compose up -d --build"
    exit 0
fi

# Проверка, что DISCORD_TOKEN не пустой
if grep -q "^DISCORD_TOKEN=$" .env 2>/dev/null || grep -q "^DISCORD_TOKEN=$" .env; then
    warn "DISCORD_TOKEN пустой в .env! Впишите токен бота."
    warn "   nano .env"
    exit 0
fi

# ─── Создание директории для данных ──────────────────────────────────────────
mkdir -p data
success "Директория data/ создана (runtime-данные)"

# ─── Сборка и запуск ─────────────────────────────────────────────────────────
info "Собираю Docker-образ (это может занять несколько минут)..."
docker compose up -d --build

success "Бот запущен!"

echo ""
echo "========================================"
echo "  ✅ Установка завершена!"
echo "========================================"
echo ""
echo "📋 Команды управления:"
echo "   Логи:              docker compose logs -f"
echo "   Статус:            docker compose ps"
echo "   Остановить:        docker compose down"
echo "   Перезапустить:     docker compose restart"
echo "   Обновить:          bash update.sh"
echo ""
echo "📖 Настройка: https://github.com/patthsone/DiscordBot/CUSTOMIZATION.md"
echo ""
