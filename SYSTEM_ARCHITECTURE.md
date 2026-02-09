# Administrative Officer Portal - System Architecture

## 🏗️ Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT BROWSER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Employee      │  │ HR Staff     │  │ Admin Officer│ ← NEW!   │
│  │ (login.html)  │  │(hr-login)    │  │(ao-login)    │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                  │                  │                   │
│         ↓                  ↓                  ↓                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ dashboard.   │  │ hr-dashboard │  │ ao-dashboard│ ← NEW!    │
│  │ html         │  │ (implied)    │  │ .html        │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                  │                  │                   │
│  ┌──────▼───────────────────▼──────────────────▼────────┐        │
│  │           JavaScript Frontend Code                   │        │
│  │   - Form validation                                  │        │
│  │   - Session management (sessionStorage)             │        │
│  │   - Fetch API calls to backend                      │        │
│  └──────────────────────┬───────────────────────────────┘        │
│                         │                                         │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
                HTTP/HTTPS│ JSON
                          │
        ┌─────────────────▼─────────────────┐
        │   EXPRESS.JS SERVER (server.js)   │
        │   Port: 3000                      │
        ├───────────────────────────────────┤
        │  GET Routes:                      │
        │  - /                              │
        │  - /login                         │
        │  - /dashboard                     │
        │  - /leave-form                    │
        │  - /ao-login          ← NEW!     │
        │  - /ao-register       ← NEW!     │
        │  - /ao-dashboard      ← NEW!     │
        │  - [more routes...]               │
        └─────────────┬───────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
    ┌────────┐   ┌────────┐   ┌──────────┐
    │ API    │   │ File   │   │ Auth &   │
    │Handler │   │Handler │   │Validation│
    └────┬───┘   └────┬───┘   └────┬─────┘
         │            │            │
         └────────────┼────────────┘
                      │
    ┌─────────────────▼──────────────────┐
    │    FILE SYSTEM (data/ directory)   │
    ├────────────────────────────────────┤
    │  JSON Data Files:                  │
    │  - users.json (employees)          │
    │  - employees.json                  │
    │  - applications.json               │
    │  - leavecards.json                 │
    │  - hr_users.json                   │
    │  - asds-users.json                 │
    │  - sds-users.json                  │
    │  - ao-users.json        ← NEW!    │
    └────────────────────────────────────┘
```

## 🔄 Application Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION LIFECYCLE                        │
└─────────────────────────────────────────────────────────────────┘

1. EMPLOYEE SUBMISSION
   ┌─────────────────────┐
   │ Employee Portal     │
   │ - File Form No. 6   │
   │ - Submit Leave      │
   └──────────┬──────────┘
              │
              ▼
   ┌─────────────────────────┐
   │ Data stored in:         │
   │ /data/applications.json │
   │ Status: 'pending'       │
   │ ao_status: 'pending'    │ ← NEW field
   └──────────┬──────────────┘
              │
2. AO REVIEW (NEW!)
   ┌──────────────────────────┐
   │ Admin Officer Portal     │
   │ - Review Application     │
   │ - Check Compliance       │
   │ - Add Remarks            │
   │ - Approve/Reject         │
   └──────────┬───────────────┘
              │
     ┌────────┴────────┐
     │                 │
     ▼                 ▼
  APPROVED         REJECTED
     │                 │
     │          ┌──────▼─────────┐
     │          │ Notify Teacher │
     │          │ Application:   │
     │          │ ao_status =    │
     │          │ 'rejected'     │
     │          └────────────────┘
     │
     ▼
   ┌──────────────────────────┐
   │ HR Portal                │
   │ - Verify Leave Credits   │
   │ - Process Section 7      │
   │ - Make Recommendation    │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ ASDS Portal              │
   │ - Regional Review        │
   │ - Quality Assurance      │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ SDS Portal               │
   │ - Final Decision         │
   │ - Executive Sign-off     │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ APPROVED & ARCHIVED      │
   │ - Leave Approved         │
   │ - Credits Updated        │
   │ - Records Filed          │
   └──────────────────────────┘
```

## 📊 Database Schema

### Application Object with AO Fields

```
Application {
  // Core application data
  id: timestamp                    // Unique ID
  employeeId: string              // Employee reference
  email: string                   // Teacher email
  leaveType: string              // Type of leave
  dateFrom: string               // Start date (YYYY-MM-DD)
  dateTo: string                 // End date (YYYY-MM-DD)
  numberOfDays: number           // Calculated working days
  reason: string                 // Leave reason
  
  // Timeline
  submittedAt: ISO string        // When submitted
  date_filing: string            // Filing date
  
  // Original status fields
  status: string                 // Overall status
  hrApproved: boolean            // HR approval
  asdsApproved: boolean          // ASDS approval
  sdsApproved: boolean           // SDS approval
  
  // NEW: Administrative Officer fields
  ao_status: "pending" | "approved" | "rejected"
  ao_remarks: string             // Optional comment
  ao_approved_at: ISO string     // Approval timestamp
  ao_rejected_at: ISO string     // Rejection timestamp
  
  // Future levels
  approvals: Array               // Approval chain
}
```

### AO User Object

```
AOUser {
  id: timestamp              // Unique ID
  email: string             // Email address
  password: string          // SHA-256 hashed
  firstName: string         // First name
  lastName: string          // Last name
  name: string              // Full name (computed)
  school: string            // School/Division
  position: string          // Job title
  role: "ao"                // Always 'ao'
  createdAt: ISO string     // Registration date
}
```

## 🔌 API Request/Response Patterns

### 1. AO Registration

**Request:**
```
POST /api/ao-register
Content-Type: application/json

{
  "email": "ao@school.edu",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe",
  "school": "Sipalay Elementary",
  "position": "Admin Officer"
}
```

**Response:**
```json
{
  "success": true,
  "message": "AO account created successfully",
  "user": {
    "id": 1705001234567,
    "email": "ao@school.edu",
    "name": "John Doe",
    "role": "ao"
  }
}
```

### 2. AO Login

**Request:**
```
POST /api/ao-login
Content-Type: application/json

{
  "email": "ao@school.edu",
  "password": "SecurePass123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1705001234567,
    "email": "ao@school.edu",
    "name": "John Doe",
    "school": "Sipalay Elementary",
    "position": "Admin Officer",
    "role": "ao"
  }
}
```

### 3. Get Applications

**Request:**
```
GET /api/ao-applications
```

**Response:**
```json
{
  "success": true,
  "applications": [
    {
      "id": 1705002000000,
      "teacher_name": "Maria Santos",
      "leave_type": "leave_vl",
      "date_from": "2024-02-01",
      "date_to": "2024-02-05",
      "num_days": 5,
      "date_filing": "2024-01-20",
      "ao_status": "pending",
      "ao_remarks": ""
    },
    {
      "id": 1705002000001,
      "teacher_name": "Juan Cruz",
      "leave_type": "leave_sl",
      "date_from": "2024-02-15",
      "date_to": "2024-02-16",
      "num_days": 2,
      "date_filing": "2024-01-25",
      "ao_status": "approved",
      "ao_remarks": "Approved for medical leave"
    }
  ]
}
```

### 4. Approve Application

**Request:**
```
POST /api/ao-applications/1705002000000/approve
Content-Type: application/json

{
  "remarks": "Looks good, all requirements met"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Application approved successfully",
  "application": {
    "id": 1705002000000,
    "ao_status": "approved",
    "ao_remarks": "Looks good, all requirements met",
    "ao_approved_at": "2024-01-27T14:30:00Z"
  }
}
```

### 5. Reject Application

**Request:**
```
POST /api/ao-applications/1705002000000/reject
Content-Type: application/json

{
  "remarks": "Missing required documentation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Application rejected successfully",
  "application": {
    "id": 1705002000000,
    "ao_status": "rejected",
    "ao_remarks": "Missing required documentation",
    "ao_rejected_at": "2024-01-27T14:35:00Z"
  }
}
```

## 🎯 Component Interactions

```
┌─────────────────────────────────────────────────────────────────┐
│                    ao-dashboard.html                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   User Session                             │ │
│  │  - Check sessionStorage for 'user'                         │ │
│  │  - Redirect to login if missing                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Statistics Section                         │ │
│  │  - GET /api/ao-applications                               │ │
│  │  - Calculate: pending, approved, rejected counts          │ │
│  │  - Update card displays                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Filters Section                            │ │
│  │  - Filter by: status, leave type, teacher name           │ │
│  │  - Reset filters button                                   │ │
│  │  - Local array filtering (no new API call)                │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Applications Table                         │ │
│  │  - Display filtered applications                          │ │
│  │  - Each row: Name, Type, Dates, Days, Status, Filed Date │ │
│  │  - Action buttons: View, Approve, Reject                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Modal 1: View Details                      │ │
│  │  - Show full application information                      │ │
│  │  - Read-only fields                                       │ │
│  │  - Close button                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Modal 2: Approve/Reject                    │ │
│  │  - Textarea for remarks                                   │ │
│  │  - Confirm button                                         │ │
│  │  - POST to: /api/ao-applications/:id/approve or reject    │ │
│  │  - Refresh table after action                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🔐 Security Flow

```
┌──────────────┐
│ User enters  │
│ credentials  │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ Browser sends:       │
│ POST /api/ao-login   │
│ { email, password }  │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Server side:                 │
│ 1. Find user by email        │
│ 2. Hash submitted password   │
│ 3. Compare with stored hash  │
└──────┬───────────────────────┘
       │
  ┌────┴─────┐
  │           │
  ▼           ▼
MATCH     NOT MATCH
  │           │
  ▼           ▼
SUCCESS   ERROR 401
  │           │
  ▼           ▼
Send user  Send error
object     message
  │           │
  ▼           ▼
Browser    Browser
stores in  shows error
session    and waits
Storage    for retry
  │
  ▼
Redirect to
dashboard
```

## 📈 System Scalability

```
Current Setup:
┌────────────────────┐
│  5 Portal Types    │
│  - Employee        │
│  - HR              │
│  - ASDS            │
│  - SDS             │
│  - AO (NEW!)       │
└────────────────────┘

Scalable to add:
┌────────────────────┐
│  More Portal Types │
│  - Principal       │
│  - Budget Officer  │
│  - Records Officer │
│  - etc.            │
└────────────────────┘

Each follows same pattern:
[X]-login.html
[X]-register.html
[X]-dashboard.html
/api/[X]-login
/api/[X]-register
/data/[X]-users.json
```

---

**This architecture is:**
✅ Modular - Each portal is independent
✅ Scalable - Easy to add new portal types
✅ Secure - Password hashing, session management
✅ Maintainable - Clear separation of concerns
✅ Responsive - Works on all devices
