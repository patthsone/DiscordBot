/**
 * nabor_cog.js — Команда объявления о наборе модераторов
 *
 * Команда: /nabor channel:<#канал>
 * Доступ: только ADMIN_ROLE_ID
 *
 * Отправляет в указанный канал от имени бота оформленное объявление
 * о наборе в команду модераторов (с @everyone), содержащее:
 *   • заголовок и описание
 *   • список пунктов заявки
 *   • ссылку на сайт luxecs2.su и кнопку
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { ADMIN_ROLE_ID } from '../config.js';

const SITE_URL = 'https://luxecs2.su/';

// Текст объявления (вынесен отдельно — легко править)
const RECRUITMENT = {
    title: 'НАБОР В КЛАН МОДЕРАТОРОВ',
    intro: 'Для поддержания комфортной и безопасной атмосферы нам нужна команда ответственных и активных модераторов.',
    formTitle: 'Заполни заявку на сайте:',
    points: [
        'Возраст (от 16-ти лет)',
        'Ваш Discord',
        'Время, в которое вам удобно играть',
        'Комментарий / О себе'
    ],
    instruction: 'Чтобы заполнить заявку — авторизуйтесь на сайте, нажмите на стрелочку возле вашей аватарки и перейдите в пункт **«Модерирование»**.',
    servers: 'Играть на серверах:'
};

function buildRecruitmentEmbed() {
    const points = RECRUITMENT.points.map((p, i) => `> **${i + 1}.** ${p}`).join('\n');

    const description =
        `${RECRUITMENT.intro}\n\n` +
        `### 📝 ${RECRUITMENT.formTitle}\n` +
        `${points}\n\n` +
        `> 🔗 Заполнить анкету: ${SITE_URL}\n\n` +
        `### ℹ️ Инструкция\n` +
        `> ${RECRUITMENT.instruction}\n\n` +
        `> 🎮 ${RECRUITMENT.servers} ${SITE_URL}`;

    return new EmbedBuilder()
        .setTitle(`🛡️ ${RECRUITMENT.title}`)
        .setDescription(description)
        .setColor(0x5865F2)
        .setImage('https://i.yapx.ru/dVYOy.png')
        .setFooter({ text: 'LuxeCS2 · Набор модераторов' })
        .setTimestamp();
}

export default function(client) {
    client.once('clientReady', async () => {
        try {
            await client.application.commands.create({
                name: 'nabor',
                description: '📢 Отправить объявление о наборе модераторов в канал',
                options: [
                    {
                        name: 'channel',
                        type: 7, // CHANNEL
                        description: 'Канал, куда отправить объявление',
                        required: true
                    }
                ]
            });
            console.log('✅ Команда /nabor зарегистрирована');
        } catch (error) {
            console.error('❌ Ошибка регистрации команды /nabor:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'nabor') return;
        if (client.handledInteractions.has(interaction.id)) return;
        client.handledInteractions.add(interaction.id);

        // Только админы
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return interaction.reply({ content: '❌ Недостаточно прав.', flags: MessageFlags.Ephemeral });
        }

        const channel = interaction.options.getChannel('channel');
        if (!channel) {
            return interaction.reply({ content: '❌ Канал не найден.', flags: MessageFlags.Ephemeral });
        }

        // Проверка прав бота в целевом канале
        const me = channel.guild.members.me;
        if (!channel.permissionsFor(me)?.has(['SendMessages', 'EmbedLinks'])) {
            return interaction.reply({
                content: `❌ У меня нет прав «Отправлять сообщения» или «Встраивать ссылки» в канале ${channel}.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const embed = buildRecruitmentEmbed();
            const siteButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🌐 Сайт проекта')
                    .setURL(SITE_URL)
                    .setStyle(ButtonStyle.Link)
            );

            // Отправляем от имени бота с @everyone
            await channel.send({
                content: '@everyone',
                embeds: [embed],
                components: [siteButton],
                allowedMentions: { parse: ['everyone'] }
            });

            await interaction.editReply({ content: `✅ Объявление о наборе отправлено в ${channel}.` });
        } catch (error) {
            console.error('nabor: ошибка отправки:', error.message);
            await interaction.editReply({ content: `❌ Не удалось отправить: ${error.message}` });
        }
    });
}
