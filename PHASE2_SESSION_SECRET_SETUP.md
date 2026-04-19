# Phase 2: SESSION_SECRET Configuration (Mandatory)

**Status:** Critical for Phase 1 fixes to work correctly  
**Date:** 2026-04-19  
**Required Before:** First deployment after Phase 1 commit

---

## Why SESSION_SECRET Matters

With Phase 1 fixes enabled, the system now uses **signed cookies**. Here's what happens:

### ✅ If SESSION_SECRET is Configured
```
1. Server starts → reads SESSION_SECRET from env var
2. New sessions created → signed with SECRET (secure)
3. Cookies survive restarts → signatures remain valid
4. User sessions persist → users stay logged in across deploys
5. Authentication stays valid → secure and stable
```

### ❌ If SESSION_SECRET is NOT Configured
```
1. Server starts → generates random SESSION_SECRET
2. New sessions created → signed with random value
3. Deploy happens → new random SECRET generated
4. Old sessions become invalid → signature verification fails
5. All users logged out → must re-login after each deploy
6. Users experience: "Why was I logged out?"
```

---

## How to Set SESSION_SECRET on Railway

### Step 1: Generate a Strong Random Value

Use one of these methods:

**Option A: Using Node.js (Recommended)**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option B: Using OpenSSL**
```bash
openssl rand -hex 32
```

**Option C: Using Python**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Example Output:**
```
a3f5d9c2e8b1f4a7d6c9e2f5a8b1c4d7e9f2a5b8c1d4e7f0a3b6c9d2e5f8a
```

### Step 2: Add to Railway

1. Go to your Railway project dashboard
2. Click **Settings** → **Environment Variables**
3. Click **New Variable**
4. Enter:
   - **Name:** `SESSION_SECRET`
   - **Value:** Paste the random value from Step 1
5. Click **Save**

### Step 3: Verify Configuration

After saving, verify it's set:
1. In Railway Settings, you should see `SESSION_SECRET` listed
2. The value should be hidden (shown as `••••••••`)
3. Status should show it's applied

---

## What This Does

Once `SESSION_SECRET` is set on Railway:

| Feature | Before | After |
|---------|--------|-------|
| Sessions after restart | Lost | Preserved |
| User login persistence | Broken (each deploy) | Works (survives restarts) |
| Cookie signatures | Invalid (random key) | Valid (consistent key) |
| User experience | "Why was I logged out?" | Seamless, stays logged in |

---

## Additional Environment Variables to Verify

While setting up, verify these are also configured:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Enables production security headers, HTTPS-only cookies |
| `RAILWAY_VOLUME_MOUNT_PATH` | `/mnt/volume_mount_path` (or similar) | Persistent data storage across restarts |
| `PRODUCTION_DOMAIN` | Your Railway domain (e.g., `https://myapp.railway.app`) | CORS allowlist, redirect URL |
| `SESSION_SECRET` | Strong random hex (32 bytes = 64 hex chars) | Cookie signing key (what you're setting now) |

**All four are needed for full security and stability.**

---

## Testing After Configuration

### Immediate Test (5 minutes after setting)
1. Deploy your Railway app (if not auto-deployed)
2. Open the app in browser
3. Log in as a test user
4. Refresh the page
5. ✅ You should still be logged in

### Extended Test (trigger a restart)
1. Trigger a manual redeploy in Railway
2. Wait for deployment to complete
3. Return to the app (don't log in again)
4. ✅ Session should still be valid

### If Sessions Lost
If you're still being logged out on restart:
1. Check Railway logs for errors
2. Verify `SESSION_SECRET` is set in Environment Variables
3. Verify `NODE_ENV=production` is set
4. Try manual redeploy
5. If still failing: Check that session persistence file is being written

---

## Why This is Important

### The Problem It Solves
Without SESSION_SECRET being consistent:
- Every restart generates a new random secret
- All existing session signatures become invalid
- Cookie-parser rejects all old sessions
- Users must re-login after every deploy
- Poor user experience

### The Solution
A persistent SESSION_SECRET means:
- Same secret across all restarts
- Cookie signatures remain valid
- Users stay logged in
- Seamless experience

---

## Next Steps After Configuration

1. ✅ Set `SESSION_SECRET` on Railway
2. ✅ Verify it's saved in Environment Variables
3. ✅ Trigger a deployment (or wait for auto-deploy)
4. ✅ Test login workflow
5. ✅ Proceed to Phase 3 fixes

---

## Troubleshooting

### Sessions Still Lost After Setting SESSION_SECRET

**Symptom:** Users logged out on every restart even with SESSION_SECRET set

**Causes & Solutions:**
1. **SESSION_SECRET not actually saved** → Verify in Railway Settings it shows the variable
2. **NODE_ENV not production** → Check Settings, make sure `NODE_ENV=production`
3. **Sessions file not persisting** → Check RAILWAY_VOLUME_MOUNT_PATH is set and mounted
4. **Browser caching** → Hard refresh (Ctrl+F5) or clear cookies and retry login

### Environment Variable Not Taking Effect

**Symptom:** Log shows "SESSION_SECRET not set" even though it's in Settings

**Causes & Solutions:**
1. **Redeploy not triggered** → Manually trigger redeploy in Railway
2. **Variable name typo** → Must be exactly `SESSION_SECRET` (case-sensitive)
3. **Special characters in value** → Should be hex digits only, no special chars
4. **Railway cache** → Try: Stop deployment → Wait 30s → Restart

### Login Fails with SESSION_SECRET Set

**Symptom:** Can't log in, getting 401 or session errors

**Check:**
1. Is `SESSION_SECRET` a valid hex string? (should be 64 characters of 0-9, a-f)
2. Are signed cookies being set? (check browser cookies, should not show in plain HTTP)
3. Are old unsigned cookies interfering? (clear cookies and try fresh login)

---

## Security Considerations

### What SESSION_SECRET Should Be
✅ Random 32-byte value (64 hex characters)  
✅ Generated securely (use crypto.randomBytes or openssl)  
✅ Not a password or memorable string  
✅ Never committed to git  

### What SESSION_SECRET Should NOT Be
❌ Your password  
❌ A simple phrase like "mysecret123"  
❌ Hardcoded in the application  
❌ Shared in plain text (only in Railway env vars)  

### Best Practices
1. Generate a new value (don't reuse from other projects)
2. Store only in Railway, never in code
3. Rotate annually (change to new random value)
4. If compromised, generate new value immediately

---

## FAQ

**Q: Can I change SESSION_SECRET after it's set?**  
A: Yes, but all existing sessions will be invalidated. Users will need to re-login. Only change if:
- You suspect it was compromised
- During planned maintenance window
- Document the rotation

**Q: What if I lose the SESSION_SECRET value?**  
A: It doesn't matter. You only need to set it once in Railway. If you need to change it:
1. Generate a new value
2. Update Railway environment variable
3. Redeploy
4. All existing sessions expire (users re-login)

**Q: Is SESSION_SECRET the same as password?**  
A: No. SESSION_SECRET is for cookie signing. User passwords are separate (stored in users.json, hashed with bcrypt).

**Q: Can multiple Railway instances share SESSION_SECRET?**  
A: Yes! That's the whole point. If running multiple instances, they all read the same SESSION_SECRET from env vars, ensuring sessions work across any instance.

**Q: Should I commit SESSION_SECRET to git?**  
A: **NO!** Never commit secrets to git. Keep it in Railway environment variables only.

---

## Checklist: Phase 2 Complete

- [ ] Generated random 32-byte hex value
- [ ] Added `SESSION_SECRET` to Railway Environment Variables
- [ ] Verified it's saved (shows as `••••••••` in Settings)
- [ ] Confirmed other env vars are set:
  - [ ] `NODE_ENV=production`
  - [ ] `RAILWAY_VOLUME_MOUNT_PATH` set
  - [ ] `PRODUCTION_DOMAIN` set
- [ ] Triggered redeploy or waited for auto-deploy
- [ ] Tested login works
- [ ] Tested session persists on refresh
- [ ] Tested session survives after manual redeploy
- [ ] Ready to proceed to Phase 3

---

## Summary

**Phase 2 is simple but critical:**
1. Generate one random value (`SESSION_SECRET`)
2. Add it to Railway environment variables
3. Test that login persists across restarts
4. Done!

This prevents the "users keep getting logged out" problem and ensures Phase 1's signed cookies work correctly.

**Without this, every deploy logs out all users. With this, sessions persist seamlessly.** 🔐

---

**Next: Proceed to Phase 3 (Enhancements)**
