/**
 * mod_log_cog.js — Логирование модерации + авто-модерация оскорблений
 *
 * Логирует:
 *   - Удалённые сообщения
 *   - Редактирование сообщений
 *   - Входы / выходы участников
 *   - Изменения ролей участников (с инициатором через Audit Log)
 *   - Тайм-ауты (timeout)
 *   - Авто-модерацию (оскорбления, оскорбления родителей)
 *
 * Авто-модерация:
 *   - Оскорбительные слова и оскорбления родителей → тайм-аут (по умолчанию 1 день)
 *   - Защита от обхода: нормализация текста (замена похожих символов, повторы букв)
 *   - Исключения: боты, админы, модераторы, игнорируемые каналы
 *
 * Настройка:
 *   /setmodlog #канал              — установить канал логов
 *   /setignorechannel #канал       — добавить/убрать канал-исключение для авто-модерации
 *
 * ⚠️ Для определения инициатора изменения ролей боту нужно разрешение
 *    «Просмотр журнала аудита» (ViewAuditLog).
 * ⚠️ Для тайм-аутов нужно разрешение ModerateMembers (Timeout Members).
 * ⚠️ Для удаления сообщений нужно ManageMessages.
 *
 * Конфигурация хранится в modlog_config.json (персистентно между перезапусками).
 */

import { EmbedBuilder, AuditLogEvent, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { ADMIN_ROLE_ID } from '../config.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODLOG_CONFIG_FILE = join(__dirname, '..', 'modlog_config.json');

// ─── Конфигурация (персистентная) ──────────────────────────────────────────
// Глобальный объект конфига — загружается один раз при старте, обновляется в памяти
// и сохраняется в файл при каждом изменении.
let config = loadModLogConfig();

// Роль модератора (помимо ADMIN_ROLE_ID) — кто не попадает под авто-модерацию.
// Берётся как любая роль с правом ModerateMembers, либо можно задать явно.
const MODERATE_PERMISSION = PermissionFlagsBits.ModerateMembers;

function loadModLogConfig() {
    const defaults = {
        modlog_channel_id: null,
        ignored_channels: [],
        timeout_minutes: 1440,
        bad_words: [],
        parent_insults: []
    };
    const loaded = loadJSON(MODLOG_CONFIG_FILE, defaults);
    // Гарантируем наличие всех полей (на случай старого/неполного файла)
    return {
        modlog_channel_id: loaded.modlog_channel_id ?? null,
        ignored_channels: Array.isArray(loaded.ignored_channels) ? loaded.ignored_channels : [],
        timeout_minutes: 1440,
        bad_words: Array.isArray(loaded.bad_words) ? loaded.bad_words : [],
        parent_insults: Array.isArray(loaded.parent_insults) ? loaded.parent_insults : []
    };
}

function persistConfig() {
    saveJSON(MODLOG_CONFIG_FILE, config);
}

async function sendModLog(client, embed) {
    if (!config.modlog_channel_id) return;
    try {
        const channel = client.channels.cache.get(config.modlog_channel_id)
            ?? await client.channels.fetch(config.modlog_channel_id).catch(() => null);
        if (channel) await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('❌ mod_log: ошибка отправки лога:', err.message);
    }
}

// ─── Нормализация текста для защиты от обхода фильтра ──────────────────────
// Приводим текст к «каноничному» виду, чтобы ловить замены символов и повторы.
const CHAR_MAP = {
    '@': 'а', '4': 'а', 'a': 'а',
    '6': 'б', 'b': 'б',
    '8': 'в', 'v': 'в',
    '0': 'о', 'o': 'о',
    '3': 'е', 'e': 'е',
    '$': 'с', 's': 'с', 'c': 'с',
    '|': 'и', 'u': 'у', 'y': 'у',
    'x': 'х', 'k': 'к', 'p': 'р', 'r': 'р',
    'm': 'м', 't': 'т', 'n': 'н', 'h': 'н',
    'g': 'г', 'd': 'д', 'z': 'з', 'i': 'и',
    "'": '', '`': '', '*': '', '.': '', '_': '', '-': '', '#': '', '!': '', '1': ''
};

function normalizeText(text) {
    if (!text) return '';
    let result = text.toLowerCase();
    // Замена похожих латинских/спец-символов на кириллицу
    for (const [from, to] of Object.entries(CHAR_MAP)) {
        result = result.split(from).join(to);
    }
    // Убираем повторы одной и той же буквы: "ммаатт" -> "мат"
    result = result.replace(/(.)\1+/g, '$1');
    // Убираем лишние пробелы и непечатные символы
    result = result.replace(/\s+/g, ' ').trim();
    // Для поиска оскорблений родителей нам нужны пробелы — сохраняем вариант с пробелами
    return result;
}

// escapeRegExp для безопасного использования пользовательских слов в регулярке
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Проверка сообщения на оскорбления. Возвращает { matched: bool, type: 'bad_word'|'parent', word: string }
function checkMessage(text) {
    if (!text) return { matched: false };
    const normalized = normalizeText(text);

    // Сначала проверяем оскорбления родителей (приоритет — строже)
    // Нормализуем тоже убирая лишние пробелы между словами
    const compact = normalized.replace(/\s+/g, ' ');
    for (const phrase of config.parent_insults) {
        const normPhrase = normalizeText(phrase).replace(/\s+/g, ' ').trim();
        if (normPhrase && compact.includes(normPhrase)) {
            return { matched: true, type: 'parent', word: phrase };
        }
    }

    // Затем — отдельные плохие слова (по подстроке в нормализованной форме)
    for (const word of config.bad_words) {
        const normWord = normalizeText(word).trim();
        if (normWord && normalized.includes(normWord)) {
            return { matched: true, type: 'bad_word', word };
        }
    }

    return { matched: false };
}

// ─── Проверка исключений для авто-модерации ────────────────────────────────
function isExemptFromAutomod(member) {
    if (!member) return true;
    // Боты не модерируются
    if (member.user?.bot) return true;
    // Админы и модераторы (имеющие право тайм-аута) не модерируются
    if (member.roles?.cache?.has(ADMIN_ROLE_ID)) return true;
    try {
        if (member.permissions?.has(MODERATE_PERMISSION)) return true;
    } catch (_) { /* partial member — продолжаем */ }
    return false;
}

function isIgnoredChannel(channelId) {
    return config.ignored_channels.includes(channelId);
}

// ─── Применение тайм-аута + логирование ────────────────────────────────────
async function applyTimeoutAndLog(client, message, result) {
    const member = message.member;
    const minutes = 1440;
    const until = new Date(Date.now() + minutes * 60 * 1000);

    const typeLabel = result.type === 'parent'
        ? '🚫 Оскорбление родителей'
        : '⚠️ Оскорбительное сообщение';
    const reason = `${typeLabel}: обнаружено «${result.word}». Авто-модерация: тайм-аут 1 день.`;

    let timeoutApplied = false;
    let deleteApplied = false;
    const errors = [];

    // Удаляем сообщение
    try {
        await message.delete();
        deleteApplied = true;
    } catch (err) {
        errors.push(`удаление: ${err.message}`);
    }

    // Ставим тайм-аут
    try {
        if (member?.moderatable) {
            await member.timeout(until, reason);
            timeoutApplied = true;
        } else {
            errors.push('недостаточно прав для тайм-аута участника');
        }
    } catch (err) {
        errors.push(`тайм-аут: ${err.message}`);
    }

    // Логируем
    const embed = new EmbedBuilder()
        .setTitle('⛔ Авто-модерация: тайм-аут')
        .setColor(0xFF9500)
        .setThumbnail(message.author?.displayAvatarURL?.() || null)
        .addFields(
            { name: '👤 Участник', value: `<@${message.author.id}> (\`${message.author.tag}\`)`, inline: false },
            { name: '📝 Тип', value: typeLabel, inline: true },
            { name: '⏰ Длительность', value: '1 день', inline: true },
            { name: '💬 Триггер', value: `\`${result.word}\``, inline: true },
            { name: '📌 Канал', value: `<#${message.channelId}>`, inline: true },
            { name: '🗑️ Сообщение', value: deleteApplied ? 'Удалено' : 'Не удалено', inline: true },
            { name: '🔇 Тайм-аут', value: timeoutApplied ? 'Применён' : 'Не применён', inline: true }
        )
        .setTimestamp();

    if (errors.length) {
        embed.addFields({ name: '⚠️ Замечания', value: errors.join('; ').slice(0, 1024), inline: false });
    }

    // Фрагмент удалённого сообщения (для контекста)
    const preview = message.content?.slice(0, 200) || '';
    if (preview) {
        embed.addFields({ name: '💬 Фрагмент', value: `\`\`\`${preview.replace(/`/g, "'")}\`\`\``, inline: false });
    }

    await sendModLog(client, embed);

    // Уведомляем в канале (если не удалилось — эфемерно не получится, просто лог)
    if (timeoutApplied) {
        try {
            await message.channel.send({
                content: `⛔ <@${message.author.id}> получил тайм-аут на 1 день. за ${result.type === 'parent' ? 'оскорбление родителей' : 'оскорбительное сообщение'}.`
            }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        } catch (_) { /* игнор */ }
    }
}

export default function(client) {

    console.log(`📋 ModLog: конфигурация загружена. Канал логов: ${config.modlog_channel_id || 'не задан'}, слов в фильтре: ${config.bad_words.length}, оскорблений родителей: ${config.parent_insults.length}`);

    // ── /setmodlog ─────────────────────────────────────────────────────────────
    client.once('clientReady', async () => {
        await client.application.commands.create({
            name: 'setmodlog',
            description: '📋 Установить канал логирования модерации',
            options: [
                { name: 'channel', type: 7, description: 'Канал для логов', required: true }
            ]
        });

        // ── /setignorechannel — управление каналами-исключениями для авто-модерации
        await client.application.commands.create({
            name: 'setignorechannel',
            description: '🚫 Добавить/убрать канал-исключение для авто-модерации',
            options: [
                { name: 'channel', type: 7, description: 'Канал-исключение (флуд/спам)', required: true }
            ]
        });

        console.log('✅ ModLog cog загружен');
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        // ВАЖНО: фильтр commandName — ДО handledInteractions.add().
        // Раньше add() стоял выше и «съедал» чужие команды (например /vips),
        // т.к. mod_log_cog грузится раньше vips_cog по алфавиту.
        if (interaction.commandName !== 'setmodlog' && interaction.commandName !== 'setignorechannel') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        // ── /setmodlog ──
        if (interaction.commandName === 'setmodlog') {
            if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
            }

            const channel = interaction.options.getChannel('channel');
            config.modlog_channel_id = channel.id;
            persistConfig();

            await interaction.reply({
                content: `✅ Канал логов модерации установлен: ${channel}\nКанал сохранён и будет использоваться после перезапуска.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // ── /setignorechannel ──
        if (interaction.commandName === 'setignorechannel') {
            if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
            }

            const channel = interaction.options.getChannel('channel');
            const idx = config.ignored_channels.indexOf(channel.id);
            let action;
            if (idx === -1) {
                config.ignored_channels.push(channel.id);
                action = 'добавлен в исключения';
            } else {
                config.ignored_channels.splice(idx, 1);
                action = 'убран из исключений';
            }
            persistConfig();

            await interaction.reply({
                content: `✅ Канал ${channel} **${action}** авто-модерации.\nВсего каналов-исключений: ${config.ignored_channels.length}`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
    });

    // ─── Авто-модерация сообщений ──────────────────────────────────────────────
    client.on('messageCreate', async message => {
        // Только сообщения в гильдии
        if (!message.guild) return;
        // Пустые/системные пропускаем
        if (!message.content) return;
        // Игнорируемые каналы
        if (isIgnoredChannel(message.channelId)) return;

        // Полная проверка участника (нужен для тайм-аута)
        const member = message.member
            ?? await message.guild.members.fetch(message.author.id).catch(() => null);

        // Исключения: боты, админы, модераторы
        if (isExemptFromAutomod(member)) return;

        // Проверка текста
        const result = checkMessage(message.content);
        if (!result.matched) return;

        // Применяем тайм-аут и логируем
        try {
            await applyTimeoutAndLog(client, message, result);
        } catch (err) {
            console.error('❌ mod_log: ошибка авто-модерации:', err);
        }
    });

    // Также проверяем отредактированные сообщения (могли стать оскорбительными)
    client.on('messageUpdate', async (oldMsg, newMsg) => {
        if (!newMsg.guild) return;
        if (!newMsg.content) return;
        if (isIgnoredChannel(newMsg.channelId)) return;

        const member = newMsg.member
            ?? await newMsg.guild.members.fetch(newMsg.author?.id).catch(() => null);
        if (isExemptFromAutomod(member)) return;

        const result = checkMessage(newMsg.content);
        if (!result.matched) return;

        try {
            await applyTimeoutAndLog(client, newMsg, result);
        } catch (err) {
            console.error('❌ mod_log: ошибка авто-модерации (edit):', err);
        }
    });

    // ── Удалённые сообщения ────────────────────────────────────────────────────
    client.on('messageDelete', async message => {
        if (!config.modlog_channel_id) return;
        if (message.author?.bot) return;
        if (!message.content && !message.attachments.size) return;

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Сообщение удалено')
            .setColor(0xED4245)
            .addFields(
                { name: '👤 Автор',  value: message.author ? `<@${message.author.id}> (\`${message.author.tag}\`)` : '`Неизвестно`', inline: true },
                { name: '📌 Канал', value: `<#${message.channelId}>`, inline: true }
            )
            .setTimestamp();

        if (message.content) {
            const truncated = message.content.length > 1024
                ? message.content.slice(0, 1021) + '...'
                : message.content;
            embed.addFields({ name: '💬 Текст', value: truncated });
        }
        if (message.attachments.size) {
            embed.addFields({ name: '📎 Вложений', value: `${message.attachments.size}` });
        }

        await sendModLog(client, embed);
    });

    // ── Отредактированные сообщения ────────────────────────────────────────────
    client.on('messageUpdate', async (oldMsg, newMsg) => {
        if (!config.modlog_channel_id) return;
        if (newMsg.author?.bot) return;
        if (oldMsg.content === newMsg.content) return;

        const embed = new EmbedBuilder()
            .setTitle('✏️ Сообщение отредактировано')
            .setColor(0xFEE75C)
            .addFields(
                { name: '👤 Автор',  value: `<@${newMsg.author.id}> (\`${newMsg.author.tag}\`)`, inline: true },
                { name: '📌 Канал', value: `<#${newMsg.channelId}>`, inline: true },
                { name: '🔗 Ссылка', value: `[Перейти](${newMsg.url})`, inline: true }
            )
            .setTimestamp();

        if (oldMsg.content) {
            embed.addFields({ name: '❌ Было', value: oldMsg.content.slice(0, 512) });
        }
        if (newMsg.content) {
            embed.addFields({ name: '✅ Стало', value: newMsg.content.slice(0, 512) });
        }

        await sendModLog(client, embed);
    });

    // ── Входы участников ──────────────────────────────────────────────────────
    client.on('guildMemberAdd', async member => {
        if (!config.modlog_channel_id) return;

        const created = Math.floor(member.user.createdTimestamp / 1000);
        const embed = new EmbedBuilder()
            .setTitle('📥 Участник вошёл')
            .setColor(0x57F287)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '👤 Участник', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
                { name: '🆔 ID',       value: `\`${member.id}\``, inline: true },
                { name: '📅 Аккаунт создан', value: `<t:${created}:R>`, inline: true }
            )
            .setTimestamp();

        await sendModLog(client, embed);
    });

    // ── Выходы участников ─────────────────────────────────────────────────────
    client.on('guildMemberRemove', async member => {
        if (!config.modlog_channel_id) return;

        const joined = member.joinedTimestamp
            ? Math.floor(member.joinedTimestamp / 1000)
            : null;

        const embed = new EmbedBuilder()
            .setTitle('📤 Участник покинул сервер')
            .setColor(0xED4245)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '👤 Участник', value: `\`${member.user.tag}\``, inline: true },
                { name: '🆔 ID',       value: `\`${member.id}\``, inline: true },
                joined
                    ? { name: '📅 Был на сервере с', value: `<t:${joined}:R>`, inline: true }
                    : { name: '\u200b', value: '\u200b', inline: true }
            )
            .setTimestamp();

        await sendModLog(client, embed);
    });

    // ── Изменения ролей ───────────────────────────────────────────────────────
    // Определяем инициатора через Audit Log (AuditLogEvent.MemberRoleUpdate).
    // Бот должен иметь PermissionFlagsBits.ViewAuditLog.
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!config.modlog_channel_id) return;

        const added   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

        if (!added.size && !removed.size) return;

        // Пытаемся найти автора изменения в журнале аудита.
        let moderatorText = '—';
        try {
            const me = newMember.guild.members.me;
            const canViewAudit = me?.permissions?.has(PermissionFlagsBits.ViewAuditLog);
            if (canViewAudit) {
                const auditLogs = await newMember.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberRoleUpdate,
                    limit: 5
                });

                const cutoff = Date.now() - 10000; // 10 секунд назад
                const entry = auditLogs.entries.find(e =>
                    e.targetId === newMember.id && e.createdTimestamp >= cutoff
                );

                if (entry) {
                    const modTag = entry.executor
                        ? `${entry.executor.tag} (\`${entry.executor.id}\`)`
                        : 'Неизвестно';
                    moderatorText = `<@${entry.executorId}> \`${modTag}\``;
                } else if (newMember.id === newMember.client.user.id) {
                    moderatorText = '🤖 Бот (автоматически)';
                }
            } else {
                moderatorText = '⚠️ *Нет прав ViewAuditLog*';
            }
        } catch (err) {
            console.error('❌ mod_log: ошибка чтения Audit Log (роли):', err.message);
            moderatorText = '⚠️ *Ошибка чтения журнала*';
        }

        const embed = new EmbedBuilder()
            .setTitle('🎭 Роли изменены')
            .setColor(0x5865F2)
            .setThumbnail(newMember.user.displayAvatarURL())
            .addFields(
                { name: '👤 Участник',  value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: false },
                { name: '🛠️ Изменил',   value: moderatorText, inline: false }
            )
            .setTimestamp();

        if (added.size)   embed.addFields({ name: '✅ Добавлены',  value: added.map(r => `<@&${r.id}>`).join(', '),   inline: false });
        if (removed.size) embed.addFields({ name: '❌ Удалены',    value: removed.map(r => `<@&${r.id}>`).join(', '), inline: false });

        await sendModLog(client, embed);
    });

    // ── Тайм-ауты (через Audit Log) ───────────────────────────────────────────
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!config.modlog_channel_id) return;

        const wasTimedOut = oldMember.communicationDisabledUntilTimestamp;
        const isTimedOut  = newMember.communicationDisabledUntil;

        // Тайм-аут поставлен
        if (!wasTimedOut && isTimedOut && isTimedOut > Date.now()) {
            const until = Math.floor(isTimedOut / 1000);

            const embed = new EmbedBuilder()
                .setTitle('🔇 Участник получил тайм-аут')
                .setColor(0xFF9500)
                .addFields(
                    { name: '👤 Участник', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true },
                    { name: '⏰ До',       value: `<t:${until}:R>`, inline: true }
                )
                .setTimestamp();

            await sendModLog(client, embed);
        }

        // Тайм-аут снят досрочно
        if (wasTimedOut && (!isTimedOut || isTimedOut <= Date.now())) {
            const embed = new EmbedBuilder()
                .setTitle('🔊 Тайм-аут снят')
                .setColor(0x57F287)
                .addFields(
                    { name: '👤 Участник', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true }
                )
                .setTimestamp();

            await sendModLog(client, embed);
        }
    });
}
