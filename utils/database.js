import mysql from 'mysql2/promise';
import { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } from '../config.js';

// Кэши пулов - ленивая инициализация
const pools = new Map();
const poolConfigs = new Map();

function getDefaultConfig() {
    return {
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 15,           // Увеличено для большей пропускной способности
        queueLimit: 0,
        enableKeepAlive: true,         // Поддержание соединений живыми
        keepAliveInitialDelay: 10000,  // Начальная задержка keep-alive
        connectTimeout: 10000,         // Таймаут подключения
        idleTimeout: 60000,             // Таймат простоя соединения
        // ⚠️ КРИТИЧНО: Discord snowflake и Steam64 — 17-18 значные числа,
        // превышающие Number.MAX_SAFE_INTEGER. Без этих опций mysql2 вернёт
        // BIGINT как JS-число и ПОТЕРЯЕТ ТОЧНОСТЬ (ID оканчиваются на 00/700...).
        // С ними большие числа всегда возвращаются строками.
        supportBigNumbers: true,
        bigNumberStrings: true,
    };
}

function getPoolName(name) {
    return name || 'default';
}

export async function createPool(host, user, password, database) {
    return createNamedPool('default', host, user, password, database);
}

export function getPool() {
    return getNamedPool('default');
}

export async function closePool() {
    await closeNamedPool('default');
}

// Внутренняя функция для создания/получения пула
async function getOrCreatePool(name, config = {}) {
    const poolName = getPoolName(name);
    const existingPool = pools.get(poolName);
    
    if (existingPool) {
        try {
            // Проверяем, что пул жив
            await existingPool.query('SELECT 1');
            return existingPool;
        } catch {
            // Пул мёртв, удаляем и создаём новый
            pools.delete(poolName);
        }
    }
    
    const poolConfig = {
        ...getDefaultConfig(),
        ...config,
    };
    
    try {
        const newPool = mysql.createPool(poolConfig);
        
        // Проверяем подключение
        await newPool.query('SELECT 1');
        
        pools.set(poolName, newPool);
        poolConfigs.set(poolName, poolConfig);
        console.log(`Подключение к базе данных установлено успешно (${poolName})`);
        return newPool;
    } catch (error) {
        console.error(`Ошибка подключения к базе данных (${poolName}):`, error);
        return null;
    }
}

export async function createNamedPool(name, host, user, password, database) {
    const config = {
        host: host || DB_HOST,
        user: user || DB_USER,
        password: password || DB_PASSWORD,
        database: database || DB_NAME,
    };
    
    return getOrCreatePool(name, config);
}

export function getNamedPool(name) {
    const poolName = getPoolName(name);
    return pools.get(poolName) || null;
}

// Основной метод для выполнения запросов с автоматическим переподключением
export async function executeQuery(sql, params = [], poolName = 'default') {
    const pool = await getOrCreatePool(poolName);
    if (!pool) {
        throw new Error('Нет подключения к базе данных');
    }
    
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        // При ошибке подключения пробуем переподключиться
        if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
            error.code === 'ECONNRESET' ||
            error.code === 'ER_SERVER_GONE_ERROR') {
            
            pools.delete(poolName);
            const retryPool = await getOrCreatePool(poolName, poolConfigs.get(poolName));
            if (retryPool) {
                const [results] = await retryPool.execute(sql, params);
                return results;
            }
        }
        throw error;
    }
}

// Метод для запросов с ручным параметром (без подготовленных выражений)
export async function query(sql, params = [], poolName = 'default') {
    const pool = await getOrCreatePool(poolName);
    if (!pool) {
        throw new Error('Нет подключения к базе данных');
    }
    
    try {
        const [results] = await pool.query(sql, params);
        return results;
    } catch (error) {
        if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
            error.code === 'ECONNRESET' ||
            error.code === 'ER_SERVER_GONE_ERROR') {
            
            pools.delete(poolName);
            const retryPool = await getOrCreatePool(poolName, poolConfigs.get(poolName));
            if (retryPool) {
                const [results] = await retryPool.query(sql, params);
                return results;
            }
        }
        throw error;
    }
}

// Получение одной строки
export async function getOne(sql, params = [], poolName = 'default') {
    const results = await query(sql, params, poolName);
    return Array.isArray(results) ? results[0] : results;
}

// Получение одной колонки
export async function getColumn(sql, params = [], poolName = 'default') {
    const results = await query(sql, params, poolName);
    if (Array.isArray(results) && results.length > 0) {
        const firstRow = results[0];
        return firstRow ? Object.values(firstRow)[0] : null;
    }
    return null;
}

// Проверка существования записи
export async function exists(sql, params = [], poolName = 'default') {
    const results = await query(sql, params, poolName);
    return Array.isArray(results) ? results.length > 0 : !!results;
}

export async function closeNamedPool(name) {
    const poolName = getPoolName(name);
    const pool = pools.get(poolName);
    
    if (pool) {
        try {
            await pool.end();
            pools.delete(poolName);
            poolConfigs.delete(poolName);
            console.log(`Подключение к базе данных закрыто (${poolName})`);
        } catch (error) {
            console.error(`Ошибка закрытия подключения (${poolName}):`, error);
        }
    }
}

// Закрытие всех пулов
export async function closeAllPools() {
    for (const name of pools.keys()) {
        await closeNamedPool(name);
    }
}
