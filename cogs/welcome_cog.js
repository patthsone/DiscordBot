import { EmbedBuilder } from 'discord.js';
import { WELCOME_CONFIG } from '../welcome_config.js';

const ROLE_IDS = [
    '1354589782491009094',
    '1303531755617390613'
];

export default function(client) {
    client.on('guildMemberAdd', async (member) => {
        try {
            const guild = member.guild;

            // Выдаём обе роли
            for (const roleId of ROLE_IDS) {
                const role = guild.roles.cache.get(roleId);
                if (role) {
                    try {
                        await member.roles.add(role);
                        console.log(`✅ Роль "${role.name}" добавлена пользователю ${member.user.tag} (${member.id})`);
                    } catch (error) {
                        console.error(`❌ Ошибка добавления роли "${roleId}" для ${member.user.tag}:`, error);
                    }
                } else {
                    console.warn(`⚠️ Роль с ID ${roleId} не найдена`);
                }
            }

            // Отправляем приветственное сообщение
            const welcomeChannel = guild.channels.cache.get(WELCOME_CONFIG.channels.welcome);

            if (!welcomeChannel) {
                console.warn(`⚠️ Канал приветствий (${WELCOME_CONFIG.channels.welcome}) не найден`);
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎮 Добро пожаловать на сервер!')
                .setDescription(
                    `<@${member.id}>\n\n` +
                    WELCOME_CONFIG.welcomeMessage.replace(/\{user\}/g, `<@${member.id}>`)
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: 'Luxecs2.ru' });

            await welcomeChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
            console.log(`✅ Приветственное сообщение отправлено для ${member.user.tag} (${member.id})`);

        } catch (error) {
            console.error(`❌ Ошибка при обработке нового участника ${member.user.tag}:`, error);
        }
    });

    console.log('✅ Welcome cog загружен');
}
