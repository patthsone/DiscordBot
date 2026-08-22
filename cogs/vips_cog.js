import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { ADMIN_ROLE_ID, GUILD_ID, DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } from '../config.js';
import { createNamedPool, getNamedPool } from '../utils/database.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { getSteamProfileInfo, resolveSteamCustomUrl } from '../utils/steam.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VIP_CONFIG_FILE = join(__dirname, '..', 'vip_config.json');

function loadVipConfig() {
    return loadJSON(VIP_CONFIG_FILE, null);
}

function saveVipConfig(config) {
    saveJSON(VIP_CONFIG_FILE, config);
}

function accountIdToSteam64(accountId) {
    return String(BigInt(76561197960265728) + BigInt(accountId));
}

function steam64ToAccountId(steam64) {
    if (!/^\d+$/.test(steam64)) {
        throw new Error("Steam64 ID должен состоять только из цифр.");
    }
    return BigInt(steam64) - BigInt(76561197960265728);
}

function parseSteamId(inputStr) {
    inputStr = inputStr.trim();

    if (/^\d{17}$/.test(inputStr)) {
        const accountId = steam64ToAccountId(inputStr);
        return { accountId, steam64: inputStr };
    }

    const profileMatch = inputStr.match(/steamcommunity\.com\/profiles\/(\d+)/);
    if (profileMatch) {
        const steam64 = profileMatch[1];
        const accountId = steam64ToAccountId(steam64);
        return { accountId, steam64 };
    }

    const customMatch = inputStr.match(/steamcommunity\.com\/id\/([^/\s]+)/);
    if (customMatch) {
        return { accountId: null, steam64: null };
    }

    const id3Match = inputStr.match(/\[U:1:(\d+)\]/);
    if (id3Match) {
        const accountId = BigInt(id3Match[1]);
        const steam64 = accountIdToSteam64(accountId);
        return { accountId, steam64 };
    }

    if (/^\d+$/.test(inputStr)) {
        const accountId = BigInt(inputStr);
        if (accountId > 0 && accountId < 10000000000) {
            const steam64 = accountIdToSteam64(accountId);
            return { accountId, steam64 };
        }
    }

    throw new Error("Не удалось распознать формат Steam ID. Используйте Steam64 ID, ссылку на профиль Steam или Steam ID3.");
}

// resolveSteamCustomUrl и getSteamProfileInfo импортируются из ../utils/steam.js
// (общий модуль: Steam Web API + кеш + очередь + ретраи при 429).
// Локальные axios-реализации удалены — они получали 429/блок от Steam
// и возвращали name='Unknown', avatar=null.

async function connectVipDb(host = null, user = null, password = null, database = null) {
    try {
        let config = null;

        if (host && user && password && database) {
            // Переданы параметры команды /connect_vip_db — сохраняем их
            config = { host, user, password, database };
            saveVipConfig(config);
        } else {
            // Грузимся при старте: пробуем vip_config.json, иначе — дефолты из config.js.
            // Раньше тут был баг: loadVipConfig() возвращал {host:"",...} (не null),
            // проверка if(!config) пропускалась, и createPool("",...) молча падал.
            const fileCfg = loadVipConfig();
            if (fileCfg && fileCfg.host && fileCfg.user && fileCfg.database) {
                config = fileCfg;
            } else {
                // Fallback на глобальные настройки (те же, что verification_cog)
                config = { host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME };
            }
        }

        // Создаём/обновляем именованный пул «vip» — тот же, что verification_cog,
        // notifications_cog и vips_cog используют совместно. Это гарантирует,
        // что подключение живёт и после рестарта (verification_cog пересоздаёт его).
        await createNamedPool('vip', config.host, config.user, config.password, config.database);

        const pool = getNamedPool('vip');
        if (!pool) {
            console.error('connectVipDb: не удалось создать пул «vip»');
            return false;
        }
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS vip_users (
                account_id VARCHAR(20) NOT NULL,
                name VARCHAR(255),
                \`group\` VARCHAR(50),
                lastvisit INT DEFAULT 0,
                expires INT DEFAULT 0,
                sid INT DEFAULT 1,
                PRIMARY KEY (account_id, sid)
            )
        `);

        console.log('Подключение к базе данных VIP установлено успешно (пул «vip»)');
        return true;
    } catch (error) {
        console.error('Ошибка подключения к базе данных VIP:', error);
        return false;
    }
}

async function getVipUser(accountId, sid = 1) {
    const pool = getNamedPool('vip');
    if (!pool) return null;

    try {
        const [rows] = await pool.execute(
            "SELECT * FROM vip_users WHERE account_id = ? AND sid = ? ORDER BY expires DESC LIMIT 1",
            [accountId.toString(), sid]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Ошибка получения VIP пользователя:', error);
        return null;
    }
}

async function getAllVipUsers(sid = 1, limit = 200) {
    const pool = getNamedPool('vip');
    if (!pool) return [];

    try {
        const safeLimit = parseInt(limit, 10);
        if (isNaN(safeLimit) || safeLimit < 1) {
            throw new Error('Invalid limit value');
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const [rows] = await pool.execute(
            `SELECT * FROM vip_users WHERE sid = ? AND (expires = 0 OR expires > ?) ORDER BY account_id, expires DESC LIMIT ${safeLimit}`,
            [sid, currentTime]
        );
        return rows;
    } catch (error) {
        console.error('Ошибка получения всех VIP пользователей:', error);
        return [];
    }
}

async function searchVipUser(searchTerm, sid = 1) {
    const pool = getNamedPool('vip');
    if (!pool) return [];

    try {
        if (/^\d+$/.test(searchTerm)) {
            const [rows] = await pool.execute(
                "SELECT * FROM vip_users WHERE account_id = ? AND sid = ?",
                [searchTerm, sid]
            );
            if (rows.length > 0) {
                return rows;
            }
        }

        const [rows] = await pool.execute(
            "SELECT * FROM vip_users WHERE name LIKE ? AND sid = ? ORDER BY account_id LIMIT 20",
            [`%${searchTerm}%`, sid]
        );
        return rows;
    } catch (error) {
        console.error('Ошибка поиска VIP пользователя:', error);
        return [];
    }
}

function formatTimestamp(timestamp) {
    if (timestamp === 0) return "Никогда";
    try {
        const dt = new Date(timestamp * 1000);
        return dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return "Неизвестно";
    }
}

function formatExpires(expires) {
    if (expires === 0) return "Бессрочно";
    try {
        const dt = new Date(expires * 1000);
        return dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return "Неизвестно";
    }
}

// ─── Премиум-палитра (золотая тема под VIP) ──────────────────────────────────
const THEME = {
    GOLD:      0xFFD700, // золото — база
    PERMANENT: 0x57F287, // зелёный — бессрочный VIP
    EXPIRING:  0xFEE75C, // жёлтый — скоро истекает (< 3 дней)
    EXPIRED:   0xED4245, // красный — истёк
    DIVIDER:   '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯'
};
const PROJECT_URL = 'https://luxecs2.su/';

// Иконка ранга по названию группы
function rankIcon(group) {
    const g = String(group || '').toUpperCase();
    if (g === 'SPONSOR') return '🏆';
    if (g === 'CRYSTAL') return '🔮';
    if (g === 'ULTRA')   return '⚡';
    if (g === 'PREMIUM') return '💎';
    if (g === 'VIP')     return '🥇';
    return '⭐';
}

// Сколько дней осталось до истечения (Infinity — бессрочный)
function daysLeft(expires) {
    if (expires === 0) return Infinity;
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, Math.ceil((expires - now) / 86400));
}

// Цвет embed'а по статусу истечения
function statusColor(expires) {
    if (expires === 0) return THEME.PERMANENT;
    const days = daysLeft(expires);
    if (days <= 0)  return THEME.EXPIRED;
    if (days <= 3)  return THEME.EXPIRING;
    return THEME.GOLD;
}

// Бейдж срока: ∞ Навсегда / ⚠️ N дн. / ⛔ Истёк
function expiryBadge(expires) {
    const days = daysLeft(expires);
    if (days === Infinity) return '`∞ Навсегда`';
    if (days <= 0)         return '`⛔ Истёк`';
    if (days <= 3)         return `\`⚠️ ${days} дн.\``;
    return `\`${days} дн.\``;
}

async function createVipEmbed(vipData, steamInfo = null) {
    const accountId = vipData.account_id;
    const steam64 = accountIdToSteam64(accountId);
    const profileUrl = steamInfo?.profile_url || `https://steamcommunity.com/profiles/${steam64}`;
    // Обрезаем длинные Steam-ники (защита от лимитов embed)
    const rawName = steamInfo?.name || vipData.name || 'Unknown';
    const name = rawName.length > 100 ? rawName.slice(0, 97) + '…' : rawName;
    const group = vipData.group || 'VIP';
    const icon = rankIcon(group);
    const color = statusColor(vipData.expires);

    // Срок: относительный timestamp Discord + бейдж дней
    const expiresLine = vipData.expires > 0
        ? `<t:${vipData.expires}:R> · <t:${vipData.expires}:f>`
        : '`∞ Бессрочно`';

    const descParts = [
        `### ${icon} ${name}`,
        `> 💎 **Ранг:** \`${group}\``,
        `> 🔗 [Профиль Steam](${profileUrl})`
    ].join('\n');

    const embed = new EmbedBuilder()
        .setDescription(descParts)
        .setColor(color);

    if (steamInfo?.avatar) embed.setThumbnail(steamInfo.avatar);

    embed.addFields(
        { name: '🎟️ Срок действия', value: expiresLine, inline: false },
        { name: '📅 Осталось', value: expiryBadge(vipData.expires), inline: true },
        { name: '🖥️ Сервер', value: `\`${vipData.sid}\``, inline: true },
        { name: '\u200b', value: THEME.DIVIDER, inline: false },
        { name: '🕐 Последний визит', value: `\`${formatTimestamp(vipData.lastvisit)}\``, inline: true },
        { name: '🆔 Account ID', value: `\`${accountId}\``, inline: true },
        { name: '🔢 Steam64', value: `\`${steam64}\``, inline: true }
    );

    embed.setFooter({
        text: `${icon} ${group}  ·  LuxeCS2`,
        iconURL: steamInfo?.avatar || undefined
    });

    return embed;
}

async function createVipListEmbed(vipUsers, page = 1, perPage = 10) {
    const uniquePlayers = {};
    for (const user of vipUsers) {
        const accountId = user.account_id;
        if (!uniquePlayers[accountId]) {
            uniquePlayers[accountId] = user;
        }
    }

    const uniqueList = Object.values(uniquePlayers);
    const total = uniqueList.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const end = Math.min(start + perPage, total);
    const pageUsers = uniqueList.slice(start, end);

    // Сводка по рангам для шапки списка
    const rankCounts = {};
    for (const u of uniqueList) {
        const g = u.group || 'VIP';
        rankCounts[g] = (rankCounts[g] || 0) + 1;
    }
    const rankSummary = Object.entries(rankCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([g, c]) => `${rankIcon(g)} \`${g}\`: **${c}**`)
        .join('　');

    const embed = new EmbedBuilder()
        .setTitle('👑 VIP Состав сервера')
        .setDescription(
            `> 📊 **Всего игроков:** \`${total}\`　` +
            `📄 **Страница:** \`${page}/${totalPages}\`` +
            (rankSummary ? `\n> ${rankSummary}` : '')
        )
        .setColor(THEME.GOLD);

    if (pageUsers.length === 0) {
        embed.addFields({ name: '📭 Пусто', value: 'VIP игроки не найдены.', inline: false });
        embed.setFooter({ text: 'Используйте /vips для обновления' });
        return embed;
    }

    // Сортировка: бессрочные → по убыванию срока → по рангу
    pageUsers.sort((a, b) => {
        if (a.expires === 0 && b.expires !== 0) return -1;
        if (a.expires !== 0 && b.expires === 0) return 1;
        if (a.expires !== b.expires) return b.expires - a.expires;
        return String(a.group).localeCompare(String(b.group));
    });

    for (let i = 0; i < pageUsers.length; i++) {
        const user = pageUsers[i];
        const accountId = user.account_id;
        const steam64 = accountIdToSteam64(accountId);
        const profileUrl = `https://steamcommunity.com/profiles/${steam64}`;
        // Обрезаем имя (защита от лимитов Discord для названия поля)
        const rawName = user.name || 'Unknown';
        const name = rawName.length > 80 ? rawName.slice(0, 77) + '…' : rawName;
        const group = user.group || 'VIP';
        const icon = rankIcon(group);

        const num = start + i + 1;
        const nameField = `${icon} **${num}.** [${name}](${profileUrl})`;
        const value = `\`${group}\`  ·  🎟️ ${expiryBadge(user.expires)}  ·  🕐 ${formatTimestamp(user.lastvisit)}`;

        embed.addFields({ name: nameField, value, inline: false });
    }

    embed.setFooter({ text: `Страница ${page} / ${totalPages}  ·  Используйте кнопки для навигации` });

    return embed;
}

class VipListView {
    constructor(cog, vipUsers, perPage = 10, timeout = 300000) {
        this.cog = cog;
        this.vipUsers = vipUsers;
        this.perPage = perPage;
        this.currentPage = 1;
        this.timeout = timeout;
        this.createdAt = Date.now();
        this.updateButtons();
    }

    getTotalPages() {
        const uniquePlayers = {};
        for (const user of this.vipUsers) {
            const accountId = user.account_id;
            if (!uniquePlayers[accountId]) {
                uniquePlayers[accountId] = user;
            }
        }
        const total = Object.keys(uniquePlayers).length;
        return Math.max(1, Math.ceil(total / this.perPage));
    }

    updateButtons() {
        const totalPages = this.getTotalPages();
        this.previousDisabled = this.currentPage <= 1;
        this.nextDisabled = this.currentPage >= totalPages;
    }

    getComponents() {
        const totalPages = this.getTotalPages();
        const row = new ActionRowBuilder();

        const previousButton = new ButtonBuilder()
            .setCustomId('vip_prev')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.previousDisabled);

        // Кнопка-счётчик страниц (неактивная, просто индикатор)
        const counter = new ButtonBuilder()
            .setCustomId('vip_page_noop')
            .setLabel(`${this.currentPage} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true);

        const nextButton = new ButtonBuilder()
            .setCustomId('vip_next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.nextDisabled);

        const refreshButton = new ButtonBuilder()
            .setCustomId('vip_refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary);

        row.addComponents(previousButton, counter, nextButton, refreshButton);

        // Второй ряд — кнопка-ссылка на сайт проекта
        const siteRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('🌐 Сайт проекта')
                .setURL(PROJECT_URL)
                .setStyle(ButtonStyle.Link)
        );

        return [row, siteRow];
    }
}

// Select-меню для выбора конкретного VIP-игрока из списка (переход в детали).
// Берёт игроков текущей страницы (уже отсортированных в createVipListEmbed).
function buildVipSelectMenu(vipUsers, page, perPage = 10) {
    const uniquePlayers = {};
    for (const u of vipUsers) {
        if (!uniquePlayers[u.account_id]) uniquePlayers[u.account_id] = u;
    }
    const uniqueList = Object.values(uniquePlayers);
    const start = (page - 1) * perPage;
    const pageUsers = uniqueList.slice(start, start + perPage).slice(0, 25);

    if (pageUsers.length === 0) return null;

    const select = new StringSelectMenuBuilder()
        .setCustomId('vip_select')
        .setPlaceholder('🔍 Выберите игрока для подробной информации...')
        .setMinValues(1)
        .setMaxValues(1);

    for (const user of pageUsers) {
        // label: 1-100 символов, не пустой. Имя из БД может быть null/пустым.
        let label = (user.name || '').toString().trim() || 'Без имени';
        if (label.length > 100) label = label.slice(0, 97) + '…';
        // Группа и срок для description (до 100 символов)
        const group = (user.group || 'VIP').toString().slice(0, 20);
        const badge = expiryBadge(user.expires).replace(/`/g, '').trim();
        let description = `${rankIcon(group)} ${group} · ${badge}`.slice(0, 100);
        select.addOptions({
            label,
            value: String(user.account_id), // Discord требует строку (из БД приходит число)
            description
        });
    }
    return new ActionRowBuilder().addComponents(select);
}

export default function(client) {
    let vipDbConfig = null;
    const vipViews = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [messageId, viewData] of vipViews.entries()) {
            if (now - viewData.view.createdAt > viewData.view.timeout) {
                vipViews.delete(messageId);
            }
        }
    }, 5 * 60 * 1000);

    client.once('clientReady', async () => {
        const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
        if (guild) {
            const vipGroups = ['VIP', 'PREMIUM', 'ULTRA', 'CRYSTAL', 'SPONSOR'];
            for (const group of vipGroups) {
                const roleName = `${group}`;
                let role = guild.roles.cache.find(r => r.name === roleName);
                if (!role) {
                    try {
                        role = await guild.roles.create({
                            name: roleName,
                            color: 0xFFD700,
                            reason: 'Автоматическое создание VIP роли'
                        });
                        console.log(`✅ Создана роль: ${roleName}`);
                    } catch (error) {
                        console.error(`❌ Не удалось создать роль ${roleName}:`, error);
                    }
                }
            }
        }

        await client.application.commands.create({
            name: 'connect_vip_db',
            description: 'Подключиться к базе данных VIP (только для администраторов)',
            options: [
                { name: 'host', type: 3, description: 'Хост базы данных', required: true },
                { name: 'user', type: 3, description: 'Имя пользователя', required: true },
                { name: 'password', type: 3, description: 'Пароль', required: true },
                { name: 'database', type: 3, description: 'Название базы данных', required: true }
            ]
        });

        await client.application.commands.create({
            name: 'vips',
            description: 'Просмотр информации о VIP игроках',
            options: [
                { name: 'search', type: 3, description: 'Поиск игрока (Steam ID, ссылка на профиль, имя)', required: false },
                { name: 'page', type: 4, description: 'Номер страницы для просмотра списка (по умолчанию 1)', required: false }
            ]
        });

        const config = loadVipConfig();
        if (config) {
            console.log('Загрузка конфигурации базы данных VIP из файла...');
            const success = await connectVipDb(
                config.host,
                config.user,
                config.password,
                config.database
            );
            if (success) {
                console.log('Конфигурация базы данных VIP загружена успешно.');
            }
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'connect_vip_db') return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);

        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            await interaction.reply({
                content: '❌ У вас нет прав для выполнения этой команды.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const host = interaction.options.getString('host');
        const user = interaction.options.getString('user');
        const password = interaction.options.getString('password');
        const database = interaction.options.getString('database');

        const success = await connectVipDb(host, user, password, database);

        if (success) {
            await interaction.followUp({
                content: '✅ Подключение к базе данных VIP установлено успешно!\nКонфигурация сохранена и будет загружена при следующем запуске.'
            });
        } else {
            await interaction.followUp({
                content: '❌ Не удалось подключиться к базе данных VIP. Проверьте параметры подключения.'
            });
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'vips') return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);

        {
            const pool = getNamedPool('vip');
            if (!pool) {
                await interaction.reply({
                    content: '❌ База данных VIP не подключена. Администратор должен использовать `/connect_vip_db` для подключения.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.deferReply();

            try {
                const search = interaction.options.getString('search');
                const page = interaction.options.getInteger('page') || 1;

                if (search) {
                    let accountId = null;
                    let steam64 = null;

                    try {
                        const parsed = parseSteamId(search);
                        accountId = parsed.accountId;
                        steam64 = parsed.steam64;
                    } catch (error) {
                        const customMatch = search.match(/steamcommunity\.com\/id\/([^/\s]+)/);
                        if (customMatch) {
                            const resolved = await resolveSteamCustomUrl(customMatch[1]);
                            accountId = resolved.accountId;
                            steam64 = resolved.steam64;
                        }
                    }

                    if (accountId !== null && steam64 !== null) {
                        const vipData = await getVipUser(accountId);
                        if (vipData) {
                            const steamInfo = await getSteamProfileInfo(steam64);
                            const embed = await createVipEmbed(vipData, steamInfo);
                            await interaction.followUp({ embeds: [embed] });
                        } else {
                            await interaction.followUp({
                                content: '❌ Игрок с таким Steam ID не найден в базе VIP пользователей.'
                            });
                        }
                    } else {
                        const results = await searchVipUser(search);
                        if (results.length > 0) {
                            if (results.length === 1) {
                                const vipData = results[0];
                                const accountId = vipData.account_id;
                                const steam64 = accountIdToSteam64(accountId);
                                const steamInfo = await getSteamProfileInfo(steam64);
                                const embed = await createVipEmbed(vipData, steamInfo);
                                await interaction.followUp({ embeds: [embed] });
                            } else {
                                const embed = await createVipListEmbed(results, 1);
                                const view = new VipListView({ createVipListEmbed }, results, 10);
                                const components = [...view.getComponents()];
                                const selectRow = buildVipSelectMenu(results, 1, 10);
                                if (selectRow) components.push(selectRow);
                                const message = await interaction.followUp({ embeds: [embed], components });
                                vipViews.set(message.id, { vipUsers: results, view, page: 1 });
                            }
                        } else {
                            await interaction.followUp({
                                content: `❌ Игрок '${search}' не найден в базе VIP пользователей.`
                            });
                        }
                    }
                } else {
                    const vipUsers = await getAllVipUsers(1, 200);
                    if (vipUsers.length > 0) {
                        const embed = await createVipListEmbed(vipUsers, page);
                        const view = new VipListView({ createVipListEmbed }, vipUsers, 10);
                        view.currentPage = page;
                        view.updateButtons();
                        const components = [...view.getComponents()];
                        const selectRow = buildVipSelectMenu(vipUsers, page, 10);
                        if (selectRow) components.push(selectRow);
                        const message = await interaction.followUp({ embeds: [embed], components });
                        vipViews.set(message.id, { vipUsers, view, page });
                    } else {
                        await interaction.followUp({
                            content: '❌ В базе данных нет VIP пользователей.'
                        });
                    }
                }
            } catch (error) {
                console.error('Ошибка в команде vips:', error);
                await interaction.followUp({
                    content: `❌ Произошла ошибка при выполнении команды: ${error.message}`
                });
            }
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        const customId = interaction.customId;
        if (!['vip_prev', 'vip_next', 'vip_refresh'].includes(customId)) return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);

        // Кнопка-счётчик — просто подтверждаем, ничего не делаем
        if (customId === 'vip_page_noop') {
            await interaction.deferUpdate().catch(() => {});
            return;
        }

        const messageId = interaction.message.id;
        const viewData = vipViews.get(messageId);

        if (!viewData) {
            await interaction.reply({
                content: '❌ Состояние просмотра не найдено. Используйте команду `/vips` заново.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferUpdate();

        try {
            const { vipUsers, view } = viewData;

            if (customId === 'vip_refresh') {
                const refreshedUsers = await getAllVipUsers(1, 200);
                view.vipUsers = refreshedUsers;
                view.currentPage = 1;
                view.updateButtons();

                const embed = await createVipListEmbed(refreshedUsers, 1);
                const components = [...view.getComponents()];
                const selectRow = buildVipSelectMenu(refreshedUsers, 1, 10);
                if (selectRow) components.push(selectRow);
                vipViews.set(messageId, { vipUsers: refreshedUsers, view, page: 1 });
                await interaction.editReply({ embeds: [embed], components });
            } else if (customId === 'vip_prev') {
                if (view.currentPage > 1) {
                    view.currentPage--;
                    view.updateButtons();
                    const embed = await createVipListEmbed(vipUsers, view.currentPage);
                    const components = [...view.getComponents()];
                    const selectRow = buildVipSelectMenu(vipUsers, view.currentPage, 10);
                    if (selectRow) components.push(selectRow);
                    vipViews.set(messageId, { vipUsers, view, page: view.currentPage });
                    await interaction.editReply({ embeds: [embed], components });
                }
            } else if (customId === 'vip_next') {
                const totalPages = view.getTotalPages();
                if (view.currentPage < totalPages) {
                    view.currentPage++;
                    view.updateButtons();
                    const embed = await createVipListEmbed(vipUsers, view.currentPage);
                    const components = [...view.getComponents()];
                    const selectRow = buildVipSelectMenu(vipUsers, view.currentPage, 10);
                    if (selectRow) components.push(selectRow);
                    vipViews.set(messageId, { vipUsers, view, page: view.currentPage });
                    await interaction.editReply({ embeds: [embed], components });
                }
            }
        } catch (error) {
            console.error('Ошибка обработки кнопки VIP:', error);
            await interaction.followUp({
                content: `❌ Произошла ошибка: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    });

    // ── Обработчик выбора игрока из select-меню (переход в детали) ──────────
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'vip_select') return;
        if (client.handledInteractions?.has(interaction.id)) return;
        client.handledInteractions?.add(interaction.id);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const accountId = interaction.values[0];
            const pool = getNamedPool('vip');
            if (!pool) {
                await interaction.editReply({ content: '❌ База данных VIP недоступна.' });
                return;
            }

            // Ищем игрока по account_id
            const vipData = await getVipUser(accountId);
            if (!vipData) {
                await interaction.editReply({ content: '❌ Игрок не найден в базе VIP.' });
                return;
            }

            const steam64 = accountIdToSteam64(accountId);
            const steamInfo = await getSteamProfileInfo(steam64);
            const embed = await createVipEmbed(vipData, steamInfo);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Ошибка выбора игрока из меню VIP:', error);
            await interaction.editReply({
                content: `❌ Произошла ошибка: ${error.message}`
            }).catch(() => {});
        }
    });
}
