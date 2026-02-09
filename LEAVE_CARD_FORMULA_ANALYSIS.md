# Leave Card Formula Analysis Report

## Overview
I've examined the Excel leave card files from both the Non-Teaching Personnel and Teaching Personnel folders. The formulas work differently between the two types.

---

## **NON-TEACHING PERSONNEL LEAVE CARDS**
**Sample File:** ACUHIDO, ELIZA B.xlsx  
**Sheet:** Leave Card (NE)  
**Status:** Uses formulas (291 formulas found)

### Structure:
```
ROW 12 HEADERS:
B12: VACATION (Leave Earned)
C12: SICK (Leave Earned)
D12: VACATION (Leave Spent)
E12: SICK (Leave Spent)
F12: FORCED (Forced Leave)
G12: SPECIAL PRIVILEGE LEAVE
H12: VACATION (Balance)
I12: SICK (Balance)
J12: TOTAL (Combined Balance)
```

### Core Formulas (Running Balance System):

#### **Row 14 (Initial Balance):**
- **H14 = B14** → Vacation balance starts with vacation earned
- **I14 = C14** → Sick leave balance starts with sick leave earned
- **J14 = H14 + I14** → Total balance = vacation + sick

#### **Rows 15+ (Running Calculations):**
- **H[n] = H[n-1] - F[n] - D[n] + B[n]**
  - Takes previous balance (H[n-1])
  - Subtracts forced leave used (F[n])
  - Subtracts vacation spent (D[n])
  - Adds new vacation earned (B[n])

- **I[n] = I[n-1] - E[n] + C[n]**
  - Takes previous sick leave balance (I[n-1])
  - Subtracts sick leave spent (E[n])
  - Adds new sick leave earned (C[n])

- **J[n] = H[n] + I[n]**
  - Total balance = vacation balance + sick leave balance

### Example Progression (from file):
```
Row 14: ADD: 4/19/2021 - 4/30/2021
  B14: 0.5 (vacation earned) → H14 = 0.5
  C14: 0.5 (sick earned)     → I14 = 0.5
                              → J14 = 1.0

Row 15: ADD: 5/01/2021 - 10/30/2021
  B15: 7.5  F15: 0  D15: 0
  C15: 7.5  E15: 0
  H15 = 0.5 - 0 - 0 + 7.5 = 8.0
  I15 = 0.5 - 0 + 7.5 = 8.0
  J15 = 8.0 + 8.0 = 16.0

Row 16: LESS: 11/09/2021
  F16: 1 (forced leave used)
  B16: 0  D16: 0
  C16: 0  E16: 0
  H16 = 8.0 - 1 - 0 + 0 = 7.0
  I16 = 8.0 - 0 + 0 = 8.0
  J16 = 7.0 + 8.0 = 15.0
```

---

## **TEACHING PERSONNEL LEAVE CARDS**
**Sample File:** ABANILLA, FE.xlsx  
**Sheet:** Sheet1  
**Status:** Static values (0 formulas found)

### Structure:
```
ROW 16 HEADERS:
B16: Special Order No. and Date Issued
F16: No. of Days Granted
H16: No. of Days Used
J16: Balance
```

### Data Entry (Manual):
The teaching personnel leave cards contain manual entries:
```
Row 17: ADD: 10/27/2022
  B17: S.0 # 108, S. 2022 BRIGADA & O
  F17: 15 (days granted)
  H17: 0 (days used)
  J17: 15 (balance - manually entered)

Row 18: LESS: APRIL 17, 2023
  B18: S.0 # 108, S. 2022 BRIGADA & O
  H18: 1 (days used)
  J18: 14 (balance - manually entered)
```

**Note:** No formulas are used. Each balance value is manually entered.

---

## **Key Differences**

| Aspect | Non-Teaching | Teaching |
|--------|--------------|----------|
| File Type | Automated formulas | Static values |
| Balance Calculation | Formula-driven | Manual entry |
| Columns | 10 columns (A-J) | Multiple columns including special orders |
| Leave Types | Vacation & Sick | Various special leaves |
| Formula Count | 291 formulas | 0 formulas |
| Data Entry | Semi-automated | Manual |

---

## **How the Non-Teaching Formula Works**

The system uses a **cumulative running balance approach**:

1. **First entry (Row 14):** Sets the initial balance equal to leave earned
2. **Subsequent entries:** Each row calculates:
   - Previous balance
   - Minus leaves taken (vacation spent, sick spent, forced leave)
   - Plus new leaves earned
3. **Total column:** Always sums vacation + sick balances
4. **Dynamic tracking:** As you add new rows, each automatically calculates the updated balance

This creates an **audit trail** showing:
- Date of transaction
- How much leave was earned/lost
- Running balance at each step
- Breakdown by leave type

---

## **Data Entry Flow (Non-Teaching)**

1. Employee fills in transaction date and amount in columns A-G
2. Formulas automatically calculate updated balances in columns H-J
3. Next row's formula references previous balance for cumulative tracking
4. No manual balance calculation needed

This automated approach reduces errors and maintains an accurate leave balance history.
