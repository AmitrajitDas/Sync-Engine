CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  name TEXT NOT NULL,
  area_ha DOUBLE PRECISION,
  created_by TEXT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plots (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  name TEXT,
  area_ha DOUBLE PRECISION,
  crop_type TEXT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crops (
  id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  variety TEXT,
  sowing_date DATE,
  harvest_date DATE,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_events (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB,
  seq BIGINT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  inspector_id TEXT,
  status TEXT,
  notes TEXT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gdc_submissions (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount DOUBLE PRECISION,
  currency TEXT,
  status TEXT,
  paid_at TIMESTAMPTZ,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farm_members (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  client_id TEXT,
  client_seq BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE farms REPLICA IDENTITY FULL;
ALTER TABLE plots REPLICA IDENTITY FULL;
ALTER TABLE crops REPLICA IDENTITY FULL;
ALTER TABLE action_events REPLICA IDENTITY FULL;
ALTER TABLE inspections REPLICA IDENTITY FULL;
ALTER TABLE gdc_submissions REPLICA IDENTITY FULL;
ALTER TABLE invoices REPLICA IDENTITY FULL;
ALTER TABLE farm_members REPLICA IDENTITY FULL;
ALTER TABLE attachments REPLICA IDENTITY FULL;
