import axios from 'axios';
import { STEAM_API_KEY } from '../config.js';

// ───────────────────────────────────────────────────────────────────────────
// Безопасный доступ к профилям Steam.
//
// ПРИОРИТЕТ: официальный Steam Web API (GetPlayerSummaries) по STEAM_API_KEY.
// Если ключ не задан — откат на скрейпинг ?xml=1.
//
// Защита от rate-limit (429) и общая устойчивость:
//   • общий in-memory кеш (TTL = STEAM_CACHE_TTL_MS);
//   • одна глобальная последовательная очередь (1 запрос к Steam за раз)
//     с минимальной паузой между запросами;
//   • ретраи с экспоненциальной задержкой при 429 / таймауте / ошибках сети;
//   • реалистичный User-Agent для xml-фолбэка.
//
// Важно: batch-запрос к API делается по steam64, поэтому resolveSteamCustomUrl
// (custom URL) всё равно использует xml-эндпоинт (у Web API нет разрешения vanity).
// ───────────────────────────────────────────────────────────────────────────

const STEAM_CACHE_TTL_MS = 15 * 60 * 1000;   // 15 минут на ключ
const STEAM_REQUEST_TIMEOUT_MS = 6000;
const STEAM_MIN_INTERVAL_MS = 1200;          // пауза между запросами к Steam
const STEAM_MAX_RETRIES = 3;
const STEAM_RETRY_BASE_MS = 2000;

const profileCache = new Map();              // key -> { value, expiresAt }

let queueTail = Promise.resolve();
let lastRequestAt = 0;

const XML_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/xml,application/xml,text/html,*/*;q=0.8'
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCached(key) {
    const hit = profileCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    if (hit) profileCache.delete(key);
    return undefined;
}

function setCached(key, value) {
    profileCache.set(key, { value, expiresAt: Date.now() + STEAM_CACHE_TTL_MS });
}

// Глобальная последовательная очередь: не более одного запроса к Steam за раз.
function enqueue(task) {
    const run = queueTail.then(task, task);
    queueTail = run.catch(() => {}); // изолируем ошибки, чтобы цепочка не рвалась
    return run;
}

// Сырой HTTP-запрос с ретраями при 429/таймауте/сетевой ошибке.
async function fetchWithRetry(url, { headers = {}, useJson = false } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < STEAM_MAX_RETRIES; attempt++) {
        const sinceLast = Date.now() - lastRequestAt;
        if (sinceLast < STEAM_MIN_INTERVAL_MS) {
            await sleep(STEAM_MIN_INTERVAL_MS - sinceLast);
        }
        lastRequestAt = Date.now();

        try {
            const response = await axios.get(url, {
                timeout: STEAM_REQUEST_TIMEOUT_MS,
                headers,
                // 429/5xx -> throw -> retry; только 200 считается успехом
                validateStatus: status => status === 200
            });
            return useJson ? response.data : response.data;
        } catch (error) {
            lastError = error;
            const status = error?.response?.status;
            const retryable = status === 429 ||
                status >= 500 ||
                error?.code === 'ECONNABORTED' ||
                error?.code === 'ETIMEDOUT' ||
                error?.code === 'ECONNRESET';

            if (retryable) {
                const delay = STEAM_RETRY_BASE_MS * Math.pow(2, attempt);
                console.warn(`[steam] ${status || error.code} для ${url} — повтор через ${delay} мс (попытка ${attempt + 1}/${STEAM_MAX_RETRIES})`);
                await sleep(delay);
                continue;
            }
            break; // 404/403 и пр. — смысла ретраить нет
        }
    }
    throw lastError || new Error('Steam request failed');
}

// ─── Официальный Steam Web API ──────────────────────────────────────────────

// Запрос профилей по списку steam64 через GetPlayerSummaries.
// API лимит — до 100 steam64 за один вызов. Возвращает Map<steam64, player>.
async function fetchViaApi(steam64List) {
    if (!STEAM_API_KEY || steam64List.length === 0) return new Map();

    const url = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' +
        `?key=${encodeURIComponent(STEAM_API_KEY)}` +
        `&steamids=${encodeURIComponent(steam64List.join(','))}`;

    const data = await fetchWithRetry(url, { useJson: true });

    const map = new Map();
    const players = data?.response?.players ?? [];
    for (const p of players) {
        map.set(String(p.steamid), p);
    }
    return map;
}

// Скрейпинг ?xml=1 (фолбэк, когда нет API-ключа).
async function fetchViaXml(steam64) {
    const url = `https://steamcommunity.com/profiles/${steam64}?xml=1`;
    const data = await fetchWithRetry(url, { headers: XML_HEADERS });

    const avatarMatch = data.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
    const nameMatch = data.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);

    return {
        name: nameMatch ? nameMatch[1] : null,
        avatar: avatarMatch ? avatarMatch[1] : null,
        profile_url: `https://steamcommunity.com/profiles/${steam64}`
    };
}

// ─── Публичный API ──────────────────────────────────────────────────────────

/**
 * Получить информацию о профиле Steam по steam64.
 * Возвращает { name, avatar, profile_url }.
 * При недоступности — name=null, avatar=null.
 * Результат кешируется на STEAM_CACHE_TTL_MS.
 */
export async function getSteamProfileInfo(steam64) {
    const key = `profile:${steam64}`;
    const cached = getCached(key);
    if (cached) return cached;

    const fallback = {
        name: null,
        avatar: null,
        profile_url: `https://steamcommunity.com/profiles/${steam64}`
    };

    try {
        let info;
        if (STEAM_API_KEY) {
            const players = await enqueue(() => fetchViaApi([steam64]));
            const p = players.get(String(steam64));
            info = p
                ? {
                    name: p.personaname || null,
                    avatar: p.avatarfull || p.avatarmedium || null,
                    profile_url: p.profileurl || `https://steamcommunity.com/profiles/${steam64}`
                }
                : fallback;
        } else {
            info = await enqueue(() => fetchViaXml(steam64));
        }

        setCached(key, info);
        return info;
    } catch (error) {
        console.error('Ошибка получения профиля Steam:', error?.message || error);
        return fallback;
    }
}

/**
 * Массовое получение профилей (один API-вызов на список steam64).
 * Эффективнее последовательных getSteamProfileInfo при отображении списков.
 * Возвращает Map<steam64, { name, avatar, profile_url }>.
 * Использует кеш; некешированные steam64 идут одним батчем в API (если есть ключ)
 * или по одному через xml-фолбэк.
 */
export async function getSteamProfilesBulk(steam64List) {
    const result = new Map();
    if (!steam64List || steam64List.length === 0) return result;

    const missing = [];
    for (const id of steam64List) {
        const cached = getCached(`profile:${id}`);
        if (cached) result.set(String(id), cached);
        else missing.push(String(id));
    }

    if (missing.length === 0) return result;

    try {
        if (STEAM_API_KEY) {
            const players = await enqueue(() => fetchViaApi(missing));
            for (const id of missing) {
                const p = players.get(id);
                const info = p
                    ? {
                        name: p.personaname || null,
                        avatar: p.avatarfull || p.avatarmedium || null,
                        profile_url: p.profileurl || `https://steamcommunity.com/profiles/${id}`
                    }
                    : { name: null, avatar: null, profile_url: `https://steamcommunity.com/profiles/${id}` };
                setCached(`profile:${id}`, info);
                result.set(id, info);
            }
        } else {
            // Фолбэк: по одному через xml в рамках общей очереди
            for (const id of missing) {
                const info = await enqueue(() => fetchViaXml(id).catch(() => ({
                    name: null, avatar: null, profile_url: `https://steamcommunity.com/profiles/${id}`
                })));
                setCached(`profile:${id}`, info);
                result.set(id, info);
            }
        }
    } catch (error) {
        console.error('Ошибка bulk получения профилей Steam:', error?.message || error);
        for (const id of missing) {
            if (!result.has(id)) {
                const fb = { name: null, avatar: null, profile_url: `https://steamcommunity.com/profiles/${id}` };
                result.set(id, fb);
            }
        }
    }

    return result;
}

/**
 * Разрешить кастомный URL (steamcommunity.com/id/<custom>) в steam64.
 * Web API для vanity-URL (ResolveVanityUrl) тоже доступен по ключу.
 * Возвращает { accountId, steam64 } или { accountId: null, steam64: null }.
 */
export async function resolveSteamCustomUrl(customUrl) {
    const key = `custom:${customUrl}`;
    const cached = getCached(key);
    if (cached) return cached;

    const fallback = { accountId: null, steam64: null };

    try {
        let steam64 = null;

        if (STEAM_API_KEY) {
            const url = 'https://api.steampowered.com/ISteamUser/ResolveVanityUrl/v1/' +
                `?key=${encodeURIComponent(STEAM_API_KEY)}&vanityurl=${encodeURIComponent(customUrl)}`;
            const data = await enqueue(() => fetchWithRetry(url, { useJson: true }));
            if (data?.response?.success === 1 && data.response.steamid) {
                steam64 = String(data.response.steamid);
            }
        } else {
            const url = `https://steamcommunity.com/id/${customUrl}?xml=1`;
            const data = await enqueue(() => fetchWithRetry(url, { headers: XML_HEADERS }));
            const m = data.match(/<steamID64>(\d+)<\/steamID64>/);
            if (m) steam64 = m[1];
        }

        if (steam64) {
            const accountId = BigInt(steam64) - BigInt(76561197960265728);
            const result = { accountId, steam64 };
            setCached(key, result);
            return result;
        }
    } catch (error) {
        console.error('Ошибка разрешения custom URL:', error?.message || error);
    }
    return fallback;
}

/**
 * Очистить кеш (например, для ручного обновления).
 */
export function clearSteamCache() {
    profileCache.clear();
}

/**
 * Используется ли официальный Steam Web API (ключ задан).
 */
export function isSteamApiEnabled() {
    return Boolean(STEAM_API_KEY);
}
