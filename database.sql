-- PostgreSQL Schema for Leave Form No. 6 System
-- Run this script: psql -U postgres -d leave_form_no6 -f database.sql

-- Users (Employee Portal)
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    employee_no VARCHAR(50),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- HR Portal Users (Admin Officer)
CREATE TABLE IF NOT EXISTS hr_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    role VARCHAR(50) DEFAULT 'hr',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AOV Portal Users (Admin Officer V)
CREATE TABLE IF NOT EXISTS aov_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    role VARCHAR(50) DEFAULT 'aov',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ASDS Portal Users
CREATE TABLE IF NOT EXISTS asds_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    role VARCHAR(50) DEFAULT 'asds',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SDS Portal Users
CREATE TABLE IF NOT EXISTS sds_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    role VARCHAR(50) DEFAULT 'sds',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IT Portal Users
CREATE TABLE IF NOT EXISTS it_users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    full_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees Directory
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    district VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leave Cards
CREATE TABLE IF NOT EXISTS leave_cards (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    employee_id BIGINT,
    full_name VARCHAR(255),
    name VARCHAR(255),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    district VARCHAR(255),
    vacation_leave_earned NUMERIC(8,3) DEFAULT 0,
    vacation_leave_used NUMERIC(8,3) DEFAULT 0,
    sick_leave_earned NUMERIC(8,3) DEFAULT 0,
    sick_leave_used NUMERIC(8,3) DEFAULT 0,
    special_privilege_leave NUMERIC(8,3) DEFAULT 3,
    spl_year INT,
    wellness_leave NUMERIC(8,3) DEFAULT 3,
    wellness_year INT,
    vl NUMERIC(8,3) DEFAULT 0,
    sl NUMERIC(8,3) DEFAULT 0,
    spl NUMERIC(8,3) DEFAULT 0,
    last_accrual_date VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email)
);

-- Leave Applications
CREATE TABLE IF NOT EXISTS applications (
    id UUID PRIMARY KEY,
    employee_email VARCHAR(255) NOT NULL,
    employee_name VARCHAR(255),
    office VARCHAR(255),
    position VARCHAR(255),
    salary NUMERIC(10,2),
    date_of_filing TIMESTAMP,
    leave_type VARCHAR(50),
    date_from DATE,
    date_to DATE,
    num_days NUMERIC(5,1),
    vl_earned NUMERIC(8,3),
    sl_earned NUMERIC(8,3),
    commutation BOOLEAN DEFAULT FALSE,
    location_ph VARCHAR(255),
    sick_hospital VARCHAR(255),
    study_masters VARCHAR(255),
    women_illness VARCHAR(255),
    other_leave_specify VARCHAR(255),
    so_file_data LONGTEXT,
    employee_signature LONGTEXT,
    current_approver VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    hr_approved_at TIMESTAMP,
    ao_approved_at TIMESTAMP,
    asds_approved_at TIMESTAMP,
    sds_approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_email) REFERENCES users(email)
);

-- Approval History
CREATE TABLE IF NOT EXISTS approval_history (
    id SERIAL PRIMARY KEY,
    application_id UUID NOT NULL,
    portal VARCHAR(50),
    action VARCHAR(50),
    approver_name VARCHAR(255),
    remarks TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id)
);

-- CTO Records (Compensatory Time Off)
CREATE TABLE IF NOT EXISTS cto_records (
    id UUID PRIMARY KEY,
    employee_email VARCHAR(255) NOT NULL,
    employee_name VARCHAR(255),
    office VARCHAR(255),
    position VARCHAR(255),
    salary NUMERIC(10,2),
    earned_date DATE,
    hours_earned NUMERIC(5,2),
    hours_used NUMERIC(5,2),
    hours_balance NUMERIC(5,2),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_email) REFERENCES users(email)
);

-- Pending Registrations
CREATE TABLE IF NOT EXISTS pending_registrations (
    id UUID PRIMARY KEY,
    portal VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary_grade VARCHAR(10),
    step INT,
    salary NUMERIC(10,2),
    employee_no VARCHAR(50),
    district VARCHAR(255),
    role VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    processed_by VARCHAR(255)
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255),
    user_email VARCHAR(255),
    role VARCHAR(50),
    portal VARCHAR(50),
    user_name VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    middle_name VARCHAR(100),
    suffix VARCHAR(50),
    office VARCHAR(255),
    position VARCHAR(255),
    salary NUMERIC(10,2),
    salary_grade VARCHAR(10),
    step INT,
    employee_no VARCHAR(50),
    must_change_password BOOLEAN DEFAULT FALSE,
    created_at BIGINT,
    expires_at BIGINT
);

-- Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(50),
    portal_type VARCHAR(50),
    user_email VARCHAR(255),
    user_id VARCHAR(255),
    ip VARCHAR(50),
    user_agent TEXT,
    details JSONB
);

-- System State
CREATE TABLE IF NOT EXISTS system_state (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for Performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_hr_users_email ON hr_users(email);
CREATE INDEX IF NOT EXISTS idx_aov_users_email ON aov_users(email);
CREATE INDEX IF NOT EXISTS idx_asds_users_email ON asds_users(email);
CREATE INDEX IF NOT EXISTS idx_sds_users_email ON sds_users(email);
CREATE INDEX IF NOT EXISTS idx_it_users_email ON it_users(email);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_leave_cards_email ON leave_cards(email);
CREATE INDEX IF NOT EXISTS idx_applications_employee ON applications(employee_email);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_approver ON applications(current_approver);
CREATE INDEX IF NOT EXISTS idx_cto_employee ON cto_records(employee_email);
CREATE INDEX IF NOT EXISTS idx_activity_logs_email ON activity_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(user_email);
