# 🚀 Complete Hosting & Deployment Guide for Leave Form System

## Overview
Your Leave Form System is ready to deploy! This guide covers hosting options and step-by-step deployment instructions.

---

## 📊 Current System Details
- **Application Type**: Node.js Express Web Application
- **Current Port**: 3000
- **Dependencies**: Express, CORS, Body-Parser, ExcelJS, XLSX
- **Data Storage**: JSON files (file-based)
- **Authentication**: Built-in user authentication system
- **Email Service**: MailerSend integration

---

## 🏠 Hosting Options & Recommendations

### Option 1: **Railway.app** ⭐ RECOMMENDED (Easiest)
- **Cost**: $5-10/month (pay-as-you-go)
- **Setup Time**: 5-10 minutes
- **Pros**: 
  - One-click GitHub deployment
  - Automatic SSL/HTTPS
  - Built-in domain management
  - Free tier available
  - Perfect for Node.js apps
- **Cons**: Small cold starts

**Best for**: Quick deployment with minimal configuration

---

### Option 2: **Render.com** (Simple & Reliable)
- **Cost**: Free tier available, $7+/month for production
- **Setup Time**: 10-15 minutes
- **Pros**:
  - Easy GitHub integration
  - Free SSL certificates
  - Good uptime
  - Generous free tier
- **Cons**: Free tier services spin down after 15 min inactivity

**Best for**: Cost-conscious deployments

---

### Option 3: **Heroku** (Mature but Paid)
- **Cost**: $7+/month (free tier discontinued)
- **Setup Time**: 10-15 minutes
- **Pros**:
  - Very reliable
  - Excellent documentation
  - Add-ons ecosystem
- **Cons**: Now requires paid plan

**Best for**: Enterprise environments

---

### Option 4: **Azure App Service** (If DepEd uses Azure)
- **Cost**: $10-50+/month depending on tier
- **Setup Time**: 15-20 minutes
- **Pros**:
  - Enterprise integration
  - Scalable
  - SQL Server support
- **Cons**: More complex setup

**Best for**: Enterprise/Government deployments

---

### Option 5: **Self-Hosted on VPS** (Advanced)
- **Cost**: $5-20/month (DigitalOcean, Linode, etc.)
- **Setup Time**: 30+ minutes
- **Pros**:
  - Full control
  - No vendor lock-in
- **Cons**: Requires Linux/DevOps knowledge

**Best for**: Full control and customization

---

## ✅ Pre-Deployment Checklist

Before deploying, complete these steps:

### 1. **Environment Variables Setup**
```
Required Environment Variables:
- PORT (default: 3000)
- NODE_ENV (set to 'production')
- MAILERSEND_API_KEY (your MailerSend API key)
- MAILERSEND_SENDER_EMAIL (your MailerSend verified email)
- PRODUCTION_DOMAIN (your actual domain, e.g., leaveform.deped.gov.ph)
```

### 2. **Update CORS Configuration**
In `server.js` line 124-125, update:
```javascript
origin: process.env.NODE_ENV === 'production' 
    ? [process.env.PRODUCTION_DOMAIN || 'https://yourdomain.deped.gov.ph']
    : '*'
```

### 3. **Fix Hardcoded URLs**
In `server.js` line 433, replace:
```javascript
// OLD:
const loginUrl = `http://localhost:3000/${portal === 'employee' ? 'login' : `${portal}-login`}`;

// NEW:
const baseUrl = process.env.NODE_ENV === 'production' 
    ? process.env.PRODUCTION_DOMAIN 
    : 'http://localhost:3000';
const loginUrl = `${baseUrl}/${portal === 'employee' ? 'login' : `${portal}-login`}`;
```

### 4. **Verify Data Persistence Strategy**
Current system uses JSON files. For production, consider:
- **Keep JSON**: Simple, good for small teams (current setup)
- **Switch to MongoDB**: Better for scaling (requires migration)
- **Switch to PostgreSQL**: Enterprise solution (requires migration)

For now, JSON files work if:
- ✅ You're backing up data regularly
- ✅ Hosting supports persistent file storage
- ✅ User base is < 1000 people

### 5. **API Key Security**
- Remove exposed MailerSend API key from code
- Use environment variables only
- Never commit .env files to GitHub

---

## 🚀 QUICK START: Deploy to Railway.app (Recommended)

### Step 1: Prepare Repository
```bash
# Initialize git (if not already done)
cd "f:\Division Files\Leave Form No. 6"
git init
git add .
git commit -m "Initial commit - Leave Form System"
git branch -M main

# Push to GitHub
# 1. Create new repo on GitHub.com
# 2. Add remote and push:
git remote add origin https://github.com/YOUR_USERNAME/leave-form.git
git push -u origin main
```

### Step 2: Connect to Railway
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub"
4. Authorize & select your repository
5. Railway auto-detects Node.js app

### Step 3: Set Environment Variables
In Railway dashboard:
1. Go to "Variables" tab
2. Add these variables:
   ```
   NODE_ENV=production
   PORT=3000
   MAILERSEND_API_KEY=your_actual_api_key
   MAILERSEND_SENDER_EMAIL=noreply@your-verified-domain.mlsender.net
   PRODUCTION_DOMAIN=https://leaveform-xxxx.up.railway.app
   ```

### Step 4: Deploy
1. Click "Deploy" button
2. Wait 2-3 minutes for deployment
3. Your app is live at the provided URL!

### Step 5: Custom Domain (Optional)
1. Buy domain from GoDaddy, Namecheap, etc.
2. In Railway settings, add custom domain
3. Update DNS records as instructed
4. Enable automatic SSL

---

## 🔧 Quick Setup for Other Platforms

### Render.com
```bash
# 1. Create Web Service
# 2. Connect your GitHub repo
# 3. Add settings:
Build Command: npm install
Start Command: npm start

# 4. Add environment variables in Settings → Environment
NODE_ENV=production
MAILERSEND_API_KEY=...
```

### Heroku (Using Heroku CLI)
```bash
# Install Heroku CLI first
heroku login
heroku create leave-form-app
git push heroku main
heroku config:set NODE_ENV=production
heroku config:set MAILERSEND_API_KEY=...
heroku open
```

---

## 📁 Data Backup Strategy

**Important**: Your system uses JSON files for storage. Implement backup:

### Automated Backup Option 1: cPanel Backup (If available)
- Most hosting includes automated backups
- Check your hosting provider's backup settings

### Automated Backup Option 2: Simple Backup Script
```javascript
// Add to server.js
const backupData = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const fs = require('fs');
    fs.copyFileSync('./data/leavecards.json', `./backups/leavecards-${timestamp}.json`);
    fs.copyFileSync('./data/applications.json', `./backups/applications-${timestamp}.json`);
    fs.copyFileSync('./data/users.json', `./backups/users-${timestamp}.json`);
};

// Run daily backup at 2 AM
setInterval(backupData, 24 * 60 * 60 * 1000);
```

### Manual Backup
- Download `data/` folder weekly from your server
- Store in secure location
- Archive older backups

---

## 🔒 Security Considerations for Production

### 1. Update CORS Origins
Change from `*` to specific domains only

### 2. Add HTTPS (Usually Automatic)
Most platforms provide automatic SSL

### 3. Implement Rate Limiting
Already in code (lines 14-44 in server.js)

### 4. Use Environment Variables
Never hardcode secrets

### 5. Add Authentication Headers
Consider adding API key validation

### 6. Database Security
If migrating to SQL: Use prepared statements

### 7. Regular Updates
Keep dependencies updated:
```bash
npm update
npm audit fix
```

---

## 📊 Performance Optimization

### 1. Enable Caching
```javascript
app.use(express.static('public', { maxAge: '1d' }));
```

### 2. Compress Responses
```bash
npm install compression
```

### 3. Monitor Performance
- Use Railway/Render built-in monitoring
- Set up error alerts

### 4. Scale as Needed
- Start on free tier
- Upgrade when traffic increases

---

## 🐛 Troubleshooting Deployment Issues

### Issue: "Cannot find module 'express'"
**Solution**: Run `npm install` before deploying

### Issue: "Port 3000 is already in use"
**Solution**: Railway handles port automatically, but check `PORT` env variable

### Issue: "Cannot connect to MailerSend"
**Solution**: Verify API key and sender email in environment variables

### Issue: "CORS error in browser"
**Solution**: Update `origin` in server.js to match production domain

### Issue: "Data files not found"
**Solution**: Ensure `data/` folder is included in deployment:
```bash
# Add to .gitignore (if not already there):
# node_modules/
# Don't add: data/
```

### Issue: "SSL Certificate error"
**Solution**: Most platforms auto-provide SSL; if not, use Let's Encrypt (free)

---

## 📈 Next Steps After Deployment

1. **Test Everything**
   - Test login with each portal type
   - Submit a test form
   - Verify email notifications work

2. **Monitor for Errors**
   - Check logs regularly
   - Set up error alerts

3. **Plan Database Migration** (if needed)
   - Current JSON system works for ~1000 users
   - Beyond that, consider PostgreSQL/MongoDB

4. **Set Up SSL Certificate Renewal**
   - Most platforms handle automatically
   - Verify annually

5. **Document Your Deployment**
   - Save your chosen platform docs
   - Document custom domain setup
   - Keep API keys secure

---

## 📞 Support Resources

- **Railway**: https://docs.railway.app
- **Render**: https://render.com/docs
- **Heroku**: https://devcenter.heroku.com
- **Node.js**: https://nodejs.org/en/docs/
- **Express.js**: https://expressjs.com

---

## 🎯 Recommended Action Plan

**For Fastest Deployment (Next 1 hour):**

1. ✅ Create GitHub account (if needed)
2. ✅ Push code to GitHub repository
3. ✅ Sign up for Railway.app (free tier)
4. ✅ Deploy via GitHub integration
5. ✅ Set environment variables
6. ✅ Test all features
7. ✅ Optional: Add custom domain

**Result**: Live system running at a public URL! 🎉

---

**Last Updated**: February 9, 2026
**System Version**: 1.0.0
**Status**: Ready for Production Deployment
