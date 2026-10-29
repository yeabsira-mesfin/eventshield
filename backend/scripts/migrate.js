import { readFile } from 'node:fs/promises';
import { pool } from '../db.js';
const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
try { await pool.query(sql); console.log('EventShield schema ready'); }
finally { await pool.end(); }
