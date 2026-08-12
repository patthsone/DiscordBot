import dotenv from 'dotenv';

dotenv.config();

// ⚠️ Все секреты хранятся в .env (см. .env.example). Пустые fallback — намеренно:
// если переменная не задана, бот не стартует/функция отключается, но секретов в коде нет.
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

export const DEFAULT_SERVERS = [
    {
        name: '➥ ███ LUXECS2.RU | ★ BLACK | MIRAGE MODELS',
        ip: '81.163.17.83',
        port: 27715,
        location: 'Russia',
        flag_location: 'ru',
        game: 'Counter-Strike 2'
    },
    {
        name: '➥ ███ LUXECS2.RU | ★ RED | MIRAGE FPS+',
        ip: '95.213.255.148',
        port: 27115,
        location: 'Russia',
        flag_location: 'ru',
        game: 'Counter-Strike 2'
    }
];

export const STATUS_CHANNEL_ID = '1378404671013654638';
export const ADMIN_ROLE_ID = '1303531726324105267';
export const UPDATE_INTERVAL = 600;

export const DB_HOST = process.env.DB_HOST || '85.119.149.36';
export const DB_USER = process.env.DB_USER || '';
export const DB_PASSWORD = process.env.DB_PASSWORD || '';
export const DB_NAME = process.env.DB_NAME || '';

export const GUILD_ID = process.env.GUILD_ID || '1303410788291055667';
export const VERIFICATION_CHANNEL_ID = '1448258346946924594';
export const VERIFICATION_MESSAGE_ID = '1450170193606086696';
export const VERIFIED_ROLE_ID = '1448263440970809406';
export const ROLE_TO_REMOVE_ON_VERIFICATION_ID = '1303531755617390613';
export const VERIFICATION_LOG_CHANNEL_ID = process.env.VERIFICATION_LOG_CHANNEL_ID || '1537043530353086474';

export const JOKES_CHANNEL_ID = '1303531828111474700';

// Steam Web API. Получить ключ: https://steamcommunity.com/dev/apikey
// Если не задан — utils/steam.js откатывается на скрейпинг ?xml=1 (с кешем/очередью).
export const STEAM_API_KEY = process.env.STEAM_API_KEY || '';

// ─── FACEIT API ──────────────────────────────────────────────────────────────
// Используется cog'ом faceit_cog: авто-роли уровней FACEIT (1-10).
// Получить ключ: https://developers.faceit.com/ (apps → API Key).
// game: 'cs2' — CS2 (можно 'csgo').
export const FACEIT_API_KEY = process.env.FACEIT_API_KEY || '';
export const FACEIT_GAME = process.env.FACEIT_GAME || 'cs2';


