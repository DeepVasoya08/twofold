-- Lets expired sessions and finished failed-login windows be deleted without a full scan.

CREATE INDEX sessions_by_expiry ON sessions (expires_at);

CREATE INDEX login_failures_by_window ON login_failures (window_start);
