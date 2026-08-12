FROM node:20-slim

# Рабочая директория
WORKDIR /app

# Системные зависимости для canvas (@napi-rs/canvas) и gamedig
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libjpeg62-turbo \
    libgif-dev \
    librsvg2-dev \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Копируем package.json и устанавливаем зависимости
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Копируем исходный код
COPY . .

# Создаём том для runtime-данных (levels.json, *_config.json и т.п.)
VOLUME /app/data

# Точка входа
CMD ["node", "index.js"]
