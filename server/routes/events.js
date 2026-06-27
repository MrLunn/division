/**
 * Cache Events — server-wide timed loot cache spawns on the Oslo map
 */
const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// Oslo spawn points for cache events
const SPAWN_POINTS = [
  { x: 0.45, y: 0.38, district: 'Sentrum – Karl Johans gate'     },
  { x: 0.28, y: 0.58, district: 'Aker Brygge waterfront'         },
  { x: 0.68, y: 0.38, district: 'Grønland district'              },
  { x: 0.20, y: 0.66, district: 'Tjuvholmen gallery'             },
  { x: 0.72, y: 0.22, district: 'Grünerløkka rooftops'          },
  { x: 0.60, y: 0.62, district: 'Bjørvika opera plaza'           },
  { x: 0.18, y: 0.28, district: 'Frogner Park'                   },
  { x: 0.55, y: 0.32, district: 'Youngstorget square'            },
];

// GET /api/events/active — current active cache event if any
router.get('/active', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ce.*, c.name as claimed_by_name
      FROM cache_events ce
      LEFT JOIN characters c ON c.id = ce.claimed_by
      WHERE ce.expires_at > NOW()
      ORDER BY ce.spawned_at DESC LIMIT 1
    `);
    res.json({ event: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load event' });
  }
});

// POST /api/events/:id/claim — first agent to call this wins
router.post('/:id/claim', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    // Atomic claim — only first caller succeeds
    const result = await db.query(`
      UPDATE cache_events
      SET claimed_by=$1, claimed_at=NOW()
      WHERE id=$2 AND claimed_by IS NULL AND expires_at > NOW()
      RETURNING *
    `, [req.character.id, id]);

    if (!result.rows[0]) return res.status(409).json({ error: 'Cache already claimed or expired' });

    // Give exotic/named loot via inventory route logic
    const rarityValues = { named: 0.7, exotic: 0.3 };
    const roll = Math.random();
    const rarity = roll < 0.3 ? 'exotic' : 'named';

    // Award bonus credits and XP
    const credits = rarity === 'exotic' ? 5000 : 2000;
    const xp      = rarity === 'exotic' ? 8000 : 4000;
    await db.query('UPDATE characters SET credits=credits+$1, xp=xp+$2 WHERE id=$3',
      [credits, xp, req.character.id]);

    global.broadcastActivity(req.io, {
      type: 'cache_claimed',
      text: `⚡ CACHE EVENT: ${req.character.name} seized the ${result.rows[0].district} cache! [${rarity.toUpperCase()}]`,
    });

    // Kill the active event notification
    req.io.emit('event:cache_claimed', {
      claimedBy: req.character.name,
      district:  result.rows[0].district,
      rarity,
    });

    res.json({
      message: `You secured the ${result.rows[0].district} cache!`,
      rarity, credits, xp,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to claim event' });
  }
});

// Internal: spawn a new cache event (called from scheduler)
async function spawnCacheEvent(io) {
  try {
    // Don't spawn if one is already active
    const existing = await db.query(
      'SELECT id FROM cache_events WHERE claimed_by IS NULL AND expires_at > NOW()'
    );
    if (existing.rows.length > 0) return;

    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const rarity = Math.random() < 0.25 ? 'exotic' : 'named';

    const result = await db.query(`
      INSERT INTO cache_events (map_x, map_y, district, rarity)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [spawn.x, spawn.y, spawn.district, rarity]);

    const event = result.rows[0];
    console.log(`🎁 Cache event spawned: ${spawn.district} [${rarity}]`);

    // Broadcast to all connected agents
    io.emit('event:cache_spawned', {
      id:       event.id,
      x:        spawn.x,
      y:        spawn.y,
      district: spawn.district,
      rarity,
      expiresAt: event.expires_at,
    });

    global.broadcastActivity(io, {
      type: 'cache_spawn',
      text: `⚡ CACHE EVENT: ${rarity.toUpperCase()} loot cache spotted at ${spawn.district}! 30 minutes to extract.`,
    });
  } catch (err) {
    console.error('spawnCacheEvent error:', err.message);
  }
}

module.exports = router;
module.exports.spawnCacheEvent = spawnCacheEvent;
