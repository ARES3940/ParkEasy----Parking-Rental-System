// filepath: c:\Users\Ahmed\Desktop\New folder (2)\server.js
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// pool is imported from db.js

function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

// Simple in-memory session store (token -> username)
const sessions = new Map();
function generateToken() {
    return crypto.randomBytes(24).toString('hex');
}

async function initDb() {
    await pool.query(`
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
    `);

    // Ensure legacy databases have the contact column
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact TEXT;`);
    } catch (err) {
        console.error('Failed to ensure contact column on users table:', err);
    }

    // Ensure listings table has expected columns (for older DBs)
    try {
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS owner TEXT;`);
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS location TEXT;`);
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_hourly REAL DEFAULT 0;`);
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_daily REAL DEFAULT 0;`);
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_monthly REAL DEFAULT 0;`);
        await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'Available';`);
    } catch (err) {
        console.error('Failed to ensure listings columns:', err);
    }

    // Seed hardcoded admin users (ensure they exist with password '12345')
    try {
        const admins = [
            { username: 'Ahmed', password: '12345' },
            { username: 'Alvee', password: '12345' },
            { username: 'Junaid', password: '12345' },
            { username: 'Abir', password: '12345' },
            { username: 'Sir', password: '12345' }
        ];
        for (const a of admins) {
            const hashed = hashPassword(a.password);
            // Upsert: insert or update password/role if username exists
            await pool.query(
                `INSERT INTO users (username, password, role) VALUES ($1,$2,'Admin')
                 ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role`,
                [a.username, hashed]
            );
        }
    } catch (err) {
        // non-fatal if seeding fails
    }
}

initDb().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// --- Helpers ---
async function getUserByUsername(username) {
    const res = await pool.query('SELECT id, username, role, contact FROM users WHERE username = $1', [username]);
    return res.rows[0] || null;
}

function getAuthTokenFromHeader(req) {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (!auth) return null;
    const parts = auth.split(' ');
    if (parts.length !== 2) return null;
    return parts[1];
}

async function authenticate(req) {
    const token = getAuthTokenFromHeader(req);
    if (!token) return null;
    const username = sessions.get(token);
    if (!username) return null;
    const user = await getUserByUsername(username);
    return user;
}

// Utility: check availability
async function isAvailable(listingId, startTime, endTime) {
    const q = await pool.query(`
        SELECT 1 FROM bookings
        WHERE listing_id = $1
        AND status != 'cancelled'
        AND (
            (start_time <= $2 AND end_time >= $2) OR
            (start_time <= $3 AND end_time >= $3) OR
            (start_time >= $2 AND end_time <= $3)
        )
    `, [listingId, startTime, endTime]);
    return q.rowCount === 0;
}

// --- Handlers ---
async function handleRegister(req, res) {
    const { username, password, role, contact, contact_number } = req.body;
    const contactValue = contact || contact_number || null;
    if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
    if (role === 'Admin') return res.status(403).json({ error: 'Admin registration not allowed' });
    try {
        const hashed = hashPassword(password);
        const result = await pool.query(
            'INSERT INTO users (username, password, role, contact) VALUES ($1,$2,$3,$4) RETURNING id, username, role, contact',
            [username, hashed, role, contactValue]
        );
        return res.json({ user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
        console.error(err);
        return res.status(500).json({ error: 'Registration failed' });
    }
}

async function handleLogin(req, res) {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
    try {
        const hashed = hashPassword(password);
        const result = await pool.query('SELECT id, username, role, contact, password FROM users WHERE LOWER(username)=LOWER($1) AND role=$2', [username, role]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        if (user.password !== hashed) return res.status(401).json({ error: 'Invalid credentials' });
        const token = generateToken();
        sessions.set(token, user.username);
        return res.json({ user: { username: user.username, role: user.role, contact: user.contact }, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Login failed' });
    }
}

async function handleGetListings(req, res) {
    const ownerFlag = req.query.owner === 'true' || req.query.owner === true;
    try {
        if (ownerFlag) {
            const user = await authenticate(req);
            if (!user) return res.status(401).json({ error: 'Unauthorized' });
            const q = await pool.query('SELECT id, owner, location, price_hourly, price_daily, price_monthly, availability FROM listings WHERE owner = $1', [user.username]);
            return res.json({ listings: q.rows });
        }
        const q = await pool.query('SELECT id, owner, location, price_hourly, price_daily, price_monthly, availability FROM listings');
        return res.json({ listings: q.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to fetch listings' });
    }
}

async function handleCreateListing(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { location, price_hourly, price_daily, price_monthly, availability } = req.body;
        if (!location) return res.status(400).json({ error: 'Missing location' });
        const avail = (typeof availability === 'boolean') ? (availability ? 'Available' : 'Unavailable') : (availability || 'Available');
        const q = await pool.query('INSERT INTO listings (owner, location, price_hourly, price_daily, price_monthly, availability) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [user.username, location, price_hourly||0, price_daily||0, price_monthly||0, avail]);
        return res.json({ listing: q.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create listing' });
    }
}

async function handleGetBookings(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        if (user.role === 'Admin') {
            const q = await pool.query('SELECT b.*, l.location FROM bookings b JOIN listings l ON b.listing_id = l.id');
            return res.json({ bookings: q.rows });
        }

        if (user.role === 'Owner') {
            // bookings for listings owned by this owner
            const q = await pool.query('SELECT b.*, l.location FROM bookings b JOIN listings l ON b.listing_id = l.id WHERE l.owner = $1', [user.username]);
            return res.json({ bookings: q.rows });
        }

        // default: renter -> bookings where renter = user
        const q = await pool.query('SELECT b.*, l.location FROM bookings b JOIN listings l ON b.listing_id = l.id WHERE b.renter = $1', [user.username]);
        return res.json({ bookings: q.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to fetch bookings' });
    }
}

async function handleCreateBooking(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { listing_id, start_time, end_time, duration_type } = req.body;
        if (!listing_id || !start_time || !end_time) return res.status(400).json({ error: 'Missing fields' });

        const available = await isAvailable(listing_id, start_time, end_time);
        if (!available) return res.status(409).json({ error: 'Not available' });

        const lq = await pool.query('SELECT * FROM listings WHERE id=$1', [listing_id]);
        if (lq.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
        const listing = lq.rows[0];

        const start = new Date(start_time);
        const end = new Date(end_time);
        const hours = Math.max(0, (end - start) / (1000*60*60));
        let total = 0;
        
        // Calculate optimal pricing by comparing different combinations
        const hourlyRate = Number(listing.price_hourly) || 0;
        const dailyRate = Number(listing.price_daily) || 0;
        const monthlyRate = Number(listing.price_monthly) || 0;
        
        const hourlyOnlyPrice = hourlyRate * hours;
        
        // Calculate daily + hourly combination
        const fullDays = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        const dailyPlusHourlyPrice = (dailyRate * fullDays) + (hourlyRate * remainingHours);
        
        // Calculate monthly only pricing
        const HOURS_PER_MONTH = 24 * 30; // 720 hours
        const totalMonths = Math.max(1, Math.ceil(hours / HOURS_PER_MONTH));
        const monthlyOnlyPrice = monthlyRate * totalMonths;
        
        // Calculate monthly + daily + hourly combination
        const fullMonths = Math.floor(hours / HOURS_PER_MONTH);
        const remainingAfterMonths = hours % HOURS_PER_MONTH;
        const remainingDays = Math.floor(remainingAfterMonths / 24);
        const finalRemainingHours = remainingAfterMonths % 24;
        const monthlyPlusDailyPlusHourlyPrice = (monthlyRate * fullMonths) + (dailyRate * remainingDays) + (hourlyRate * finalRemainingHours);
        
        switch(duration_type) {
            case 'hourly': 
                total = hourlyOnlyPrice; 
                break;
            case 'daily': 
                total = dailyRate * Math.ceil(hours/24); 
                break;
            case 'monthly': 
                total = monthlyRate * Math.ceil(hours/HOURS_PER_MONTH); 
                break;
            case 'optimal':
            default: 
                // Return the minimum price among all combinations for optimal pricing
                total = Math.min(hourlyOnlyPrice, dailyPlusHourlyPrice, monthlyOnlyPrice, monthlyPlusDailyPlusHourlyPrice);
        }

        const q = await pool.query('INSERT INTO bookings (listing_id, renter, start_time, end_time, duration_type, total_price, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [listing_id, user.username, start_time, end_time, duration_type, total, 'confirmed']);
        const booking = q.rows[0];
        await pool.query('INSERT INTO payments (booking_id, amount, payment_method, status) VALUES ($1,$2,$3,$4)', [booking.id, total, 'dummy', 'pending']);
        return res.json({ booking });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create booking' });
    }
}

async function handleDeleteBooking(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const id = req.params.id;
        const bq = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (bq.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
        const booking = bq.rows[0];

        // Allow renter, owner of listing, or admin to cancel
        const lq = await pool.query('SELECT owner FROM listings WHERE id = $1', [booking.listing_id]);
        const listingOwner = lq.rows.length ? lq.rows[0].owner : null;
        if (booking.renter !== user.username && listingOwner !== user.username && user.role !== 'Admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', id]);
        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to cancel booking' });
    }
}

async function handleGetUsers(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (user.role !== 'Admin') return res.status(403).json({ error: 'Forbidden' });
        const q = await pool.query('SELECT id, username, role, contact FROM users');
        return res.json({ users: q.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to fetch users' });
    }
}

async function handleDeleteUser(req, res) {
    try {
        const user = await authenticate(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        if (user.role !== 'Admin') return res.status(403).json({ error: 'Forbidden' });
        const id = req.params.id;
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to delete user' });
    }
}

// --- Route bindings (support both /api/... and root paths) ---
app.post('/register', handleRegister);
app.post('/api/register', handleRegister);
app.post('/login', handleLogin);
app.post('/api/login', handleLogin);

app.get('/listings', handleGetListings);
app.get('/api/listings', handleGetListings);
app.post('/listings', handleCreateListing);
app.post('/api/listings', handleCreateListing);

app.get('/bookings', handleGetBookings);
app.get('/api/bookings', handleGetBookings);
app.post('/bookings', handleCreateBooking);
app.post('/api/bookings', handleCreateBooking);
app.delete('/bookings/:id', handleDeleteBooking);
app.delete('/api/bookings/:id', handleDeleteBooking);

app.get('/users', handleGetUsers);
app.get('/api/users', handleGetUsers);
app.delete('/users/:id', handleDeleteUser);
app.delete('/api/users/:id', handleDeleteUser);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
