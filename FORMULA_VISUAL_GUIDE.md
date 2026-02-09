# Leave Card Formula Visual Guide

## Formula Components Diagram

### Vacation Leave Balance Formula

```
┌─────────────────────────────────────────────────────────────┐
│  H[n] = H[n-1] - F[n] - D[n] + B[n]                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  H[n]          = New Vacation Balance                       │
│  ┌──────────┐                                               │
│  │ H[n-1]   │  Previous VL Balance (from last row)          │
│  │    -     │                                               │
│  │ F[n]     │  Force Leave Used (affects VL)               │
│  │    -     │                                               │
│  │ D[n]     │  Vacation Leave Spent (applied/used)         │
│  │    +     │                                               │
│  │ B[n]     │  Vacation Leave Earned (new period)          │
│  └──────────┘                                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Example: H15 = 0.5 - 0 - 0 + 7.5 = 8.0
         (Start with 0.5, no force/spending, add 7.5 earned)
```

### Sick Leave Balance Formula

```
┌──────────────────────────────────────────────────────┐
│  I[n] = I[n-1] - E[n] + C[n]                        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  I[n]          = New Sick Leave Balance             │
│  ┌──────────┐                                        │
│  │ I[n-1]   │  Previous SL Balance                  │
│  │    -     │                                        │
│  │ E[n]     │  Sick Leave Spent (applied/used)      │
│  │    +     │                                        │
│  │ C[n]     │  Sick Leave Earned (new period)       │
│  └──────────┘                                        │
│                                                       │
│  NOTE: No Force Leave deduction (F[n] NOT here)     │
│                                                       │
└──────────────────────────────────────────────────────┘

Example: I15 = 0.5 - 0 + 7.5 = 8.0
         (Start with 0.5, no spending, add 7.5 earned)
```

### Total Balance Formula

```
┌────────────────────────────────┐
│  J[n] = H[n] + I[n]           │
├────────────────────────────────┤
│                                 │
│  J[n]  = Total Leave Balance   │
│  ┌──────────┐                   │
│  │ H[n]     │  Vacation Balance  │
│  │    +     │                   │
│  │ I[n]     │  Sick Balance      │
│  └──────────┘                   │
│                                 │
└────────────────────────────────┘

Example: J15 = 8.0 + 8.0 = 16.0
         (VL balance + SL balance)
```

---

## Column Mapping

### Input Columns (Data Entry)

```
┌─────┬──────────────────────┬─────────────────────────┐
│ Col │ Header               │ Purpose                 │
├─────┼──────────────────────┼─────────────────────────┤
│ A   │ PERIOD COVERED       │ Date range of entry     │
│ B   │ VACATION EARNED      │ New VL earned (∆B)      │
│ C   │ SICK EARNED          │ New SL earned (∆C)      │
│ D   │ VACATION SPENT       │ VL used (∆D)            │
│ E   │ SICK SPENT           │ SL used (∆E)            │
│ F   │ FORCED LEAVE         │ Force leave used (∆F)   │
│ G   │ SPECIAL PRIV LEAVE   │ SPL used (∆G)           │
└─────┴──────────────────────┴─────────────────────────┘
      Input (User Data)
```

### Output Columns (Calculated)

```
┌─────┬──────────────────────┬────────────────────────────┐
│ Col │ Header               │ Formula                    │
├─────┼──────────────────────┼────────────────────────────┤
│ H   │ VACATION BALANCE     │ H = H[prev] - F - D + B    │
│ I   │ SICK BALANCE         │ I = I[prev] - E + C        │
│ J   │ TOTAL BALANCE        │ J = H + I                  │
└─────┴──────────────────────┴────────────────────────────┘
      Output (Formulas)
```

---

## Running Balance Example

### Step-by-Step Calculation

```
STARTING CONDITION:
No previous balance

ROW 14: ADD: 4/19/2021 - 4/30/2021
─────────────────────────────────────
A14: 4/19/2021 - 4/30/2021
B14: 0.5 (VL earned)
C14: 0.5 (SL earned)
D14: - (VL spent)
E14: - (SL spent)
F14: - (Force)
G14: - (SPL)

H14 = B14 = 0.5
I14 = C14 = 0.5
J14 = 0.5 + 0.5 = 1.0

RESULT: VL=0.5, SL=0.5, Total=1.0

ROW 15: ADD: 5/01/2021 - 10/30/2021
─────────────────────────────────────
PREVIOUS: H14=0.5, I14=0.5

A15: 5/01/2021 - 10/30/2021
B15: 7.5 (VL earned)
C15: 7.5 (SL earned)
D15: - (VL spent)
E15: - (SL spent)
F15: - (Force)
G15: - (SPL)

H15 = H14 - F15 - D15 + B15
    = 0.5 - 0 - 0 + 7.5
    = 8.0

I15 = I14 - E15 + C15
    = 0.5 - 0 + 7.5
    = 8.0

J15 = 8.0 + 8.0 = 16.0

RESULT: VL=8.0, SL=8.0, Total=16.0

ROW 16: LESS: 11/09/2021
─────────────────────────
PREVIOUS: H15=8.0, I15=8.0

A16: 11/09/2021
B16: - (no VL earned)
C16: - (no SL earned)
D16: - (no VL spent)
E16: - (no SL spent)
F16: 1 (Force Leave 1 day)
G16: - (no SPL)

H16 = H15 - F16 - D16 + B16
    = 8.0 - 1 - 0 + 0
    = 7.0  ← Force leave deducted

I16 = I15 - E16 + C16
    = 8.0 - 0 + 0
    = 8.0  ← Unchanged

J16 = 7.0 + 8.0 = 15.0

RESULT: VL=7.0, SL=8.0, Total=15.0 (Force leave affected only VL)

ROW 17: ADD: 11/01/2021 - 11/30/2021
──────────────────────────────────────
PREVIOUS: H16=7.0, I16=8.0

B17: 1.25 (VL earned)
C17: 1.25 (SL earned)

H17 = H16 - F17 - D17 + B17
    = 7.0 - 0 - 0 + 1.25
    = 8.25

I17 = I16 - E17 + C17
    = 8.0 - 0 + 1.25
    = 9.25

J17 = 8.25 + 9.25 = 17.5

RESULT: VL=8.25, SL=9.25, Total=17.5
```

---

## Decision Tree: What Type of Leave?

```
                    Leave Application Received
                              │
                    ┌─────────┴─────────┐
                    │                   │
              Force Leave?         Special Leave?
                    │                   │
         ┌──────────┘         ┌─────────┘
         │                    │
        YES                  YES
         │                    │
         ▼                    ▼
    ┌──────────────┐  ┌──────────────────┐
    │ Force Leave  │  │ Special Priv Leave│
    │ ┌──────────┐ │  │ ┌──────────────┐ │
    │ │ F = days │ │  │ │ G = days     │ │
    │ │ D = 0    │ │  │ │ D,E,F = 0    │ │
    │ │ E = 0    │ │  │ │              │ │
    │ │ B,C = 0  │ │  │ │ H, I unchanged│ │
    │ └──────────┘ │  │ └──────────────┘ │
    │ H = H-F      │  │ H = H (unchanged)│
    │ I = I (unchanged)│ I = I (unchanged)│
    └──────────────┘  └──────────────────┘
         │                    │
         └─────────┬──────────┘
                   │
                  NO
                   │
    ┌──────────────┴──────────────┐
    │                             │
   Sick Leave?              Vacation Leave?
    │                             │
   YES                           YES
    │                             │
    ▼                             ▼
┌──────────────┐          ┌──────────────┐
│ Sick Leave   │          │ Vacation     │
│ ┌──────────┐ │          │ ┌──────────┐ │
│ │ E = days │ │          │ │ D = days │ │
│ │ D,F = 0  │ │          │ │ E,F = 0  │ │
│ │ B,C = 0  │ │          │ │ B,C = 0  │ │
│ └──────────┘ │          │ └──────────┘ │
│ H = H        │          │ H = H - D    │
│ I = I - E    │          │ I = I        │
└──────────────┘          └──────────────┘
    │                             │
    └─────────────┬───────────────┘
                  │
                  ▼
          ┌───────────────┐
          │ APPLY FORMULA │
          │ Save to card  │
          │ Update balance│
          └───────────────┘
```

---

## Balance Update Flow Diagram

```
APPLICATION APPROVED
        │
        ▼
┌───────────────────────────────┐
│ Get current balance           │
│ from leavecard.vl, leavecard.sl│
└───────┬───────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Parse application:            │
│ - leave type                  │
│ - days used                   │
│ - period (dateFrom, dateTo)   │
└───────┬───────────────────────┘
        │
        ▼
        ┌──────────────────┐
        │ Force Leave?     │
        └────┬─────┬───────┘
             │     │
            YES   NO
             │     │
             ▼     ▼
      ┌──────────────────────┐
      │ Calculate:           │
      │ Force:               │
      │ H = H - F            │
      │                      │
      │ Vacation:            │
      │ H = H - D            │
      │                      │
      │ Sick:                │
      │ I = I - E            │
      │                      │
      │ SPL:                 │
      │ (tracked separately) │
      └──────┬───────────────┘
             │
             ▼
      ┌──────────────────┐
      │ Ensure non-negative
      │ H = max(0, H)    │
      │ I = max(0, I)    │
      └──────┬───────────┘
             │
             ▼
      ┌──────────────────────────┐
      │ Update leavecard:        │
      │ leavecard.vl = H         │
      │ leavecard.sl = I         │
      └──────┬───────────────────┘
             │
             ▼
      ┌──────────────────────────┐
      │ Record in history:       │
      │ period, type, days used  │
      │ new balance, formula used│
      └──────┬───────────────────┘
             │
             ▼
      ┌──────────────────────────┐
      │ Save to database         │
      │ leavecard.json           │
      └──────┬───────────────────┘
             │
             ▼
      ┌──────────────────────────┐
      │ Frontend receives update │
      │ displays new table       │
      └──────────────────────────┘
```

---

## Data Value Examples

### Example 1: Adding Earned Period

```
INPUT:
├─ Period: 4/19/2021 - 4/30/2021
├─ Leave Earned: VL=0.5, SL=0.5
└─ Leave Spent: None

CALCULATION:
H[14] = B14 = 0.5
I[14] = C14 = 0.5
J[14] = H14 + I14 = 1.0

OUTPUT:
├─ VL Balance: 0.5
├─ SL Balance: 0.5
└─ Total: 1.0
```

### Example 2: Spending Vacation Leave

```
PREVIOUS STATE: H=8.0, I=8.0

INPUT:
├─ Period: 12/16/2021
├─ Leave Type: Vacation
├─ Days Used: 3
└─ Leave Earned: None

CALCULATION:
H[n] = H[n-1] - 0 - 3 + 0 = 8.0 - 3 = 5.0
I[n] = I[n-1] - 0 + 0 = 8.0
J[n] = 5.0 + 8.0 = 13.0

OUTPUT:
├─ VL Balance: 5.0
├─ SL Balance: 8.0
└─ Total: 13.0
```

### Example 3: Force Leave Impact

```
PREVIOUS STATE: H=8.0, I=8.0

INPUT:
├─ Period: 11/09/2021
├─ Leave Type: Force Leave
├─ Days Used: 1
└─ Leave Earned: None

CALCULATION:
H[n] = H[n-1] - 1 - 0 + 0 = 8.0 - 1 = 7.0  ← Force affects VL
I[n] = I[n-1] - 0 + 0 = 8.0  ← SL unchanged

OUTPUT:
├─ VL Balance: 7.0 (reduced by force leave)
├─ SL Balance: 8.0 (unchanged)
└─ Total: 15.0
```

---

## Verification Checklist Visual

```
┌─────────────────────────────────────────────────┐
│         FORMULA VERIFICATION CHECKLIST          │
├─────────────────────────────────────────────────┤
│                                                 │
│ □ Row 1: Balance = Earned                      │
│   Formula: H1 = B1, I1 = C1                    │
│   Example: H1=0.5, I1=0.5 ✓                   │
│                                                 │
│ □ Row 2: Balance = Prev - F - D + B           │
│   Formula: H2 = H1 - F2 - D2 + B2             │
│   Example: 0.5 - 0 - 0 + 7.5 = 8.0 ✓         │
│                                                 │
│ □ Row 3: Balance = Prev - E + C               │
│   Formula: I3 = I2 - E3 + C3                  │
│   Example: 8.0 - 0 + 1.25 = 9.25 ✓           │
│                                                 │
│ □ All Rows: Total = VL + SL                  │
│   Formula: J[n] = H[n] + I[n]                │
│   Example: 8.0 + 8.0 = 16.0 ✓                │
│                                                 │
│ □ Force Leave deducts from VL                │
│   But tracked separately                       │
│   Not marked as vacation spent                 │
│                                                 │
│ □ No negative balances                        │
│   All values >= 0                              │
│                                                 │
│ □ Running balance creates audit trail        │
│   Each row shows progression                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Quick Reference Card

### When Application is Approved:

**1. Determine Leave Type**
- Force Leave → Affects H only
- Sick Leave → Affects I only
- Vacation Leave → Affects H only
- SPL/Other → Tracked separately

**2. Extract Values**
- Get previous balance (H[n-1], I[n-1])
- Get days to deduct (D, E, or F)
- Get days earned (B, C) - usually 0
- Get period dates (A)

**3. Apply Formula**
```
IF Force Leave:
  new_H = old_H - force_days
  new_I = old_I  (unchanged)

IF Vacation Leave:
  new_H = old_H - vacation_days + vacation_earned
  new_I = old_I  (unchanged)

IF Sick Leave:
  new_H = old_H  (unchanged)
  new_I = old_I - sick_days + sick_earned

Total = new_H + new_I
```

**4. Validate**
- Ensure non-negative
- Check formula matches Excel
- Verify total = VL + SL

**5. Save**
- Update leavecard.vl = new_H
- Update leavecard.sl = new_I
- Record in leaveUsageHistory
- Save to database

**6. Display**
- Frontend fetches updated card
- Shows all transactions
- Displays current balance

---

## Annual Reset Logic

```
┌─────────────────────────────┐
│  NEW CALENDAR YEAR          │
├─────────────────────────────┤
│ Check: currentYear != lastYear
│                             │
│ IF TRUE:                    │
│ ├─ Reset Force Leave: F = 0 │
│ ├─ Reset SPL: SPL = 0       │
│ ├─ Update year: lastYear = currentYear
│ └─ Carry forward VL, SL    │
│                             │
│ Then apply formula normally  │
└─────────────────────────────┘
```

---

## Summary

**The formulas are simple but powerful:**

1. **Track running balance** - each row depends on previous
2. **Clear input/output columns** - see exactly what happened
3. **Separate leave types** - Force/SPL don't affect regular balance
4. **Cumulative audit trail** - can verify any point in time
5. **Formula validation** - math is always verifiable

**Portal must implement the same logic** to ensure:
- Employee trust (math matches Excel)
- Data consistency (no calculation errors)
- Audit compliance (complete history)
- System accuracy (cumulative verification)
