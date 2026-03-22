/**
 * Repository Index — Re-exports all repository modules.
 */

module.exports = {
    users: require('./user-repository'),
    leaveCards: require('./leave-card-repository'),
    applications: require('./application-repository'),
    registrations: require('./registration-repository'),
    cto: require('./cto-repository'),
    activityLogs: require('./activity-log-repository'),
    sessions: require('./session-repository'),
    schools: require('./school-repository'),
};
