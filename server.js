const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const musicRoutes = require('./routes/music');

const app = express();
const port = process.env.PORT || 5000;
const publicDir = path.join(__dirname, 'public');
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5000,http://127.0.0.1:5000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace_with_a_secure_random_value') {
  console.warn('⚠️ JWT_SECRET is missing or left as a placeholder. Generating a temporary secret for this session.');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
}

// ── Middleware ──────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── MongoDB Connection ─────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulse-music-hub';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  autoIndex: true
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('⚠️  Server will continue without database connectivity.');
  });

// ── API Routes ─────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', musicRoutes);



// ── Static Files ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  // Prevent stale caching of HTML during development
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(publicDir));

// ── SPA Fallback ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Only serve the SPA shell for non-file paths; missing files should 404
  if (/\.[a-zA-Z0-9]{1,5}$/.test(req.path) || req.path.includes('..')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Server Start ───────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`🚀 Pulse Music Hub server running at http://localhost:${port}`);
  console.log(`📡 API available at http://localhost:${port}/api`);
});

