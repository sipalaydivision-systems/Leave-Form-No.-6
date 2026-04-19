# PostgreSQL Quick Start (5 Minutes)

## For Development (Local)

### 1. Install PostgreSQL
```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# Windows
# Download from https://www.postgresql.org/download/
```

### 2. Create Database & User
```bash
psql -U postgres

-- Inside psql prompt:
CREATE DATABASE leave_form_no6;
CREATE USER leave_user WITH PASSWORD 'dev_password_123';
GRANT ALL PRIVILEGES ON DATABASE leave_form_no6 TO leave_user;
\q
```

### 3. Create Schema
```bash
psql -U leave_user -d leave_form_no6 -f database.sql
```

### 4. Start with PostgreSQL
```bash
export DATABASE_URL="postgres://leave_user:dev_password_123@localhost:5432/leave_form_no6"
npm start
```

**Expected output:**
```
[DATABASE] PostgreSQL mode enabled
Server running on port 3000
```

### 5. Migrate Existing Data (if any)
```bash
node scripts/migrate-to-postgres.js
```

---

## For Production (Railway/Heroku/Supabase)

### 1. Create PostgreSQL Database

**Railway:**
- Add PostgreSQL plugin in Railway dashboard
- Copy connection string from dashboard

**Heroku:**
```bash
heroku addons:create heroku-postgresql:standard-0 --app your-app-name
heroku config --app your-app-name | grep DATABASE_URL
```

**Supabase:**
- Create project at supabase.com
- Get connection string from database settings

### 2. Create Schema on Cloud
```bash
# Replace with your DATABASE_URL from cloud provider
psql "postgres://user:password@host:port/database" -f database.sql
```

### 3. Set Environment Variable

**Railway:**
```
DATABASE_URL=postgres://user:password@host:port/database
```

**Heroku:**
```bash
heroku config:set DATABASE_URL="postgres://..." --app your-app-name
```

### 4. Deploy
```bash
git push heroku main    # Heroku
git push origin main    # Railway auto-deploys
```

### 5. Verify Connection
Check logs for: `[DATABASE] PostgreSQL mode enabled`

---

## Verify It's Working

### Check Database Connection
```bash
curl http://localhost:3000/api/health
```

Response should include:
```json
{"success":true,"uptime":...}
```

### Test Login (with existing user)
```bash
curl -X POST http://localhost:3000/api/hr-login \
  -H "Content-Type: application/json" \
  -d '{"email":"testhr@deped.gov.ph","password":"TestPassword123!"}'
```

---

## Rollback to JSON

If something goes wrong:
```bash
# Remove DATABASE_URL
unset DATABASE_URL

# Restart — system will use JSON files
npm start
```

No data loss — your JSON files are still there.

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| `[DATABASE] JSON file mode enabled` | DATABASE_URL not set. Export it: `export DATABASE_URL="postgres://..."`  |
| `FATAL: Ident authentication failed` | PostgreSQL auth misconfigured. Use `md5` auth in postgresql.conf |
| `Connection refused` | PostgreSQL not running. Start it: `brew services start postgresql` |
| Migration fails | Check DATABASE_URL: `psql $DATABASE_URL -c "SELECT 1"` |

---

## Next: Full Setup

For detailed configuration, backups, monitoring, see:
→ [`POSTGRESQL_SETUP.md`](./POSTGRESQL_SETUP.md)
