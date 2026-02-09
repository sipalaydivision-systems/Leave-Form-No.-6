# Leave Card Formula Implementation - AO Dashboard Integration

## Current Implementation Analysis

### From Excel Files (Non-Teaching Personnel):
```
Running Balance Formulas:
- Vacation Balance: H[n] = H[n-1] - F[n] - D[n] + B[n]
  (Previous Balance - Forced Leave - Vacation Spent + New Vacation Earned)
  
- Sick Leave Balance: I[n] = I[n-1] - E[n] + C[n]
  (Previous Balance - Sick Leave Spent + New Sick Leave Earned)
  
- Total Balance: J[n] = H[n] + I[n]
```

### Current Portal Implementation:
The system stores leave usage in `leaveUsageHistory` array that tracks:
- Application ID
- Leave Type
- Days Used
- Period (From/To)
- Balance After (VL and SL)
- Date Approved

---

## Issue Identified

**Current Implementation Problem:**
The current code in `server.js` (lines 2244-2358) has a logical issue:

1. It initializes leave card with `vl: 100, sl: 100`
2. When an application is approved, it deducts from current balance
3. **BUT**: It doesn't properly accumulate leaves earned or calculate running balance using the Excel formula

**Current Line 2336:**
```javascript
leavecard.vl = Math.max(0, (leavecard.vl || 100) - vlUsed);
leavecard.sl = Math.max(0, (leavecard.sl || 100) - slUsed);
```

This is a **simple deduction** but lacks:
- Proper period tracking
- Earned leaves calculation per period
- Forced leave handling (should not deduct from VL/SL)
- Running cumulative balance

---

## Recommended Implementation

### Data Structure Enhancement

Each leave card should track:
```javascript
{
  email: "employee@deped.gov.ph",
  employeeId: "EMP-001",
  
  // Initial period setup
  initialEarned: {
    vl: 100,           // Vacation leave earned
    sl: 100,           // Sick leave earned
    forced: 0,         // Force leave available
    spl: 3             // Special privilege leave
  },
  
  // Period-based tracking
  periods: [
    {
      periodCovered: "4/19/2021 - 4/30/2021",
      earned: { vl: 0.5, sl: 0.5, forced: 0, spl: 0 },
      spent: { vl: 0, sl: 0, forced: 0, spl: 0 },
      balance: { vl: 100.5, sl: 100.5, total: 201 },
      dateAdded: "2021-04-30"
    },
    {
      periodCovered: "5/01/2021 - 10/30/2021",
      earned: { vl: 7.5, sl: 7.5, forced: 0, spl: 0 },
      spent: { vl: 0, sl: 0, forced: 0, spl: 0 },
      balance: { vl: 108, sl: 108, total: 216 },
      dateAdded: "2021-10-30"
    }
  ],
  
  // Running totals
  currentBalance: {
    vl: 108,
    sl: 108,
    forced: 0,
    spl: 3,
    total: 219
  },
  
  totalSpent: {
    vl: 0,
    sl: 0,
    forced: 0,
    spl: 0
  }
}
```

### Formula Implementation

When an application is approved:

1. **Identify the period**: Extract `dateFrom` and `dateTo`
2. **Calculate earned**: Default or from special orders
3. **Calculate spent**: From application days used
4. **Update balance using formula**:
   - If Vacation Leave: `vlBalance = previousVL - forceSpent - vlSpent + vlEarned`
   - If Sick Leave: `slBalance = previousSL - slSpent + slEarned`
   - Total: `totalBalance = vlBalance + slBalance`

5. **Record in history** with all components

---

## Implementation Notes

### Key Points to Corroborate:

1. **Force Leave Logic** (Column F in Excel):
   - Should be tracked separately
   - Does NOT deduct from VL/SL balance
   - Reset annually

2. **Special Leave Logic** (Column G in Excel):
   - Does NOT deduct from regular VL/SL
   - Tracked separately
   - Should have its own balance

3. **Running Balance System**:
   - Each row builds on previous
   - Clear audit trail
   - Easy to verify

4. **Application Approval Flow**:
   - Employee applies for leave
   - AO/HR approves
   - System calculates used days
   - Leave card is updated with new balance
   - Balance reflects immediately on dashboard

---

## Testing Checklist

- [ ] Initial leave card created with correct earned values
- [ ] First application approved: balance decreases by days used
- [ ] Multiple applications: balance compounds correctly
- [ ] Force leave doesn't affect VL/SL balance
- [ ] Special leave tracked separately
- [ ] Balance history shows all transactions
- [ ] Current balance matches formula calculation
- [ ] SO Card updates when special orders are processed
- [ ] Edit leave credits manually updates the system
- [ ] Print function shows accurate card representation

---

## Next Steps

1. Update `updateLeaveCardWithUsage()` function to use formula-based calculation
2. Implement period-based tracking in database
3. Add balance verification function
4. Update edit interface to show formula components
5. Test with sample data from Excel files
