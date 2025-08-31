BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  location TEXT NOT NULL,
  price_hourly REAL DEFAULT 0,
  price_daily REAL DEFAULT 0,
  price_monthly REAL DEFAULT 0,
  availability TEXT DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  renter TEXT NOT NULL,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration_type TEXT,
  total_price REAL DEFAULT 0,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL,
  payment_method TEXT,
  status TEXT DEFAULT 'pending'
);

INSERT INTO users (username, password, role) VALUES
('Ahmed','46792755','Admin'),
('Alvee','46792755','Admin'),
('Junaid','46792755','Admin'),
('Abir','46792755','Admin'),
('Sir','46792755','Admin')
ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role;

COMMIT;