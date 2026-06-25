const router = require('express').Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/clans — list clans
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*,
        COUNT(cm.character_id) as member_count,
        ch.name as leader_name
      FROM clans c
      LEFT JOIN clan_members cm ON cm.clan_id = c.id
      LEFT JOIN characters ch ON ch.id = c.leader_id
      GROUP BY c.id, ch.name
      ORDER BY c.xp DESC
      LIMIT 50
    `);
    res.json({ clans: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load clans' });
  }
});

// GET /api/clans/mine — current player's clan
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, cm.role,
        COUNT(cm2.character_id) as member_count
      FROM clan_members cm
      JOIN clans c ON c.id = cm.clan_id
      LEFT JOIN clan_members cm2 ON cm2.clan_id = c.id
      WHERE cm.character_id = $1
      GROUP BY c.id, cm.role
    `, [req.character.id]);

    if (result.rows.length === 0) return res.json({ clan: null });

    const clan = result.rows[0];

    // Load members with online status (active in last 15 min)
    const members = await db.query(`
      SELECT ch.id, ch.name, ch.level, ch.gear_score, cm.role,
        (ch.id IN (
          SELECT character_id FROM mission_runs
          WHERE started_at > NOW() - INTERVAL '15 minutes'
        )) as is_online
      FROM clan_members cm
      JOIN characters ch ON ch.id = cm.character_id
      WHERE cm.clan_id = $1
      ORDER BY cm.role ASC, ch.gear_score DESC
    `, [clan.id]);

    // Load held bases
    const bases = await db.query(`
      SELECT id, name, zone, bonus_type, captured_at, expires_at
      FROM bases WHERE held_by_clan = $1
    `, [clan.id]);

    res.json({ clan, members: members.rows, bases: bases.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load clan' });
  }
});

// POST /api/clans — create a clan
router.post('/', requireAuth, async (req, res) => {
  const { name, tag, description } = req.body;
  if (!name || !tag) return res.status(400).json({ error: 'Clan name and tag required' });
  if (tag.length > 6) return res.status(400).json({ error: 'Tag must be 6 characters or less' });

  // Check not already in a clan
  const existing = await db.query(
    `SELECT clan_id FROM clan_members WHERE character_id = $1`, [req.character.id]
  );
  if (existing.rows.length > 0) return res.status(400).json({ error: 'Already in a clan. Leave first.' });

  // Cost to create
  const CLAN_COST = 5000;
  if (req.character.credits < CLAN_COST) {
    return res.status(400).json({ error: `Need ${CLAN_COST} Credits to found a clan` });
  }

  try {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE characters SET credits = credits - $1 WHERE id = $2`, [CLAN_COST, req.character.id]);

      const clanResult = await client.query(`
        INSERT INTO clans (name, tag, description, leader_id)
        VALUES ($1, $2, $3, $4) RETURNING *
      `, [name, tag.toUpperCase(), description || '', req.character.id]);

      const clan = clanResult.rows[0];
      await client.query(`
        INSERT INTO clan_members (clan_id, character_id, role) VALUES ($1, $2, 'leader')
      `, [clan.id, req.character.id]);

      await client.query('COMMIT');
      res.status(201).json({ clan, message: `Clan [${tag.toUpperCase()}] ${name} founded!` });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Clan name or tag already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create clan' });
  }
});

// POST /api/clans/:id/join
router.post('/:id/join', requireAuth, async (req, res) => {
  const { id } = req.params;

  const existing = await db.query(
    `SELECT clan_id FROM clan_members WHERE character_id = $1`, [req.character.id]
  );
  if (existing.rows.length > 0) return res.status(400).json({ error: 'Already in a clan' });

  try {
    const clanResult = await db.query(`SELECT * FROM clans WHERE id = $1`, [id]);
    if (clanResult.rows.length === 0) return res.status(404).json({ error: 'Clan not found' });

    const countResult = await db.query(
      `SELECT COUNT(*) as cnt FROM clan_members WHERE clan_id = $1`, [id]
    );
    if (parseInt(countResult.rows[0].cnt) >= 20) {
      return res.status(400).json({ error: 'Clan is full (max 20 members)' });
    }

    await db.query(`INSERT INTO clan_members (clan_id, character_id) VALUES ($1, $2)`, [id, req.character.id]);
    res.json({ message: `Joined clan ${clanResult.rows[0].name}!` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join clan' });
  }
});

// POST /api/clans/leave
router.post('/leave', requireAuth, async (req, res) => {
  try {
    const membership = await db.query(
      `SELECT cm.*, c.leader_id FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.character_id = $1`,
      [req.character.id]
    );
    if (membership.rows.length === 0) return res.status(400).json({ error: 'Not in a clan' });

    if (membership.rows[0].leader_id === req.character.id) {
      return res.status(400).json({ error: 'Leaders cannot leave. Transfer leadership or disband first.' });
    }

    await db.query(`DELETE FROM clan_members WHERE character_id = $1`, [req.character.id]);
    res.json({ message: 'Left clan successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave clan' });
  }
});

// POST /api/clans/bases/:baseId/attack — attack a base
router.post('/bases/:baseId/attack', requireAuth, async (req, res) => {
  const { baseId } = req.params;

  try {
    // Player must be in a clan
    const membership = await db.query(
      `SELECT cm.*, c.id as clan_id, c.name as clan_name FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.character_id = $1`,
      [req.character.id]
    );
    if (membership.rows.length === 0) return res.status(400).json({ error: 'Must be in a clan to attack bases' });

    const attackerClan = membership.rows[0];

    const baseResult = await db.query(`SELECT * FROM bases WHERE id = $1`, [baseId]);
    if (baseResult.rows.length === 0) return res.status(404).json({ error: 'Base not found' });
    const base = baseResult.rows[0];

    if (base.held_by_clan === attackerClan.clan_id) {
      return res.status(400).json({ error: 'You already control this base' });
    }

    // Check GS requirement
    if (req.character.gear_score < 300) {
      return res.status(400).json({ error: 'Need GS 300+ to participate in base assaults' });
    }

    // Resolve battle (simplified — production would be time-gated)
    const defenderBonus = base.defense_rating / 100;
    const attackerRoll = Math.random() * req.character.gear_score;
    const defenderRoll = Math.random() * (base.defense_rating * 3) * defenderBonus;

    const attackerWins = attackerRoll > defenderRoll;
    const defenderClanId = base.held_by_clan;

    if (attackerWins) {
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await db.query(`
        UPDATE bases SET held_by_clan = $1, captured_at = NOW(), expires_at = $2, defense_rating = 100
        WHERE id = $3
      `, [attackerClan.clan_id, expiry, baseId]);

      // XP and credit reward for capture
      await db.query(`UPDATE characters SET xp = xp + 3000, credits = credits + 1500 WHERE id = $1`, [req.character.id]);

      await db.query(`
        INSERT INTO activity_feed (type, actor_name, detail)
        VALUES ('base_capture', $1, $2)
      `, [req.character.name, `[${attackerClan.clan_name}] captured ${base.name}!`]);

      // Log battle
      await db.query(`
        INSERT INTO base_battles (base_id, attacker_clan, defender_clan, resolved_at, winner_clan, attacker_score, defender_score)
        VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      `, [baseId, attackerClan.clan_id, defenderClanId, attackerClan.clan_id,
           Math.floor(attackerRoll), Math.floor(defenderRoll)]);
    }

    res.json({
      attackerWins,
      base: base.name,
      attackerScore: Math.floor(attackerRoll),
      defenderScore: Math.floor(defenderRoll),
      message: attackerWins
        ? `${base.name} captured! Held for 24 hours. +3,000 XP, +1,500 Credits`
        : `Assault failed. The base held. Reinforce and try again.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Battle resolution failed' });
  }
});

// GET /api/clans/bases — all capturable bases
router.get('/bases', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.*, c.name as clan_name, c.tag as clan_tag
      FROM bases b
      LEFT JOIN clans c ON c.id = b.held_by_clan
      ORDER BY b.name
    `);
    res.json({ bases: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bases' });
  }
});

module.exports = router;
