/**
 * cardBuilder.js — Рендер ранг-карточек через @napi-rs/canvas
 *
 * Генерирует премиум-карточку уровня: тёмный фон с градиентом, скруглённый аватар,
 * неоновый прогресс-бар, крупный номер уровня и счётчик XP.
 *
 * Использует системные шрифты (Segoe UI / Arial) — регистрация не требуется.
 * Возвращает Buffer PNG, готовый к отправке через AttachmentBuilder.
 */

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

// Размеры карточки (2K-ready, но компактно для Discord)
const W = 934;
const H = 282;

// Шрифты (fallback на Arial, если Segoe UI недоступен — на Linux-сервере)
function fontFamily() {
    const names = GlobalFonts.families.map(f => f.family);
    if (names.includes('Segoe UI')) return 'Segoe UI';
    if (names.includes('DejaVu Sans')) return 'DejaVu Sans';
    return 'Arial';
}

// ─── Утилиты рисования ──────────────────────────────────────────────────────

// Скруглённый прямоугольник
function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Круглое маскирование (для аватара)
function clipCircle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
}

// Линейный градиент
function linearGradient(ctx, x1, y1, x2, y2, stops) {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    return g;
}

// ─── Палитра по уровню ──────────────────────────────────────────────────────
// Возвращает { accent, accent2, glow } — цвета для конкретного уровня.
function paletteForLevel(level) {
    if (level >= 50) return { accent: '#FF2D55', accent2: '#FF6B9D', glow: 'rgba(255,45,85,0.5)' };   // Легенда — красный
    if (level >= 40) return { accent: '#AF52DE', accent2: '#D488FF', glow: 'rgba(175,82,222,0.5)' };  // Мастер — фиолет
    if (level >= 30) return { accent: '#FF9500', accent2: '#FFC04D', glow: 'rgba(255,149,0,0.5)' };   // Эксперт — оранжевый
    if (level >= 20) return { accent: '#FFCC00', accent2: '#FFE066', glow: 'rgba(255,204,0,0.5)' };   // Профи — жёлтый
    if (level >= 10) return { accent: '#34C759', accent2: '#6BE08A', glow: 'rgba(52,199,89,0.5)' };   // Опытный — зелёный
    if (level >= 5)  return { accent: '#00C7BE', accent2: '#5AE6DF', glow: 'rgba(0,199,190,0.5)' };   // Новичок — бирюза
    return            { accent: '#5AC8FA', accent2: '#8FD9FF', glow: 'rgba(90,200,250,0.5)' };        // Начинающий — голубой
}

/**
 * Рендер ранг-карточки.
 * @param {object} opts
 * @param {string} opts.avatarURL — URL аватара (PNG/JPG/WebP)
 * @param {string} opts.username — отображаемое имя
 * @param {number} opts.level — текущий уровень
 * @param {number} opts.currentXp — XP в текущем уровне
 * @param {number} opts.neededXp — XP, нужный для следующего уровня
 * @param {number} opts.totalXp — суммарный XP
 * @param {number} [opts.rank] — позиция в рейтинге (опционально)
 * @param {number} [opts.total] — всего участников (опционально)
 * @param {string} [opts.rankTitle] — название ранга (опционально)
 * @returns {Promise<Buffer>} PNG-Buffer
 */
export async function renderRankCard(opts) {
    const {
        avatarURL,
        username = 'Player',
        level = 0,
        currentXp = 0,
        neededXp = 100,
        totalXp = 0,
        rank = null,
        total = null,
        rankTitle = null
    } = opts;

    const pal = paletteForLevel(level);
    const font = fontFamily();

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Фон: тёмный градиент ───────────────────────────────────────────────
    const bg = linearGradient(ctx, 0, 0, W, H, [
        [0, '#1a1b26'],
        [0.5, '#16161e'],
        [1, '#0f0f14']
    ]);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, W, H, 24);
    ctx.fill();

    // Тонкая светящаяся рамка по контуру карточки
    ctx.save();
    roundRect(ctx, 1, 1, W - 2, H - 2, 23);
    ctx.strokeStyle = pal.accent + '40'; // полупрозрачный акцент
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Декоративное мягкое свечение слева (под аватар)
    const halo = ctx.createRadialGradient(150, 141, 10, 150, 141, 220);
    halo.addColorStop(0, pal.glow);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 400, H);

    // ── Аватар ─────────────────────────────────────────────────────────────
    const AV_SIZE = 170;
    const AV_X = 50;
    const AV_Y = (H - AV_SIZE) / 2;
    const cx = AV_X + AV_SIZE / 2;
    const cy = AV_Y + AV_SIZE / 2;
    const r = AV_SIZE / 2;

    // Кольцо вокруг аватара (градиент акцентом)
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = linearGradient(ctx, AV_X, AV_Y, AV_X + AV_SIZE, AV_Y + AV_SIZE, [
        [0, pal.accent],
        [1, pal.accent2]
    ]);
    clipCircle(ctx, cx, cy, r + 4);
    ctx.stroke();
    ctx.restore();

    // Сам аватар (с обрезкой по кругу)
    try {
        const avatar = await loadImage(avatarURL);
        ctx.save();
        clipCircle(ctx, cx, cy, r);
        ctx.clip();
        // Покрываем круг, сохраняя пропорции (cover)
        const srcRatio = avatar.width / avatar.height;
        let sw = avatar.width, sh = avatar.height, sx = 0, sy = 0;
        if (srcRatio > 1) { sw = avatar.height; sx = (avatar.width - sw) / 2; }
        else { sh = avatar.width; sy = (avatar.height - sh) / 2; }
        ctx.drawImage(avatar, sx, sy, sw, sh, AV_X, AV_Y, AV_SIZE, AV_SIZE);
        ctx.restore();
    } catch (err) {
        // Если аватар не загрузился — рисуем плейсхолдер
        ctx.save();
        clipCircle(ctx, cx, cy, r);
        ctx.fillStyle = '#2a2b3a';
        ctx.fill();
        ctx.restore();
        console.error('cardBuilder: не удалось загрузить аватар:', err.message);
    }

    // ── Текстовая зона ─────────────────────────────────────────────────────
    const TX = AV_X + AV_SIZE + 40; // x-координата текста

    // Имя пользователя
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 34px "${font}"`;
    ctx.textBaseline = 'alphabetic';
    const name = truncate(ctx, username, 380);
    ctx.fillText(name, TX, 92);

    // Подпись ранга (если есть) — под именем, акцентным цветом
    if (rankTitle) {
        ctx.fillStyle = pal.accent2;
        ctx.font = `500 18px "${font}"`;
        ctx.fillText(rankTitle, TX, 118);
    }

    // ── Уровень (справа, крупно) ───────────────────────────────────────────
    const lvlText = String(level);
    ctx.font = `800 88px "${font}"`;
    ctx.textAlign = 'right';
    // Лёгкое свечение
    ctx.save();
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 24;
    ctx.fillStyle = pal.accent;
    ctx.fillText(lvlText, W - 40, 120);
    ctx.restore();

    // Подпись «УРОВЕНЬ»
    ctx.fillStyle = '#8b8da3';
    ctx.font = `600 16px "${font}"`;
    ctx.fillText('УРОВЕНЬ', W - 40, 145);
    ctx.textAlign = 'left'; // сброс

    // ── Прогресс-бар ───────────────────────────────────────────────────────
    const BAR_X = TX;
    const BAR_Y = 175;
    const BAR_W = W - BAR_X - 40;
    const BAR_H = 26;
    const BAR_R = BAR_H / 2;

    // Фон прогресс-бара
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_R);
    ctx.fill();

    // Заполнение
    const pct = Math.max(0, Math.min(currentXp / neededXp, 1));
    const fillW = Math.max(BAR_H, BAR_W * pct); // минимум = высота (чтобы был виден кружок)
    const barGrad = linearGradient(ctx, BAR_X, 0, BAR_X + fillW, 0, [
        [0, pal.accent],
        [1, pal.accent2]
    ]);
    ctx.fillStyle = barGrad;
    roundRect(ctx, BAR_X, BAR_Y, fillW, BAR_H, BAR_R);
    ctx.fill();

    // Блик на прогресс-баре
    ctx.save();
    roundRect(ctx, BAR_X, BAR_Y, fillW, BAR_H, BAR_R);
    ctx.clip();
    const sheen = linearGradient(ctx, 0, BAR_Y, 0, BAR_Y + BAR_H / 2, [
        [0, 'rgba(255,255,255,0.25)'],
        [1, 'rgba(255,255,255,0)']
    ]);
    ctx.fillStyle = sheen;
    ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_H / 2);
    ctx.restore();

    // Текст XP над/под баром
    ctx.fillStyle = '#c9cbd9';
    ctx.font = `500 16px "${font}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${currentXp} / ${neededXp} XP`, BAR_X, BAR_Y + BAR_H + 24);

    // Процент справа над баром
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.accent2;
    ctx.font = `700 16px "${font}"`;
    ctx.fillText(`${(pct * 100).toFixed(1)}%`, BAR_X + BAR_W, BAR_Y - 8);
    ctx.textAlign = 'left';

    // ── Доп. инфо (рейтинг / всего XP) ─────────────────────────────────────
    if (rank !== null) {
        ctx.fillStyle = '#8b8da3';
        ctx.font = `500 15px "${font}"`;
        ctx.textAlign = 'right';
        const rankText = total ? `🏆 #${rank} / ${total}` : `🏆 #${rank}`;
        ctx.fillText(rankText, BAR_X + BAR_W, BAR_Y + BAR_H + 24);
        ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/png');
}

// Обрезка текста с многоточием по ширине
function truncate(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
}
