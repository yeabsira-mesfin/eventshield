import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { pool, query } from './db.js';
import { manage, staff, canReadRegistration, validEvent, csvCell } from './policy.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const writeAudit = (actor, action, type, id) => query(
  'INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',
  [actor ?? null, action, type, id ?? null]
);
const security = (actor, eventType, severity, source, details = '') => query(
  'INSERT INTO security_events(actor_id,event_type,severity,source,details) VALUES($1,$2,$3,$4,$5)',
  [actor ?? null,eventType,severity,source,details]
);
const secret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  return process.env.JWT_SECRET;
};
function auth(req,res,next) {
  const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    next();
  } catch { res.status(401).json({ error: 'Invalid session' }); }
}
const allow = fn => (req,res,next) => {
  if (fn(req.user.role)) return next();
  void security(req.user.id,'unauthorized_access','high','API',req.path).catch(() => {});
  return res.status(403).json({ error: 'Access denied' });
};
const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
app.get('/api/health', (_req,res) => res.json({ status: 'ok', service: 'eventshield' }));
app.post('/api/auth/login', loginLimiter, asyncRoute(async (req,res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 256)
    return res.status(400).json({ error: 'Invalid credentials' });
  const { rows } = await query('SELECT id,name,email,role,password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password,user.password_hash))) {
    await security(user?.id,'login_failure','medium','authentication','Unsuccessful login');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id:user.id, role:user.role, email:user.email, name:user.name }, secret(), { algorithm:'HS256', expiresIn:'2h' });
  await security(user.id,'login_success','low','authentication','Successful login');
  res.json({ token, user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
}));
app.get('/api/me', auth, (req,res) => res.json({ user:req.user }));
app.get('/api/events', auth, asyncRoute(async (_req,res) => {
  const { rows } = await query("SELECT e.*, (SELECT count(*)::int FROM registrations r WHERE r.event_id=e.id AND r.status='confirmed') confirmed, (SELECT count(*)::int FROM registrations r WHERE r.event_id=e.id AND r.status='waitlisted') waitlisted FROM events e ORDER BY starts_at");
  res.json({ events:rows });
}));
app.post('/api/events', auth, allow(manage), asyncRoute(async (req,res) => {
  if (!validEvent(req.body)) return res.status(400).json({ error:'Invalid event fields' });
  const { title,description='',venue,starts_at,capacity } = req.body;
  const { rows } = await query('INSERT INTO events(title,description,venue,starts_at,capacity,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [title.trim(),String(description).slice(0,2000),venue.trim(),starts_at,Number(capacity),req.user.id]);
  await writeAudit(req.user.id,'create','event',rows[0].id);
  res.status(201).json({ event:rows[0] });
}));
app.patch('/api/events/:id', auth, allow(manage), asyncRoute(async (req,res) => {
  if (!['draft','published','archived'].includes(req.body?.status)) return res.status(400).json({ error:'Invalid status' });
  const { rows } = await query('UPDATE events SET status=$1 WHERE id=$2 RETURNING *',[req.body.status,req.params.id]);
  if (!rows[0]) return res.status(404).json({ error:'Event not found' });
  await writeAudit(req.user.id,'change_status','event',rows[0].id);
  res.json({ event:rows[0] });
}));
app.get('/api/events/:id/config', auth, asyncRoute(async (req,res) => {
  const types = await query('SELECT id,name FROM registration_types WHERE event_id=$1 ORDER BY name',[req.params.id]);
  const sessions = await query('SELECT id,title,registration_type_id,capacity FROM sessions WHERE event_id=$1 ORDER BY title',[req.params.id]);
  res.json({ types:types.rows, sessions:sessions.rows });
}));
app.post('/api/events/:id/types', auth, allow(manage), asyncRoute(async (req,res) => {
  const name = req.body?.name;
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) return res.status(400).json({ error:'Invalid type' });
  const { rows } = await query('INSERT INTO registration_types(event_id,name) VALUES($1,$2) RETURNING *',[req.params.id,name.trim()]);
  res.status(201).json({ type:rows[0] });
}));
app.post('/api/events/:id/registrations', auth, asyncRoute(async (req,res) => {
  const name = req.body?.attendee_name;
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) return res.status(400).json({ error:'Invalid attendee name' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: events } = await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[req.params.id]);
    const event = events[0];
    if (!event || event.status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Published event not found' });
    }
    const typeId = req.body?.registration_type_id || null;
    if (typeId) {
      const type = await client.query('SELECT id FROM registration_types WHERE id=$1 AND event_id=$2',[typeId,event.id]);
      if (!type.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error:'Invalid registration type' }); }
    }
    const { rows: existing } = await client.query('SELECT id,status FROM registrations WHERE event_id=$1 AND user_id=$2',[event.id,req.user.id]);
    if (existing.length) { await client.query('ROLLBACK'); return res.status(409).json({ error:'Already registered. Cancel existing registration before registering again.' }); }
    const { rows: count } = await client.query("SELECT count(*)::int AS n FROM registrations WHERE event_id=$1 AND status='confirmed'",[event.id]);
    const status = count[0].n >= event.capacity ? 'waitlisted' : 'confirmed';
    const { rows } = await client.query('INSERT INTO registrations(event_id,user_id,attendee_name,email,registration_type_id,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,event_id,status,created_at',
      [event.id,req.user.id,name.trim(),req.user.email,typeId,status]);
    await client.query('INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',[req.user.id,'register','registration',rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ registration:rows[0] });
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}));
app.get('/api/registrations/mine', auth, asyncRoute(async (req,res) => {
  const { rows } = await query('SELECT r.id,r.event_id,r.status,r.created_at,e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.user_id=$1 ORDER BY r.created_at DESC',[req.user.id]);
  res.json({ registrations:rows });
}));
app.get('/api/registrations/:id', auth, asyncRoute(async (req,res) => {
  const { rows } = await query('SELECT * FROM registrations WHERE id=$1',[req.params.id]);
  if (!rows[0]) return res.status(404).json({ error:'Registration not found' });
  if (!canReadRegistration(req.user,rows[0])) {
    await security(req.user.id,'object_access_denied','high','registration-api','Blocked cross-account registration read');
    return res.status(403).json({ error:'Access denied' });
  }
  res.json({ registration:rows[0] });
}));
app.patch('/api/registrations/:id/cancel', auth, asyncRoute(async (req,res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Read the event key first, then lock the event row in the same order
    // used by registration transactions to serialize capacity changes.
    const initial = await client.query('SELECT event_id,user_id FROM registrations WHERE id=$1',[req.params.id]);
    if (!initial.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'Registration not found' });
    }
    if (!canReadRegistration(req.user,initial.rows[0])) {
      await client.query('ROLLBACK');
      await security(req.user.id,'object_access_denied','high','registration-api','Blocked cross-account cancellation');
      return res.status(403).json({ error:'Access denied' });
    }
    await client.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[initial.rows[0].event_id]);
    const current = await client.query('SELECT id,status,user_id FROM registrations WHERE id=$1 FOR UPDATE',[req.params.id]);
    if (!current.rows[0] || current.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Registration already cancelled' });
    }
    const priorStatus = current.rows[0].status;
    const changed = await client.query("UPDATE registrations SET status='cancelled' WHERE id=$1 RETURNING id,status",[req.params.id]);
    let promoted = null;
    if (priorStatus === 'confirmed') {
      const waiting = await client.query(
        "SELECT id FROM registrations WHERE event_id=$1 AND status='waitlisted' ORDER BY created_at,id LIMIT 1 FOR UPDATE",
        [initial.rows[0].event_id]
      );
      if (waiting.rows[0]) {
        const result = await client.query(
          "UPDATE registrations SET status='confirmed' WHERE id=$1 RETURNING id",
          [waiting.rows[0].id]
        );
        promoted = result.rows[0].id;
        await client.query(
          'INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',
          [req.user.id,'waitlist_promote','registration',promoted]
        );
      }
    }
    await client.query(
      'INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',
      [req.user.id,'cancel','registration',req.params.id]
    );
    await client.query('COMMIT');
    res.json({ registration:changed.rows[0], promoted: !!promoted });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));
app.get('/api/events/:id/registrations', auth, allow(staff), asyncRoute(async (req,res) => {
  const { rows } = await query('SELECT id,attendee_name,email,status,created_at FROM registrations WHERE event_id=$1 ORDER BY created_at DESC LIMIT 500',[req.params.id]);
  res.json({ registrations:rows });
}));
app.get('/api/events/:id/export', auth, allow(manage), asyncRoute(async (req,res) => {
  const { rows } = await query('SELECT attendee_name,email,status FROM registrations WHERE event_id=$1 ORDER BY created_at',[req.params.id]);
  const csv = ['Name,Email,Status',...rows.map(r => [r.attendee_name,r.email,r.status].map(csvCell).join(','))].join('\r\n');
  await writeAudit(req.user.id,'export','event',req.params.id);
  await security(req.user.id,'sensitive_data_export','medium','registration-api','Attendee CSV export performed');
  res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition','attachment; filename="attendees.csv"').send(csv);
}));
app.get('/api/dashboard', auth, allow(staff), asyncRoute(async (_req,res) => {
  const { rows } = await query("SELECT (SELECT count(*)::int FROM events) events, (SELECT count(*)::int FROM registrations WHERE status='confirmed') confirmed, (SELECT count(*)::int FROM registrations WHERE status='waitlisted') waitlisted, (SELECT count(*)::int FROM security_events WHERE status='open' AND severity IN ('high','critical')) high_alerts");
  res.json({ metrics:rows[0] });
}));
app.get('/api/security', auth, allow(manage), asyncRoute(async (_req,res) => {
  const [events,incidents,audits] = await Promise.all([
    query('SELECT id,event_type,severity,source,status,details,created_at FROM security_events ORDER BY created_at DESC LIMIT 100'),
    query('SELECT id,title,severity,status,notes,created_at FROM incidents ORDER BY created_at DESC LIMIT 100'),
    query('SELECT id,action,object_type,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100')
  ]);
  res.json({ events:events.rows, incidents:incidents.rows, audits:audits.rows });
}));
app.post('/api/incidents', auth, allow(manage), asyncRoute(async (req,res) => {
  if (typeof req.body?.title !== 'string' || req.body.title.trim().length < 4 || req.body.title.length > 160) return res.status(400).json({ error:'Invalid incident title' });
  const severity = ['low','medium','high','critical'].includes(req.body.severity) ? req.body.severity : 'medium';
  const { rows } = await query('INSERT INTO incidents(title,severity,created_by) VALUES($1,$2,$3) RETURNING *',[req.body.title.trim(),severity,req.user.id]);
  await writeAudit(req.user.id,'create','incident',rows[0].id);
  res.status(201).json({ incident:rows[0] });
}));
app.patch('/api/incidents/:id', auth, allow(manage), asyncRoute(async (req,res) => {
  if (!['open','investigating','resolved'].includes(req.body?.status)) return res.status(400).json({ error:'Invalid status' });
  const { rows } = await query('UPDATE incidents SET status=$1 WHERE id=$2 RETURNING *',[req.body.status,req.params.id]);
  if (!rows[0]) return res.status(404).json({ error:'Incident not found' });
  await writeAudit(req.user.id,'update_status','incident',rows[0].id);
  res.json({ incident:rows[0] });
}));
app.use((req,res) => res.status(404).json({ error:'Route not found' }));
app.use((err,req,res,next) => {
  if (res.headersSent) return next(err);
  // Do not expose SQL internals, tokens or personally identifying request bodies.
  const status = err.code === '23505' ? 409 : ['22P02','23503'].includes(err.code) ? 400 : 500;
  if (status === 500) console.error('Request failed', err.code || err.name || 'unexpected');
  res.status(status).json({ error: status===409 ? 'Duplicate record' : status===400 ? 'Invalid reference' : 'Internal server error' });
});
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log('EventShield API listening on ' + port));
}
