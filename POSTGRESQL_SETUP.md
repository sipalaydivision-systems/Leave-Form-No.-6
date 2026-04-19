# PostgreSQL Setup Guide

This guide walks through setting up and migrating the Leave Form No. 6 system from JSON to PostgreSQL.

## Prerequisites

- PostgreSQL 12+ installed
- Node.js 16+
- `pg` npm package (run `npm install pg`)

---

## Step 1: Create PostgreSQL Database

### On Local Machine

```bash
# Connect to PostgreSQL as admin
psql -U postgres

# Create database
CREATE DATABASE leave_form_no6;

# Create user with password
CREATE USER leave_user WITH PASSWORD 'secure_password_here';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE leave_form_no6 TO leave_user;

# Exit psql
\q
```

### On Cloud (Heroku, Railway, Supabase, etc.)

Create a new PostgreSQL database via the provider's dashboard. Note the connection URL:
```
postgres://user:password@host:port/database
```

---

## Step 2: Create Schema

### Run SQL Schema File

```bash
# Local PostgreSQL
psql -U leave_user -d leave_form_no6 -f database.sql

# OR with password prompt
psql -U leave_user -d leave_form_no6 -h localhost -f database.sql
```

### Verify Schema Created

```bash
psql -U leave_user -d leave_form_no6 -c "\dt"
```

You should see all tables listed:
```
users, hr_users, aov_users, asds_users, sds_users, it_users,
employees, leave_cards, applications, approval_history, cto_records,
pending_registrations, sessions, activity_logs, system_state
```

---

## Step 3: Install pg Package

```bash
npm install pg
```

---

## Step 4: Set DATABASE_URL Environment Variable

### Local Testing

```bash
# Bash/Zsh
export DATABASE_URL="postgres://leave_user:password@localhost:5432/leave_form_no6"

# Windows PowerShell
$env:DATABASE_URL="postgres://leave_user:password@localhost:5432/leave_form_no6"

# Then start server
node server.js
```

### Railway Deployment

Add environment variable in Railway dashboard:
```
DATABASE_URL=postgres://user:password@host:port/database
```

### Supabase

```
DATABASE_URL=postgresql://user:password@host.supabase.co:5432/database
```

---

## Step 5: Migrate Data from JSON

If you have existing JSON data, run the migration script:

```bash
DATABASE_URL="postgres://leave_user:password@localhost:5432/leave_form_no6" \
  node scripts/migrate-to-postgres.js
```

**Output should show:**
```
[MIGRATE] Starting PostgreSQL migration...
[MIGRATE] Migrating employee users...
  ✓ Migrated X employee users
[MIGRATE] Migrating HR users...
  ✓ Migrated X HR users
...
✅ MIGRATION COMPLETE!
```

---

## Step 6: Verify Database Connection

Start the server with DATABASE_URL set:

```bash
DATABASE_URL="postgres://leave_user:password@localhost:5432/leave_form_no6" npm start
```

Check logs for:
```
[DATABASE] PostgreSQL mode enabled
```

If you see:
```
[DATABASE] JSON file mode enabled (DATABASE_URL not set)
```

The DATABASE_URL is not set correctly.

---

## Step 7: Update server.js for PostgreSQL (Optional)

Currently, server.js uses JSON files by default. To use PostgreSQL, modify login handlers:

**Current (JSON mode):**
```javascript
let users = readJSON(userFile);
const user = users.find(u => u.email === email);
```

**PostgreSQL mode (requires code changes):**
```javascript
const { DatabaseAdapter } = require('./lib/db-adapter');
const user = await DatabaseAdapter.getUserByEmail(email, 'hr_users');
```

The migration scripts are prepared. To implement full PostgreSQL support in server.js, you would need to:

1. Replace all `readJSON()` calls with database queries
2. Replace all `writeJSON()` calls with database inserts/updates
3. Make login handlers async

**This is optional** — the system works perfectly with JSON files and DATABASE_URL will be used by the adapter layer when you're ready to fully migrate.

---

## Backup Strategy

### Backup PostgreSQL Database

```bash
# Create backup
pg_dump -U leave_user -d leave_form_no6 > backup.sql

# Restore backup
psql -U leave_user -d leave_form_no6 < backup.sql
```

### Backup Frequency (Recommended)

- **Daily**: Automated backups via cloud provider
- **Weekly**: Manual export before major changes
- **On-demand**: Before migrations or significant updates

---

## Troubleshooting

### "psql: error: could not connect to server"

**Cause**: PostgreSQL not running or wrong credentials

**Solution**:
```bash
# Start PostgreSQL (macOS)
brew services start postgresql

# Start PostgreSQL (Linux)
sudo systemctl start postgresql

# Start PostgreSQL (Windows)
# Use Services app or: pg_ctl -D "C:\Program Files\PostgreSQL\data" start
```

### "FATAL: Ident authentication failed for user"

**Cause**: PostgreSQL auth method is set to `ident` instead of `md5`

**Solution**: Edit `postgresql.conf` and change:
```
host    all             all             127.0.0.1               md5
```

Then restart PostgreSQL.

### "role 'leave_user' does not exist"

**Solution**: Create the user:
```bash
psql -U postgres
CREATE USER leave_user WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE leave_form_no6 TO leave_user;
\q
```

### Migration Script Fails

**Check**:
1. Database URL is correct: `psql $DATABASE_URL -c "SELECT 1"`
2. Schema is created: `psql $DATABASE_URL -c "\dt"`
3. No permission errors: Ensure `leave_user` has INSERT/UPDATE rights

---

## Performance Tuning

### For Production

PostgreSQL is significantly faster than JSON files for:
- Large datasets (>10MB)
- Frequent queries
- Concurrent users

### Connection Pool Size

Default: 10 connections

For high concurrency (100+ users), increase in server code:
```javascript
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,  // Max connections
    idleTimeoutMillis: 30000,
});
```

### Indexes

Schema includes these indexes for performance:
```sql
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_activity_logs_timestamp ON activity_logs(timestamp);
```

Add more as needed based on query patterns.

---

## Monitoring

### Check Database Size

```bash
psql -U leave_user -d leave_form_no6 -c "\l+"
```

### Check Table Sizes

```bash
psql -U leave_user -d leave_form_no6 -c "
  SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname != 'pg_catalog'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

### Active Connections

```bash
psql -U leave_user -d leave_form_no6 -c "SELECT pid, usename, application_name, state FROM pg_stat_activity;"
```

---

## Rollback to JSON

If you need to revert to JSON mode:

```bash
# Unset DATABASE_URL
unset DATABASE_URL

# Server will automatically use JSON files
npm start
```

---

## Next Steps

1. ✅ Create PostgreSQL database
2. ✅ Run schema creation script
3. ✅ Set DATABASE_URL environment variable
4. ✅ (Optional) Run migration script if you have existing data
5. ✅ Test server with DATABASE_URL set
6. ✅ Deploy to Railway with DATABASE_URL configured
7. ✅ Monitor and backup regularly

---

## Support

For PostgreSQL issues, check:
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [pg npm package](https://www.npmjs.com/package/pg)
- Cloud provider docs (Heroku, Railway, Supabase, etc.)
