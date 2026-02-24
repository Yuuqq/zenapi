CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  type INTEGER NOT NULL DEFAULT 1,
  group_name TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  rate_limit INTEGER DEFAULT 0,
  models_json TEXT,
  metadata_json TEXT,
  test_time INTEGER,
  response_time_ms INTEGER,
  api_format TEXT NOT NULL DEFAULT 'openai',
  custom_headers_json TEXT,
  contributed_by TEXT,
  tip_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  token_plain TEXT,
  quota_total INTEGER,
  quota_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  allowed_channels TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  token_id TEXT,
  channel_id TEXT,
  model TEXT,
  request_path TEXT,
  total_tokens INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost REAL,
  latency_ms INTEGER,
  first_token_latency_ms INTEGER,
  stream INTEGER,
  reasoning_effort TEXT,
  status TEXT,
  error_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS usage_logs_channel_id ON usage_logs(channel_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  linuxdo_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_linuxdo_id ON users(linuxdo_id);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_token ON user_sessions(token_hash);

CREATE TABLE IF NOT EXISTS model_aliases (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  alias_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS model_aliases_alias ON model_aliases(alias);
CREATE INDEX IF NOT EXISTS model_aliases_model_id ON model_aliases(model_id);
