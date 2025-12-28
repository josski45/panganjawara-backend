// Vercel Serverless Entry Point
// This file wraps the Express app for Vercel deployment

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

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
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Export for Vercel
module.exports = app;
