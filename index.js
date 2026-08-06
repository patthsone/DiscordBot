import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { DISCORD_TOKEN } from './config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

client.commands = new Collection();
client.setMaxListeners(50);

// Shared set so only ONE cog handles each interaction.
// Every cog's interactionCreate handler must start with:
//   if (client.handledInteractions.has(interaction.id)) return;
//   client.handledInteractions.add(interaction.id);
const handledInteractions = new Set();
client.handledInteractions = handledInteractions;
setInterval(() => handledInteractions.clear(), 60_000); // prevent memory leak

const cogsPath = join(__dirname, 'cogs');
const cogFiles = readdirSync(cogsPath).filter(file => file.endsWith('.js'));

for (const file of cogFiles) {
    const filePath = join(cogsPath, file);
    const cog = await import(`file://${filePath}`);
    if (cog.default) {
        try {
            await cog.default(client);
            console.log(`✅ Загружен модуль: ${file}`);
        } catch (error) {
            console.error(`❌ Ошибка при загрузке модуля ${file}:`, error);
        }
    }
}

client.once('clientReady', () => {
    console.log('='.repeat(50));
    console.log(`Бот ${client.user.tag} готов!`);
    console.log('='.repeat(50));
});

process.on('SIGINT', () => {
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    client.destroy();
    process.exit(0);
});

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN не задан. Укажите его в .env или config.js');
    process.exit(1);
}

async function testConnection() {
    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN}`,
            },
        });
        if (response.ok) {
            console.log('✅ Тестовое подключение к Discord API успешно.');
        } else {
            console.log(`⚠️ Тестовое подключение вернуло статус: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Ошибка тестового подключения к Discord API:', error);
    }
}

async function loginWithRetry(retries = 3, delay = 5000) {
    console.log('🔍 Проверка подключения к Discord API...');
    await testConnection();

    for (let i = 0; i < retries; i++) {
        try {
            await client.login(DISCORD_TOKEN);
            return;
        } catch (error) {
            console.error(`❌ Ошибка входа в Discord (попытка ${i + 1}/${retries}):`, error);
            if (i < retries - 1) {
                console.log(`Повторная попытка через ${delay / 1000} секунд...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    console.error('❌ Не удалось войти в Discord после всех попыток.');
    process.exit(1);
}

loginWithRetry();
