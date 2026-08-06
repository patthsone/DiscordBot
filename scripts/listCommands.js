import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cogsDir = join(__dirname, '..', 'cogs');
const commandNames = new Set();

for (const file of readdirSync(cogsDir)) {
    if (!file.endsWith('.js')) continue;

    const content = readFileSync(join(cogsDir, file), 'utf8');
    const regex = /name:\s*['"]([a-z0-9_-]+)['"]/gi;
    let match;

    while ((match = regex.exec(content))) {
        const name = match[1];
        // Отсекаем поля embed'ов/ролей и оставляем реальные slash-команды по известным именам.
        if ([
            'admin_stats', 'admin_stats_now', 'admin_info',
            'joke', 'level', 'leaderboard', 'setmodlog', 'ping',
            'status', 'add_server', 'remove_server',
            'connect_vip_db', 'vips'
        ].includes(name)) {
            commandNames.add(name);
        }
    }
}

console.log('Slash-команды, которые должны остаться у бота:');
for (const name of [...commandNames].sort()) {
    console.log(`/${name}`);
}
console.log(`Всего: ${commandNames.size}`);
