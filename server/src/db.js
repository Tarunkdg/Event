import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'HOST', 'ADMIN')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Music', 'Tech', 'Workshops', 'Business')),
  description TEXT NOT NULL,
  banner_url TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  venue TEXT NOT NULL,
  city TEXT NOT NULL,
  ticket_price INTEGER NOT NULL CHECK (ticket_price >= 0),
  total_seats INTEGER NOT NULL CHECK (total_seats > 0),
  available_seats INTEGER NOT NULL CHECK (available_seats >= 0 AND available_seats <= total_seats),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'REJECTED')),
  host_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  ticket_quantity INTEGER NOT NULL CHECK (ticket_quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  booking_status TEXT NOT NULL CHECK (booking_status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  stripe_session_id TEXT UNIQUE,
  reservation_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'inr',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  paid_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_listing ON events(status, event_date, category);
CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_expiry ON bookings(booking_status, reservation_expires_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
`;

export async function openDatabase(filePath) {
  const SQL = await initSqlJs();
  let database;
  if (filePath !== ":memory:" && fs.existsSync(filePath)) {
    database = new SQL.Database(new Uint8Array(fs.readFileSync(filePath)));
  } else {
    database = new SQL.Database();
  }
  database.run(schema);
  database.run("PRAGMA foreign_keys = ON");
  database.persist = () => {
    if (filePath === ":memory:") return;
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(database.export()));
  };
  database.persist();
  return database;
}

export function all(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

export function one(db, sql, params = []) {
  return all(db, sql, params)[0] ?? null;
}

export function run(db, sql, params = []) {
  db.run(sql, params);
  return db.getRowsModified();
}

export function transaction(db, operation) {
  db.run("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const result = operation();
    db.run("COMMIT");
    committed = true;
    db.persist();
    return result;
  } catch (error) {
    if (!committed) db.run("ROLLBACK");
    throw error;
  }
}
