// Parking Rental System - Offline SQLite Web App

let db, currentUser = null;
let SQL; // make SQL.js instance available to other functions

// Hardcoded admin users
const HARDCODED_ADMINS = [
    { username: 'Ahmed', password: '12345', role: 'Admin' },
    { username: 'Abir', password: '12345', role: 'Admin' },
    { username: 'Junaid', password: '12345', role: 'Admin' },
    { username: 'Alvee', password: '12345', role: 'Admin' }
];

async function initApp() {
    SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });

    const savedDb = localStorage.getItem('parkingRentalDb');
    db = savedDb ? new SQL.Database(new Uint8Array(JSON.parse(savedDb))) : new SQL.Database();

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, 
            username TEXT UNIQUE, 
            password TEXT,
            role TEXT
        );
        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY, 
            owner TEXT, 
            location TEXT, 
            price_hourly REAL,
            price_daily REAL,
            price_monthly REAL,
            availability TEXT
        );
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY, 
            listing_id INTEGER, 
            renter TEXT, 
            start_time TEXT,
            end_time TEXT,
            duration_type TEXT,
            total_price REAL,
            status TEXT DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY,
            booking_id INTEGER,
            amount REAL,
            payment_method TEXT,
            status TEXT DEFAULT 'pending'
        );
    `);

    // --- Migration: ensure listings columns exist (fixes "no column named price_hourly") ---
    (function migrateListingsSchema() {
        try {
            const res = db.exec("PRAGMA table_info(listings)");
            const existingCols = res.length ? res[0].values.map(r => r[1]) : [];

            const desired = [
                { name: 'price_hourly', type: 'REAL',    default: '0' },
                { name: 'price_daily',  type: 'REAL',    default: '0' },
                { name: 'price_monthly',type: 'REAL',    default: '0' },
                { name: 'availability', type: 'TEXT',    default: "'Available'" }
            ];

            let missing = desired.filter(d => !existingCols.includes(d.name));

            if (missing.length === 0) {
                return; // nothing to do
            }

            // Try simple ALTER TABLE for each missing column first
            let altered = false;
            missing.forEach(col => {
                try {
                    db.run(`ALTER TABLE listings ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
                    altered = true;
                    console.log(`Migration: added column ${col.name} (ALTER)`);
                } catch (err) {
                    console.warn(`Migration: ALTER failed for ${col.name}`, err);
                }
            });

            if (altered) {
                // Re-check to see if any remain missing after ALTER
                const res2 = db.exec("PRAGMA table_info(listings)");
                const existingAfter = res2.length ? res2[0].values.map(r => r[1]) : [];
                missing = desired.filter(d => !existingAfter.includes(d.name));
            }

            // If still missing, perform safe table rebuild to preserve data
            if (missing.length > 0) {
                console.log('Migration: rebuilding listings table to add missing columns:', missing.map(m => m.name));
                
                // Build new table schema
                const newColsDefinition = [
                    'id INTEGER PRIMARY KEY',
                    'owner TEXT',
                    'location TEXT',
                    'price_hourly REAL DEFAULT 0',
                    'price_daily REAL DEFAULT 0',
                    'price_monthly REAL DEFAULT 0',
                    `availability TEXT DEFAULT 'Available'`
                ].join(', ');

                // Prepare select list: use existing column name if present, otherwise the default literal
                const selectList = [
                    existingCols.includes('owner') ? 'owner' : "'' AS owner",
                    existingCols.includes('location') ? 'location' : "'' AS location",
                    existingCols.includes('price_hourly') ? 'price_hourly' : '0 AS price_hourly',
                    existingCols.includes('price_daily') ? 'price_daily' : '0 AS price_daily',
                    existingCols.includes('price_monthly') ? 'price_monthly' : '0 AS price_monthly',
                    existingCols.includes('availability') ? 'availability' : "'Available' AS availability"
                ].join(', ');

                // Run transactional rebuild
                try {
                    db.run('BEGIN TRANSACTION;');
                    db.run(`CREATE TABLE IF NOT EXISTS listings_new (${newColsDefinition});`);
                    db.run(`INSERT INTO listings_new (owner, location, price_hourly, price_daily, price_monthly, availability) SELECT ${selectList} FROM listings;`);
                    db.run('DROP TABLE listings;');
                    db.run('ALTER TABLE listings_new RENAME TO listings;');
                    db.run('COMMIT;');
                    console.log('Migration: listings table rebuilt successfully');
                } catch (err) {
                    db.run('ROLLBACK;');
                    console.warn('Migration: failed to rebuild listings table', err);
                }
            }

            saveDatabase();

            // Cleanup: fix any NULL/invalid prices or availability left from older schemas
            try {
                db.run(`
                    UPDATE listings
                    SET 
                        price_hourly  = COALESCE(price_hourly, 0),
                        price_daily   = COALESCE(price_daily, 0),
                        price_monthly = COALESCE(price_monthly, 0),
                        availability  = COALESCE(availability, 'Available')
                `);
                saveDatabase();
                console.log('Migration: cleaned up listings NULL values');
            } catch (err) {
                console.warn('Migration: listings cleanup failed', err);
            }
        } catch (err) {
            console.warn('Migration failed for listings table', err);
        }
    })(); // end migrateListingsSchema IIFE

    // --- Migration: ensure bookings columns exist (fixes "no such column: b.start_time") ---
    (function migrateBookingsSchema() {
        try {
            const res = db.exec("PRAGMA table_info(bookings)");
            const existingCols = res.length ? res[0].values.map(r => r[1]) : [];

            const desired = [
                { name: 'start_time',   type: 'TEXT',  default: "''" },
                { name: 'end_time',     type: 'TEXT',  default: "''" },
                { name: 'duration_type',type: 'TEXT',  default: "'hourly'" },
                { name: 'total_price',  type: 'REAL',  default: '0' },
                { name: 'status',       type: 'TEXT',  default: "'pending'" }
            ];

            let missing = desired.filter(d => !existingCols.includes(d.name));
            if (missing.length === 0) return;

            // Try ALTER first
            let altered = false;
            missing.forEach(col => {
                try {
                    db.run(`ALTER TABLE bookings ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
                    altered = true;
                    console.log(`Migration: added bookings column ${col.name} (ALTER)`);
                } catch (err) {
                    console.warn(`Migration: ALTER failed for bookings.${col.name}`, err);
                }
            });

            if (altered) {
                const res2 = db.exec("PRAGMA table_info(bookings)");
                const existingAfter = res2.length ? res2[0].values.map(r => r[1]) : [];
                missing = desired.filter(d => !existingAfter.includes(d.name));
            }

            // If still missing, safe rebuild preserving data
            if (missing.length > 0) {
                console.log('Migration: rebuilding bookings table to add missing columns:', missing.map(m => m.name));

                const newColsDefinition = [
                    'id INTEGER PRIMARY KEY',
                    'listing_id INTEGER',
                    'renter TEXT',
                    "start_time TEXT DEFAULT ''",
                    "end_time TEXT DEFAULT ''",
                    "duration_type TEXT DEFAULT 'hourly'",
                    "total_price REAL DEFAULT 0",
                    "status TEXT DEFAULT 'pending'"
                ].join(', ');

                // Prepare select list: if a column exists use it otherwise use default literal
                const selectList = [
                    existingCols.includes('listing_id') ? 'listing_id' : 'NULL AS listing_id',
                    existingCols.includes('renter') ? 'renter' : "'' AS renter",
                    existingCols.includes('start_time') ? 'start_time' : "'' AS start_time",
                    existingCols.includes('end_time') ? 'end_time' : "'' AS end_time",
                    existingCols.includes('duration_type') ? 'duration_type' : "'hourly' AS duration_type",
                    existingCols.includes('total_price') ? 'total_price' : '0 AS total_price',
                    existingCols.includes('status') ? 'status' : "'pending' AS status"
                ].join(', ');

                try {
                    db.run('BEGIN TRANSACTION;');
                    db.run(`CREATE TABLE IF NOT EXISTS bookings_new (${newColsDefinition});`);
                    db.run(`INSERT INTO bookings_new (listing_id, renter, start_time, end_time, duration_type, total_price, status) SELECT ${selectList} FROM bookings;`);
                    db.run('DROP TABLE bookings;');
                    db.run('ALTER TABLE bookings_new RENAME TO bookings;');
                    db.run('COMMIT;');
                    console.log('Migration: bookings table rebuilt successfully');
                } catch (err) {
                    db.run('ROLLBACK;');
                    console.warn('Migration: failed to rebuild bookings table', err);
                }
            }

            saveDatabase();
        } catch (err) {
            console.warn('Migration failed for bookings table', err);
        }
    })();

    // Add hardcoded admins if not exist
    HARDCODED_ADMINS.forEach(admin => {
        let stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        stmt.bind([admin.username]);
        
        if (!stmt.step()) {
            // Admin doesn't exist, so add them
            db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
                [admin.username, hashPassword(admin.password), admin.role]);
        }
    });

    setupEventListeners();
    restoreSession();
}

function setupEventListeners() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    const addListingForm = document.getElementById('add-listing-form');
    if (addListingForm) addListingForm.addEventListener('submit', handleAddListing);

    setupFormToggleListeners();
}

function setupFormToggleListeners() {
    const loginBtn = document.getElementById('show-login-btn');
    const registerBtn = document.getElementById('show-register-btn');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'flex';
            document.getElementById('register-form').style.display = 'none';
            loginBtn.classList.add('active');
            document.getElementById('show-register-btn').classList.remove('active');
        });
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'flex';
            loginBtn.classList.remove('active');
            registerBtn.classList.add('active');
        });
    }
}

function restoreSession() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showAppContainer(currentUser.role);
        renderDashboard(currentUser.role);
    }
}

function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const loginError = document.getElementById('login-error');

    loginError.textContent = '';

    if (!username || !password || !role) {
        loginError.textContent = 'Please fill in all fields';
        return;
    }

    // Log all hardcoded admins for debugging
    console.log('Hardcoded Admins:', HARDCODED_ADMINS);
    console.log('Attempting Login:', { username, role });

    // Check if it's a hardcoded admin
    const hardcodedAdmin = HARDCODED_ADMINS.find(
        admin => admin.username.toLowerCase() === username.toLowerCase() && 
                 admin.role === role
    );

    if (hardcodedAdmin) {
        // Verify password for hardcoded admin
        const inputPasswordHash = hashPassword(password);
        const storedPasswordHash = hashPassword(hardcodedAdmin.password);
        
        console.log('Hardcoded Admin Found:', hardcodedAdmin);
        console.log('Input Password Hash:', inputPasswordHash);
        console.log('Stored Password Hash:', storedPasswordHash);

        if (inputPasswordHash === storedPasswordHash) {
            currentUser = { 
                username: hardcodedAdmin.username, 
                role: hardcodedAdmin.role 
            };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            showAppContainer(role);
            renderDashboard(role);
            return;
        } else {
            loginError.textContent = 'Incorrect password for admin user';
            return;
        }
    }

    // If not a hardcoded admin, check database
    const stmt = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND role = ?');
    stmt.bind([username, role]);
    
    if (stmt.step()) {
        const user = stmt.get();
        const inputPasswordHash = hashPassword(password);
        
        if (inputPasswordHash === user[2]) {
            currentUser = { 
                username: user[1], 
                role: user[3] 
            };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            showAppContainer(role);
            renderDashboard(role);
            return;
        }
    }

    loginError.textContent = 'Invalid login credentials';
    
    // Additional debugging for failed login
    console.log('Login Failed Details:');
    console.log('Username:', username);
    console.log('Role:', role);
    console.log('Input Password Hash:', hashPassword(password));
}

function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const role = document.getElementById('register-role').value;
    const registerError = document.getElementById('register-error');

    registerError.textContent = '';

    // Prevent admin registration
    if (role === 'Admin') {
        registerError.textContent = 'Admin registration is not allowed.';
        return;
    }

    if (password !== confirmPassword) {
        registerError.textContent = 'Passwords do not match';
        return;
    }

    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    stmt.bind([username]);
    
    if (stmt.step()) {
        registerError.textContent = 'Username already exists';
        return;
    }

    try {
        db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
            [username, hashPassword(password), role]);
        
        saveDatabase();
        e.target.reset();
        showLoginForm();
        document.getElementById('login-error').textContent = 'Registration successful. Please log in.';
    } catch (error) {
        registerError.textContent = 'Registration failed. Please try again.';
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'block';
}

function showAppContainer(role) {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    
    // Create a more structured user info section
    const userInfoDiv = document.getElementById('user-info');
    userInfoDiv.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div>
                <span style="font-weight: bold;">Welcome, </span>
                <span id="logged-user">${currentUser.username} (${currentUser.role})</span>
            </div>
            <button id="logout-btn" style="background-color: #dc3545; padding: 8px 15px;">Logout</button>
        </div>
    `;

    // Add logout event listener
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Hide all sections first
    ['renter', 'owner', 'admin'].forEach(section => {
        document.getElementById(`${section}-section`).style.display = 'none';
    });

    // Show appropriate section
    document.getElementById(`${role.toLowerCase()}-section`).style.display = 'block';

    // Setup admin tools if applicable
    setupAdminTools();
}

function showLoginForm() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginBtn = document.getElementById('show-login-btn');
    const registerBtn = document.getElementById('show-register-btn');

    if (loginForm && registerForm && loginBtn && registerBtn) {
        loginForm.style.display = 'flex';
        registerForm.style.display = 'none';
        loginBtn.classList.add('active');
        registerBtn.classList.remove('active');
    }
}

function renderDashboard(role) {
    const dashboardFunctions = {
        'Renter': renderRenterDashboard,
        'Owner': renderOwnerDashboard,
        'Admin': renderAdminDashboard
    };

    const renderFunction = dashboardFunctions[role];
    if (renderFunction) renderFunction();
}

// Function to check listing availability
function checkListingAvailability(listingId, startTime, endTime) {
    const stmt = db.prepare(`
        SELECT * FROM bookings 
        WHERE listing_id = ? 
        AND status != 'cancelled' 
        AND (
            (start_time <= ? AND end_time >= ?) OR
            (start_time <= ? AND end_time >= ?) OR
            (start_time >= ? AND end_time <= ?)
        )
    `);
    
    stmt.bind([listingId, startTime, startTime, endTime, endTime, startTime, endTime]);
    
    return !stmt.step(); // Returns true if no conflicting bookings
}

// Function to calculate price
function calculateBookingPrice(listing, durationType, startTime, endTime) {
    // listing indexes: 0:id,1:owner,2:location,3:price_hourly,4:price_daily,5:price_monthly,...
    const hourlyRate = Number(listing[3]) || 0;
    const dailyRate = Number(listing[4]) || 0;
    const monthlyRate = Number(listing[5]) || 0;

    let totalPrice = 0;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffHours = (end - start) / (1000 * 60 * 60);

    switch(durationType) {
        case 'hourly':
            totalPrice = hourlyRate * diffHours;
            break;
        case 'daily':
            totalPrice = dailyRate * Math.ceil(diffHours / 24);
            break;
        case 'monthly':
            totalPrice = monthlyRate * Math.ceil(diffHours / (24 * 30));
            break;
    }

    return totalPrice;
}

// Function to create a booking
function createBooking(listingId, renter, startTime, endTime, durationType) {
    // Check availability first
    if (!checkListingAvailability(listingId, startTime, endTime)) {
        alert('Sorry, this slot is not available.');
        return false;
    }

    // Get listing details
    const listingStmt = db.prepare('SELECT * FROM listings WHERE id = ?');
    listingStmt.bind([listingId]);
    
    if (!listingStmt.step()) {
        alert('Listing not found');
        return false;
    }

    const listing = listingStmt.get();
    const totalPrice = calculateBookingPrice(listing, durationType, startTime, endTime);

    // Create booking
    db.run(`
        INSERT INTO bookings 
        (listing_id, renter, start_time, end_time, duration_type, total_price, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [listingId, renter, startTime, endTime, durationType, totalPrice, 'pending']);

    // Optional: Create a dummy payment
    const bookingId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run(`
        INSERT INTO payments 
        (booking_id, amount, payment_method, status) 
        VALUES (?, ?, ?, ?)
    `, [bookingId, totalPrice, 'dummy', 'pending']);

    saveDatabase();
    return true;
}

// Modify renderRenterDashboard to show Tk instead of $
function renderRenterDashboard() {
    const listingsBody = document.getElementById('listings-body');
    const bookingsBody = document.getElementById('bookings-body');
    
    listingsBody.innerHTML = '';
    bookingsBody.innerHTML = '';

    // Render available listings with more details
    const listingsStmt = db.prepare(`
        SELECT id, location, price_hourly, price_daily, price_monthly, availability 
        FROM listings 
        WHERE availability IS NULL
           OR LOWER(TRIM(availability)) IN ('available','yes','true','1')
    `);
    while(listingsStmt.step()) {
        const listing = listingsStmt.get();
        const id = listing[0];
        const location = listing[1];
        const priceHourly = Number(listing[2]) || 0; // when SELECT used different order adjust accordingly
        const priceDaily = Number(listing[3]) || 0;
        const priceMonthly = Number(listing[4]) || 0;
        const availability = listing[5] ?? 'Available';

        const row = listingsBody.insertRow();
        row.innerHTML = `
            <td>${location}</td>
            <td>Hourly: Tk ${priceHourly.toFixed(2)}, Daily: Tk ${priceDaily.toFixed(2)}, Monthly: Tk ${priceMonthly.toFixed(2)}</td>
            <td>${availability}</td>
            <td>
                <button onclick="showBookingModal(${id}, '${location.replace(/'/g, "\\'")}')">Book</button>
            </td>
        `;
    }

    // Render user's bookings with status
    const bookingsStmt = db.prepare(`
        SELECT b.id, l.location, b.start_time, b.end_time, b.status, b.total_price
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
        WHERE b.renter = ?
    `);
    bookingsStmt.bind([currentUser.username]);
    
    while(bookingsStmt.step()) {
        const booking = bookingsStmt.get();
        const row = bookingsBody.insertRow();
        row.innerHTML = `
            <td>${booking[1]}</td>
            <td>${booking[2]} - ${booking[3]}</td>
            <td>${booking[4]}</td>
            <td>Tk ${Number(booking[5]).toFixed(2)}</td>
            <td>
                <button onclick="cancelBooking(${booking[0]})">Cancel</button>
            </td>
        `;
    }

    saveDatabase();
}

// Booking Modal Function (price estimate uses Tk)
function showBookingModal(listingId, location) {
    const modal = document.createElement('div');
    modal.innerHTML = `
        <div class="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;">
            <div style="background: white; padding: 20px; border-radius: 8px; width: 400px;">
                <h2>Book ${location}</h2>
                <form id="booking-form">
                    <label>Start Time: <input type="datetime-local" id="start-time" required></label>
                    <label>End Time: <input type="datetime-local" id="end-time" required></label>
                    <select id="duration-type">
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily</option>
                        <option value="monthly">Monthly</option>
                    </select>
                    <div id="price-estimate"></div>
                    <button type="submit">Confirm Booking</button>
                    <button type="button" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const form = document.getElementById('booking-form');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const durationTypeInput = document.getElementById('duration-type');
    const priceEstimateDiv = document.getElementById('price-estimate');

    // Price estimation
    [startTimeInput, endTimeInput, durationTypeInput].forEach(input => {
        input.addEventListener('change', () => {
            if (startTimeInput.value && endTimeInput.value) {
                const listingStmt = db.prepare('SELECT * FROM listings WHERE id = ?');
                listingStmt.bind([listingId]);
                
                if (listingStmt.step()) {
                    const listing = listingStmt.get();
                    const price = calculateBookingPrice(
                        listing, 
                        durationTypeInput.value, 
                        startTimeInput.value, 
                        endTimeInput.value
                    );
                    priceEstimateDiv.textContent = `Estimated Price: Tk ${price.toFixed(2)}`;
                }
            }
        });
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;
        const durationType = durationTypeInput.value;

        if (new Date(startTime) >= new Date(endTime)) {
            alert('End time must be after start time');
            return;
        }

        if (createBooking(listingId, currentUser.username, startTime, endTime, durationType)) {
            document.querySelector('.modal-overlay')?.remove();
            renderRenterDashboard();
        }
    });
}

// Modify renderOwnerDashboard to show Tk instead of $
function renderOwnerDashboard() {
    const ownerListingsBody = document.getElementById('owner-listings-body');
    ownerListingsBody.innerHTML = '';

    const listingsStmt = db.prepare('SELECT * FROM listings WHERE owner = ?');
    listingsStmt.bind([currentUser.username]);
    
    while(listingsStmt.step()) {
        const listing = listingsStmt.get();
        const id = listing[0];
        const location = listing[2];
        const priceHourly = Number(listing[3]) || 0;
        const priceDaily = Number(listing[4]) || 0;
        const priceMonthly = Number(listing[5]) || 0;

        const row = ownerListingsBody.insertRow();
        
        const bookingsStmt = db.prepare('SELECT COUNT(*) FROM bookings WHERE listing_id = ?');
        bookingsStmt.bind([listing[0]]);
        bookingsStmt.step();
        const bookingCount = bookingsStmt.get()[0];

        row.innerHTML = `
            <td>${location}</td>
            <td>Tk ${priceHourly.toFixed(2)} (Hourly)</td>
            <td>Tk ${priceDaily.toFixed(2)} (Daily)</td>
            <td>
                <button onclick="viewListingBookings(${id})">
                    ${bookingCount} Bookings
                </button>
            </td>
        `;
    }

    saveDatabase();
}

// Function to view listing bookings
function viewListingBookings(listingId) {
    const bookingsModal = document.createElement('div');
    bookingsModal.innerHTML = `
        <div class="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;">
            <div style="background: white; padding: 20px; border-radius: 8px; width: 600px; max-height: 70%; overflow-y: auto;">
                <h2>Listing Bookings</h2>
                <table id="listing-bookings-table">
                    <thead>
                        <tr>
                            <th>Renter</th>
                            <th>Start Time</th>
                            <th>End Time</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="listing-bookings-body"></tbody>
                </table>
                <button onclick="this.closest('.modal-overlay').remove()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(bookingsModal);

    const bookingsBody = document.getElementById('listing-bookings-body');
    const bookingsStmt = db.prepare(`
        SELECT renter, start_time, end_time, status 
        FROM bookings 
        WHERE listing_id = ?
    `);
    bookingsStmt.bind([listingId]);

    while(bookingsStmt.step()) {
        const booking = bookingsStmt.get();
        const row = bookingsBody.insertRow();
        row.innerHTML = `
            <td>${booking[0]}</td>
            <td>${booking[1]}</td>
            <td>${booking[2]}</td>
            <td>${booking[3]}</td>
            <td>
                <button onclick="contactRenter('${booking[0]}')">Contact</button>
            </td>
        `;
    }
}

// Dummy contact function
function contactRenter(renter) {
    alert(`Contacting ${renter}`);
}

// Modify renderAdminDashboard to show Tk instead of $
function renderAdminDashboard() {
    const adminListingsBody = document.getElementById('admin-listings-body');
    const adminBookingsBody = document.getElementById('admin-bookings-body');
    const adminPaymentsBody = document.getElementById('admin-payments-body');
    
    adminListingsBody.innerHTML = '';
    adminBookingsBody.innerHTML = '';
    adminPaymentsBody.innerHTML = '';

    // Render all listings
    const listingsStmt = db.prepare('SELECT * FROM listings');
    while(listingsStmt.step()) {
        const listing = listingsStmt.get();
        const priceHourly = Number(listing[3]) || 0;
        const priceDaily = Number(listing[4]) || 0;
        const priceMonthly = Number(listing[5]) || 0;

        const row = adminListingsBody.insertRow();
        row.innerHTML = `
            <td>${listing[1]}</td>
            <td>${listing[2]}</td>
            <td>Tk ${priceHourly.toFixed(2)} (Hourly)</td>
            <td>Tk ${priceDaily.toFixed(2)} (Daily)</td>
            <td><button onclick="deleteListing(${listing[0]})">Delete</button></td>
        `;
    }

    // Render all bookings
    const bookingsStmt = db.prepare(`
        SELECT b.id, l.location, b.renter, b.start_time, b.end_time, b.status 
        FROM bookings b
        JOIN listings l ON b.listing_id = l.id
    `);
    
    while(bookingsStmt.step()) {
        const booking = bookingsStmt.get();
        const row = adminBookingsBody.insertRow();
        row.innerHTML = `
            <td>${booking[1]}</td>
            <td>${booking[2]}</td>
            <td>${booking[3]} - ${booking[4]}</td>
            <td>${booking[5]}</td>
            <td><button onclick="deleteBooking(${booking[0]})">Delete</button></td>
        `;
    }

    // Render all payments
    const paymentsStmt = db.prepare(`
        SELECT p.id, b.renter, l.location, p.amount, p.payment_method, p.status 
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN listings l ON b.listing_id = l.id
    `);
    
    while(paymentsStmt.step()) {
        const payment = paymentsStmt.get();
        const row = adminPaymentsBody.insertRow();
        row.innerHTML = `
            <td>${payment[1]}</td>
            <td>${payment[2]}</td>
            <td>Tk ${Number(payment[3]).toFixed(2)}</td>
            <td>${payment[4]}</td>
            <td>${payment[5]}</td>
        `;
    }

    saveDatabase();
}

function handleAddListing(e) {
    e.preventDefault();
    
    if (!currentUser || currentUser.role !== 'Owner') {
        alert('Only owners can add listings');
        return;
    }

    const location = document.getElementById('location').value.trim();
    const priceHourlyRaw = document.getElementById('price-hourly').value.trim();
    const priceDailyRaw = document.getElementById('price-daily').value.trim();
    const priceMonthlyRaw = document.getElementById('price-monthly').value.trim();
    const availabilityEl = document.getElementById('availability');
    let availability = 'Available';
    if (availabilityEl) availability = availabilityEl.value.trim() || 'Available';

    // Normalize to canonical values (accept "yes", "true", "1" as Available)
    availability = availability.trim().toLowerCase();
    if (['available','yes','true','1','y'].includes(availability)) {
        availability = 'Available';
    } else if (['unavailable','no','false','0','n'].includes(availability)) {
        availability = 'Unavailable';
    } else {
        // keep user text but normalize casing
        availability = availability ? (availability.charAt(0).toUpperCase() + availability.slice(1)) : 'Available';
    }

    if (!location) {
        alert('Please fill in location');
        return;
    }

    // Coerce numeric inputs, fallback to 0
    const priceHourly = Number(priceHourlyRaw.replace(/[^0-9.\-]+/g, ''));
    const priceDaily  = Number(priceDailyRaw.replace(/[^0-9.\-]+/g, ''));
    const priceMonthly= Number(priceMonthlyRaw.replace(/[^0-9.\-]+/g, ''));

    const ph = Number.isFinite(priceHourly) ? priceHourly : 0;
    const pd = Number.isFinite(priceDaily)  ? priceDaily  : 0;
    const pm = Number.isFinite(priceMonthly)? priceMonthly: 0;

    try {
        db.run(
            'INSERT INTO listings (owner, location, price_hourly, price_daily, price_monthly, availability) VALUES (?, ?, ?, ?, ?, ?)', 
            [currentUser.username, location, ph, pd, pm, availability]
        );
        
        saveDatabase();
        e.target.reset();
        renderOwnerDashboard();
        alert('Listing added successfully');
    } catch (error) {
        console.error('Error adding listing:', error);
        alert('Failed to add listing');
    }
}

function cancelBooking(bookingId) {
    db.run('UPDATE bookings SET status = "cancelled" WHERE id = ?', [bookingId]);

    const stmt = db.prepare('UPDATE listings SET availability = "Available" WHERE id = (SELECT listing_id FROM bookings WHERE id = ?)');
    stmt.bind([bookingId]);
    stmt.step();

    renderRenterDashboard();
    saveDatabase();
}

function deleteListing(listingId) {
    db.run('DELETE FROM bookings WHERE listing_id = ?', [listingId]);
    db.run('DELETE FROM listings WHERE id = ?', [listingId]);

    renderAdminDashboard();
    saveDatabase();
}

function deleteBooking(bookingId) {
    const stmt = db.prepare('UPDATE listings SET availability = "Available" WHERE id = (SELECT listing_id FROM bookings WHERE id = ?)');
    stmt.bind([bookingId]);
    stmt.step();

    db.run('DELETE FROM bookings WHERE id = ?', [bookingId]);

    renderAdminDashboard();
    saveDatabase();
}

function saveDatabase() {
    const data = db.export();
    localStorage.setItem('parkingRentalDb', JSON.stringify(Array.from(data)));
}

// Function to remove all registered users
function removeAllUsers() {
    // Confirm before deleting
    const confirmDelete = confirm('Are you sure you want to delete ALL registered users? This cannot be undone.');
    
    if (confirmDelete) {
        try {
            // Delete all users from the database
            db.run('DELETE FROM users');
            
            // Delete all listings associated with users
            db.run('DELETE FROM listings');
            
            // Delete all bookings
            db.run('DELETE FROM bookings');
            
            // Save the changes to the database
            saveDatabase();
            
            // Clear current user and localStorage
            currentUser = null;
            localStorage.removeItem('currentUser');
            localStorage.removeItem('parkingRentalDb');
            
            // Show login container
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('login-container').style.display = 'block';
            
            // Optional: Reload the page to reset everything
            alert('All users, listings, and bookings have been deleted. The application will now reload.');
            location.reload();
        } catch (error) {
            console.error('Error removing users:', error);
            alert('Failed to remove users. Please try again.');
        }
    }
}

// Function to remove a specific user
function removeUser(username) {
    // Validate input
    if (!username) {
        alert('Please provide a username to remove.');
        return false;
    }

    // Confirm before deleting
    const confirmDelete = confirm(`Are you sure you want to delete the user "${username}"?`);
    
    if (confirmDelete) {
        try {
            // Check if user exists
            const checkStmt = db.prepare('SELECT * FROM users WHERE username = ?');
            checkStmt.bind([username]);
            
            if (!checkStmt.step()) {
                alert(`User "${username}" not found.`);
                return false;
            }

            // Delete user
            db.run('DELETE FROM users WHERE username = ?', [username]);
            
            // Delete user's listings
            db.run('DELETE FROM listings WHERE owner = ?', [username]);
            
            // Delete user's bookings
            db.run('DELETE FROM bookings WHERE renter = ?', [username]);
            
            // Save the changes to the database
            saveDatabase();
            
            // If current user is being removed, log out
            if (currentUser && currentUser.username === username) {
                currentUser = null;
                localStorage.removeItem('currentUser');
                document.getElementById('app-container').style.display = 'none';
                document.getElementById('login-container').style.display = 'block';
            }
            
            alert(`User "${username}" has been successfully removed.`);
            return true;
        } catch (error) {
            console.error('Error removing user:', error);
            alert('Failed to remove user. Please try again.');
            return false;
        }
    }
    return false;
}

// Function to view and manage registered users
function manageUsers() {
    // Fetch all users
    const allUsersStmt = db.prepare('SELECT username, role FROM users');
    const registeredUsers = [];

    // Collect users
    while(allUsersStmt.step()) {
        const user = allUsersStmt.get();
        registeredUsers.push({
            username: user[0],
            role: user[1]
        });
    }

    // Create modal for displaying and managing users
    const modalOverlay = document.createElement('div');
    modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        padding: 20px;
        border-radius: 8px;
        width: 90%;
        max-width: 800px;
        max-height: 70%;
        overflow-y: auto;
    `;

    // Create table of users
    const table = document.createElement('table');
    table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        margin-top: 15px;
    `;

    // Table header
    table.innerHTML = `
        <thead>
            <tr style="background-color: #f1f1f1;">
                <th style="padding: 10px; border: 1px solid #ddd;">Username</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Role</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Action</th>
            </tr>
        </thead>
        <tbody>
            ${registeredUsers.map(user => `
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;">${user.username}</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${user.role}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                        <button 
                            onclick="removeUserFromList('${user.username}')" 
                            style="
                                background-color: #dc3545; 
                                color: white; 
                                border: none; 
                                padding: 5px 10px; 
                                border-radius: 4px; 
                                cursor: pointer;
                            "
                        >Remove</button>
                    </td>
                </tr>
            `).join('')}
        </tbody>
    `;

    // Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = `
        margin-top: 15px;
        padding: 10px 20px;
        background-color: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    closeButton.onclick = () => document.body.removeChild(modalOverlay);

    // Assemble modal
    modalContent.appendChild(table);
    modalContent.appendChild(closeButton);
    
    modalOverlay.appendChild(modalContent);

    // Add to body
    document.body.appendChild(modalOverlay);

    return registeredUsers;
}

// Global function to remove user from list
function removeUserFromList(username) {
    // Prevent removing hardcoded admin users
    const hardcodedAdmins = HARDCODED_ADMINS.map(admin => admin.username);
    if (hardcodedAdmins.includes(username)) {
        alert('Cannot remove hardcoded admin users');
        return false;
    }

    // Confirm before deleting
    const confirmDelete = confirm(`Are you sure you want to delete the user "${username}"?`);
    
    if (confirmDelete) {
        try {
            // Delete user
            db.run('DELETE FROM users WHERE username = ?', [username]);
            
            // Delete user's listings
            db.run('DELETE FROM listings WHERE owner = ?', [username]);
            
            // Delete user's bookings
            db.run('DELETE FROM bookings WHERE renter = ?', [username]);
            
            // Save the changes to the database
            saveDatabase();
            
            // If current user is being removed, log out
            if (currentUser && currentUser.username === username) {
                currentUser = null;
                localStorage.removeItem('currentUser');
                document.getElementById('app-container').style.display = 'none';
                document.getElementById('login-container').style.display = 'block';
            }
            
            // Refresh the user list
            manageUsers();
            
            return true;
        } catch (error) {
            console.error('Error removing user:', error);
            alert('Failed to remove user. Please try again.');
            return false;
        }
    }
    return false;
}

// Function to export database
function exportDatabase() {
    console.warn('exportDatabase() removed — export UI is not present in this build.');
    alert('Export not available.');
}

// Function to import database
function importDatabase() {
    console.warn('importDatabase() removed — import UI is not present in this build.');
    alert('Import not available.');
}

// Modify setupAdminTools to remove database export/import
function setupAdminTools() {
    if (currentUser && currentUser.role === 'Admin') {
        // Avoid appending duplicates
        if (document.getElementById('admin-tools')) return;

        const adminToolsDiv = document.createElement('div');
        adminToolsDiv.innerHTML = `
            <div id="admin-tools" style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 15px;">
                <h3>Admin Tools</h3>
                <div style="display: flex; gap: 10px;">
                    <button id="manage-users-btn" style="background-color: #28a745; flex-grow: 1;">Manage Users</button>
                </div>
            </div>
        `;
        
        const userInfoDiv = document.getElementById('user-info');
        if (userInfoDiv) {
            userInfoDiv.appendChild(adminToolsDiv);
            
            // Add event listener to manage users button
            document.getElementById('manage-users-btn').addEventListener('click', manageUsers);
        }
    }
}

// Modify index.html generation to remove Admin option from registration
function modifyRegistrationForm() {
    const registerRoleSelect = document.getElementById('register-role');
    
    // Remove Admin option from registration form
    const adminOption = registerRoleSelect.querySelector('option[value="Admin"]');
    if (adminOption) {
        adminOption.remove();
    }
}

// Call this function when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    modifyRegistrationForm();
});
