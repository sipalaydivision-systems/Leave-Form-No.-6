// Enhanced Leave Card Formula Implementation
// This file shows the corrected formula-based logic that should replace the current implementation

/**
 * Calculate leave balance using Excel formula logic
 * Formula: Balance[n] = Balance[n-1] - ForceLeave[n] - LeaveSpent[n] + LeaveEarned[n]
*/
function calculateLeaveBalance(previousVL, previousSL, vlEarned, slEarned, vlSpent, slSpent, forceLeaveSpent) {
    // Vacation Leave Balance Formula (from Excel Column H)
    // H[n] = H[n-1] - F[n] - D[n] + B[n]
    // = Previous Balance - Forced Leave - Vacation Spent + New Vacation Earned
    const newVLBalance = previousVL - forceLeaveSpent - vlSpent + vlEarned;
    
    // Sick Leave Balance Formula (from Excel Column I)
    // I[n] = I[n-1] - E[n] + C[n]
    // = Previous Balance - Sick Leave Spent + New Sick Leave Earned
    const newSLBalance = previousSL - slSpent + slEarned;
    
    // Total Balance (from Excel Column J)
    // J[n] = H[n] + I[n]
    const totalBalance = newVLBalance + newSLBalance;
    
    return {
        vl: Math.max(0, newVLBalance),      // Ensure non-negative
        sl: Math.max(0, newSLBalance),      // Ensure non-negative
        total: Math.max(0, totalBalance),
        calculation: {
            vlFormula: `${previousVL} - ${forceLeaveSpent} - ${vlSpent} + ${vlEarned} = ${newVLBalance}`,
            slFormula: `${previousSL} - ${slSpent} + ${slEarned} = ${newSLBalance}`
        }
    };
}

/**
 * Extract period dates from application
 * Returns formatted period string like "4/19/2021 - 4/30/2021"
 */
function extractPeriodCovered(application) {
    const dateFrom = application.dateFrom || application.date_from || application.inclusiveDatesFrom || '';
    const dateTo = application.dateTo || application.date_to || application.inclusiveDatesTo || '';
    
    if (!dateFrom) return 'Date not specified';
    
    // Format dates consistently
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'numeric', day: 'numeric' });
        } catch (e) {
            return dateStr;
        }
    };
    
    const from = formatDate(dateFrom);
    const to = dateTo ? formatDate(dateTo) : '';
    
    return to && to !== from ? `${from} - ${to}` : from;
}

/**
 * Enhanced version of updateLeaveCardWithUsage that properly implements Excel formulas
 * Should replace lines 2244-2358 in server.js
 */
function updateLeaveCardWithUsageEnhanced(application, vlUsed, slUsed) {
    try {
        const leavecards = readJSON(leavecardsFile);
        let leavecard = leavecards.find(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
        const currentYear = new Date().getFullYear();
        
        if (!leavecard) {
            // Create new leave card if not found
            leavecard = {
                email: application.employeeEmail,
                employeeId: application.employeeEmail,
                
                // Initial earned amounts
                vacationLeaveEarned: 100,
                sickLeaveEarned: 100,
                forceLeaveEarned: 0,
                splEarned: 3,
                
                // Current balances (matches Excel "BALANCE" column)
                vl: 100,     // Current Vacation Leave balance
                sl: 100,     // Current Sick Leave balance
                spl: 3,      // Current Special Privilege Leave balance
                others: 0,   // Other leaves balance
                
                // Totals spent (for audit trail)
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                
                // Year-based tracking
                forceLeaveYear: currentYear,
                splYear: currentYear,
                
                // Period-based history (matches Excel rows)
                leaveUsageHistory: [],
                
                createdAt: new Date().toISOString()
            };
            leavecards.push(leavecard);
        }
        
        // Initialize missing properties
        if (!leavecard.vacationLeaveEarned) leavecard.vacationLeaveEarned = 100;
        if (!leavecard.sickLeaveEarned) leavecard.sickLeaveEarned = 100;
        if (!leavecard.leaveUsageHistory) leavecard.leaveUsageHistory = [];
        
        // Reset Force Leave if year changed (annual reset per Excel logic)
        if (leavecard.forceLeaveYear !== currentYear) {
            leavecard.forceLeaveSpent = 0;
            leavecard.forceLeaveYear = currentYear;
        }
        
        // Reset Special Privilege Leave if year changed
        if (leavecard.splYear !== currentYear) {
            leavecard.splSpent = 0;
            leavecard.splYear = currentYear;
        }
        
        // Ensure balances are initialized with earned values
        if (leavecard.vl === undefined || leavecard.vl === null) {
            leavecard.vl = leavecard.vacationLeaveEarned - (leavecard.vacationLeaveSpent || 0);
        }
        if (leavecard.sl === undefined || leavecard.sl === null) {
            leavecard.sl = leavecard.sickLeaveEarned - (leavecard.sickLeaveSpent || 0);
        }
        
        // Get previous balance (for formula calculation)
        const previousVL = leavecard.vl || 100;
        const previousSL = leavecard.sl || 100;
        
        // Determine leave type and amounts from application
        let leaveType = 'Vacation Leave';  // Default
        let daysUsed = 0;
        let vlEarned = 0;
        let slEarned = 0;
        let forceLeaveUsed = 0;
        let splUsed = 0;
        
        // Parse application leave type
        const lType = (application.typeOfLeave || application.leaveType || '').toLowerCase();
        
        if (lType.includes('force') || lType === 'leave_mfl') {
            leaveType = 'Force Leave';
            forceLeaveUsed = parseFloat(application.numDays) || parseFloat(application.forceLeaveCount) || 1;
            daysUsed = forceLeaveUsed;
        } else if (lType.includes('special') || lType === 'leave_spl') {
            leaveType = 'Special Privilege Leave';
            splUsed = parseFloat(application.numDays) || parseFloat(application.splCount) || 1;
            daysUsed = splUsed;
        } else if (lType.includes('sick') || lType === 'leave_sl') {
            leaveType = 'Sick Leave';
            slUsed = parseFloat(application.numDays) || 1;
            daysUsed = slUsed;
        } else {
            // Default to vacation leave
            leaveType = 'Vacation Leave';
            vlUsed = parseFloat(application.numDays) || 1;
            daysUsed = vlUsed;
        }
        
        // Apply formula logic to calculate new balances
        const balanceResult = calculateLeaveBalance(
            previousVL,
            previousSL,
            vlEarned,    // Usually 0 on leave usage (earned on period additions)
            slEarned,    // Usually 0 on leave usage
            vlUsed,      // From application
            slUsed,      // From application
            forceLeaveUsed // Force leave doesn't deduct from VL/SL
        );
        
        // Update leaf card balances using calculated values
        leavecard.vl = balanceResult.vl;
        leavecard.sl = balanceResult.sl;
        
        // Update total spent amounts
        if (forceLeaveUsed > 0) {
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else {
            leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + vlUsed;
            leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + slUsed;
        }
        
        // Record this transaction in usage history
        const periodCovered = extractPeriodCovered(application);
        
        leavecard.leaveUsageHistory.push({
            // Transaction info
            applicationId: application.id,
            periodCovered: periodCovered,
            leaveType: leaveType,
            dateApproved: new Date().toISOString(),
            approvedBy: 'SDS',
            remarks: application.remarks || '',
            
            // Amounts (matches Excel columns)
            daysUsed: daysUsed,
            periodFrom: application.dateFrom || application.date_from || '',
            periodTo: application.dateTo || application.date_to || '',
            
            // Balance after this transaction (matches Excel BALANCE column)
            balanceAfterVL: leavecard.vl,
            balanceAfterSL: leavecard.sl,
            balanceAfterTotal: leavecard.vl + leavecard.sl,
            
            // Formula calculation details for audit
            calculation: balanceResult.calculation
        });
        
        leavecard.updatedAt = new Date().toISOString();
        
        // Update leavecard in array
        const lcIndex = leavecards.findIndex(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
        if (lcIndex !== -1) {
            leavecards[lcIndex] = leavecard;
        }
        
        writeJSON(leavecardsFile, leavecards);
        
        console.log(`[LEAVECARD] Updated with formula logic:`);
        console.log(`  Employee: ${application.employeeEmail}`);
        console.log(`  Leave Type: ${leaveType}`);
        console.log(`  Days Used: ${daysUsed}`);
        console.log(`  Previous VL: ${previousVL} → New VL: ${leavecard.vl}`);
        console.log(`  Previous SL: ${previousSL} → New SL: ${leavecard.sl}`);
        console.log(`  Total Balance: ${leavecard.vl + leavecard.sl}`);
        console.log(`  Formula: ${balanceResult.calculation.vlFormula}`);
        
    } catch (error) {
        console.error('Error updating leave balance with formula:', error);
    }
}

/**
 * Add period earned (when new period is added manually)
 * Similar to adding a row in Excel with "ADD: [date range]"
 */
function addPeriodEarned(employeeEmail, periodFrom, periodTo, vlEarned, slEarned) {
    try {
        const leavecards = readJSON(leavecardsFile);
        let leavecard = leavecards.find(lc => lc.email === employeeEmail);
        
        if (!leavecard) {
            console.error(`No leave card found for ${employeeEmail}`);
            return;
        }
        
        const previousVL = leavecard.vl || 100;
        const previousSL = leavecard.sl || 100;
        
        // Calculate new balance using formula
        const balanceResult = calculateLeaveBalance(
            previousVL,
            previousSL,
            vlEarned,
            slEarned,
            0,  // vlSpent = 0 (adding earned, not spending)
            0,  // slSpent = 0
            0   // forceLeaveUsed = 0
        );
        
        leavecard.vl = balanceResult.vl;
        leavecard.sl = balanceResult.sl;
        leavecard.vacationLeaveEarned = (leavecard.vacationLeaveEarned || 0) + vlEarned;
        leavecard.sickLeaveEarned = (leavecard.sickLeaveEarned || 0) + slEarned;
        
        // Record in history
        const periodDisplay = `ADD: ${new Date(periodFrom).toLocaleDateString('en-PH')} - ${new Date(periodTo).toLocaleDateString('en-PH')}`;
        
        leavecard.leaveUsageHistory.push({
            periodCovered: periodDisplay,
            leaveType: 'Period Addition',
            periodFrom: periodFrom,
            periodTo: periodTo,
            vlEarned: vlEarned,
            slEarned: slEarned,
            vlSpent: 0,
            slSpent: 0,
            balanceAfterVL: leavecard.vl,
            balanceAfterSL: leavecard.sl,
            balanceAfterTotal: leavecard.vl + leavecard.sl,
            dateAdded: new Date().toISOString()
        });
        
        leavecard.updatedAt = new Date().toISOString();
        
        const lcIndex = leavecards.findIndex(lc => lc.email === employeeEmail);
        if (lcIndex !== -1) {
            leavecards[lcIndex] = leavecard;
        }
        
        writeJSON(leavecardsFile, leavecards);
        
        console.log(`[LEAVECARD] Added period earned for ${employeeEmail}: +${vlEarned} VL, +${slEarned} SL → VL: ${leavecard.vl}, SL: ${leavecard.sl}`);
        
    } catch (error) {
        console.error('Error adding period earned:', error);
    }
}

module.exports = {
    calculateLeaveBalance,
    extractPeriodCovered,
    updateLeaveCardWithUsageEnhanced,
    addPeriodEarned
};
