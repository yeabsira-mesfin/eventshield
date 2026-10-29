CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin','Event Manager','Staff','Attendee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT 'Online',
  starts_at TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS registration_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(event_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  registration_type_id UUID REFERENCES registration_types(id) ON DELETE SET NULL,
  capacity INT NOT NULL DEFAULT 100 CHECK (capacity > 0)
);
CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  user_id UUID NOT NULL REFERENCES users(id),
  attendee_name TEXT NOT NULL,
  email TEXT NOT NULL,
  registration_type_id UUID REFERENCES registration_types(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','waitlisted','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reg_event_status ON registrations(event_id, status);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Event operations extensions. Idempotent migration for existing local databases.
ALTER TABLE registration_types ADD COLUMN IF NOT EXISTS email_domain TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS registration_questions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 required BOOLEAN NOT NULL DEFAULT false,
 registration_type_id UUID REFERENCES registration_types(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS registration_answers(
 registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
 question_id UUID NOT NULL REFERENCES registration_questions(id) ON DELETE CASCADE,
 answer TEXT NOT NULL,
 PRIMARY KEY(registration_id,question_id)
);
CREATE TABLE IF NOT EXISTS event_suppression(
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 email_fingerprint TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,email_fingerprint)
);
CREATE TABLE IF NOT EXISTS admission_items(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 registration_type_id UUID REFERENCES registration_types(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 capacity INT NOT NULL CHECK(capacity>0),
 price_cents INT NOT NULL DEFAULT 0 CHECK(price_cents>=0)
);
CREATE TABLE IF NOT EXISTS registration_admissions(
 registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
 admission_id UUID NOT NULL REFERENCES admission_items(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(registration_id,admission_id)
);
CREATE TABLE IF NOT EXISTS session_signups(
 registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
 session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(registration_id,session_id)
);
CREATE TABLE IF NOT EXISTS imported_attendees(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','reconciled','excluded')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(event_id,email)
);
CREATE TABLE IF NOT EXISTS event_templates(
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('confirmation','cancellation','waitlist')),
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 PRIMARY KEY(event_id,kind)
);
CREATE TABLE IF NOT EXISTS incident_events(
 incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
 security_event_id UUID NOT NULL REFERENCES security_events(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(incident_id,security_event_id)
);

ALTER TABLE imported_attendees ADD COLUMN IF NOT EXISTS registration_id UUID REFERENCES registrations(id);
