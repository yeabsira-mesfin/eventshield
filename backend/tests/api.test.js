import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.js';
import { pool, query } from '../db.js';

test('protected event creation and cross-attendee access generate security alerts', {skip: !process.env.TEST_INTEGRATION}, async () => {
  const server = app.listen(0);
  const url = 'http://127.0.0.1:' + server.address().port;
  async function call(path, token, method='GET', body) {
    const response = await fetch(url + '/api' + path,{
      method,
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    return {status:response.status,data:await response.json()};
  }
  try {
    const password=process.env.DEMO_PASSWORD;
    async function login(email){
      const r=await call('/auth/login',null,'POST',{email,password});
      assert.equal(r.status,200);
      return r.data.token;
    }
    const admin=await login('admin@eventshield.test');
    const attendee=await login('attendee@eventshield.test');
    const guest=await login('guest@eventshield.test');
    const forbidden=await call('/events',attendee,'POST',{title:'Denied event',venue:'Online',capacity:5,starts_at:'2027-05-01T12:00:00Z'});
    assert.equal(forbidden.status,403);
    const created=await call('/events',admin,'POST',{title:'Integration test '+Date.now(),venue:'Online',capacity:1,starts_at:'2027-05-01T12:00:00Z'});
    assert.equal(created.status,201);
    const id=created.data.event.id;
    assert.equal((await call('/events/'+id,admin,'PATCH',{status:'published'})).status,200);
    const first=await call('/events/'+id+'/registrations',guest,'POST',{attendee_name:'Synthetic Guest'});
    assert.equal(first.status,201);
    assert.equal(first.data.registration.status,'confirmed');
    const second=await call('/events/'+id+'/registrations',attendee,'POST',{attendee_name:'Synthetic Attendee'});
    assert.equal(second.status,201);
    assert.equal(second.data.registration.status,'waitlisted');
    const victimId=first.data.registration.id;
    assert.equal((await call('/registrations/'+victimId,attendee)).status,403);
    assert.equal((await call('/registrations/'+victimId,guest)).status,200);
    const cancelled=await call('/registrations/'+victimId+'/cancel',guest,'PATCH');
    assert.equal(cancelled.status,200);
    assert.equal(cancelled.data.registration.status,'cancelled');
    assert.equal(cancelled.data.promoted,true);
    const promoted=await call('/registrations/'+second.data.registration.id,attendee);
    assert.equal(promoted.status,200);
    assert.equal(promoted.data.registration.status,'confirmed');
    const cancelledAgain=await call('/registrations/'+victimId+'/cancel',guest,'PATCH');
    assert.equal(cancelledAgain.status,409);
    const logged=await query("SELECT count(*)::int AS n FROM security_events WHERE event_type='object_access_denied'");
    assert.ok(logged.rows[0].n >= 1);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
});
