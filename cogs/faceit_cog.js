/**
 * faceit_cog.js — Авто-роли уровней FACEIT
 *
 * Возможности:
 *   • Автоматически создаёт 10 ролей «FACEIT [N]» (N = 1..10) при старте.
 *   • При верификации Steam (discord_id ↔ steam64) проверяет FACEIT-уровень
 *     и выдаёт соответствующую роль.
 *   • Раз в день в 05:00 по МСК (UTC+3) обновляет уровни всех привязанных
 *     пользователей: снимает старую роль уровня, выдаёт новую.
 *
 * Связь с другими когами:
 *   • Читает verified_users (discord_id, steam64) через named pool 'vip',
 *     который создаёт verification_cog.
 *   • Хук на верификацию: verification_cog вызывает client.updateFaceitRole(member, steam64)
 *     после выдачи VIP-ролей. Здесь мы регистрируем эту функцию на client.
 *
 * Команды:
 *   • /faceit_update — ручной запуск обновления уровней (для админов).
 *
 * Настройка: FACEIT_API_KEY и FACEIT_GAME в .env/config.js.
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { GUILD_ID, ADMIN_ROLE_ID, FACEIT_GAME } from '../config.js';
import { getNamedPool } from '../utils/database.js';
import { getFaceitLevelBySteam64 } from '../utils/faceit.js';

// ─── Конфигурация ───────────────────────────────────────────────────────────
const UPDATE_HOUR_UTC = 2;          // 05:00 МСК = 02:00 UTC
const UPDATE_MINUTE_UTC = 0;
const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000;  // проверяем «наступило ли 05:00» раз в час
const INITIAL_DELAY_MS = 120 * 1000;             // первая проверка через 2 мин после старта

// Префикс имени роли. Роли: «FACEIT 0» ... «FACEIT 10» (0 = без калибровки).
const ROLE_PREFIX = 'FACEIT ';

// Цвета ролей по уровням — приближены к официальной палитре FACEIT.
const LEVEL_COLORS = {
    0:  0x6E6E6E,  // тёмно-серый — без калибровки (placements не пройдены)
    1:  0x8B8B8B,  // серый
    2:  0x4A90D9,  // синий
    3:  0x4A90D9,
    4:  0x39B54A,  // зелёный
    5:  0x39B54A,
    6:  0xF5A623,  // жёлто-оранжевый
    7:  0xF5A623,
    8:  0xD0021B,  // красный
    9:  0xD0021B,
    10: 0x7B2D8B   // фиолетовый (Master)
};

// Эмодзи для ролей (опционально, не во всех названиях работает)
const LEVEL_EMOJI = {
    0: '⚪', 1: '🩶', 2: '🔹', 3: '🔹', 4: '🟢', 5: '🟢',
    6: '🟠', 7: '🟠', 8: '🔴', 9: '🔴', 10: '🟣'
};

// ─── Хелперы ────────────────────────────────────────────────────────────────

// Проверить, что имя роли принадлежит уровню FACEIT (для очистки старых ролей)
function isFaceitRole(roleName) {
    if (!roleName || !roleName.startsWith(ROLE_PREFIX)) return false;
    const num = roleName.slice(ROLE_PREFIX.length).trim();
    return /^\d{1,2}$/.test(num) && Number(num) >= 0 && Number(num) <= 10;
}

// Извлечь номер уровня из имени роли
function getLevelFromRoleName(roleName) {
    if (!isFaceitRole(roleName)) return null;
    return Number(roleName.slice(ROLE_PREFIX.length).trim());
}

// Найти роль уровня в гильдии
function findLevelRole(guild, level) {
    const target = `${ROLE_PREFIX}${level}`;
    return guild.roles.cache.find(r => r.name === target) || null;
}

// Найти все роли FACEIT-уровней у участника (для снятия старых)
function getMemberFaceitRoles(member) {
    return member.roles.cache.filter(r => isFaceitRole(r.name));
}

// Создать все роли уровней (0-10), если их нет
async function ensureLevelRoles(guild) {
    for (let level = 0; level <= 10; level++) {
        const roleName = `${ROLE_PREFIX}${level}`;
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            try {
                role = await guild.roles.create({
                    name: roleName,
                    colors: { primary: LEVEL_COLORS[level] || 0x99AAB5 },
                    mentionable: false,
                    hoist: false,
                    reason: `Автосоздание роли уровня FACEIT ${level}`
                });
                console.log(`✅ Создана роль FACEIT: ${roleName}`);
            } catch (err) {
                console.error(`❌ Не удалось создать роль ${roleName}:`, err.message);
            }
        }
    }
}

// ─── Управление ролями отдельного пользователя ──────────────────────────────

// Обновить роль уровня FACEIT у одного участника.
// Возвращает { level, action: 'added'|'updated'|'removed'|'unchanged' }
async function applyFaceitRole(member, steam64) {
    // Защита: member может быть partial/некорректным (например, испорченный discord_id в БД)
    if (!member || !member.guild || !member.roles?.cache || !member.user) {
        return { level: null, action: 'unchanged' };
    }
    const tag = member.user.tag || member.id;
    const guild = member.guild;
    const info = await getFaceitLevelBySteam64(steam64);

    const currentFaceitRoles = getMemberFaceitRoles(member);

    // Нет аккаунта FACEIT или нет данных игры → снимаем все роли уровня (если были)
    if (!info.found) {
        if (currentFaceitRoles.size > 0) {
            for (const role of currentFaceitRoles.values()) {
                try { await member.roles.remove(role, 'FACEIT: аккаунт не найден'); } catch (_) {}
            }
            return { level: null, action: 'removed' };
        }
        return { level: null, action: 'unchanged' };
    }

    const targetRole = findLevelRole(guild, info.level);
    if (!targetRole) {
        console.error(`faceit: роль уровня ${info.level} не найдена — пропускаю`);
        return { level: info.level, action: 'unchanged' };
    }

    // Уже есть нужная роль?
    if (currentFaceitRoles.has(targetRole.id)) {
        // Проверим, нет ли других ролей уровней (лишних)
        const extra = currentFaceitRoles.filter(r => r.id !== targetRole.id);
        if (extra.size > 0) {
            for (const role of extra.values()) {
                try { await member.roles.remove(role, 'FACEIT: cleanup лишних ролей'); } catch (_) {}
            }
            return { level: info.level, action: 'updated' };
        }
        return { level: info.level, action: 'unchanged' };
    }

    // Меняем роль: снимаем старые, выдаём новую
    for (const role of currentFaceitRoles.values()) {
        try { await member.roles.remove(role, 'FACEIT: смена уровня'); } catch (_) {}
    }
    try {
        await member.roles.add(targetRole, `FACEIT: уровень ${info.level} (elo ${info.elo ?? '?'})`);
        return { level: info.level, action: currentFaceitRoles.size > 0 ? 'updated' : 'added' };
    } catch (err) {
        console.error(`faceit: не удалось выдать роль ${targetRole.name} для ${tag}:`, err.message);
        return { level: info.level, action: 'unchanged' };
    }
}

// Обёртка для безопасного вызова (хук для verification_cog)
// Регистрируется как client.updateFaceitRole
async function updateMemberFaceitRole(client, member, steam64) {
    if (!member || !steam64) return;
    try {
        const result = await applyFaceitRole(member, steam64);
        if (result.action === 'added' || result.action === 'updated') {
            const tag = member.user?.tag || member.id;
            console.log(`🎮 FACEIT: ${tag} → уровень ${result.level} (${result.action})`);
        }
    } catch (err) {
        console.error('faceit: ошибка updateMemberFaceitRole:', err.message);
    }
}

// ─── Массовое обновление по всем привязанным ────────────────────────────────

async function getAllVerifiedUsers() {
    const pool = getNamedPool('vip');
    if (!pool) return [];
    try {
        const [rows] = await pool.execute('SELECT discord_id, steam64 FROM verified_users');
        return rows;
    } catch (err) {
        console.error('faceit: ошибка чтения verified_users:', err.message);
        return [];
    }
}

async function checkAndUpdateAllFaceitRoles(client) {
    const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
    if (!guild) {
        console.log('⚠️ FACEIT: гильдия не найдена');
        return;
    }

    // Убеждаемся, что роли существуют
    await ensureLevelRoles(guild);

    const verified = await getAllVerifiedUsers();
    if (verified.length === 0) {
        console.log('🎮 FACEIT: нет привязанных пользователей');
        return;
    }

    console.log(`🎮 FACEIT: начало обновления уровней для ${verified.length} пользователей...`);
    let updated = 0, unchanged = 0, removed = 0, errors = 0, notFound = 0;

    for (const row of verified) {
        const discordId = row.discord_id;
        const steam64 = row.steam64;
        try {
            // 🔍 Диагностика: показываем реальные значения из БД
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (!member) {
                console.log(`[FACEIT-DBG] discord_id=${discordId} → НЕТ на сервере (возможно испорчен ID)`);
                notFound++;
                continue;
            }

            const result = await applyFaceitRole(member, steam64);
            // 🔍 Диагностика: результат поиска FACEIT
            const tag = member.user?.tag || discordId;
            console.log(`[FACEIT-DBG] ${tag} | steam64=${steam64} → action=${result.action} level=${result.level ?? '-'}`);
            if (result.action === 'updated' || result.action === 'added') updated++;
            else if (result.action === 'removed') removed++;
            else unchanged++;
        } catch (err) {
            console.error(`faceit: ошибка для discord_id=${discordId} steam64=${steam64}:`, err.message);
            errors++;
        }
    }

    console.log(`✅ FACEIT: обновление завершено. Изменено: ${updated}, без изменений: ${unchanged}, снято: ${removed}, нет аккаунта: ${notFound}, ошибок: ${errors}`);
}

// ─── Планировщик 05:00 МСК (02:00 UTC) ──────────────────────────────────────

function scheduleDailyUpdate(client) {
    // Проверяем раз в час, наступило ли время (02:00 UTC).
    // Это устойчиво к пропущенным интервалам и смене часового пояса сервера.
    setInterval(() => {
        const now = new Date();
        // UTC часы/минуты. МСК = UTC+3, значит 05:00 МСК = 02:00 UTC.
        if (now.getUTCHours() === UPDATE_HOUR_UTC && now.getUTCMinutes() < 5) {
            // Защита от двойного запуска в течение одной минуты
            const key = `faceit-${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
            if (client._lastFaceitRun === key) return;
            client._lastFaceitRun = key;

            console.log('🎮 FACEIT: запуск ежедневного обновления (05:00 МСК)...');
            checkAndUpdateAllFaceitRoles(client).catch(err =>
                console.error('❌ FACEIT: ошибка ежедневного обновления:', err)
            );
        }
    }, DAILY_CHECK_INTERVAL_MS);

    console.log(`🕒 FACEIT: ежедневное обновление запланировано на 05:00 МСК (02:00 UTC)`);
}

// ─── Cog ────────────────────────────────────────────────────────────────────

export default function(client) {
    client.once('clientReady', async () => {
        // Регистрируем хук для verification_cog
        client.updateFaceitRole = (member, steam64) => updateMemberFaceitRole(client, member, steam64);

        // Создаём роли уровней
        const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
        if (guild) await ensureLevelRoles(guild);

        // Регистрируем команду ручного обновления
        await client.application.commands.create({
            name: 'faceit_update',
            description: '🎮 Обновить уровни FACEIT всех пользователей (админы)'
        });

        // Планировщик
        scheduleDailyUpdate(client);

        console.log(`✅ Faceit cog загружен (game: ${FACEIT_GAME}, уровней: 1-10)`);
    });

    // ── /faceit_update — ручной запуск ──
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'faceit_update') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply({ content: '🎮 Запускаю обновление уровней FACEIT...' });

        try {
            await checkAndUpdateAllFaceitRoles(interaction.client);
            await interaction.followUp({ content: '✅ Обновление уровней FACEIT завершено. Подробности в консоли.' });
        } catch (err) {
            await interaction.followUp({ content: `❌ Ошибка: ${err.message}` });
        }
    });

    // Запускаем первичную проверку через 2 мин (после того как все коги прогрузятся)
    setTimeout(() => {
        checkAndUpdateAllFaceitRoles(client).catch(err =>
            console.error('❌ FACEIT: ошибка первичной проверки:', err)
        );
    }, INITIAL_DELAY_MS);
}
