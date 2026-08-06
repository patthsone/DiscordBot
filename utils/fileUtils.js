import { readFileSync, writeFileSync, existsSync } from 'fs';

export function loadJSON(filePath, defaultValue = {}) {
    if (existsSync(filePath)) {
        try {
            const data = readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error(`Ошибка чтения файла ${filePath}:`, error);
            return defaultValue;
        }
    }
    return defaultValue;
}

export function saveJSON(filePath, data) {
    try {
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Ошибка записи файла ${filePath}:`, error);
    }
}

