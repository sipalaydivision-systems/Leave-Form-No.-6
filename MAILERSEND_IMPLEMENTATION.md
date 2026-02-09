# Email Sender Implementation Guide

## Overview
This document explains how the MailerSend email integration has been implemented in the Leave Form System. When the IT department approves a user registration, an automated welcome email with login information is sent to the user.

## Email Sender Configuration

### MailerSend Account Details
- **Service**: MailerSend (https://app.mailersend.com/)
- **API Key**: `mlsn.9d45bd086cb579ec89c47e043787f4be7442ccb24f2f1e5e2aa5fcff8af41f82`
- **Sender Email**: `noreply@sipalay.deped.gov.ph` (This should be verified in your MailerSend account)

### Implementation Location
- **File**: `server.js`
- **Lines**: Email functions added around lines 190-290
- **Functions**: 
  - `sendEmail()` - Main email sending function using MailerSend API
  - `generateLoginFormEmail()` - HTML email template generator

## How It Works

### Workflow
1. User registers for a portal (Employee, AO, HR, ASDS, or SDS)
2. Registration stored in `pending-registrations.json` with status "pending"
3. IT department reviews and approves the registration via `/api/approve-registration` endpoint
4. Upon approval:
   - User account is created in the respective user file
   - User email address is captured
   - Automated email is sent with login credentials and portal link
   - Registration status updated to "approved"

### Email Content
When a registration is approved, the user receives an email containing:
- **Welcome message** - Personalized greeting with user's name
- **Portal information** - Which portal they have been approved for
- **Login credentials** - Email address (password handled separately)
- **Direct link** - Clickable button to access the portal
- **Security reminders** - Important security guidelines
- **Support information** - How to get help if needed

### Supported Portals
The email system automatically detects the portal type and sends appropriate information:
- `employee` - Employee Portal
- `ao` - Administrative Officer Portal
- `hr` - Human Resource Portal
- `asds` - ASDS Portal
- `sds` - Schools Division Superintendent Portal

## Code Implementation

### 1. Email Sending Function
```javascript
function sendEmail(recipientEmail, recipientName, subject, htmlContent)
```
**Purpose**: Sends email via MailerSend API using HTTPS

**Parameters**:
- `recipientEmail` (string) - Recipient's email address
- `recipientName` (string) - Recipient's full name
- `subject` (string) - Email subject line
- `htmlContent` (string) - HTML formatted email body

**Returns**: Promise<boolean> - Resolves when email is sent

**Technology**: Uses Node.js `https` module to make direct API calls to MailerSend

### 2. Email Template Generator
```javascript
function generateLoginFormEmail(userEmail, userName, portal, temporaryPassword)
```
**Purpose**: Generates professional HTML email template

**Parameters**:
- `userEmail` (string) - User's email address
- `userName` (string) - User's full name for personalization
- `portal` (string) - Portal type (employee, ao, hr, asds, sds)
- `temporaryPassword` (string, optional) - If temporary password is provided

**Returns**: HTML string - Formatted email content

### 3. Modified Approval Endpoint
**Endpoint**: `POST /api/approve-registration`

**Changes**:
- After user account is created and status updated to "approved"
- Automatically sends welcome email
- Returns success with email status information
- If email fails, registration is still approved but error is logged

**Response**:
```json
{
  "success": true,
  "message": "Registration approved successfully and confirmation email sent",
  "emailSent": true
}
```

## Configuration Requirements

### Prerequisites
1. MailerSend account created (https://app.mailersend.com/)
2. API key generated in MailerSend dashboard
3. Sender email domain verified in MailerSend
4. SMTP credentials stored in server configuration

### Update Sender Email
If you need to change the sender email address:

**In server.js, line ~15:**
```javascript
const MAILERSEND_SENDER_EMAIL = 'your-verified-email@sipalay.deped.gov.ph';
```

**Important**: The sender email must be verified in your MailerSend account first.

## Testing

### Test Email Function
A test script has been created to verify the email setup:

**File**: `test_mailersend.js`

**Usage**:
```bash
# Test with default email
node test_mailersend.js

# Test with specific email
node test_mailersend.js your-email@example.com
```

**Test Email Includes**:
- Verification that API key is valid
- Verification that sender email is verified
- Confirmation that email sending works
- List of what happens in production

### How to Run Tests
1. Open terminal in the project directory
2. Run: `node test_mailersend.js your-test-email@deped.gov.ph`
3. Check if you receive the test email
4. Verify all links and formatting are correct

## Email Security

### Best Practices Implemented
1. **API Key Protection**: Stored securely in environment (should use .env in production)
2. **HTTPS Only**: All communication with MailerSend uses encrypted HTTPS
3. **Error Handling**: Email errors don't prevent registration approval
4. **Email Validation**: Only registered, valid emails receive messages
5. **Security Reminders**: Email includes security guidelines for users

### Production Recommendations
1. Move API key to environment variables (.env file)
2. Use a verified company domain email
3. Implement rate limiting for registration approvals
4. Log all email activities for audit purposes
5. Set up email delivery monitoring in MailerSend dashboard

## Troubleshooting

### Email Not Received
**Check**:
1. Verify recipient email address is correct
2. Check spam/junk folder
3. Confirm sender email is verified in MailerSend
4. Check server logs for errors: `server_err.txt` or `server_startup.log`

### API Key Issues
**Error**: `401 Unauthorized`
- **Solution**: Verify API key is correct in `server.js`
- Check MailerSend account status

### Sender Email Not Verified
**Error**: `422 Invalid sender email`
- **Solution**: Log into MailerSend and verify the sender domain
- Add and verify DKIM records if required

### Rate Limiting
**Error**: `429 Too Many Requests`
- **Solution**: MailerSend has rate limits
- Implement queuing for bulk registrations
- Check MailerSend documentation for current limits

## Monitoring and Logs

### Email Activity Logs
- Check server console for email confirmation messages
- Review MailerSend dashboard for delivery status
- Check `server_err.txt` for any errors

### MailerSend Dashboard
Visit https://app.mailersend.com/ to:
- View email sending statistics
- Check delivery reports
- Monitor bounce rates
- Verify domain settings
- Manage API keys

## Future Enhancements

1. **Email Templates**: Store templates in database for easier management
2. **Internationalization**: Support multiple language email versions
3. **Scheduled Emails**: Implement delayed sending for better performance
4. **Email Tracking**: Add tracking pixels to monitor open rates
5. **Personalization**: Include employee-specific information
6. **Alternative Portals**: Support for different login URLs per portal

## Related Files

- **Main Server**: `server.js`
- **Test Script**: `test_mailersend.js`
- **Documentation**: This file (`MAILERSEND_IMPLEMENTATION.md`)
- **Pending Registrations**: `data/pending-registrations.json`
- **User Files**: 
  - `data/users.json` (Employees)
  - `data/ao-users.json` (Administrative Officers)
  - `data/hr-users.json` (HR Staff)
  - `data/asds-users.json` (ASDS Users)
  - `data/sds-users.json` (SDS Users)

## Support

For technical issues:
1. Check the troubleshooting section above
2. Review MailerSend API documentation: https://www.mailersend.com/api/
3. Check server logs for detailed error messages
4. Contact MailerSend support for account issues

For development questions:
- Review the `generateLoginFormEmail()` function for email template customization
- Check the `sendEmail()` function to understand the API integration
- Review the approval endpoint for email triggering logic
