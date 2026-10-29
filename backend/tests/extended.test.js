import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../server.js';

test('advanced event workflows enforce eligibility, questions, capacity and imports',{skip:!process.env.TEST_INTEGRATION},async()=>{
 const server=app.listen(0);
 const base='http://127.0.0.1:'+server.address().port+'/api';
 async function call(path,token,method='GET',body){
  const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 }
 try{
  async function login(email){
   const a=await call('/auth/login',null,'POST',{email,password:process.env.DEMO_PASSWORD});
   assert.equal(a.status,200);return a.data.token;
  }
  const admin=await login('admin@eventshield.test');
  const attendee=await login('attendee@eventshield.test');
  const guest=await login('guest@eventshield.test');
  const title='Advanced integration '+Date.now();
  const made=await call('/events',admin,'POST',{title,description:'Synthetic enterprise registration QA',venue:'Online',starts_at:'2027-06-03T12:00:00Z',capacity:2});
  assert.equal(made.status,201);
  const id=made.data.event.id;
  assert.equal((await call('/events/'+id,admin,'PATCH',{status:'published'})).status,200);
  assert.equal((await call('/events/'+id+'/questions',attendee,'POST',{label:'Dietary needs',required:true})).status,403);
  const pathType=await call('/events/'+id+'/types',admin,'POST',{name:'Speaker'});
  assert.equal(pathType.status,201);
  const typeId=pathType.data.type.id;
  assert.equal((await call('/events/'+id+'/types/'+typeId,admin,'PATCH',{email_domain:'example.test'})).status,200);
  const question=await call('/events/'+id+'/questions',admin,'POST',{label:'Accessibility requests',required:true,registration_type_id:typeId});
  assert.equal(question.status,201);
  const questionId=question.data.question.id;
  const blocked=await call('/events/'+id+'/registrations',attendee,'POST',{attendee_name:'Synthetic Attendee',registration_type_id:typeId});
  assert.equal(blocked.status,403);
  assert.equal((await call('/events/'+id+'/types/'+typeId,admin,'PATCH',{email_domain:'eventshield.test'})).status,200);
  const missing=await call('/events/'+id+'/registrations',attendee,'POST',{attendee_name:'Synthetic Attendee',registration_type_id:typeId});
  assert.equal(missing.status,403);
  const registered=await call('/events/'+id+'/registrations',attendee,'POST',{attendee_name:'Synthetic Attendee',registration_type_id:typeId,answers:{[questionId]:'None'}});
  assert.equal(registered.status,201);
  const regId=registered.data.registration.id;
  const config=await call('/events/'+id+'/configuration',attendee);
  assert.equal(config.status,200);
  assert.equal(config.data.questions.length,1);
  const session=await call('/events/'+id+'/sessions',admin,'POST',{title:'Security workshop',capacity:1,registration_type_id:typeId});
  assert.equal(session.status,201);
  const admission=await call('/events/'+id+'/admissions',admin,'POST',{title:'Workshop admission',capacity:1,price_cents:0,registration_type_id:typeId});
  assert.equal(admission.status,201);
  const sid=session.data.session.id,aid=admission.data.admission.id;
  assert.equal((await call('/registrations/'+regId+'/sessions',attendee,'POST',{session_id:sid})).status,201);
  assert.equal((await call('/registrations/'+regId+'/admissions',attendee,'POST',{admission_id:aid})).status,201);
  assert.equal((await call('/registrations/'+regId+'/sessions',attendee,'POST',{session_id:sid})).status,409);
  const second=await call('/events/'+id+'/registrations',guest,'POST',{attendee_name:'Synthetic Guest',registration_type_id:typeId,answers:{[questionId]:'None'}});
  assert.equal(second.status,201);
  assert.equal((await call('/registrations/'+second.data.registration.id+'/sessions',guest,'POST',{session_id:sid})).status,409);
  assert.equal((await call('/registrations/'+second.data.registration.id+'/admissions',guest,'POST',{admission_id:aid})).status,409);
  assert.equal((await call('/events/'+id+'/details',admin,'PATCH',{title,venue:'Online',starts_at:'2027-06-03T12:00:00Z',capacity:1})).status,409);
  assert.equal((await call('/registrations/'+regId+'/details',guest,'PATCH',{attendee_name:'Unauthorized'})).status,403);
  assert.equal((await call('/registrations/'+regId+'/details',attendee,'PATCH',{attendee_name:'Updated Attendee'})).status,200);
  assert.equal((await call('/events/'+id+'/suppression',admin,'POST',{email:'blocked@example.test'})).status,201);
  const csv='name,email\nSynthetic Imported,imported@example.test\nSynthetic Imported Again,imported@example.test\nExisting Registration,attendee@eventshield.test\n';
  const imported=await call('/events/'+id+'/import',admin,'POST',{csv});
  assert.equal(imported.status,201);
  assert.equal(imported.data.imported,1);
  assert.equal(imported.data.duplicates,2);
  const audience=await call('/events/'+id+'/audience',admin);
  assert.equal(audience.status,200);
  assert.equal(audience.data.staged.length,1);
  assert.equal(audience.data.suppressed,1);
  assert.equal(audience.data.registrations.length,2);
  const stagedId=audience.data.staged[0].id;
  const notMatched=await call('/events/'+id+'/imports/'+stagedId,admin,'PATCH',{action:'reconcile',registration_id:regId});
  assert.equal(notMatched.status,409);
  const excluded=await call('/events/'+id+'/imports/'+stagedId,admin,'PATCH',{action:'exclude'});
  assert.equal(excluded.status,200);
  assert.equal(excluded.data.imported_attendee.status,'excluded');

  assert.equal((await call('/events/'+id+'/audience',attendee)).status,403);
  const tmpl=await call('/events/'+id+'/templates',admin,'POST',{kind:'confirmation',subject:'{{event}} confirmed',body:'Hello {{name}}! {{status}}'});
  assert.equal(tmpl.status,200);
  const preview=await call('/events/'+id+'/email-preview?kind=confirmation',admin);
  assert.equal(preview.status,200);
  assert.match(preview.data.body,/Synthetic Attendee/);
  assert.equal(preview.data.delivery,'preview_only');
  const denied=await call('/registrations/'+regId,guest);
  assert.equal(denied.status,403);
  const signals=await call('/security',admin);
  const related=signals.data.events.find(x=>x.event_type==='object_access_denied');
  assert.ok(related);
  assert.equal((await call('/security/'+related.id+'/status',admin,'PATCH',{status:'investigating'})).status,200);
  const incident=await call('/incidents',admin,'POST',{title:'Investigate synthetic record access'});
  assert.equal(incident.status,201);
  const incidentId=incident.data.incident.id;
  assert.equal((await call('/incidents/'+incidentId+'/events',admin,'POST',{security_event_id:related.id})).status,201);
  const timeline=await call('/incidents/'+incidentId+'/timeline',admin);
  assert.equal(timeline.status,200);
  assert.ok(timeline.data.timeline.length>=1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
