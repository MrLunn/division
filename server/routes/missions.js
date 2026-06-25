const router = require('express').Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const lootEngine = require('../engine/loot');
const combatEngine = require('../engine/combat');

// GET /api/missions — list all missions
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*,
        (SELECT COUNT(*) FROM mission_runs mr
          WHERE mr.mission_id = m.id
          AND mr.character_id = $1
          AND mr.success = true) as completions
      FROM missions m
      WHERE m.is_active = true
      ORDER BY m.min_gs ASC, m.difficulty ASC
    `, [req.character.id]);

    res.json({ missions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load missions' });
  }
});

// POST /api/missions/:id/run — run a mission
router.post('/:id/run', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Load mission
    const mResult = await db.query(`SELECT * FROM missions WHERE id = $1 AND is_active = true`, [id]);
    if (mResult.rows.length === 0) return res.status(404).json({ error: 'Mission not found' });
    const mission = mResult.rows[0];

    // Check gear score minimum
    if (req.character.gear_score < mission.min_gs) {
      return res.status(400).json({
        error: `Insufficient gear score. Required: ${mission.min_gs}, Your GS: ${req.character.gear_score}`,
      });
    }

    // Check if daily already completed today
    if (mission.is_daily) {
      const todayRun = await db.query(`
        SELECT id FROM mission_runs
        WHERE character_id = $1 AND mission_id = $2
        AND completed_at > NOW() - INTERVAL '24 hours'
        AND success = true
      `, [req.character.id, id]);
      if (todayRun.rows.length > 0) {
        return res.status(429).json({ error: 'Daily mission already completed. Resets in 24h.' });
      }
    }

    // Create mission run record
    const runResult = await db.query(`
      INSERT INTO mission_runs (character_id, mission_id) VALUES ($1, $2) RETURNING id
    `, [req.character.id, id]);
    const runId = runResult.rows[0].id;

    // Resolve combat
    const combatResult = await combatEngine.resolveMissionCombat(req.character.id, mission);

    let loot = [];
    let xpGained = 0;
    let creditsGained = 0;

    if (combatResult.success) {
      // Roll loot
      loot = await lootEngine.rollMissionLoot(mission, req.character.id);

      // XP and credit rewards
      xpGained = mission.xp_reward;
      creditsGained = mission.credit_reward;

      // Apply level-up bonus
      const newXp = req.character.xp + xpGained;
      const newLevel = Math.floor(1 + Math.sqrt(newXp / 500));
      const cappedLevel = Math.min(30, newLevel);

      await db.query(`
        UPDATE characters SET
          xp = xp + $1,
          credits = credits + $2,
          missions_done = missions_done + 1,
          level = $3
        WHERE id = $4
      `, [xpGained, creditsGained, cappedLevel, req.character.id]);

      // Recalculate gear score
      await lootEngine.recalcGearScore(req.character.id);

      // Log to activity feed
      const hasExotic = loot.find(l => l.rarity === 'exotic');
      if (hasExotic) {
        await db.query(`
          INSERT INTO activity_feed (type, actor_name, detail)
          VALUES ('exotic_drop', $1, $2)
        `, [req.character.name, `Found EXOTIC: ${hasExotic.name} in ${mission.name}`]);
      }
      await db.query(`
        INSERT INTO activity_feed (type, actor_name, detail)
        VALUES ('mission_complete', $1, $2)
      `, [req.character.name, `Completed ${mission.name} [${mission.difficulty.toUpperCase()}]`]);
    }

    // Update run record
    await db.query(`
      UPDATE mission_runs SET completed_at = NOW(), success = $1, loot_earned = $2 WHERE id = $3
    `, [combatResult.success, JSON.stringify(loot), runId]);

    res.json({
      success: combatResult.success,
      mission: { name: mission.name, difficulty: mission.difficulty },
      combatLog: combatResult.combatLog,
      loot,
      rewards: combatResult.success ? { xp: xpGained, credits: creditsGained } : null,
    });
  } catch (err) {
    console.error('Mission run error:', err);
    res.status(500).json({ error: 'Mission failed to start' });
  }
});

// GET /api/missions/history — recent mission runs
router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT mr.*, m.name as mission_name, m.difficulty, m.type
      FROM mission_runs mr
      JOIN missions m ON m.id = mr.mission_id
      WHERE mr.character_id = $1
      ORDER BY mr.started_at DESC
      LIMIT 20
    `, [req.character.id]);

    res.json({ history: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load history' });
  }
});

module.exports = router;
