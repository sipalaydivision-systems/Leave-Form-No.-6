-- ============================================================
-- Leave Form Application - PostgreSQL Schema (Neon)
-- Run this once to initialize the database.
-- The app also auto-runs it on startup via db.initialize().
-- ============================================================

-- Users table (consolidates users.json, ao-users.json, hr-users.json, asds-users.json, sds-users.json, it-users.json)
CREATE TABLE IF NOT EXISTS users (
    _pk   SERIAL,
    id    BIGINT NOT NULL,
    email TEXT   NOT NULL,
    role  TEXT   NOT NULL DEFAULT 'user',
    data  JSONB  NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id, role)
);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role        ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email_role  ON users(email, role);

-- Pending registrations
CREATE TABLE IF NOT EXISTS pending_registrations (
    _pk   SERIAL,
    id    BIGINT NOT NULL,
    email TEXT   NOT NULL,
    role  TEXT   NOT NULL DEFAULT 'user',
    data  JSONB  NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, role)
);
CREATE INDEX IF NOT EXISTS idx_pending_email ON pending_registrations(email);

-- Leave applications
CREATE TABLE IF NOT EXISTS applications (
    id               TEXT PRIMARY KEY,
    employee_email   TEXT NOT NULL,
    status           TEXT DEFAULT 'pending',
    current_approver TEXT,
    leave_type       TEXT,
    data             JSONB NOT NULL DEFAULT '{}',
    submitted_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_email    ON applications(employee_email);
CREATE INDEX IF NOT EXISTS idx_app_status   ON applications(status);
CREATE INDEX IF NOT EXISTS idx_app_approver ON applications(current_approver);
CREATE INDEX IF NOT EXISTS idx_app_combo    ON applications(status, current_approver);

-- Leave cards
CREATE TABLE IF NOT EXISTS leavecards (
    _pk        SERIAL PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CTO records
CREATE TABLE IF NOT EXISTS cto_records (
    id          TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cto_emp ON cto_records(employee_id);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
    _pk        SERIAL PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
    _pk          SERIAL PRIMARY KEY,
    id           TEXT UNIQUE NOT NULL,
    action       TEXT,
    portal_type  TEXT,
    user_email   TEXT,
    log_timestamp TIMESTAMPTZ DEFAULT NOW(),
    data         JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_log_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_log_portal ON activity_logs(portal_type);
CREATE INDEX IF NOT EXISTS idx_log_ts     ON activity_logs(log_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_email  ON activity_logs(user_email);

-- Schools / offices (single row stores entire districts hierarchy)
CREATE TABLE IF NOT EXISTS schools (
    id   INT PRIMARY KEY DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'
);

-- Initial credits (single row stores the array)
CREATE TABLE IF NOT EXISTS initial_credits (
    id   INT PRIMARY KEY DEFAULT 1,
    data JSONB NOT NULL DEFAULT '[]'
);

-- SO records
CREATE TABLE IF NOT EXISTS so_records (
    _pk        SERIAL PRIMARY KEY,
    data       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- File uploads (R2 metadata)
CREATE TABLE IF NOT EXISTS file_uploads (
    id             SERIAL PRIMARY KEY,
    application_id TEXT,
    file_name      TEXT,
    content_type   TEXT DEFAULT 'application/pdf',
    r2_key         TEXT NOT NULL,
    file_size      INT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_app ON file_uploads(application_id);
