# ⚡ QUICK REFERENCE: Your Deployment Steps

## YOUR CUSTOM SETUP
- **Domain:** `sdo-sipalay.leavemanagement.aisa`
- **Hosting:** Railway.app
- **Domain Provider:** Namecheap
- **Time Needed:** 30-45 minutes

---

## 🚀 10 SIMPLE STEPS

### STEP 1: GitHub Setup (5 min)
```powershell
cd "f:\Division Files\Leave Form No. 6"
git init
git add .
git commit -m "Leave Form System - Production ready"
git branch -M main
```
Then create repo at https://github.com/new and push

### STEP 2: Push to GitHub (2 min)
```powershell
git remote add origin https://github.com/YOUR_USERNAME/leave-form-system.git
git push -u origin main
```

### STEP 3: Railway Account (2 min)
- Go to https://railway.app
- Click "Start Now"
- Choose "GitHub"
- Authorize

### STEP 4: Deploy (5 min)
- Click "+ New Project"
- Select "Deploy from GitHub repo"
- Choose `leave-form-system`
- Click "Deploy Now"
- Wait for "Build Successful" ✅

### STEP 5: Get Railway URL (1 min)
- View your deployment
- Copy the URL (save it!)
- Example: `https://leave-form-xxxx-production.up.railway.app`

### STEP 6: Set Environment Variables (3 min)
In Railway Variables tab, add:
```
NODE_ENV = production
PORT = 3000
PRODUCTION_DOMAIN = [Your Railway URL from Step 5]
```
Then click "Deploy"

### STEP 7: Test Railway URL (2 min)
- Visit your Railway URL from Step 5
- Verify page loads
- Test portals
- ✅ Should work!

### STEP 8: Configure Namecheap DNS (3 min)
1. Go to https://www.namecheap.com/dashboard
2. Click "Manage" for your domain
3. Go to "Advanced DNS" tab
4. Update DNS record to point to Railway
5. (Railway shows exact values in Custom Domains section)

### STEP 9: Add Domain to Railway (2 min)
1. Railway Settings → Custom Domains
2. Click "+ Add Custom Domain"
3. Enter: `sdo-sipalay.leavemanagement.aisa`
4. Follow DNS setup instructions
5. Wait for verification (15-30 min)

### STEP 10: Update & Test (2 min)
- Wait for DNS to propagate
- Visit: `https://sdo-sipalay.leavemanagement.aisa`
- Should load! ✅
- Update PRODUCTION_DOMAIN variable to your domain
- Test all portals

---

## ✅ CHECKLIST

- [ ] Step 1: Git initialized, code committed
- [ ] Step 2: Pushed to GitHub
- [ ] Step 3: Railway account created
- [ ] Step 4: Deployed to Railway
- [ ] Step 5: Got Railway URL
- [ ] Step 6: Set environment variables
- [ ] Step 7: Tested Railway URL works
- [ ] Step 8: Namecheap DNS configured
- [ ] Step 9: Domain added to Railway
- [ ] Step 10: Testing custom domain

---

## 🌐 YOUR LIVE URLS

Once deployed, your system will be at:

```
https://sdo-sipalay.leavemanagement.asia
```

Portal types:
- Employee: `/login`
- AO: `/ao-login`
- HR: `/hr-login`
- ASDS: `/asds-login`
- SDS: `/sds-login`

---

## ⏱️ TIMELINE

| Step | Task | Time | Cumulative |
|------|------|------|------------|
| 1-2 | GitHub setup & push | 7 min | 7 min |
| 3-4 | Railway deploy | 7 min | 14 min |
| 5-6 | Setup variables | 4 min | 18 min |
| 7 | Test Railway | 2 min | 20 min |
| 8 | Namecheap DNS | 3 min | 23 min |
| 9 | Add domain | 2 min | 25 min |
| 10 | Final test | 2 min | 27 min |
| - | **DNS wait** | **15-30 min** | **42-57 min** |

---

## 📞 QUICK LINKS

| What | Where |
|------|-------|
| GitHub | https://github.com |
| Railway | https://railway.app |
| Namecheap | https://www.namecheap.com/dashboard |
| DNS Check | https://www.whatsmydns.net/ |

---

## 🆘 QUICK FIXES

**"Can't reach domain"**
→ DNS still propagating, wait 15-30 min, use Railway URL temp

**"Page loads but styling broken"**
→ Clear cache (Ctrl+Shift+Delete), try incognito

**"Error 500"**
→ Check Railway logs, verify env variables set

**"Form doesn't submit"**
→ Check PRODUCTION_DOMAIN variable is correct

---

**Ready? Open: [DEPLOYMENT_GUIDE_CUSTOM_DOMAIN.md](./DEPLOYMENT_GUIDE_CUSTOM_DOMAIN.md)**

This has detailed step-by-step with screenshots guidance! 🚀
