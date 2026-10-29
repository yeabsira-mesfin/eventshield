export const ROLES = ['Admin', 'Event Manager', 'Staff', 'Attendee'];
export const manage = role => role === 'Admin' || role === 'Event Manager';
export const staff = role => manage(role) || role === 'Staff';
export const canReadRegistration = (actor, registration) =>
  staff(actor.role) || (actor.role === 'Attendee' && String(actor.id) === String(registration.user_id));
export const validEvent = input =>
  typeof input?.title === 'string' && input.title.trim().length >= 4 &&
  input.title.length <= 150 && typeof input?.venue === 'string' &&
  input.venue.length <= 150 && Number.isInteger(Number(input.capacity)) &&
  Number(input.capacity) > 0 && Number(input.capacity) <= 100000 &&
  !Number.isNaN(Date.parse(input.starts_at));
export const csvCell = value => {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
  return '"' + safe.replaceAll('"', '""') + '"';
};
