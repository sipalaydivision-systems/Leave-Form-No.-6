# Force Leave & Special Privilege Leave Balance Validation

## 📋 Summary
Implemented comprehensive validation to prevent employees from applying for Force Leave (5-day yearly limit) or Special Privilege Leave (3-day yearly limit) when they have exhausted their annual allocation.

---

## ✅ What Was Fixed

### Issue Identified
**Before**: Employees could apply for Force Leave and SPL without any restrictions, even after using their entire yearly allocation.

**Now**: System prevents applications when:
- **Force Leave (leave_mfl)**: `forceLeaveSpent >= 5 days` ❌
- **Special Privilege Leave (leave_spl)**: `splSpent >= 3 days` ❌

---

## 🔧 Implementation Details

### 1. **Frontend Validation** (`leave_form.html`)

#### New Function: `validateFixedLeaveAvailability(leaveTypeId)`
- **Location**: Lines 1630-1667
- **Purpose**: Prevents checkbox selection when balance is exhausted
- **Logic**:
  ```javascript
  // Force Leave: 5 days yearly
  if (leaveType === 'leave_mfl' && forceBalance <= 0) {
      alert('❌ Cannot Apply for Force Leave\n\nYou have exhausted your yearly Force Leave allocation (5 days).');
      return false;
  }
  
  // SPL: 3 days yearly
  if (leaveType === 'leave_spl' && splBalance <= 0) {
      alert('❌ Cannot Apply for Special Privilege Leave\n\nYou have exhausted your yearly Special Privilege Leave allocation (3 days).');
      return false;
  }
  ```

#### Enhanced Leave Type Selection
- **Location**: Lines 1669-1671 (event listener)
- **Change**: Calls `validateFixedLeaveAvailability()` before allowing checkbox selection
- **Effect**: User cannot select Force Leave or SPL if balance is 0

#### Enhanced Form Submission
- **Location**: Lines 2008-2048 (form submit event)
- **Validation**: Double-checks balance before sending application
- **Effect**: Prevents accidental submission if balance changed between form load and submit

---

### 2. **Server-Side Validation** (`server.js`)

#### Endpoint: `POST /api/submit-leave` (Lines 1491-1544)
- **New Validation Block**: Lines 1495-1535
- **Checks**:
  ```javascript
  // Gets employee's leave card data
  const employeeLeave = leavecards.find(lc => lc.email === employeeEmail);
  
  // Force Leave check
  if (leaveType === 'leave_mfl' && forceLeaveSpent >= 5) {
      return res.status(400).json({
          success: false,
          error: 'Force Leave exhausted',
          message: 'You have already used all 5 days of your yearly Force Leave allocation.'
      });
  }
  
  // SPL check
  if (leaveType === 'leave_spl' && splSpent >= 3) {
      return res.status(400).json({
          success: false,
          error: 'SPL exhausted',
          message: 'You have already used all 3 days of your yearly Special Privilege Leave allocation.'
      });
  }
  ```
- **Response Code**: `400 Bad Request` if validation fails
- **Logging**: `[VALIDATION] Force Leave rejected for {email}: Already spent {X}/5 days`

#### Endpoint: `POST /api/resubmit-leave` (Lines 1963-2031)
- **New Validation Block**: Lines 1986-2019
- **Purpose**: Prevents resubmission of Force/SPL applications if balance was exhausted after original rejection
- **Same Logic**: Checks `forceLeaveSpent >= 5` and `splSpent >= 3`
- **Logging**: `[VALIDATION] Force Leave rejected for resubmit {email}: Already spent {X}/5 days`

---

## 📊 Balance Calculation

### Force Leave Annual Allocation
```
Available = 5 days (fixed yearly)
Balance = 5 - forceLeaveSpent
Exhausted when: forceLeaveSpent >= 5
```

### Special Privilege Leave Annual Allocation
```
Available = 3 days (fixed yearly)
Balance = 3 - splSpent
Exhausted when: splSpent >= 3
```

---

## 🧪 Testing Scenarios

### Test Case 1: Force Leave Exhaustion
**Setup**: Employee with `forceLeaveSpent: 5`
1. Open leave form
2. Try to select "Force Leave (MFL)" checkbox
3. **Expected**: Alert appears, checkbox cannot be selected
4. **Result**: ✅ Prevented

### Test Case 2: SPL Exhaustion
**Setup**: Employee with `splSpent: 3`
1. Open leave form
2. Try to select "Special Privilege Leave" checkbox
3. **Expected**: Alert appears, checkbox cannot be selected
4. **Result**: ✅ Prevented

### Test Case 3: Force Leave Available
**Setup**: Employee with `forceLeaveSpent: 3` (2 days remaining)
1. Open leave form
2. Select "Force Leave (MFL)" checkbox
3. **Expected**: Selection succeeds, form loads normally
4. **Result**: ✅ Allowed

### Test Case 4: SPL Available
**Setup**: Employee with `splSpent: 2` (1 day remaining)
1. Open leave form
2. Select "Special Privilege Leave" checkbox
3. **Expected**: Selection succeeds, form loads normally
4. **Result**: ✅ Allowed

### Test Case 5: Force Leave Exhausted During Form Entry
**Setup**: Employee starts application before exhaustion, data updated after form loaded
1. Employee loads form with Force Leave (4 days used, 1 remaining)
2. Another approval brings it to 5 days used
3. Employee tries to submit application
4. **Expected**: Server validation rejects with 400 error
5. **Result**: ✅ Prevented

---

## 📝 Files Modified

### [leave_form.html](leave_form.html#L1630-L1730)
- **Added**: `validateFixedLeaveAvailability()` function (38 lines)
- **Modified**: Leave type checkbox event listeners to call validation (3 lines)
- **Modified**: Form submission to include double-check validation (41 lines)
- **Total Changes**: 82 lines added

### [server.js](server.js#L1491-L1544)
- **Modified**: `POST /api/submit-leave` endpoint (41 lines added)
- **Modified**: `POST /api/resubmit-leave` endpoint (34 lines added)
- **Added Logging**: Validation messages for audit trail
- **Total Changes**: 75 lines added

---

## 🔒 Security Features

1. **Frontend Prevention**: Blocks UI selection before form submission
2. **Server-Side Enforcement**: Validates all requests to prevent bypass
3. **Double Validation**: Both selection and submission validated
4. **Resubmit Protection**: Validates even for amended resubmissions
5. **Audit Logging**: Console logs all validation rejections for tracking

---

## 🎯 User Experience

### Before
- Employee could check Force Leave box
- Employee could fill entire form
- Application rejected with generic error
- Frustrating for end user

### After
- Employee cannot check Force Leave if exhausted
- Clear message explaining the yearly limit
- Immediate feedback before wasting time on form
- Better user experience

---

## ⚠️ Yearly Reset Logic

**Note**: Force Leave and SPL balances should reset to 0 spent on January 1st each year.
- Currently tracked by: `forceLeaveSpent` and `splSpent` fields
- Reset mechanism should be implemented annually (TBD in future)
- Current implementation assumes within same fiscal year

---

## 📌 Related Fields in Database

```json
{
  "email": "employee@deped.gov.ph",
  "forceLeaveSpent": 5,        // 0-5 (yearly cumulative)
  "splSpent": 3                 // 0-3 (yearly cumulative)
}
```

---

## ✨ Benefits

✅ Prevents policy violations (yearly limits enforced)
✅ Reduces administrative burden (no rejected forms to reprocess)
✅ Improves employee satisfaction (clear immediate feedback)
✅ Maintains data integrity (server-side validation)
✅ Provides audit trail (console logging for compliance)

---

**Status**: ✅ Implemented and Tested
**Date**: 2026-02-05
**Version**: 1.0
