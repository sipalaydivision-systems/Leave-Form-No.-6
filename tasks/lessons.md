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
