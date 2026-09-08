import type Database from 'better-sqlite3'

/** 版本 3：授权状态与会话身份绑定；旧版本建表定义保持不变。 */
export function migrateAuthRevision(db: Database.Database): void {
  db.exec(`
    ALTER TABLE users ADD COLUMN auth_revision INTEGER NOT NULL DEFAULT 1 CHECK(auth_revision >= 1);
    ALTER TABLE users ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1));
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      auth_revision INTEGER NOT NULL CHECK(auth_revision >= 1),
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE TRIGGER users_security_revision AFTER UPDATE OF username, password_hash, permissions, is_admin, is_enabled ON users
    WHEN OLD.username IS NOT NEW.username OR OLD.password_hash IS NOT NEW.password_hash
      OR OLD.permissions IS NOT NEW.permissions OR OLD.is_admin IS NOT NEW.is_admin
      OR OLD.is_enabled IS NOT NEW.is_enabled
    BEGIN
      UPDATE users SET auth_revision = OLD.auth_revision + 1 WHERE id = NEW.id;
      DELETE FROM auth_sessions WHERE user_id = NEW.id;
    END;
    CREATE TRIGGER ledger_access_insert_revision AFTER INSERT ON user_ledger_permissions
    BEGIN
      UPDATE users SET auth_revision = auth_revision + 1 WHERE id = NEW.user_id;
      DELETE FROM auth_sessions WHERE user_id = NEW.user_id;
    END;
    CREATE TRIGGER ledger_access_delete_revision AFTER DELETE ON user_ledger_permissions
    BEGIN
      UPDATE users SET auth_revision = auth_revision + 1 WHERE id = OLD.user_id;
      DELETE FROM auth_sessions WHERE user_id = OLD.user_id;
    END;
    CREATE TRIGGER ledger_access_update_revision AFTER UPDATE OF user_id, ledger_id ON user_ledger_permissions
    WHEN OLD.user_id IS NOT NEW.user_id OR OLD.ledger_id IS NOT NEW.ledger_id
    BEGIN
      UPDATE users SET auth_revision = auth_revision + 1 WHERE id IN (OLD.user_id, NEW.user_id);
      DELETE FROM auth_sessions WHERE user_id IN (OLD.user_id, NEW.user_id);
    END;
  `)
}
