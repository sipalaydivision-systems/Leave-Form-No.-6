# 🚀 DEPLOYMENT GUIDE: sdo-sipalay.leavemanagement.aisa
## Leave Form System → Railway.app + Namecheap Domain

---

## 📋 WHAT YOU'LL ACCOMPLISH

By following this guide, your system will be:
- ✅ Deployed to Railway.app
- ✅ Connected to your domain: `sdo-sipalay.leavemanagement.aisa`
- ✅ Running with HTTPS/SSL automatically
- ✅ Accessible 24/7 for your team
- ✅ **Time needed: 30-45 minutes**

---

## ✅ BEFORE YOU START - CHECKLIST

Have these ready:
- [ ] GitHub account (create at github.com if you don't have one)
- [ ] Railway.app account (create at railway.app)
- [ ] Namecheap account (you already have this)
- [ ] Access to Namecheap DNS settings
- [ ] This computer with the Leave Form System code

---

## 🎯 STEP 1: CREATE GITHUB ACCOUNT (If Needed)

**If you already have GitHub, skip to Step 2**

1. Go to https://github.com/join
2. Enter email address
3. Create password
4. Choose username (remember this)
5. Click "Create account"
6. Verify email address
7. ✅ GitHub account ready

---

## 📤 STEP 2: PUSH YOUR CODE TO GITHUB (5 minutes)

### 2.1: Initialize Git Locally

Open PowerShell in your Leave Form folder:

```powershell
cd "f:\Division Files\Leave Form No. 6"

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Leave Form System - Ready for production deployment"

# Rename branch to main (GitHub default)
git branch -M main
```

### 2.2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `leave-form-system`
3. Description: "Leave Form Management System for DepEd"
4. Keep as **Public** (easier for Railway)
5. Click **"Create repository"**
6. Copy the URL shown (looks like: `https://github.com/YOUR_USERNAME/leave-form-system.git`)

### 2.3: Push Code to GitHub

```powershell
# Add GitHub remote (replace with YOUR copied URL)
git remote add origin https://github.com/YOUR_USERNAME/leave-form-system.git

# Push to GitHub
git push -u origin main
```

✅ **Your code is now on GitHub!**

---

## 🚀 STEP 3: DEPLOY TO RAILWAY.APP (5 minutes)

### 3.1: Create Railway Account

1. Go to https://railway.app
2. Click **"Start Now"** or **"Login"**
3. Choose **"GitHub"** option
4. Authorize Railway to access your GitHub
5. ✅ You're logged in

### 3.2: Deploy Your Application

1. In Railway dashboard, click **"+ New Project"**
2. Select **"Deploy from GitHub repo"**
3. Find and select `leave-form-system` repository
4. Click **"Deploy Now"**
5. **Wait 2-3 minutes** for deployment to complete
6. You'll see a message: **"Build Successful"** ✅

### 3.3: Get Your Temporary Railway URL

1. In Railway project, look for **"Deployments"** tab
2. You'll see your app is **"Running"** (green status)
3. Copy your temporary URL (looks like: `https://leave-form-xxxx-production.up.railway.app`)
4. **Save this URL** - you'll need it

---

## ⚙️ STEP 4: SET ENVIRONMENT VARIABLES (3 minutes)

### 4.1: Configure in Railway Dashboard

1. In Railway project, click **"Variables"** tab on the right side
2. Click **"+ New Variable"** and add these:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `NODE_ENV` | `production` | `production` |
| `PORT` | `3000` | `3000` |
| `PRODUCTION_DOMAIN` | Your Railway URL | `https://leave-form-xxxx-production.up.railway.app` |
| `MAILERSEND_API_KEY` | Your API key (optional) | `mlsn.xxxxx...` |
| `MAILERSEND_SENDER_EMAIL` | Your email (optional) | `noreply@yourdomain.mlsender.net` |

### 4.2: Add These Variables

```
NODE_ENV = production
PORT = 3000
PRODUCTION_DOMAIN = https://leave-form-xxxx-production.up.railway.app
```

(Replace the URL with your actual Railway URL from Step 3.3)

3. Click **"Deploy"** button at the top
4. **Wait 1-2 minutes** for new deployment
5. ✅ Variables are set

---

## 🧪 STEP 5: TEST YOUR RAILWAY DEPLOYMENT (5 minutes)

Before connecting your domain, test that everything works:

### 5.1: Visit Your Temporary Railway URL

1. Copy your Railway URL from Step 3.3
2. Open in browser: `https://leave-form-xxxx-production.up.railway.app`
3. You should see: **Leave Form System** home page
4. ✅ App is running!

### 5.2: Quick Functionality Test

- [ ] Page loads without errors
- [ ] CSS/styling displays correctly
- [ ] Can access Employee portal
- [ ] Can access AO portal
- [ ] Can access HR portal
- [ ] Can access ASDS portal
- [ ] Can access SDS portal

**If any issues**, check Railway logs (Deployments tab → View logs)

✅ **Railroad deployment is working!**

---

## 🌐 STEP 6: CONFIGURE YOUR NAMECHEAP DOMAIN (5 minutes)

### 6.1: Get Railway's DNS Information

1. In Railway dashboard, click **"Settings"** tab
2. Scroll to **"Custom Domains"** section
3. Look for **DNS Records** or **CNAME information**
4. Copy the **CNAME value** (looks like: `cname.railway.app`)

### 6.2: Update Namecheap DNS

1. Go to https://www.namecheap.com/dashboard
2. Click **"Manage"** next to your domain `sdo-sipalay.leavemanagement.aisa`
3. Click **"Advanced DNS"** tab
4. Find **Host Records** section
5. Look for a record with Host: `@` or leave blank - **Edit it**:

**Update the A Record:**

| Setting | Value |
|---------|-------|
| Type | A |
| Host | @ |
| Value | Get from Railway Custom Domains section |
| TTL | 30 min (or Auto) |

**OR Add a CNAME Record (if recommended by Railway):**

| Setting | Value |
|---------|-------|
| Type | CNAME |
| Host | @ (or sdo-sipalay) |
| Value | Your Railway CNAME value |
| TTL | 30 min (or Auto) |

### 6.3: Important Note

⚠️ **DNS changes can take 5 minutes to 48 hours to propagate** (usually 15-30 minutes)

Don't worry if it doesn't work immediately!

---

## 🔗 STEP 7: ADD CUSTOM DOMAIN TO RAILWAY (2 minutes)

### 7.1: In Railway Dashboard

1. Click **"Settings"** tab
2. Scroll to **"Custom Domains"** section
3. Click **"+ Add Custom Domain"**
4. Enter your domain: `sdo-sipalay.leavemanagement.asia`
5. Click **"Add"**
6. Railway generates DNS records for you
7. Follow their DNS setup instructions

### 7.2: Verify Domain Setup

1. Railway will show you the DNS configuration needed
2. Ensure your Namecheap DNS matches
3. Railway will verify automatically (can take 15-30 minutes)

---

## ✅ STEP 8: VERIFY EVERYTHING WORKS (5 minutes)

### 8.1: Test Your Custom Domain

After DNS propagates (15-30 minutes), visit:

```
https://sdo-sipalay.leavemanagement.asia
```

You should see:
- ✅ Your Leave Form System loads
- ✅ No "This site can't be reached" errors
- ✅ HTTPS working (green lock icon)
- ✅ All portals accessible

### 8.2: Test All Portals

- [ ] Employee portal login
- [ ] AO portal login
- [ ] HR portal login
- [ ] ASDS portal login
- [ ] SDS portal login
- [ ] Form submission
- [ ] Data saves

### 8.3: If DNS Not Propagated Yet

**This is normal - DNS can take up to 48 hours**

Check propagation here: https://www.whatsmydns.net/

Type your domain: `sdo-sipalay.leavemanagement.aisa`

---

## 📊 STEP 9: CONFIGURE PRODUCTION DOMAIN VARIABLE (Final)

Now that your domain is working, update the environment variable:

### 9.1: Update in Railway

1. Go to Railway **Variables** tab
2. Update `PRODUCTION_DOMAIN`:

```
OLD: https://leave-form-xxxx-production.up.railway.app
NEW: https://sdo-sipalay.leavemanagement.aisa
```

3. Click **"Deploy"** to apply changes
4. Wait 1-2 minutes for deployment

### 9.2: Why This Matters

This ensures:
- Email links point to your domain (not Railway URL)
- All internal URLs use your domain
- System appears professional to users

---

## 🎊 STEP 10: SHARE WITH YOUR TEAM (Done!)

Your system is now **LIVE** at:

```
https://sdo-sipalay.leavemanagement.aisa
```

Share this with your team:

```
System URL: https://sdo-sipalay.leavemanagement.aisa

Portal Types:
- Employee: https://sdo-sipalay.leavemanagement.aisa/login
- AO (Admin): https://sdo-sipalay.leavemanagement.aisa/ao-login
- HR: https://sdo-sipalay.leavemanagement.aisa/hr-login
- ASDS: https://sdo-sipalay.leavemanagement.aisa/asds-login
- SDS: https://sdo-sipalay.leavemanagement.aisa/sds-login
```

---

## 🔧 TROUBLESHOOTING

### Issue: "This site can't be reached"

**Causes & Solutions:**

1. **DNS not propagated yet**
   - Wait 15-30 minutes
   - Check: https://www.whatsmydns.net/
   - Use Railway temporary URL in the meantime

2. **Namecheap DNS not configured**
   - Go to Namecheap Advanced DNS
   - Ensure A or CNAME record points to Railway
   - Save changes

3. **Railway deployment failed**
   - Check Railway "Deployments" tab
   - Click "View logs" to see errors
   - Common fix: Restart deployment

### Issue: App loads but styling/images missing

**Solution:**
- Clear browser cache (Ctrl+Shift+Delete)
- Try incognito/private browsing
- Wait 5 minutes for CDN cache to update

### Issue: Forms not submitting

**Solution:**
- Check browser console (F12) for errors
- Verify PRODUCTION_DOMAIN variable is set
- Ensure environment variables deployed (check Railway logs)

### Issue: Email not sending

**Solution:**
- Verify MAILERSEND_API_KEY is set (if using email)
- Verify MAILERSEND_SENDER_EMAIL is set
- Check MailerSend account status
- See EMAIL_SETUP_QUICK_START.md for details

---

## 📞 SUPPORT RESOURCES

### Railway Help
- Docs: https://docs.railway.app
- Status: https://status.railway.app
- Support: Railway Dashboard → Help

### Namecheap DNS Help
- DNS Guide: https://www.namecheap.com/support/knowledgebase/
- DNS Propagation: https://www.whatsmydns.net/

### System Documentation
- Quick Start: QUICK_START_DEPLOYMENT.md
- Complete Guide: HOSTING_AND_DEPLOYMENT_GUIDE.md
- Troubleshooting: DEPLOYMENT_CHECKLIST_PRACTICAL.md

---

## 📊 YOUR DEPLOYMENT SUMMARY

| Item | Status | Details |
|------|--------|---------|
| **Domain** | ✅ Ready | sdo-sipalay.leavemanagement.aisa |
| **Hosting** | ✅ Railway.app | Production grade |
| **SSL/HTTPS** | ✅ Automatic | Green lock icon |
| **Uptime** | ✅ 99.9% | Railway guaranteed |
| **Cost** | ✅ $5-15/month | Pay as you go |
| **Support** | ✅ 24/7 | Railway + Namecheap |

---

## ✅ FINAL CHECKLIST

- [ ] GitHub account created & code pushed
- [ ] Railway account created
- [ ] App deployed to Railway
- [ ] Environment variables set
- [ ] Tested on temporary Railway URL
- [ ] Namecheap DNS configured
- [ ] Custom domain added to Railway
- [ ] Domain tested (might need to wait for DNS)
- [ ] PRODUCTION_DOMAIN variable updated
- [ ] Team has the live URL
- [ ] System is **LIVE** ✅

---

## 🎉 YOU'RE LIVE!

Your Leave Form System is now **publicly accessible** at:

### 🌐 https://sdo-sipalay.leavemanagement.aisa

**Congratulations!** Your system is live and ready for your team to use! 🚀

---

## 📋 WHAT HAPPENS NEXT

### First Week
- Monitor system for errors (check Railway logs)
- Train users on system usage
- Verify all portals working
- Collect feedback

### This Month
- Set up automated backups
- Configure email notifications (if not done)
- Plan any feature enhancements
- Document any custom changes

### Ongoing Maintenance
- Weekly data backups
- Monthly dependency updates
- Monitor performance metrics
- Plan for scaling if needed

---

## 🎯 QUICK REFERENCE

**Your System URLs:**
- Main: `https://sdo-sipalay.leavemanagement.asia`
- Employee: `https://sdo-sipalay.leavemanagement.asia/login`
- AO: `https://sdo-sipalay.leavemanagement.asia/ao-login`
- HR: `https://sdo-sipalay.leavemanagement.asia/hr-login`
- ASDS: `https://sdo-sipalay.leavemanagement.asia/asds-login`
- SDS: `https://sdo-sipalay.leavemanagement.asia/sds-login`

**Management URLs:**
- Railway: https://railway.app (manage deployment)
- Namecheap: https://www.namecheap.com/dashboard (manage domain)
- GitHub: https://github.com (manage code)

---

**Deployment Date:** February 9, 2026  
**System:** Leave Form Management System  
**Status:** ✅ LIVE at sdo-sipalay.leavemanagement.aisa  
**Domain Provider:** Namecheap  
**Hosting Platform:** Railway.app  

---

**Your system is LIVE! Enjoy! 🎊**
