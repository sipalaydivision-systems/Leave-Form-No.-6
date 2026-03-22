# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CS Form No. 6 — Leave Management System for DepEd Schools Division of Sipalay City. Handles leave applications, multi-level approval workflows, leave credit accrual, and official form generation for ~6 user roles (Employee, AO, HR, ASDS, SDS, IT).

## Commands

```bash
npm start          # Start server on :3000 (also: npm run dev)
node server.js     # Direct entry point
```

No build step, no bundler, no test framework. Frontend is vanilla JS served as static files.

## Architecture

### Dual Entry Points (Legacy + Modular)

The codebase is mid-refactor. Both paths coexist and handle overlapping routes:

- **`server.js`** (~7,400 lines) — Legacy monolith. Still the primary entry point. Contains all routes, middleware, helpers, and business logic inline.
- **`src/app.js`** — Modular Express factory. Assembles routes from `src/routes/*.js`, middleware from `src/middleware/`, and business logic from `src/services/`. Mounted by `server.js`.

When adding new endpoints, add them to the appropriate `src/routes/` module. The legacy `server.js` routes take precedence if paths conflict.

### Route Modules (`src/routes/`)

| Module | Scope |
|---|---|
| `auth.js` | Login (all 6 portals), logout, session validation, page routes |
| `employee.js` | Registration, profile, `/api/me` |
| `leave.js` | Submit leave, resubmit, approve/return/reject |
| `leave-credits.js` | Leave card CRUD, balance queries, credits update, transaction history |
| `it.js` | Registration approval, user management, data management, backups |
| `activity-logs.js` | Activity log queries |
| `system.js` | System state, version, health |

### Services (`src/services/`)

| Service | Purpose |
|---|---|
| `leave-balance.js` | `validateLeaveBalance()`, `calculateEffectiveBalance()`, `normalizeLeaveCardTransactions()` |
| `leave-approval.js` | `updateEmployeeLeaveBalance()`, `updateLeaveCardWithUsage()` — balance deduction on final SDS approval |
| `accrual.js` | Monthly 1.25 VL + 1.25 SL accrual engine, catch-up for new cards |
| `email.js` | MailerSend integration for approval notifications |
| `session.js` | Session CRUD, cleanup, persistence |
| `workflow-engine.js` | Approval state machine |

### Data Layer

**Primary storage:** JSON flat files in `data/` directory (or `$RAILWAY_VOLUME_MOUNT_PATH/data/` in production).

**PostgreSQL support:** Optional via `DATABASE_URL` env var. The repository pattern in `src/data/repositories/` checks `isDbConnected()` at runtime — JSON mode uses spread operators for arbitrary fields, PG mode uses fixed columns.

Key data files: `users.json`, `employees.json`, `leavecards.json`, `applications.json`, `pending-registrations.json`, `{ao,hr,asds,sds,it}-users.json`, `cto-records.json`, `activity-logs.json`, `sessions.json`, `system-state.json`.

Read/write via `readJSON()`/`writeJSON()` helpers (atomic single-file writes, no transactions).

### Frontend

Vanilla HTML + JS + CSS. No framework, no build step.

- **Design system:** `public/css/design-tokens.css` (CSS custom properties), `components.css`, `dashboard-layout.css`, `charts.css`
- **Component library:** `public/components/` — sidebar, toast, modal, table, tabs, chart-wrapper, empty-state (ES modules)
- **Dashboard pages:** Slim HTML shells (~150 lines) + separate JS modules in `public/js/` (e.g., `dashboard-employee.js`, `leave-application.js`)
- **Legacy pages:** Monolithic HTML files with inline CSS/JS (e.g., `leave_form.html` at 3,015 lines)

### Authentication

- HttpOnly cookie with 96-char hex session token (8-hour expiry)
- In-memory `activeSessions` Map, persisted to `sessions.json` every 15 minutes
- Middleware: `requireAuth(...allowedRoles)` — validates cookie, sets `req.session`
- Frontend: `auth-interceptor.js` adds Bearer token header, redirects on 401
- Passwords: bcrypt (12 rounds) with legacy SHA-256 migration via `rehashIfNeeded()`

## Key Domain Concepts

### Leave Types and Balance Rules

- **VL/SL:** Monthly accrual (1.25 days each). Tracked as `vacationLeaveEarned`/`sickLeaveEarned` minus spent.
- **Force Leave (MFL):** 5 days/year, max 4 consecutive days per application, charges against VL balance.
- **Special Privilege (SPL):** 3 days/year. Resets yearly via `splYear` field.
- **Wellness Leave (WL):** 3 days/year. Resets yearly via `wellnessYear` field. Type codes: `leave_wl`, `leave_wellness`, `wellness`.
- **CTO:** Tracked separately in `cto-records.json`. Filed under `leave_others`.
- **Others:** Requires `otherLeaveSpecify` text + SO PDF upload (`soFileData` base64).

### Approval Workflow

All leave applications follow: **Employee → AO → HR → ASDS → SDS**. No step is skipped. Each approver can approve, return (with reason), or reject. Final SDS approval triggers balance deduction via `updateEmployeeLeaveBalance()`.

### Submit Payload

`POST /api/submit-leave` expects a specific `applicationData` shape. When modifying the leave form, the payload must include: `employeeEmail`, `employeeName`, `office`, `position`, `salary`, `dateOfFiling`, `leaveType` (e.g., `leave_vl`), `dateFrom`, `dateTo`, `numDays`, `vlEarned`, `slEarned`, `commutation`, `employeeSignature` (base64 PNG), and conditional fields (`locationPH`, `sickHospital`, `studyMasters`, `womenIllness`, `otherLeaveSpecify`, `soFileData`).

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default 3000) | Server port |
| `DATABASE_URL` | No | PostgreSQL connection string (enables PG mode) |
| `MAILERSEND_API_KEY` | No | Email notifications |
| `MAILERSEND_SENDER_EMAIL` | No | Email sender address |
| `PRODUCTION_DOMAIN` | No | CORS origin whitelist in production |
| `RAILWAY_VOLUME_MOUNT_PATH` | No | Persistent data volume (Railway deployment) |
| `IT_BOOTSTRAP_KEY` | No | IT admin bootstrap token |

## API Conventions

- Response shape: `{ success: true/false, ...data }` or `{ success: false, error: "message" }`
- Auth: HttpOnly cookie `session_token` (set on login, validated by middleware)
- Rate limits: 10 logins/15min, 100 API calls/min per IP
- Body limit: 15MB (for base64 signatures and PDF uploads)

## Important References

- `BACKEND_ARCHITECTURE.md` — Comprehensive system design with Mermaid diagrams, all API endpoints with line numbers, data schemas, helper function reference, middleware stack, and security mechanisms.
