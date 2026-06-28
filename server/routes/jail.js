/**
 * Jail System — failed heroic missions can arrest your agent.
 * Others can break you out for a bounty reward.
 */
const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const JAIL_DURATION_MINS = 30;
const DEFAULT_BOUNTY     = 500;

// GET /api/jail — current jail roster (real + bot prisoners)
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

    // Auto-release expired
    await db.query(`UPDATE characters SET is_jailed=false, jail_until=NULL WHERE is_jailed=true AND jail_until <= NOW()`);
    await db.query(`UPDATE jail_events SET released_at=NOW(), auto_release=true WHERE released_at IS NULL AND prisoner_id IN (SELECT id FROM characters WHERE is_jailed=false)`);

    // Inject bot prisoners so there's always activity
    const BOT_PRISONERS = [
      { id:'bot-1', prisoner_name:'Ghost_Larsen',  prisoner_id:'bot-ghost',  level:22, gear_score:280, jailbreak_bounty:1200, is_bot:true, created_at: new Date(Date.now() - 8*60000).toISOString() },
      { id:'bot-2', prisoner_name:'NordAgent',      prisoner_id:'bot-nord',   level:18, gear_score:320, jailbreak_bounty:800,  is_bot:true, created_at: new Date(Date.now() - 3*60000).toISOString() },
      { id:'bot-3', prisoner_name:'Reaper_Knudsen', prisoner_id:'bot-reaper', level:14, gear_score:210, jailbreak_bounty:500,  is_bot:true, created_at: new Date(Date.now() - 14*60000).toISOString() },
    ];

    // Only show bots not already bailed by this player (track in session — simple approach)
    const prisoners = [...result.rows, ...BOT_PRISONERS];

    res.json({ prisoners });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load jail' });
  }
});

// POST /api/jail/:eventId/break — break a prisoner out (real or bot)
router.post('/:eventId/break', requireAuth, async (req, res) => {
  const { eventId } = req.params;

  // Handle bot prisoners
  if (eventId.startsWith('bot-')) {
    const BOT_REWARDS = { 'bot-1': 1200, 'bot-2': 800, 'bot-3': 500 };
    const BOT_NAMES_MAP = { 'bot-1':'Ghost_Larsen', 'bot-2':'NordAgent', 'bot-3':'Reaper_Knudsen' };
    const reward = BOT_REWARDS[eventId];
    const name   = BOT_NAMES_MAP[eventId];
    if (!reward) return res.status(404).json({ error:'Bot prisoner not found' });

    await db.query('UPDATE characters SET credits=credits+$1, respect=respect+100 WHERE id=$2',
      [reward, req.character.id]);

    global.broadcastActivity(req.io, {
      type: 'jailbreak',
      text: `🔓 ${req.character.name} broke ${name} out of custody — collected ${reward.toLocaleString()}¢`,
    });

    const { tickContract } = require('./contracts');
    await tickContract(req.character.id, 'jailbreak', 1);

    return res.json({
      message: `${name} is free! +${reward.toLocaleString()} ¢ · +100 Respect`,
      reward,
    });
  }

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
