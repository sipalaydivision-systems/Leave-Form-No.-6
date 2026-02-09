# Leave Card Formula Corroboration - Executive Summary

## Document Index

This folder now contains comprehensive corroboration between Excel leave cards and the AO Portal system:

### 📊 Analysis Documents

1. **LEAVE_CARD_FORMULA_ANALYSIS.md**
   - Detailed examination of Excel formula patterns
   - Non-Teaching vs Teaching personnel differences
   - Exact formula syntax with examples
   - Key insights about the calculation system

2. **EXCEL_TO_PORTAL_MAPPING.md** ⭐ **START HERE**
   - Complete formula mapping between Excel and Portal
   - Data structure alignment
   - Application approval flow
   - Verification checklist
   - Sample test data

3. **INTEGRATION_GUIDE.md**
   - Step-by-step implementation instructions
   - Code examples for each formula
   - Frontend display guidelines
   - Testing procedures

4. **LEAVE_CARD_INTEGRATION_PLAN.md**
   - Current implementation issues identified
   - Recommended data structure
   - Business logic requirements
   - Next steps

### 💻 Implementation Files

5. **enhanced_leave_card_formulas.js**
   - Ready-to-use functions with proper formula logic
   - Can be integrated into server.js
   - Includes balance calculation
   - Period tracking functions
   - Audit trail support

---

## Quick Reference: The Formulas

### Initial Balance (Row 14)
```
H14 = B14           (VL = Earned VL)
I14 = C14           (SL = Earned SL)
J14 = H14 + I14     (Total = VL + SL)
```

### Running Balance (Rows 15+)
```
H[n] = H[n-1] - F[n] - D[n] + B[n]
       (VL Balance = Previous VL - Force Leave - VL Spent + VL Earned)

I[n] = I[n-1] - E[n] + C[n]
       (SL Balance = Previous SL - SL Spent + SL Earned)

J[n] = H[n] + I[n]
       (Total = VL + SL)
```

### Key Points
- **Force Leave** (Column F): Deducts from VL balance but tracked separately
- **Special Leave** (Column G): Tracked separately, doesn't affect VL/SL
- **Each row depends on previous row**: Creates cumulative running balance
- **No earned on spending**: Earned amounts usually 0 during leave application

---

## Current Portal Issues

### Issue 1: Simple Deduction (vs Formula-Based)
**Current:** `leavecard.vl = previousVL - daysUsed`
**Should Be:** `leavecard.vl = previousVL - forceLeave - daysUsed + earned`

### Issue 2: Missing Period Tracking
**Current:** No mechanism to track "ADD: [period range]" entries
**Should Be:** Support adding earned periods with proper balance update

### Issue 3: Force Leave Handling
**Current:** Ambiguous - unclear if force leave affects actual balance
**Should Be:** Force leave deducts from VL but tracked as separate "Force Spent"

### Issue 4: No History Audit Trail
**Current:** Balance calculated on-the-fly
**Should Be:** Each transaction recorded with formula calculation details

---

## Implementation Priority

### Phase 1: Critical (Do First)
- [ ] Update `updateLeaveCardWithUsage()` to use proper formula
- [ ] Ensure force leave handled correctly
- [ ] Add period tracking to history

### Phase 2: Important (Do Next)
- [ ] Add `addPeriodEarned()` function
- [ ] Update frontend to show formula calculations
- [ ] Add verification/validation functions

### Phase 3: Nice-to-Have
- [ ] Add audit trail export
- [ ] Create formula verification reports
- [ ] Add data migration from old system

---

## Testing Procedure

### 1. Use Sample Data
Use the data from `ACUHIDO, ELIZA B.xlsx`:
- Row 14: Balance = 0.5 + 0.5 = 1.0
- Row 15: VL = 0.5 - 0 - 0 + 7.5 = 8.0, SL = 0.5 - 0 + 7.5 = 8.0
- Row 16: VL = 8.0 - 1 - 0 + 0 = 7.0, SL = 8.0 - 0 + 0 = 8.0

### 2. Verify Formula Accuracy
- Calculate expected balance using formula
- Compare with system calculation
- Confirm match to 3 decimal places

### 3. Check Audit Trail
- Verify each transaction recorded
- Confirm history shows all components
- Validate cumulative balance

### 4. Test Edge Cases
- Force leave multiple times
- Multiple application types
- Annual reset
- Manual period additions

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EMPLOYEE APPLICATION                      │
│  - Leave Type (VL, SL, Force, SPL)                          │
│  - Days Applied                                              │
│  - Date Range                                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   AO DASHBOARD - APPROVE     │
        │   Application Review         │
        │   Approve/Reject Decision    │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  SERVER: updateLeaveCard()   │
        │  ✓ Extract date range        │
        │  ✓ Parse leave type          │
        │  ✓ Get days approved         │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  CALCULATE NEW BALANCE       │
        │  Using Excel Formula:        │
        │  H[n] = H[n-1] - F - D + B   │
        │  I[n] = I[n-1] - E + C       │
        │  J[n] = H[n] + I[n]         │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   UPDATE LEAVECARD           │
        │   ✓ New VL balance           │
        │   ✓ New SL balance           │
        │   ✓ Update totals            │
        │   ✓ Record in history        │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   SAVE TO DATABASE           │
        │   leavecards.json            │
        │   leaveUsageHistory array    │
        └──────────────┬───────────────┘
                       │
                       ▼
┌──────────────────────────────────────┐
│     FRONTEND DISPLAY UPDATE          │
│  Leave Card shows:                   │
│  ✓ Running balance for each row      │
│  ✓ Formula calculation details       │
│  ✓ Current total balance             │
│  ✓ Updated on dashboard              │
└──────────────────────────────────────┘
```

---

## Data Structure Comparison

### Excel Format
```
Col A: Period Covered          | 4/19/2021 - 4/30/2021
Col B: Vacation Earned         | 0.5
Col C: Sick Earned             | 0.5
Col D: Vacation Spent          | 0
Col E: Sick Spent              | 0
Col F: Force Leave             | 0
Col G: Special Leave           | 0
Col H: VL Balance              | 0.5 ← Calculated
Col I: SL Balance              | 0.5 ← Calculated
Col J: Total Balance           | 1.0 ← Calculated
```

### Portal JSON Format
```json
{
  "leavecard": {
    "email": "employee@deped.gov.ph",
    "vl": 0.5,
    "sl": 0.5,
    "vacationLeaveEarned": 0.5,
    "sickLeaveEarned": 0.5,
    "vacationLeaveSpent": 0,
    "sickLeaveSpent": 0,
    "forceLeaveSpent": 0,
    
    "leaveUsageHistory": [
      {
        "periodCovered": "4/19/2021 - 4/30/2021",
        "periodFrom": "2021-04-19",
        "periodTo": "2021-04-30",
        "leaveType": "Period Addition",
        "vlEarned": 0.5,
        "slEarned": 0.5,
        "vlSpent": 0,
        "slSpent": 0,
        "balanceAfterVL": 0.5,
        "balanceAfterSL": 0.5,
        "balanceAfterTotal": 1.0,
        "calculation": "VL: 0 + 0.5 - 0 = 0.5, SL: 0 + 0.5 - 0 = 0.5"
      }
    ]
  }
}
```

---

## Verification Formula

To verify system is working correctly:

```javascript
// For each row in leaveUsageHistory:
expectedVL = previousVL - forceLeave - vlSpent + vlEarned;
expectedSL = previousSL - slSpent + slEarned;
expectedTotal = expectedVL + expectedSL;

// Should match:
actualVL = record.balanceAfterVL;
actualSL = record.balanceAfterSL;
actualTotal = record.balanceAfterTotal;

console.assert(Math.abs(expectedVL - actualVL) < 0.001, 'VL mismatch');
console.assert(Math.abs(expectedSL - actualSL) < 0.001, 'SL mismatch');
console.assert(Math.abs(expectedTotal - actualTotal) < 0.001, 'Total mismatch');
```

---

## Success Criteria

✅ **System is working correctly when:**

1. Employee applies for leave → System calculates balance using formula
2. New balance = Previous - Spent + Earned - ForceLeave
3. History shows all transactions with period covered
4. Running balance never goes negative
5. Total balance = VL + SL always
6. Force leave tracked separately
7. Special leave tracked separately
8. Annual reset occurs for Force/SPL
9. Frontend displays match database values
10. Manual edits preserve formula integrity

---

## Next Steps

1. **Review** the EXCEL_TO_PORTAL_MAPPING.md document
2. **Understand** the formula logic completely
3. **Backup** current server.js before changes
4. **Implement** changes from enhanced_leave_card_formulas.js
5. **Test** with sample data from ACUHIDO, ELIZA B.xlsx
6. **Verify** all calculations match Excel
7. **Deploy** and monitor for accuracy
8. **Train** staff on new system

---

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| LEAVE_CARD_FORMULA_ANALYSIS.md | Excel pattern analysis | ✓ Complete |
| EXCEL_TO_PORTAL_MAPPING.md | Formula mapping details | ✓ Complete |
| INTEGRATION_GUIDE.md | Implementation steps | ✓ Complete |
| enhanced_leave_card_formulas.js | Ready code functions | ✓ Ready to use |
| LEAVE_CARD_INTEGRATION_PLAN.md | Architecture overview | ✓ Complete |
| analyze_leave_cards.py | Python analysis script | ✓ Created |
| detailed_formula_analysis.py | Detailed extraction | ✓ Created |

---

## Contact & Support

For questions about the formula corroboration:
- Review EXCEL_TO_PORTAL_MAPPING.md for detailed explanations
- Check INTEGRATION_GUIDE.md for implementation help
- Use enhanced_leave_card_formulas.js for working code

---

**Document Version:** 1.0  
**Date Analyzed:** February 5, 2026  
**Scope:** Non-Teaching Personnel Leave Cards (Primary), Teaching Personnel Leave Cards (Comparison)  
**Status:** ✅ Corroboration Complete - Ready for Implementation
