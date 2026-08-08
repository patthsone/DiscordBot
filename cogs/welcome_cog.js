import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { WELCOME_CONFIG } from '../welcome_config.js';
import { ADMIN_ROLE_ID } from '../config.js';

const ROLE_IDS = [
    '1354589782491009094',
    '1303531755617390613'
];

// Баннер-изображение для приветствия
const WELCOME_BANNER_URL = 'https://steamuserimages-a.akamaihd.net/ugc/1756947570220538678/1D8C434C22994531391D4C088CB7432100839AC9/?imw=512&imh=376&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true';

// Палитра (премиум-зелёная тема под «добро пожаловать»)
const COLORS = {
    PRIMARY: 0x57F287,   // зелёный
    ACCENT:  0x5865F2     // индиго для кнопок
};

// Хелпер: упоминание канала в виде <#ID>
function channelMention(channelId) {
    return `<#${channelId}>`;
}

// ─── Создание приветственного embed (общее для события и теста) ─────────────
function buildWelcomeEmbed(member, guild, { isTest = false } = {}) {
    const position = guild.memberCount || null;
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const createdAt = Math.floor(member.user.createdTimestamp / 1000);

    // Описание: персональное приветствие + основная информация
    const headerPrefix = isTest ? '🧪 [ТЕСТ] ' : '';
    const description =
        `### ${headerPrefix}👋 Добро пожаловать, ${member}!\n` +
        (position ? `> Ты — **${position}-й** участник нашего сообщества 🎉\n\n` : '\n') +
        `### 📌 Основная информация\n` +
        `> 🌐 **Сайт:** [${WELCOME_CONFIG.website}](${WELCOME_CONFIG.websiteUrl})\n` +
        `> 📜 **Правила:** [перейти](${WELCOME_CONFIG.rulesUrl})\n\n` +
        `### 🔑 Что дальше?\n` +
        `> 🎯 **Верификация:** пройди в канале ${channelMention(WELCOME_CONFIG.channels.verification)}\n` +
        `> 📖 **Информация:** ознакомься в ${channelMention(WELCOME_CONFIG.channels.info)}\n` +
        `> 🎮 **Серверы:** смотри в ${channelMention(WELCOME_CONFIG.channels.servers)}\n` +
        `> ℹ️ **О нас:** читай в ${channelMention(WELCOME_CONFIG.channels.about)}\n` +
        `> 💬 **Общение:** пиши в ${channelMention(WELCOME_CONFIG.channels.chat)}\n\n` +
        `> Желаем приятной игры и хорошего настроения! 🚀`;

    const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setDescription(description)
        .setThumbnail(avatarURL)
        .setImage(WELCOME_BANNER_URL)
        .addFields(
            { name: '👤 Участник', value: `\`${member.user.tag}\``, inline: true },
            { name: '🆔 ID', value: `\`${member.id}\``, inline: true },
            { name: '📅 Аккаунт создан', value: `<t:${createdAt}:R>`, inline: true }
        )
        .setFooter({
            text: `LuxeCS2 · Добро пожаловать`,
            iconURL: guild.iconURL({ extension: 'png' }) || undefined
        })
        .setTimestamp();

    return embed;
}

// Кнопки: сайт + правила + верификация
function buildWelcomeButtons(guild) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('🌐 Сайт')
            .setURL(WELCOME_CONFIG.websiteUrl)
            .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
            .setLabel('📜 Правила')
            .setURL(WELCOME_CONFIG.rulesUrl)
            .setStyle(ButtonStyle.Link),
        new ButtonBuilder()
            .setLabel('🎯 Верификация')
            .setURL(`https://discord.com/channels/${guild.id}/${WELCOME_CONFIG.channels.verification}`)
            .setStyle(ButtonStyle.Link)
    );
}

export default function(client) {
    // ── Регистрация команды /welcome ────────────────────────────────────────
    client.once('clientReady', async () => {
        try {
            await client.application.commands.create({
                name: 'welcome',
                description: '🧪 Тест приветственного сообщения'
            });
            console.log('✅ Команда /welcome зарегистрирована');
        } catch (error) {
            console.error('❌ Ошибка регистрации /welcome:', error.message);
        }
        console.log('✅ Welcome cog загружен');
    });

    // ── Событие: новый участник ─────────────────────────────────────────────
    client.on('guildMemberAdd', async (member) => {
        try {
            const guild = member.guild;

            // Выдаём роли
            for (const roleId of ROLE_IDS) {
                const role = guild.roles.cache.get(roleId);
                if (role) {
                    try {
                        await member.roles.add(role);
                        console.log(`✅ Роль "${role.name}" → ${member.user.tag} (${member.id})`);
                    } catch (error) {
                        console.error(`❌ Ошибка выдачи роли "${roleId}" для ${member.user.tag}:`, error.message);
                    }
                } else {
                    console.warn(`⚠️ Роль ${roleId} не найдена`);
                }
            }

            // Приветственное сообщение
            const welcomeChannel = guild.channels.cache.get(WELCOME_CONFIG.channels.welcome);
            if (!welcomeChannel) {
                console.warn(`⚠️ Канал приветствий (${WELCOME_CONFIG.channels.welcome}) не найден`);
                return;
            }

            const me = guild.members.me;
            if (!welcomeChannel.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])) {
                console.warn(`⚠️ Нет прав в канале приветствий`);
                return;
            }

            const embed = buildWelcomeEmbed(member, guild);
            const buttons = buildWelcomeButtons(guild);

            await welcomeChannel.send({
                content: `🎉 <@${member.id}>`,
                embeds: [embed],
                components: [buttons],
                allowedMentions: { users: [member.id] }
            });
            console.log(`✅ Приветствие отправлено: ${member.user.tag} (${member.id})`);

        } catch (error) {
            console.error(`❌ Ошибка welcome для ${member.user?.tag}:`, error.message);
        }
    });

    // ── Команда /welcome (тест) ─────────────────────────────────────────────
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'welcome') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        // Доступ: только админ (чтобы не спамить тестами)
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const guild = interaction.guild;
            const member = interaction.member;
            const welcomeChannel = guild.channels.cache.get(WELCOME_CONFIG.channels.welcome);

            const embed = buildWelcomeEmbed(member, guild, { isTest: true });
            const buttons = buildWelcomeButtons(guild);

            // Отправляем тест в канал приветствий (как настоящее сообщение)
            if (welcomeChannel) {
                await welcomeChannel.send({
                    content: `🧪 [ТЕСТ] <@${member.id}>`,
                    embeds: [embed],
                    components: [buttons],
                    allowedMentions: { users: [member.id] }
                });
                await interaction.editReply({ content: `✅ Тест приветствия отправлен в ${welcomeChannel}.` });
                console.log(`🧪 Тест welcome отправлен: ${member.user.tag}`);
            } else {
                // Если канала нет — показываем превью прямо в ответе
                await interaction.editReply({
                    content: '🧪 Превью приветствия (канал не найден — показываю тут):',
                    embeds: [embed],
                    components: [buttons]
                });
            }
        } catch (error) {
            console.error('welcome test:', error.message);
            await interaction.editReply({ content: `❌ Ошибка: ${error.message}` });
        }
    });
}
