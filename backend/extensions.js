import {createHmac} from 'node:crypto';
import {parse} from 'csv-parse/sync';

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail=x=>typeof x==='string'&&x.length<=254&&emailPattern.test(x.trim());
const validName=x=>typeof x==='string'&&x.trim().length>=2&&x.length<=120;
const validLabel=x=>typeof x==='string'&&x.trim().length>=2&&x.length<=160;
const fingerprint=email=>createHmac('sha256',process.env.JWT_SECRET||'').update(email.trim().toLowerCase()).digest('hex');

export async function validateRegistrationRules(client,eventId,email,typeId,answers={}){
 const sup=await client.query('SELECT 1 FROM event_suppression WHERE event_id=$1 AND email_fingerprint=$2',[eventId,fingerprint(email)]);
 if(sup.rowCount)return {error:'Registration not eligible'};
 if(typeId){
  const type=await client.query('SELECT email_domain FROM registration_types WHERE event_id=$1 AND id=$2',[eventId,typeId]);
  if(!type.rowCount)return {error:'Registration type not found'};
  const domain=type.rows[0].email_domain;
  if(domain&&!email.toLowerCase().endsWith('@'+domain))return {error:'Registration not eligible for this path'};
 }
 if(answers===null||typeof answers!=='object'||Array.isArray(answers))return {error:'Invalid question answers'};
 const {rows:questions}=await client.query('SELECT id,required FROM registration_questions WHERE event_id=$1 AND (registration_type_id IS NULL OR registration_type_id=$2)',[eventId,typeId]);
 const allowed=new Set(questions.map(q=>q.id));
 if(Object.keys(answers).length>50)return {error:'Too many answers'};
 for(const [id,text] of Object.entries(answers)){
  if(!allowed.has(id)||typeof text!=='string'||text.length>500)return {error:'Invalid question answer'};
 }
 for(const q of questions){
  if(q.required&&!(answers[q.id]||'').trim())return {error:'Required registration question missing'};
 }
 return {answers:Object.entries(answers).filter(([,text])=>text.trim().length)};
}
export async function persistRegistrationAnswers(client,registrationId,items=[]){
 for(const [questionId,answer] of items)
  await client.query('INSERT INTO registration_answers(registration_id,question_id,answer) VALUES($1,$2,$3)',[registrationId,questionId,answer.trim()]);
}

export function installExtensions(app,{auth,allow,manage,staff,asyncRoute,query,pool,writeAudit,security,canReadRegistration}){
 const reject=(res,message='Invalid input')=>res.status(400).json({error:message});
 const eventParam=(req)=>req.params.id;
 const validType=async(eventId,typeId,client=query)=>{
  if(!typeId)return true;
  const r=await client('SELECT 1 FROM registration_types WHERE event_id=$1 AND id=$2',[eventId,typeId]);
  return r.rowCount>0;
 };

 app.patch('/api/events/:id/details',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {title,venue,description='',starts_at,capacity}=req.body||{};
  if(!validLabel(title)||typeof venue!=='string'||venue.length>150||!Number.isInteger(capacity)||capacity<1||capacity>100000||Number.isNaN(Date.parse(starts_at))||typeof description!=='string'||description.length>2000)return reject(res);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const existing=await client.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[eventParam(req)]);
   if(!existing.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Event not found'});}
   const {rows:[occupied]}=await client.query("SELECT count(*)::int AS n FROM registrations WHERE event_id=$1 AND status='confirmed'",[eventParam(req)]);
   if(capacity<occupied.n){await client.query('ROLLBACK');return res.status(409).json({error:'Capacity is below confirmed attendance'});}
   const changed=await client.query('UPDATE events SET title=$1,venue=$2,description=$3,starts_at=$4,capacity=$5 WHERE id=$6 RETURNING *',[title.trim(),venue.trim(),description,starts_at,capacity,eventParam(req)]);
   await client.query('INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',[req.user.id,'edit','event',eventParam(req)]);
   await client.query('COMMIT');
   res.json({event:changed.rows[0]});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }));
 app.patch('/api/events/:id/types/:typeId',auth,allow(manage),asyncRoute(async(req,res)=>{
  const domain=req.body?.email_domain;
  if(typeof domain!=='string'||domain.length>100||(domain&&!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain.toLowerCase())))return reject(res,'Invalid email domain');
  const {rows}=await query('UPDATE registration_types SET email_domain=$1 WHERE event_id=$2 AND id=$3 RETURNING id,name,email_domain',[domain.toLowerCase(),eventParam(req),req.params.typeId]);
  if(!rows.length)return res.status(404).json({error:'Registration path not found'});
  await writeAudit(req.user.id,'update_path','event',eventParam(req));
  res.json({type:rows[0]});
 }));
 app.get('/api/events/:id/configuration',auth,asyncRoute(async(req,res)=>{
  const id=eventParam(req);
  const [types,questions,sessions,admissions]=await Promise.all([
   query('SELECT id,name,email_domain FROM registration_types WHERE event_id=$1 ORDER BY name',[id]),
   query('SELECT id,label,required,registration_type_id FROM registration_questions WHERE event_id=$1 ORDER BY label',[id]),
   query('SELECT s.id,s.title,s.capacity,s.registration_type_id,(SELECT count(*)::int FROM session_signups ss JOIN registrations r ON r.id=ss.registration_id WHERE ss.session_id=s.id AND r.status=$2) reserved FROM sessions s WHERE event_id=$1 ORDER BY s.title',[id,'confirmed']),
   query('SELECT a.id,a.title,a.capacity,a.price_cents,a.registration_type_id,(SELECT count(*)::int FROM registration_admissions ra JOIN registrations r ON r.id=ra.registration_id WHERE ra.admission_id=a.id AND r.status=$2) reserved FROM admission_items a WHERE event_id=$1 ORDER BY a.title',[id,'confirmed'])
  ]);
  res.json({types:types.rows,questions:questions.rows,sessions:sessions.rows,admissions:admissions.rows});
 }));
 app.post('/api/events/:id/questions',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {label,required=false,registration_type_id=null}=req.body||{};
  if(!validLabel(label)||typeof required!=='boolean'||!(await validType(eventParam(req),registration_type_id)))return reject(res);
  const {rows}=await query('INSERT INTO registration_questions(event_id,label,required,registration_type_id) VALUES($1,$2,$3,$4) RETURNING *',[eventParam(req),label.trim(),required,registration_type_id]);
  await writeAudit(req.user.id,'add_question','event',eventParam(req));
  res.status(201).json({question:rows[0]});
 }));
 app.post('/api/events/:id/sessions',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {title,capacity,registration_type_id=null}=req.body||{};
  if(!validLabel(title)||!Number.isInteger(capacity)||capacity<1||capacity>10000||!(await validType(eventParam(req),registration_type_id)))return reject(res);
  const {rows}=await query('INSERT INTO sessions(event_id,title,capacity,registration_type_id) VALUES($1,$2,$3,$4) RETURNING *',[eventParam(req),title.trim(),capacity,registration_type_id]);
  await writeAudit(req.user.id,'add_session','event',eventParam(req));
  res.status(201).json({session:rows[0]});
 }));
 app.post('/api/events/:id/admissions',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {title,capacity,registration_type_id=null,price_cents=0}=req.body||{};
  if(!validLabel(title)||!Number.isInteger(capacity)||capacity<1||capacity>10000||!Number.isInteger(price_cents)||price_cents<0||price_cents>10000000||!(await validType(eventParam(req),registration_type_id)))return reject(res);
  const {rows}=await query('INSERT INTO admission_items(event_id,title,capacity,registration_type_id,price_cents) VALUES($1,$2,$3,$4,$5) RETURNING *',[eventParam(req),title.trim(),capacity,registration_type_id,price_cents]);
  await writeAudit(req.user.id,'add_admission','event',eventParam(req));
  res.status(201).json({admission:rows[0]});
 }));
 const enroll=(kind)=>asyncRoute(async(req,res)=>{
  const isSession=kind==='session',table=isSession?'sessions':'admission_items',join=isSession?'session_signups':'registration_admissions',foreign=isSession?'session_id':'admission_id';
  const id=req.body?.[foreign];
  if(typeof id!=='string')return reject(res);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const {rows:[registration]}=await client.query('SELECT id,event_id,user_id,status,registration_type_id FROM registrations WHERE id=$1',[req.params.id]);
   if(!registration){await client.query('ROLLBACK');return res.status(404).json({error:'Registration not found'});}
   if(!canReadRegistration(req.user,registration)){
    await client.query('ROLLBACK');
    await security(req.user.id,'object_access_denied','high','registration-api','Blocked cross-account resource enrollment');
    return res.status(403).json({error:'Access denied'});
   }
   if(registration.status!=='confirmed'){await client.query('ROLLBACK');return res.status(409).json({error:'Confirmed registration required'});}
   const {rows:[resource]}=await client.query('SELECT * FROM '+table+' WHERE id=$1 AND event_id=$2 FOR UPDATE',[id,registration.event_id]);
   if(!resource){await client.query('ROLLBACK');return res.status(404).json({error:'Resource not found'});}
   if(resource.registration_type_id&&resource.registration_type_id!==registration.registration_type_id){await client.query('ROLLBACK');return res.status(403).json({error:'Not eligible for this registration type'});}
   const {rows:[count]}=await client.query('SELECT count(*)::int AS n FROM '+join+' x JOIN registrations r ON r.id=x.registration_id WHERE x.'+foreign+'=$1 AND r.status=$2',[id,'confirmed']);
   if(count.n>=resource.capacity){await client.query('ROLLBACK');return res.status(409).json({error:'Capacity reached'});}
   const inserted=await client.query('INSERT INTO '+join+'(registration_id,'+foreign+') VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING registration_id',[registration.id,id]);
   if(!inserted.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Already enrolled'});}
   await client.query('INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',[req.user.id,'enroll_'+kind,'registration',registration.id]);
   await client.query('COMMIT');
   res.status(201).json({enrolled:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 });
 app.post('/api/registrations/:id/sessions',auth,enroll('session'));
 app.post('/api/registrations/:id/admissions',auth,enroll('admission'));
 app.patch('/api/registrations/:id/details',auth,asyncRoute(async(req,res)=>{
  if(!validName(req.body?.attendee_name))return reject(res);
  const {rows:[record]}=await query('SELECT * FROM registrations WHERE id=$1',[req.params.id]);
  if(!record)return res.status(404).json({error:'Registration not found'});
  if(!canReadRegistration(req.user,record)){
   await security(req.user.id,'object_access_denied','high','registration-api','Blocked cross-account update');
   return res.status(403).json({error:'Access denied'});
  }
  const {rows}=await query('UPDATE registrations SET attendee_name=$1 WHERE id=$2 RETURNING id,attendee_name,status',[req.body.attendee_name.trim(),req.params.id]);
  await writeAudit(req.user.id,'update_attendee','registration',req.params.id);
  res.json({registration:rows[0]});
 }));
 app.post('/api/events/:id/suppression',auth,allow(manage),asyncRoute(async(req,res)=>{
  if(!isEmail(req.body?.email))return reject(res,'Valid email required');
  await query('INSERT INTO event_suppression(event_id,email_fingerprint) VALUES($1,$2) ON CONFLICT DO NOTHING',[eventParam(req),fingerprint(req.body.email)]);
  await writeAudit(req.user.id,'suppress_audience','event',eventParam(req));
  res.status(201).json({suppressed:true});
 }));
 app.post('/api/events/:id/import',auth,allow(manage),asyncRoute(async(req,res)=>{
  const csv=req.body?.csv;
  if(typeof csv!=='string'||csv.length>200000)return reject(res,'CSV must be under 200KB');
  let rows;
  try{rows=parse(csv,{columns:true,skip_empty_lines:true,bom:true,trim:true,max_record_size:3000});}
  catch{return reject(res,'Invalid CSV format');}
  if(!Array.isArray(rows)||rows.length<1||rows.length>500)return reject(res,'Upload 1 to 500 attendees at a time');
  if(rows.some(r=>!validName(r.name)||!isEmail(r.email)))return reject(res,'CSV requires valid name,email columns');
  const normalized=rows.map(r=>({name:r.name.trim(),email:r.email.trim().toLowerCase()}));
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[eventParam(req)]);
   let imported=0,duplicates=0;
   for(const row of normalized){
    const existing=await client.query('SELECT 1 FROM registrations WHERE event_id=$1 AND lower(email)=$2 AND status<>$3',[eventParam(req),row.email,'cancelled']);
    if(existing.rowCount){duplicates++;continue;}
    const inserted=await client.query('INSERT INTO imported_attendees(event_id,name,email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[eventParam(req),row.name,row.email]);
    if(inserted.rowCount)imported++;else duplicates++;
   }
   await client.query('INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES($1,$2,$3,$4)',[req.user.id,'import_csv','event',eventParam(req)]);
   await client.query('COMMIT');
   res.status(201).json({imported,duplicates,rejected:0,mode:'staged_for_reconciliation'});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }));
 app.get('/api/events/:id/audience',auth,allow(manage),asyncRoute(async(req,res)=>{
  const id=eventParam(req),status=['confirmed','waitlisted','cancelled'].includes(req.query.status)?req.query.status:null;
  const [groups,imports,suppressed,roster]=await Promise.all([
   query('SELECT coalesce(t.name,$2) registration_type,r.status,count(*)::int total FROM registrations r LEFT JOIN registration_types t ON t.id=r.registration_type_id WHERE r.event_id=$1 GROUP BY t.name,r.status ORDER BY r.status',[id,'General']),
   query('SELECT id,name,email,status,created_at FROM imported_attendees WHERE event_id=$1 ORDER BY created_at DESC LIMIT 500',[id]),
   query('SELECT count(*)::int AS n FROM event_suppression WHERE event_id=$1',[id]),
   query('SELECT id,attendee_name,email,status,registration_type_id FROM registrations WHERE event_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 500',[id,status])
  ]);
  res.json({segments:groups.rows,staged:imports.rows,suppressed:suppressed.rows[0].n,registrations:roster.rows});
 }));
 app.post('/api/events/:id/templates',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {kind,subject,body}=req.body||{};
  if(!['confirmation','cancellation','waitlist'].includes(kind)||typeof subject!=='string'||subject.length<3||subject.length>160||typeof body!=='string'||body.length<5||body.length>2000)return reject(res);
  await query('INSERT INTO event_templates(event_id,kind,subject,body) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,kind) DO UPDATE SET subject=excluded.subject,body=excluded.body',[eventParam(req),kind,subject,body]);
  await writeAudit(req.user.id,'update_template','event',eventParam(req));
  res.json({saved:true});
 }));
 app.get('/api/events/:id/email-preview',auth,allow(manage),asyncRoute(async(req,res)=>{
  const kind=['confirmation','cancellation','waitlist'].includes(req.query.kind)?req.query.kind:'confirmation';
  const {rows:[event]}=await query('SELECT title FROM events WHERE id=$1',[eventParam(req)]);
  if(!event)return res.status(404).json({error:'Event not found'});
  const {rows:[template]}=await query('SELECT subject,body FROM event_templates WHERE event_id=$1 AND kind=$2',[eventParam(req),kind]);
  const vars={name:'Synthetic Attendee',event:event.title,status:kind==='waitlist'?'waitlisted':kind==='cancellation'?'cancelled':'confirmed'};
  const render=t=>t.replace(/\{\{(name|event|status)\}\}/g,(_,key)=>vars[key]);
  res.json({kind,subject:render(template?.subject||'{{event}} registration {{status}}'),body:render(template?.body||'Hello {{name}}, your registration for {{event}} is {{status}}.'),delivery:'preview_only'});
 }));
 app.patch('/api/security/:id/status',auth,allow(manage),asyncRoute(async(req,res)=>{
  const status=req.body?.status;
  if(!['open','investigating','resolved','false_positive'].includes(status))return reject(res,'Invalid status');
  const {rows}=await query('UPDATE security_events SET status=$1 WHERE id=$2 RETURNING id,event_type,status',[status,req.params.id]);
  if(!rows.length)return res.status(404).json({error:'Security event not found'});
  await writeAudit(req.user.id,'triage_security','security_event',req.params.id);
  res.json({event:rows[0]});
 }));
 app.post('/api/incidents/:id/events',auth,allow(manage),asyncRoute(async(req,res)=>{
  const securityId=req.body?.security_event_id;
  if(typeof securityId!=='string')return reject(res);
  const {rows}=await query('INSERT INTO incident_events(incident_id,security_event_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING incident_id',[req.params.id,securityId]);
  if(!rows.length)return res.status(409).json({error:'Already linked'});
  await writeAudit(req.user.id,'link_incident','incident',req.params.id);
  res.status(201).json({linked:true});
 }));
 app.get('/api/incidents/:id/timeline',auth,allow(manage),asyncRoute(async(req,res)=>{
  const {rows}=await query('SELECT s.id,s.event_type,s.severity,s.created_at,s.details FROM incident_events x JOIN security_events s ON s.id=x.security_event_id WHERE x.incident_id=$1 ORDER BY s.created_at',[req.params.id]);
  res.json({timeline:rows});
 }));
}
