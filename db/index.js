// db/index.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // или отдельные параметры (рекомендуется для продакшена)
  // host: process.env.DB_HOST || 'localhost',
  // port: process.env.DB_PORT || 5432,
  // database: process.env.DB_NAME,
  // user: process.env.DB_USER,
  // password: process.env.DB_PASSWORD,
  max: 20,               // максимум соединений в пуле
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Проверка подключения при старте
pool.on('connect', () => console.log('→ PostgreSQL клиент подключён'));
pool.on('error', (err) => console.error('Ошибка в пуле PostgreSQL:', err.stack));

/**
 * Проверяет, существует ли патент в БД
 * @param {string} patentId
 * @returns {Promise<boolean>}
 */
async function patentExists(patentId) {
  const res = await pool.query(
    'SELECT 1 FROM patents WHERE patent_id = $1 LIMIT 1',
    [patentId]
  );
  return res.rowCount > 0;
}

/**
 * Сохраняет или обновляет патент (UPSERT)
 * @param {string} patentId
 * @param {object} data { abstract, claims, description }
 * @returns {Promise<void>}
 */
async function savePatent(patentId, { abstract = '', claims = '', description = '' }) {
  await pool.query(`
    INSERT INTO patents (patent_id, abstract, claims, description)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (patent_id) DO UPDATE SET
      abstract     = EXCLUDED.abstract,
      claims       = EXCLUDED.claims,
      description  = EXCLUDED.description,
      updated_at   = NOW()
  `, [patentId, abstract, claims, description]);
}

module.exports = {
  pool,
  patentExists,
  savePatent,
  // Можно добавить close при завершении приложения
  async close() {
    await pool.end();
    console.log('→ PostgreSQL пул закрыт');
  }
};