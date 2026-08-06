# 🎮 LuxeCS2 Discord Bot

Discord-бот для CS2-сообщества: верификация по Steam, VIP-система, уровни активности, FACEIT-роли, мониторинг серверов, авто-модерация и многое другое.

## ✨ Возможности

- **🔐 Верификация Steam** — привязка Steam64 ID, авто-выдача ролей
- **👑 VIP-система** — управление VIP-статусами, привязка к Steam, авто-синхронизация ролей
- **📊 Уровни (Levels)** — XP за активность в чате, ранг-карточки (рендер через canvas), таблица лидеров
- **🎮 FACEIT** — авто-роли уровней FACEIT (1-10), ежедневное обновление в 05:00 МСК
- **🛡️ Администрирование** — статистика админов, онлайн, наказания
- **📡 Мониторинг серверов** — live-статус CS2-серверов (игроки, карта)
- **🤖 Авто-модерация** — фильтр мата/оскорблений с таймаутом, логирование действий модерации
- **🔔 Уведомления** — DM о скором истечении VIP
- **😂 Шутки** — автоматическая отправка CS2-шуток каждые 2 часа
- **🌐 Интеграция с сайтом** — кнопки-ссылки на [luxecs2.ru](https://luxecs2.ru/)

## 🚀 Установка

### Требования
- Node.js 18+ 
- MySQL база данных
- Discord-сервер с правами администратора

### Шаги

1. **Клонируйте репозиторий**
   ```bash
   git clone https://github.com/patthsone/DiscordBot.git
   cd DiscordBot
   ```

2. **Установите зависимости**
   ```bash
   npm install
   ```

3. **Настройте переменные окружения**
   ```bash
   cp .env.example .env
   ```
   Заполните `.env` своими значениями (см. ниже).

4. **Запустите бота**
   ```bash
   npm start
   # или через PM2 для production:
   pm2 start index.js --name discord-bot
   ```

## ⚙️ Настройка (.env)

Все секреты хранятся в файле `.env` (см. `.env.example`):

```env
# Discord
DISCORD_TOKEN=ваш_токен_бота

# База данных MySQL
DB_HOST=localhost
DB_USER=bot_user
DB_PASSWORD=ваш_пароль
DB_NAME=bot_db

# ID гильдии (сервера)
GUILD_ID=123456789012345678

# Steam Web API (https://steamcommunity.com/dev/apikey)
STEAM_API_KEY=ваш_steam_ключ

# FACEIT API (https://developers.faceit.com/)
FACEIT_API_KEY=ваш_faceit_ключ
FACEIT_GAME=cs2
```

## 🔑 Получение API-ключей

| Сервис | Где получить |
|--------|-------------|
| Discord Token | [Discord Developer Portal](https://discord.com/developers/applications) |
| Steam API Key | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| FACEIT API Key | [developers.faceit.com](https://developers.faceit.com/) → Apps → API Key |

## 📁 Структура проекта

```
├── index.js              # Точка входа, загрузка когов
├── config.js             # Конфигурация (читает .env)
├── cogs/                 # Модули (коги)
│   ├── verification_cog.js   # Верификация Steam
│   ├── vips_cog.js           # VIP-система
│   ├── levels_cog.js         # Уровни и XP
│   ├── faceit_cog.js         # FACEIT авто-роли
│   ├── admin_cog.js          # Статистика админов
│   ├── server_cog.js         # Мониторинг серверов
│   ├── mod_log_cog.js        # Логи + авто-модерация
│   ├── notifications_cog.js  # Уведомления о VIP
│   ├── jokes_cog.js          # Шутки
│   ├── ping_cog.js           # Статус системы
│   └── welcome_cog.js        # Приветствие
├── utils/                # Утилиты
│   ├── database.js           # MySQL пулы подключений
│   ├── steam.js              # Steam Web API клиент
│   ├── faceit.js             # FACEIT API клиент
│   ├── cardBuilder.js        # Рендер ранг-карточек (canvas)
│   ├── serverMonitor.js      # Опрос CS2-серверов (gamedig)
│   └── fileUtils.js          # JSON чтение/запись
└── .env.example          # Шаблон переменных окружения
```

## 🤝 Бот требует следующие разрешения (Discord)

- `ViewAuditLog` — для логов изменений ролей
- `ModerateMembers` (Timeout) — для авто-модерации
- `ManageRoles` — для выдачи VIP/FACEIT ролей
- `ManageMessages` — для удаления нарушений
- `MessageContent` (Intent) — для фильтрации сообщений

## 📝 Лицензия

ISC
