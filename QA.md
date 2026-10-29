# EventShield quality assurance

## Automated verification

Backend: cd backend && npm test (PostgreSQL integration tests require TEST_INTEGRATION=1 and seeded data). Browser: npm run test:e2e.

The CI workflow runs browser tests using actual Chromium, captures desktop and mobile screenshots, and uploads traces/screenshots as GitHub Actions artifacts. Axe-core audits WCAG 2.0/2.1 A/AA serious and critical findings. The workflow also validates and builds the local Docker Compose images.

Covered end-to-end: Registration workflow, RBAC and blocked record access, waitlist promotion, conditional domain eligibility, required questions, session/admission capacity, CSV staging and exclusion, suppression, email preview and incident links.

### Local containers

Copy docker.env.example to .env, replace all placeholders, then run docker compose up --build. Visit http://127.0.0.1:8080.

### Browser regression command

npm run test:e2e

### Review before merge

- Confirm the latest GitHub Actions run is green, including browser tests, accessibility and Compose build.
- Review the Playwright HTML report and saved desktop/mobile screenshots for clipping and contrast.
- Test keyboard navigation and screen-reader announcements manually. Automated axe does not replace human accessibility testing.
- Exercise invalid inputs, role boundaries, duplicate records, capacity races, stale sessions, and network errors.
- Check the work from a clean clone and verify no tokens, real attendee data or payment cards are committed.
- Run a qualified security assessment before considering any production deployment.

## Boundaries and known limitations

No real email delivery, no live payment processing, no production multi-tenant isolation, no completed penetration test. Attendee CSV imports are staged for reconciliation, not automatically registered.

**Status:** An actively developed review-branch portfolio demonstration, not production certified. Automated checks are evidence of specific tested behaviors only, not proof of comprehensive security or browser compatibility.
