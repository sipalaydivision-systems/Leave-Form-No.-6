# Email Template Preview

## What Users Will Receive

When IT department approves a user registration, they will receive an email that looks like this:

---

## 📧 Email Layout

### Header Section
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│            ███████████████████████████              │
│            Registration Approved                    │
│            CS Form No. 6 - Application for Leave    │
│            ███████████████████████████              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Main Content
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│ Dear [USER NAME],                                   │
│                                                     │
│ Congratulations! Your registration for the          │
│ [PORTAL NAME] Portal has been approved by the       │
│ IT Department.                                      │
│                                                     │
│ You can now access the Leave Form System using      │
│ your credentials:                                   │
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ Email: [USER EMAIL ADDRESS]                   │  │
│ │ Password: Use the password you registered     │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ To access the system, click the button below:       │
│                                                     │
│         [ACCESS LEAVE FORM PORTAL]                  │
│                                                     │
│ ┌───────────────────────────────────────────────┐  │
│ │ Portal: [PORTAL NAME] Portal                  │  │
│ │ Direct Link: [LOGIN URL]                      │  │
│ └───────────────────────────────────────────────┘  │
│                                                     │
│ Important Security Reminders:                       │
│ • Never share your password with anyone             │
│ • Log out after each session, especially on shared  │
│   computers                                         │
│ • If you forgot your password, use the "Forgot      │
│   Password" option on the login page                │
│ • Report any suspicious activity to the IT          │
│   Department immediately                            │
│                                                     │
│ If you have any questions or technical issues       │
│ accessing the portal, please contact the IT         │
│ Department.                                         │
│                                                     │
│ Best regards,                                       │
│ DepEd Sipalay Division                              │
│ Information Technology Department                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Footer
```
┌─────────────────────────────────────────────────────┐
│ This is an automated email from the Leave Form       │
│ System. Please do not reply to this email.           │
│ © 2026 DepEd Sipalay Division. All rights reserved. │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Email Details

| Property | Value |
|----------|-------|
| **From** | noreply@sipalay.deped.gov.ph |
| **From Name** | DepEd Sipalay Leave Form |
| **Subject** | Registration Approved - Access Your Leave Form Portal |
| **Email Type** | HTML with responsive design |
| **Mobile Friendly** | Yes (responsive) |
| **Contains Links** | Yes (login button and direct link) |

---

## 🎨 Visual Styling

### Colors Used
- **Header Background**: Linear gradient from #003366 to #004080 (DepEd Blue)
- **Header Text**: White (#FFFFFF)
- **Body Background**: Light gray (#F5F5F5)
- **Container Background**: White (#FFFFFF)
- **Accents**: #003366 (DepEd Blue)
- **Warning Text**: #D9534F (Red for security warnings)
- **Background Alert**: #FFF3CD (Light yellow for credentials box)

### Typography
- **Font Family**: Arial, sans-serif (safe across email clients)
- **Header Font Size**: 24px, Bold
- **Body Font Size**: 14px, Regular
- **Line Height**: 1.6 (easy to read)

### Layout
- **Max Width**: 600px (optimized for all devices)
- **Container Width**: 100% with max-width
- **Padding**: Adequate spacing for professional appearance
- **Borders**: Subtle shadows and borders for definition

---

## 📱 Different Portal Examples

### Example 1: Employee Portal
```
Subject: Registration Approved - Access Your Leave Form Portal

Dear Juan Dela Cruz,

Congratulations! Your registration for the Employee Portal 
has been approved by the IT Department.

Portal: Employee Portal
Direct Link: http://localhost:3000/login
```

### Example 2: Administrative Officer Portal
```
Subject: Registration Approved - Access Your Leave Form Portal

Dear Maria Santos,

Congratulations! Your registration for the Administrative 
Officer Portal has been approved by the IT Department.

Portal: Administrative Officer Portal
Direct Link: http://localhost:3000/ao-login
```

### Example 3: HR Portal
```
Subject: Registration Approved - Access Your Leave Form Portal

Dear Pedro Garcia,

Congratulations! Your registration for the Human Resource 
Portal has been approved by the IT Department.

Portal: Human Resource Portal
Direct Link: http://localhost:3000/hr-login
```

### Example 4: ASDS Portal
```
Subject: Registration Approved - Access Your Leave Form Portal

Dear Rosa Reyes,

Congratulations! Your registration for the ASDS Portal has 
been approved by the IT Department.

Portal: ASDS Portal
Direct Link: http://localhost:3000/asds-login
```

### Example 5: SDS Portal
```
Subject: Registration Approved - Access Your Leave Form Portal

Dear Carlos Fernandez,

Congratulations! Your registration for the Schools Division 
Superintendent Portal has been approved by the IT Department.

Portal: Schools Division Superintendent Portal
Direct Link: http://localhost:3000/sds-login
```

---

## ✉️ How Email Clients Display It

### Desktop Email Clients (Outlook, Gmail, Apple Mail)
- Full HTML rendering with formatting
- All colors and images display
- Clickable buttons work perfectly
- Professional appearance maintained

### Mobile Email Clients (Gmail Mobile, Outlook Mobile)
- Responsive design adapts to screen size
- Text remains readable
- Buttons scale appropriately
- Links work on touchscreen

### Web-based Email
- Full HTML support
- Images and styling visible
- Professional formatting preserved
- Accessible from any browser

---

## 🔗 Links in Email

### 1. Main Action Button
```
Text: "Access Leave Form Portal"
URL: Depends on portal type:
  - Employee: http://localhost:3000/login
  - AO: http://localhost:3000/ao-login
  - HR: http://localhost:3000/hr-login
  - ASDS: http://localhost:3000/asds-login
  - SDS: http://localhost:3000/sds-login
```

### 2. Direct Link Text
```
Clickable text version of the same URLs
Allows users to manually copy URL if needed
```

---

## 📊 Email Content Summary

### Included Information
✅ Personalized greeting with user's full name
✅ Portal name they're approved for
✅ Email address (login username)
✅ Direct action button to login
✅ Direct URL link
✅ Security guidelines
✅ Contact information for support
✅ DepEd Sipalay branding

### NOT Included (For Security)
❌ Password or temporary password
❌ API keys or sensitive credentials
❌ Database information
❌ Admin account details
❌ System paths or structure information

---

## 🔒 Security Features

### Email Security
- HTTPS encrypted transmission
- API key authentication
- MailerSend platform security
- No sensitive data in plain text

### User Guidance
- Reminds not to share password
- Advises to logout on shared computers
- Instructions for password recovery
- Encourages reporting suspicious activity

### Professional Appearance
- Branded with DepEd colors
- Professional layout
- Clear and unambiguous messaging
- Trustworthy appearance

---

## 📱 Responsive Design

The email automatically adapts to:
- **Desktop** (full width, side-by-side layout if applicable)
- **Tablet** (medium width, adjusted padding)
- **Mobile** (full width, stacked layout, larger touch targets)
- **Narrower displays** (flexible font sizes)

---

## 🎯 User Experience Flow

1. User registers and waits for approval
2. IT reviews and clicks "Approve"
3. **User receives email within 1-3 minutes**
4. User clicks "Access Leave Form Portal" button
5. User is taken to appropriate login page
6. User enters email and password
7. User logs in successfully

---

## 📊 Email Metrics

You can track in MailerSend Dashboard:
- Total emails sent
- Emails delivered
- Emails opened
- Links clicked
- Bounce rate
- Spam complaints
- Unsubscribe rate

---

## 🧪 Testing

To see exactly how the email will look:

### Option 1: Run Test Script
```bash
node test_mailersend.js your-email@deped.gov.ph
```
You'll receive the test email that shows the email system

### Option 2: Complete Registration Flow
1. Register a test user
2. Go to IT Dashboard
3. Approve the registration
4. Check your email

### Option 3: View HTML Template
The HTML code is in `server.js` in the `generateLoginFormEmail()` function (lines ~200-280)

---

## 🛠️ Customization

To customize the email template:

### Change Colors
In `generateLoginFormEmail()` function, modify the `<style>` section:
```css
.header { background: linear-gradient(135deg, #YOUR_COLOR_1 0%, #YOUR_COLOR_2 100%); }
```

### Change Text
Modify the template text in the HTML content:
```javascript
"Dear <strong>${userName}</strong>," // Change this text
```

### Add Logo
Insert image tag in header:
```html
<img src="your-logo-url" alt="Logo" style="max-width: 100px;">
```

### Change Sender Name
Modify in `sendEmail()` function:
```javascript
from: {
    email: MAILERSEND_SENDER_EMAIL,
    name: 'Your Custom Name'
}
```

---

## 📞 Support

For email formatting issues:
- Check browser rendering of HTML
- Test across different email clients
- Verify images load correctly
- Check link functionality
- Monitor MailerSend delivery reports

For content changes:
- Edit `generateLoginFormEmail()` function in server.js
- Test changes with `test_mailersend.js`
- Verify formatting in email client
- Deploy to production when satisfied

---

This email template provides a professional, secure, and user-friendly introduction to the Leave Form System!
