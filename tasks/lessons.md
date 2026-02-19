# Lessons Learned

## Standing Rules

### Rule: Always commit, push, and deploy after every completed task
- After finishing any work: `git add -A && git commit && git push origin main`
- Railway auto-deploys from `main` — push triggers deployment automatically
- Do NOT wait to be asked — this is part of the standard workflow

## 2026-02-16 — System Bug Audit

### Lesson 1: Always check middleware ordering in Express
- **Pattern**: Middleware that depends on `req.body` must be registered AFTER `bodyParser`
- **Rule**: When adding any middleware that reads `req.body`, verify it comes after body parsing
- **Mistake**: Sanitization middleware was at line ~95, bodyParser at line ~204 — sanitization was dead code

### Lesson 2: Verify property names match between frontend submission and server storage
- **Pattern**: Frontend sends `applicationData.employeeEmail`, server spreads it into the record. Later code reading the record must use `app.employeeEmail`, not `app.email`
- **Rule**: When accessing stored data properties, trace back to the original submission to confirm the exact property name
- **Mistake**: `ao-dashboard.html` used `app.email` which doesn't exist — should be `app.employeeEmail`

### Lesson 3: Variables referenced must be declared
- **Pattern**: `currentApplicantName` was used in `editLeaveCard()` but never declared or assigned
- **Rule**: When using a variable in a function, grep for its declaration and assignment — don't assume it exists
- **Mistake**: Copy-paste from a different file that had the variable, but it was never added to ao-dashboard

### Lesson 4: Form submission must collect ALL validated fields
- **Pattern**: `women_illness` was validated before submission but never included in the applicationData object
- **Rule**: After adding validation for a field, immediately add it to the submission payload construction
- **Mistake**: Validation and submission code were far apart (~100 lines), making it easy to validate but forget to include

### Lesson 5: Avoid deprecated browser APIs
- **Pattern**: `event.target` without passing `event` as a parameter relies on deprecated `window.event`
- **Rule**: Always pass `event` explicitly via `onclick="fn(event)"` and accept it as a parameter
- **Mistake**: Works in Chrome but crashes in Firefox — cross-browser testing would have caught this

### Lesson 6: Edit the correct file
- **Pattern**: Root `leave_form.html` vs `public/leave_form.html` are different files
- **Rule**: When the portal serves from `public/`, always edit the file in `public/` — check where `express.static` points
- **Mistake**: Added SO upload button to root `leave_form.html` instead of `public/leave_form.html`

### Lesson 7: CSS selectors should be specific
- **Pattern**: `.others-field input` styled ALL inputs including file inputs
- **Rule**: Use specific selectors like `.others-field input[type="text"]` to avoid style leaks
- **Mistake**: Broad CSS selector could affect hidden file inputs or future inputs added to the container

### Lesson 8: Don't use invisible overlay inputs for date pickers
- **Pattern**: Creating an `<input type="date">` with `opacity: 0` positioned over a text input fails because parent CSS rules (`.info-cell input { width: calc(100% - 80px) }`, `.field-input { margin-bottom }`) resize/reposition the overlay unpredictably
- **Rule**: Use `showPicker()` API instead — create a fully hidden date input (`visibility: hidden; width: 0; height: 0`) and call `realDateInput.showPicker()` from the display input's click handler. No overlay = no CSS interference.
- **Mistake**: Tried the invisible overlay approach twice (z-index fix, then wrapper div with `all:unset`) — both failed because the overlay was still a visible DOM element subject to inherited CSS rules

### Lesson 9: Use findLast/reverse pattern for approval history
- **Pattern**: `approvalHistory.find()` returns the FIRST entry, but after return-and-re-approve cycles, the first entry may be outdated
- **Rule**: Always use `approvalHistory.slice().reverse().find()` when looking for the latest approval action
- **Mistake**: `getApprovalInfo` used `find()` which could return an old non-approved entry instead of the latest approved one

### Lesson 10: crossOrigin attribute breaks same-origin canvas operations
- **Pattern**: Setting `img.crossOrigin = 'anonymous'` forces CORS requests — Express.static doesn't send CORS headers by default
- **Rule**: Don't set crossOrigin on same-origin images used for canvas toDataURL(). Only set it for cross-origin images with proper CORS support
- **Mistake**: Print function set crossOrigin on the logo image, causing canvas taint and silent toDataURL failure

### Lesson 11: Feature parity when building alternate flows
- **Pattern**: When a returned application goes back to an approver, the re-approval flow must include the same fields as the original flow
- **Rule**: When building a "returned" or "re-process" view, always cross-reference the original view to ensure all required fields (signatures, officer names) are included
- **Mistake**: HR returned flow was missing signature pad and officer name fields that the regular approval flow had

## 2026-02-19 — Security Hardening & DepEd Compliance

### Lesson 12: Never trust client-provided identity in authenticated endpoints
- **Pattern**: `req.body.employeeEmail` can be spoofed even by authenticated users
- **Rule**: Always use `req.session.email` for identity — never accept email/userId from request body when the action affects the requesting user's own data
- **Mistake**: submit-leave, resubmit-leave, and change-password all trusted client-provided email, allowing IDOR attacks

### Lesson 13: Mass assignment is dangerous even in internal tools
- **Pattern**: Using `...req.body` or `Object.assign(record, req.body)` allows attackers to inject arbitrary fields
- **Rule**: Always use explicit field whitelists when creating or updating records from user input
- **Mistake**: submit-leave spread entire applicationData object into the record; resubmit used Object.assign

### Lesson 14: Audit trails must use server-verified data
- **Pattern**: `approverPortal` and `approverName` from request body were stored in approval history, returnedBy, rejectedBy
- **Rule**: Audit trail fields (who did what) must come from the server session, not from the request
- **Mistake**: An approver could forge the audit trail to attribute actions to a different person/portal

### Lesson 15: GET endpoints need ownership checks too
- **Pattern**: Any authenticated user could query any other user's applications, leave card, CTO records via URL parameters
- **Rule**: For employee-facing GET endpoints, verify `req.session.email === requestedEmail` unless the caller has an admin role
- **Mistake**: 9 GET endpoints were open to any authenticated user, enabling data enumeration

### Lesson 16: Philippine government leave rules are more nuanced than they appear
- **Pattern**: Force Leave APPEARS to be a separate 5-day allocation, but is actually a mandatory deduction FROM vacation leave
- **Rule**: When implementing government rules, reference the exact CSC MC/Rule section. Key gotchas:
  - FL is VL (charged against VL balance, not a separate pool)
  - FL requires 10+ accumulated VL days
  - Exhausted SL can be charged against VL (Rule XVI Sec. 15)
  - FL should be taken as consecutive days (not restricted TO non-consecutive)
- **Mistake**: FL was a separate pool with an inverted consecutive-day restriction

### Lesson 17: Atomic writes prevent data corruption
- **Pattern**: `fs.writeFileSync(file, data)` can corrupt data if the process crashes mid-write
- **Rule**: Write to temp file → validate → backup current → atomic rename
- **Implementation**: writeJSON() now: validates JSON.parse → writes .tmp → reads .tmp back → moves current to .bak → renames .tmp to target

### Lesson 18: Password stripping must be consistent across all endpoints
- **Pattern**: Data export stripped passwords, but /api/all-users returned raw records with hashes
- **Rule**: Any endpoint that returns user records must strip password fields. Audit ALL endpoints that read user files.
- **Mistake**: Focused only on the export endpoint; missed the demographics/admin view

### Lesson 19: SHA-256 is not sufficient for password hashing — use bcrypt
- **Pattern**: SHA-256 (even salted) is fast by design, making it vulnerable to GPU/ASIC brute-force attacks
- **Rule**: Use bcrypt (or scrypt/argon2) with a work factor of 12+ rounds for password storage. These are intentionally slow, costing ~250ms per hash.
- **Solution**: Upgraded to `bcryptjs` (pure JS, no native deps) with 12 rounds. Implemented transparent migration: existing SHA-256 passwords auto-upgrade to bcrypt on next successful login via `rehashIfNeeded()`. Three legacy formats detected: bcrypt (`$2a$`/`$2b$`), salted SHA-256 (`salt:hash`), unsalted SHA-256 (plain hex).
