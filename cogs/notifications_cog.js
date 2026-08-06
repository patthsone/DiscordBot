/**
 * notifications_cog.js — Уведомления об истечении VIP-статуса
 *
 * Раз в час сканирует таблицу vip_users и отправляет в ЛС (DM) игрокам,
 * чей VIP скоро истекает или уже истёк:
 *   • за 3 дня до истечения — предупреждение;
 *   • за 1 день до истечения — срочное напоминание;
 *   • в день истечения       — уведомление о потере статуса.
 *
 * Чтобы не спамить при продлении/повторных запусках, ведётся журнал
 * vip_notified(account_id, sid, notification_key). notification_key = значение
 * expires на момент отправки + порог (3/1/0). При смене expires (продление)
 * ключ меняется, и уведомления для нового срока снова сработают корректно.
 *
 * Связка с Discord: vip_users.account_id → steam64 (account_id + base) →
 * verified_users.steam64 → verified_users.discord_id.
 *
 * Запускается как отдельный cog (автоподгружается из cogs/ в index.js).
 * Зависит от verification_cog, который создаёт named pool 'vip'.
 */

import { EmbedBuilder } from 'discord.js';
import { getNamedPool } from '../utils/database.js';

// ─── Настройки ──────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 60 * 60 * 1000;   // проверка раз в час
const INITIAL_DELAY_MS = 90 * 1000;         // первая проверка через 90с после старта
const STEAM64_BASE = 76561197960265728n;

// Пороги уведомлений (в днях до истечения). 0 = в момент истечения/после.
const NOTIFY_THRESHOLDS = [3, 1, 0];

// ─── Вспомогательные функции ────────────────────────────────────────────────

function accountIdToSteam64(accountId) {
    try {
        return String(BigInt(STEAM64_BASE) + BigInt(accountId));
    } catch {
        return null;
    }
}

function ensureNotifiedTable(pool) {
    return pool.execute(`
        CREATE TABLE IF NOT EXISTS vip_notified (
            account_id VARCHAR(20) NOT NULL,
            sid INT NOT NULL DEFAULT 1,
            notification_key VARCHAR(64) NOT NULL,
            notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (account_id, sid, notification_key)
        )
    `);
}

// Был ли уже отправлен данный notification_key для этого игрока?
async function isAlreadyNotified(pool, accountId, sid, notificationKey) {
    const [rows] = await pool.execute(
        'SELECT 1 FROM vip_notified WHERE account_id = ? AND sid = ? AND notification_key = ? LIMIT 1',
        [String(accountId), sid, notificationKey]
    );
    return rows.length > 0;
}

async function markNotified(pool, accountId, sid, notificationKey) {
    await pool.execute(
        `INSERT INTO vip_notified (account_id, sid, notification_key)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE notified_at = CURRENT_TIMESTAMP`,
        [String(accountId), sid, notificationKey]
    );
}

// Найти discord_id игрока по steam64 через таблицу verified_users.
async function getDiscordIdBySteam64(pool, steam64) {
    const [rows] = await pool.execute(
        'SELECT discord_id FROM verified_users WHERE steam64 = ? LIMIT 1',
        [steam64]
    );
    return rows[0]?.discord_id || null;
}

// Найти discord_id напрямую по account_id (если в verified_users хранится как-то иначе).
async function getDiscordIdByAccountId(pool, accountId) {
    const steam64 = accountIdToSteam64(accountId);
    if (!steam64) return null;
    return getDiscordIdBySteam64(pool, steam64);
}

// ─── Отправка DM-уведомления ────────────────────────────────────────────────
async function sendExpiryDM(client, user, vipData, threshold) {
    const expires = Number(vipData.expires) || 0;
    const group = vipData.group || 'VIP';

    let title, color, lead;
    if (threshold === 0) {
        title = '⛔ Ваш VIP-статус истёк';
        color = 0xED4245; // красный
        lead = `Ваш VIP-ранг **${group}** на сервере истёк.`;
    } else if (threshold === 1) {
        title = '🚨 VIP истекает через 1 день!';
        color = 0xFF9500; // оранжевый
        lead = `Ваш VIP-ранг **${group}** истекает завтра. Успейте продлить!`;
    } else {
        title = '⏰ VIP скоро истекает';
        color = 0xFEE75C; // жёлтый
        lead = `Ваш VIP-ранг **${group}** истекает через ${threshold} дня.`;
    }

    const expiresLine = expires > 0
        ? `<t:${expires}:R> (<t:${expires}:f>)`
        : '`∞ Бессрочно`';

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(
            `${lead}\n\n` +
            `> 🎫 **Ранг:** \`${group}\`\n` +
            `> ⏰ **Срок:** ${expiresLine}\n\n` +
            (threshold === 0
                ? `Роль будет снята автоматически. Продлите VIP, чтобы сохранить привилегии.`
                : `Чтобы не потерять привилегии, продлите VIP заранее.`)
        )
        .setFooter({ text: '🔔 Автоматическое уведомление о VIP' })
        .setTimestamp();

    try {
        await user.send({ embeds: [embed] });
        return true;
    } catch (err) {
        // ЛС закрыто / пользователь заблокировал бота — не критично, просто лог
        console.log(`📭 notifications: не удалось отправить DM пользователю ${user.tag} (${user.id}): ${err.message}`);
        return false;
    }
}

// ─── Основной цикл проверки ─────────────────────────────────────────────────
async function checkExpiringVip(client) {
    const pool = getNamedPool('vip');
    if (!pool) {
        console.log('🔕 notifications: БД VIP недоступна (pool «vip» не создан) — пропуск проверки');
        return;
    }

    try {
        await ensureNotifiedTable(pool);
    } catch (err) {
        console.error('❌ notifications: не удалось создать таблицу vip_notified:', err.message);
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    const maxThreshold = Math.max(...NOTIFY_THRESHOLDS); // 3 дня
    const earliest = now;                          // уже истёкшие
    const latest = now + maxThreshold * 86400;     // истекают в течение 3 дней

    let [rows] = [];
    try {
        // Только записи с конечным сроком (expires > 0) в окне [теперь; +3 дня].
        // expires=0 (бессрочные) исключаем — им уведомлять не о чем.
        [rows] = await pool.execute(
            `SELECT account_id, \`group\`, sid, expires
             FROM vip_users
             WHERE expires > 0 AND expires <= ?
             ORDER BY expires ASC`,
            [latest]
        );
    } catch (err) {
        console.error('❌ notifications: ошибка выборки истекающих VIP:', err.message);
        return;
    }

    if (rows.length === 0) {
        console.log(`🔕 notifications: нет истекающих VIP (проверено в окне до +${maxThreshold} дн.)`);
        return;
    }

    let sent = 0;
    let skipped = 0;
    let noContact = 0;

    for (const vip of rows) {
        const { account_id, sid, expires } = vip;
        const daysLeft = Math.ceil((Number(expires) - now) / 86400);

        // Подбираем порог. Каждый порог T «владеет» полуинтервалом дней:
        //   • окно порога T = (T_prev, T], где T_prev — следующий меньший порог,
        //     а для самого маленького порога нижняя граница = -∞.
        // Пример для [3, 1, 0]:
        //   порог 3 → (1, 3]  = {2, 3} дня   (за 3 дня)
        //   порог 1 → (0, 1]  = {1}     день (за 1 день)
        //   порог 0 → (-∞, 0] = {0, -1, -2, ...} (истёк / сегодня)
        // Перебираем пороги по возрастанию; daysLeft попадает в первое окно,
        // для которого daysLeft <= T (т.к. нижние окна уже отброшены).
        const thresholdsAsc = [...NOTIFY_THRESHOLDS].sort((a, b) => a - b);
        let threshold = null;
        for (const t of thresholdsAsc) {
            if (daysLeft <= t) {
                threshold = t;
                break;
            }
        }
        if (threshold === null) continue; // daysLeft больше максимального порога — вне окон

        // Ключ уведомления: expires + порог. Меняется при продлении → повторно сработает.
        const notifyKey = `${expires}:${threshold}`;

        // Уже уведомляли по этому ключу?
        try {
            if (await isAlreadyNotified(pool, account_id, sid, notifyKey)) {
                skipped++;
                continue;
            }
        } catch (err) {
            console.error(`notifications: ошибка проверки журнала для ${account_id}:`, err.message);
            continue;
        }

        // Ищем discord_id получателя
        const discordId = await getDiscordIdByAccountId(pool, account_id);
        if (!discordId) {
            noContact++;
            continue;
        }

        // Загружаем пользователя (нужен для DM)
        let user = null;
        try {
            user = await client.users.fetch(discordId);
        } catch (err) {
            console.log(`notifications: пользователь ${discordId} не найден в Discord: ${err.message}`);
            noContact++;
            continue;
        }

        // Отправляем DM
        const ok = await sendExpiryDM(client, user, vip, threshold);

        // Помечаем как уведомлённого (даже если DM не доставлено — чтобы не спамить каждый час
        // при закрытых ЛС; пользователь увидит в следующий раз при смене срока)
        try {
            await markNotified(pool, account_id, sid, notifyKey);
        } catch (err) {
            console.error(`notifications: не удалось записать в журнал ${account_id}:`, err.message);
        }

        if (ok) {
            sent++;
            console.log(`📤 notifications: отправлено уведомление ${user.tag} (account ${account_id}, порог ${threshold}д)`);
        } else {
            noContact++;
        }
    }

    console.log(`✅ notifications: проверка завершена. Отправлено: ${sent}, пропущено (уже было): ${skipped}, без контакта: ${noContact}`);
}

// ─── Точка входа cog'а ──────────────────────────────────────────────────────
export default function(client) {
    client.once('clientReady', () => {
        console.log(`✅ Notifications cog загружен (проверка каждые ${CHECK_INTERVAL_MS / 60000} мин, пороги: ${NOTIFY_THRESHOLDS.join('/')} дн.)`);

        // Первая проверка — с задержкой, чтобы verification_cog успел создать pool 'vip'.
        setTimeout(() => {
            checkExpiringVip(client).catch(err => console.error('❌ notifications:', err));
            // Повторяющиеся проверки
            setInterval(() => {
                checkExpiringVip(client).catch(err => console.error('❌ notifications:', err));
            }, CHECK_INTERVAL_MS);
        }, INITIAL_DELAY_MS);
    });
}
