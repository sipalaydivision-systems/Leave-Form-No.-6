# Administrative Officer (AO) Portal Setup

## Overview
The Administrative Officer (AO) Portal has been successfully implemented as the first level of approval in the leave application workflow. Teachers submit leave applications through the Employee Portal, which then go to the Administrative Officer for initial review and approval before moving to HR and higher-level approvers.

## Portal Components

### 1. AO Login Page (`ao-login.html`)
- URL: `/ao-login`
- Allows Administrative Officers to log in with email and password
- Responsive design matching other portals
- Links to registration page for new AO accounts

### 2. AO Registration Page (`ao-register.html`)
- URL: `/ao-register`
- Allows new Administrative Officers to create accounts
- Collects: First Name, Last Name, Email, School/Division, Position, Password
- Form validation for password confirmation

### 3. AO Dashboard (`ao-dashboard.html`)
- URL: `/ao-dashboard`
- Main interface for Administrative Officers to review and approve leave applications
- Features:
  - **Statistics Dashboard**: Shows counts of pending, approved, rejected, and total applications
  - **Filtering**: Filter by status, leave type, or teacher name
  - **Application List**: Displays all leave applications with key details:
    - Teacher name
    - Leave type
    - Date range (from-to)
    - Number of working days
    - Status (Pending/Approved/Rejected)
    - Filed date
  - **Actions**: View details, Approve, or Reject buttons (only for pending applications)
  - **Modals**: 
    - View full application details
    - Add remarks when approving/rejecting

### 4. Backend Endpoints

#### Authentication Endpoints
- `POST /api/ao-register` - Register new AO account
  - Required: email, password, firstName, lastName, school, position
  - Response: New user object with ID, email, name, role

- `POST /api/ao-login` - Login with email/password
  - Required: email, password
  - Response: User object with ID, email, name, school, position, role

#### Application Management Endpoints
- `GET /api/ao-applications` - Get all pending applications
  - Returns: Array of applications awaiting AO review
  - Data includes: teacher name, leave type, dates, working days, status, remarks

- `POST /api/ao-applications/:appId/approve` - Approve an application
  - Required: appId (in URL path)
  - Body: remarks (optional)
  - Updates: Sets ao_status to 'approved', records timestamp

- `POST /api/ao-applications/:appId/reject` - Reject an application
  - Required: appId (in URL path)
  - Body: remarks (optional)
  - Updates: Sets ao_status to 'rejected', records timestamp

### 5. Data Storage
- AO Users: `/data/ao-users.json`
  - Stores: id, email, password (hashed), firstName, lastName, name, school, position, role, createdAt

- Applications: `/data/applications.json` (shared with other portals)
  - New fields for AO approval tracking:
    - `ao_status`: 'pending', 'approved', or 'rejected'
    - `ao_remarks`: Optional remarks from AO
    - `ao_approved_at`: Timestamp when approved
    - `ao_rejected_at`: Timestamp when rejected

## Workflow Integration

The AO Portal fits into the complete leave approval workflow:

```
Teacher (Employee Portal)
    ↓
File Leave Application
    ↓
Admin Officer (AO Portal) ← [FIRST APPROVAL LEVEL]
    ↓ (if approved)
HR Staff (HR Portal)
    ↓ (if approved)
ASDS Office (ASDS Portal)
    ↓ (if approved)
SDS (SDS Portal)
    ↓ (if approved)
APPROVED & ARCHIVED
```

## Home Page Integration
The AO Portal has been added to the home page (`index.html`):
- Portal card with description
- Direct link to AO Login page
- Features listed: Review, Approve/Reject, Add Remarks, Track Approvals
- Updated footer showing the complete approval workflow

## Security Features
- Password hashing using SHA-256
- User authentication required for all AO functions
- Session management via sessionStorage
- Role-based access control (ao_status fields)

## Installation & Running

1. **Start the Server**:
   ```bash
   node server.js
   ```

2. **Access the Portal**:
   - Home Page: `http://localhost:3000/`
   - AO Login: `http://localhost:3000/ao-login`
   - AO Registration: `http://localhost:3000/ao-register`
   - AO Dashboard: `http://localhost:3000/ao-dashboard` (requires login)

## Testing the AO Portal

1. **Create an AO Account**:
   - Go to `/ao-register`
   - Fill in all fields (email, password, name, school, position)
   - Click "Register Account"

2. **Login as AO**:
   - Go to `/ao-login`
   - Enter the credentials you just created
   - You'll be redirected to the AO Dashboard

3. **Review Applications**:
   - Applications from the Employee Portal will appear in the pending list
   - Filter by status, leave type, or teacher name
   - Click "View" to see full details
   - Click "Approve" or "Reject" to take action
   - Add optional remarks to explain your decision

## Notes
- All timestamps are recorded in ISO 8601 format
- Applications retain their data through the approval chain
- The system is fully responsive and works on mobile devices
- Session data is stored in browser sessionStorage for security
