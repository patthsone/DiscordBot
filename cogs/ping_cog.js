import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DEFAULT_SERVERS } from '../config.js';
import { getNamedPool } from '../utils/database.js';
import { getServerInfo } from '../utils/serverMonitor.js';
import { loadavg } from 'node:os';

const PROJECT_URL = 'https://luxecs2.ru/';

// ─── Премиум-палитра ────────────────────────────────────────────────────────
const THEME = {
    ONLINE:  0x57F287,
    WARNING: 0xFEE75C,
    DANGER:  0xED4245,
    PRIMARY: 0x5865F2,
    DIVIDER: '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯'
};

function latencyIcon(ms) {
    if (ms < 100) return '🟢';
    if (ms < 250) return '🟡';
    return '🔴';
}

function latencyColor(ms) {
    if (ms < 100) return THEME.ONLINE;
    if (ms < 250) return THEME.WARNING;
    return THEME.DANGER;
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
    parts.push(`${s}с`);
    return parts.join(' ');
}

// Прогресс-бар для нагрузки/health (0..1)
function progressBar(ratio) {
    const SEGMENTS = 10;
    const r = Math.max(0, Math.min(ratio, 1));
    const filled = Math.round(r * SEGMENTS);
    return '▰'.repeat(filled) + '▱'.repeat(SEGMENTS - filled);
}

// Быстрая проверка подключения к БД (пулы 'vip' и 'admin')
async function checkDbStatus() {
    const checks = ['vip', 'admin'];
    const results = {};
    for (const name of checks) {
        const pool = getNamedPool(name);
        if (!pool) {
            results[name] = { ok: false, reason: 'пул не создан' };
            continue;
        }
        try {
            const t0 = Date.now();
            await pool.query('SELECT 1');
            results[name] = { ok: true, latency: Date.now() - t0 };
        } catch (e) {
            results[name] = { ok: false, reason: e.code || e.message };
        }
    }
    return results;
}

// Запрос состояния игрового сервера (CS2). Используем общий serverMonitor
// (type: 'csgo' — рабочий протокол Source для CS2-серверов; 'cs2' не подходит).
async function queryGameServer(ip, port) {
    try {
        const info = await getServerInfo(ip, port, 4000);
        if (!info) return { ok: false };
        return { ok: true, players: info.players, maxPlayers: info.max_players || '?' };
    } catch (e) {
        return { ok: false };
    }
}

// Короткое имя сервера (без префикса ➥ ███)
function shortServerName(fullName) {
    return String(fullName || 'Сервер')
        .replace(/➥\s*█+\s*/g, '')
        .replace(/LUXECS2\.RU\s*\|\s*/i, '')
        .trim();
}

export default function(client) {
    client.once('clientReady', async () => {
        await client.application.commands.create({
            name: 'ping',
            description: '📡 Подробный статус бота, базы данных и игровых серверов'
        });
        console.log('✅ Ping cog загружен');
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'ping') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        const sent = await interaction.deferReply({ fetchReply: true });

        // Задержки
        const apiLatency = Math.round(client.ws.ping);
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;

        // Аптайм и память
        const uptime = process.uptime();
        const uptimeStr = formatUptime(uptime);
        const mem = process.memoryUsage();
        const memUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const memTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
        const memPct = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;

        // CPU load average (не на Windows, fallback к загрузке процесса)
        let cpuLine = '`н/д`';
        try {
            const load = loadavg();
            if (load && load[0] !== undefined) {
                cpuLine = `\`${load[0].toFixed(2)} / ${load[1].toFixed(2)} / ${load[2].toFixed(2)}\` (1/5/15 мин)`;
            }
        } catch (_) { /* Windows — нет loadavg */ }

        // Параллельно: статус БД и игровых серверов
        const [dbStatus, ...gameStates] = await Promise.all([
            checkDbStatus(),
            ...DEFAULT_SERVERS.map(s => queryGameServer(s.ip, s.port))
        ]);

        // Цвет embed'а — по худшему показателю (API latency приоритетнее)
        const color = latencyColor(apiLatency);

        // ─── Сборка embed ─────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setTitle('📡 Статус системы')
            .setColor(color)
            .setThumbnail(client.user.displayAvatarURL({ extension: 'png', size: 256 }))
            .setDescription(
                `> ${latencyIcon(apiLatency)} **Задержка API:** \`${apiLatency} мс\`\n` +
                `> ⏱️ **Аптайм:** \`${uptimeStr}\`\n` +
                `> 🤖 **Discord.js:** \`v14\` · **Node:** \`${process.version}\``
            )
            .setTimestamp();

        // ── Сеть / задержки ──
        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: `${latencyIcon(roundtrip)} Ответ команды`, value: `\`${roundtrip} мс\``, inline: true },
            { name: `${latencyIcon(apiLatency)} WebSocket (API)`, value: `\`${apiLatency} мс\``, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );

        // ── Ресурсы ──
        embed.addFields(
            { name: '🧠 Память (heap)', value: `\`${memUsedMB} / ${memTotalMB} МБ\`\n\`${progressBar(memPct)}\``, inline: true },
            { name: '⚙️ CPU load', value: cpuLine, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );

        // ── Discord ──
        embed.addFields(
            { name: '🌐 Серверов', value: `\`${client.guilds.cache.size}\``, inline: true },
            { name: '👥 Пользователей', value: `\`${client.users.cache.size}\``, inline: true },
            { name: '🎙️ Каналов', value: `\`${client.channels.cache.size}\``, inline: true }
        );

        // ── Базы данных ──
        const dbLines = Object.entries(dbStatus).map(([name, r]) => {
            const label = name === 'vip' ? 'VIP' : name === 'admin' ? 'Админы' : name;
            if (r.ok) return `> 🟢 \`${label}\` — \`${r.latency} мс\``;
            return `> 🔴 \`${label}\` — недоступна`;
        });
        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: '🗄️ Базы данных', value: dbLines.join('\n'), inline: false }
        );

        // ── Игровые серверы (CS2) ──
        if (DEFAULT_SERVERS.length > 0) {
            const serverLines = DEFAULT_SERVERS.map((s, i) => {
                const st = gameStates[i];
                const name = shortServerName(s.name);
                if (st.ok) {
                    return `> 🟢 \`${name}\` — 👥 \`${st.players}/${st.maxPlayers}\``;
                }
                return `> 🔴 \`${name}\` — офлайн`;
            });
            embed.addFields(
                { name: '🎮 Игровые серверы', value: serverLines.join('\n'), inline: false }
            );
        }

        embed.setFooter({ text: `LuxeCS2 · Статус · обновлено`, iconURL: client.user.displayAvatarURL() });

        // ─── Кнопки ──
        const siteButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('🌐 Сайт проекта')
                .setURL(PROJECT_URL)
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel('🔄 Обновить')
                .setCustomId('ping_refresh')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [siteButton] });
    });

    // ─── Кнопка обновления статуса ─────────────────────────────────────────
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'ping_refresh') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        await interaction.deferUpdate();

        const client_ = interaction.client;
        const apiLatency = Math.round(client_.ws.ping);
        const uptime = process.uptime();
        const uptimeStr = formatUptime(uptime);
        const mem = process.memoryUsage();
        const memUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const memTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
        const memPct = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;

        let cpuLine = '`н/д`';
        try {
            const load = loadavg();
            if (load && load[0] !== undefined) {
                cpuLine = `\`${load[0].toFixed(2)} / ${load[1].toFixed(2)} / ${load[2].toFixed(2)}\``;
            }
        } catch (_) { /* Windows */ }

        const [dbStatus, ...gameStates] = await Promise.all([
            checkDbStatus(),
            ...DEFAULT_SERVERS.map(s => queryGameServer(s.ip, s.port))
        ]);

        const color = latencyColor(apiLatency);
        const embed = new EmbedBuilder()
            .setTitle('📡 Статус системы')
            .setColor(color)
            .setThumbnail(client_.user.displayAvatarURL({ extension: 'png', size: 256 }))
            .setDescription(
                `> ${latencyIcon(apiLatency)} **Задержка API:** \`${apiLatency} мс\`\n` +
                `> ⏱️ **Аптайм:** \`${uptimeStr}\`\n` +
                `> 🤖 **Discord.js:** \`v14\` · **Node:** \`${process.version}\``
            )
            .setTimestamp();

        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: `${latencyIcon(apiLatency)} WebSocket (API)`, value: `\`${apiLatency} мс\``, inline: true },
            { name: '🧠 Память (heap)', value: `\`${memUsedMB} / ${memTotalMB} МБ\`\n\`${progressBar(memPct)}\``, inline: true },
            { name: '⚙️ CPU load', value: cpuLine, inline: true },
            { name: '🌐 Серверов', value: `\`${client_.guilds.cache.size}\``, inline: true },
            { name: '👥 Пользователей', value: `\`${client_.users.cache.size}\``, inline: true },
            { name: '🎙️ Каналов', value: `\`${client_.channels.cache.size}\``, inline: true }
        );

        const dbLines = Object.entries(dbStatus).map(([name, r]) => {
            const label = name === 'vip' ? 'VIP' : name === 'admin' ? 'Админы' : name;
            return r.ok ? `> 🟢 \`${label}\` — \`${r.latency} мс\`` : `> 🔴 \`${label}\` — недоступна`;
        });
        embed.addFields(
            { name: '\u200b', value: THEME.DIVIDER, inline: false },
            { name: '🗄️ Базы данных', value: dbLines.join('\n'), inline: false }
        );

        if (DEFAULT_SERVERS.length > 0) {
            const serverLines = DEFAULT_SERVERS.map((s, i) => {
                const st = gameStates[i];
                const name = shortServerName(s.name);
                return st.ok ? `> 🟢 \`${name}\` — 👥 \`${st.players}/${st.maxPlayers}\`` : `> 🔴 \`${name}\` — офлайн`;
            });
            embed.addFields({ name: '🎮 Игровые серверы', value: serverLines.join('\n'), inline: false });
        }

        embed.setFooter({ text: `LuxeCS2 · Статус · обновлено`, iconURL: client_.user.displayAvatarURL() });

        await interaction.editReply({ embeds: [embed] });
    });
}
