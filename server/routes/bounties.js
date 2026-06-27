/**
 * Bounty Board — players post credits on targets, anyone can claim
 */
const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/bounties — active bounties
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.id, b.reward, b.reason, b.created_at, b.expires_at,
             p.name as poster_name,
             t.name as target_name, t.id as target_id,
             t.gear_score as target_gs, t.level as target_level
      FROM bounties b
      JOIN characters p ON p.id = b.poster_id
      JOIN characters t ON t.id = b.target_id
      WHERE b.claimed_by IS NULL AND b.expires_at > NOW()
      ORDER BY b.reward DESC
      LIMIT 20
    `);
    res.json({ bounties: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bounties' });
  }
});

// POST /api/bounties — post a bounty
router.post('/', requireAuth, async (req, res) => {
  const { targetId, reward, reason } = req.body;
  if (!targetId || !reward || reward < 500)
    return res.status(400).json({ error: 'Minimum bounty is 500 credits' });

  try {
    // Check target exists
    const target = await db.query('SELECT id, name FROM characters WHERE id=$1', [targetId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Target agent not found' });
    if (targetId === req.character.id) return res.status(400).json({ error: 'You cannot bounty yourself' });

    // Check funds
    const me = await db.query('SELECT credits FROM characters WHERE id=$1', [req.character.id]);
    if (me.rows[0].credits < reward)
      return res.status(400).json({ error: 'Insufficient credits' });

    await db.query('UPDATE characters SET credits=credits-$1 WHERE id=$2', [reward, req.character.id]);
    const bounty = await db.query(`
      INSERT INTO bounties (poster_id, target_id, reward, reason)
      VALUES ($1,$2,$3,$4) RETURNING id
    `, [req.character.id, targetId, reward, reason?.slice(0,120) || null]);

    // Notify the target via socket
    global.notifyAgent(req.io, targetId, 'bounty:placed', {
      reward,
      poster: req.character.name,
      reason: reason || null,
    });

    // Broadcast to feed
    global.broadcastActivity(req.io, {
      type: 'bounty',
      text: `☠ BOUNTY: ${reward.toLocaleString()}¢ placed on ${target.rows[0].name} by ${req.character.name}`,
    });

    res.status(201).json({ message: `Bounty posted on ${target.rows[0].name}`, id: bounty.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post bounty' });
  }
});

// POST /api/bounties/:id/claim — claim after killing target in PvP
router.post('/:id/claim', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const bounty = await db.query(`
      SELECT b.*, t.name as target_name, p.name as poster_name
      FROM bounties b
      JOIN characters t ON t.id = b.target_id
      JOIN characters p ON p.id = b.poster_id
      WHERE b.id=$1 AND b.claimed_by IS NULL AND b.expires_at > NOW()
    `, [id]);

    if (!bounty.rows[0]) return res.status(404).json({ error: 'Bounty not found or already claimed' });
    const b = bounty.rows[0];

    // Pay out
    await db.query('UPDATE bounties SET claimed_by=$1, claimed_at=NOW() WHERE id=$2', [req.character.id, id]);
    await db.query('UPDATE characters SET credits=credits+$1 WHERE id=$2', [b.reward, req.character.id]);

    global.broadcastActivity(req.io, {
      type: 'bounty_claimed',
      text: `🎯 BOUNTY CLAIMED: ${req.character.name} eliminated ${b.target_name} for ${b.reward.toLocaleString()}¢`,
    });

    res.json({ message: `Bounty claimed! +${b.reward.toLocaleString()} credits`, reward: b.reward });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim bounty' });
  }
});

module.exports = router;
