-- ============================================================
-- SDO Sipalay Leave Management System — PostgreSQL Schema
-- Consolidates 6 JSON user files, leavecards, applications,
-- CTO records, activity logs, sessions, and system state.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS (consolidates users.json + ao/hr/asds/sds/it-users.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(20),
    role VARCHAR(10) NOT NULL CHECK(role IN ('user','ao','hr','asds','sds','it')),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step VARCHAR(10),
    salary NUMERIC(12,2),
    employee_number VARCHAR(50),
    pin_hash TEXT,                 -- For IT users (6-digit PIN auth)
    district VARCHAR(100),
    school VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_office ON users(office);

-- ============================================================
-- LEAVE CARDS (one per employee, all balance tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    employee_number VARCHAR(50),
    vacation_leave_earned NUMERIC(8,3) DEFAULT 0,
    sick_leave_earned NUMERIC(8,3) DEFAULT 0,
    vacation_leave_spent NUMERIC(8,3) DEFAULT 0,
    sick_leave_spent NUMERIC(8,3) DEFAULT 0,
    force_leave_earned NUMERIC(8,3) DEFAULT 5,
    force_leave_spent NUMERIC(8,3) DEFAULT 0,
    force_leave_year INTEGER,
    spl_earned NUMERIC(8,3) DEFAULT 3,
    spl_spent NUMERIC(8,3) DEFAULT 0,
    spl_year INTEGER,
    wellness_earned NUMERIC(8,3) DEFAULT 3,
    wellness_spent NUMERIC(8,3) DEFAULT 0,
    wellness_year INTEGER,
    others_balance NUMERIC(8,3) DEFAULT 0,
    date_of_original_appointment DATE,
    first_day_of_service DATE,
    initial_credits_source VARCHAR(50),
    last_accrual_date VARCHAR(7),  -- 'YYYY-MM' format
    pvp_deduction_total NUMERIC(8,3) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_cards_user ON leave_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_cards_email ON leave_cards(email);

-- ============================================================
-- LEAVE TRANSACTIONS (replaces transactions[] array)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_card_id UUID NOT NULL REFERENCES leave_cards(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK(type IN ('ADD','DEDUCT','ADJUST')),
    period_covered VARCHAR(100),
    vl_earned NUMERIC(8,3) DEFAULT 0,
    sl_earned NUMERIC(8,3) DEFAULT 0,
    vl_spent NUMERIC(8,3) DEFAULT 0,
    sl_spent NUMERIC(8,3) DEFAULT 0,
    forced_leave NUMERIC(8,3) DEFAULT 0,
    spl_used NUMERIC(8,3) DEFAULT 0,
    wellness_used NUMERIC(8,3) DEFAULT 0,
    vl_balance NUMERIC(8,3),
    sl_balance NUMERIC(8,3),
    total NUMERIC(8,3),
    source VARCHAR(50),
    application_id VARCHAR(50),
    notes TEXT,
    date_recorded TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_card ON leave_transactions(leave_card_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON leave_transactions(date_recorded);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON leave_transactions(source);

-- ============================================================
-- LEAVE USAGE HISTORY (replaces leaveUsageHistory[] array)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_usage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_card_id UUID NOT NULL REFERENCES leave_cards(id) ON DELETE CASCADE,
    application_id VARCHAR(50),
    leave_type VARCHAR(50),
    days_used NUMERIC(8,3),
    period_from DATE,
    period_to DATE,
    date_approved TIMESTAMPTZ,
    approved_by VARCHAR(10),
    remarks TEXT,
    balance_after_vl NUMERIC(8,3),
    balance_after_sl NUMERIC(8,3)
);

CREATE INDEX IF NOT EXISTS idx_usage_card ON leave_usage_history(leave_card_id);

-- ============================================================
-- LEAVE APPLICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(50) PRIMARY KEY,   -- e.g. 'SDO Sipalay-01-RMCJ'
    employee_email VARCHAR(255) NOT NULL,
    employee_name VARCHAR(255),
    office VARCHAR(255),
    position VARCHAR(255),
    salary VARCHAR(50),
    leave_type VARCHAR(50) NOT NULL,
    leave_details JSONB DEFAULT '{}',
    num_days NUMERIC(8,3) NOT NULL,
    date_from DATE,
    date_to DATE,
    inclusive_dates TEXT,
    commutation VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending','returned','approved','rejected','cancelled')),
    current_approver VARCHAR(10) CHECK(current_approver IN ('AO','HR','ASDS','SDS','EMPLOYEE',NULL)),
    is_school_based BOOLEAN DEFAULT FALSE,
    -- Leave credit snapshots
    vl_earned NUMERIC(8,3),
    vl_less NUMERIC(8,3),
    vl_balance NUMERIC(8,3),
    sl_earned NUMERIC(8,3),
    sl_less NUMERIC(8,3),
    sl_balance NUMERIC(8,3),
    -- Approval chain
    ao_approved_at TIMESTAMPTZ,
    ao_name VARCHAR(255),
    ao_recommendation TEXT,
    ao_signature TEXT,
    hr_approved_at TIMESTAMPTZ,
    hr_officer_name VARCHAR(255),
    hr_certification TEXT,
    hr_signature TEXT,
    hr_days_with_pay NUMERIC(8,3),
    hr_days_without_pay NUMERIC(8,3),
    asds_approved_at TIMESTAMPTZ,
    asds_officer_name VARCHAR(255),
    asds_recommendation TEXT,
    asds_signature TEXT,
    final_approval_at TIMESTAMPTZ,
    sds_officer_name VARCHAR(255),
    sds_disapproval_reason TEXT,
    sds_signature TEXT,
    -- Signatures & metadata
    employee_signature TEXT,
    return_reason TEXT,
    rejection_reason TEXT,
    pdf_url TEXT,
    so_file_path VARCHAR(500),
    so_file_name VARCHAR(255),
    approval_history JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(employee_email);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_approver ON applications(current_approver);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(leave_type);

-- ============================================================
-- PENDING REGISTRATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    portal VARCHAR(10) NOT NULL,
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(20),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step VARCHAR(10),
    salary NUMERIC(12,2),
    employee_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registrations_status ON pending_registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_email ON pending_registrations(email);

-- ============================================================
-- CTO RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS cto_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    employee_id VARCHAR(255),
    employee_name VARCHAR(255),
    type VARCHAR(10) DEFAULT 'ADD' CHECK(type IN ('ADD','DEDUCT')),
    so_details TEXT,
    period_covered TEXT,
    days_granted NUMERIC(8,3) DEFAULT 0,
    days_used NUMERIC(8,3) DEFAULT 0,
    balance NUMERIC(8,3) DEFAULT 0,
    so_image TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cto_email ON cto_records(email);

-- ============================================================
-- ACTIVITY LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action VARCHAR(100) NOT NULL,
    portal_type VARCHAR(10),
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    ip VARCHAR(45),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_user ON activity_logs(user_email);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(96) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL,
    portal VARCHAR(20) NOT NULL,
    name VARCHAR(255),
    user_data JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- SYSTEM STATE (key-value config)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_state (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SCHOOLS REFERENCE DATA
-- ============================================================
CREATE TABLE IF NOT EXISTS schools (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    district_id INTEGER,
    district_name VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_schools_district ON schools(district_id);

-- ============================================================
-- INITIAL CREDITS LOOKUP (from Excel imports)
-- ============================================================
CREATE TABLE IF NOT EXISTS initial_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_name VARCHAR(255),
    email VARCHAR(255),
    vl_balance NUMERIC(8,3),
    sl_balance NUMERIC(8,3),
    imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_initial_credits_email ON initial_credits(email);
