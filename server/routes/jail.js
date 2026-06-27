/**
 * Jail System — failed heroic missions can arrest your agent.
 * Others can break you out for a bounty reward.
 */
const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const JAIL_DURATION_MINS = 30;
const DEFAULT_BOUNTY     = 500;

// GET /api/jail — current jail roster
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT je.id, je.jailbreak_bounty, je.created_at,
             c.name as prisoner_name, c.id as prisoner_id,
             c.level, c.gear_score,
             ch.name as released_by_name
      FROM jail_events je
      JOIN characters c ON c.id = je.prisoner_id
      LEFT JOIN characters ch ON ch.id = je.released_by
      WHERE je.released_at IS NULL
        AND c.jail_until > NOW()
      ORDER BY je.jailbreak_bounty DESC
    `);

    // Also auto-release anyone whose timer has expired
    await db.query(`
      UPDATE characters SET is_jailed=false, jail_until=NULL
      WHERE is_jailed=true AND jail_until <= NOW()
    `);
    await db.query(`
      UPDATE jail_events SET released_at=NOW(), auto_release=true
      WHERE released_at IS NULL
        AND prisoner_id IN (
          SELECT id FROM characters WHERE is_jailed=false
        )
    `);

    res.json({ prisoners: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load jail' });
  }
});

// POST /api/jail/:eventId/break — break a prisoner out
router.post('/:eventId/break', requireAuth, async (req, res) => {
  const { eventId } = req.params;
  try {
    // Fetch the event
    const ev = await db.query(`
      SELECT je.*, c.name as prisoner_name, c.jail_until
      FROM jail_events je
      JOIN characters c ON c.id = je.prisoner_id
      WHERE je.id=$1 AND je.released_at IS NULL AND c.jail_until > NOW()
    `, [eventId]);

    if (!ev.rows[0]) return res.status(404).json({ error: 'No prisoner found — may have already been released' });
    const jail = ev.rows[0];

    if (jail.prisoner_id === req.character.id)
      return res.status(400).json({ error: "You can't break yourself out" });

    // Award bounty and release
    await db.query('UPDATE characters SET is_jailed=false, jail_until=NULL WHERE id=$1', [jail.prisoner_id]);
    await db.query('UPDATE jail_events SET released_at=NOW(), released_by=$1 WHERE id=$2', [req.character.id, eventId]);
    await db.query('UPDATE characters SET credits=credits+$1, respect=respect+100 WHERE id=$2',
      [jail.jailbreak_bounty, req.character.id]);

    // Notify the prisoner
    global.notifyAgent(req.io, jail.prisoner_id, 'jail:released', {
      by: req.character.name,
    });

    // Feed
    global.broadcastActivity(req.io, {
      type: 'jailbreak',
      text: `🔓 ${req.character.name} broke ${jail.prisoner_name} out of custody — collected ${jail.jailbreak_bounty.toLocaleString()}¢`,
    });

    // Tick contracts
    const { tickContract } = require('./contracts');
    await tickContract(req.character.id, 'jailbreak', 1);

    res.json({
      message: `${jail.prisoner_name} is free! +${jail.jailbreak_bounty.toLocaleString()} ¢ · +100 Respect`,
      reward: jail.jailbreak_bounty,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Jailbreak failed' });
  }
});

// POST /api/jail/:eventId/bounty — raise the jailbreak bounty
router.post('/:eventId/bounty', requireAuth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum top-up is 100¢' });

  const ev = await db.query(`SELECT je.*, c.jail_until FROM jail_events je JOIN characters c ON c.id=je.prisoner_id WHERE je.id=$1 AND je.released_at IS NULL AND c.jail_until > NOW()`, [req.params.eventId]);
  if (!ev.rows[0]) return res.status(404).json({ error: 'Jail event not found or already released' });
  if (ev.rows[0].prisoner_id !== req.character.id) return res.status(403).json({ error: 'Only the prisoner can raise their own bounty' });

  const me = await db.query('SELECT credits FROM characters WHERE id=$1', [req.character.id]);
  if (me.rows[0].credits < amount) return res.status(400).json({ error: 'Not enough credits' });

  await db.query('UPDATE characters SET credits=credits-$1 WHERE id=$2', [amount, req.character.id]);
  await db.query('UPDATE jail_events SET jailbreak_bounty=jailbreak_bounty+$1 WHERE id=$2', [amount, req.params.eventId]);

  res.json({ message: `Jailbreak bounty raised by ${amount}¢` });
});

// Internal: arrest a character (called from missions on failure)
async function arrest(characterId, io) {
  try {
    const jailUntil = new Date(Date.now() + JAIL_DURATION_MINS * 60 * 1000);
    await db.query(`UPDATE characters SET is_jailed=true, jail_until=$1 WHERE id=$2`, [jailUntil, characterId]);

    const ev = await db.query(`
      INSERT INTO jail_events (prisoner_id, jailbreak_bounty) VALUES ($1, $2) RETURNING id
    `, [characterId, DEFAULT_BOUNTY]);

    const char = await db.query('SELECT name FROM characters WHERE id=$1', [characterId]);

    // Notify the arrested player
    global.notifyAgent(io, characterId, 'jail:arrested', {
      minutes: JAIL_DURATION_MINS,
      eventId: ev.rows[0].id,
    });

    // Broadcast to feed
    global.broadcastActivity(io, {
      type: 'arrest',
      text: `🚔 ${char.rows[0].name} was arrested after a failed operation — ${JAIL_DURATION_MINS} min in custody. Jailbreak bounty: ${DEFAULT_BOUNTY}¢`,
    });

    return ev.rows[0].id;
  } catch (err) {
    console.error('arrest error:', err.message);
  }
}

module.exports = router;
module.exports.arrest = arrest;
