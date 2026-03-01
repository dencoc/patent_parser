require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { chromium } = require('playwright');
const db = require('./db');

const argv = yargs(hideBin(process.argv))
  .option('input', { alias: 'i', type: 'string', default: process.env.INPUT_FILE })
  .option('folder', { alias: 'f', type: 'string', default: process.env.OUTPUT_FOLDER })
  .option('keywords', { alias: 'k', type: 'string', default: '' })
  .option('concurrency', {
    alias: 'c',
    type: 'number',
    default: 10,
    describe: 'Макс. одновременных загрузок (5–20 рекомендуемо)'
  })
  .help()
  .argv;

const FOLDER = argv.folder;
const INPUT_FILE = argv.input;
const KEYWORDS = argv.keywords
  ? argv.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  : [];
const CONCURRENCY = Math.max(1, Math.min(30, argv.concurrency));
if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
  console.error('Ошибка: не заданы параметры PostgreSQL в .env');
  process.exit(1);
}

if (!fs.existsSync(FOLDER)) {
  fs.mkdirSync(FOLDER, { recursive: true });
  console.log(`✅ Папка ${FOLDER} создана`);
}

let browser = null;

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function extractPatent(url, id) {
  let context = null;
  let page = null;

  try {
    const browser = await initBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'ru-RU',
    });

    page = await context.newPage();

    console.log(`[${id}] Загружаем → ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await page.waitForSelector('section#abstract, section#claims, section#description', {
      state: 'visible',
      timeout: 15000,
    }).catch(() => console.log(`[${id}] Секции не загрузились timely`));

    const data = await page.evaluate(() => {
      const clean = (text) => (text || '')
        .replace(/^Реферат\s*/im, '')
        .replace(/^Формула изобретения\s*\(\d+\)\s*/im, '')
        .replace(/^Описание\s*/im, '')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        abstract: clean(document.querySelector('section#abstract')?.innerText),
        claims: clean(document.querySelector('section#claims')?.innerText),
        description: clean(document.querySelector('section#description')?.innerText),
      };
    });

    return {
      abstract: data.abstract || '',
      claims: data.claims || '',
      description: data.description || '',
    };

  } catch (error) {
    console.error(`[${id}] Ошибка: ${error.message}`);
    return { abstract: '', claims: '', description: '' };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

async function processPatent(row) {
  const id = (row.id || '').trim();
  if (!id) return;

  // Проверяем существование в БД (вместо проверки файла)
  if (await db.patentExists(id)) {
    console.log(`[${id}] Уже существует в БД → пропуск`);
    return;
  }

  const title = (row.title || '').trim();
  const link = (row['result link'] || row['result_link'] || '').trim();

  if (!link || !link.includes('patents.google.com')) {
    console.log(`[${id}] Нет ссылки → пропуск`);
    return;
  }

  if (KEYWORDS.length > 0 && !KEYWORDS.some(kw => title.toLowerCase().includes(kw))) {
    console.log(`[${id}] Не подходит по ключевым словам → пропуск`);
    return;
  }

  console.log(`[${id}] Парсим → ${link}`);
  const data = await extractPatent(link, id);

  // Сохраняем в PostgreSQL
  await db.savePatent(id, data);

  console.log(`[${id}] Сохранено в БД`);
  if (data.abstract)    console.log(`   Abstract:    ${data.abstract.substring(0, 80)}...`);
  if (data.claims)      console.log(`   Claims:      ${data.claims.substring(0, 80)}...`);
  if (data.description) console.log(`   Description: ${data.description.substring(0, 80)}...`);
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.count = 0;
    this.waiting = [];
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    return new Promise(resolve => this.waiting.push(resolve));
  }

  release() {
    this.count--;
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      this.count++;
      resolve();
    }
  }
}

async function main() {
  const patents = [];

  try {
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS patents (
        patent_id       VARCHAR(50) PRIMARY KEY,
        abstract        TEXT,
        claims          TEXT,
        description     TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Таблица patents проверена/создана');
  } catch (err) {
    console.error('Ошибка при создании таблицы patents:', err.message);
    process.exit(1);
  }

  try {
    await db.pool.query('SELECT 1');
    console.log('PostgreSQL подключение успешно');
  } catch (err) {
    console.error('Ошибка подключения к PostgreSQL:', err.message);
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    fs.createReadStream(INPUT_FILE)
      .pipe(csv())
      .on('data', row => patents.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📋 Загружено патентов: ${patents.length}`);
  console.log(`Сохраняем в PostgreSQL (база: ${process.env.DATABASE_URL || process.env.DB_NAME || '???'} )`);

  const semaphore = new Semaphore(CONCURRENCY);
  let completed = 0;

  const promises = patents.map(async (row) => {
    await semaphore.acquire();

    try {
      await processPatent(row);
    } finally {
      semaphore.release();
      completed++;
      console.log(`Прогресс: ${completed}/${patents.length}`);
    }
  });

  await Promise.all(promises);

  console.log('🎉 Парсинг завершён!');
  await db.close();
  await closeBrowser();
}

main().catch(async err => {
  console.error('Критическая ошибка:', err);
  await db.close().catch(() => {});
  await closeBrowser();
});