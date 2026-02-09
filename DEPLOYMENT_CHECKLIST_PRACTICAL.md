# ✅ DEPLOYMENT CHECKLIST

## Pre-Deployment (Do This First!)

### Code Preparation
- [ ] All code changes committed to Git
- [ ] `.gitignore` includes: `node_modules/`, `*.log`, `.env` (NOT `data/`)
- [ ] `package.json` verified with all dependencies
- [ ] `npm install` runs without errors locally
- [ ] `npm start` works and server starts on port 3000

### Security & Secrets
- [ ] API keys and credentials removed from code
- [ ] `.env.example` file created (no actual secrets)
- [ ] MailerSend API key ready in secure location
- [ ] Plan for storing secrets in hosting platform

### Testing
- [ ] Test all portal logins locally (employee, ao, hr, asds, sds)
- [ ] Test form submission
- [ ] Test email notification (if MailerSend configured)
- [ ] Verify all JSON data files present in `data/` folder
- [ ] Check public static files load correctly

---

## Choose Your Hosting Platform

### Selected Platform: ___________________

☐ Railway.app (Recommended - Easiest)
☐ Render.com (Good free tier)
☐ Heroku (Paid tier)
☐ Azure App Service (Enterprise)
☐ DigitalOcean VPS (Advanced)
☐ Other: _____________________

---

## GitHub Setup (Required for Cloud Deployment)

- [ ] GitHub account created at https://github.com
- [ ] New repository created (public or private)
- [ ] Local git repo initialized: `git init`
- [ ] Files added: `git add .`
- [ ] Initial commit: `git commit -m "Initial commit"`
- [ ] Repository URL: https://github.com/YOUR_USERNAME/leave-form
- [ ] Code pushed to GitHub: `git push -u origin main`

**GitHub Repository URL:** _________________________________

---

## Platform-Specific Deployment

### If Using Railway.app

- [ ] Account created at https://railway.app
- [ ] GitHub connected/authorized
- [ ] New project created
- [ ] Repository selected for deployment
- [ ] Automatic deployment configured
- [ ] Build successful in Railway dashboard

**Railway App URL (temporary):** https://leave-form-xxxx.up.railway.app

Environment Variables Set in Railway:
- [ ] `NODE_ENV` = `production`
- [ ] `PORT` = `3000`
- [ ] `PRODUCTION_DOMAIN` = `https://leave-form-xxxx.up.railway.app`
- [ ] `MAILERSEND_API_KEY` = (your actual key)
- [ ] `MAILERSEND_SENDER_EMAIL` = (your verified email)

### If Using Render.com

- [ ] Account created at https://render.com
- [ ] GitHub connected/authorized
- [ ] New Web Service created
- [ ] Repository selected
- [ ] Build command: `npm install`
- [ ] Start command: `npm start`

Environment Variables Set in Render:
- [ ] `NODE_ENV` = `production`
- [ ] `PORT` = `3000`
- [ ] `PRODUCTION_DOMAIN` = `https://leave-form-xxxx.onrender.com`
- [ ] `MAILERSEND_API_KEY` = (your actual key)
- [ ] `MAILERSEND_SENDER_EMAIL` = (your verified email)

**Render App URL (temporary):** https://leave-form-xxxx.onrender.com

### If Using Heroku

- [ ] Account created at https://heroku.com
- [ ] Heroku CLI installed: https://devcenter.heroku.com/articles/heroku-cli
- [ ] Logged in: `heroku login`
- [ ] App created: `heroku create leave-form-app`
- [ ] Repository linked to Heroku

```bash
heroku config:set NODE_ENV=production
heroku config:set PRODUCTION_DOMAIN=https://leave-form-app.herokuapp.com
heroku config:set MAILERSEND_API_KEY=your_key
heroku config:set MAILERSEND_SENDER_EMAIL=your_email
git push heroku main
```

**Heroku App URL:** https://leave-form-app.herokuapp.com

---

## Post-Deployment Testing

### Access & Functionality
- [ ] App accessible at deployed URL (no 404 error)
- [ ] Page loads without errors (check browser console)
- [ ] CSS/styling loads correctly
- [ ] Images/logos display properly

### Portal Testing (Test Each)
- [ ] Employee login works
- [ ] AO (Administrative Officer) login works
- [ ] HR login works
- [ ] ASDS login works
- [ ] SDS login works

### Form & Data
- [ ] Leave form loads and displays
- [ ] Form submission works (creates data)
- [ ] Submitted data saved to database
- [ ] Can download/export data

### Email Functionality (If configured)
- [ ] Test user registration triggers email
- [ ] Email sends successfully
- [ ] Email links point to correct domain (not localhost)
- [ ] Email formatting looks professional
- [ ] No emails go to spam folder

### API Endpoints
- [ ] `/api/health` or health check endpoint responds
- [ ] Rate limiting active (try rapid requests)
- [ ] Error handling works (test invalid input)

---

## Custom Domain Setup (Optional but Recommended)

### If Adding Custom Domain

1. **Domain Registration**
   - [ ] Domain purchased from registrar (GoDaddy, Namecheap, etc.)
   - [ ] Domain: ________________________________

2. **DNS Configuration**
   - Platform instructions followed:
     - [ ] Railway: Added custom domain in dashboard
     - [ ] Render: Updated CNAME record
     - [ ] Heroku: Added domain and updated DNS
   
3. **SSL Certificate**
   - [ ] Automatic HTTPS enabled (most platforms do this)
   - [ ] Certificate valid for custom domain
   - [ ] No SSL warnings in browser

4. **Environment Variable Update**
   - [ ] Updated `PRODUCTION_DOMAIN` to custom domain
   - [ ] Verified app redirects to HTTPS

**Production Domain:** _________________________________

---

## Data Backup Setup

### Automated Backup
- [ ] Backup process configured
- [ ] Scheduled backup frequency: _________________
- [ ] Backup location/service: _____________________
- [ ] Test restore from backup

### Manual Backup (At Minimum Weekly)
- [ ] `data/leavecards.json` backed up
- [ ] `data/applications.json` backed up
- [ ] `data/users.json` backed up
- [ ] Backups stored securely offline

---

## Monitoring & Maintenance

### Error Monitoring
- [ ] Logs viewable in platform dashboard
- [ ] Error alerts configured (if available)
- [ ] Checked logs for any errors: ________________

### Performance
- [ ] App response time acceptable (< 2 seconds)
- [ ] No memory leaks detected
- [ ] Page load time reasonable

### Security Check
- [ ] No secrets in logs or errors
- [ ] HTTPS enforced (no HTTP access)
- [ ] CORS properly configured
- [ ] Rate limiting working

### Updates & Maintenance
- [ ] npm dependencies checked for updates
- [ ] Vulnerable packages patched
- [ ] Deployment process documented
- [ ] Team trained on maintenance

---

## Documentation

- [ ] Deployment guide shared with team
- [ ] Access credentials stored securely
- [ ] Backup recovery procedure documented
- [ ] Emergency contact information available
- [ ] Runbook created for common issues

---

## Go-Live Approval

### Final Review
- [ ] All tests passed ✓
- [ ] No critical errors
- [ ] Performance acceptable
- [ ] Backups working
- [ ] Team trained

### Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Lead | _____________ | _______ | ______ |
| IT Administrator | _____________ | _______ | ______ |
| Approver | _____________ | _______ | ______ |

---

## Post-Launch Monitoring (First Week)

- [ ] Day 1: Monitor for errors every 1 hour
- [ ] Day 2-3: Check logs twice daily
- [ ] Day 4-7: Daily health check
- [ ] Monitor user feedback
- [ ] Log any issues for fixes

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| App won't start | Check `npm start` works locally; verify PORT env var |
| 404 errors | Ensure `public/` folder deployed; check file paths |
| Email not sending | Verify MAILERSEND_API_KEY and MAILERSEND_SENDER_EMAIL |
| CORS errors | Check PRODUCTION_DOMAIN matches deployed URL |
| Slow performance | Check CPU/memory usage; may need higher tier |
| Data not saving | Verify `data/` folder writable; check file permissions |
| SSL errors | Check domain DNS configured; wait 24-48 hours for propagation |

---

## Additional Resources

- Railway Documentation: https://docs.railway.app
- Render Documentation: https://render.com/docs
- Node.js Best Practices: https://nodejs.org/en/docs/guides/nodejs-performance-best-practices/
- Express Deployment: https://expressjs.com/en/advanced/best-practice-security.html

---

**Deployment Start Date:** ________________
**Deployment Complete Date:** ________________
**Deployed By:** ________________
**Notes:** 

___________________________________________________________________

___________________________________________________________________

___________________________________________________________________

