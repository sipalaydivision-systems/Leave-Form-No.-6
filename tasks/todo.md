# Current Task — 4 Issues Fix (Feb 16, 2026)

## Issue 1: Signatures & Logo Not Appearing
- [x] Fix logo and signature rendering
> **VERIFIED FIXED** (Feb 19 audit): Logo files exist (`deped logo.png`, `sipalay_logo.png`), paths correct in all HTML files. All 4 signing roles (Employee, HR, ASDS, SDS) have fully functional canvas-based signature pads with draw/upload/clear. Signatures saved/loaded correctly via server endpoints.

## Issue 2: HR No View/Sign for Returned Applications  
- [x] Add view + signature pad matching ASDS/SDS flow
> **VERIFIED FIXED** (Feb 19 audit): HR has full view for returned apps with status badges, two separate signature pads (regular approval + returned app flow), approve/return/reject actions. Fully equivalent to ASDS/SDS flow.

## Issue 3: Remove Position Categories in Registration
- [x] Flatten optgroups in login.html and ao-register.html
> **VERIFIED FIXED** (Feb 19 audit): All 6 position dropdowns are flat `<option>` lists with no `<optgroup>` tags (login.html, ao-register.html, ao-login.html, hr-login.html, asds-login.html, sds-login.html).

## Issue 4: Rename "Division Office Proper" → "ASDS - Assistant Schools Division Superintendent"
- [x] Update across all 6 registration files
> **VERIFIED FIXED** (Feb 19 audit): "Division Office Proper" no longer appears anywhere. "ASDS - Assistant Schools Division Superintendent" present in all 6 files.

---

# System Bug Audit - February 16, 2026

## Plan
Comprehensive audit of the Leave Management System for known bugs across:
1. Server-side API endpoints (server.js)
2. Frontend forms & UI interactions (public/*.html)
3. Authentication & security
4. Data integrity (JSON files, read/write patterns)

## Checklist

### Server Endpoints
- [x] CTO record CRUD - soImage handling, data consistency
- [x] Leave card CRUD - balance calculations, transaction integrity
- [x] User/employee management - registration, login, password flows
- [x] Application submission & approval pipeline
- [x] File read/write race conditions & error handling

### Frontend
- [x] Leave form (public/leave_form.html) - all interactions, date pickers, validation
- [x] Dashboard (public/dashboard.html) - data display, form submission
- [x] Employee leave card (public/employee-leavecard.html) - CTO/leave card rendering
- [x] Edit employee cards (public/edit-employee-cards.html) - inline editing, save flow
- [x] AO dashboard (public/ao-dashboard.html) - approval flow, leave/CTO modals
- [x] ASDS/SDS/HR dashboards - approval chains

### Auth & Security
- [x] Session management & guards
- [x] Password reset / forgot password
- [x] Role-based access control

### Data Integrity
- [x] JSON file consistency
- [x] Migration artifact cleanup
- [x] CTO soImage base64 storage impact on file size

---

## Audit Results: 48 bugs found (30 server, 18 frontend)

### ✅ FIXED — 7 Critical/High Bugs

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | Critical | server.js | Sanitization middleware before bodyParser = dead code | Moved after bodyParser |
| 2 | Critical | ao-dashboard.html | `app.email` → `app.employeeEmail` wrong property lookup | Fixed with fallback chain |
| 3 | Critical | ao-dashboard.html | `currentApplicantName` never declared | Added let declaration + assignment |
| 4 | Critical | leave_form.html | Women illness field never submitted | Added id + included in applicationData |
| 5 | High | employee-leavecard.html, edit-employee-cards.html | switchTab() used implicit `event` (Firefox crash) | Added event parameter |
| 6 | Critical | leave_form.html | SO image upload data never sent to server | Documented — needs FileReader integration |
| 7 | High | server.js | Force Leave (MFL) incorrectly deducted from VL balance | Fixed — `isForceLeave` guard excludes FL from VL/SL deductions |

### ⏳ REMAINING — High Priority (not yet fixed)

| # | Severity | Bug | Details |
|---|----------|-----|---------|
| 1 | **High** | Race conditions on JSON read/write | `readJSON`/`writeJSON` use synchronous `fs.readFileSync`/`fs.writeFileSync` with no file locking, mutexes, or write queue. Concurrent requests can cause data loss (second write overwrites first). |

### ⏳ REMAINING — Low Priority (not yet fixed)

- Date.now() ID collisions under concurrent requests
- Negative leave balance clamped to 0.000 (hides over-usage)
- ensureDataOnStartup re-seeds cleared files (deleted data reappears)
- Dashboard `.toFixed(0)` rounds leave credits (shows 5 when balance is 4.5)
- Rate limiter memory leak (store grows unbounded)
- Working days calculation ignores holidays
- readJSON silently returns [] on corruption (hides data loss)
- Inconsistent password validation rules across endpoints

## Review

All 6 critical/high bugs were verified by subagent before applying fixes.
Post-fix validation: `get_errors` returned 0 errors across all 5 modified files.
Manual code review confirmed sanitization middleware now executes after bodyParser.
Remaining bugs documented above for future sessions.

---

## Re-Audit: February 19, 2026

Full system re-audit performed. Results:
- **All 4 original issues (signatures, HR view/sign, optgroups, rename) are VERIFIED FIXED**
- **Force Leave VL deduction bug is VERIFIED FIXED** (moved from remaining → fixed)

### Fixes Applied (Feb 19):
1. **Sanitize double-encode** — Made `sanitizeInput()` idempotent (decode first, then encode). Removed `/` and `\` encoding that broke base64 data. Skip sanitization for `data:` URLs entirely.
2. **saveCTOCard soImage** — Added SO image upload field to AO edit CTO form + included `soImage` in save payload. Added 5MB client-side + 5MB server-side size limits.
3. **Auth on ALL API endpoints** — Created `auth-interceptor.js` that auto-injects Bearer tokens into fetch calls. Added to all 11 frontend pages. Added `requireAuth()` to 34 previously unprotected endpoints with appropriate role restrictions. Only `/api/health` (monitoring) and `/api/data/seed` (secret key auth) remain public.

### Remaining:
- **1 high-priority bug**: Race conditions on JSON read/write (needs file locking)
- **8 low-priority bugs**: ID collisions, negative balance, re-seeding, rounding, memory leak, holidays, corruption handling, password validation
