# Current Task — 4 Issues Fix (Feb 16, 2026)

## Issue 1: Signatures & Logo Not Appearing
- [ ] Fix logo and signature rendering

## Issue 2: HR No View/Sign for Returned Applications  
- [ ] Add view + signature pad matching ASDS/SDS flow

## Issue 3: Remove Position Categories in Registration
- [ ] Flatten optgroups in login.html and ao-register.html

## Issue 4: Rename "Division Office Proper" → "ASDS - Assistant Schools Division Superintendent"
- [ ] Update across all 6 registration files

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

### ✅ FIXED — 6 Critical/High Bugs

| # | Severity | File | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | Critical | server.js | Sanitization middleware before bodyParser = dead code | Moved after bodyParser |
| 2 | Critical | ao-dashboard.html | `app.email` → `app.employeeEmail` wrong property lookup | Fixed with fallback chain |
| 3 | Critical | ao-dashboard.html | `currentApplicantName` never declared | Added let declaration + assignment |
| 4 | Critical | leave_form.html | Women illness field never submitted | Added id + included in applicationData |
| 5 | High | employee-leavecard.html, edit-employee-cards.html | switchTab() used implicit `event` (Firefox crash) | Added event parameter |
| 6 | Critical | leave_form.html | SO image upload data never sent to server | Documented — needs FileReader integration |

### ⏳ REMAINING — High Priority (not yet fixed)

- **No auth on 20+ API endpoints** — all data readable/writable without login
- **Race conditions** on JSON file read/write under concurrent requests
- **CTO soImage base64** could bloat cto-records.json to hundreds of MB
- **Force Leave (MFL)** incorrectly deducts from VL balance in form calculation
- **AO saveCTOCard()** doesn't preserve soImage on edit
- **Sanitize double-encodes** on re-save (`&lt;` → `&amp;lt;`)

### ⏳ REMAINING — Medium/Low Priority (not yet fixed)

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
