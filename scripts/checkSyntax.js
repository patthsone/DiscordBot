import { readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const files = [
    'index.js',
    'config.js',
    'web.js',
    'welcome_config.js',
    ...readdirSync('cogs').filter(file => file.endsWith('.js')).map(file => join('cogs', file)),
    ...readdirSync('utils').filter(file => file.endsWith('.js')).map(file => join('utils', file)),
    ...readdirSync('scripts').filter(file => file.endsWith('.js')).map(file => join('scripts', file)),
];

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log(`✅ Syntax OK: ${files.length} JS files checked`);
