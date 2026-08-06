import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { ADMIN_ROLE_ID } from '../config.js';
import { createNamedPool, getNamedPool, closeNamedPool } from '../utils/database.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { getSteamProfileInfo, getSteamProfilesBulk } from '../utils/steam.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ADMIN_CONFIG_FILE = join(__dirname, '..', 'admin_config.json');

function decodeHtmlEntities(str) {
    if (!str) return str;
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code)))
        .replace(/&([a-z]+);/gi, (match, name) => {
            const entities = { hearts: '♥', spades: '♠', clubs: '♣', diams: '♦', star: '★', nbsp: ' ' };
            return entities[name.toLowerCase()] || match;
        });
}



function loadAdminConfig() {
    return loadJSON(ADMIN_CONFIG_FILE, null);
}

function saveAdminConfig(config) {
    saveJSON(ADMIN_CONFIG_FILE, config);
}

function steam64ToAccountId(steam64) {
    if (!steam64 || !/^\d+$/.test(steam64)) {
        return 0;
    }
    return BigInt(steam64) - BigInt(76561197960265728);
}

// getSteamProfileInfo импортируется из ../utils/steam.js
// (общий модуль с кешем, последовательной очередью и обработкой 429).

function formatTime(seconds) {
    if (seconds === 0) return "0 мин";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}ч ${minutes}мин`;
    }
    return `${minutes}мин`;
}

function formatTimestamp(timestamp) {
    if (timestamp === 0) return "Никогда";
    try {
        const dt = new Date(timestamp * 1000);
        return dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
        return "Неизвестно";
    }
}

// ─── Премиум-палитра (тёмная, индиго/фиолет акценты) ──────────────────────────
const THEME = {
    PRIMARY:   0x5865F2, // индиго (база)
    ACCENT:    0x9B59B6, // фиолет (акцент)
    ACTIVE:    0x57F287, // зелёный — активен
    INACTIVE:  0xED4245, // красный — неактивен
    MUTED:     0x99AAB5, // серый — вторичное
    DIVIDER:   '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯'
};

// ASCII-прогресс-бар онлайна. value в секундах, target — норма за период.
function progressBar(value, target) {
    const SEGMENTS = 10;
    const ratio = target > 0 ? Math.min(value / target, 1) : 0;
    const filled = Math.round(ratio * SEGMENTS);
    const bar = '▰'.repeat(filled) + '▱'.repeat(SEGMENTS - filled);
    const pct = Math.round(ratio * 100);
    return `${bar}  ${pct}%`;
}

async function checkAdminSystem() {
    const pool = getNamedPool('admin');
    if (!pool) return false;
    
    try {
        const [rows] = await pool.execute("SHOW TABLES LIKE 'as_admin_time'");
        return rows.length > 0;
    } catch (error) {
        console.error('Ошибка проверки AdminSystem:', error);
        return false;
    }
}

async function hasAccessToStatsCommand(interaction, allowedRoles) {
    try {
        const guild = interaction.guild;
        if (!guild) {
            console.log('[admin_stats_now] guild не найден');
            return false;
        }

        // Используем interaction.member напрямую - это надёжнее чем fetch()
        const member = interaction.member;
        
        if (!member) {
            console.log(`[admin_stats_now] member не найден для user ${interaction.user.id}`);
            return false;
        }

        const userRoles = member.roles.cache.map(r => r.id);
        console.log(`[admin_stats_now] user ${interaction.user.tag} (${interaction.user.id}) имеет роли: ${userRoles.join(', ')}`);
        console.log(`[admin_stats_now] allowedRoles из конфига: ${allowedRoles?.join(', ') || 'не заданы'}`);
        console.log(`[admin_stats_now] ADMIN_ROLE_ID из config.js: ${ADMIN_ROLE_ID}`);

        if (!allowedRoles || allowedRoles.length === 0) {
            const hasAdminRole = userRoles.includes(ADMIN_ROLE_ID);
            console.log(`[admin_stats_now] allowedRoles пуст, проверяем ADMIN_ROLE_ID: ${hasAdminRole}`);
            return hasAdminRole;
        }

        // Проверяем совпадение ролей
        const hasAllowedRole = userRoles.some(roleId => allowedRoles.includes(String(roleId)));
        const hasAdminRole = userRoles.includes(ADMIN_ROLE_ID);
        
        console.log(`[admin_stats_now] hasAllowedRole: ${hasAllowedRole}, hasAdminRole: ${hasAdminRole}`);
        
        return hasAllowedRole || hasAdminRole;

    } catch (error) {
        console.error('[admin_stats_now] Ошибка проверки доступа:', error);
        return false;
    }
}

async function connectAdminDb(host = null, user = null, password = null, database = null) {
    try {
        let config = null;
        
        if (host && user && password && database) {
            config = { host, user, password, database };
            // если меняем конфиг — переподключаемся к admin pool
            await closeNamedPool('admin');
        } else {
            config = loadAdminConfig();
            if (!config) {
                return { success: false, isAdminSystem: false };
            }
        }
        
        await createNamedPool('admin', config.host, config.user, config.password, config.database);
        
        const pool = getNamedPool('admin');
        const isAdminSystem = await checkAdminSystem();
        
        console.log(`Подключение к базе данных админов установлено успешно (AdminSystem: ${isAdminSystem})`);
        return { success: true, isAdminSystem };
    } catch (error) {
        console.error('Ошибка подключения к базе данных админов:', error);
        return { success: false, isAdminSystem: false };
    }
}

async function getAllAdmins() {
    const pool = getNamedPool('admin');
    if (!pool) return [];
    
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM as_admins WHERE steamid != '0' AND steamid IS NOT NULL"
        );
        return rows;
    } catch (error) {
        console.error('Ошибка получения всех админов:', error);
        return [];
    }
}

async function getAdminBySteamid(steamid) {
    const pool = getNamedPool('admin');
    if (!pool) return null;
    
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM as_admins WHERE steamid = ?",
            [steamid]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Ошибка получения админа по Steam ID:', error);
        return null;
    }
}

async function searchAdmin(searchTerm) {
    const pool = getNamedPool('admin');
    if (!pool) return [];
    
    try {
        if (/^\d{17}$/.test(searchTerm)) {
            const [rows] = await pool.execute(
                "SELECT * FROM as_admins WHERE steamid = ?",
                [searchTerm]
            );
            if (rows.length > 0) {
                return rows;
            }
        }
        
        const [rows] = await pool.execute(
            "SELECT * FROM as_admins WHERE (name LIKE ? OR comment LIKE ?) AND steamid != '0' AND steamid IS NOT NULL LIMIT 20",
            [`%${searchTerm}%`, `%${searchTerm}%`]
        );
        return rows;
    } catch (error) {
        console.error('Ошибка поиска админа:', error);
        return [];
    }
}

async function getAdminSessions(steamid, startTime, endTime) {
    const pool = getNamedPool('admin');
    if (!pool) return [];
    
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM as_admin_time WHERE admin_id = ? AND connect_time < ? AND (disconnect_time > ? OR disconnect_time = -1)",
            [steamid, endTime, startTime]
        );
        return rows;
    } catch (error) {
        console.error('Ошибка получения сессий админа:', error);
        return [];
    }
}

async function calculateOnlineTime(steamid, startTime, endTime, isAdminSystem) {
    if (!isAdminSystem) return 0;
    
    const sessions = await getAdminSessions(steamid, startTime, endTime);
    let totalSeconds = 0;
    
    for (const session of sessions) {
        const connectTime = session.connect_time || 0;
        let disconnectTime = session.disconnect_time || -1;
        
        if (disconnectTime === -1) {
            disconnectTime = endTime;
        }
        
        const sessionStart = Math.max(connectTime, startTime);
        const sessionEnd = Math.min(disconnectTime, endTime);
        
        if (sessionEnd > sessionStart) {
            totalSeconds += (sessionEnd - sessionStart);
        }
    }
    
    return totalSeconds;
}

async function getAdminLastVisit(steamid, isAdminSystem) {
    const pool = getNamedPool('admin');
    if (!pool) return 0;
    
    if (isAdminSystem) {
        try {
            const [rows] = await pool.execute(
                "SELECT MAX(disconnect_time) as last_visit FROM as_admin_time WHERE admin_id = ? AND disconnect_time != -1",
                [steamid]
            );
            if (rows[0] && rows[0].last_visit) {
                return rows[0].last_visit;
            }
        } catch (error) {
            console.error('Ошибка получения последнего визита:', error);
        }
    }
    
    return 0;
}

async function getAdminPunishmentsCount(steamid) {
    const pool = getNamedPool('admin');
    if (!pool) return { total: 0, active: 0 };
    
    try {
        const [adminRows] = await pool.execute(
            "SELECT id FROM as_admins WHERE steamid = ?",
            [steamid]
        );
        
        if (adminRows.length === 0) {
            return { total: 0, active: 0 };
        }
        
        const adminId = adminRows[0].id;
        const now = Math.floor(Date.now() / 1000);
        
        const [totalRows] = await pool.execute(
            "SELECT COUNT(*) as total FROM as_punishments WHERE admin_id = ?",
            [adminId]
        );
        const total = totalRows[0]?.total || 0;
        
        const [activeRows] = await pool.execute(
            "SELECT COUNT(*) as active FROM as_punishments WHERE admin_id = ? AND (expires > ? OR expires = 0)",
            [adminId, now]
        );
        const active = activeRows[0]?.active || 0;
        
        return { total, active };
    } catch (error) {
        console.error('Ошибка получения количества наказаний:', error);
        return { total: 0, active: 0 };
    }
}

async function createAdminDetailEmbed(adminData, steamInfo, isAdminSystem) {
    const steamid = adminData.steamid || '0';
    const name = steamInfo?.name || adminData.name || 'Unknown';
    const avatar = steamInfo?.avatar;
    const profileUrl = steamInfo?.profile_url || `https://steamcommunity.com/profiles/${steamid}`;
    const comment = adminData.comment;
    
    const now = Math.floor(Date.now() / 1000);
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const weekStart = todayStart - (7 * 24 * 3600);
    const monthStart = todayStart - (30 * 24 * 3600);
    
    const lastVisit = await getAdminLastVisit(steamid, isAdminSystem);
    
    let todayOnline = 0;
    let weekOnline = 0;
    let monthOnline = 0;
    if (isAdminSystem) {
        todayOnline = await calculateOnlineTime(steamid, todayStart, now, isAdminSystem);
        weekOnline = await calculateOnlineTime(steamid, weekStart, now, isAdminSystem);
        monthOnline = await calculateOnlineTime(steamid, monthStart, now, isAdminSystem);
    }
    
    const punishments = await getAdminPunishmentsCount(steamid);

    const activeThreshold = 7 * 24 * 3600;
    const isActive = lastVisit > 0 && (now - lastVisit) < activeThreshold;

    const displayName = decodeHtmlEntities(name);
    const displayComment = decodeHtmlEntities(comment);

    // Премиум-описание: статус-индикатор + комментарий + ссылка на профиль
    const statusBadge = isActive ? '🟢 **Активен**' : '🔴 **Неактивен**';
    const lastVisitRel = lastVisit > 0
        ? `<t:${lastVisit}:R>`
        : '`Никогда`';

    const descParts = [
        `### ${displayName}`,
        statusBadge,
        comment ? `> 💬 ${displayComment}` : null,
        `> 🔗 [Профиль Steam](${profileUrl})`
    ].filter(Boolean).join('\n');

    const embed = new EmbedBuilder()
        .setDescription(descParts)
        .setColor(isActive ? THEME.ACTIVE : THEME.INACTIVE)
        .setTimestamp();

    if (avatar) embed.setThumbnail(avatar);

    // Активность и посещаемость
    embed.addFields(
        { name: '📅 Последний визит', value: lastVisitRel, inline: true },
        { name: '⚖️ Наказаний', value: `**${punishments.total}** · ${punishments.active} акт.`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true }
    );

    if (isAdminSystem) {
        // Норма для прогресс-бара: условно 14ч/нед (админ-актив). Масштабирует бар.
        const WEEK_TARGET = 14 * 3600;
        const MONTH_TARGET = 56 * 3600;

        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: '⏱️ Онлайн сегодня', value: `\`${formatTime(todayOnline) || '0 мин'}\``, inline: true },
            { name: '📆 За неделю', value: `\`${formatTime(weekOnline) || '0 мин'}\``, inline: true },
            { name: '🗓️ За месяц', value: `\`${formatTime(monthOnline) || '0 мин'}\``, inline: true },
            { name: '📊 Активность (неделя)', value: `\`${progressBar(weekOnline, WEEK_TARGET)}\``, inline: false },
            { name: '📊 Активность (месяц)', value: `\`${progressBar(monthOnline, MONTH_TARGET)}\``, inline: false }
        );
    } else {
        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: '⚠️ AdminSystem', value: '`Не подключён — статистика онлайна недоступна`', inline: false }
        );
    }

    embed.setFooter({
        text: `🆔 ${steamid}  ·  Детальная статистика`,
        iconURL: avatar || undefined
    });

    return embed;
}


async function getAllAdminsLastVisit() {
    const pool = getNamedPool('admin');
    if (!pool) return {};
    try {
        const [rows] = await pool.execute(
            "SELECT admin_id, MAX(disconnect_time) as last_visit FROM as_admin_time WHERE disconnect_time != -1 GROUP BY admin_id"
        );
        const map = {};
        for (const row of rows) map[row.admin_id] = row.last_visit;
        return map;
    } catch (error) {
        console.error('Ошибка bulk last_visit:', error);
        return {};
    }
}

async function getAllAdminsOnlineTime(startTime, endTime) {
    const pool = getNamedPool('admin');
    if (!pool) return {};
    try {
        const now = Math.floor(Date.now() / 1000);
        const [rows] = await pool.execute(
            `SELECT admin_id,
                SUM(LEAST(IF(disconnect_time = -1, ?, disconnect_time), ?) - GREATEST(connect_time, ?)) as online_seconds
             FROM as_admin_time
             WHERE connect_time < ? AND (disconnect_time > ? OR disconnect_time = -1)
             GROUP BY admin_id`,
            [now, endTime, startTime, endTime, startTime]
        );
        const map = {};
        for (const row of rows) {
            if (row.online_seconds > 0) map[row.admin_id] = row.online_seconds;
        }
        return map;
    } catch (error) {
        console.error('Ошибка bulk online time:', error);
        return {};
    }
}

const PAGE_SIZE = 5;

function buildPageEmbed(activeAdmins, inactiveAdmins, allAdmins, page, isAdminSystem, avatars = new Map()) {
    const totalOnlineWeek = activeAdmins.reduce((s, a) => s + (a.weekOnline || 0), 0);
    const allPaged = [...activeAdmins, ...inactiveAdmins];
    const totalPages = Math.max(1, Math.ceil(allPaged.length / PAGE_SIZE));
    const pageAdmins = allPaged.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const activeSet = new Set(activeAdmins.map(a => a.steamid));

    // Превью-аватарка — у первого (топового) админа на странице, если есть.
    const firstWithAvatar = pageAdmins.find(a => avatars.get(a.steamid)?.avatar);
    const topAvatar = firstWithAvatar ? avatars.get(firstWithAvatar.steamid)?.avatar : null;

    // Заголовок-сводка в премиум-стиле
    const summary =
        `> 📊 **Всего:** \`${allAdmins.length}\`　` +
        `🟢 **Активных:** \`${activeAdmins.length}\`　` +
        `🔴 **Неактивных:** \`${inactiveAdmins.length}\`` +
        (isAdminSystem ? `\n> ⏱️ **Онлайн за неделю:** \`${formatTime(totalOnlineWeek)}\`` : '');

    const embed = new EmbedBuilder()
        .setTitle('🛡️  Статистика администрации')
        .setDescription(summary)
        .setColor(THEME.PRIMARY)
        .setTimestamp();

    if (topAvatar) embed.setThumbnail(topAvatar);

    for (let i = 0; i < pageAdmins.length; i++) {
        const admin = pageAdmins[i];
        const globalIndex = page * PAGE_SIZE + i;
        const isActive = activeSet.has(admin.steamid);

        const medal = globalIndex === 0 ? '🥇' : globalIndex === 1 ? '🥈' : globalIndex === 2 ? '🥉' : (isActive ? '🟢' : '🔴');
        const displayName = decodeHtmlEntities(admin.name) || 'Unknown';
        const avatarInfo = avatars.get(admin.steamid);
        const statusTag = isActive ? '`🟢 Активен`' : '`🔴 Неактивен`';

        // Имя с иконкой-точкой статуса + ссылка
        const nameField = `${medal}  [${displayName}](${admin.profile_url})`;

        // Компактная строка статистики
        let statLine = statusTag;
        if (isAdminSystem) {
            statLine += `  ·  📅 ${admin.lastVisit > 0 ? `<t:${admin.lastVisit}:R>` : '`Никогда`'}`;
            if (admin.weekOnline > 0) statLine += `  ·  ⏱️ \`${formatTime(admin.weekOnline)}/нед\``;
        } else {
            statLine += '\n> ⚠️ `AdminSystem не подключён`';
        }

        let value = statLine;
        if (admin.comment) {
            value += `\n> 💬 ${decodeHtmlEntities(admin.comment)}`;
        }

        embed.addFields({ name: nameField, value, inline: false });
    }

    embed.setFooter({ text: `Страница ${page + 1} / ${totalPages}  ·  🕐 Обновлено` });

    return { embed, totalPages };
}

function buildPaginationRow(page, totalPages) {
    const prev = new ButtonBuilder()
        .setCustomId(`stats_page_${page - 1}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0);

    const counter = new ButtonBuilder()
        .setCustomId('stats_page_noop')
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true);

    const next = new ButtonBuilder()
        .setCustomId(`stats_page_${page + 1}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1);

    const refresh = new ButtonBuilder()
        .setCustomId('stats_refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(prev, counter, next, refresh);
}

async function generateStatsEmbed(isAdminSystem) {
    const pool = getNamedPool('admin');
    if (!pool) {
        return {
            embed: new EmbedBuilder()
                .setTitle('❌ Ошибка')
                .setDescription('База данных не подключена.')
                .setColor(0xFF0000),
            adminsData: [],
            activeAdmins: [],
            inactiveAdmins: []
        };
    }
    
    const admins = await getAllAdmins();
    
    if (admins.length === 0) {
        return {
            embed: new EmbedBuilder()
                .setTitle('📊 Статистика админов')
                .setDescription('Админы не найдены в базе данных.')
                .setColor(0xFFA500),
            adminsData: [],
            activeAdmins: [],
            inactiveAdmins: []
        };
    }
    
    const now = Math.floor(Date.now() / 1000);
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const weekStart = todayStart - (7 * 24 * 3600);
    const activeThreshold = 7 * 24 * 3600;
    
    const validAdmins = admins.filter(a => a.steamid && a.steamid !== '0');
    
    // 3 запроса вместо 162 — получаем всё за один раз
    let lastVisitMap = {};
    let todayOnlineMap = {};
    let weekOnlineMap = {};
    if (isAdminSystem) {
        [lastVisitMap, todayOnlineMap, weekOnlineMap] = await Promise.all([
            getAllAdminsLastVisit(),
            getAllAdminsOnlineTime(todayStart, now),
            getAllAdminsOnlineTime(weekStart, now)
        ]);
    }
    
    const allAdminsData = validAdmins.map(admin => {
        const steamid = admin.steamid;
        const name = admin.name || 'Unknown';
        return {
            name,
            profile_url: `https://steamcommunity.com/profiles/${steamid}`,
            comment: admin.comment,
            lastVisit: lastVisitMap[steamid] || 0,
            todayOnline: todayOnlineMap[steamid] || 0,
            weekOnline: weekOnlineMap[steamid] || 0,
            steamid,
            originalName: name
        };
    });
    
    const activeAdmins = [];
    const inactiveAdmins = [];
    
    for (const adminData of allAdminsData) {
        if (isAdminSystem) {
            if (adminData.lastVisit > 0 && (now - adminData.lastVisit) < activeThreshold) {
                activeAdmins.push(adminData);
            } else {
                inactiveAdmins.push(adminData);
            }
        } else {
            activeAdmins.push(adminData);
        }
    }
    
    activeAdmins.sort((a, b) => b.weekOnline - a.weekOnline);
    inactiveAdmins.sort((a, b) => b.lastVisit - a.lastVisit);

    // Массово подгружаем аватарки/имена из Steam для текущей страницы (один API-вызов).
    const allPaged = [...activeAdmins, ...inactiveAdmins];
    const firstPageIds = allPaged.slice(0, PAGE_SIZE).map(a => a.steamid);
    const avatars = await getSteamProfilesBulk(firstPageIds).catch(() => new Map());

    const { embed } = buildPageEmbed(activeAdmins, inactiveAdmins, admins, 0, isAdminSystem, avatars);

    return { embed, adminsData: allAdminsData, activeAdmins, inactiveAdmins, avatars };
}

export default function(client) {
    let statsChannelId = null;
    let isAdminSystem = false;
    let dailyTaskInterval = null;
    
    client.once('clientReady', async () => {
        await client.application.commands.create({
            name: 'admin_stats',
            description: 'Настройка статистики админов',
            options: [
                { name: 'host', type: 3, description: 'Хост базы данных', required: true },
                { name: 'user', type: 3, description: 'Имя пользователя', required: true },
                { name: 'password', type: 3, description: 'Пароль', required: true },
                { name: 'database', type: 3, description: 'Название базы данных', required: true },
                { name: 'channel', type: 7, description: 'Канал для отправки статистики', required: true },
                { name: 'allowed_roles', type: 3, description: 'ID ролей с доступом к /admin_stats_now (через запятую, например: 123456789,987654321)', required: false }
            ]
        });
        
        await client.application.commands.create({
            name: 'admin_stats_now',
            description: 'Отправить статистику админов сейчас'
        });
        
        await client.application.commands.create({
            name: 'admin_info',
            description: 'Просмотр статистики конкретного администратора',
            options: [
                { name: 'search', type: 3, description: 'Steam ID или имя администратора для поиска', required: true }
            ]
        });
        
        const config = loadAdminConfig();
        if (config) {
            console.log('Загрузка конфигурации базы данных админов из файла...');
            console.log(`Конфигурация: host=${config.host}, database=${config.database}, channel=${config.stats_channel_id || 'не указан'}`);
            if (config.allowed_roles && config.allowed_roles.length > 0) {
                console.log(`Разрешенные роли для /admin_stats_now: ${config.allowed_roles.join(', ')}`);
            } else {
                console.log('Разрешенные роли для /admin_stats_now: не указаны (только администраторы)');
            }
            const result = await connectAdminDb(
                config.host,
                config.user,
                config.password,
                config.database
            );
            isAdminSystem = result.isAdminSystem;
            
            if (result.success) {
                console.log(`✅ Подключение к базе данных админов установлено успешно (AdminSystem: ${isAdminSystem})`);
                
                if (config.stats_channel_id) {
                    statsChannelId = config.stats_channel_id;
                    console.log(`Конфигурация базы данных админов загружена. ID канала: ${statsChannelId}`);
                    
                    if (statsChannelId) {
                        setupDailyTask(client, statsChannelId, isAdminSystem);
                        console.log('Ежедневная задача статистики админов запущена.');
                    }
                } else {
                    console.log('⚠️ Канал статистики не указан в конфигурации. Команды будут работать, но ежедневная статистика не будет отправляться.');
                }
            } else {
                console.log('❌ Не удалось подключиться к базе данных админов при загрузке конфигурации.');
            }
        } else {
            console.log('⚠️ Конфигурация базы данных админов не найдена. Используйте команду /admin_stats для настройки.');
        }
    });
    
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'admin_stats') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);
        
        if (interaction.commandName === 'admin_stats') {
            if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                await interaction.reply({
                    content: '❌ У вас нет прав для выполнения этой команды.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                const host = interaction.options.getString('host');
                const user = interaction.options.getString('user');
                const password = interaction.options.getString('password');
                const database = interaction.options.getString('database');
                const channel = interaction.options.getChannel('channel');
                const allowedRolesString = interaction.options.getString('allowed_roles');
                
                const result = await connectAdminDb(host, user, password, database);
                isAdminSystem = result.isAdminSystem;
                
                if (result.success) {
                    statsChannelId = channel.id;
                    
                    const config = {
                        host,
                        user,
                        password,
                        database,
                        stats_channel_id: channel.id
                    };
                    
                    if (allowedRolesString) {
                        const roleIds = allowedRolesString.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));
                        if (roleIds.length > 0) {
                            config.allowed_roles = roleIds;
                        } else {
                            await interaction.followUp({
                                content: '❌ Неверный формат ID ролей. Используйте формат: 123456789,987654321'
                            });
                            return;
                        }
                    }
                    
                    saveAdminConfig(config);
                    
                    if (dailyTaskInterval) {
                        clearInterval(dailyTaskInterval);
                    }
                    
                    setupDailyTask(client, statsChannelId, isAdminSystem);
                    
                    let rolesText = 'Не указаны (только администраторы)';
                    if (config.allowed_roles && config.allowed_roles.length > 0) {
                        const roles = config.allowed_roles.map(id => `<@&${id}>`).join(', ');
                        rolesText = roles;
                    }
                    
                    await interaction.followUp({
                        content: `✅ Настройки сохранены!\n` +
                            `База данных: \`${database}\`\n` +
                            `Канал статистики: ${channel}\n` +
                            `Роли с доступом: ${rolesText}\n` +
                            `AdminSystem: ${isAdminSystem ? '✅' : '❌'}\n` +
                            `Конфигурация сохранена и будет загружена при следующем запуске.`
                    });
                } else {
                    await interaction.followUp({
                        content: '❌ Не удалось подключиться к базе данных. Проверьте параметры подключения.'
                    });
                }
            } catch (error) {
                console.error('Ошибка в команде admin_stats:', error);
                await interaction.followUp({
                    content: `❌ Произошла ошибка: ${error.message}`
                });
            }
        }
    });
    
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'admin_stats_now') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);
        
        if (interaction.commandName === 'admin_stats_now') {
            const config = loadAdminConfig();
            
            // Используем stats_allowed_roles если заданы, иначе fallback на ADMIN_ROLE_ID
            let allowedRoles = config?.stats_allowed_roles?.length > 0
                ? config.stats_allowed_roles
                : [];
            if (ADMIN_ROLE_ID && !allowedRoles.includes(ADMIN_ROLE_ID)) {
                allowedRoles = [...allowedRoles, ADMIN_ROLE_ID];
            }
            
            // Сначала defer — до любых async проверок, иначе истекает таймаут Discord (3 сек)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            console.log(`[admin_stats_now] Проверка прав для ${interaction.user.tag}`);
            console.log(`[admin_stats_now] Разрешённые роли (включая ADMIN_ROLE_ID): ${allowedRoles.join(', ')}`);
            
            if (!(await hasAccessToStatsCommand(interaction, allowedRoles))) {
                await interaction.editReply({
                    content: '❌ У вас нет прав для выполнения этой команды.'
                });
                return;
            }
            
            let pool = getNamedPool('admin');
            if (!pool) {
                const config = loadAdminConfig();
                if (config) {
                    console.log('Попытка переподключения к базе данных админов...');
                    const result = await connectAdminDb(
                        config.host,
                        config.user,
                        config.password,
                        config.database
                    );
                    isAdminSystem = result.isAdminSystem;
                    pool = getNamedPool('admin');
                }
            }
            
            if (!pool) {
                await interaction.editReply({
                    content: '❌ База данных не подключена. Используйте `/admin_stats` для настройки.'
                });
                return;
            }
            
            isAdminSystem = await checkAdminSystem();
            
            try {
                const { embed, activeAdmins, inactiveAdmins, adminsData } = await generateStatsEmbed(isAdminSystem);
                const totalPages = Math.ceil((activeAdmins.length + inactiveAdmins.length) / PAGE_SIZE);
                const paginationRow = buildPaginationRow(0, totalPages);

                // Select menu для выбора конкретного админа
                const rows = [paginationRow];
                if (adminsData.length > 0) {
                    const select = new StringSelectMenuBuilder()
                        .setCustomId('admin_select')
                        .setPlaceholder('🔍 Выберите администратора для детальной статистики...')
                        .setMinValues(1).setMaxValues(1);
                    for (const admin of adminsData.slice(0, 25)) {
                        const raw = decodeHtmlEntities(admin.name);
                        const label = raw.length > 100 ? raw.substring(0, 97) + '...' : raw;
                        select.addOptions({ label, value: admin.steamid, description: `Steam: ${admin.steamid}` });
                    }
                    rows.push(new ActionRowBuilder().addComponents(select));
                }

                await interaction.editReply({ embeds: [embed], components: rows });
            } catch (error) {
                console.error('Ошибка в команде admin_stats_now:', error);
                await interaction.editReply({
                    content: `❌ Произошла ошибка при генерации статистики: ${error.message}`
                });
            }
        }
    });
    
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'admin_info') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);
        
        if (interaction.commandName === 'admin_info') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            let pool = getNamedPool('admin');
            if (!pool) {
                const config = loadAdminConfig();
                if (config) {
                    console.log('Попытка переподключения к базе данных админов...');
                    const result = await connectAdminDb(
                        config.host,
                        config.user,
                        config.password,
                        config.database
                    );
                    isAdminSystem = result.isAdminSystem;
                    pool = getNamedPool('admin');
                }
            }
            
            if (!pool) {
                await interaction.followUp({
                    content: '❌ База данных не подключена. Используйте `/admin_stats` для настройки.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            
            isAdminSystem = await checkAdminSystem();
            
            try {
                const search = interaction.options.getString('search');
                const results = await searchAdmin(search);
                
                if (results.length === 0) {
                    await interaction.followUp({
                        content: `❌ Администратор '${search}' не найден в базе данных.`
                    });
                    return;
                }
                
                if (results.length === 1) {
                    const adminData = results[0];
                    const steamid = adminData.steamid || '0';
                    
                    if (steamid === '0' || !steamid) {
                        await interaction.followUp({
                            content: '❌ У этого администратора не указан Steam ID.'
                        });
                        return;
                    }
                    
                    const steamInfo = await getSteamProfileInfo(steamid);
                    const embed = await createAdminDetailEmbed(adminData, steamInfo, isAdminSystem);
                    await interaction.followUp({ embeds: [embed] });
                } else {
                    const embed = new EmbedBuilder()
                        .setTitle('🔍 Найдено несколько администраторов')
                        .setDescription(
                            `> Найдено **${results.length}** совпадений.\n` +
                            `> Уточните запрос или используйте точный **Steam ID**.`
                        )
                        .setColor(THEME.ACCENT)
                        .setTimestamp();

                    const adminList = results.slice(0, 10).map((admin, i) => {
                        const steamid = admin.steamid || '0';
                        const name = decodeHtmlEntities(admin.name) || 'Unknown';
                        const comment = admin.comment ? decodeHtmlEntities(admin.comment) : '';
                        const commentText = comment ? `\n> 💬 ${comment}` : '';
                        return `**${i + 1}.** [${name}](https://steamcommunity.com/profiles/${steamid})\n> 🆔 \`${steamid}\`${commentText}`;
                    });

                    embed.addFields({
                        name: '📋 Результаты',
                        value: adminList.join('\n\n'),
                        inline: false
                    });

                    embed.setFooter({ text: 'Совет: введите 17-значный Steam ID для точного поиска' });
                    await interaction.followUp({ embeds: [embed] });
                }
            } catch (error) {
                console.error('Ошибка в команде admin_info:', error);
                await interaction.followUp({
                    content: `❌ Произошла ошибка: ${error.message}`
                });
            }
        }
    });
    
    // Обработчик кнопок пагинации
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const isPage = interaction.customId.startsWith('stats_page_');
        const isRefresh = interaction.customId === 'stats_refresh';
        if (!isPage && !isRefresh) return;

        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        await interaction.deferUpdate();

        try {
            let pool = getNamedPool('admin');
            if (!pool) {
                const cfg = loadAdminConfig();
                if (cfg) {
                    const result = await connectAdminDb(cfg.host, cfg.user, cfg.password, cfg.database);
                    isAdminSystem = result.isAdminSystem;
                    pool = getNamedPool('admin');
                }
            }
            if (!pool) return;

            isAdminSystem = await checkAdminSystem();
            const { activeAdmins, inactiveAdmins, adminsData } = await generateStatsEmbed(isAdminSystem);
            const totalPages = Math.max(1, Math.ceil((activeAdmins.length + inactiveAdmins.length) / PAGE_SIZE));

            let page = 0;
            if (isPage) {
                page = parseInt(interaction.customId.replace('stats_page_', ''), 10);
                page = Math.max(0, Math.min(page, totalPages - 1));
            }

            // Аватарки для запрашиваемой страницы
            const allPaged = [...activeAdmins, ...inactiveAdmins];
            const pageIds = allPaged.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(a => a.steamid);
            const pageAvatars = await getSteamProfilesBulk(pageIds).catch(() => new Map());

            const { embed } = buildPageEmbed(activeAdmins, inactiveAdmins,
                allPaged, page, isAdminSystem, pageAvatars);
            const paginationRow = buildPaginationRow(page, totalPages);

            const rows = [paginationRow];
            if (adminsData.length > 0) {
                const select = new StringSelectMenuBuilder()
                    .setCustomId('admin_select')
                    .setPlaceholder('🔍 Выберите администратора для детальной статистики...')
                    .setMinValues(1).setMaxValues(1);
                for (const admin of adminsData.slice(0, 25)) {
                    const raw = decodeHtmlEntities(admin.name);
                    const label = raw.length > 100 ? raw.substring(0, 97) + '...' : raw;
                    select.addOptions({ label, value: admin.steamid, description: `Steam: ${admin.steamid}` });
                }
                rows.push(new ActionRowBuilder().addComponents(select));
            }

            await interaction.editReply({ embeds: [embed], components: rows });
        } catch (error) {
            console.error('Ошибка пагинации:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'admin_select') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);
        
        if (interaction.customId === 'admin_select') {
            const selectedSteamid = interaction.values[0];
            
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            try {
                let pool = getNamedPool('admin');
                if (!pool) {
                    const config = loadAdminConfig();
                    if (config) {
                        console.log('Попытка переподключения к базе данных админов...');
                        const result = await connectAdminDb(
                            config.host,
                            config.user,
                            config.password,
                            config.database
                        );
                        isAdminSystem = result.isAdminSystem;
                        pool = getNamedPool('admin');
                    }
                }
                
                if (!pool) {
                    await interaction.editReply({
                        content: '❌ База данных не подключена. Используйте `/admin_stats` для настройки.'
                    });
                    return;
                }
                
                isAdminSystem = await checkAdminSystem();
                
                const adminData = await getAdminBySteamid(selectedSteamid);
                if (!adminData) {
                    await interaction.editReply({
                        content: '❌ Администратор не найден.'
                    });
                    return;
                }
                
                const steamInfo = await getSteamProfileInfo(selectedSteamid);
                const embed = await createAdminDetailEmbed(adminData, steamInfo, isAdminSystem);
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('Ошибка показа деталей админа:', error);
                try {
                    await interaction.editReply({
                        content: `❌ Произошла ошибка при загрузке статистики: ${error.message}`
                    });
                } catch (_) {}
            }
        }
    });
    
    function setupDailyTask(client, channelId, isAdminSystemFlag) {
        const sendDailyStats = async () => {
            const channel = client.channels.cache.get(channelId);
            if (!channel) {
                console.log(`Канал статистики ${channelId} не найден`);
                return;
            }
            
            try {
                const { embed } = await generateStatsEmbed(isAdminSystemFlag);
                await channel.send({ embeds: [embed] });
                console.log(`Ежедневная статистика админов отправлена в ${channel.name}`);
            } catch (error) {
                console.error('Ошибка отправки ежедневной статистики:', error);
            }
        };
        
        const now = new Date();
        const targetTime = new Date();
        targetTime.setHours(9, 0, 0, 0);
        
        if (targetTime < now) {
            targetTime.setDate(targetTime.getDate() + 1);
        }
        
        const msUntilTarget = targetTime.getTime() - now.getTime();
        
        setTimeout(() => {
            sendDailyStats();
            dailyTaskInterval = setInterval(sendDailyStats, 24 * 60 * 60 * 1000);
        }, msUntilTarget);
        
        console.log(`Ежедневная задача статистики запланирована на ${targetTime.toLocaleString('ru-RU')}`);
    }
}

