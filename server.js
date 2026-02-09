require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || 50) * 1024 * 1024 // 50MB default
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  }
});

// ============================================
// FIREBASE INITIALIZATION
// ============================================
let db = null;
let listings = [];
let useCloudBackend = false;

function initializeFirebase() {
  try {
    // Check if service account file exists
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-key.json';
    const apiKey = process.env.FIREBASE_API_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (fs.existsSync(serviceAccountPath) && projectId) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${projectId}.firebaseio.com`
      });
      db = admin.firestore();
      useCloudBackend = true;
      console.log('✅ Firebase initialized - using cloud backend');
    } else {
      console.log('⚠️  Firebase credentials not found - using local JSON storage');
      useCloudBackend = false;
    }
  } catch (err) {
    console.error('Firebase initialization error:', err.message);
    useCloudBackend = false;
  }
}

// Initialize Firebase
initializeFirebase();

// ============================================
// LOCAL STORAGE FALLBACK
// ============================================
const DATA_FILE = path.join(__dirname, 'listings.json');

function loadListingsLocal() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      listings = JSON.parse(raw);
    } else {
      listings = [];
    }
  } catch (err) {
    console.error('Failed to load listings:', err);
    listings = [];
  }
}

function saveListingsLocal() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(listings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save listings:', err);
  }
}

// ============================================
// FIREBASE OPERATIONS
// ============================================
async function loadListingsFromFirebase() {
  try {
    if (!useCloudBackend || !db) {
      loadListingsLocal();
      return;
    }
    
    const snapshot = await db.collection('listings').orderBy('createdAt', 'desc').get();
    listings = [];
    snapshot.forEach(doc => {
      listings.push({ id: doc.id, ...doc.data() });
    });
    console.log(`Loaded ${listings.length} listings from Firebase`);
  } catch (err) {
    console.error('Failed to load listings from Firebase:', err.message);
    loadListingsLocal();
  }
}

async function saveListing(listing) {
  try {
    if (!useCloudBackend || !db) {
      const idx = listings.findIndex(l => l.id === listing.id);
      if (idx === -1) listings.unshift(listing);
      else listings[idx] = listing;
      saveListingsLocal();
      return;
    }

    // Save to Firebase
    await db.collection('listings').doc(listing.id).set(
      {
        ...listing,
        updatedAt: admin.firestore.Timestamp.now()
      },
      { merge: true }
    );
    
    // Update local cache
    const idx = listings.findIndex(l => l.id === listing.id);
    if (idx === -1) listings.unshift(listing);
    else listings[idx] = listing;
  } catch (err) {
    console.error('Failed to save listing to Firebase:', err.message);
  }
}

async function deleteListing(listingId) {
  try {
    if (!useCloudBackend || !db) {
      listings = listings.filter(l => l.id !== listingId);
      saveListingsLocal();
      return;
    }

    await db.collection('listings').doc(listingId).delete();
    listings = listings.filter(l => l.id !== listingId);
  } catch (err) {
    console.error('Failed to delete listing from Firebase:', err.message);
  }
}

// Initialize storage
if (useCloudBackend) {
  loadListingsFromFirebase();
} else {
  loadListingsLocal();
}

// ============================================
// IMAGE UPLOAD HANDLER (Firebase Storage)
// ============================================
let bucket = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (useCloudBackend && projectId) {
    bucket = admin.storage().bucket(`${projectId}.appspot.com`);
    console.log('✅ Firebase Storage initialized');
  }
} catch (err) {
  console.error('Firebase Storage error:', err.message);
}

async function uploadImageToCloud(file, folder = 'property-images') {
  try {
    if (!bucket || !file) return null;
    
    const timestamp = Date.now();
    const filename = `${folder}/${timestamp}-${file.originalname}`;
    const fileRef = bucket.file(filename);
    
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype
      }
    });
    
    const [url] = await fileRef.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year
    });
    
    return url;
  } catch (err) {
    console.error('Failed to upload image to Firebase:', err.message);
    return null;
  }
}

// ============================================
// HTTP API ENDPOINTS
// ============================================

// Admin authentication middleware
function requireAdmin(req, res, next) {
  const adminToken = req.headers['x-admin-token'];
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (adminToken === adminPassword) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Upload image endpoint
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    const adminToken = req.headers['x-admin-token'];
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (adminToken !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // Upload to cloud if available, otherwise use data URL
    let imageUrl = null;
    
    if (bucket) {
      imageUrl = await uploadImageToCloud(req.file);
    }
    
    if (!imageUrl) {
      // Fallback to base64 data URL
      imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }
    
    res.json({ 
      success: true, 
      url: imageUrl,
      filename: req.file.originalname
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed', message: err.message });
  }
});

// ============================================
// WEBSOCKET EVENT HANDLERS
// ============================================
// Store all connected clients
const clients = new Set();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  clients.add(socket.id);

  // Emit current number of active users
  io.emit('users-count', clients.size);

  // Send the authoritative listings to the newly connected client
  try { socket.emit('sync-all-listings', listings); } catch(e){}

  // Handle listing added/updated event from admin
  socket.on('listing-added', async (listing) => {
    console.log('New listing added:', listing.title);
    // Update server storage and persist
    if (listing && listing.id) {
      await saveListing(listing);
    }
    // Broadcast to all connected clients (including the sender)
    io.emit('update-listings', {
      action: 'added',
      listing: listing,
      timestamp: new Date()
    });
  });

  // Handle listing deleted event
  socket.on('listing-deleted', async (listingId) => {
    console.log('Listing deleted:', listingId);
    // remove from server storage
    await deleteListing(listingId);
    io.emit('update-listings', {
      action: 'deleted',
      listingId: listingId,
      timestamp: new Date()
    });
  });

  // Handle listing updated event
  socket.on('listing-updated', async (listing) => {
    console.log('Listing updated:', listing.id);
    // update server storage
    await saveListing(listing);
    io.emit('update-listings', {
      action: 'updated',
      listing: listing,
      timestamp: new Date()
    });
  });

  // Handle all listings sync request
  socket.on('sync-listings', async (clientListings) => {
    try {
      if (Array.isArray(clientListings) && clientListings.length) {
        // Merge: add any client items that the server doesn't have
        const existingIds = new Set(listings.map(l => l.id));
        const toAdd = clientListings.filter(l => l && l.id && !existingIds.has(l.id));
        if (toAdd.length) {
          for (const listing of toAdd) {
            await saveListing(listing);
          }
          console.log('Merged', toAdd.length, 'listings from client');
        }
      }
    } catch (err) { console.error('Error merging listings:', err); }
    // Broadcast authoritative list to all clients
    io.emit('sync-all-listings', listings);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    clients.delete(socket.id);
    io.emit('users-count', clients.size);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Real Estate Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready for real-time updates`);
  console.log(`☁️  Backend: ${useCloudBackend ? 'Firebase Cloud' : 'Local Storage'}`);
});
