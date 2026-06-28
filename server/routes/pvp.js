const router = require('express').Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const combatEngine = require('../engine/combat');
const { simulatePvpVsBot } = require('../engine/bots');

const DZ_ZONES = ['DZ-SOUTH — Bjørvika & Gamlebyen', 'DZ-CENTRAL — Grønland & Tøyen', 'DZ-NORTH — Grünerløkka & Storo'];

// GET /api/pvp/zones — active dark zone state
router.get('/zones', requireAuth, async (req, res) => {
  try {
    // Count recent active players per zone (mission_runs as proxy)
    const activity = await db.query(`
      SELECT zone, COUNT(*) as agent_count,
        SUM(CASE WHEN c.is_rogue THEN 1 ELSE 0 END) as rogue_count
      FROM pvp_events pe
      JOIN characters c ON c.id = pe.attacker_id
      WHERE pe.occurred_at > NOW() - INTERVAL '1 hour'
      GROUP BY zone
    `);

    const zones = DZ_ZONES.map(zoneName => {
      const data = activity.rows.find(r => r.zone === zoneName);
      return {
        name: zoneName,
        agentCount: data ? parseInt(data.agent_count) : Math.floor(Math.random() * 8),
        rogueCount: data ? parseInt(data.rogue_count) : 0,
        contamination: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
      };
    });

    // Add Occupied zones for clan
    const occupiedBases = await db.query(`
      SELECT b.name as base_name, b.zone, c.name as clan_name, c.tag, b.expires_at
      FROM bases b JOIN clans c ON c.id = b.held_by_clan
      WHERE b.held_by_clan IS NOT NULL
    `);

    res.json({ zones, occupiedBases: occupiedBases.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load zone data' });
  }
});

// POST /api/pvp/attack/:targetId — initiate PvP combat
router.post('/attack/:targetId', requireAuth, async (req, res) => {
  const { targetId } = req.params;
  const { zone } = req.body;

  if (!zone) return res.status(400).json({ error: 'Zone required' });
  if (targetId === req.character.id) return res.status(400).json({ error: 'Cannot attack yourself' });

  // Check target exists
  const targetResult = await db.query(`SELECT * FROM characters WHERE id = $1`, [targetId]);
  if (targetResult.rows.length === 0) return res.status(404).json({ error: 'Target agent not found' });
  const target = targetResult.rows[0];

  // GS check — can't attack players with less than 60% of your GS (griefing protection)
  if (target.gear_score < req.character.gear_score * 0.6) {
    return res.status(400).json({ error: 'Target agent is too low-level. Honor the code.' });
  }

  try {
    // Going rogue (attacking non-rogue agents)
    if (!target.is_rogue) {
      await combatEngine.goRogue(req.character.id);
    }

    const result = await combatEngine.resolvePvp(req.character.id, targetId, zone);

    // Push to activity feed
    const winnerName = result.attackerWins ? req.character.name : target.name;
    const loserName = result.attackerWins ? target.name : req.character.name;
    await db.query(`
      INSERT INTO activity_feed (type, actor_name, target_name, detail, is_rogue)
      VALUES ('pvp_kill', $1, $2, $3, $4)
    `, [winnerName, loserName, `in ${zone}`, !target.is_rogue]);

    res.json({
      ...result,
      yourName: req.character.name,
      targetName: target.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PvP encounter failed' });
  }
});

// GET /api/pvp/feed — global activity feed
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM activity_feed
      ORDER BY occurred_at DESC
      LIMIT 30
    `);
    res.json({ feed: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

// GET /api/pvp/stats — personal PvP stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(CASE WHEN attacker_id = $1 AND attacker_won = true THEN 1 END) as kills_as_attacker,
        COUNT(CASE WHEN defender_id = $1 AND attacker_won = false THEN 1 END) as kills_as_defender,
        COUNT(CASE WHEN attacker_id = $1 AND attacker_won = false THEN 1 END) as deaths_as_attacker,
        COUNT(CASE WHEN defender_id = $1 AND attacker_won = true THEN 1 END) as deaths_as_defender,
        COUNT(DISTINCT zone) as zones_entered
      FROM pvp_events
      WHERE attacker_id = $1 OR defender_id = $1
    `, [req.character.id]);

    const s = result.rows[0];
    const kills = parseInt(s.kills_as_attacker) + parseInt(s.kills_as_defender);
    const deaths = parseInt(s.deaths_as_attacker) + parseInt(s.deaths_as_defender);

    res.json({
      kills,
      deaths,
      kd: deaths > 0 ? (kills / deaths).toFixed(2) : kills.toString(),
      zonesEntered: parseInt(s.zones_entered),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load PvP stats' });
  }
});

// POST /api/pvp/rogue/clear — pay bounty to clear rogue
router.post('/rogue/clear', requireAuth, async (req, res) => {
  if (!req.character.is_rogue) {
    return res.status(400).json({ error: 'You are not rogue' });
  }
  const BOUNTY_COST = 2000;
  if (req.character.credits < BOUNTY_COST) {
    return res.status(400).json({ error: `Need ${BOUNTY_COST} Credits to pay bounty` });
  }

  try {
    await db.query(`UPDATE characters SET credits = credits - $1 WHERE id = $2`, [BOUNTY_COST, req.character.id]);
    await combatEngine.clearRogue(req.character.id);
    res.json({ message: 'Bounty paid. Rogue status cleared.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear rogue status' });
  }
});

// POST /api/pvp/attack-bot — fight a bot when no real players available
router.post('/attack-bot', requireAuth, async (req, res) => {
  try {
    const result = simulatePvpVsBot(req.character.gear_score, req.character.level);

    if (result.playerWins) {
      await db.query(`
        UPDATE characters SET
          credits  = credits + $1,
          xp       = xp + $2,
          pvp_kills = pvp_kills + 1
        WHERE id = $3
      `, [result.credits, result.xp, req.character.id]);

      // Log to feed
      global.broadcastActivity(req.io, {
        type: 'pvp',
        text: `☠ ${req.character.name} eliminated ${result.bot.name} [BOT GS${result.bot.gs}] in the Dark Zone`,
      });

      // Check if any bounty existed on this bot (rare flavour)
    } else {
      await db.query(`
        UPDATE characters SET xp = xp + $1 WHERE id = $2
      `, [result.xp, req.character.id]);
    }

    res.json({
      ...result,
      yourName: req.character.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bot encounter failed' });
  }
});

// POST /api/pvp/attack-player/:targetId — attack player directly from leaderboard
router.post('/attack-player/:targetId', requireAuth, async (req, res) => {
  const { targetId } = req.params;
  if (targetId === req.character.id) return res.status(400).json({ error:'Cannot attack yourself' });

  const targetResult = await db.query('SELECT * FROM characters WHERE id=$1',[targetId]);
  if (!targetResult.rows[0]) return res.status(404).json({ error:'Agent not found' });
  const target = targetResult.rows[0];

  // GS check — can't punch too far down
  if (target.gear_score < req.character.gear_score * 0.5)
    return res.status(400).json({ error:'Target GS too low — honour the code' });

  try {
    const { combineStats } = require('../engine/combat');
    const myGs  = req.character.gear_score || 100;
    const oppGs = target.gear_score || 100;
    const gsDelta = myGs - oppGs;
    const winChance = Math.min(0.90, Math.max(0.10, 0.5 + (gsDelta / 200)));
    const iWin = Math.random() < winChance;

    const xp      = iWin ? 800  : 150;
    const credits = iWin ? Math.floor(300 + gsDelta * 2) : 0;
    const respect = iWin ? 30 : 5;

    if (iWin) {
      await db.query('UPDATE characters SET xp=xp+$1,credits=credits+$2,pvp_kills=pvp_kills+1,respect=respect+$3 WHERE id=$4',
        [xp, credits, respect, req.character.id]);
      await db.query('UPDATE characters SET pvp_deaths=pvp_deaths+1 WHERE id=$1',[targetId]);
    } else {
      await db.query('UPDATE characters SET xp=xp+$1,pvp_deaths=pvp_deaths+1 WHERE id=$2',[xp, req.character.id]);
      await db.query('UPDATE characters SET pvp_kills=pvp_kills+1 WHERE id=$1',[targetId]);
    }

    global.broadcastActivity(req.io, {
      type:'pvp',
      text:`☠ ${iWin ? req.character.name : target.name} eliminated ${iWin ? target.name : req.character.name} [LEADERBOARD PVP]`,
    });
    global.notifyAgent(req.io, targetId, 'pvp:attacked', { by: req.character.name, iWon: !iWin });

    res.json({ playerWins: iWin, targetName: target.name, targetGs: oppGs, xp, credits, respect });
  } catch(err) { console.error(err); res.status(500).json({ error:'PvP failed' }); }
});

// POST /api/pvp/attack-clan/:clanId — raid a clan (bot or real)
router.post('/attack-clan/:clanId', requireAuth, async (req, res) => {
  const clan = await db.query('SELECT * FROM clans WHERE id=$1',[req.params.clanId]);
  if (!clan.rows[0]) return res.status(404).json({ error:'Clan not found' });
  const c = clan.rows[0];

  const myGs = req.character.gear_score || 100;
  const defGs = c.is_bot ? c.bot_gs : 200; // real clan uses avg GS placeholder
  const gsDelta = myGs - defGs;
  const winChance = Math.min(0.88, Math.max(0.12, 0.5 + (gsDelta / 300)));
  const iWin = Math.random() < winChance;

  const creditsLooted = iWin ? Math.min(Math.floor(c.credits * 0.05), 5000) : 0;
  const xp      = iWin ? 2000 : 400;
  const respect = iWin ? 60   : 10;

  if (iWin && creditsLooted > 0) {
    await db.query('UPDATE clans SET credits=GREATEST(0,credits-$1) WHERE id=$2',[creditsLooted, c.id]);
    await db.query('UPDATE characters SET xp=xp+$1,credits=credits+$2,respect=respect+$3,pvp_kills=pvp_kills+1 WHERE id=$4',
      [xp, creditsLooted, respect, req.character.id]);
  } else {
    await db.query('UPDATE characters SET xp=xp+$1,respect=respect+$2 WHERE id=$3',[xp, respect, req.character.id]);
  }

  await db.query(
    'INSERT INTO clan_attacks (attacker_clan,defender_clan,attacker_won,credits_looted,xp_gained) SELECT cm.clan_id,$1,$2,$3,$4 FROM clan_members cm WHERE cm.character_id=$5 LIMIT 1',
    [c.id, iWin, creditsLooted, xp, req.character.id]
  ).catch(() => {}); // ignore if not in a clan

  global.broadcastActivity(req.io, {
    type: iWin ? 'clan_raid_win' : 'clan_raid_loss',
    text: iWin
      ? `⚔ ${req.character.name} raided ${c.name} — looted ${creditsLooted.toLocaleString()}¢`
      : `⚔ ${req.character.name} attacked ${c.name} and was repelled`,
  });

  res.json({
    playerWins: iWin, clanName: c.name, clanGs: defGs,
    creditsLooted, xp, respect,
    log: [
      `CLAN RAID — ${req.character.name} vs ${c.name} [${c.tag}]`,
      `Your GS: ${myGs} vs Clan avg GS: ${defGs}`,
      iWin ? `Raid successful — looted ${creditsLooted.toLocaleString()}¢ from their treasury` : `Raid failed — ${c.name} held their ground`,
    ],
  });
});

module.exports = router;
