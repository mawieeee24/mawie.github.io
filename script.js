// ============================================
// WEBSOCKET / REAL-TIME UPDATES
// ============================================
let socket = null;
let isConnected = false;
let updateQueue = []; // Queue for offline updates
let isSyncing = false;

// Load queued updates from localStorage
function loadUpdateQueue() {
    const stored = localStorage.getItem('updateQueue');
    updateQueue = stored ? JSON.parse(stored) : [];
}

// Save update queue to localStorage
function saveUpdateQueue() {
    localStorage.setItem('updateQueue', JSON.stringify(updateQueue));
}

// Add update to queue (for offline scenarios)
function queueUpdate(action, data) {
    const update = {
        id: Date.now() + Math.random(),
        action: action,
        data: data,
        timestamp: new Date().toISOString()
    };
    updateQueue.push(update);
    saveUpdateQueue();
    console.log(`Update queued (offline): ${action}`, data);
}

// Process queued updates when connection restored
async function processUpdateQueue() {
    if (!isConnected || updateQueue.length === 0 || isSyncing) return;
    
    isSyncing = true;
    console.log(`Processing ${updateQueue.length} queued updates...`);
    
    const toProcess = [...updateQueue];
    
    for (const update of toProcess) {
        try {
            const idx = updateQueue.indexOf(update);
            
            if (update.action === 'listing-added' || update.action === 'listing-updated') {
                socket.emit(update.action, update.data);
            } else if (update.action === 'listing-deleted') {
                socket.emit(update.action, update.data);
            }
            
            // Remove from queue after successful send
            if (idx !== -1) updateQueue.splice(idx, 1);
        } catch (err) {
            console.error('Error processing queued update:', err);
        }
    }
    
    saveUpdateQueue();
    isSyncing = false;
    showNotification(`${toProcess.length} offline changes synced to cloud`);
}

function initializeWebSocket() {
    // Load any queued updates from previous sessions
    loadUpdateQueue();
    
    // Try to connect to local server, fallback gracefully if not available
    socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity, // Keep trying indefinitely
        reconnectionDelay: 1000 + Math.random() * 4000 // Exponential backoff with jitter
    });

    socket.on('connect', async () => {
        console.log('✅ Connected to real-time server');
        isConnected = true;
        updateConnectionStatus('connected');
        
        // Sync listings with server on connect
        if (socket) socket.emit('sync-listings', listings);
        
        // Process any queued updates
        await processUpdateQueue();
    });

    socket.on('disconnect', () => {
        console.log('⚠️  Disconnected from real-time server');
        isConnected = false;
        updateConnectionStatus('disconnected');
    });

    socket.on('reconnect', () => {
        console.log('🔄 Reconnected to server');
        isConnected = true;
        updateConnectionStatus('connected');
        processUpdateQueue();
    });

    socket.on('update-listings', (data) => {
        console.log('📨 Received update:', data.action, data.listing?.title || data.listingId);
        
        if (data.action === 'added') {
            // Add new listing if not already present
            if (!listings.find(l => l.id === data.listing.id)) {
                listings.unshift(data.listing);
                showNotification(`🏠 New listing added: ${data.listing.title}`);
            }
        } else if (data.action === 'deleted') {
            // Remove listing
            listings = listings.filter(l => l.id !== data.listingId);
            showNotification('🗑️  A listing was removed');
        } else if (data.action === 'updated') {
            // Update listing
            const idx = listings.findIndex(l => l.id === data.listing.id);
            if (idx !== -1) {
                listings[idx] = data.listing;
                showNotification(`✏️  Listing updated: ${data.listing.title}`);
            }
        }
        
        // Refresh the UI
        renderListings();
    });

    socket.on('sync-all-listings', (syncedListings) => {
        console.log('☁️  Synced listings from server:', syncedListings.length);
        listings = syncedListings;
        renderListings();
    });

    socket.on('users-count', (count) => {
        console.log('Active users:', count);
        const statusText = document.getElementById('statusText');
        if (statusText) {
            const onlineStatus = isConnected ? '🟢' : '🔴';
            statusText.textContent = `${onlineStatus} ${count} user${count !== 1 ? 's' : ''} online`;
        }
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
        updateConnectionStatus('error');
    });
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');
    if (!indicator || !text) return;

    indicator.className = 'status-dot';
    if (status === 'connected') {
        indicator.classList.add('connected');
        text.textContent = 'Connected';
    } else if (status === 'disconnected') {
        indicator.classList.add('disconnected');
        text.textContent = 'Offline - Sync paused';
    } else if (status === 'error') {
        indicator.classList.add('error');
        text.textContent = 'Connection error';
    }
}

function showNotification(message) {
    // Create a simple notification
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = message;
    document.body.appendChild(notif);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        notif.classList.add('fade-out');
        setTimeout(() => notif.remove(), 500);
    }, 4000);
}

// Initialize WebSocket when page loads
window.addEventListener('load', () => {
    initializeWebSocket();
    renderListings(); // Initial render to show/hide admin controls
    setupAdminControls();
});

// Setup admin-related controls and shortcuts
function setupAdminControls() {
    const adminBtn = document.getElementById('logoutBtn');
    if (adminBtn) {
        adminBtn.addEventListener('click', () => {
            if (confirm('Logout as admin?')) {
                sessionStorage.removeItem('isAdmin');
                isAdmin = false;
                renderListings();
                showNotification('✅ Logged out successfully');
            }
        });
    }
    
    // Keyboard shortcut: Press Shift+A+L to access admin login
    let keySequence = [];
    document.addEventListener('keydown', (e) => {
        keySequence.push(e.key);
        keySequence = keySequence.slice(-3); // Keep last 3 keys
        
        // Check for "ALa" sequence (Shift+A then L)
        if (keySequence.join('').toLowerCase() === 'ala' && e.shiftKey) {
            e.preventDefault();
            window.location.href = 'admin.html';
        }
    });
}

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
});

// Handle contact buttons (support multiple)
document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('contact-btn')) {
        alert('Thank you for your interest! Please call +639088878040 or email atheni@realestate.com to schedule a showing.');
    }
});

// Simple data storage + CRUD for featured listings (persist in localStorage)
const STORAGE_KEY = 'featured_listings_v1';
let listings = [];
// admin flag stored in sessionStorage; set by visiting hidden admin page
let isAdmin = sessionStorage.getItem('isAdmin') === '1';

const defaults = [
    {
        id: Date.now().toString(),
        title: 'Auria Residences',
        description: 'Where living close to the city center does not need to with hassle or noise and congestion.',
        location: 'Nivel Hills, Veterans Drive, Brgy. Lahug, Cebu City',
        locationDetails: 'Auria Residences Lahug is nestled in the picturesque uphill location in Nivel Hills, Cebu City. It is a mixed-use condo development set to redefine urban living with its stunning blend of modern design and breathtaking panoramic views.',
        beds: 1,
        baths: 1,
        mainImage: 'auria.jpg',
        gallery: ['bedroom.jpg','bathroom.jpg','livingroom.jpg','kitchen.jpg','diningroom.jpg'],
        amenities: ['Infinity Pool', '100% Back-up Power', '6 elevators', 'CCTV', 'WiFi'],
        pricing: [
            {
                title: 'STUDIO UNIT - 22.1 sqm',
                type: 'East Mandaue/City View',
                items: ['Total Selling Price: ₱4,381,104', 'Reservation Fee: ₱20,000', '15% Downpayment payable in 60 months: ₱8,000/month', '85% Balance payable through bank financing']
            },
            {
                title: '1BR UNIT - 45.27 sqm',
                type: 'West/Mountain View',
                items: ['Total Selling Price: ₱8,264,491', 'Reservation Fee: ₱20,000', '15% Downpayment payable in 60 months: ₱22,600/month', '85% Balance payable through bank financing']
            },
            {
                title: '2BR UNIT - 66.52 sqm',
                type: 'South West/Corner Mountain View & City View',
                items: ['Total Selling Price: ₱12,814,412', 'Reservation Fee: ₱20,000', '15% Downpayment payable in 60 months: ₱35,000/month', '85% Balance payable through bank financing']
            }
        ],
        locations: ['340 m Marco Polo Plaza Cebu', '760 m Mercedes-Benz Cebu', '1.4 km Camp Lapu-Lapu Station Hospital', '1.5 km JY Square Mall', '1.87 km University of Southern Philippines Foundation', '1.9 km Cebu IT Park', '2.4 km University of the Philippines Cebu', '2.5 km Waterfront Hotel & Casino Cebu City', '2.9 km Cebu Business Park', '2.9 km Ayala Center Cebu', '3.6 km Temple of Leah', '3.8 km TOPS Cebu', '6.2 km Cebu City Link Expressway Bridge', '9.8 km Mactan Cebu International Airport']
    }
];

function loadListings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        listings = raw ? JSON.parse(raw) : defaults.slice();
    } catch (e) {
        listings = defaults.slice();
    }
}

function saveListings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
    // Emit sync to all connected clients
    if (socket && isConnected) {
        socket.emit('sync-listings', listings);
    }
}

function el(tag, props = {}, children = []){
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k,v]) => {
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else node.setAttribute(k, v);
    });
    (Array.isArray(children)?children:[children]).forEach(c => { if (c) node.appendChild(typeof c === 'string'? document.createTextNode(c): c); });
    return node;
}

function renderListings(){
    const container = document.getElementById('featuredList');
    container.innerHTML = '';
    // show/hide admin controls
    const adminControls = document.querySelector('.admin-controls');
    if (adminControls) adminControls.style.display = isAdmin ? 'flex' : 'none';
    listings.forEach(listing => {
        const card = el('div',{class: 'listing-card'});
        const imgWrap = el('div',{class:'listing-image'});
        const img = el('img',{src: listing.mainImage || '', alt: listing.title});
        imgWrap.appendChild(img);

        const details = el('div',{class: 'listing-details'});
        const h3 = el('h3',{}, [listing.title]);
        const info = el('div',{class:'property-info'});
        info.appendChild(el('span',{class:'info-item'}, [listing.beds + ' Bedroom']));
        info.appendChild(el('span',{class:'info-item'}, [listing.baths + ' Bathroom']));
        const desc = el('p',{class:'description'}, [listing.description || '']);

        const actions = el('div',{class:'listing-actions'});
        const detailsBtn = el('button',{class:'details-btn', 'data-id': listing.id}, ['Details']);
        let editBtn, delBtn;
        if (isAdmin) {
            editBtn = el('button',{class:'details-btn edit-btn', 'data-id': listing.id}, ['Edit']);
            delBtn = el('button',{class:'details-btn delete-btn', 'data-id': listing.id}, ['Delete']);
        }
        const contactBtn = el('button',{class:'contact-btn'}, ['Schedule a Showing']);

        actions.appendChild(detailsBtn);
        actions.appendChild(contactBtn);
        if (isAdmin) {
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
        }

        details.appendChild(h3);
        details.appendChild(info);
        details.appendChild(desc);
        details.appendChild(actions);

        card.appendChild(imgWrap);
        card.appendChild(details);
        container.appendChild(card);
    });

    // Attach delegated listeners (details/edit/delete)
    container.querySelectorAll('.details-btn').forEach(btn => {
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit-btn')) btn.addEventListener('click', () => openEditModal(id));
        else if (btn.classList.contains('delete-btn')) btn.addEventListener('click', () => deleteListing(id));
        else btn.addEventListener('click', () => openDetailsModal(id));
    });
}

function deleteListing(id){
    if (!confirm('Delete this listing?')) return;
    listings = listings.filter(l => l.id !== id);
    saveListings();
    renderListings();
    // Emit delete event to all connected clients
    if (socket && isConnected) {
        socket.emit('listing-deleted', id);
    } else if (!isConnected) {
        // Queue deletion for when connection is restored
        queueUpdate('listing-deleted', id);
    }
}

// Edit/Create modal handling
const addBtn = document.getElementById('addFeaturedBtn');
const editModal = document.getElementById('editModal');
const detailsModal = document.getElementById('detailsModal');

function openEditModal(id){
    if (!sessionStorage.getItem('isAdmin')) { alert('Admin only: log in at the hidden admin page.'); return; }
    const form = document.getElementById('editForm');
    document.getElementById('listingId').value = id || '';
    const titleInput = document.getElementById('titleInput');
    const descInput = document.getElementById('descInput');
    const locationInput = document.getElementById('locationInput');
    const locationDetailsInput = document.getElementById('locationDetailsInput');
    const bedsInput = document.getElementById('bedsInput');
    const bathsInput = document.getElementById('bathsInput');
        const amenitiesInput = document.getElementById('amenitiesInput');
        const locationsInput = document.getElementById('locationsInput');
    const mainPreview = document.getElementById('mainPreview');
    const galleryPreview = document.getElementById('galleryPreview');
    mainPreview.innerHTML = '';
    galleryPreview.innerHTML = '';
    
    // reset pricing units
    currentEditingPricing = [];
    renderPricingUnits();
    
    if (!id){
        document.getElementById('editTitle').textContent = 'Add Featured Listing';
        titleInput.value = '';
        descInput.value = '';
        locationInput.value = '';
        locationDetailsInput.value = '';
        bedsInput.value = 0;
        bathsInput.value = 0;
            amenitiesInput.value = '';
            locationsInput.value = '';
    } else {
        const listing = listings.find(l => l.id === id);
        if (!listing) return;
        document.getElementById('editTitle').textContent = 'Edit Listing';
        titleInput.value = listing.title || '';
        descInput.value = listing.description || '';
        locationInput.value = listing.location || '';
        locationDetailsInput.value = listing.locationDetails || '';
        bedsInput.value = listing.beds || 0;
        bathsInput.value = listing.baths || 0;
            amenitiesInput.value = (listing.amenities || []).join('\n');
            locationsInput.value = (listing.locations || []).join('\n');
        
        // load pricing units
        currentEditingPricing = JSON.parse(JSON.stringify(Array.isArray(listing.pricing) ? listing.pricing : []));
        renderPricingUnits();
        
        if (listing.mainImage) {
            const img = el('img',{src: listing.mainImage}); mainPreview.appendChild(img);
        }
        if (Array.isArray(listing.gallery)){
            listing.gallery.forEach(src => { const t = el('img',{src}); galleryPreview.appendChild(t); });
        }
    }
    openModal(editModal);
}

function openModal(modal){
    if (!modal) return; modal.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden';
}
function closeModal(modal){ if (!modal) return; modal.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; }

// Pricing units management
let currentEditingPricing = [];

function renderPricingUnits(){
    const container = document.getElementById('pricingUnitsContainer');
    container.innerHTML = '';
    currentEditingPricing.forEach((unit, idx) => {
        const unitDiv = el('div', {class: 'pricing-unit'});
        const titleDiv = el('div', {class: 'pricing-unit-title'}, [unit.title || '']);
        const typeDiv = el('div', {class: 'pricing-unit-type'}, [unit.type || '']);
        const itemsDiv = el('div', {class: 'pricing-unit-items'});
        (unit.items || []).forEach(item => {
            itemsDiv.appendChild(el('div', {class: 'pricing-item'}, [item]));
        });
        const removeBtn = el('button', {type: 'button', class: 'details-btn remove-unit-btn'}, ['Remove']);
        removeBtn.addEventListener('click', () => {
            currentEditingPricing.splice(idx, 1);
            renderPricingUnits();
        });
        unitDiv.appendChild(titleDiv);
        unitDiv.appendChild(typeDiv);
        unitDiv.appendChild(itemsDiv);
        unitDiv.appendChild(removeBtn);
        container.appendChild(unitDiv);
    });
}

document.getElementById('addPricingUnitBtn').addEventListener('click', (e) => {
    e.preventDefault();
    currentEditingPricing.push({title: '', type: '', items: []});
    renderPricingUnits();
    // open a quick edit modal or inline edit
    promptEditPricingUnit(currentEditingPricing.length - 1);
});

function promptEditPricingUnit(idx){
    const unit = currentEditingPricing[idx];
    const title = prompt('Unit title (e.g., STUDIO UNIT - 22.1 sqm):', unit.title || '');
    if (title === null) return;
    unit.title = title;
    const type = prompt('Unit type/view (e.g., East Mandaue/City View):', unit.type || '');
    if (type === null) return;
    unit.type = type;
    const itemsText = prompt('Items (one per line):', (unit.items || []).join('\n'));
    if (itemsText === null) return;
    unit.items = itemsText.split('\n').map(s => s.trim()).filter(Boolean);
    renderPricingUnits();
}

// Form handling: read files then save
function readFileAsDataURL(file){
    return new Promise((resolve,reject)=>{
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
    });
}

document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sessionStorage.getItem('isAdmin')) { alert('Admin only: cannot save.'); return; }
    const id = document.getElementById('listingId').value;
    const title = document.getElementById('titleInput').value.trim();
    const description = document.getElementById('descInput').value.trim();
    const location = document.getElementById('locationInput').value.trim();
    const locationDetails = document.getElementById('locationDetailsInput').value.trim();
    const beds = Number(document.getElementById('bedsInput').value) || 0;
    const baths = Number(document.getElementById('bathsInput').value) || 0;
    const amenitiesText = document.getElementById('amenitiesInput') ? (document.getElementById('amenitiesInput').value || '') : '';
    const locationsText = document.getElementById('locationsInput') ? (document.getElementById('locationsInput').value || '') : '';
    const mainFile = document.getElementById('mainImageInput').files[0];
    const galleryFiles = Array.from(document.getElementById('galleryInput').files || []);

    let mainImage;
    let gallery = [];

    // If new files selected, read them; otherwise keep existing
    if (mainFile) mainImage = await readFileAsDataURL(mainFile);
    if (galleryFiles.length) {
        for (const f of galleryFiles) {
            try { const d = await readFileAsDataURL(f); gallery.push(d); } catch(_){}
        }
    }

    const amenities = amenitiesText.split('\n').map(s=>s.trim()).filter(Boolean);
    const locations = locationsText.split('\n').map(s=>s.trim()).filter(Boolean);

    if (id) {
        const idx = listings.findIndex(l => l.id === id);
        if (idx === -1) return;
        listings[idx].title = title;
        listings[idx].description = description;
        listings[idx].location = location;
        listings[idx].locationDetails = locationDetails;
        listings[idx].beds = beds;
        listings[idx].baths = baths;
        if (mainImage) listings[idx].mainImage = mainImage;
            if (gallery.length) listings[idx].gallery = (listings[idx].gallery || []).concat(gallery);
            listings[idx].amenities = amenities;
            listings[idx].locations = locations;
            listings[idx].pricing = currentEditingPricing;
            
        saveListings();
        renderListings();
        // Emit update event to all connected clients
        if (socket && isConnected) {
            socket.emit('listing-updated', listings[idx]);
        } else if (!isConnected) {
            // Queue update for when connection is restored
            queueUpdate('listing-updated', listings[idx]);
        }
    } else {
        const newListing = {
            id: Date.now().toString(),
            title,
            description,
            location,
            locationDetails,
            beds,
            baths,
            mainImage: mainImage || '',
            gallery: gallery,
                amenities: amenities,
                locations: locations,
                pricing: currentEditingPricing
        };
        listings.unshift(newListing);
        saveListings();
        renderListings();
        // Emit add event to all connected clients
        if (socket && isConnected) {
            socket.emit('listing-added', newListing);
        } else if (!isConnected) {
            // Queue add for when connection is restored
            queueUpdate('listing-added', newListing);
        }
    }

    closeModal(editModal);
    // reset file inputs
    document.getElementById('mainImageInput').value = '';
    document.getElementById('galleryInput').value = '';
});

// Previews for file inputs
document.getElementById('mainImageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('mainPreview'); preview.innerHTML = '';
    if (file) {
        const src = await readFileAsDataURL(file);
        preview.appendChild(el('img',{src}));
    }
});
document.getElementById('galleryInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files||[]);
    const preview = document.getElementById('galleryPreview'); preview.innerHTML = '';
    for (const f of files){ const src = await readFileAsDataURL(f); preview.appendChild(el('img',{src})); }
});

// Cancel and close buttons
document.querySelectorAll('#editModal .modal-close, #cancelEdit').forEach(btn => btn.addEventListener('click', () => closeModal(editModal)));

// Add new
if (addBtn && isAdmin) addBtn.addEventListener('click', () => openEditModal());

// show small admin status / logout link in nav when logged in
if (isAdmin) {
    const nav = document.querySelector('.nav-links');
    if (nav) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#'; a.textContent = 'Admin: Logout'; a.id = 'adminLogout';
        a.addEventListener('click', (ev) => { ev.preventDefault(); sessionStorage.removeItem('isAdmin'); location.reload(); });
        li.appendChild(a);
        nav.appendChild(li);
    }
}

// Details modal logic (dynamic)
let currentGallery = [];
let currentIndex = 0;
const modalImage = document.getElementById('modalImage');
const thumbsContainer = document.querySelector('.modal-thumbs');
const modalPrev = document.querySelector('.modal-prev');
const modalNext = document.querySelector('.modal-next');
const modalCloseBtns = document.querySelectorAll('#detailsModal .modal-close');

function openDetailsModal(id){
    const listing = listings.find(l => l.id === id);
    if (!listing) return;
    currentGallery = (listing.gallery && listing.gallery.length)? listing.gallery.slice() : (listing.mainImage? [listing.mainImage]:[]);
    currentIndex = 0;
    renderDetailsContent(listing);
    openModal(detailsModal);
}

function renderDetailsContent(listing){
    // set main image
    modalImage.src = currentGallery[currentIndex] || listing.mainImage || '';
    // thumbs
    thumbsContainer.innerHTML = '';
    currentGallery.forEach((src, i) => {
        const t = el('img',{class:'thumb','data-src':src,src,alt:'thumb'});
        t.addEventListener('click', () => { currentIndex = i; modalImage.src = src; updateActiveThumb(); });
        thumbsContainer.appendChild(t);
    });
    updateActiveThumb();

    // info
    const infoContent = document.getElementById('infoContent');
    let infoHtml = `<h3>${listing.title}</h3><p>${listing.description || ''}</p>`;
    infoHtml += `<h4>PROJECT NAME</h4><p>${listing.title || ''}</p>`;
    if (listing.location || listing.locationDetails) {
        infoHtml += `<h4>LOCATION</h4><p>${listing.location || ''}</p>`;
        if (listing.locationDetails) infoHtml += `<p>${listing.locationDetails}</p>`;
    }
    if (listing.locations && listing.locations.length) {
        infoHtml += `<h4>LOCATIONS</h4><ul class="amenity-list">${listing.locations.map(loc=>`<li>${loc}</li>`).join('')}</ul>`;
    }
    infoContent.innerHTML = infoHtml;

    const amenitiesContent = document.getElementById('amenitiesContent');
    amenitiesContent.innerHTML = (listing.amenities && listing.amenities.length)? `<ul class="amenity-list">${listing.amenities.map(a=>`<li>${a}</li>`).join('')}</ul>` : '<p>No amenities provided.</p>';

    const pricingContent = document.getElementById('pricingContent');
    if (listing.pricing && listing.pricing.length && typeof listing.pricing[0] === 'object') {
        // structured pricing units
        let pricingHtml = '<h4>RFO UNITS - SAMPLE COMPUTATION</h4>';
        listing.pricing.forEach(unit => {
            pricingHtml += `<div class="unit-pricing"><h5>${unit.title || ''}</h5><p class="unit-type">${unit.type || ''}</p><ul class="pricing-list">`;
            (unit.items || []).forEach(item => {
                pricingHtml += `<li>${item}</li>`;
            });
            pricingHtml += `</ul></div>`;
        });
        pricingContent.innerHTML = pricingHtml;
    } else {
        pricingContent.innerHTML = (listing.pricing && listing.pricing.length)? `<ul class="pricing-list">${listing.pricing.map(p=>`<li>${p}</li>`).join('')}</ul>` : '<p>No pricing details.</p>';
    }

    // prev/next wiring
}

function updateActiveThumb(){
    const thumbs = Array.from(document.querySelectorAll('.modal-thumbs .thumb'));
    thumbs.forEach((t,i)=> t.classList.toggle('active', i===currentIndex));
}

if (modalPrev) modalPrev.addEventListener('click', () => { if (!currentGallery.length) return; currentIndex = (currentIndex-1+currentGallery.length)%currentGallery.length; modalImage.src = currentGallery[currentIndex]; updateActiveThumb(); });
if (modalNext) modalNext.addEventListener('click', () => { if (!currentGallery.length) return; currentIndex = (currentIndex+1)%currentGallery.length; modalImage.src = currentGallery[currentIndex]; updateActiveThumb(); });
modalCloseBtns.forEach(b => b.addEventListener('click', () => closeModal(detailsModal)));

// Close when clicking outside
if (detailsModal) detailsModal.addEventListener('click', (e) => { if (e.target === detailsModal) closeModal(detailsModal); });
if (editModal) editModal.addEventListener('click', (e) => { if (e.target === editModal) closeModal(editModal); });

// keyboard
document.addEventListener('keydown', (e) => {
    if (detailsModal && detailsModal.getAttribute('aria-hidden') === 'false'){
        if (e.key === 'Escape') closeModal(detailsModal);
        if (e.key === 'ArrowRight') { if (currentGallery.length){ currentIndex = (currentIndex+1)%currentGallery.length; modalImage.src = currentGallery[currentIndex]; updateActiveThumb(); } }
        if (e.key === 'ArrowLeft') { if (currentGallery.length){ currentIndex = (currentIndex-1+currentGallery.length)%currentGallery.length; modalImage.src = currentGallery[currentIndex]; updateActiveThumb(); } }
    }
    if (editModal && editModal.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') closeModal(editModal);
});

// Tabs (delegated)
document.addEventListener('click',(e)=>{
    if (e.target && e.target.classList && e.target.classList.contains('tab-btn')){
        const tabName = e.target.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
        e.target.classList.add('active');
        const activeTab = document.getElementById(`${tabName}-tab`);
        if (activeTab) activeTab.classList.add('active');
    }
});

// init
loadListings();
renderListings();
