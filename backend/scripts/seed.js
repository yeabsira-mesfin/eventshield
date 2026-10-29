import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) {
  console.error('Set DEMO_PASSWORD to a local password of 12+ characters before seeding.');
  process.exit(1);
}
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD, 12);
  const people = [
    ['Admin User', 'admin@eventshield.test', 'Admin'],
    ['Event Manager', 'manager@eventshield.test', 'Event Manager'],
    ['Demo Attendee', 'attendee@eventshield.test', 'Attendee'],
    ['Second Attendee', 'guest@eventshield.test', 'Attendee']
  ];
  const ids = {};
  for (const [name, email, role] of people) {
    const { rows } = await client.query(
      'INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, password_hash=EXCLUDED.password_hash RETURNING id',
      [name, email, role, hash]
    );
    ids[email] = rows[0].id;
  }
  const { rows: events } = await client.query(
    "SELECT id FROM events WHERE title = $1 LIMIT 1", ['Enterprise Security Summit']
  );
  let eventId = events[0]?.id;
  if (!eventId) {
    const { rows } = await client.query(
      "INSERT INTO events(title,description,venue,starts_at,capacity,status,created_by) VALUES($1,$2,$3,now() + interval '30 days',$4,'published',$5) RETURNING id",
      ['Enterprise Security Summit','Synthetic enterprise event with registration, waitlists and security monitoring','Washington, DC',120,ids['admin@eventshield.test']]
    );
    eventId = rows[0].id;
  }
  await client.query("INSERT INTO registration_types(event_id,name) VALUES($1,'General'),($1,'VIP') ON CONFLICT DO NOTHING", [eventId]);
  await client.query('COMMIT');
  console.log('Synthetic users ready: admin@eventshield.test, manager@eventshield.test, attendee@eventshield.test, guest@eventshield.test');
  console.log('Use only your DEMO_PASSWORD. Never commit it.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
