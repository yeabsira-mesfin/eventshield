import test from 'node:test';
import assert from 'node:assert/strict';
import { manage, staff, canReadRegistration, validEvent, csvCell } from '../policy.js';

test('attendees cannot read other attendees records', () => {
  assert.equal(canReadRegistration({id:'a',role:'Attendee'}, {user_id:'b'}),false);
  assert.equal(canReadRegistration({id:'a',role:'Attendee'}, {user_id:'a'}),true);
  assert.equal(canReadRegistration({id:'m',role:'Event Manager'}, {user_id:'b'}),true);
});
test('staff cannot export or create events', () => {
  assert.equal(staff('Staff'),true);
  assert.equal(manage('Staff'),false);
  assert.equal(manage('Admin'),true);
});
test('event validation rejects invalid capacities and dates', () => {
  const ok={title:'Security Summit',venue:'Online',starts_at:'2027-03-01T13:00:00Z',capacity:25};
  assert.equal(validEvent(ok),true);
  assert.equal(validEvent({...ok,capacity:-1}),false);
  assert.equal(validEvent({...ok,starts_at:'invalid'}),false);
});
test('CSV escaping prevents spreadsheet formula injection', () => {
  assert.equal(csvCell('=1+1'),'"\'=1+1"');
  assert.equal(csvCell('Hello "world"'),'"Hello ""world"""');
});
