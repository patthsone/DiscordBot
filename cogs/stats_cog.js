/**
 * stats_cog.js — HTTP-сервер статистики бота
 *
 * Запускает express-сервер на STATS_PORT и отдаёт живую статистику:
 *   • GET /            → приветствие
 *   • GET /stats       → JSON со статистикой (для shields.io и интеграций)
 *   • GET /badge/:metric → эндпоинт-обёртка для shields.io dynamic badges
 *
 * Также ведёт журнал установок бота на серверы (guildCreate/guildDelete):
 *   • кто добавил бота (user tag, id)
 *   • когда добавил/кинул
 *   • имя сервера, кол-во участников
 *
 * Журнал хранится в stats_history.json (персистентно).
 *
 * Используется README.md репозитория для отображения бейджей:
 *   ![servers](https://img.shields.io/endpoint?url=https://ip:port/badge/servers)
 */

import express from 'express';
import { STATS_PORT, STATS_TOKEN } from '../config.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadavg } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HISTORY_FILE = join(__dirname, '..', 'stats_history.json');

// ─── Журнал установок ───────────────────────────────────────────────────────
// { installs: [{ guildId, guildName, addedByTag, addedById, addedAt, memberCount }],
//   removals: [{ guildId, guildName, removedByTag, removedById, removedAt }] }

function loadHistory() {
    return loadJSON(HISTORY_FILE, { installs: [], removals: [] });
}

function saveHistory(history) {
    saveJSON(HISTORY_FILE, history);
}

// Записать установку бота на сервер
function recordInstall(guild, user) {
    const history = loadHistory();
    // Не дублируем, если уже есть запись для этого guildId
    const existingIdx = history.installs.findIndex(i => i.guildId === guild.id);
    const entry = {
        guildId: guild.id,
        guildName: guild.name,
        addedByTag: user?.tag || 'неизвестно',
        addedById: user?.id || null,
        addedAt: new Date().toISOString(),
        memberCount: guild.memberCount || 0
    };
    if (existingIdx >= 0) {
        history.installs[existingIdx] = entry; // обновляем (повторная установка)
    } else {
        history.installs.push(entry);
    }
    saveHistory(history);
}

// Записать удаление бота с сервера
function recordRemoval(guild, user) {
    const history = loadHistory();
    history.removals.push({
        guildId: guild.id,
        guildName: guild?.name || 'неизвестно',
        removedByTag: user?.tag || 'неизвестно',
        removedById: user?.id || null,
        removedAt: new Date().toISOString()
    });
    // Убираем из активных установок
    history.installs = history.installs.filter(i => i.guildId !== guild.id);
    saveHistory(history);
}

// ─── Сбор статистики ────────────────────────────────────────────────────────
function getStats(client) {
    const mem = process.memoryUsage();
    const uptimeSec = process.uptime();
    const history = loadHistory();

    // Активные серверы из кэша Discord (реальный источник правды)
    const guilds = client.guilds.cache;
    const totalMembers = guilds.reduce((sum, g) => sum + (g.memberCount || 0), 0);

    return {
        bot: {
            tag: client.user?.tag || 'unknown',
            id: client.user?.id || 'unknown',
            avatar: client.user?.displayAvatarURL?.({ extension: 'png' }) || null
        },
        servers: guilds.size,
        users: totalMembers,
        channels: client.channels.cache.size,
        uptimeSeconds: Math.floor(uptimeSec),
        uptimeFormatted: formatUptime(uptimeSec),
        memory: {
            heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
            heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1)
        },
        nodeVersion: process.version,
        cpuLoadavg: loadavg(),
        ping: Math.round(client.ws.ping),
        // История установок
        installs: {
            total: history.installs.length,
            recent: history.installs.slice(-10).reverse()
        },
        removals: {
            total: history.removals.length,
            recent: history.removals.slice(-5).reverse()
        },
        timestamp: new Date().toISOString()
    };
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}д`);
    if (h > 0) parts.push(`${h}ч`);
    parts.push(`${m}м`);
    if (d === 0) parts.push(`${s}с`);
    return parts.join(' ');
}

// ─── Проверка токена доступа ────────────────────────────────────────────────
function checkToken(req) {
    if (!STATS_TOKEN) return true; // токен не задан — публичный доступ
    return req.query.token === STATS_TOKEN;
}

// ─── Cog ────────────────────────────────────────────────────────────────────
export default function(client) {
    const app = express();

    // JSON-парсер (для потенциальных POST в будущем)
    app.use(express.json());

    // CORS — чтобы shields.io и сторонние сервисы могли тянуть данные
    app.use((req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    // ── Главная страница ──
    app.get('/', (req, res) => {
        res.type('text/plain').send(
            `LuxeCS2 Discord Bot — статистика\n\n` +
            `Эндпоинты:\n` +
            `  /stats        — JSON со статистикой бота\n` +
            `  /badge/:metric — обёртка для shields.io бейджей\n` +
            `                   metrics: servers, users, uptime, ping\n` +
            (STATS_TOKEN ? `\n  ⚠️ Требуется ?token=...\n` : '')
        );
    });

    // ── Полная статистика (JSON) ──
    app.get('/stats', (req, res) => {
        if (!checkToken(req)) {
            return res.status(403).json({ error: 'Неверный или отсутствующий токен. Укажите ?token=...' });
        }
        try {
            res.json(getStats(client));
        } catch (err) {
            console.error('stats: ошибка /stats:', err.message);
            res.status(500).json({ error: 'Внутренняя ошибка' });
        }
    });

    // ── Обёртка для shields.io dynamic badges ──
    // https://img.shields.io/endpoint?url=https://ip:port/badge/servers
    app.get('/badge/:metric', (req, res) => {
        if (!checkToken(req)) {
            return res.status(403).json({ error: 'token required' });
        }
        const { metric } = req.params;
        try {
            const stats = getStats(client);
            let label, message, color;

            switch (metric) {
                case 'servers':
                    label = 'Серверов'; message = `${stats.servers}`; color = 'blue';
                    break;
                case 'users':
                    label = 'Пользователей'; message = stats.users.toLocaleString('ru-RU'); color = 'green';
                    break;
                case 'uptime':
                    label = 'Аптайм'; message = stats.uptimeFormatted; color = 'orange';
                    break;
                case 'ping':
                    label = 'Пинг'; message = `${stats.ping} мс`;
                    color = stats.ping < 100 ? 'brightgreen' : stats.ping < 250 ? 'yellow' : 'red';
                    break;
                case 'installs':
                    label = 'Установок'; message = `${stats.installs.total}`; color = 'blueviolet';
                    break;
                default:
                    return res.status(404).json({ error: `Неизвестная метрика: ${metric}. Доступно: servers, users, uptime, ping, installs` });
            }

            // Формат shields.io endpoint
            res.json({ schemaVersion: 1, label, message, color, cacheSeconds: 60 });
        } catch (err) {
            console.error('stats: ошибка /badge:', err.message);
            res.status(500).json({ error: 'Внутренняя ошибка' });
        }
    });

    // ── Проверка здоровья (для uptime-мониторинга) ──
    app.get('/health', (req, res) => {
        res.json({ ok: true, uptime: Math.floor(process.uptime()) });
    });

    // ─── Запуск сервера ─────────────────────────────────────────────────────
    client.once('clientReady', () => {
        try {
            app.listen(STATS_PORT, () => {
                console.log(`📊 Stats-сервер запущен на порту ${STATS_PORT} (/stats, /badge/:metric)`);
                if (STATS_TOKEN) console.log('📊 Stats: включена защита токеном');
            });
        } catch (err) {
            console.error('❌ Stats-сервер: не удалось запустить:', err.message);
        }

        console.log('✅ Stats cog загружен');
    });

    // ─── Трекинг установок/удалений бота ────────────────────────────────────
    // Событие приходит, когда бот добавляется на новый сервер.
    // audit log даёт информацию о том, кто добавил бота.
    client.on('guildCreate', async (guild) => {
        console.log(`📥 Бот добавлен на сервер: ${guild.name} (${guild.memberCount} участников)`);

        // Пытаемся узнать, кто добавил бота (через audit log, если есть права)
        let addedBy = null;
        try {
            const me = guild.members.me;
            if (me?.permissions?.has('ViewAuditLog')) {
                const logs = await guild.fetchAuditLogs({ limit: 5, type: 28 }); // BOT_ADD = 28
                const entry = logs.entries.find(e => e.target?.id === client.user.id);
                if (entry) addedBy = entry.executor;
            }
        } catch (err) {
            console.error('stats: не удалось получить audit log установки:', err.message);
        }

        try {
            recordInstall(guild, addedBy);
        } catch (err) {
            console.error('stats: ошибка записи установки:', err.message);
        }
    });

    // Событие приходит, когда бот удаляется с сервера.
    client.on('guildDelete', async (guild) => {
        console.log(`📤 Бот удалён с сервера: ${guild.name}`);

        // Кто удалил — узнать нельзя (бот уже не на сервере). Записываем факт.
        try {
            recordRemoval(guild, null);
        } catch (err) {
            console.error('stats: ошибка записи удаления:', err.message);
        }
    });
}
