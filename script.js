// Parking Rental System - Frontend (API-only)

let currentUser = null;
let authToken = null;

const API_URL = 'http://localhost:3000';

// API helper with auth header
async function apiFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    try {
        const res = await fetch(API_URL + path, Object.assign({}, opts, { headers }));
        const text = await res.text();
        try { return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null }; } catch { return { ok: res.ok, status: res.status, data: text }; }
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// Specific API calls
async function apiRegisterUser(username, password, role, contact) { return apiFetch('/register', { method: 'POST', body: JSON.stringify({ username, password, role, contact }) }); }
async function apiLoginUser(username, password, role) { return apiFetch('/login', { method: 'POST', body: JSON.stringify({ username, password, role }) }); }
async function apiGetListings(ownerOnly = false) { return apiFetch('/listings' + (ownerOnly ? '?owner=true' : ''), { method: 'GET' }); }
async function apiCreateListing(location, ph, pd, pm, availability) { return apiFetch('/listings', { method: 'POST', body: JSON.stringify({ location, price_hourly: ph, price_daily: pd, price_monthly: pm, availability }) }); }
async function apiGetBookings() { return apiFetch('/bookings', { method: 'GET' }); }
async function apiCreateBooking(listing_id, start_time, end_time, duration_type) { return apiFetch('/bookings', { method: 'POST', body: JSON.stringify({ listing_id, start_time, end_time, duration_type }) }); }
async function apiDeleteBooking(id) { return apiFetch('/bookings/' + encodeURIComponent(id), { method: 'DELETE' }); }
async function apiGetUsers() { return apiFetch('/users', { method: 'GET' }); }
async function apiDeleteUserById(id) { return apiFetch('/users/' + encodeURIComponent(id), { method: 'DELETE' }); }


// Initialization
function initApp() {
    // Restore session if available
    const saved = localStorage.getItem('parkeasy_auth');
    if (saved) {
        try {
            const obj = JSON.parse(saved);
            currentUser = obj.user || null;
            authToken = obj.token || null;
        } catch (e) { /* ignore */ }
    }

    setupEventListeners();
    restoreSession();
}

function setupEventListeners() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const addListingForm = document.getElementById('add-listing-form');

    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (addListingForm) addListingForm.addEventListener('submit', handleAddListing);

    setupFormToggleListeners();
}

function setupFormToggleListeners() {
    const loginBtn = document.getElementById('show-login-btn');
    const registerBtn = document.getElementById('show-register-btn');

    if (loginBtn) loginBtn.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('login-form').style.display = 'flex'; document.getElementById('register-form').style.display = 'none'; loginBtn.classList.add('active'); registerBtn.classList.remove('active'); });
    if (registerBtn) registerBtn.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('login-form').style.display = 'none'; document.getElementById('register-form').style.display = 'flex'; registerBtn.classList.add('active'); loginBtn.classList.remove('active'); });
}

function restoreSession() {
    if (currentUser) {
        showAppContainer(currentUser.role);
        renderDashboard(currentUser.role);
    }
}

// Auth / Registration
async function handleLogin(e) {
    e.preventDefault();
    const username = (document.getElementById('username') || {}).value || '';
    const password = (document.getElementById('password') || {}).value || '';
    const role = (document.getElementById('role') || {}).value || '';
    const loginError = document.getElementById('login-error');
    if (!loginError) return;
    loginError.textContent = '';

    if (!username || !password || !role) { loginError.textContent = 'Please fill in all fields'; return; }

    const res = await apiLoginUser(username, password, role);
    if (!res.ok) { 
        loginError.textContent = (res.data && res.data.error) ? res.data.error : 'Login failed'; 
        return; 
    }
    currentUser = res.data.user;
    authToken = res.data.token;
    localStorage.setItem('parkeasy_auth', JSON.stringify({ user: currentUser, token: authToken }));
    showAppContainer(currentUser.role);
    renderDashboard(currentUser.role);
}

async function handleRegister(e) {
    e.preventDefault();
    const username = (document.getElementById('register-username') || {}).value || '';
    const password = (document.getElementById('register-password') || {}).value || '';
    const confirmPassword = (document.getElementById('confirm-password') || {}).value || '';
    const role = (document.getElementById('register-role') || {}).value || '';
    const contact = (document.getElementById('register-contact') || {}).value || '';
    const registerError = document.getElementById('register-error');
    if (!registerError) return;
    registerError.textContent = '';

    if (role === 'Admin') { registerError.textContent = 'Admin registration is not allowed.'; return; }
    if (password !== confirmPassword) { registerError.textContent = 'Passwords do not match'; return; }

    const res = await apiRegisterUser(username, password, role, contact);
    if (!res.ok) { 
        registerError.textContent = (res.data && res.data.error) ? res.data.error : 'Registration failed'; 
        return; 
    }
    (document.getElementById('register-form') || {}).reset && document.getElementById('register-form').reset();
    showLoginForm();
    const loginError = document.getElementById('login-error');
    if (loginError) loginError.textContent = 'Registration successful. Please log in.';
}

function handleLogout() {
    currentUser = null; authToken = null; localStorage.removeItem('parkeasy_auth');
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'block';
}

function showAppContainer(role) {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';

    const userInfoDiv = document.getElementById('user-info');
    userInfoDiv.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;width:100%"><div><span style="font-weight:bold;">Welcome, </span><span id="logged-user">${currentUser.username} (${currentUser.role})</span></div><button id="logout-btn" style="background-color:#dc3545;padding:8px 15px;">Logout</button></div>`;
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Hide all and show correct
    ['renter', 'owner', 'admin'].forEach(s => { const el = document.getElementById(s + '-section'); if (el) el.style.display = 'none'; });
    const section = document.getElementById(role.toLowerCase() + '-section'); if (section) section.style.display = 'block';

    setupAdminTools();
}

function showLoginForm() { document.getElementById('login-form').style.display = 'flex'; document.getElementById('register-form').style.display = 'none'; document.getElementById('show-login-btn').classList.add('active'); document.getElementById('show-register-btn').classList.remove('active'); }

function renderDashboard(role) {
    if (role === 'Renter') renderRenterDashboard();
    if (role === 'Owner') renderOwnerDashboard();
    if (role === 'Admin') renderAdminDashboard();
}

// Renter dashboard
async function renderRenterDashboard() {
    const listingsBody = document.getElementById('listings-body');
    const bookingsBody = document.getElementById('bookings-body');
    if (listingsBody) listingsBody.innerHTML = '';
    if (bookingsBody) bookingsBody.innerHTML = '';

    const lr = await apiGetListings(false);
    const listings = (lr.ok && lr.data && lr.data.listings) ? lr.data.listings : [];
    listings.forEach(l => {
        if (!listingsBody) return;
        const row = listingsBody.insertRow();
        row.innerHTML = `<td>${l.location}</td><td>Hourly: Tk ${Number(l.price_hourly||0).toFixed(2)} Daily: Tk ${Number(l.price_daily||0).toFixed(2)} Monthly: Tk ${Number(l.price_monthly||0).toFixed(2)}</td><td>${l.availability||'Available'}</td><td><button onclick="showBookingModal(${l.id}, '${(l.location||'').replace(/'/g,"\\'")}')">Book</button></td>`;
    });

    const br = await apiGetBookings();
    const bookings = (br.ok && br.data && br.data.bookings) ? br.data.bookings : [];
    bookings.forEach(b => {
        if (!bookingsBody) return;
        const row = bookingsBody.insertRow();
        row.innerHTML = `<td>${b.location}</td><td>${b.start_time} - ${b.end_time}</td><td>${b.status}</td><td>Tk ${Number(b.total_price||0).toFixed(2)}</td><td><button onclick="cancelBooking(${b.id})">Cancel</button></td>`;
    });
}

// Booking modal and operations
function showBookingModal(listingId, location) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;width:400px;"><h2>Book ${location}</h2><form id="booking-form"><label>Start Time: <input type="datetime-local" id="start-time" required></label><label>End Time: <input type="datetime-local" id="end-time" required></label><div id="price-estimate"></div><button type="submit">Confirm Booking</button><button type="button" id="cancel-modal">Cancel</button></form></div>`;
    document.body.appendChild(modal);

    const form = document.getElementById('booking-form');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const priceEstimateDiv = document.getElementById('price-estimate');

    async function updateEstimate() {
        if (!startTimeInput.value || !endTimeInput.value) return;
        
        const lr = await apiGetListings(false);
        const listing = (lr.ok && lr.data && lr.data.listings) ? 
            lr.data.listings.find(x => x.id === listingId) : null;
        
        if (!listing) { 
            priceEstimateDiv.textContent = ''; 
            return; 
        }
        
        const price = calculateBookingPriceFromListing(
            listing, 
            'optimal', 
            startTimeInput.value, 
            endTimeInput.value
        );
        
        const start = new Date(startTimeInput.value);
        const end = new Date(endTimeInput.value);
        const hours = Math.ceil((end - start) / (1000 * 60 * 60));
        
        priceEstimateDiv.innerHTML = `
            Estimated Price: Tk ${price.toFixed(2)}<br>
            <small>Duration: ${hours} hours</small>
        `;
    }

    [startTimeInput, endTimeInput].forEach(inp => inp.addEventListener('change', updateEstimate));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;
        if (new Date(startTime) >= new Date(endTime)) { 
            alert('End time must be after start time'); 
            return; 
        }
        
        const res = await apiCreateBooking(listingId, startTime, endTime, 'optimal');
        if (!res.ok) { 
            alert((res.data && res.data.error) ? res.data.error : 'Booking failed'); 
            return; 
        }
        document.body.removeChild(modal);
        renderRenterDashboard();
    });

    document.getElementById('cancel-modal').addEventListener('click', () => modal.remove());
}

function calculateBookingPriceFromListing(listing, durationType, startTime, endTime) {
    const hourlyRate = Number(listing.price_hourly) || 0;
    const dailyRate = Number(listing.price_daily) || 0;
    const monthlyRate = Number(listing.price_monthly) || 0;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    
    const totalHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    
    // Calculate optimal pricing by comparing different combinations
    const hourlyOnlyPrice = hourlyRate * totalHours;
    
    // Calculate daily + hourly combination
    const fullDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    const dailyPlusHourlyPrice = (dailyRate * fullDays) + (hourlyRate * remainingHours);
    
    // Calculate monthly only pricing
    const HOURS_PER_MONTH = 24 * 30; // 720 hours
    const totalMonths = Math.max(1, Math.ceil(totalHours / HOURS_PER_MONTH));
    const monthlyOnlyPrice = monthlyRate * totalMonths;
    
    // Calculate monthly + daily + hourly combination
    const fullMonths = Math.floor(totalHours / HOURS_PER_MONTH);
    const remainingAfterMonths = totalHours % HOURS_PER_MONTH;
    const remainingDays = Math.floor(remainingAfterMonths / 24);
    const finalRemainingHours = remainingAfterMonths % 24;
    const monthlyPlusDailyPlusHourlyPrice = (monthlyRate * fullMonths) + (dailyRate * remainingDays) + (hourlyRate * finalRemainingHours);
    
    // For specific duration types, still respect the user's choice but optimize within that type
    switch(durationType) {
        case 'hourly': 
            return hourlyOnlyPrice;
            
        case 'daily': 
            const totalDays = Math.max(1, Math.ceil(totalHours / 24));
            return dailyRate * totalDays;
            
        case 'monthly': 
            const totalMonths = Math.max(1, Math.ceil(totalHours / HOURS_PER_MONTH));
            return monthlyRate * totalMonths;
            
        case 'optimal':
        default: 
            // Return the minimum price among all combinations
            return Math.min(hourlyOnlyPrice, dailyPlusHourlyPrice, monthlyOnlyPrice, monthlyPlusDailyPlusHourlyPrice);
    }
}

async function cancelBooking(bookingId) {
    const res = await apiDeleteBooking(bookingId);
    if (!res.ok) { alert((res.data && res.data.error) ? res.data.error : 'Failed to cancel'); return; }
    renderRenterDashboard();
}

// Owner
async function renderOwnerDashboard() {
    const ownerListingsBody = document.getElementById('owner-listings-body');
    const totalEarningsSpan = document.getElementById('total-earnings');
    if (!ownerListingsBody) return;
    ownerListingsBody.innerHTML = '';

    const lr = await apiGetListings(true);
    const listings = (lr.ok && lr.data && lr.data.listings) ? lr.data.listings : [];
    listings.forEach(listing => {
        const row = ownerListingsBody.insertRow();
        row.innerHTML = `<td>${listing.location}</td><td>Tk ${Number(listing.price_hourly||0).toFixed(2)}</td><td>Tk ${Number(listing.price_daily||0).toFixed(2)}</td><td>Tk ${Number(listing.price_monthly||0).toFixed(2)}</td><td>${listing.availability||''}</td><td><button onclick="viewListingBookings(${listing.id})">View Bookings & Renters</button></td>`;
    });

    // Calculate total earnings from all confirmed bookings
    const br = await apiGetBookings();
    const bookings = (br.ok && br.data && br.data.bookings) ? br.data.bookings : [];
    
    // Filter confirmed bookings and sum their total prices
    const confirmedBookings = bookings.filter(booking => booking.status === 'confirmed');
    const totalEarnings = confirmedBookings.reduce((sum, booking) => sum + Number(booking.total_price || 0), 0);
    
    // Update the earnings display
    if (totalEarningsSpan) {
        totalEarningsSpan.textContent = totalEarnings.toFixed(2);
    }
}

async function handleAddListing(e) {
    e.preventDefault();
    const location = (document.getElementById('location') || {}).value || '';
    const ph = Number((document.getElementById('price-hourly') || {}).value) || 0;
    const pd = Number((document.getElementById('price-daily') || {}).value) || 0;
    const pm = Number((document.getElementById('price-monthly') || {}).value) || 0;
    const availability = document.getElementById('availability')?.value === 'true' ? 'Available' : 'Unavailable';
    if (!location) { alert('Please provide location'); return; }
    const res = await apiCreateListing(location, ph, pd, pm, availability);
    if (!res.ok) { alert((res.data && res.data.error) ? res.data.error : 'Failed to add listing'); return; }
    (document.getElementById('add-listing-form') || {}).reset && document.getElementById('add-listing-form').reset();
    renderOwnerDashboard();
}

async function viewListingBookings(listingId) {
    // fetch bookings via GET /bookings (owner's bookings filtered on server)
    const res = await apiGetBookings();
    const rows = (res.ok && res.data && res.data.bookings) ? res.data.bookings.filter(b => b.listing_id === listingId) : [];

    // Fetch all users to get contact information
    const usersRes = await apiGetUsers();
    const users = (usersRes.ok && usersRes.data && usersRes.data.users) ? usersRes.data.users : [];
    const userMap = new Map(users.map(u => [u.username, u]));

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    modalOverlay.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;width:900px;max-height:70%;overflow:auto;"><h2>Listing Bookings</h2><table><thead><tr><th>Renter Name</th><th>Contact Number</th><th>Start</th><th>End</th><th>Status</th><th>Price</th><th>Actions</th></tr></thead><tbody id="listing-bookings-body"></tbody></table><button id="close-listing-bookings">Close</button></div>`;
    document.body.appendChild(modalOverlay);
    const body = document.getElementById('listing-bookings-body');
    rows.forEach(b => {
        const user = userMap.get(b.renter);
        const contact = user ? (user.contact || 'Not provided') : 'Not available';
        const r = body.insertRow();
        r.innerHTML = `<td>${b.renter}</td><td>${contact}</td><td>${b.start_time}</td><td>${b.end_time}</td><td>${b.status}</td><td>Tk ${Number(b.total_price||0).toFixed(2)}</td><td><button onclick="contactRenter('${b.renter}')">Contact</button></td>`;
    });
    document.getElementById('close-listing-bookings').addEventListener('click', () => modalOverlay.remove());
}

// Contact renter
function contactRenter(renterUsername) {
    // This function is called from the modal where user data is already available
    // We'll get the user data from the global scope or pass it as parameter
    alert(`Renter Information\n\nName: ${renterUsername}\nContact: Check the table above for contact details`);
}

// Admin
function setupAdminTools() {
    if (!currentUser || currentUser.role !== 'Admin') return;
    if (document.getElementById('manage-users-btn')) {
        document.getElementById('manage-users-btn').addEventListener('click', manageUsers);
    }
}

async function renderAdminDashboard() {
    const adminListingsBody = document.getElementById('admin-listings-body');
    const adminBookingsBody = document.getElementById('admin-bookings-body');
    if (adminListingsBody) adminListingsBody.innerHTML = '';
    if (adminBookingsBody) adminBookingsBody.innerHTML = '';

    const lr = await apiGetListings(false);
    const listings = (lr.ok && lr.data && lr.data.listings) ? lr.data.listings : [];
    listings.forEach(listing => {
        if (!adminListingsBody) return;
        const row = adminListingsBody.insertRow();
        row.innerHTML = `<td>${listing.owner}</td><td>${listing.location}</td><td>Tk ${Number(listing.price_hourly||0).toFixed(2)}</td><td>${listing.availability||''}</td><td><button onclick="deleteListing(${listing.id})">Delete</button></td>`;
    });

    const br = await apiGetBookings();
    const bookings = (br.ok && br.data && br.data.bookings) ? br.data.bookings : [];
    bookings.forEach(b => {
        if (!adminBookingsBody) return;
        const row = adminBookingsBody.insertRow();
        row.innerHTML = `<td>${b.renter}</td><td>${b.location}</td><td>${b.start_time}</td><td>${b.end_time}</td><td>${b.status}</td><td><button onclick="deleteBooking(${b.id})">Delete</button></td>`;
    });
}

async function manageUsers() {
    const res = await apiGetUsers();
    if (!res.ok) { 
        alert('Failed to fetch users'); 
        return; 
    }
    const users = res.data.users || [];
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background:white;padding:20px;border-radius:8px;width:90%;max-width:800px;max-height:70%;overflow:auto;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;margin-top:15px;';
    table.innerHTML = `<thead><tr><th>Username</th><th>Role</th><th>Contact</th><th>Action</th></tr></thead><tbody>${users.map(u=>`<tr><td>${u.username}</td><td>${u.role}</td><td>${u.contact||''}</td><td><button data-id="${u.id}" class="delete-user-btn">Remove</button></td></tr>`).join('')}</tbody>`;
    modalContent.appendChild(table);
    const closeButton = document.createElement('button'); closeButton.textContent = 'Close'; closeButton.style.cssText = 'margin-top:15px;padding:10px 20px;'; closeButton.addEventListener('click', () => modalOverlay.remove()); modalContent.appendChild(closeButton);
    modalOverlay.appendChild(modalContent); document.body.appendChild(modalOverlay);

    // wire delete buttons
    modalContent.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Delete user?')) return;
            
            const dr = await apiDeleteUserById(id);
            if (!dr.ok) { 
                alert('Failed to delete user'); 
                return; 
            }
            modalOverlay.remove();
            manageUsers();
        });
    });
}

async function deleteListing(id) {
    const res = await apiFetch('/listings/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { 
        alert('Failed to delete listing'); 
        return; 
    }
    renderAdminDashboard();
}

async function deleteBooking(id) {
    const res = await apiDeleteBooking(id);
    if (!res.ok) { 
        alert('Failed to delete booking'); 
        return; 
    }
    renderAdminDashboard();
}

// Utility: remove registration Admin option
function modifyRegistrationForm() {
    const sel = document.getElementById('register-role');
    if (!sel) return; const opt = sel.querySelector('option[value="Admin"]'); if (opt) opt.remove();
}

// Start
document.addEventListener('DOMContentLoaded', () => { initApp(); modifyRegistrationForm(); });