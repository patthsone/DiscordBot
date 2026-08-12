import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { VERIFICATION_CHANNEL_ID, VERIFICATION_MESSAGE_ID, VERIFIED_ROLE_ID, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, ROLE_TO_REMOVE_ON_VERIFICATION_ID, GUILD_ID, VERIFICATION_LOG_CHANNEL_ID } from '../config.js';
import { WELCOME_CONFIG } from '../welcome_config.js';
import { createNamedPool, getNamedPool } from '../utils/database.js';
import { loadJSON } from '../utils/fileUtils.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIP_CONFIG_FILE = join(__dirname, '..', 'vip_config.json');

const VERIFICATION_IMAGE_URL = "https://raw.githubusercontent.com/patthsone/luxefails/refs/heads/main/verificat.png";
const PROJECT_URL = "https://luxecs2.ru/";

function getVipSids() {
    const cfg = loadJSON(VIP_CONFIG_FILE, null);
    const raw = cfg?.sids ?? cfg?.sid ?? 1;
    const arr = Array.isArray(raw) ? raw : [raw];
    const sids = arr
        .map(v => Number(v))
        .filter(v => Number.isInteger(v) && v > 0);
    const unique = Array.from(new Set(sids)).sort((a, b) => a - b);
    return unique.length > 0 ? unique : [1];
}

function steam64ToAccountId(steam64) {
    if (!/^\d+$/.test(steam64)) {
        throw new Error("Steam64 ID должен состоять только из цифр.");
    }
    return BigInt(steam64) - BigInt(76561197960265728);
}

async function getVipUser(accountId) {
    const pool = getNamedPool('vip');
    if (!pool) return null;
    
    try {
        const sids = getVipSids();
        const placeholders = sids.map(() => '?').join(', ');
        const currentTime = Math.floor(Date.now() / 1000);
        const [rows] = await pool.execute(
            `SELECT * FROM vip_users
             WHERE account_id = ? AND sid IN (${placeholders}) AND (expires = 0 OR expires > ?)
             ORDER BY (expires = 0) DESC, expires DESC
             LIMIT 1`,
            [accountId.toString(), ...sids, currentTime]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Ошибка получения VIP пользователя:', error);
        return null;
    }
}

async function getVerifiedSteam64(discordId) {
    const pool = getNamedPool('vip');
    if (!pool) return null;
    
    try {
        const [rows] = await pool.execute(
            "SELECT steam64 FROM verified_users WHERE discord_id = ?",
            [discordId.toString()]
        );
        return rows[0]?.steam64 || null;
    } catch (error) {
        console.error('Ошибка получения верифицированного Steam64:', error);
        return null;
    }
}

async function processRoles(memberParam, steam64) {
    let member = memberParam;

    // 🛡️ Защита: member должен быть настоящим GuildMember с привязкой к гильдии.
    // Без этой проверки `member.guild` может оказаться undefined (partial/устаревший кэш,
    // вызов из ЛС бота, запись из БД для покинувшего сервер пользователя),
    // что приводило к падению: Cannot read properties of undefined (reading 'roles')
    if (!member || !member.guild || !member.roles) {
        console.error('processRoles: передан некорректный member (нет .guild/.roles).', {
            hasMember: !!member,
            hasGuild: !!member?.guild,
            memberId: member?.id ?? 'unknown'
        });
        return { success: false, message: '❌ Не удалось получить данные участника на сервере.' };
    }

    const guild = member.guild;

    await guild.roles.fetch();
    
    let accountId;
    let vipData;
    try {
        accountId = steam64ToAccountId(steam64);
        vipData = await getVipUser(accountId);
    } catch (error) {
        return { success: false, message: `❌ Некорректный Steam64 ID: ${error.message}` };
    }
    
    const addedRoles = [];
    const removedRoles = [];
    
    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);
    if (verifiedRole && !member.roles.cache.has(verifiedRole.id)) {
        await member.roles.add(verifiedRole);
        addedRoles.push(verifiedRole.name);
    }
    
    const roleToRemove = guild.roles.cache.get(ROLE_TO_REMOVE_ON_VERIFICATION_ID);
    const playerRoleId = WELCOME_CONFIG?.roles?.player || null;
    if (
        roleToRemove &&
        roleToRemove.id !== playerRoleId &&
        member.roles.cache.has(ROLE_TO_REMOVE_ON_VERIFICATION_ID)
    ) {
        try {
            await member.roles.remove(roleToRemove);
            removedRoles.push(roleToRemove.name);
        } catch (error) {
            console.error(`Не удалось удалить роль ${ROLE_TO_REMOVE_ON_VERIFICATION_ID} для ${member.id}:`, error);
        }
    }
    
    let expectedVipRole = null;
    if (vipData) {
        const vipGroup = (vipData.group || 'DEFAULT').toUpperCase();
        expectedVipRole = guild.roles.cache.find(role => role.name === `${vipGroup}`);
        
        if (!expectedVipRole) {
            try {
                const allRoles = await guild.roles.fetch();
                expectedVipRole = allRoles?.find(role => role.name === `${vipGroup}`) || null;
            } catch (error) {
                console.error(`Ошибка при получении ролей гильдии:`, error);
            }
        }
        
        if (!expectedVipRole) {
            console.log(`Создание роли ${vipGroup} для пользователя ${member.user.tag}`);
            try {
                expectedVipRole = await guild.roles.create({
                    name: `${vipGroup}`,
                    color: 0xFFD700,
                    reason: `Автоматическое создание VIP роли для пользователя ${member.user.tag}`
                });
                console.log(`Создана роль: ${vipGroup}`);
            } catch (error) {
                console.error(`Не удалось создать роль VIP ${vipGroup}:`, error);
            }
        }
    }
    
    // Принудительно перезагружаем участника чтобы получить актуальные роли
    try {
        member = await guild.members.fetch({ user: member.id, force: true });
    } catch (error) {
        console.error(`Не удалось перезагрузить участника ${member.id}:`, error);
    }

    const vipGroupNames = ['VIP', 'PREMIUM', 'ULTRA', 'CRYSTAL', 'SPONSOR'];
    const currentVipRoles = member.roles.cache.filter(role =>
        vipGroupNames.includes(role.name) ||
        vipGroupNames.some(g => role.name === `VIP ${g}`)
    );
    
    console.log(`[processRoles] Текущие VIP роли пользователя ${member.user.tag}: ${currentVipRoles.map(r => r.name).join(', ')}`);
    console.log(`[processRoles] Ожидаемая VIP роль: ${expectedVipRole ? expectedVipRole.name : 'NONE'}`);
    
    const rolesToRemove = expectedVipRole
        ? Array.from(currentVipRoles.filter(role => role.id !== expectedVipRole.id).values())
        : Array.from(currentVipRoles.values());

    if (rolesToRemove.length > 0) {
        for (const role of rolesToRemove) {
            try {
                await member.roles.remove(role);
                removedRoles.push(role.name);
                console.log(`[processRoles] Удалена роль: ${role.name}`);
            } catch (error) {
                console.error(`Не удалось удалить роль ${role.name} для ${member.id}:`, error);
            }
        }
    }
    
    if (expectedVipRole && !member.roles.cache.has(expectedVipRole.id)) {
        await member.roles.add(expectedVipRole);
        addedRoles.push(expectedVipRole.name);
    }
    
    const messages = [];
    if (addedRoles.length > 0) {
        messages.push(`Добавлены роли: ${addedRoles.join(', ')}`);
    }
    if (removedRoles.length > 0) {
        messages.push(`Удалены роли: ${removedRoles.join(', ')}`);
    }
    
    if (vipData) {
        if (messages.length > 0) {
            return { success: true, message: `✅ Верификация успешна! ${messages.join(' | ')}` };
        } else {
            return { success: true, message: '✅ Верификация успешна! Роли уже актуальны.' };
        }
    } else {
        if (messages.length > 0) {
            return { success: true, message: `✅ Вы успешно верифицированы! ${messages.join(' | ')}\n*Ваш Steam ID не найден в базе VIP пользователей или срок действия истек.*` };
        } else {
            return { success: true, message: '✅ Вы успешно верифицированы! Роли уже актуальны.\n*Ваш Steam ID не найден в базе VIP пользователей или срок действия истек.*' };
        }
    }
}

async function verifyUser(user, steam64) {
    if (!/^\d{17}$/.test(steam64)) {
        return { success: false, message: '❌ Steam64 ID должен быть 17-значным числом.', dmSent: false };
    }

    // 🛡️ Верификация возможна только на сервере: interaction.member равен null в ЛС бота
    if (!user || !user.guild) {
        return { success: false, message: '❌ Команда доступна только на сервере.', dmSent: false };
    }

    try {
        const result = await processRoles(user, steam64);
        
        if (!result.success) {
            return { ...result, dmSent: false };
        }
        
        const pool = getNamedPool('vip');
        if (pool) {
            await pool.execute(
                `INSERT INTO verified_users (discord_id, steam64)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE steam64 = VALUES(steam64), verified_at = CURRENT_TIMESTAMP`,
                [user.id.toString(), steam64]
            );
        }

        // 🎮 Хук FACEIT: выдаём/обновляем роль уровня FACEIT после привязки Steam.
        // client.updateFaceitRole регистрируется cog'ом faceit_cog. Если его нет — noop.
        // user.client — глобальный клиент discord.js (доступен у любого объекта API).
        const discordClient = user?.client || user?.user?.client;
        if (discordClient && typeof discordClient.updateFaceitRole === 'function') {
            discordClient.updateFaceitRole(user, steam64);
        }

        // 💰 Хук доната: выдаём роль Меценат/Донатер по сумме доната.
        // client.updateDonateRole регистрируется cog'ом topdonate_cog. Если его нет — noop.
        if (discordClient && typeof discordClient.updateDonateRole === 'function') {
            discordClient.updateDonateRole(user, steam64);
        }

        // 📋 Лог верификации в отдельный канал
        try {
            const logChannel = discordClient?.channels?.cache?.get(VERIFICATION_LOG_CHANNEL_ID);
            if (logChannel) {
                const userObj = user.user || user;
                const avatarURL = userObj.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ Новая верификация')
                    .setColor(0x57F287)
                    .setDescription(
                        `> 👤 **Участник:** ${user} (\`${userObj.tag}\`)\n` +
                        `> 🆔 **Discord ID:** \`${user.id}\`\n` +
                        `> 🎮 **Steam64:** \`${steam64}\`\n` +
                        `> 🔗 **Профиль:** [Steam](https://steamcommunity.com/profiles/${steam64})`
                    )
                    .setThumbnail(avatarURL)
                    .setFooter({ text: 'LuxeCS2 · Верификация' })
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (logErr) {
            console.log(`Не удалось отправить лог верификации: ${logErr.message}`);
        }
        
        let dmSent = false;
        try {
            const userObj = user.user || user;
            await userObj.send(result.message);
            dmSent = true;
        } catch (dmError) {
            console.log(`Не удалось отправить DM пользователю ${user.id}:`, dmError.message);
        }
        
        return { ...result, dmSent };
    } catch (error) {
        console.error(`Ошибка верификации для ${user.id} с ${steam64}:`, error);
        return { success: false, message: `❌ Непредвиденная ошибка верификации: ${error.message}`, dmSent: false };
    }
}

async function updateRoles(user) {
    // 🛡️ Обновление ролей возможно только на сервере: interaction.member равен null в ЛС бота
    if (!user || !user.guild) {
        return { success: false, message: '❌ Команда доступна только на сервере.', dmSent: false };
    }

    const steam64 = await getVerifiedSteam64(user.id);

    if (!steam64) {
        return { success: false, message: '❌ Вы не верифицированы. Нажмите кнопку \'Верифицировать Steam\' сначала.', dmSent: false };
    }

    try {
        const result = await processRoles(user, steam64);
        
        if (result.success) {
            let messagePart = result.message;
            if (messagePart.includes(': ')) {
                messagePart = messagePart.split(': ', 2)[1];
            } else if (messagePart.includes('! ')) {
                messagePart = messagePart.split('! ', 2)[1];
            }
            const finalMessage = `✅ Обновление ролей завершено! ${messagePart}`;
            
            let dmSent = false;
            try {
                const userObj = user.user || user;
                await userObj.send(finalMessage);
                dmSent = true;
            } catch (dmError) {
                console.log(`Не удалось отправить DM пользователю ${user.id}:`, dmError.message);
            }
            
            return { success: true, message: finalMessage, dmSent };
        } else {
            return { ...result, dmSent: false };
        }
    } catch (error) {
        console.error(`Ошибка обновления ролей для ${user.id}:`, error);
        return { success: false, message: `❌ Непредвиденная ошибка при обновлении ролей: ${error.message}`, dmSent: false };
    }
}

async function getAllVerifiedUsers() {
    const pool = getNamedPool('vip');
    if (!pool) return [];
    
    try {
        const [rows] = await pool.execute(
            "SELECT discord_id, steam64 FROM verified_users"
        );
        return rows;
    } catch (error) {
        console.error('Ошибка получения всех верифицированных пользователей:', error);
        return [];
    }
}

async function checkAllVipRoles(client) {
    const pool = getNamedPool('vip');
    if (!pool) {
        console.log('⚠️ База данных недоступна, пропуск автоматической проверки VIP ролей');
        return;
    }
    
    const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
    if (!guild) {
        console.log('⚠️ Гильдия не найдена, пропуск автоматической проверки VIP ролей');
        return;
    }
    
    try {
        await guild.roles.fetch();
        console.log('📝 Кэш ролей гильдии обновлён');
    } catch (error) {
        console.error('⚠️ Ошибка обновления кэша ролей:', error);
    }
    
    console.log('🔄 Начало автоматической проверки VIP ролей...');
    
    try {
        const verifiedUsers = await getAllVerifiedUsers();
        console.log(`📊 Найдено ${verifiedUsers.length} верифицированных пользователей для проверки`);
        
        let updated = 0;
        let errors = 0;
        
        for (const userData of verifiedUsers) {
            try {
                // force: true — берём свежего GuildMember, а не возможный partial из кэша.
                // userData.discord_id намеренно оставляем строкой: Discord snowflake (18 цифр)
                // превышает Number.MAX_SAFE_INTEGER, приведение к числу ломает fetch.
                const member = await guild.members
                    .fetch({ user: userData.discord_id, force: true })
                    .catch(() => null);
                if (!member || !member.guild) {
                    console.log(`⚠️ Пользователь ${userData.discord_id} не найден на сервере (нет member/guild)`);
                    continue;
                }
                
                const result = await processRoles(member, userData.steam64);
                if (result.success) {
                    updated++;
                    console.log(`✅ Обновлены роли для ${member.user.tag}: ${result.message}`);
                } else {
                    errors++;
                    console.log(`❌ Ошибка для ${member.user.tag}: ${result.message}`);
                }
            } catch (error) {
                console.error(`Ошибка при проверке ролей для пользователя ${userData.discord_id}:`, error);
                errors++;
            }
        }
        
        console.log(`✅ Автоматическая проверка VIP ролей завершена. Обновлено: ${updated}, Ошибок: ${errors}`);
    } catch (error) {
        console.error('❌ Ошибка при автоматической проверке VIP ролей:', error);
    }
}

async function createVerificationMessage(client) {
    const channel = client.channels.cache.get(VERIFICATION_CHANNEL_ID);
    if (!channel) {
        console.log(`Канал верификации ${VERIFICATION_CHANNEL_ID} не найден`);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('⚡ ВЕРИФИКАЦИЯ STEAM')
        .setDescription(
            `### 🎮 Добро пожаловать на сервер!\n` +
            `> Привяжи свой Steam-аккаунт и получи доступ ко всем каналам + **VIP-статус**.\n\n` +
            `### 🔥 Как это работает\n` +
            `> **1.** Нажми **🎯 Верифицировать Steam**\n` +
            `> **2.** Вставь свой **17-значный Steam64 ID**\n` +
            `> **3.** Получи роль и врывайся на сервер! 🚀\n\n` +
            `> 📌 Не знаешь свой ID? → [steamid.io](https://steamid.io/)\n` +
            `> ⚠️ Роли не обновились? Жми **🔄 Обновить роли**`
        )
        .setColor(0xFF6B00)
        .setImage(VERIFICATION_IMAGE_URL)
        .addFields(
            {
                name: '👑 VIP-ранги на сервере',
                value: '🥇 `VIP`　•　💎 `PREMIUM`　•　⚡ `ULTRA`　•　🔮 `CRYSTAL`　•　🏆 `SPONSOR`',
                inline: false
            },
            {
                name: '🔄 Автообновление',
                value: '> Раз в **час** бот сам\n> проверяет твой VIP-статус',
                inline: true
            },
            {
                name: '🛡️ Безопасность',
                value: '> Данные хранятся\n> в защищённой базе',
                inline: true
            },
            {
                name: '\u200b',
                value: '\u200b',
                inline: true
            }
        )
        .setFooter({ text: '⚡ LuxeCS2 · Верификация · Данные защищены · Автосинхронизация каждый час' })
        .setTimestamp();

    const pool = getNamedPool('vip');
    const dbReady = pool !== null;

    const verifyButton = new ButtonBuilder()
        .setCustomId('verify_steam')
        .setLabel(dbReady ? '🎯 Верифицировать Steam' : 'База данных недоступна')
        .setStyle(dbReady ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!dbReady);

    const updateRolesButton = new ButtonBuilder()
        .setCustomId('update_roles')
        .setLabel('🔄 Обновить роли')
        .setStyle(ButtonStyle.Primary);

    const siteButton = new ButtonBuilder()
        .setLabel('🌐 Сайт проекта')
        .setURL(PROJECT_URL)
        .setStyle(ButtonStyle.Link);

    const row1 = new ActionRowBuilder().addComponents(verifyButton, updateRolesButton);
    const row2 = new ActionRowBuilder().addComponents(siteButton);

    if (VERIFICATION_MESSAGE_ID) {
        try {
            const message = await channel.messages.fetch(VERIFICATION_MESSAGE_ID);
            await message.edit({ embeds: [embed], components: [row1, row2] });
        } catch (error) {
            if (error.code === 10008) {
                const message = await channel.send({ embeds: [embed], components: [row1, row2] });
                console.log(`Создано новое сообщение верификации с ID: ${message.id}`);
            }
        }
    } else {
        const message = await channel.send({ embeds: [embed], components: [row1, row2] });
        console.log(`Создано сообщение верификации с ID: ${message.id}`);
    }
}

export default async function(client) {
    console.log('📝 Начало выполнения verification_cog...');
    
    try {
        await createNamedPool('vip', DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
        console.log('📝 Пул базы данных создан');
    } catch (error) {
        console.error('📝 Ошибка создания пула базы данных:', error);
    }
    
    const pool = getNamedPool('vip');
    if (pool) {
        try {
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS verified_users (
                    discord_id VARCHAR(20) PRIMARY KEY,
                    steam64 VARCHAR(17) NOT NULL,
                    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица verified_users создана/проверена');

            // ── МИГРАЦИЯ: discord_id BIGINT → VARCHAR(20) ──────────────────────
            // Старая схема имела discord_id как BIGINT, что вызывало потерю
            // точности (ID оканчивались на 00/700...). Приводим к VARCHAR(20).
            // ALTER без DATA LOSS для уже-VARCHAR — noop (проверяем тип).
            try {
                const [cols] = await pool.execute("SHOW COLUMNS FROM verified_users LIKE 'discord_id'");
                if (cols.length > 0 && /^bigint/i.test(cols[0].Type)) {
                    console.log('📝 Миграция: discord_id BIGINT → VARCHAR(20)...');
                    await pool.query("ALTER TABLE verified_users MODIFY COLUMN discord_id VARCHAR(20) NOT NULL");
                    console.log('✅ Миграция discord_id выполнена');
                }
            } catch (e) {
                console.error('⚠️ Миграция discord_id (проверка типа):', e.message);
            }
        } catch (error) {
            console.error('Ошибка создания таблицы verified_users:', error);
        }
    } else {
        console.error('📝 Пул базы данных недоступен после создания');
    }
    
    client.once('clientReady', async () => {
        console.log('📝 Событие clientReady сработало!');
        const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
        if (guild) {
            const vipGroups = ['VIP', 'PREMIUM', 'ULTRA', 'CRYSTAL', 'SPONSOR'];
            for (const group of vipGroups) {
                const roleName = `${group}`;
                let role = guild.roles.cache.find(r => r.name === roleName);
                if (!role) {
                    role = await guild.roles.create({
                        name: roleName,
                        color: 0xFFD700
                    });
                    console.log(`Создана роль: ${roleName}`);
                }
            }
            
            let verifiedRole = guild.roles.cache.find(r => r.name === 'Верифицирован');
            if (!verifiedRole) {
                verifiedRole = await guild.roles.create({
                    name: 'Верифицирован',
                    color: 0x00FF00
                });
                console.log('Создана роль: Верифицирован');
            }
        }
        
        await createVerificationMessage(client);
        console.log('📝 Сообщение верификации создано');
        
        const CHECK_INTERVAL = 60 * 60 * 1000;
        console.log(`📝 Установка интервала автообновления: ${CHECK_INTERVAL / 1000 / 60} минут`);
        
        setTimeout(() => {
            console.log('📝 Первая проверка VIP ролей через 60 секунд...');
            checkAllVipRoles(client);
        }, 60 * 1000);
        
        setInterval(() => {
            console.log('📝 Плановая проверка VIP ролей...');
            checkAllVipRoles(client);
        }, CHECK_INTERVAL);
        
        console.log('✅ Автоматическая проверка VIP ролей настроена (каждый час)');
    });
    
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (!['verify_steam', 'update_roles'].includes(interaction.customId)) return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);
        
        if (interaction.customId === 'verify_steam') {
            const pool = getNamedPool('vip');
            if (!pool) {
                try {
                    await interaction.user.send('❌ Система верификации или база данных недоступна. Попробуйте позже.');
                } catch {
                    await interaction.reply({
                        content: '❌ Система верификации или база данных недоступна. Попробуйте позже. (Откройте личные сообщения, чтобы получать уведомления.)',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                await interaction.deferUpdate();
                return;
            }
            
            const modal = new ModalBuilder()
                .setCustomId('verify_steam_modal')
                .setTitle('👤 Верификация Steam Профиля');
            
            const steamIdInput = new TextInputBuilder()
                .setCustomId('steam_id')
                .setLabel('Steam64 ID (17 цифр)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Пример: 76561198000000000')
                .setMinLength(17)
                .setMaxLength(17)
                .setRequired(true);
            
            const row = new ActionRowBuilder().addComponents(steamIdInput);
            modal.addComponents(row);
            
            await interaction.showModal(modal);
        }
        
        if (interaction.customId === 'update_roles') {
            const pool = getNamedPool('vip');
            if (!pool) {
                try {
                    await interaction.user.send('❌ Система верификации или база данных недоступна. Попробуйте позже.');
                } catch {
                    await interaction.reply({
                        content: '❌ Система верификации или база данных недоступна. Попробуйте позже. (Откройте личные сообщения, чтобы получать уведомления.)',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                await interaction.deferUpdate();
                return;
            }
            
            await interaction.deferUpdate();
            
            await updateRoles(interaction.member);
        }
    });
    
    client.on('interactionCreate', async interaction => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== 'verify_steam_modal') return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);
        
        {
            const steamId = interaction.fields.getTextInputValue('steam_id');
            
            if (!/^\d{17}$/.test(steamId)) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    await interaction.user.send('❌ Steam64 ID должен состоять только из 17 цифр.');
                    await interaction.deleteReply();
                } catch {
                    await interaction.editReply('❌ Steam64 ID должен состоять только из 17 цифр. (Откройте личные сообщения, чтобы получать уведомления.)');
                }
                return;
            }
            
            const pool = getNamedPool('vip');
            if (!pool) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    await interaction.user.send('❌ Система верификации или база данных недоступна. Попробуйте позже.');
                    await interaction.deleteReply();
                } catch {
                    await interaction.editReply('❌ Система верификации или база данных недоступна. Попробуйте позже. (Откройте личные сообщения, чтобы получать уведомления.)');
                }
                return;
            }
            
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            const result = await verifyUser(interaction.member, steamId);
            if (result.dmSent) {
                await interaction.deleteReply();
            } else {
                await interaction.editReply({ content: `${result.message}\n\n(Откройте личные сообщения, чтобы получать уведомления.)` });
            }
        }
    });
}