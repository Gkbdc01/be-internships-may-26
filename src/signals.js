import fs from 'fs';
fs.mkdirSync('./data', { recursive: true });
import Database from 'better-sqlite3';

const db = new Database('./data/signals.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    idempotencyKey TEXT UNIQUE,
    createdAt INTEGER NOT NULL
  )
`);

const insertStmt = db.prepare(`
  INSERT INTO signals (userId, type, payload, idempotencyKey, createdAt) 
  VALUES (@userId, @type, @payload, @idempotencyKey, @createdAt)
`);

const getByIdemStmt = db.prepare(`
  SELECT * FROM signals WHERE idempotencyKey = ?
`);

const getAllStmt = db.prepare(`
  SELECT * FROM signals ORDER BY createdAt DESC LIMIT 100
`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function postSignal(req, reply) {
  const { userId, type, payload } = req.body;
  const idemKey = req.headers['idempotency-key'] || null; 
  
  let retries = 3;

  while (retries > 0) {
    try {
      const nowMs = Date.now();
      
      const info = insertStmt.run({
        userId: userId,
        type: type,
        payload: typeof payload === 'object' ? JSON.stringify(payload) : payload,
        idempotencyKey: idemKey,
        createdAt: nowMs
      });

      return reply.code(200).send({
        id: info.lastInsertRowid,
        userId: userId,
        type: type,
        payload: payload,
        idempotencyKey: idemKey,
        createdAt: nowMs
      });

    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && idemKey) {
        const existingRecord = getByIdemStmt.get(idemKey);
        
        try {
          existingRecord.payload = JSON.parse(existingRecord.payload);
        } catch (e) {}
        
        return reply.code(200).send(existingRecord);
      }

      if (err.code === 'SQLITE_BUSY') {
        retries--;
        if (retries === 0) {
          return reply.code(503).send({ error: 'Service Unavailable - Database is too busy' });
        }
        const jitter = Math.floor(Math.random() * 50);
        await sleep(100 + jitter);
        continue;
      }

      req.log.error(err);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  }
}

export async function getSignals(req, reply) {
  try {
    const signals = getAllStmt.all();
    
    const formattedSignals = signals.map(sig => {
      try {
        sig.payload = JSON.parse(sig.payload);
      } catch (e) {}
      return sig;
    });

    return reply.code(200).send(formattedSignals);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal Server Error' });
  }
}