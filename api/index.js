// Vercel Serverless Entry Point
// This file wraps the Express app for Vercel deployment

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const multer = require('multer');

// Load environment variables
dotenv.config();

// Use Supabase config for Vercel
const { initDatabase, getSupabase, closePool } = require('../config/supabase');
const {
  createUsersTable,
  createPostsTable,
  createCommentsTable,
  createArticlesTable,
  createVideosTable,
  createEventsTable,
  createImagesTable,
  createStatisticsTable,
  createWilayahTable,
  createApiKeyUsageTable
} = require('../utils/dbHelperPg');

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Database pool (will be initialized on first request)
let dbPool = null;
let isInitialized = false;
let initPromise = null;

// Initialize database on first request
async function ensureDbInitialized() {
  if (isInitialized) return dbPool;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      dbPool = await initDatabase();
      
      // Create tables if not exist
      await createUsersTable(dbPool);
      await createPostsTable(dbPool);
      await createCommentsTable(dbPool);
      await createArticlesTable(dbPool);
      await createVideosTable(dbPool);
      await createEventsTable(dbPool);
      await createImagesTable(dbPool);
      await createStatisticsTable(dbPool);
      await createWilayahTable(dbPool);
      await createApiKeyUsageTable(dbPool);
      
      isInitialized = true;
      console.log('Database initialized for Vercel');
      return dbPool;
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// Health check (no db needed)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: 'vercel',
    database: isInitialized ? 'connected' : 'not connected'
  });
});

app.get('/pajar/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: 'vercel',
    database: isInitialized ? 'connected' : 'not connected'
  });
});

// Location endpoint - IP geolocation
const geoip = require('geoip-lite');

function normalizeIp(value) {
  if (!value) return '';
  let ip = String(value).trim();
  // If value includes a port (rare in headers), drop it
  if (ip.includes(':') && ip.includes('.')) {
    // Might be IPv4:port or ::ffff:IPv4
    ip = ip.replace(/^::ffff:/, '');
    ip = ip.split(':')[0];
  }
  ip = ip.replace(/^::ffff:/, '');
  return ip;
}

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  // IPv6 local/link-local/ULA
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;

  const parts = ip.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function getClientIp(req) {
  const headerCandidates = [];
  const xff = (req.headers['x-forwarded-for'] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  headerCandidates.push(...xff);
  headerCandidates.push(req.headers['x-real-ip']);
  headerCandidates.push(req.headers['cf-connecting-ip']);
  headerCandidates.push(req.headers['true-client-ip']);

  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress;
  const reqIp = req.ip;

  const candidates = [...headerCandidates, socketIp, reqIp]
    .map(normalizeIp)
    .filter(Boolean);

  // Prefer the first public IP
  const publicIp = candidates.find(ip => !isPrivateOrLocalIp(ip));
  return publicIp || candidates[0] || '';
}

function getVercelGeo(req) {
  const h = req.headers;
  const latitude = parseFloat(h['x-vercel-ip-latitude']);
  const longitude = parseFloat(h['x-vercel-ip-longitude']);

  const country = h['x-vercel-ip-country'];
  const region = h['x-vercel-ip-country-region'];
  const city = h['x-vercel-ip-city'];

  const hasLatLon = Number.isFinite(latitude) && Number.isFinite(longitude);
  const hasAnyMeta = Boolean(country || region || city);

  if (!hasLatLon && !hasAnyMeta) return null;

  return {
    source: 'vercel',
    latitude: hasLatLon ? latitude : null,
    longitude: hasLatLon ? longitude : null,
    country: country || null,
    region: region || null,
    city: city || null
  };
}

app.get(['/pajar/location', '/location'], async (req, res) => {
  let ip = req.query.ip || getClientIp(req);
  if (ip === '::1' || ip === '127.0.0.1') ip = '160.22.134.39';

  // 1) Prefer Vercel geolocation headers when available
  const vercelGeo = getVercelGeo(req);
  if (vercelGeo && vercelGeo.latitude != null && vercelGeo.longitude != null) {
    return res.json({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [vercelGeo.longitude, vercelGeo.latitude]
      },
      properties: {
        ip,
        source: vercelGeo.source,
        country: vercelGeo.country,
        region: vercelGeo.region,
        city: vercelGeo.city
      }
    });
  }

  // 2) Fallback to geoip-lite database
  const location = geoip.lookup(ip);
  if (location) {
    return res.json({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [location.ll[1], location.ll[0]]
      },
      properties: {
        ip,
        source: 'geoip-lite',
        country: location.country,
        region: location.region,
        city: location.city,
        timezone: location.timezone
      }
    });
  }

  // 3) If we at least have Vercel metadata, return it (without coordinates)
  if (vercelGeo) {
    return res.json({
      type: 'Feature',
      geometry: null,
      properties: {
        ip,
        source: vercelGeo.source,
        country: vercelGeo.country,
        region: vercelGeo.region,
        city: vercelGeo.city,
        error: 'Coordinates not available'
      }
    });
  }

  // 4) Nothing available
  return res.json({
    type: 'Feature',
    geometry: null,
    properties: { ip, source: null, error: 'Location not found' }
  });
});

// Root documentation
app.get(['/', '/pajar', '/api'], (req, res) => {
  const baseUrl = `https://${req.get('host')}/pajar`;
  
  res.json({
    name: "Pangan Jawara API - Vercel Edition",
    version: "2.0.0",
    description: "REST API deployed on Vercel with Supabase PostgreSQL",
    baseUrl: baseUrl,
    database: "Supabase PostgreSQL",
    storage: "Supabase Storage",
    
    endpoints: {
      health: `${baseUrl}/health`,
      auth: `${baseUrl}/auth/*`,
      posts: `${baseUrl}/posts/*`,
      articles: `${baseUrl}/articles/*`,
      videos: `${baseUrl}/videos/*`,
      events: `${baseUrl}/events/*`,
      pangan: `${baseUrl}/pangan/*`,
      bmkg: `${baseUrl}/bmkg/*`,
      nekolabs: `${baseUrl}/nekolabs/*`
    },
    
    features: [
      "🚀 Serverless deployment on Vercel",
      "🐘 PostgreSQL via Supabase",
      "📦 Supabase Storage for uploads",
      "🔐 JWT Authentication",
      "🌐 CORS enabled"
    ]
  });
});

// Import route creators
const createPostRoutes = require('../routes/posts');
const createCommentRoutes = require('../routes/comments');
const createAuthRoutes = require('../routes/auth');
const createArticleRoutes = require('../routes/articles');
const createVideoRoutes = require('../routes/videos');
const createPublicArticleRoutes = require('../routes/publicArticles');
const createPublicVideoRoutes = require('../routes/publicVideos');
const createPublicPostRoutes = require('../routes/publicPosts');
const createStatsRoutes = require('../routes/stats');
const createEventRoutes = require('../routes/events');
const createWilayahRoutes = require('../routes/wilayah');
const createPanganRoutes = require('../routes/pangan');
const createBmkgRoutes = require('../routes/bmkg');

// Check if nekolabs routes exist
let createNekolabsRoutes;
try {
  createNekolabsRoutes = require('../routes/nekolabs');
} catch (e) {
  console.log('Nekolabs routes not found, skipping...');
}

// Routes will be mounted after DB is initialized
function mountRoutes(basePath, db) {
  // Create routers with db instance
  app.use(`${basePath}/posts`, createPostRoutes(db));
  app.use(`${basePath}`, createCommentRoutes(db));
  app.use(`${basePath}/auth`, createAuthRoutes(db));
  app.use(`${basePath}/articles`, createArticleRoutes(db));
  app.use(`${basePath}/videos`, createVideoRoutes(db));
  app.use(`${basePath}/public/articles`, createPublicArticleRoutes(db));
  app.use(`${basePath}/public/videos`, createPublicVideoRoutes(db));
  app.use(`${basePath}/public/posts`, createPublicPostRoutes(db));
  app.use(`${basePath}/stats`, createStatsRoutes(db));
  app.use(`${basePath}/events`, createEventRoutes(db));
  app.use(`${basePath}/wilayah`, createWilayahRoutes(db));
  
  // Proxy routes (no db needed)
  app.use(`${basePath}/pangan`, createPanganRoutes());
  app.use(`${basePath}/bmkg`, createBmkgRoutes());
  
  if (createNekolabsRoutes) {
    app.use(`${basePath}/nekolabs`, createNekolabsRoutes);
  }
}

// Lazy DB wrapper so routes can be mounted immediately.
// This avoids a Vercel/Express pitfall where dynamically mounting routes during
// a request appends them after the 404 handler, causing false "Not Found".
const lazyDb = {
  async execute(query, params = []) {
    const db = await ensureDbInitialized();
    return db.execute(query, params);
  },
  async query(query, params = []) {
    const db = await ensureDbInitialized();
    return db.query(query, params);
  },
  async getConnection() {
    const db = await ensureDbInitialized();
    return db.getConnection();
  },
  end() {
    // If not initialized yet, nothing to end.
    return dbPool?.end?.();
  },
  on(event, callback) {
    return dbPool?.on?.(event, callback);
  }
};

// Mount routes at startup for both /pajar/* and root /*
mountRoutes('/pajar', lazyDb);
mountRoutes('', lazyDb);

// 404 handler - must be after routes
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  // Upload/body size errors
  if (err instanceof multer.MulterError) {
    const maxMb = parseInt(process.env.UPLOAD_MAX_FILE_MB || '5', 10);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'Content Too Large',
        message: `Image file exceeds max size (${Number.isFinite(maxMb) ? maxMb : 5}MB)`
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        error: 'Content Too Large',
        message: 'Too many files uploaded'
      });
    }
    return res.status(400).json({
      error: 'Upload error',
      code: err.code,
      message: err.message
    });
  }

  // body-parser style error (can happen with large non-multipart payloads)
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'Content Too Large',
      message: err.message || 'Request payload too large'
    });
  }

  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Export for Vercel
module.exports = app;
