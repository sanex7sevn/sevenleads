const migrations = [
  {
    id: '001_product_workspace',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prospecting_lists (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lead_lists (
          user_id TEXT NOT NULL,
          list_id TEXT NOT NULL,
          lead_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, list_id, lead_id),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(list_id) REFERENCES prospecting_lists(id) ON DELETE CASCADE,
          FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS admin_actions (
          id TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          details TEXT DEFAULT '{}',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_lists_user ON prospecting_lists(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lead_lists_list ON lead_lists(user_id, list_id);
        CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at DESC);
      `);

      ensureColumn(db, 'searches', 'status', "TEXT DEFAULT 'completed'");
      ensureColumn(db, 'searches', 'list_id', 'TEXT');
      ensureColumn(db, 'leads', 'search_id', 'TEXT');
      ensureColumn(db, 'leads', 'notes', "TEXT DEFAULT ''");
      ensureColumn(db, 'leads', 'tags', "TEXT DEFAULT '[]'");
      ensureColumn(db, 'leads', 'next_follow_up', 'TEXT');
      ensureColumn(db, 'leads', 'estimated_value', 'REAL DEFAULT 0');
      ensureColumn(db, 'leads', 'whatsapp_verified', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'users', 'email_verified', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'users', 'email_verification_token', 'TEXT');
      ensureColumn(db, 'users', 'password_reset_token', 'TEXT');
      ensureColumn(db, 'users', 'password_reset_expires_at', 'TEXT');
      ensureColumn(db, 'payments', 'receipt_path', 'TEXT');
      ensureColumn(db, 'payments', 'receipt_name', 'TEXT');

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_searches_user_created ON searches(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_leads_user_search ON leads(user_id, search_id);
        CREATE INDEX IF NOT EXISTS idx_leads_follow_up ON leads(user_id, next_follow_up);
      `);

      db.prepare("UPDATE leads SET status = 'contatado' WHERE status = 'contatado_sem_retorno'").run();
      db.prepare("UPDATE leads SET status = 'cliente' WHERE status = 'fechado'").run();
    }
  },
  {
    id: '002_multi_source',
    up(db) {
      ensureColumn(db, 'leads', 'source', "TEXT DEFAULT 'google_maps'");
      ensureColumn(db, 'searches', 'source', "TEXT DEFAULT 'google_maps'");
    }
  },
  {
    id: '003_search_operations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS search_jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          query TEXT NOT NULL,
          criteria TEXT DEFAULT '{}',
          source TEXT NOT NULL,
          source_label TEXT,
          max_results INTEGER DEFAULT 50,
          status TEXT DEFAULT 'queued',
          phase TEXT DEFAULT 'queued',
          found INTEGER DEFAULT 0,
          analyzed INTEGER DEFAULT 0,
          remaining INTEGER DEFAULT 0,
          results TEXT,
          error TEXT,
          search_id TEXT,
          interpreted_location TEXT,
          has_active_subscription INTEGER DEFAULT 0,
          quota_reserved INTEGER DEFAULT 0,
          quota_released INTEGER DEFAULT 0,
          quota_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS search_cache (
          cache_key TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_metrics (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          source TEXT NOT NULL,
          query TEXT NOT NULL,
          location TEXT,
          status TEXT NOT NULL,
          error_code TEXT,
          http_status INTEGER,
          duration_ms INTEGER DEFAULT 0,
          result_count INTEGER DEFAULT 0,
          phone_count INTEGER DEFAULT 0,
          website_count INTEGER DEFAULT 0,
          cache_hit INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_search_jobs_user_status ON search_jobs(user_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_jobs_updated ON search_jobs(updated_at);
        CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);
        CREATE INDEX IF NOT EXISTS idx_source_metrics_source_created ON source_metrics(source, created_at DESC);
      `);

      ensureColumn(db, 'searches', 'category', 'TEXT');
      ensureColumn(db, 'searches', 'city', 'TEXT');
      ensureColumn(db, 'searches', 'region', 'TEXT');
      ensureColumn(db, 'searches', 'country', 'TEXT');
      ensureColumn(db, 'searches', 'location_label', 'TEXT');
      ensureColumn(db, 'searches', 'duration_ms', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'searches', 'phone_count', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'searches', 'website_count', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'searches', 'cache_hit', 'INTEGER DEFAULT 0');
    }
  }
];

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const record = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

  for (const migration of migrations) {
    if (applied.get(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      record.run(migration.id);
    })();
  }
}

export default migrations;
