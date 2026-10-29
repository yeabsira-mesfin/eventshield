# EventShield

A secure enterprise event operations portfolio project developed from the original React + Express PlacePicker application.

This feature branch preserves the existing Git history and legacy application components while adding an event registration and security monitoring MVP. It is intended for synthetic demo use, not production attendee data.

## Functionality delivered

- React operations dashboard with events, registration, personal attendance history, Security Center, investigation cases and audit reports
- Password login with bcrypt hashing, JWT expiration, and login rate limiting
- PostgreSQL persistence with SQL migrations and a deterministic synthetic seed
- Admin, Event Manager, Staff and Attendee roles with server-enforced authorization
- Event draft creation, editing, publishing, archiving, domain-restricted registration types, required/conditional questions, admission items, sessions and registration
- Atomic capacity enforcement using PostgreSQL row locks, waitlists, cancellation, and automatic promotion of the oldest waitlisted attendee
- Object-level access checks that reject an attendee reading or cancelling another attendee's record
- Security monitoring for successful/failed logins, repeated failures, API rate limits, blocked record reads and sensitive CSV exports
- Audit logs, incident creation/resolution, CSV exports with formula-injection protection
- Backend policy tests and PostgreSQL-backed API integration tests in GitHub Actions

## Local setup

Prerequisites: Node.js 22 or newer, npm, and PostgreSQL 16 or newer.

1. Create an empty PostgreSQL database and an application user with rights to create tables.
2. In the backend directory copy .env.example to .env.
3. Set DATABASE_URL, a random JWT_SECRET with 32+ characters, and DEMO_PASSWORD with 12+ characters. Never commit the local environment file.
4. In the backend directory run: npm install
5. Still in backend run: npm run migrate
6. Still in backend run: npm run seed
7. Still in backend run: npm run dev
8. In a separate terminal, in the repo root run: npm install && npm run dev
9. Open the local address shown by Vite. The Vite server proxies /api to localhost:3000.

Synthetic accounts: admin@eventshield.test, manager@eventshield.test, attendee@eventshield.test, guest@eventshield.test. Each uses the DEMO_PASSWORD you set. All attendees and events are synthetic. This app never sends live email.

## Security demonstration: block broken object-level authorization

1. Sign in as guest@eventshield.test and register for the sample event.
2. Retrieve its registration ID via GET /api/registrations/mine with the guest JWT.
3. Sign in as attendee@eventshield.test.
4. Request GET /api/registrations/{guest-registration-ID} using the attendee JWT.
5. Expect HTTP 403. Review the object_access_denied event in the Admin Security Center.

A successful exploit is not part of this demo. Only owned local test data is used.

## Routes

| Method and route | Access |
| --- | --- |
| POST /api/auth/login | Public, rate limited |
| GET /api/events | Signed-in users |
| POST /api/events | Admin or Event Manager |
| PATCH /api/events/:id | Admin or Event Manager |
| GET /api/events/:id/config | Signed-in users |
| POST /api/events/:id/types | Admin or Event Manager |
| POST /api/events/:id/registrations | Signed-in users |
| GET /api/registrations/mine | Signed-in user |
| GET /api/registrations/:id | Owner or staff |
| PATCH /api/registrations/:id/cancel | Owner or staff |
| GET /api/events/:id/registrations | Staff, Manager or Admin |
| GET /api/events/:id/export | Manager or Admin, audited |
| GET /api/dashboard | Staff, Manager or Admin |
| GET /api/security | Manager or Admin |
| POST /api/incidents | Manager or Admin |
| PATCH /api/incidents/:id | Manager or Admin |

## Tests and quality

- Frontend build: run npm run build at the root.
- Backend policy tests: cd backend && npm test.
- Integration tests require PostgreSQL, migrated synthetic seed data, NODE_ENV=test and TEST_INTEGRATION=1.
- CI builds the frontend and starts a disposable PostgreSQL 16 database; tests authentication, object access denial, seat capacity, and waitlisting.
- Backend dependency audit is run in CI.

## Architecture and threat model

The React client is untrusted. Express authenticates callers and checks role and registration ownership before accessing records. Database access uses parameterized queries. The registration transaction locks the event row to serialize concurrent capacity checks. Sensitive user data is intentionally omitted from security signal details; event exports are separately logged. Passwords are bcrypt hashes, never logged as plaintext.

Threats considered include brute-force login, broken function-level authorization, IDOR/BOLA, SQL injection, CSV formula injection, and untracked exports. This MVP does not claim compliance certification or production penetration testing.

## Remaining development

Custom questions, type-specific visibility, email-domain registration paths, session/admission enrollment, suppression, CSV staging, duplicate checks and text-only email previews are implemented. Live email delivery, multi-tenant isolation, complete invitation workflows, advanced question branching, and production deployment remain out of scope.

## Portfolio summary

Designed an event technology MVP using React, Express, PostgreSQL, server-side RBAC, auditable registration workflows, safe attendee CSV export, and security alerts for blocked cross-account record access.

## Extended event technology capabilities

The event setup workspace includes registration paths restricted by email domain, required questions shown by registration type, admission and session inventory, audience segmentation, suppression fingerprints, CSV import staging with duplicate checks and audited exclusion/reconciliation, and confirmation/waitlist/cancellation email previews. Messages are never delivered to real addresses. Incident cases can be linked to security signals for timelines.

## Reproducible Docker demo and QA

Copy `docker.env.example` to `.env`, replace the placeholders with locally generated secrets, then run `docker compose up --build`. Visit http://127.0.0.1:8080. Docker is bound to the local loopback interface, and the Postgres database is not exposed on a host port.

CI runs PostgreSQL-backed integration tests, Chromium user journeys on desktop and mobile, axe-core WCAG checks, dependency scans, Compose validation and image builds. See [QA.md](QA.md) for the exact regression process and limitations.
