# 🔄 Orchestration Workflow — Permanent Instructions

> **This file is the permanent workflow for all AI coding sessions in this workspace.**
> It must be followed on every device, every session, every time.

---

## 📋 Before Starting Any Task

1. **Read this file first** — it contains the mandatory workflow steps.
2. **Gather context** — understand the codebase before making changes.
3. **Plan tasks** — break down the request into actionable todo items.

---

## 🛠️ During Development

1. **Research first** — read relevant files and understand the current implementation.
2. **Make changes** — implement fixes/features one task at a time.
3. **Verify** — check for errors after each change.
4. **Test** — start the dev server (`npm run dev`) and verify changes work.

---

## ✅ After Completing All Tasks — MANDATORY

### Step 1: Git Commit
```bash
git add -A
git commit -m "type: short description

- bullet point of change 1
- bullet point of change 2"
```

**Commit types:** `fix:`, `feat:`, `refactor:`, `style:`, `docs:`, `chore:`

### Step 2: Git Push
```bash
git push origin main
```

### Step 3: Confirm to User
- Report the commit hash
- Confirm the push was successful
- Summarize what was changed

---

## ⚠️ Rules

- **NEVER skip the git commit and push steps** — they are mandatory.
- **NEVER create markdown documentation files** unless the user explicitly asks.
- **ALWAYS use the todo list** to track progress on multi-step tasks.
- **ALWAYS test changes** before committing.
- **ALWAYS include meaningful commit messages** with the type prefix.

---

## 🏗️ Project Info

- **Stack:** Node.js + Express + vanilla HTML/CSS/JS
- **Server:** `server.js` (main backend, ~4300 lines)
- **Frontend:** `public/` folder (20+ HTML pages)
- **Data:** JSON file storage in `data/` folder
- **Start:** `npm run dev` or `node server.js`
- **Port:** 3000 (default)
