/**
 * faceit.js — Клиент FACEIT Data API v4
 *
 * Назначение: поиск игрока по Steam64 ID и получение его уровня/elo в CS2.
 * Используется cog'ом faceit_cog для авто-ролей уровней FACEIT.
 *
 * Эндпоинт: GET https://open.faceit.com/data/v4/players?game=cs2&game_player_id={steam64}
 * Ответ: games.cs2.skill_level (1-10), games.cs2.faceit_elo, nickname, player_id.
 *
 * Защита от rate-limit (FACEIT: 20 req/sec, 100/10min на бесплатном тарифе):
 *   • in-memory кеш с TTL;
 *   • глобальная последовательная очередь с паузой между запросами;
 *   • ретраи при 429 с экспоненциальной задержкой.
 */

import axios from 'axios';
import { FACEIT_API_KEY, FACEIT_GAME } from '../config.js';

const FACEIT_BASE = 'https://open.faceit.com/data/v4/players';
const CACHE_TTL_MS = 30 * 60 * 1000;      // 30 минут на steam64
const REQUEST_TIMEOUT_MS = 8000;           // таймаут одного запроса
const MIN_INTERVAL_MS = 200;               // пауза между запросами (≤ 5 req/sec — с запасом)
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;

const cache = new Map();                    // steam64 -> { value, expiresAt }
let queueTail = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCached(key) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    if (hit) cache.delete(key);
    return undefined;
}

function setCached(key, value) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Глобальная последовательная очередь: запросы к FACEIT идут по одному.
function enqueue(task) {
    const run = queueTail.then(task, task);
    queueTail = run.catch(() => {}); // изолируем ошибки
    return run;
}

// Сырой запрос с ретраями при 429.
async function fetchPlayer(steam64, game) {
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const sinceLast = Date.now() - lastRequestAt;
        if (sinceLast < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - sinceLast);
        lastRequestAt = Date.now();

        try {
            const response = await axios.get(FACEIT_BASE, {
                params: { game: game, game_player_id: steam64 },
                timeout: REQUEST_TIMEOUT_MS,
                headers: { Authorization: `Bearer ${FACEIT_API_KEY}` },
                validateStatus: status => status === 200
            });
            return response.data;
        } catch (error) {
            lastError = error;
            const status = error?.response?.status;
            const retryable = status === 429 || status >= 500 ||
                error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';

            if (retryable) {
                const delay = RETRY_BASE_MS * Math.pow(2, attempt);
                console.warn(`[faceit] ${status || error.code} для ${steam64} — повтор через ${delay} мс (попытка ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(delay);
                continue;
            }
            // 404 = игрока нет на FACEIT — это валидный результат, не ретраим
            break;
        }
    }
    throw lastError || new Error('FACEIT request failed');
}

/**
 * Получить уровень FACEIT игрока по Steam64 ID.
 * @param {string} steam64
 * @returns {Promise<{found: boolean, level?: number, elo?: number, nickname?: string, playerId?: string}>}
 *   found=false, если игрок не зарегистрирован на FACEIT (HTTP 404) или нет данных игры.
 */
export async function getFaceitLevelBySteam64(steam64) {
    if (!FACEIT_API_KEY) {
        console.error('[faceit] FACEIT_API_KEY не задан в config/.env');
        return { found: false };
    }

    const cacheKey = String(steam64);
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const data = await enqueue(() => fetchPlayer(steam64, FACEIT_GAME));
        // Берём уровень из cs2; если cs2 нет — пробуем csgo (многие аккаунты только по CSGO).
        const games = data?.games || {};
        const gameData = games[FACEIT_GAME] || games.csgo || games.cs2 || null;

        if (!gameData || typeof gameData.skill_level !== 'number') {
            // Игрок есть, но не играет в CS2/CSGO
            const result = { found: false };
            setCached(cacheKey, result);
            return result;
        }

        const result = {
            found: true,
            level: gameData.skill_level,           // 1-10
            elo: gameData.faceit_elo ?? null,
            nickname: data.nickname ?? null,
            playerId: data.player_id ?? null,
            game: FACEIT_GAME in games ? FACEIT_GAME : ('csgo' in games ? 'csgo' : FACEIT_GAME)
        };
        setCached(cacheKey, result);
        return result;
    } catch (error) {
        const status = error?.response?.status;
        if (status === 404) {
            // Игрок не зарегистрирован на FACEIT — кешируем как «не найден».
            // 🔍 Диагностика: выводим steam64, чтобы выявить испорченные/нереальные ID.
            console.log(`[FACEIT-DBG] 404 для steam64=${steam64} (длина=${String(steam64).length}) → аккаунта нет`);
            const result = { found: false };
            setCached(cacheKey, result);
            return result;
        }
        console.error(`[faceit] ошибка получения уровня для steam64=${steam64} (статус ${status}):`, error?.message || error);
        return { found: false };
    }
}

/**
 * Массовое получение уровней (для ежедневного обновления).
 * @param {string[]} steam64List
 * @returns {Promise<Map<string, {found, level, elo, nickname, playerId}>>}
 */
export async function getFaceitLevelsBulk(steam64List) {
    const result = new Map();
    if (!steam64List || steam64List.length === 0) return result;

    for (const id of steam64List) {
        const info = await getFaceitLevelBySteam64(id);
        result.set(String(id), info);
    }
    return result;
}

export function clearFaceitCache() {
    cache.clear();
}

export function isFaceitApiEnabled() {
    return Boolean(FACEIT_API_KEY);
}
