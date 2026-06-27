/**
 * Division MMO — Main Server
 * Express + Socket.io
 */

require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const jwt       = require('jsonwebtoken');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'division-shd-secret-change-in-prod';

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Attach io to request for use in routes
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/missions',       require('./routes/missions'));
app.use('/api/inventory',      require('./routes/inventory'));
app.use('/api/clans',          require('./routes/clans'));
app.use('/api/pvp',            require('./routes/pvp'));
app.use('/api/leaderboard',    require('./routes/leaderboard'));
app.use('/api/contracts',      require('./routes/contracts'));
app.use('/api/bounties',       require('./routes/bounties'));
app.use('/api/events',         require('./routes/events'));
app.use('/api/recalibration',  require('./routes/recalibration'));

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'online', time: new Date() }));

// Serve frontend for all other routes (SPA)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============================================================
// SOCKET.IO — Real-time events
// ============================================================
const connectedAgents = new Map(); // socketId -> { characterId, name }

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`Agent connected: ${socket.id}`);

  socket.on('agent:register', ({ characterId, characterName }) => {
    connectedAgents.set(socket.id, { characterId, name: characterName });
    socket.join(`agent:${characterId}`);
    io.emit('world:agent_online', { name: characterName });
    console.log(`  → ${characterName} (${characterId}) online`);
  });

  socket.on('chat:message', ({ message, zone }) => {
    const agent = connectedAgents.get(socket.id);
    if (!agent || !message?.trim()) return;
    const sanitized = message.trim().slice(0, 200);
    io.emit('chat:message', {
      sender: agent.name,
      message: sanitized,
      zone: zone || 'global',
      time: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    const agent = connectedAgents.get(socket.id);
    if (agent) {
      io.emit('world:agent_offline', { name: agent.name });
      connectedAgents.delete(socket.id);
    }
  });
});

// ============================================================
// BROADCAST HELPERS (used by routes via req.io)
// ============================================================
function broadcastActivity(io, event) {
  io.emit('feed:activity', event);
}

function notifyAgent(io, characterId, event, data) {
  io.to(`agent:${characterId}`).emit(event, data);
}

global.broadcastActivity = broadcastActivity;
global.notifyAgent = notifyAgent;

// ============================================================
// HOURLY LEADERBOARD REFRESH
// ============================================================
setInterval(async () => {
  const db = require('./db/pool');
  try {
    await db.query(`
      INSERT INTO leaderboard_cache (type, rank, character_id, clan_id, value)
      SELECT 'gear_score', RANK() OVER (ORDER BY ch.gear_score DESC),
        ch.id, cm.clan_id, ch.gear_score
      FROM characters ch
      LEFT JOIN clan_members cm ON cm.character_id = ch.id
      WHERE ch.gear_score > 0
      ORDER BY ch.gear_score DESC
      LIMIT 100
      ON CONFLICT (type, rank) DO UPDATE
        SET character_id = EXCLUDED.character_id,
            clan_id = EXCLUDED.clan_id,
            value = EXCLUDED.value,
            updated_at = NOW()
    `);
    console.log('Leaderboard cache refreshed');
  } catch (err) {
    console.error('Leaderboard refresh failed:', err.message);
  }
}, 60 * 60 * 1000);

// ============================================================
// CACHE EVENT SCHEDULER — spawn every 45 minutes
// ============================================================
const { spawnCacheEvent } = require('./routes/events');
setInterval(() => spawnCacheEvent(io), 45 * 60 * 1000);
// Spawn one shortly after startup
setTimeout(() => spawnCacheEvent(io), 90 * 1000);

// ============================================================
// START
// ============================================================
server.listen(PORT, () => {
  console.log(`\n🔵 Division MMO Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL || 'postgresql://localhost/division_mmo'}\n`);
});

module.exports = { app, io };
