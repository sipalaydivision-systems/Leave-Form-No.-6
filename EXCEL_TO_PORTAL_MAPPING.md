# Excel to Portal Formula Mapping

## Comprehensive Corroboration Document

This document maps the exact formulas from the Excel leave cards to their portal implementation.

---

## Excel Leave Card Structure (Non-Teaching)

### Sample Data from: ACUHIDO, ELIZA B.xlsx

```
SHEET NAME: "Leave Card (NE)"
RANGE: A2:J117 (115 rows of data)

HEADER ROWS:
Row 11: PERIOD COVERED | LEAVE EARNED | LEAVE SPENT | BALANCE | TOTAL
Row 12: (empty) | VACATION | SICK | VACATION | SICK | VACATION | SICK | FORCED | SPECIAL | VACATION | SICK | (Total in J)

COLUMNS:
A = Period Covered
B = Vacation Leave Earned
C = Sick Leave Earned
D = Vacation Leave Spent
E = Sick Leave Spent
F = Forced Leave (column header shows "FORCED" under LEAVE SPENT)
G = Special Privilege Leave
H = Vacation Balance
I = Sick Leave Balance
J = Total Balance
```

---

## Formula Analysis

### FORMULA SET 1: Initial Balance (Row 14)

**Purpose:** Set starting balance equal to earned amount

**Excel:**
```
H14 = B14  → =B14
I14 = C14  → =C14
J14 = H14+I14 → =H14+I14
```

**Sample Values:**
```
Row 14: ADD: 4/19/2021 - 4/30/2021
B14 = 0.5 (VL Earned)
C14 = 0.5 (SL Earned)
H14 = 0.5 (VL Balance = B14)
I14 = 0.5 (SL Balance = C14)
J14 = 1.0 (Total = 0.5 + 0.5)
```

**Portal Equivalent:**
```javascript
// When first leave transaction is recorded
leavecard.vl = earned_vl;  // Usually 100 on initial creation
leavecard.sl = earned_sl;  // Usually 100 on initial creation

leavecard.leaveUsageHistory.push({
    periodCovered: "Initial Credits",
    balanceAfterVL: earned_vl,
    balanceAfterSL: earned_sl,
    balanceAfterTotal: earned_vl + earned_sl
});
```

---

### FORMULA SET 2: Vacation Leave Balance (Row 15+)

**Purpose:** Track running balance of vacation leave

**Excel Formula:**
```
H[n] = H[n-1] - F[n] - D[n] + B[n]
       └─────┘   └───┘   └───┘   └─┘
       Prev VL   Force   VL Spent VL Earned
       Balance   Leave
```

**Logic:**
- Start with previous balance (H[n-1])
- Subtract any force leave used (F[n]) - affects VL balance
- Subtract vacation leave spent (D[n])
- Add any new vacation leave earned (B[n])
- Result = new VL balance

**Sample Calculations:**
```
Row 14:
H14 = B14 = 0.5

Row 15: (ADD: 5/01/2021 - 10/30/2021)
H15 = H14 - F15 - D15 + B15
    = 0.5 - 0 - 0 + 7.5
    = 8.0

Row 16: (LESS: 11/09/2021 - Force Leave 1 day)
H16 = H15 - F16 - D16 + B16
    = 8.0 - 1 - 0 + 0
    = 7.0

Row 17: (ADD: 11/01/2021 - 11/30/2021)
H17 = H16 - F17 - D17 + B17
    = 7.0 - 0 - 0 + 1.25
    = 8.25

Row 18: (LESS: 12/06, 24 & 29/2021 - Force Leave 3 days)
H18 = H17 - F18 - D18 + B18
    = 8.25 - 3 - 0 + 0
    = 5.25
```

**Portal Implementation:**
```javascript
function calculateVacationLeaveBalance(
    previousVL,      // H[n-1]
    forceLeaveUsed,  // F[n]
    vacationSpent,   // D[n]
    vacationEarned   // B[n]
) {
    return previousVL - forceLeaveUsed - vacationSpent + vacationEarned;
}

// When application is approved:
const newVL = calculateVacationLeaveBalance(
    leavecard.vl,           // Previous balance
    forceLeaveUsed || 0,    // If force leave type
    vacationDaysUsed || 0,  // If vacation leave applied
    0                       // Usually 0 on application approval
);

leavecard.vl = Math.max(0, newVL);  // Ensure non-negative

leavecard.leaveUsageHistory.push({
    leaveType: 'Vacation Leave',
    daysUsed: vacationDaysUsed,
    balanceAfterVL: leavecard.vl,
    calculation: `${previousVL} - ${forceLeaveUsed} - ${vacationDaysUsed} + 0 = ${newVL}`
});
```

---

### FORMULA SET 3: Sick Leave Balance (Row 15+)

**Purpose:** Track running balance of sick leave

**Excel Formula:**
```
I[n] = I[n-1] - E[n] + C[n]
       └─────┘   └───┘   └──┘
       Prev SL   SL Spent SL Earned
       Balance
```

**Logic:**
- Start with previous SL balance (I[n-1])
- Subtract sick leave spent (E[n])
- Add any new sick leave earned (C[n])
- Result = new SL balance
- Note: Force leave does NOT affect SL (no F[n] in this formula)

**Sample Calculations:**
```
Row 14:
I14 = C14 = 0.5

Row 15:
I15 = I14 - E15 + C15
    = 0.5 - 0 + 7.5
    = 8.0

Row 16:
I16 = I15 - E16 + C16
    = 8.0 - 0 + 0
    = 8.0
(No change because no sick leave was spent or earned)

Row 17:
I17 = I16 - E17 + C17
    = 8.0 - 0 + 1.25
    = 9.25
```

**Portal Implementation:**
```javascript
function calculateSickLeaveBalance(
    previousSL,      // I[n-1]
    sickSpent,       // E[n]
    sickEarned       // C[n]
) {
    return previousSL - sickSpent + sickEarned;
}

// When application is approved:
const newSL = calculateSickLeaveBalance(
    leavecard.sl,         // Previous balance
    sickDaysUsed || 0,    // If sick leave applied
    0                     // Usually 0 on application approval
);

leavecard.sl = Math.max(0, newSL);  // Ensure non-negative

leavecard.leaveUsageHistory.push({
    leaveType: 'Sick Leave',
    daysUsed: sickDaysUsed,
    balanceAfterSL: leavecard.sl,
    calculation: `${previousSL} - ${sickDaysUsed} + 0 = ${newSL}`
});
```

---

### FORMULA SET 4: Total Balance (All Rows)

**Purpose:** Show combined available leave

**Excel Formula:**
```
J[n] = H[n] + I[n]
       └─┘   └─┘
       VL    SL
       Balance Balance
```

**Logic:** 
- Simply add vacation and sick leave balances
- Independent of how much was earned or spent
- Automatically updates when H or I changes

**Portal Implementation:**
```javascript
const totalBalance = leavecard.vl + leavecard.sl;

leavecard.leaveUsageHistory.push({
    balanceAfterVL: leavecard.vl,
    balanceAfterSL: leavecard.sl,
    balanceAfterTotal: totalBalance  // J[n]
});
```

---

## Special Cases

### Case 1: Force Leave (Column F)

**Excel Behavior:**
- Appears under "LEAVE SPENT" section
- Deducts from Vacation Balance (H[n] formula includes "- F[n]")
- Does NOT appear as vacation spend (D column)
- Tracked separately for management

**Example from Row 16:**
```
A16: LESS: 11/09/2021
F16: 1 (Force Leave = 1 day)
D16: blank (no vacation spent)
E16: blank (no sick spent)
H16 = 8.0 - 1 - 0 + 0 = 7.0 ✓ (Force deducted from VL)
I16 = 8.0 - 0 + 0 = 8.0 ✓ (SL unchanged)
```

**Portal Implementation:**
- Track force leave separately: `leavecard.forceLeaveSpent`
- Still deduct from VL balance: `newVL = previousVL - forceLeaveUsed`
- Record with `leaveType: 'Force Leave'`

---

### Case 2: Special Privilege Leave (Column G)

**Excel Behavior:**
- Under "LEAVE SPENT" section but separate column
- Does NOT deduct from VL or SL balances
- Limited quantity per year (usually 3 days)
- Annual reset

**Note:** The Excel file doesn't show SPL deduction in visible rows (all G values are blank/0), but the structure allows for it.

**Portal Implementation:**
```javascript
if (leaveType === 'Special Privilege Leave') {
    leavecard.splSpent += daysUsed;
    // Don't change vl or sl
    // VL and SL balances remain unchanged
}
```

---

### Case 3: Period Addition (ADD: rows)

**Excel Behavior:**
```
A14: ADD: 4/19/2021 - 4/30/2021
B14: 0.5 (New VL earned)
C14: 0.5 (New SL earned)
D-G: blank (no spending)
H14: 0.5 (VL = 0.5)
I14: 0.5 (SL = 0.5)
```

**When New Credits Are Granted:**
```
A15: ADD: 5/01/2021 - 10/30/2021
B15: 7.5 (New VL earned)
C15: 7.5 (New SL earned)
H15 = H14 + B15 = 0.5 + 7.5 = 8.0
I15 = I14 + C15 = 0.5 + 7.5 = 8.0
```

**Portal Implementation:**
```javascript
function addPeriodEarned(employeeEmail, vlEarned, slEarned) {
    leavecard.vl += vlEarned;
    leavecard.sl += slEarned;
    leavecard.vacationLeaveEarned += vlEarned;
    leavecard.sickLeaveEarned += slEarned;
    
    leavecard.leaveUsageHistory.push({
        periodCovered: `ADD: [date range]`,
        leaveType: 'Period Addition',
        vlEarned: vlEarned,
        slEarned: slEarned,
        balanceAfterVL: leavecard.vl,
        balanceAfterSL: leavecard.sl
    });
}
```

---

## Data Structure Alignment

### Excel Leave Card = Portal Leave Usage History

**Excel Row 15 looks like:**
```
A15: ADD: 5/01/2021 - 10/30/2021
B15: 7.5
C15: 7.5
D15-G15: - (blanks)
H15: 8.0
I15: 8.0
J15: 16.0
```

**Portal JSON equivalent:**
```json
{
    "periodCovered": "ADD: 5/01/2021 - 10/30/2021",
    "leaveType": "Period Addition",
    "periodFrom": "2021-05-01",
    "periodTo": "2021-10-30",
    "vlEarned": 7.5,
    "slEarned": 7.5,
    "vlSpent": 0,
    "slSpent": 0,
    "forceLeaveUsed": 0,
    "balanceAfterVL": 8.0,
    "balanceAfterSL": 8.0,
    "balanceAfterTotal": 16.0,
    "dateAdded": "2021-10-30T00:00:00.000Z"
}
```

---

## Application Approval Flow

### Scenario: Employee applies for 3 days Vacation Leave

**Excel Representation:**
```
Previous Row (Row N): H[n] = 8.0, I[n] = 8.0
New Row (Row N+1):    
A: Date of application: [date range]
D: Vacation Leave Spent = 3
H: H[n+1] = H[n] - F[n] - D[n] + B[n] = 8.0 - 0 - 3 + 0 = 5.0
I: I[n+1] = I[n] - E[n] + C[n] = 8.0 - 0 + 0 = 8.0
J: J[n+1] = 5.0 + 8.0 = 13.0
```

**Portal Steps:**
```javascript
1. Application submitted for 3 days VL (dateFrom: date1, dateTo: date2)

2. AO approves application

3. System calls updateLeaveCardWithUsage(application, vlUsed=3, slUsed=0)

4. Calculate new balance:
   previousVL = 8.0 (from leavecard.vl)
   previousSL = 8.0 (from leavecard.sl)
   
   newVL = 8.0 - 0 - 3 + 0 = 5.0  ✓ Matches Excel formula
   newSL = 8.0 - 0 + 0 = 8.0       ✓ Matches Excel formula

5. Update card:
   leavecard.vl = 5.0
   leavecard.sl = 8.0
   
6. Add to history:
   {
       periodCovered: "date1 - date2",
       leaveType: "Vacation Leave",
       daysUsed: 3,
       balanceAfterVL: 5.0,
       balanceAfterSL: 8.0,
       balanceAfterTotal: 13.0,
       calculation: "8.0 - 0 - 3 + 0 = 5.0"
   }

7. Frontend displays table showing:
   Row | Period | Earned | Spent | Balance | Total
   ... | date1-date2 | - | 3 | 5.0 | 13.0
```

---

## Verification Checklist

### Mathematical Verification

- [ ] Initial balance = earned amount
- [ ] Row 2 balance = Row 1 balance - spent + earned
- [ ] Row 3 balance = Row 2 balance - spent + earned
- [ ] ... (continues for all rows)
- [ ] Total balance (J) = VL (H) + SL (I) for all rows
- [ ] No negative balances appear

### Business Logic Verification

- [ ] Force leave affects VL but not SL
- [ ] SPL tracked separately (if used)
- [ ] Annual reset occurs on schedule
- [ ] Period additions show "ADD:" in period column
- [ ] Leave deductions show "LESS:" in period column
- [ ] Running balance creates clear audit trail

### Portal Implementation Verification

- [ ] `leavecard.vl` and `leavecard.sl` always reflect current Excel-style calculation
- [ ] `leaveUsageHistory` array contains all transactions in order
- [ ] Each entry shows both earned and spent components
- [ ] Balance calculations can be manually verified
- [ ] Frontend displays match database values
- [ ] Edit function preserves formula integrity

---

## Code Integration Summary

### Required Changes:

1. **server.js - updateLeaveCardWithUsage() function**
   - Replace simple deduction with formula calculation
   - Add force leave handling (affects VL, not separate)
   - Add period tracking
   - Ensure cumulative balance tracking

2. **server.js - New addPeriodEarned() function**
   - Handle "ADD:" entries for new periods
   - Add earned amounts to previous balance
   - Record in history

3. **Data validation**
   - Verify formula: newBalance = previous - spent + earned - forceLeave
   - Check for negative balances (shouldn't occur)
   - Confirm annual reset for Force/SPL

4. **Frontend display**
   - Show formula details in table
   - Display calculation for each row
   - Verify totals match

---

## Reference Data

### From Excel File: ACUHIDO, ELIZA B.xlsx

```
Row 14: H14=0.5, I14=0.5, J14=1.0
Row 15: H15=8.0, I15=8.0, J15=16.0
Row 16: H16=7.0, I16=8.0, J16=15.0
Row 17: H17=8.25, I17=9.25, J17=17.5
Row 18: H18=5.25, I18=9.25, J18=14.5

Total formulas: 291
Formula pattern: H[n] = H[n-1] - F[n] - D[n] + B[n] (repeated for rows 15-117)
```

This data provides a complete test dataset for verification.
