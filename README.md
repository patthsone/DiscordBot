# 🎮 LuxeCS2 Discord Bot

Discord-бот для CS2-сообщества: верификация по Steam, VIP-система, уровни активности, FACEIT-роли, мониторинг серверов, авто-модерация и многое другое.

> **Живая статистика бота.** Чтобы бейджи ниже показывали реальные числа, бот должен быть запущен с открытым `STATS_PORT` (по умолчанию `3000`) на сервере с публичным IP.
> Замените `YOUR_SERVER_HOST` на домен/IP вашего сервера (например, `stats.luxecs2.ru` или `85.119.149.36:3000`).

<!-- Живые бейджи статистики (shields.io endpoint) -->
![Servers](https://img.shields.io/endpoint?url=https://YOUR_SERVER_HOST:3000/badge/servers&cacheSeconds=60)
![Users](https://img.shields.io/endpoint?url=https://YOUR_SERVER_HOST:3000/badge/users&cacheSeconds=60)
![Installs](https://img.shields.io/endpoint?url=https://YOUR_SERVER_HOST:3000/badge/installs&cacheSeconds=60)
![Uptime](https://img.shields.io/endpoint?url=https://YOUR_SERVER_HOST:3000/badge/uptime&cacheSeconds=60)
![Ping](https://img.shields.io/endpoint?url=https://YOUR_SERVER_HOST:3000/badge/ping&cacheSeconds=60)

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

## 🤖 Команды

Бот поддерживает слеш-команды (`/`). Команды разделены по доступу.

### 🎮 Для всех участников

| Команда | Описание |
|---------|----------|
| `/level` | Показать ваш уровень, XP, прогресс и позицию в рейтинге (ранг-карточка + кнопка сайта) |
| `/leaderboard` | Таблица лидеров: топ-10 игроков по уровню |
| `/vips` | Просмотр VIP-состава сервера с пагинацией и меню выбора игрока |
| `/vips search <запрос>` | Поиск VIP-игрока по Steam ID, ссылке или имени |
| `/vips page <номер>` | Открыть конкретную страницу VIP-списка |
| `/admin_info search <запрос>` | Просмотр статистики конкретного администратора (Steam ID или имя) |
| `/joke` | Получить случайную шутку про CS2/гейминг немедленно |
| `/ping` | Подробный статус бота: задержка, аптайм, память, БД, игровые серверы + кнопка обновления |
| `/status` | Обновить live-статус CS2-серверов в канале мониторинга |

### 👑 Для администраторов

| Команда | Описание |
|---------|----------|
| `/setmodlog channel #канал` | Установить канал для логов модерации (сохраняется между перезапусками) |
| `/setignorechannel #канал` | Добавить/убрать канал-исключение для авто-модерации (флуд/спам) |
| `/connect_vip_db host user password database` | Подключиться к базе данных VIP |
| `/admin_stats host user password database channel` | Настроить статистику админов и ежедневную отправку |
| `/admin_stats_now` | Отправить статистику админов в канал прямо сейчас |
| `/add_server name ip port` | Добавить CS2-сервер в мониторинг |
| `/remove_server name` | Удалить сервер из мониторинга (с автодополнением) |
| `/faceit_update` | Принудительно обновить уровни FACEIT всех пользователей |

### 🎯 Интерактивные элементы (кнопки/меню)

- **Верификация** — сообщение в канале верификации с кнопками «🎯 Верифицировать Steam», «🔄 Обновить роли» и «🌐 Сайт проекта»
- **VIP-список** — пагинация (◀️/▶️), счётчик страниц, обновление (🔄), выпадающее меню выбора игрока
- **Уровни** — ранг-карточка с canvas-рендером (аватар, прогресс-бар, уровень)
- **Статус** — кнопка «🌐 Сайт» в `/level` и `/leaderboard`, «🔄 Обновить» в `/ping`

### ⏰ Автоматические задачи

| Задача | Интервал | Время |
|--------|----------|-------|
| Проверка VIP-статусов | раз в час | — |
| Обновление FACEIT-ролей | ежедневно | 05:00 МСК |
| Уведомления об истечении VIP | раз в час | (за 3 дня, 1 день, в день истечения) |
| Отправка шуток | каждые 2 часа | — |
| Статистика админов | ежедневно | 09:00 МСК |
| Обновление статусов серверов | по интервалу | `UPDATE_INTERVAL` (сек) |

## 📊 Статистика бота (живые бейджи)

Бот запускает HTTP-сервер статистики, который отдаёт живые данные через JSON. Это позволяет показывать актуальную статистику прямо в README репозитория через [shields.io](https://shields.io) бейджи.

### Что отслеживается

- 🌐 **Количество серверов** — где установлен бот
- 👥 **Количество пользователей** — суммарно на всех серверах
- 📥 **Кто установил бота** — журнал (имя сервера, кто добавил, когда, кол-во участников)
- ⏱️ **Аптайм бота** — сколько работает без перезапуска
- ⚡ **Пинг** — задержка до Discord API
- 📤 **Удаления** — с каких серверов бот был удалён и когда

### Эндпоинты HTTP-сервера

| Эндпоинт | Описание |
|----------|----------|
| `GET /` | Приветствие / список эндпоинтов |
| `GET /stats` | Полная статистика в JSON |
| `GET /badge/:metric` | Обёртка для shields.io (`servers`, `users`, `installs`, `uptime`, `ping`) |
| `GET /health` | Проверка здоровья (для uptime-мониторинга) |

### Настройка живых бейджей в README

1. Убедитесь, что порт `STATS_PORT` (по умолчанию `3000`) открыт на сервере бота.
2. Замените `YOUR_SERVER_HOST` в бейджах выше на ваш домен или `IP:порт`.
   - Пример: `https://img.shields.io/endpoint?url=http://85.119.149.36:3000/badge/servers`
3. (Опционально) Задайте `STATS_TOKEN` в `.env` для защиты и добавьте `&query=token`:
   - `https://img.shields.io/endpoint?url=http://host:3000/badge/servers%3Ftoken%3Dсекрет`

Журнал установок (кто добавил бота) хранится в `stats_history.json` (исключён из git).

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
│   ├── stats_cog.js          # HTTP-сервер статистики + трекинг установок
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
