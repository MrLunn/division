/**
 * Division MMO — Admin API
 * Protected routes for game management. Requires is_admin flag on user.
 */
const router = require('express').Router();
const db     = require('../db/pool');
const bcrypt = require('bcryptjs');
const { JWT_SECRET, signToken } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ── Admin auth middleware ───────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const u = await db.query('SELECT is_admin FROM users WHERE id=$1', [userId]);
    if (!u.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });
    req.adminUserId = userId;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// ── GET /api/admin/stats — dashboard overview ───────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [players, clans, missions, feed, jailed, bounties] = await Promise.all([
      db.query(`SELECT COUNT(*) as total, AVG(gear_score)::INT as avg_gs, MAX(gear_score) as max_gs, SUM(credits)::BIGINT as total_credits FROM characters`),
      db.query(`SELECT COUNT(*) as total FROM clans WHERE is_bot=false`),
      db.query(`SELECT COUNT(*) as total FROM mission_runs WHERE success=true`),
      db.query(`SELECT COUNT(*) as total FROM activity_feed WHERE occurred_at > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT COUNT(*) as total FROM characters WHERE is_jailed=true`),
      db.query(`SELECT COUNT(*) as total FROM bounties WHERE claimed_by IS NULL AND expires_at > NOW()`),
    ]);
    res.json({
      players:       players.rows[0],
      clans:         clans.rows[0].total,
      missionsDone:  missions.rows[0].total,
      feedLast24h:   feed.rows[0].total,
      jailed:        jailed.rows[0].total,
      activeBounties:bounties.rows[0].total,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/admin/players — all players ───────────────────────────────────
router.get('/players', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id as user_id, u.username, u.email, u.is_admin, u.is_banned, u.created_at,
             c.id as char_id, c.name, c.level, c.xp, c.gear_score, c.credits,
             c.respect, c.pvp_kills, c.missions_done, c.is_jailed, c.jail_until
      FROM users u
      LEFT JOIN characters c ON c.user_id = u.id
      ORDER BY c.gear_score DESC NULLS LAST
    `);
    res.json({ players: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/admin/players/:charId — edit a player ──────────────────────
router.patch('/players/:charId', requireAdmin, async (req, res) => {
  const { level, xp, credits, gear_score, respect, is_jailed } = req.body;
  try {
    const sets = []; const vals = [req.params.charId];
    const add = (col, val) => { if (val !== undefined) { sets.push(`${col}=$${vals.length+1}`); vals.push(val); } };
    add('level', level); add('xp', xp); add('credits', credits);
    add('gear_score', gear_score); add('respect', respect); add('is_jailed', is_jailed);
    if (is_jailed === false) { sets.push('jail_until=NULL'); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await db.query(`UPDATE characters SET ${sets.join(',')} WHERE id=$1`, vals);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/admin/players/:userId/ban — ban/unban ───────────────────────
router.post('/players/:userId/ban', requireAdmin, async (req, res) => {
  const { banned } = req.body;
  await db.query('UPDATE users SET is_banned=$1 WHERE id=$2', [!!banned, req.params.userId]);
  res.json({ ok: true });
});

// ── POST /api/admin/players/:userId/promote — make admin ──────────────────
router.post('/players/:userId/promote', requireAdmin, async (req, res) => {
  await db.query('UPDATE users SET is_admin=true WHERE id=$1', [req.params.userId]);
  res.json({ ok: true });
});

// ── GET /api/admin/missions — all missions ─────────────────────────────────
router.get('/missions', requireAdmin, async (req, res) => {
  const result = await db.query('SELECT * FROM missions ORDER BY difficulty, name');
  res.json({ missions: result.rows });
});

// ── POST /api/admin/missions — create mission ──────────────────────────────
router.post('/missions', requireAdmin, async (req, res) => {
  const { name, description, type, difficulty, map_x, map_y, min_gs, xp_reward, credit_reward, loot_rolls, loot_bonus_rarity, duration_secs } = req.body;
  if (!name || !type || !difficulty) return res.status(400).json({ error: 'name, type, difficulty required' });
  try {
    const r = await db.query(`
      INSERT INTO missions (name,description,type,difficulty,map_x,map_y,min_gs,xp_reward,credit_reward,loot_rolls,loot_bonus_rarity,duration_secs)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [name, description||'', type, difficulty, map_x||0.5, map_y||0.5, min_gs||0, xp_reward||1000, credit_reward||500, loot_rolls||2, loot_bonus_rarity||null, duration_secs||60]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/admin/missions/:id — edit mission ───────────────────────────
router.patch('/missions/:id', requireAdmin, async (req, res) => {
  const fields = ['name','description','type','difficulty','map_x','map_y','min_gs','xp_reward','credit_reward','loot_rolls','loot_bonus_rarity','duration_secs'];
  const sets = []; const vals = [req.params.id];
  fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=$${vals.length+1}`); vals.push(req.body[f]); }});
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  await db.query(`UPDATE missions SET ${sets.join(',')} WHERE id=$1`, vals);
  res.json({ ok: true });
});

// ── DELETE /api/admin/missions/:id ────────────────────────────────────────
router.delete('/missions/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM missions WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── GET /api/admin/feed — activity feed ───────────────────────────────────
router.get('/feed', requireAdmin, async (req, res) => {
  const result = await db.query(`SELECT * FROM activity_feed ORDER BY occurred_at DESC LIMIT 100`);
  res.json({ feed: result.rows });
});

// ── POST /api/admin/broadcast — push a message to all players ─────────────
router.post('/broadcast', requireAdmin, async (req, res) => {
  const { message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  global.broadcastActivity(req.io, { type: type || 'intel', text: `📡 ADMIN: ${message}` });
  await db.query(`INSERT INTO activity_feed (type, actor_name, detail) VALUES ($1,'ADMIN',$2)`, [type||'intel', message]);
  res.json({ ok: true });
});

// ── POST /api/admin/cache-event — trigger a cache event now ───────────────
router.post('/cache-event', requireAdmin, async (req, res) => {
  const { spawnCacheEvent } = require('./events');
  await spawnCacheEvent(req.io);
  res.json({ ok: true, message: 'Cache event triggered' });
});

// ── POST /api/admin/arrest/:charId — manually arrest a player ─────────────
router.post('/arrest/:charId', requireAdmin, async (req, res) => {
  const { arrest } = require('./jail');
  await arrest(req.params.charId, req.io);
  res.json({ ok: true });
});

// ── POST /api/admin/release/:charId — release from custody ────────────────
router.post('/release/:charId', requireAdmin, async (req, res) => {
  await db.query('UPDATE characters SET is_jailed=false, jail_until=NULL WHERE id=$1', [req.params.charId]);
  await db.query(`UPDATE jail_events SET released_at=NOW(), released_by=$1 WHERE prisoner_id=$2 AND released_at IS NULL`, [req.adminUserId, req.params.charId]);
  global.notifyAgent(req.io, req.params.charId, 'jail:released', { by: 'Admin' });
  res.json({ ok: true });
});

// ── GET /api/admin/bounties — all active bounties ─────────────────────────
router.get('/bounties', requireAdmin, async (req, res) => {
  const r = await db.query(`
    SELECT b.*, p.name as poster_name, t.name as target_name
    FROM bounties b
    LEFT JOIN characters p ON p.id=b.poster_id
    LEFT JOIN characters t ON t.id=b.target_id
    ORDER BY b.created_at DESC LIMIT 50
  `);
  res.json({ bounties: r.rows });
});

// ── DELETE /api/admin/bounties/:id — remove a bounty ─────────────────────
router.delete('/bounties/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM bounties WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── POST /api/admin/give-credits/:charId — give credits ───────────────────
router.post('/give-credits/:charId', requireAdmin, async (req, res) => {
  const { amount } = req.body;
  await db.query('UPDATE characters SET credits=credits+$1 WHERE id=$2', [amount, req.params.charId]);
  global.notifyAgent(req.io, req.params.charId, 'bot:bounty', {
    botName: 'SHD Admin',
    amount,
    message: `📡 SHD Admin granted you ${Number(amount).toLocaleString()}¢`,
  });
  res.json({ ok: true });
});

module.exports = router;
