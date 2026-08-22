/**
 * topdonate_cog.js — Авто-роли по сумме доната (таблица lk)
 *
 * Команда: /topdonat host user password database  — подключение к БД донатов
 *
 * Логика:
 *   • Конвертирует steam64 верифицированного игрока → Steam2 (format STEAM_X:Y:Z),
 *     который хранится в таблице lk (колонка auth).
 *   • Ищет запись по auth, читает all_cash (общая сумма доната в рублях).
 *   • all_cash >= 2000 → роль «Меценат» (золотой #FFD700).
 *   • all_cash > 0 и < 2000 → роль «Донатер» (синий #3498DB).
 *   • all_cash = 0 / не найден → снимает обе донат-роли.
 *
 * Запуск:
 *   • При верификации (хук client.updateDonateRole из verification_cog).
 *   • Раз в неделю в воскресенье 05:00 МСК (02:00 UTC) — массовое обновление.
 *   • /topdonat_update — ручной запуск (админы).
 *
 * Конфиг БД сохраняется в topdonate_config.json (персистентно между рестартами).
 * БД подключается через отдельный named pool 'donate'.
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { GUILD_ID, ADMIN_ROLE_ID } from '../config.js';
import { createNamedPool, getNamedPool, closeNamedPool } from '../utils/database.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DONATE_CONFIG_FILE = join(__dirname, '..', 'topdonate_config.json');

// Роли
const ROLE_TOP = 'Меценат';       // >= 2000₽ — золото
const ROLE_DONATOR = 'Донатер';   // 1..1999₽ — синий
const DONATE_THRESHOLD = 2000;    // порог в рублях (all_cash)
const ROLE_COLORS = { top: 0xFFD700, donator: 0x3498DB };

// ─── Конфиг ─────────────────────────────────────────────────────────────────
function loadDonateConfig() {
    return loadJSON(DONATE_CONFIG_FILE, null);
}
function saveDonateConfig(config) {
    saveJSON(DONATE_CONFIG_FILE, config);
}

async function connectDonateDb(host, user, password, database) {
    try {
        if (host && user && password && database) {
            saveDonateConfig({ host, user, password, database });
        } else {
            const cfg = loadDonateConfig();
            if (!cfg || !cfg.host) return false;
            host = cfg.host; user = cfg.user; password = cfg.password; database = cfg.database;
        }
        await closeNamedPool('donate').catch(() => {});
        await createNamedPool('donate', host, user, password, database);
        const pool = getNamedPool('donate');
        if (!pool) return false;
        // Проверяем, что таблица lk существует и доступна
        await pool.query('SELECT 1 FROM lk LIMIT 1');
        console.log('💰 Подключение к БД донатов установлено (pool «donate»)');
        return true;
    } catch (e) {
        console.error('topdonate: ошибка подключения к БД:', e.message);
        return false;
    }
}

// ─── Конвертация Steam64 → Steam2 (auth: STEAM_X:Y:Z) ──────────────────────
// Формула: z = (steam64 - 76561197960265728) / 2; y = (steam64 - base) % 2; x = 1
function steam64ToSteam2(steam64) {
    try {
        const id = BigInt(steam64);
        const base = 76561197960265728n;
        if (id < base) return null;
        const diff = id - base;
        const y = diff % 2n;
        const z = diff / 2n;
        return `STEAM_1:${y}:${z}`;
    } catch {
        return null;
    }
}

// ─── Получение суммы доната ─────────────────────────────────────────────────
async function getDonateAmount(steam64) {
    const pool = getNamedPool('donate');
    if (!pool) return null;
    const auth = steam64ToSteam2(steam64);
    if (!auth) return null;
    try {
        const [rows] = await pool.query('SELECT all_cash FROM lk WHERE auth = ? LIMIT 1', [auth]);
        if (!rows.length) return 0;
        return Number(rows[0].all_cash) || 0;
    } catch (e) {
        console.error('topdonate: ошибка запроса:', e.message);
        return null;
    }
}

// ─── Управление ролями одного участника ─────────────────────────────────────
function isDonateRole(name) {
    return name === ROLE_TOP || name === ROLE_DONATOR;
}

async function applyDonateRole(member, steam64) {
    if (!member || !member.guild || !member.roles?.cache || !member.user) {
        return { action: 'unchanged', amount: null };
    }
    const guild = member.guild;
    const amount = await getDonateAmount(steam64);

    // Текущие донат-роли участника (для очистки)
    const current = member.roles.cache.filter(r => isDonateRole(r.name));

    // Нет данных / 0₽ → снимаем всё
    if (amount === null || amount <= 0) {
        if (current.size > 0) {
            for (const r of current.values()) {
                try { await member.roles.remove(r, 'Донат: 0₽ / не найден'); } catch (_) {}
            }
            return { action: 'removed', amount: 0 };
        }
        return { action: 'unchanged', amount: 0 };
    }

    const targetName = amount >= DONATE_THRESHOLD ? ROLE_TOP : ROLE_DONATOR;
    let targetRole = guild.roles.cache.find(r => r.name === targetName);

    if (!targetRole) {
        console.warn(`topdonate: роль «${targetName}» не найдена — запусти ensureDonateRoles`);
        return { action: 'unchanged', amount };
    }

    // Уже есть нужная роль + нет лишних
    if (current.has(targetRole.id) && current.size === 1) {
        return { action: 'unchanged', amount };
    }

    // Снимаем прочие донат-роли, выдаём нужную
    for (const r of current.values()) {
        if (r.id !== targetRole.id) {
            try { await member.roles.remove(r, 'Донат: смена уровня'); } catch (_) {}
        }
    }
    if (!member.roles.cache.has(targetRole.id)) {
        try {
            await member.roles.add(targetRole, `Донат: ${amount}₽ → ${targetName}`);
        } catch (e) {
            console.error(`topdonate: не выдать роль ${targetName} для ${member.user.tag}:`, e.message);
            return { action: 'unchanged', amount };
        }
    }
    return { action: 'updated', amount };
}

// ─── Авто-создание ролей ────────────────────────────────────────────────────
async function ensureDonateRoles(guild) {
    for (const [key, name] of Object.entries({ top: ROLE_TOP, donator: ROLE_DONATOR })) {
        let role = guild.roles.cache.find(r => r.name === name);
        if (!role) {
            try {
                role = await guild.roles.create({
                    name,
                    colors: { primary: ROLE_COLORS[key] },
                    mentionable: false,
                    hoist: false,
                    reason: 'Автосоздание донат-роли'
                });
                console.log(`✅ Создана роль: ${name}`);
            } catch (e) {
                console.error(`topdonate: не удалось создать роль ${name}:`, e.message);
            }
        }
    }
}

// ─── Массовое обновление ────────────────────────────────────────────────────
async function getAllVerifiedUsers() {
    const pool = getNamedPool('vip');
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT discord_id, steam64 FROM verified_users');
        return rows;
    } catch (e) {
        console.error('topdonate: ошибка чтения verified_users:', e.message);
        return [];
    }
}

async function checkAndUpdateAllDonateRoles(client) {
    const donatePool = getNamedPool('donate');
    if (!donatePool) {
        console.log('💰 TopDonate: БД донатов не подключена — пропуск');
        return;
    }
    const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
    if (!guild) return;

    await ensureDonateRoles(guild);
    const verified = await getAllVerifiedUsers();
    if (!verified.length) {
        console.log('💰 TopDonate: нет привязанных пользователей');
        return;
    }

    console.log(`💰 TopDonate: начало обновления для ${verified.length} пользователей...`);
    let updated = 0, unchanged = 0, removed = 0, notFound = 0;

    for (const { discord_id, steam64 } of verified) {
        try {
            const member = await guild.members.fetch(discord_id).catch(() => null);
            if (!member) { notFound++; continue; }
            const r = await applyDonateRole(member, steam64);
            if (r.action === 'updated') updated++;
            else if (r.action === 'removed') removed++;
            else unchanged++;
        } catch (e) {
            console.error(`topdonate: ошибка для ${discord_id}:`, e.message);
        }
    }
    console.log(`✅ TopDonate: обновлено ${updated}, без изменений ${unchanged}, снято ${removed}, нет на сервере ${notFound}`);
}

// ─── Планировщик: воскресенье 05:00 МСК (02:00 UTC) ─────────────────────────
function scheduleWeeklyUpdate(client) {
    setInterval(() => {
        const now = new Date();
        // Воскресенье = 0, 02:00 UTC = 05:00 МСК
        if (now.getUTCDay() === 0 && now.getUTCHours() === 2 && now.getUTCMinutes() < 5) {
            const key = `donate-${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
            if (client._lastDonateRun === key) return;
            client._lastDonateRun = key;
            console.log('💰 TopDonate: еженедельное обновление (вс 05:00 МСК)...');
            checkAndUpdateAllDonateRoles(client).catch(e => console.error('TopDonate cron:', e));
        }
    }, 60 * 60 * 1000);
    console.log('🕒 TopDonate: обновление по воскресеньям 05:00 МСК');
}

// ─── Хук для verification_cog ───────────────────────────────────────────────
async function updateMemberDonateRole(client, member, steam64) {
    if (!member || !steam64) return;
    if (!getNamedPool('donate')) return; // БД не подключена — тихо пропускаем
    try {
        const r = await applyDonateRole(member, steam64);
        if (r.action !== 'unchanged' && r.amount > 0) {
            const tag = member.user?.tag || member.id;
            console.log(`💰 TopDonate: ${tag} → ${r.amount}₽ (${r.action})`);
        }
    } catch (e) {
        console.error('topdonate: ошибка хука:', e.message);
    }
}

export default function(client) {
    client.once('clientReady', async () => {
        client.updateDonateRole = (member, steam64) => updateMemberDonateRole(client, member, steam64);

        const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
        if (guild) await ensureDonateRoles(guild);

        // Регистрируем команды
        for (const cmd of [
            { name: 'topdonat', description: '💰 Подключить базу данных донатов', opts: ['host','user','password','database'] },
            { name: 'topdonat_update', description: '💰 Обновить донат-роли (админы)', opts: [] }
        ]) {
            try {
                const options = cmd.opts.map(n => ({ name: n, type: 3, description: n, required: true }));
                await client.application.commands.create({ name: cmd.name, description: cmd.description, options });
            } catch (e) {
                console.error(`topdonate: не зарегистрировать /${cmd.name}:`, e.message);
            }
        }

        // Автоподключение из конфига
        const cfg = loadDonateConfig();
        if (cfg && cfg.host) {
            console.log('💰 Загрузка подключения к БД донатов из конфига...');
            await connectDonateDb(cfg.host, cfg.user, cfg.password, cfg.database);
        }

        scheduleWeeklyUpdate(client);
        console.log('✅ TopDonate cog загружен');
    });

    // ── /topdonat — подключение БД ──
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'topdonat') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const host = interaction.options.getString('host');
        const user = interaction.options.getString('user');
        const password = interaction.options.getString('password');
        const database = interaction.options.getString('database');

        const ok = await connectDonateDb(host, user, password, database);
        if (ok) {
            // Создаём роли и сразу прогоняем проверку
            const guild = interaction.guild;
            await ensureDonateRoles(guild);
            await checkAndUpdateAllDonateRoles(client);
            await interaction.editReply({
                content: `✅ БД донатов подключена!\nРоли **${ROLE_TOP}** (≥${DONATE_THRESHOLD}₽) и **${ROLE_DONATOR}** созданы/проверены.\nПроверка выполнена — см. логи.`
            });
        } else {
            await interaction.editReply({ content: '❌ Не удалось подключиться. Проверьте параметры.' });
        }
    });

    // ── /topdonat_update — ручной запуск ──
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'topdonat_update') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ content: '💰 Запускаю обновление донат-ролей...' });
        try {
            await checkAndUpdateAllDonateRoles(interaction.client);
            await interaction.followUp({ content: '✅ Обновление донат-ролей завершено.' });
        } catch (e) {
            await interaction.followUp({ content: `❌ ${e.message}` });
        }
    });

    // Первичная проверка через 3 мин после старта
    setTimeout(() => {
        if (getNamedPool('donate')) {
            checkAndUpdateAllDonateRoles(client).catch(e => console.error('TopDonate init:', e));
        }
    }, 180 * 1000);
}
