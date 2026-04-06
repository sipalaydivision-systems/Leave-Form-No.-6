/**
 * Repository factory — creates a fresh, lazily-loaded set of repositories
 * for each request.  Each instance holds its own in-memory cache so a
 * single request never reads the same file twice.
 *
 * Usage in a route handler:
 *
 *   const { repos } = require('../data/repositories');
 *
 *   router.get('/api/leave-credits', requireAuth(), (req, res) => {
 *       const { leavecards, applications, cto } = repos();
 *       const card = leavecards.findByEmail(req.query.employeeId);
 *       const activeApps = applications.findActiveByEmail(req.query.employeeId);
 *       // pass to service — no more file reads inside the service
 *       const balance = LeaveBalanceService.effectiveBalance(card, activeApps);
 *       res.json({ success: true, balance });
 *   });
 */

const LeaveCardRepository   = require('./leave-card');
const { ApplicationRepository, STATUS, PORTAL } = require('./application');
const CtoRepository         = require('./cto');

/**
 * Create a fresh repository context.
 * Call once per request; do not share across requests.
 *
 * @returns {{ leavecards: LeaveCardRepository, applications: ApplicationRepository, cto: CtoRepository }}
 */
function repos() {
    return {
        leavecards:   new LeaveCardRepository(),
        applications: new ApplicationRepository(),
        cto:          new CtoRepository(),
    };
}

module.exports = { repos, STATUS, PORTAL };
