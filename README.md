# Парсер патентов Google Patents (RU) — abstract, claims, description

Массовый асинхронный парсер российских патентов с сайта patents.google.com.  
Извлекает **реферат**, **формулу изобретения** и **описание** → сохраняет в отдельные JSON-файлы.

Особенности:
- Полностью параллельная загрузка (до 20+ патентов одновременно)
- Использует **Playwright** (headless Chromium) — надёжно работает с динамическим контентом
- Нет дубликатов — пропускает уже существующие файлы
- Фильтрация по ключевым словам в заголовке (опционально)
- Основные настройки через `.env` (удобно для регулярного использования)
- Аргументы командной строки имеют приоритет над `.env`

## Требования

- Node.js ≥ 18
- Playwright (браузеры устанавливаются автоматически)

## Установка
```bash
# 1. Создайте проект или скачайте скрипт
mkdir patent-parser && cd patent-parser

# 2. Инициализация и зависимости
npm init -y
npm install playwright csv-parser yargs dotenv

# 3. Установите браузеры Playwright
npx playwright install chromium

## Запуск
# 1. Всё из .env
node parser_patents_fast.js

# 2. Переопределить только некоторые параметры
node parser_patents_fast.js --concurrency 15 --keywords "турбонаддув,впрыск"

# 3. Использовать другой CSV-файл
node parser_patents_fast.js --input another_patents.csv

# 4. Максимальная скорость
node parser_patents_fast.js --concurrency 18