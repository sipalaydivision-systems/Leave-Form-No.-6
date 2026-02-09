# Quick Setup - Email Sender for User Registration

## ✅ What Has Been Implemented

Your Leave Form System now automatically sends professional welcome emails when IT approves user registrations using **MailerSend**.

### Key Features:
- ✅ Automatic email sending on registration approval
- ✅ Professional HTML email templates
- ✅ Support for all portal types (Employee, AO, HR, ASDS, SDS)
- ✅ Personalized welcome messages
- ✅ Direct login links in emails
- ✅ Security guidelines included
- ✅ Error handling (email failure won't stop registration)

---

## 🔧 Configuration

### Email Configuration Details

**MailerSend Account**: https://app.mailersend.com/

**API Key**: 
```
mlsn.9d45bd086cb579ec89c47e043787f4be7442ccb24f2f1e5e2aa5fcff8af41f82
```

**Sender Email**: 
```
noreply@sipalay.deped.gov.ph
```

### Important: Verify Sender Email in MailerSend

Before sending emails to actual users, you MUST:

1. Go to https://app.mailersend.com/
2. Sign in to your account
3. Navigate to **Domains** or **Verified Domains**
4. Verify the domain `sipalay.deped.gov.ph`
5. Update DNS records as instructed by MailerSend

⚠️ **Without verification, emails may fail to send!**

---

## 📧 How It Works

### User Registration Flow:

```
1. User Registers
   ↓
2. Registration stored as "pending"
   ↓
3. IT Department Reviews Registration
   ↓
4. IT Clicks "Approve"
   ↓
5. ✉️ Welcome Email Sent Automatically
   ↓
6. User receives email with login credentials
```

### Email Content Includes:
- Welcome greeting
- Portal name they're approved for
- Login email address
- Direct link to login page
- Security reminders
- Support contact information

---

## 🧪 Testing the Email System

### Test Before Going Live

**Run the test script to verify everything works:**

```bash
# Open terminal in project directory
node test_mailersend.js your-test-email@deped.gov.ph
```

**Expected Result:**
- You should receive a test email within 2-3 minutes
- Email should be properly formatted with logo and colors
- All links should work

**If you don't receive email:**
1. Check spam/junk folder
2. Verify sender email is verified in MailerSend
3. Check server logs: `server_err.txt`
4. Verify API key is correct

---

## 🚀 How to Use

### Step 1: Start the Server
```bash
npm run dev
```

### Step 2: Register a User
- Visit http://localhost:3000/
- User completes registration form
- Registration stored with status "pending"

### Step 3: IT Department Approval
- IT staff goes to IT Dashboard
- Reviews pending registrations
- Clicks "Approve"
- ✉️ Email is sent automatically

### Step 4: User Receives Email
- User receives welcome email at registered email address
- Email contains login link and credentials
- User can now log in to the portal

---

## 📝 Files Modified and Created

### Modified:
- **server.js** - Added email functions and integrated into approval endpoint

### Created:
- **test_mailersend.js** - Email testing script
- **MAILERSEND_IMPLEMENTATION.md** - Detailed documentation
- **EMAIL_SETUP_QUICK_START.md** - This file

---

## ⚙️ Advanced Configuration

### Change Sender Email (if needed)

Edit `server.js` around line 15:

```javascript
const MAILERSEND_SENDER_EMAIL = 'your-new-email@sipalay.deped.gov.ph';
```

**Remember**: New email must be verified in MailerSend first!

### Environment Variables (Recommended for Production)

Create `.env` file:
```
MAILERSEND_API_KEY=mlsn.9d45bd086cb579ec89c47e043787f4be7442ccb24f2f1e5e2aa5fcff8af41f82
MAILERSEND_SENDER_EMAIL=noreply@sipalay.deped.gov.ph
```

Then update server.js to use them:
```javascript
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY || 'default-key';
const MAILERSEND_SENDER_EMAIL = process.env.MAILERSEND_SENDER_EMAIL || 'noreply@sipalay.deped.gov.ph';
```

---

## 🔍 Monitoring Emails

### MailerSend Dashboard
Log in to https://app.mailersend.com/ to:
- View email statistics
- Check delivery status
- Monitor bounce rates
- Verify domain settings

### Server Logs
- Check console output for "Email sent successfully" messages
- Check `server_err.txt` for any errors
- Check `server_startup.log` for detailed logs

---

## ❓ Troubleshooting

| Issue | Solution |
|-------|----------|
| Test email not received | Check spam folder, verify sender email in MailerSend |
| "API Key invalid" error | Copy the exact API key from MailerSend dashboard |
| "Sender email not verified" | Log into MailerSend and verify the sender domain |
| Emails slow to arrive | MailerSend may have rate limits; check dashboard |
| Email formatting broken | Use browser to view, some email clients have rendering issues |

---

## ✨ What Users Will See

### Email Appearance:
- Professional header with colors matching your portal
- Personalized greeting with user's name
- Clear information about which portal they're approved for
- **Large button**: "Access Leave Form Portal"
- Login credentials
- Security tips
- DepEd logo and branding

### Email Links:
- Main button goes to correct login page
- All links are clickable and functional
- Works on desktop and mobile devices

---

## 📞 Support

### For Email Issues:
1. Run test script: `node test_mailersend.js`
2. Check MailerSend account status
3. Review server logs
4. Check email address is valid

### For MailerSend Support:
- Visit: https://app.mailersend.com/support
- Check documentation: https://www.mailersend.com/api/

### For Code Issues:
- Review `MAILERSEND_IMPLEMENTATION.md`
- Check `server.js` lines ~190-290
- Look at email functions in detail

---

## 🎯 Next Steps

1. ✅ Verify sender email in MailerSend account
2. ✅ Run test script with your test email
3. ✅ Start server: `npm run dev`
4. ✅ Test registration workflow
5. ✅ Go live!

---

**That's it! Your email system is ready to use!** 🎉

When IT approves registrations, users will automatically receive professional welcome emails with login information.
