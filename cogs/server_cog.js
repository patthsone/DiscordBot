import { EmbedBuilder, MessageFlags } from 'discord.js';
import { STATUS_CHANNEL_ID, ADMIN_ROLE_ID, DEFAULT_SERVERS, UPDATE_INTERVAL } from '../config.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { getServerInfo } from '../utils/serverMonitor.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MESSAGE_IDS_FILE = join(__dirname, '..', 'message_ids.json');
const SERVERS_FILE = join(__dirname, '..', 'servers.json');

function loadMessageIds() { return loadJSON(MESSAGE_IDS_FILE, []); }
function saveMessageIds(ids) { saveJSON(MESSAGE_IDS_FILE, ids); }
function loadServers() { return loadJSON(SERVERS_FILE, DEFAULT_SERVERS); }
function saveServers(servers) { saveJSON(SERVERS_FILE, servers); }

async function createServerEmbed(server) {
    const info = await getServerInfo(server.ip, server.port);
    const now = new Date();
    const timestamp = now.toLocaleString('ru-RU', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    if (info) {
        const players = info.players;
        const maxPlayers = info.max_players;
        const percent = maxPlayers > 0 ? players / maxPlayers : 0;

        // Выбор иконки и цвета в зависимости от заполненности
        let statusIcon = '🟢';
        let color = 0x57F287; // зелёный
        if (percent === 1) {
            statusIcon = '🔴';
            color = 0xED4245; // красный
        } else if (percent > 0) {
            statusIcon = '🟡';
            color = 0xFEE75C; // жёлтый
        }

        return new EmbedBuilder()
            .setColor(color)
            .setDescription(
                `┏ ${statusIcon} **${info.name}**\n` +
                `┕ \`connect ${server.ip}:${server.port}\` → 👥 **${players}/${maxPlayers}**  |  🗺️ ${info.map}`
            )
            .setFooter({ text: `🕐 ${timestamp}` });
    } else {
        return new EmbedBuilder()
            .setColor(0xED4245)
            .setDescription(
                `┏ 🔴 **${server.name || 'Сервер'}**\n` +
                `┕ \`connect ${server.ip}:${server.port}\` → ❌ **Офлайн**`
            )
            .setFooter({ text: `🕐 ${timestamp}` });
    }
}

export default function(client) {
    let SERVERS = loadServers();
    let messageIds = loadMessageIds();

    // Единый обработчик взаимодействий (автодополнение + команды)
    client.on('interactionCreate', async interaction => {
        try {
            // Автодополнение для /remove_server
            if (interaction.isAutocomplete()) {
                if (interaction.commandName === 'remove_server') {
                    const focused = interaction.options.getFocused();
                    const filtered = SERVERS
                        .filter(s => s.name.toLowerCase().includes(focused.toLowerCase()))
                        .slice(0, 25)
                        .map(s => ({ name: s.name, value: s.name }));
                    await interaction.respond(filtered);
                }
                return;
            }

            if (!interaction.isChatInputCommand()) return;

            // ---------- /status ----------
            if (interaction.commandName === 'status') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                let channel = client.channels.cache.get(STATUS_CHANNEL_ID);
                if (!channel) {
                    try {
                        channel = await client.channels.fetch(STATUS_CHANNEL_ID);
                    } catch (err) {
                        return interaction.editReply({ content: `❌ Канал с ID ${STATUS_CHANNEL_ID} не найден.` });
                    }
                }

                if (messageIds.length === 0) {
                    return interaction.editReply({ content: '❌ Нет сохранённых сообщений.' });
                }

                for (let i = 0; i < SERVERS.length && i < messageIds.length; i++) {
                    try {
                        const embed = await createServerEmbed(SERVERS[i]);
                        const msg = await channel.messages.fetch(messageIds[i]);
                        await msg.edit({ embeds: [embed] });
                    } catch (err) {
                        if (err.code === 10008) {
                            console.log(`⚠️ Сообщение ${messageIds[i]} не найдено, удаляем ID`);
                            messageIds.splice(i, 1);
                            saveMessageIds(messageIds);
                            i--;
                        } else {
                            console.error(`Ошибка обновления ${SERVERS[i].name}:`, err.message);
                        }
                    }
                }
                await interaction.editReply({ content: '✅ Статус серверов обновлён!' });
            }

            // ---------- /add_server ----------
            else if (interaction.commandName === 'add_server') {
                if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const name = interaction.options.getString('name');
                const ip = interaction.options.getString('ip');
                const port = interaction.options.getInteger('port');
                const location = interaction.options.getString('location') || 'Unknown';
                const flagLocation = interaction.options.getString('flag_location') || 'unknown';
                const game = interaction.options.getString('game') || 'Counter-Strike 2';

                const newServer = { name, ip, port, location, flag_location: flagLocation, game };
                SERVERS.push(newServer);
                saveServers(SERVERS);

                let channel = client.channels.cache.get(STATUS_CHANNEL_ID);
                if (!channel) {
                    try {
                        channel = await client.channels.fetch(STATUS_CHANNEL_ID);
                    } catch (err) {
                        return interaction.editReply({ content: '❌ Не удалось найти канал статусов.' });
                    }
                }

                try {
                    const embed = await createServerEmbed(newServer);
                    const message = await channel.send({ embeds: [embed] });
                    messageIds.push(message.id);
                    saveMessageIds(messageIds);
                } catch (err) {
                    console.error(`Ошибка отправки сообщения: ${err.message}`);
                    return interaction.editReply({ content: '❌ Сервер добавлен, но не удалось отправить сообщение.' });
                }

                await interaction.editReply({ content: `✅ Сервер **${name}** добавлен!` });
            }

            // ---------- /remove_server ----------
            else if (interaction.commandName === 'remove_server') {
                if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const name = interaction.options.getString('name');
                const index = SERVERS.findIndex(s => s.name === name);
                if (index === -1) {
                    return interaction.editReply({ content: `❌ Сервер **${name}** не найден.` });
                }

                SERVERS.splice(index, 1);
                saveServers(SERVERS);

                if (index < messageIds.length) {
                    const removedId = messageIds.splice(index, 1)[0];
                    saveMessageIds(messageIds);

                    let channel = client.channels.cache.get(STATUS_CHANNEL_ID);
                    if (channel) {
                        try {
                            const msg = await channel.messages.fetch(removedId);
                            await msg.delete();
                        } catch (err) {
                            if (err.code !== 10008) console.error(`Ошибка удаления: ${err.message}`);
                        }
                    }
                }
                await interaction.editReply({ content: `✅ Сервер **${name}** удалён!` });
            }

        } catch (error) {
            console.error('❌ Критическая ошибка в interactionCreate:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Внутренняя ошибка бота.', flags: MessageFlags.Ephemeral }).catch(() => {});
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '❌ Внутренняя ошибка бота.' }).catch(() => {});
            }
        }
    });

    // --- Автообновление каждые UPDATE_INTERVAL секунд ---
    setInterval(async () => {
        let channel = client.channels.cache.get(STATUS_CHANNEL_ID);
        if (!channel) {
            try {
                channel = await client.channels.fetch(STATUS_CHANNEL_ID);
            } catch {
                return;
            }
        }

        const freshServers = loadServers();
        const freshIds = loadMessageIds();

        for (let i = 0; i < freshServers.length && i < freshIds.length; i++) {
            try {
                const embed = await createServerEmbed(freshServers[i]);
                const msg = await channel.messages.fetch(freshIds[i]);
                await msg.edit({ embeds: [embed] });
            } catch (err) {
                if (err.code === 10008) {
                    freshIds.splice(i, 1);
                    saveMessageIds(freshIds);
                    i--;
                } else {
                    console.error(`Ошибка автообновления ${freshServers[i]?.name}:`, err.message);
                }
            }
        }

        SERVERS = freshServers;
        messageIds = freshIds;
    }, UPDATE_INTERVAL * 1000);

    // --- Инициализация при старте бота ---
    client.once('clientReady', async () => {
        // Не используем commands.set() здесь: он перезаписывает ВСЕ slash-команды
        // приложения и удаляет команды из других cog'ов (/level, /vips, /joke и т.д.).
        await client.application.commands.create({ name: 'status', description: 'Обновить статус серверов' });
        await client.application.commands.create({
            name: 'add_server',
            description: 'Добавить сервер для мониторинга',
            options: [
                { name: 'name', type: 3, description: 'Название', required: true },
                { name: 'ip', type: 3, description: 'IP адрес', required: true },
                { name: 'port', type: 4, description: 'Порт', required: true },
                { name: 'location', type: 3, description: 'Локация', required: false },
                { name: 'flag_location', type: 3, description: 'Код флага', required: false },
                { name: 'game', type: 3, description: 'Игра', required: false }
            ]
        });
        await client.application.commands.create({
            name: 'remove_server',
            description: 'Удалить сервер из мониторинга',
            options: [{ name: 'name', type: 3, description: 'Название', required: true, autocomplete: true }]
        });

        let channel = client.channels.cache.get(STATUS_CHANNEL_ID);
        if (!channel) {
            try {
                channel = await client.channels.fetch(STATUS_CHANNEL_ID);
            } catch (err) {
                console.error(`❌ Канал ${STATUS_CHANNEL_ID} не найден`);
                return;
            }
        }

        // Создаём недостающие сообщения
        while (messageIds.length < SERVERS.length) {
            const server = SERVERS[messageIds.length];
            const embed = await createServerEmbed(server);
            const msg = await channel.send({ embeds: [embed] });
            messageIds.push(msg.id);
            console.log(`✅ Создано сообщение для ${server.name}`);
        }
        // Удаляем лишние сообщения, если серверов стало меньше
        while (messageIds.length > SERVERS.length) {
            const id = messageIds.pop();
            try {
                const msg = await channel.messages.fetch(id);
                await msg.delete();
            } catch {}
        }
        saveMessageIds(messageIds);
        console.log(`✅ Инициализация завершена. Сообщений: ${messageIds.length}`);
    });
}