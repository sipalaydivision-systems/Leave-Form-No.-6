# Integration Guide: Excel Formula Logic into AO Dashboard Leave Cards

## Quick Summary

The leave cards in the Excel files use a **running balance formula system** that must be corroborated with the current portal implementation. This guide shows how to integrate the proper formulas.

---

## Excel Formula Corroboration

### From Non-Teaching Personnel Leave Cards:

**Column Structure:**
| Col | Header | Purpose |
|-----|--------|---------|
| A | Period Covered | Date range of transaction |
| B | Vacation Leave Earned | New VL earned in period |
| C | Sick Leave Earned | New SL earned in period |
| D | Vacation Leave Spent | VL used by employee |
| E | Sick Leave Spent | SL used by employee |
| F | Force Leave Used | Forced leave deducted |
| G | Special Privilege Leave | SPL used |
| H | Vacation Balance | **Running VL balance** |
| I | Sick Leave Balance | **Running SL balance** |
| J | Total Balance | H + I |

### Formulas:

**Row 14 (Initial):**
```
H14 = B14                    (VL balance = earned amount)
I14 = C14                    (SL balance = earned amount)
J14 = H14 + I14              (Total = VL + SL)
```

**Rows 15+ (Running):**
```
H[n] = H[n-1] - F[n] - D[n] + B[n]
       Previous Balance - Force Leave Used - VL Spent + New VL Earned

I[n] = I[n-1] - E[n] + C[n]
       Previous Balance - SL Spent + New SL Earned

J[n] = H[n] + I[n]
       Vacation Balance + Sick Leave Balance
```

### Key Insights:

1. **Force Leave** (Column F):
   - Deducts from Vacation Balance
   - Does NOT appear as "spent" VL in employee records
   - Tracked separately for management purposes
   - Annual reset

2. **Each row depends on the previous row**:
   - Creates audit trail
   - Easy to verify math
   - Cumulative tracking

3. **Separate balances for each leave type**:
   - Vacation: Column H
   - Sick: Column I
   - Always recalculated from previous values

---

## Current Portal Issues

### Issue 1: No Period Tracking
**Problem:** When an application is approved, the system only deducts the days used but doesn't track earned periods.

**Example:**
```
Employee has initial balance: VL=100, SL=100

Employee applies for 5 days VL → System deducts → VL=95
BUT: System doesn't track that this 5 days came from "Period: [date]"
```

**Fix:** Track each transaction with its period using `leaveUsageHistory` array.

### Issue 2: Force Leave Handling
**Problem:** Force leave is deducted from VL/SL balance, but it shouldn't affect employee's actual available leave.

**Current Code (Line 2336):**
```javascript
leavecard.vl = Math.max(0, (leavecard.vl || 100) - vlUsed);
```

**Should Be:**
```javascript
// Force leave doesn't deduct from VL/SL
if (forceLeaveUsed > 0) {
    leavecard.forceLeaveSpent += forceLeaveUsed;
    // Don't change vl or sl
} else {
    leavecard.vl -= vlUsed;  // Deduct from VL
    leavecard.sl -= slUsed;  // Deduct from SL
}
```

### Issue 3: Missing Earned Periods
**Problem:** When an employee earns new credits (e.g., new fiscal year, special grants), the system needs to ADD them, not just SET them.

**Missing Function:** No mechanism to add "ADD: [period]" entries like in Excel.

---

## Implementation Steps

### Step 1: Update Leave Card Creation

When a new employee registers, create the initial card with earned values:

```javascript
// In server.js, around line 1166
const newLeavecard = {
    email: registration.email,
    employeeId: registration.email,
    
    // Initial earned amounts (matching Excel)
    vacationLeaveEarned: 100,    // Column B initial
    sickLeaveEarned: 100,        // Column C initial
    forceLeaveEarned: 0,
    splEarned: 3,
    
    // Current balances (Column H, I, etc.)
    vl: 100,
    sl: 100,
    spl: 3,
    others: 0,
    
    // Spent tracking
    vacationLeaveSpent: 0,
    sickLeaveSpent: 0,
    forceLeaveSpent: 0,
    splSpent: 0,
    
    // Year tracking (for annual reset)
    forceLeaveYear: new Date().getFullYear(),
    splYear: new Date().getFullYear(),
    
    // History of all transactions (matching Excel rows)
    leaveUsageHistory: [
        {
            // This represents Row 14 in Excel
            periodCovered: "Initial Credits",
            leaveType: "Period Addition",
            vlEarned: 100,
            slEarned: 100,
            vlSpent: 0,
            slSpent: 0,
            balanceAfterVL: 100,
            balanceAfterSL: 100,
            balanceAfterTotal: 200,
            dateAdded: new Date().toISOString()
        }
    ],
    
    createdAt: new Date().toISOString()
};
```

### Step 2: Update Application Approval Logic

When an application is approved, use the formula:

```javascript
// Replace updateLeaveCardWithUsage() function (line 2244)
function updateLeaveCardWithUsage(application, vlUsed, slUsed) {
    const leavecards = readJSON(leavecardsFile);
    let leavecard = leavecards.find(lc => lc.email === application.employeeEmail);
    
    // Get previous balance (from last history entry or current)
    let previousVL = leavecard.vl || 100;
    let previousSL = leavecard.sl || 100;
    
    // Determine leave type and parse days
    const leaveType = parseLeaveType(application);
    const daysUsed = parseDaysUsed(application);
    
    // FORMULA IMPLEMENTATION (matching Excel):
    let newVL = previousVL;
    let newSL = previousSL;
    let forceLeaveUsed = 0;
    let vlEarned = 0;
    let slEarned = 0;
    
    if (leaveType === 'Force Leave') {
        // Force Leave: H[n] = H[n-1] - F[n]
        forceLeaveUsed = daysUsed;
        newVL = previousVL - forceLeaveUsed;  // Deduct from VL balance
        newSL = previousSL;                    // SL unchanged
        leavecard.forceLeaveSpent += forceLeaveUsed;
    } 
    else if (leaveType === 'Vacation Leave') {
        // Vacation: H[n] = H[n-1] - D[n] + B[n]
        newVL = previousVL - daysUsed + vlEarned;  // Subtract spent, add earned
        newSL = previousSL;
        leavecard.vacationLeaveSpent += daysUsed;
    }
    else if (leaveType === 'Sick Leave') {
        // Sick: I[n] = I[n-1] - E[n] + C[n]
        newVL = previousVL;
        newSL = previousSL - daysUsed + slEarned;  // Subtract spent, add earned
        leavecard.sickLeaveSpent += daysUsed;
    }
    
    // Ensure non-negative
    newVL = Math.max(0, newVL);
    newSL = Math.max(0, newSL);
    
    // Update card
    leavecard.vl = newVL;
    leavecard.sl = newSL;
    
    // Record transaction in history
    leavecard.leaveUsageHistory.push({
        periodCovered: extractPeriod(application),
        leaveType: leaveType,
        daysUsed: daysUsed,
        periodFrom: application.dateFrom,
        periodTo: application.dateTo,
        balanceAfterVL: newVL,
        balanceAfterSL: newSL,
        balanceAfterTotal: newVL + newSL,
        dateApproved: new Date().toISOString(),
        calculation: {
            formula: `[VL] ${previousVL} - ${daysUsed} = ${newVL}`,
            source: 'Formula from Excel leave card'
        }
    });
    
    leavecard.updatedAt = new Date().toISOString();
    writeJSON(leavecardsFile, leavecards);
}
```

### Step 3: Add Period Earned Function

Support manually adding earned periods (like "ADD: 4/19/2021 - 4/30/2021"):

```javascript
function addPeriodEarned(employeeEmail, periodFrom, periodTo, vlEarned, slEarned) {
    const leavecards = readJSON(leavecardsFile);
    let leavecard = leavecards.find(lc => lc.email === employeeEmail);
    
    // Get previous balance
    let previousVL = leavecard.vl;
    let previousSL = leavecard.sl;
    
    // FORMULA: Add earned amounts
    // H[n] = H[n-1] + B[n]  (add earned VL)
    // I[n] = I[n-1] + C[n]  (add earned SL)
    const newVL = previousVL + vlEarned;
    const newSL = previousSL + slEarned;
    
    leavecard.vl = newVL;
    leavecard.sl = newSL;
    leavecard.vacationLeaveEarned += vlEarned;
    leavecard.sickLeaveEarned += slEarned;
    
    // Record in history
    leavecard.leaveUsageHistory.push({
        periodCovered: `ADD: ${periodFrom} - ${periodTo}`,
        leaveType: 'Period Addition',
        vlEarned: vlEarned,
        slEarned: slEarned,
        balanceAfterVL: newVL,
        balanceAfterSL: newSL,
        balanceAfterTotal: newVL + newSL,
        dateAdded: new Date().toISOString()
    });
    
    writeJSON(leavecardsFile, leavecards);
}
```

### Step 4: Update Frontend Display

The frontend (`edit-employee-cards.html`) already displays history correctly, but ensure:

1. **Display formula components** in each row:
   ```html
   <tr>
       <td>Vacation Leave</td>
       <td>5</td>
       <td>100 - 5 = 95</td>  <!-- Show formula -->
   </tr>
   ```

2. **Show balance calculation** in edit form:
   ```javascript
   // When displaying edit form, show:
   Current VL Balance: 95
   + New earned: 0
   - Current spent: 5
   = New balance: 90
   ```

---

## Data Flow Diagram

```
Employee Application
       ↓
AO Approves
       ↓
Trigger updateLeaveCardWithUsage()
       ↓
Extract: leave type, days used, period dates
       ↓
Calculate using FORMULA:
newBalance = previousBalance - spent + earned - forceLeave
       ↓
Update leavecard.vl, leavecard.sl
       ↓
Add entry to leaveUsageHistory with:
- Period covered
- Days used
- New balance
- Calculation formula
       ↓
Save to leavecards.json
       ↓
Frontend fetches and displays
in leave card table
       ↓
Running balance shows in each row
```

---

## Verification Checklist

- [ ] Initial leave card created with vl=100, sl=100
- [ ] First approval deducts correctly: H[n] = 100 - 5 = 95
- [ ] Second approval compounds: H[n] = 95 - 3 = 92
- [ ] Force leave doesn't affect VL/SL balance
- [ ] Period additions show "ADD:" in history
- [ ] Each row references previous balance
- [ ] Total = VL + SL (verified mathematically)
- [ ] Annual reset works for Force/SPL leaves
- [ ] Frontend displays all formula details
- [ ] Edit function updates and recalculates correctly

---

## Files to Modify

1. **server.js** (Lines 2244-2358):
   - Replace `updateLeaveCardWithUsage()` with formula-based version
   - Add `addPeriodEarned()` function
   - Ensure annual reset logic

2. **edit-employee-cards.html** (Lines 800+):
   - Update display to show formula calculations
   - Add column for "Calculation" showing the math
   - Verify running balance is correct

3. **Database schema** (leavecards.json):
   - Ensure `leaveUsageHistory` has all required fields
   - Add `calculation` field for audit trail
   - Track both earned and spent components

---

## Testing Samples

Create test cases with known Excel data:

```javascript
// Test Case 1: Basic deduction
Employee: ACUHIDO, ELIZA B.
H14 = B14 = 0.5 ✓
H15 = H14 - F15 - D15 + B15 = 0.5 - 0 - 0 + 7.5 = 8.0 ✓
H16 = H15 - F16 - D16 + B16 = 8.0 - 1 - 0 + 0 = 7.0 ✓

// Test Case 2: Force leave (shouldn't affect balance as separate tracking)
// In current design, force leave IS deducted from VL
// Verify this is intentional or adjust

// Test Case 3: Running calculation
// Verify each row's balance = previous - spent + earned
```

---

## Final Notes

The Excel files show a **mature, well-tested system** for leave management. The portal implementation needs to adopt this same logic to:

1. Ensure data consistency
2. Provide audit trail
3. Prevent calculation errors
4. Match employee expectations (they see the same math in Excel and portal)

The `enhanced_leave_card_formulas.js` file provides the corrected functions ready to drop into `server.js`.
