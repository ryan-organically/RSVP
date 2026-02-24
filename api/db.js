const { createClient } = require('@libsql/client');

let db = null;
let migrated = false;

function getDB() {
  if (!db) {
    db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return db;
}

async function ensureSchema() {
  if (migrated) return;
  const client = getDB();
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS books (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      source     TEXT NOT NULL DEFAULT 'import',
      added_at   TEXT NOT NULL DEFAULT (datetime('now')),
      content    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_positions (
      book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      word_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      word_index INTEGER NOT NULL,
      label      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(book_id, word_index)
    );
  `);
  migrated = true;
}

module.exports = { getDB, ensureSchema };
