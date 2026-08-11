# 🛠️ Инструкция по настройке бота

Это подробное руководство о том, **где и что менять**, чтобы адаптировать бота под свой сервер. Все параметры разделены по модулям (когам).

> 💡 **Совет:** перед изменениями сделайте копию файла. После изменений — перезапустите бота.

---

## 📋 Содержание

1. [Базовая настройка (.env и config.js)](#1-базовая-настройка-env-и-configjs)
2. [Welcome — приветствие новых участников](#2-welcome--приветствие-новых-участников)
3. [Levels — уровни и XP](#3-levels--уровни-и-xp)
4. [FACEIT — авто-роли уровней](#4-faceit--авто-роли-уровней)
5. [TopDonate — роли по донату](#5-topdonate--роли-по-донату)
6. [Verification — верификация Steam](#6-verification--верификация-steam)
7. [VIP — управление VIP-статусами](#7-vip--управление-vip-статусами)
8. [Jokes — шутки](#8-jokes--шутки)
9. [ModLog — модерация и авто-фильтр](#9-modlog--модерация-и-авто-фильтр)
10. [Notifications — уведомления о VIP](#10-notifications--уведомления-о-vip)
11. [Admin — статистика админов](#11-admin--статистика-админов)
12. [Server — мониторинг серверов](#12-server--мониторинг-серверов)
13. [Ping — статус системы](#13-ping--статус-системы)

---

## 1. Базовая настройка (.env и config.js)

### Файл `.env` (секреты — не коммитить!)

```env
# Discord токен бота (обязательно)
DISCORD_TOKEN=ваш_токен

# База данных MySQL (основная)
DB_HOST=localhost
DB_USER=bot_user
DB_PASSWORD=ваш_пароль
DB_NAME=bot_db

# ID вашего сервера (гильдии)
GUILD_ID=123456789012345678

# Steam Web API (для аватарок и имён)
STEAM_API_KEY=ваш_steam_ключ

# FACEIT API (для авто-ролей уровней)
FACEIT_API_KEY=ваш_faceit_ключ
FACEIT_GAME=cs2
```

### Файл `config.js` (публичные настройки)

| Параметр | Где | Что менять |
|----------|-----|-----------|
| `DEFAULT_SERVERS` | `config.js:7` | IP/порты/названия ваших CS2-серверов |
| `STATUS_CHANNEL_ID` | `config.js:26` | ID канала для мониторинга серверов |
| `ADMIN_ROLE_ID` | `config.js:27` | ID роли администратора |
| `GUILD_ID` | `config.js:35` | ID вашего Discord-сервера |
| `VERIFICATION_CHANNEL_ID` | `config.js:36` | ID канала верификации |
| `VERIFICATION_MESSAGE_ID` | `config.js:37` | ID сообщения-верификации |
| `VERIFIED_ROLE_ID` | `config.js:38` | ID роли «Верифицирован» |
| `ROLE_TO_REMOVE_ON_VERIFICATION_ID` | `config.js:39` | ID роли, которую снимать при верификации |
| `JOKES_CHANNEL_ID` | `config.js:41` | ID канала для авто-шуток |

> 🔍 **Как узнать ID:** в Discord включите «Режим разработчика» (Настройки → Дополнительно), затем правой кнопкой по каналу/роли → «Копировать ID».

---

## 2. Welcome — приветствие новых участников

**Файл:** `cogs/welcome_cog.js`

### Роли при входе (строка 5)
```js
const ROLE_IDS = [
    '1354589782491009094',  // ← ID роли 1 (например, «Игрок»)
    '1303531755617390613'   // ← ID роли 2 (например, «Не верифицирован»)
];
```
Замените на ID ролей, которые нужно выдавать новым участникам.

### Баннер-изображение (строка 11)
```js
const WELCOME_BANNER_URL = 'https://...';  // ← ссылка на картинку
```
Замените на URL вашего баннера (PNG/JPG, желательно 512×376).

### Текст приветствия — файл `welcome_config.js`
```js
welcomeMessage: `**Основная информация}
    Ссылка на сайт - ◜Luxecs2.ru◞
    ...`
```
Меняйте текст, ссылки, названия каналов под свой сервер.

### Канал приветствия
В `welcome_config.js` → `channels.welcome: 'ID_канала'`.

---

## 3. Levels — уровни и XP

**Файл:** `cogs/levels_cog.js`

### Сколько XP за сообщение (строка 10)
```js
const COOLDOWN = 60;  // кулдаун между начислениями XP (секунды)
```
И в обработчике `messageCreate`:
```js
levels[userId].xp += 10;        // ← XP за сообщение
const newLevel = Math.floor(xp / 100);  // ← XP на уровень
```

### Цвета и названия рангов (строки 22-37)
```js
function getLevelColor(level) {
    if (level >= 50) return 0xFF2D55;  // цвет для уровня 50+
    if (level >= 40) return 0xAF52DE;  // ...
}
function getRankInfo(level) {
    if (level >= 50) return { title: 'Легенда', icon: '👑' };  // ← названия рангов
    // ...
}
```

### Дизайн ранг-карточки
**Файл:** `utils/cardBuilder.js` — весь рендер canvas. Меняйте:
- Размеры карточки (`W`, `H` — строки 14-15)
- Палитру цветов по уровням (`paletteForLevel` — строка 60)
- Шрифт (`fontFamily()` — строка 21)

---

## 4. FACEIT — авто-роли уровней

**Файл:** `cogs/faceit_cog.js`

### Время обновления (строка 29)
```js
const UPDATE_HOUR_UTC = 2;  // 02:00 UTC = 05:00 МСК
```
Меняйте час UTC под нужное время МСК (МСК = UTC + 3).

### Цвета ролей FACEIT (строки 38-49)
```js
const LEVEL_COLORS = {
    1:  0x8B8B8B,  // серый
    2:  0x4A90D9,  // синий
    // ...
    10: 0x7B2D8B   // фиолетовый (Master)
};
```

### Названия ролей (строка 35)
```js
const ROLE_PREFIX = 'FACEIT ';  // роли: «FACEIT 1», «FACEIT 2»...
```

### Игра для определения уровня
В `config.js` или `.env`:
```js
FACEIT_GAME = 'cs2';  // или 'csgo'
```

---

## 5. TopDonate — роли по донату

**Файл:** `cogs/topdonate_cog.js`

### Порог доната (строка 37)
```js
const DONATE_THRESHOLD = 2000;  // ← сумма в рублях для роли «Меценат»
```

### Названия ролей (строки 35-36)
```js
const ROLE_TOP = 'Меценат';       // роль для донатеров >= 2000₽
const ROLE_DONATOR = 'Донатер';   // роль для донатеров 1-1999₽
```

### Цвета ролей (строка 38)
```js
const ROLE_COLORS = { top: 0xFFD700, donator: 0x3498DB };  // золото, синий
```

### Время еженедельного обновления
В функции `scheduleWeeklyUpdate` — каждый день недели `0` (воскресенье), час `2` UTC.

---

## 6. Verification — верификация Steam

**Файл:** `cogs/verification_cog.js`

### Картинка верификации (строка 13)
```js
const VERIFICATION_IMAGE_URL = "https://i.yapx.ru/dVYOy.png";
```

### Текст сообщения верификации
В функции `createVerificationMessage` (строка ~383) — меняйте заголовки, описание, инструкции.

### Ссылка на сайт
```js
const PROJECT_URL = "https://luxecs2.ru/";
```

### VIP-ранги для сообщения
```js
const vipGroups = ['VIP', 'PREMIUM', 'ULTRA', 'CRYSTAL', 'SPONSOR'];
```

---

## 7. VIP — управление VIP-статусами

**Файл:** `cogs/vips_cog.js`

### Цвета ролей при авто-создании (строка ~449)
```js
color: 0xFFD700  // ← золото (в function client.once('clientReady'))
```

### Премиум-палитра отображения (строка 216)
```js
const THEME = {
    GOLD:      0xFFD700,
    PERMANENT: 0x57F287,
    // ...
};
```

### Иконки рангов (строка 221)
```js
function rankIcon(group) {
    if (g === 'SPONSOR') return '🏆';
    if (g === 'CRYSTAL') return '🔮';
    // ...
}
```

---

## 8. Jokes — шутки

**Файл:** `cogs/jokes_cog.js`

### Интервал отправки (строка 5)
```js
const JOKE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 часа — меняйте интервал
```

### Список шуток (строка 14)
```js
const JOKES = [
    { category: '🎮 CS2', text: "Ваш текст шутки..." },
    // добавляйте свои шутки в этом формате
];
```

### Цвета embed'а (строка 73)
```js
const JOKE_COLORS = [0x5865F2, 0x57F287, /* ... */];
```

---

## 9. ModLog — модерация и авто-фильтр

**Файл:** `cogs/mod_log_cog.js` + `modlog_config.json`

### Таймаут за нарушение (в `modlog_config.json`)
```json
{
  "timeout_minutes": 120  // ← длительность мьюта (минуты)
}
```

### Список запрещённых слов
В `modlog_config.json` → `"bad_words": [...]` и `"parent_insults": [...]`.
Добавляйте/удаляйте слова — список редактируется без правки кода.

### Игнорируемые каналы
Команда `/setignorechannel #канал` или вручную в `modlog_config.json` → `"ignored_channels": []`.

---

## 10. Notifications — уведомления о VIP

**Файл:** `cogs/notifications_cog.js`

### За сколько дней уведомлять (строка 31)
```js
const NOTIFY_THRESHOLDS = [3, 1, 0];  // за 3 дня, 1 день, в день истечения
```

### Интервал проверки (строка 29)
```js
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // раз в час
```

---

## 11. Admin — статистика админов

**Файл:** `cogs/admin_cog.js`

### Время ежедневной отправки статистики
В функции `setupDailyTask` — `targetTime.setHours(9, 0, 0, 0)` (9:00 — меняйте час).

### Премиум-палитра (строка 73)
```js
const THEME = {
    PRIMARY:   0x5865F2,
    ACTIVE:    0x57F287,
    // ...
};
```

---

## 12. Server — мониторинг серверов

**Файл:** `cogs/server_cog.js` + `servers.json`

### Список серверов
В `config.js` → `DEFAULT_SERVERS` (основные) или через `/add_server`.

### Интервал обновления
В `config.js` → `UPDATE_INTERVAL = 600` (секунды).

### Цвет embed'а (функция `createServerEmbed`)
Меняйте цвет статуса онлайн/офлайн.

---

## 13. Ping — статус системы

**Файл:** `cogs/ping_cog.js`

### Пороги задержки (строки 18-26)
```js
function latencyIcon(ms) {
    if (ms < 100) return '🟢';   // ← зелёный до 100мс
    if (ms < 250) return '🟡';   // ← жёлтый до 250мс
    return '🔴';                  // ← красный
}
```

### Ссылка на сайт (строка 7)
```js
const PROJECT_URL = 'https://luxecs2.ru/';
```

---

## ❓ Частые вопросы

**Q: Как поменять название ролей FACEIT?**
A: `cogs/faceit_cog.js` → `ROLE_PREFIX = 'FACEIT '` (строка 35).

**Q: Как убрать авто-модерацию (мат-фильтр)?**
A: Удалите файл `modlog_config.json` или очистите массивы `bad_words` и `parent_insults`.

**Q: Как изменить команду `/nabor` (текст объявления)?**
A: `cogs/nabor_cog.js` → объект `RECRUITMENT` в начале файла.

**Q: Где настроить подключение к БД донатов?**
A: Команда `/topdonat host user password database` — конфиг сохраняется в `topdonate_config.json`.

**Q: Как изменить аватарку/баннер в приветствии?**
A: `cogs/welcome_cog.js` → `WELCOME_BANNER_URL` (строка 11). Аватарка берётся автоматически из профиля Discord.

---

> 📖 Если что-то непонятно — откройте [issue на GitHub](https://github.com/patthsone/DiscordBot/issues).
