# SESSION LOG — DepEd Leave Management System

> **Purpose**: Persistent record of all development accomplishments across sessions.  
> **Rule**: Consult this file at the start of every new prompt/session to understand system state.  
> **Repository**: `https://github.com/sudoer24/Leave-Form-No.-6` (branch: `main`)  
> **Hosting**: Railway (auto-deploys from `main`)  
> **Stack**: Express.js + JSON flat files (no database)

---

## System Architecture (Current State)

- **server.js** (~6230 lines): Main Express.js backend, serves all portals, JSON file-based storage, bcrypt auth, session persistence, monthly accrual
- **Portals**: Employee (`dashboard.html`), AO (`ao-dashboard.html`), HR (`hr-approval.html`), ASDS (`asds-dashboard.html`), SDS (`sds-dashboard.html`), IT Admin (`it-dashboard.html`)
- **Data**: 16+ JSON files in `data/` directory, seeded from `data/defaults/`, persisted on Railway volume
- **Auth**: Session-based (Bearer tokens), 8-hour expiry, persisted to `sessions.json`. `auth-interceptor.js` auto-injects tokens + handles 401 redirect.
- **Git**: 81 tracked files. `.gitignore` excludes `data/*.json`, `node_modules/`, `*.py`, `*.xlsx`, etc.

---

## Session 1 — Server Restoration & Cleanup

**Date**: ~Feb 2026  
**Commits**: `3b224d4`

### Accomplished
1. **Server.js Restored**: Had been broken by failed PostgreSQL migration (dead `require('./db')` and `require('./r2')` references). Restored from `server-json-backup.js` (working JSON file-based version).
2. **Ported 5 Profile Update Endpoints**: Employee, AO, HR, ASDS, SDS profile update routes added back to server.js.
3. **Delete Backup Endpoint**: `DELETE /api/data/backup/:backupId` ported.
4. **CTO Filter Improvement**: `GET /api/cto-records` now filters by `r.employeeId === employeeId || r.email === employeeId`.
5. **Massive File Cleanup**: Removed ~3,863 files — old docs, OneDrive Excel files, migration scripts, untracked `node_modules/`. Down to 81 tracked files.
6. **Updated `.gitignore`**: Blocks `*.py`, `*.xlsx`, `*.zip`, `*.ps1`, `*.bat`, `*.sh`, `OneDrive_*/`, `node_modules/`, all `data/*.json` (except defaults).

### Known Issues at End
- `public/script.js` is dead code (no HTML page loads it)
- `auth.js` exists but no pages use it
- Forgot-password endpoints don't exist but some frontend pages reference them

---

## Session 2 — Data Consistency Audit & Bug Fix

**Date**: ~Feb 2026  
**Commits**: `97b4a03`

### Accomplished
1. **CTO & Leave Card Consistency Verified**: Audited that employee portal (`employee-leavecard.html`, `dashboard.html`) and AO portal (`ao-dashboard.html`) use the same API endpoints (`/api/leave-credits`, `/api/cto-records`) with email as identifier. Data is consistent across portals.
2. **Fixed `editLeaveCard()` ReferenceError**: In `ao-dashboard.html`, the `credits` variable was referenced before declaration. Moved declaration above usage. 
3. **Full Server Test**: Started server locally, all endpoints returning expected responses.

---

## Session 3 — Monthly Leave Credit Accrual

**Date**: ~Feb 2026  
**Commits**: `f6b322b`

### Accomplished
1. **Monthly 1.25 Accrual System Implemented**: Added `runMonthlyAccrual()` function to server.js (~lines 416-590).
   - Runs on startup (5-second delay) + every 24 hours via `setInterval`
   - Checks completed months since last accrual using `data/system-state.json`
   - Adds 1.25 to both VL earned and SL earned for every employee leave card
   - Creates visible `ADD` transaction entries (e.g., "ADD: January 2026 (Monthly Accrual)")
   - Prevents double-crediting by tracking `lastAccruedMonth` in system state
   - Logs activity to `activity-logs.json`
2. **Tested Locally**: VL went 50→51.25, SL went 50→51.25, transaction rows visible in leave card tables.
3. **Fixed Syntax Error**: Removed duplicate `});` that was causing a syntax error.

---

## Session 4 — Server Error Audit & Session Log Creation

**Date**: 2026-02-18  
**Commits**: (this session)

### Accomplished
1. **Full Server Error Audit**: 
   - `node -c server.js` — syntax check passed
   - Started server on port 3099, no crash or error output
   - Monthly accrual ran successfully on startup
   - **All GET endpoints tested OK**: `/`, `/api/all-employees`, `/api/leave-credits`, `/api/cto-records`, `/api/employee-leavecard`, `/api/leave-card`, `/api/my-applications/:email`, `/api/pending-applications/ao`, `/api/portal-applications/ao`, `/api/approved-applications/ao`, `/api/hr-approved-applications`, `/api/returned-applications/:email`, `/api/activity-logs`
   - **POST endpoints tested**: `/api/login` (401 for bad creds — correct), `/api/register` (400 for missing fields — correct)
   - **Server console**: Clean, no errors — only expected log output
   - **Conclusion**: No server errors found. Server is healthy.
2. **Added `data/system-state.json` to `.gitignore`**: Production state file should not be tracked in git (like other data files).
3. **Created `SESSION_LOG.md`**: This file — persistent record of all accomplishments, tracked in git, consulted at start of each session.

### Known Issues (Carried Forward)
- `/api/forgot-password`, `/api/verify-otp`, `/api/reset-password` return 404 (endpoints not implemented; some frontend pages reference them)
- ASDS & SDS dashboards have no auth guard on page load
- `auth.js` module exists but no pages use it
- `public/script.js` is dead code (no HTML loads it)

---

## Quick Reference

| Item | Detail |
|------|--------|
| **HEAD** | See latest `git log --oneline -1` |
| **Node.js** | v25.4.0 |
| **Port** | `process.env.PORT` or 3000 |
| **Data Dir** | `data/` (JSON files, not in git) |
| **Defaults** | `data/defaults/` (seed data, in git) |
| **Accrual State** | `data/system-state.json` (tracks `lastAccruedMonth`) |
| **Accrual Rate** | 1.25 days/month for both VL and SL |
| **Railway** | Auto-deploys from `origin/main` |

---

## Session 5 — Pending Registrations Cleanup & Leave Card Auto-Assignment

**Date**: 2026-02-18  
**Commits**: `4507f9f`

### Accomplished
1. **Removed All Temporary Registrations**: Cleared `data/pending-registrations.json`, resetting to empty array `[]`. Any registrations pending IT approval have been cleared.
2. **Removed Email Column from Employee Database UI**: Modified `public/ao-dashboard.html` `displayEmployeeResults()` function to remove the email address display column from the employee search results table in the AO dashboard. Email is still used internally for the "Edit Leave Cards" button but is no longer visible in the UI.
3. **Implemented Name-Based Leave Card Auto-Assignment**: Enhanced the employee registration approval flow in `server.js`:
   - When a new employee registers and is approved by IT, before creating a new leave card, the system now checks if an existing leave card exists with a matching employee name
   - If a match is found (case-insensitive, trimmed comparison), the existing leave card is automatically assigned to the new user by updating its `email` and `employeeId` fields
   - If no match is found, a new leave card is created as before
   - This feature eliminates manual assignment steps and ensures that pre-imported leave card data is automatically linked to newly registered employees with matching names
   - The search functionality (`searchEmployees()`) still searches by both name and email, but email is not displayed in results

### Technical Implementation Details
- **File**: `server.js` lines ~1675-1728 in `/api/approve-registration` endpoint
- **Logic**:
  ```javascript
  // Check if there's a leave card with matching name
  const normalizedRegName = (registration.fullName || registration.name || '').toLowerCase().trim();
  const matchingNameCard = leavecards.find(lc => {
      const cardName = (lc.name || lc.fullName || '').toLowerCase().trim();
      return cardName === normalizedRegName;
  });
  
  if (matchingNameCard) {
      // Assign existing card to new user
      matchingNameCard.email = registration.email;
      matchingNameCard.employeeId = registration.email;
      matchingNameCard.updatedAt = new Date().toISOString();
      await writeJSON(leavecardsFile, leavecards);
      console.log(`[REGISTRATION] Assigned existing leave card to ${registration.email} (matched by name: ${normalizedRegName})`);
  } else {
      // Create new leave card if no match
      // ... existing logic ...
  }
  ```

### Pushed to Production
- Commit `4507f9f` pushed to `origin/main`
- Railway will auto-deploy within ~10-30seconds

---

## Session 6 — SDO Sipalay Account Reset & Segregated Name Fields

**Date**: 2026-02-18  
**Commits**: `efa328f`

### Accomplished
1. **Cleared All User Accounts**: Deleted all existing accounts by resetting `data/users.json` to empty array `[]`. This allows SDO Sipalay employees to start fresh with new registrations.

2. **Segregated Name Fields in Registration Form**: Replaced the single "Full Name" field with individual fields:
   - **Last Name** (required) — e.g., "DELA CRUZ"
   - **First Name** (required) — e.g., "JUAN"
   - **Middle Name** (optional) — e.g., "SANTOS"
   - **Suffix** (optional dropdown) — Options: Jr., Sr., II, III, IV, V, or None
   - Form is now 2-column grid layout for better UX
   - Users don't need to manually format "LastName, FirstName MiddleName"

3. **Updated Registration Backend to Store Individual Fields**:
   - Modified `/api/register` endpoint in server.js to accept and validate `firstName` and `lastName` (required)
   - All four name fields (`firstName`, `lastName`, `middleName`, `suffix`) are now stored in pending registrations
   - When approved, these fields are stored in the user record

4. **Enhanced Leave Card Auto-Assignment with Suffix Support**:
   - Leave card matching now considers the complete name including suffix
   - When a leave card matches by name, the system updates it with individual name fields from the registration
   - If a user registers with suffix "Jr.", the leave card is updated with `suffix: "Jr."`
   - Leave card structure now includes: `firstName`, `lastName`, `middleName`, `suffix` (in addition to the full `name` field)
   - Prevents duplicate assignments and ensures suffix information is captured

### Technical Implementation
- **File**: `public/login.html` — registration form with segregated name inputs
- **File**: `server.js` — `/api/register` endpoint validates firstName/lastName, stores all four name fields
- **File**: `server.js` — leave card auto-assignment logic updated to store and match suffix
- **Form Layout**: 2x2 grid with lastName+firstName row and middleName+suffix row
- **Data Flow**: HTML form collects 4 fields → constructs fullName → sends all 4 fields + fullName to `/api/register`

### User Experience Improvements
- Clearer form by separating name components
- Automatic handling of name formatting (no manual "LastName, FirstName" format needed)
- Suffix properly captured and stored for leave card integrity
- When registering "Juan Dela Cruz Jr.", the form automatically generates "DELA CRUZ, JUAN  Jr." for the fullName field

### Deployed to Production
- Commit `efa328f` pushed to `origin/main`
- Railway will auto-deploy within ~10-30 seconds
- Users can now register fresh with segregated name fields and proper suffix support

---

## Session 7 — Railway Crash Fix, Bulk Delete & Multi-Portal Name Fields

**Date**: 2026-02-18  
**Commits**: `9cd8118`, `42dc394`, `3f5451d`

### Accomplished
1. **Fixed Railway Crash**: Server was crashing on Railway due to dead references. Restored flat-file server.js, added bulk delete endpoint, and updated registration with segregated name fields.
2. **Fixed Bulk Delete Endpoint**: The bulk delete API was only accepting `'users'` key from the frontend. Updated to also accept `'registrations'` key, fixing the IT dashboard bulk delete functionality.
3. **Segregated Name Fields Across ALL Portal Registration Forms**: Extended the first/last/middle/suffix name field pattern from the employee portal to all other portals (AO, HR, ASDS, SDS). All registration forms now collect individual name components instead of a single "Full Name" field.

---

## Session 8 — VL/SL Accrual-Only Policy & Excel Migration Tool

**Date**: 2026-02-18 to 2026-02-19  
**Commits**: `59f78d2`, `5c93413`, `24158d0`, `77898a9`

### Accomplished
1. **Removed Initial Leave Credits**: VL and SL now start at 0 for all new employees. Credits are earned exclusively through the monthly accrual system (1.25 VL + 1.25 SL per completed month). This enforces DepEd policy where leave is earned, not granted upfront.
2. **Added Excel Leave Card Migration Tool**: Built a complete migration endpoint (`POST /api/migrate-excel-leavecards`) with multer file upload support. Reads `.xlsx` leave card files from the old manual system and imports them into `leavecards.json`. Handles filename parsing, Excel cell extraction for VL/SL/FL/SPL balances, and teacher name matching.
3. **Fixed Special Characters in Excel Filenames**: The migration tool was failing on filenames with `ñ` and other special characters (e.g., "PEÑA"). Added proper encoding handling to parse Filipino names correctly from Excel filenames.
4. **Fixed Frontend VL/SL Fallbacks**: Removed `|| 100` fallback values in frontend JavaScript that were showing 100 VL/100 SL when no data was returned. Added `catchUpNewCards()` function in server.js to handle accrual for leave cards created after the global monthly accrual already ran — prevents new employees from waiting until the next month for credits.

### Technical Details
- `catchUpNewCards()`: Compares each card's `lastAccrualDate` against `systemState.lastAccruedMonth`. Cards missing accrual get catch-up credits with transaction entries.
- Excel migration supports up to 200 files initially (later increased to 500 in Session 10).
- Migration parses Excel cells: B3 (name), specific cells for VL earned/spent, SL earned/spent, FL, SPL.

---

## Session 9 — Security Hardening & DepEd Compliance

**Date**: 2026-02-19  
**Commits**: `4a112ad`, `93a104b`

### Accomplished
1. **Session-Based Auth on ALL Endpoints**: Implemented `requireAuth()` middleware with Bearer token validation on every API endpoint. Created `auth-interceptor.js` that automatically injects auth tokens into all `/api/` fetch calls from any page.
   - 6 login endpoints (employee, AO, HR, ASDS, SDS, IT) all return session tokens
   - Tokens stored in sessionStorage (employee, AO) or localStorage (HR, ASDS, SDS, IT)
   - `activeSessions` Map with 8-hour expiry, 15-minute cleanup interval
   - Role-based access control: endpoints restricted to specific portal roles

2. **Security Hardening (25 Vulnerabilities Patched)**:
   - Input sanitization middleware (sanitizeObject) on all request bodies and query params
   - XSS prevention with recursive HTML tag stripping
   - Rate limiting on login/register endpoints (10 req/min) and general API (100 req/min)
   - Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, CSP, HSTS
   - CORS origin restriction in production
   - Password complexity requirements (8+ chars, upper, lower, digit, special)
   - DepEd email validation (@deped.gov.ph)
   - Cross-portal email uniqueness check (`isEmailRegisteredInAnyPortal()`)

3. **DepEd Leave Balance Enforcement (9 Bugs Fixed)**:
   - Leave application validates sufficient remaining balance before submission
   - Force Leave capped at 5/year, SPL capped at 3/year with year tracking
   - Maternity/Paternity leave uses SPL allocation
   - Leave type validation against DepEd-approved types
   - Monetization blocked when VL < 10 or SL < 15
   - CTO balance validation (can't use more than earned)

4. **Fixed Sanitize Double-Encode Bug**: The input sanitizer was encoding `&` as `&amp;` on every request, causing cumulative encoding (`&amp;amp;amp;...`). Fixed to only encode once.

5. **Fixed CTO soImage**: CTO records `soImage` field was being corrupted. Fixed base64 data handling in the sanitizer.

---

## Session 10 — bcrypt Upgrade & Excel Migration Limit Fix

**Date**: 2026-02-19  
**Commits**: `bf4b858`, `70a297b`

### Accomplished
1. **Upgraded Password Hashing from SHA-256 to bcrypt (12 rounds)**:
   - Added bcrypt dependency with `npm install bcrypt`
   - Created `hashPasswordWithSalt()` (bcrypt) and `verifyPassword()` (checks bcrypt, salted-SHA256, and plain SHA-256)
   - Implemented transparent migration: `rehashIfNeeded()` upgrades old hashes to bcrypt on successful login
   - All 6 login endpoints updated with bcrypt verification + rehashing
   - Registration endpoints use bcrypt for new accounts
   - Backward compatible: existing SHA-256 passwords still work, auto-upgrade on next login

2. **Fixed Excel Migration File Limit**: Increased multer upload limit from 200 to 500 files. Added proper multer error handling with `MulterError` catch for file count and size limits. Frontend `data-management.html` updated with validation warning when > 500 files selected.

---

## Session 11 — Employee Database Fix & Employee Number Fallback

**Date**: 2026-02-19  
**Commits**: `5dfb6b2`, `9d0b95e`

### Accomplished
1. **Fixed "No Employees Found" on AO Dashboard**:
   - `/api/all-employees` was only returning registered users from `users.json`
   - Enhanced to merge registered users + leave card holders from `leavecards.json`
   - Employees imported via Excel migration (who haven't registered yet) now appear in AO dashboard
   - Added source badges in UI: "Registered" (green) vs "Leave Card Only" (blue)
   - Added error messages for auth failures in AO dashboard

2. **Added Name-Based Fallback Lookup**: `/api/leave-credits` and `/api/update-leave-credits` now fall back to name-based matching when email lookup returns no results. This handles imported leave cards that don't have an email linked yet.

3. **Added Employee Number as Universal Identifier**:
   - AO dashboard passes `empNo` parameter when opening employee cards
   - `/api/leave-credits` falls back to employee number matching
   - `/api/update-leave-credits` falls back to employee number matching
   - `edit-employee-cards.html` reads `empNo` URL param
   - `searchEmployees()` matches by name, email, OR employee number
   - `/api/cto-records` filters by name/empNo fallback
   - Ensures all lookup paths work even for employees with unlinked email addresses

---

## Session 12 — Session Persistence, Accrual Fix & Dual-Role Registration

**Date**: 2026-02-19  
**Commits**: `6bcf6c1`, `947e6c4`

### Issues Reported
1. AO dashboard showing "Authentication required. Please log in." and "No employees found" after clicking Refresh
2. User asked if this is a Railway volume problem
3. Jenel Tiad (IT admin with SDS registration) could log in as employee with VL=0, SL=0 — no accrual applied
4. Tiad's email blocked from employee registration: "This email is already registered in the IT portal"

### Root Causes Identified
1. **Sessions lost on Railway redeploy**: `activeSessions` was a pure in-memory `Map()`. Every git push triggered Railway redeploy → server restart → all sessions wiped. Browser tokens became orphaned → 401 on every API call. **NOT a Railway volume problem** — data files on the volume were fine.
2. **`catchUpNewCards()` math bug**: For cards with no `lastAccrualDate`, formula was `monthsToAccrue = (globalYear - createdYear) * 12 + (globalMonth - createdMonth) + 1`. A card created in Feb 2026 when `globalLastAccruedMonth = "2026-01"` gave `(2026-2026)*12 + (1-2) + 1 = 0` months — January's 1.25 accrual was never applied.
3. **New cards not accrued at creation time**: Registration approval created leave cards with VL=0, SL=0 and no immediate catch-up accrual. Cards had to wait for the next accrual cycle.
4. **Overly restrictive cross-portal email check**: `isEmailRegisteredInAnyPortal()` blocked ANY email found in ANY other portal, but all admin users (IT, AO, HR, ASDS, SDS) ARE employees who need leave cards.

### Fixes Implemented

**1. Persist Sessions to File** (`data/sessions.json`):
- `createSession()`, `destroySession()`, and 15-min cleanup all persist to disk
- On server startup, valid sessions restored from file; expired sessions discarded
- Sessions now survive Railway redeploys — users stay logged in

**2. Fixed `catchUpNewCards()` Accrual Logic**:
- Changed: for cards with no `lastAccrualDate`, now accrues from **January of the accrual year** (not from card creation month)
- DepEd policy: all employees earn credits from start of calendar year regardless of registration date
- Example: card created Feb 2026, `lastAccruedMonth = "2026-01"` → gets 1 month (January) = 1.25 VL + 1.25 SL

**3. Immediate Catch-Up Accrual on Registration Approval**:
- When IT approves a new employee, the system immediately reads `systemState.lastAccruedMonth` and applies all completed months' credits
- New leave cards get year-to-date accrual at creation time with proper transaction entries
- No more waiting until the next 24-hour accrual cycle

**4. Auto-Redirect to Login on 401** (`public/auth-interceptor.js`):
- Detects 401 responses on API calls (session expired or server restarted)
- Clears stale tokens from sessionStorage/localStorage
- Redirects to the correct login page based on portal URL path
- Skips redirect for login/register endpoints (expected 401 for bad credentials)

**5. Dual Employee + Admin Registration**:
- Updated `isEmailRegisteredInAnyPortal()` to accept array of portals to skip
- Employee registration now skips ALL admin portals → IT/AO/HR/ASDS/SDS users can register as employees
- Admin registrations skip the employee portal → employees can become admins
- Admin-to-admin cross-registration remains blocked (can't be both AO and HR)

### Architecture Changes
| Component | Before | After |
|-----------|--------|-------|
| Sessions | In-memory `Map()` only | `Map()` + `data/sessions.json` on disk |
| New card accrual | From card creation month | From January of accrual year |
| Registration approval | Creates card with VL=0, SL=0 | Creates card + immediate catch-up accrual |
| 401 handling | Shows error, user must manually navigate to login | Auto-redirect to correct login page |
| Cross-portal email | One email = one portal only | Employee + one admin portal allowed |

---

## Quick Reference (Updated)

| Item | Detail |
|------|--------|
| **HEAD** | `947e6c4` (2026-02-19) |
| **Node.js** | v25.4.0 |
| **Port** | `process.env.PORT` or 3000 |
| **Data Dir** | `data/` (JSON files, not in git) |
| **Defaults** | `data/defaults/` (seed data, in git) |
| **Sessions** | `data/sessions.json` (persisted across redeploys) |
| **Accrual State** | `data/system-state.json` (tracks `lastAccruedMonth`) |
| **Accrual Rate** | 1.25 days/month for both VL and SL |
| **Accrual Start** | January of current year (not registration date) |
| **Password Hash** | bcrypt (12 rounds), backward-compatible with SHA-256 |
| **Auth** | Bearer token, 8-hour session, auto-redirect on 401 |
| **Railway** | Auto-deploys from `origin/main` |
| **Email Policy** | Employee + one admin portal per email; admin-to-admin blocked |

### Known Issues (Updated)
- `/api/forgot-password`, `/api/verify-otp`, `/api/reset-password` return 404 (not implemented)
- `auth.js` module exists but no pages use it
- `public/script.js` is dead code (no HTML loads it)

---

*Last updated: 2026-02-19*
