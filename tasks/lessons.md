# Lessons Learned

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
