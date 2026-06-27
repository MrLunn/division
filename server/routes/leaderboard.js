const router = require('express').Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/leaderboard/:type
router.get('/:type', requireAuth, async (req, res) => {
  const { type } = req.params;
  const LIMIT = 50;

  try {
    let query, params;

    if (type === 'gear_score') {
      query = `
        SELECT ch.name, ch.id as character_id, ch.gear_score as value, ch.level, ch.respect,
          cl.name as clan_name, cl.tag as clan_tag,
          RANK() OVER (ORDER BY ch.gear_score DESC) as rank
        FROM characters ch
        LEFT JOIN clan_members cm ON cm.character_id = ch.id
        LEFT JOIN clans cl ON cl.id = cm.clan_id
        WHERE ch.gear_score > 0
        ORDER BY ch.gear_score DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else if (type === 'pvp_kills') {
      query = `
        SELECT ch.name, ch.id as character_id, ch.pvp_kills as value, ch.level, ch.respect,
          cl.name as clan_name, cl.tag as clan_tag,
          RANK() OVER (ORDER BY ch.pvp_kills DESC) as rank
        FROM characters ch
        LEFT JOIN clan_members cm ON cm.character_id = ch.id
        LEFT JOIN clans cl ON cl.id = cm.clan_id
        WHERE ch.pvp_kills > 0
        ORDER BY ch.pvp_kills DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else if (type === 'missions') {
      query = `
        SELECT ch.name, ch.id as character_id, ch.missions_done as value, ch.level, ch.respect,
          cl.name as clan_name, cl.tag as clan_tag,
          RANK() OVER (ORDER BY ch.missions_done DESC) as rank
        FROM characters ch
        LEFT JOIN clan_members cm ON cm.character_id = ch.id
        LEFT JOIN clans cl ON cl.id = cm.clan_id
        WHERE ch.missions_done > 0
        ORDER BY ch.missions_done DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else if (type === 'respect') {
      query = `
        SELECT ch.name, ch.id as character_id, ch.respect as value, ch.level, ch.respect,
          cl.name as clan_name, cl.tag as clan_tag,
          RANK() OVER (ORDER BY ch.respect DESC) as rank
        FROM characters ch
        LEFT JOIN clan_members cm ON cm.character_id = ch.id
        LEFT JOIN clans cl ON cl.id = cm.clan_id
        WHERE ch.respect > 0
        ORDER BY ch.respect DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else if (type === 'clans') {
      query = `
        SELECT cl.name as clan_name, cl.tag as clan_tag, cl.level,
          SUM(ch.gear_score) as value,
          COUNT(cm.character_id) as member_count,
          RANK() OVER (ORDER BY SUM(ch.gear_score) DESC) as rank
        FROM clans cl
        JOIN clan_members cm ON cm.clan_id = cl.id
        JOIN characters ch ON ch.id = cm.character_id
        GROUP BY cl.id
        ORDER BY value DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else {
      return res.status(400).json({ error: 'Invalid leaderboard type. Use: gear_score, pvp_kills, missions, clans' });
    }

    const result = await db.query(query, params);

    // Find player's own rank
    let myRank = null;
    const entry = result.rows.find(r => r.name === req.character.name);
    if (entry) {
      myRank = parseInt(entry.rank);
    } else if (type !== 'clans') {
      // Player not in top 50 — fetch their actual rank
      const rankQuery = `
        SELECT COUNT(*) + 1 as rank FROM characters ch2
        WHERE ch2.${type === 'gear_score' ? 'gear_score' : type === 'pvp_kills' ? 'pvp_kills' : 'missions_done'}
          > (SELECT ${type === 'gear_score' ? 'gear_score' : type === 'pvp_kills' ? 'pvp_kills' : 'missions_done'}
             FROM characters WHERE id = $1)
      `;
      const rankResult = await db.query(rankQuery, [req.character.id]);
      myRank = parseInt(rankResult.rows[0].rank);
    }

    res.json({
      type,
      entries: result.rows,
      myRank,
      myCharacter: req.character.name,
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
