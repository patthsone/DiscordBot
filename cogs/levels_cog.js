import { EmbedBuilder, MessageFlags, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { renderRankCard } from '../utils/cardBuilder.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROJECT_URL = 'https://luxecs2.su/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEVELS_FILE = join(__dirname, '..', 'levels.json');
const COOLDOWN = 60;

function getLevelColor(level) {
    if (level >= 50) return 0xFF2D55;
    if (level >= 40) return 0xAF52DE;
    if (level >= 30) return 0xFF9500;
    if (level >= 20) return 0xFFCC00;
    if (level >= 10) return 0x34C759;
    if (level >= 5)  return 0x00C7BE;
    return 0x5AC8FA;
}

function getRankInfo(level) {
    if (level >= 50) return { title: 'Легенда',     icon: '👑', bar: '🔴' };
    if (level >= 40) return { title: 'Мастер',      icon: '💎', bar: '🟣' };
    if (level >= 30) return { title: 'Эксперт',     icon: '🔥', bar: '🟠' };
    if (level >= 20) return { title: 'Профи',       icon: '⭐', bar: '🟡' };
    if (level >= 10) return { title: 'Опытный',     icon: '✨', bar: '🟢' };
    if (level >= 5)  return { title: 'Новичок',     icon: '🎯', bar: '🔵' };
    return             { title: 'Начинающий',  icon: '🌱', bar: '⚪' };
}

function getMedal(rank) {
    return ['🥇', '🥈', '🥉'][rank - 1] || `\`#${rank}\``;
}

function loadLevels() { return loadJSON(LEVELS_FILE, {}); }
function saveLevels(levels) { saveJSON(LEVELS_FILE, levels); }

export default function(client) {
    let levels = loadLevels();
    const lastMessage = {};

    client.on('messageCreate', async message => {
        if (message.author.bot) return;

        const userId = message.author.id;
        const now = Math.floor(Date.now() / 1000);

        if (!lastMessage[userId] || now - lastMessage[userId] > COOLDOWN) {
            if (!levels[userId]) levels[userId] = { xp: 0, level: 0 };

            levels[userId].xp += 10;
            const xp = levels[userId].xp;
            const newLevel = Math.floor(xp / 100);

            if (newLevel > levels[userId].level) {
                levels[userId].level = newLevel;

                const rank = getRankInfo(newLevel);
                const color = getLevelColor(newLevel);
                const curLevelXp = newLevel * 100;
                const xpInLevel = xp - curLevelXp;
                const xpPerLevel = 100;
                const displayName = message.member?.displayName || message.author.username;

                // Рендерим ранг-карточку как картинку
                let attachment = null;
                try {
                    const card = await renderRankCard({
                        avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
                        username: displayName,
                        level: newLevel,
                        currentXp: xpInLevel,
                        neededXp: xpPerLevel,
                        totalXp: xp,
                        rankTitle: `${rank.icon} ${rank.title}`
                    });
                    attachment = new AttachmentBuilder(card, { name: 'level-card.png' });
                } catch (err) {
                    console.error('levels: ошибка рендера карточки уровня:', err.message);
                }

                const embed = new EmbedBuilder()
                    .setAuthor({
                        name: `${displayName} повысил уровень!`,
                        iconURL: message.author.displayAvatarURL({ dynamic: true, size: 256 })
                    })
                    .setTitle(`${rank.icon}  Уровень ${newLevel} достигнут!`)
                    .setDescription(
                        `> ${rank.bar} **${rank.title}**\n\n` +
                        `**${xp} XP**  ·  ранг **${rank.title}**`
                    )
                    .setColor(color)
                    .setFooter({ text: '💬 Продолжай общаться — расти дальше!' })
                    .setTimestamp();

                if (attachment) {
                    embed.setImage('attachment://level-card.png');
                    await message.channel.send({
                        content: `🎊 <@${message.author.id}> достиг уровня **${newLevel}**!`,
                        embeds: [embed],
                        files: [attachment]
                    });
                } else {
                    // Fallback — без картинки, если рендер не удался
                    await message.channel.send({
                        content: `🎊 <@${message.author.id}> достиг уровня **${newLevel}**!`,
                        embeds: [embed]
                    });
                }
            }

            saveLevels(levels);
            lastMessage[userId] = now;
        }
    });

    client.once('clientReady', async () => {
        await client.application.commands.create({
            name: 'level',
            description: 'Показать ваш уровень и прогресс'
        });
        await client.application.commands.create({
            name: 'leaderboard',
            description: 'Показать топ игроков по уровню'
        });
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        // ── /level ────────────────────────────────────────────────────────────
        if (interaction.commandName === 'level') {
            // Claim this interaction — skip if another cog already handled it
            if (client.handledInteractions.has(interaction.id)) return;
            client.handledInteractions.add(interaction.id);

            const userId = interaction.user.id;
            const data = levels[userId];

            if (!data) {
                const embed = new EmbedBuilder()
                    .setTitle('📭  Нет данных')
                    .setDescription(
                        '> Ты ещё не зарабатывал опыт!\n\n' +
                        '`💬` Пиши в чат — каждое сообщение приносит **+10 XP**\n' +
                        '`⏱️` Перезарядка между начислениями: **60 сек**\n' +
                        '`📐` Формула: **100 XP = 1 уровень**'
                    )
                    .setColor(0x5AC8FA)
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setFooter({ text: 'Начни свой путь сегодня 🚀' })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            const { xp, level } = data;
            const nextXp = (level + 1) * 100;
            const curLevelXp = level * 100;
            const xpInLevel = xp - curLevelXp;
            const xpPerLevel = nextXp - curLevelXp;
            const pct = Math.min((xpInLevel / xpPerLevel) * 100, 100).toFixed(1);
            const rank = getRankInfo(level);
            const color = getLevelColor(level);

            const allSorted = Object.entries(levels).sort((a, b) => b[1].xp - a[1].xp);
            const position = allSorted.findIndex(([id]) => id === userId) + 1;
            const total = allSorted.length;

            const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

            // Рендерим ранг-карточку
            let attachment = null;
            try {
                const card = await renderRankCard({
                    avatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                    username: displayName,
                    level,
                    currentXp: xpInLevel,
                    neededXp: xpPerLevel,
                    totalXp: xp,
                    rank,
                    total,
                    rankTitle: `${rank.icon} ${rank.title}`
                });
                attachment = new AttachmentBuilder(card, { name: 'rank-card.png' });
            } catch (err) {
                console.error('levels: ошибка рендера карточки /level:', err.message);
            }

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: displayName,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 256 })
                })
                .setTitle(`${rank.icon}  ${rank.title}`)
                .setDescription(
                    `**${xpInLevel} / ${xpPerLevel} XP** до уровня **${level + 1}**  ·  **${pct}%**`
                )
                .setColor(color)
                .addFields(
                    { name: '🎖️  Уровень',      value: `\`${level}\``,       inline: true },
                    { name: '💠  Всего XP',      value: `\`${xp}\``,     inline: true },
                    { name: '🏆  Рейтинг',       value: `\`#${position} / ${total}\``, inline: true }
                )
                .setFooter({ text: '💬 Пиши больше — расти быстрее!' })
                .setTimestamp();

            if (attachment) embed.setImage('attachment://rank-card.png');

            // Кнопка сайта
            const siteButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🌐 Сайт проекта')
                    .setURL(PROJECT_URL)
                    .setStyle(ButtonStyle.Link)
            );

            const payload = { embeds: [embed], components: [siteButton], flags: MessageFlags.Ephemeral };
            if (attachment) payload.files = [attachment];

            return interaction.reply(payload);
        }

        // ── /leaderboard ──────────────────────────────────────────────────────
        else if (interaction.commandName === 'leaderboard') {
            // Claim this interaction — skip if another cog already handled it
            if (client.handledInteractions.has(interaction.id)) return;
            client.handledInteractions.add(interaction.id);

            await interaction.deferReply();

            const allSorted = Object.entries(levels)
                .sort((a, b) => b[1].xp - a[1].xp);

            if (allSorted.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🏆  Таблица лидеров')
                    .setDescription('> Рейтинг пуст — начните общаться, чтобы попасть в топ! 💬')
                    .setColor(0xFFCC00)
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            const top10 = allSorted.slice(0, 10);
            const lines = [];

            for (let i = 0; i < top10.length; i++) {
                const [uid, data] = top10[i];
                const user = await client.users.fetch(uid).catch(() => null);
                const name = user ? (user.globalName || user.username) : `Игрок ${uid}`;
                const { title, icon } = getRankInfo(data.level);
                const medal = getMedal(i + 1);

                lines.push(
                    `${medal} **${name}**\n` +
                    `　${icon} ${title}  ·  Ур. **${data.level}**  ·  **${data.xp} XP**\n`
                );
            }

            const callerId = interaction.user.id;
            const callerRank = allSorted.findIndex(([id]) => id === callerId) + 1;
            let footer = '';
            if (callerRank > 0) {
                const cd = levels[callerId];
                const { title, icon } = getRankInfo(cd.level);
                footer = `\n──────────────────────\n` +
                         `${icon} **Твоя позиция:** #${callerRank}  ·  ${title}  ·  Ур. **${cd.level}**  ·  **${cd.xp} XP**`;
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆  Таблица лидеров')
                .setDescription(lines.join('') + footer)
                .setColor(0xFFCC00)
                .setThumbnail(interaction.guild?.iconURL({ dynamic: true }) || null)
                .setFooter({
                    text: `Участников в рейтинге: ${allSorted.length}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            const siteButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🌐 Сайт проекта')
                    .setURL(PROJECT_URL)
                    .setStyle(ButtonStyle.Link)
            );

            return interaction.editReply({ embeds: [embed], components: [siteButton] });
        }
    });

    console.log('✅ Levels cog загружен');
}
