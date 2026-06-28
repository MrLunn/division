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
        SELECT cl.id as clan_id, cl.name as clan_name, cl.tag as clan_tag, cl.level, cl.is_bot,
          COALESCE(SUM(ch.gear_score), cl.bot_gs * 5) as value,
          COUNT(cm.character_id) as member_count,
          RANK() OVER (ORDER BY COALESCE(SUM(ch.gear_score), cl.bot_gs * 5) DESC) as rank
        FROM clans cl
        LEFT JOIN clan_members cm ON cm.clan_id = cl.id
        LEFT JOIN characters ch ON ch.id = cm.character_id
        GROUP BY cl.id
        ORDER BY value DESC
        LIMIT $1
      `;
      params = [LIMIT];
    } else {
      return res.status(400).json({ error: 'Invalid leaderboard type. Use: gear_score, pvp_kills, missions, clans' });
    }

    const result = await db.query(query, params);

    // Inject bot entries into player leaderboards to fill them out
    const { BOT_NAMES } = require('../engine/bots');
    const BOT_ENTRIES = [
      { name:'Ghost_Larsen',  level:22, gear_score:380, respect:1240, pvp_kills:47, missions_done:89,  value:380, rank:null, clan_tag:'BB'  },
      { name:'NightOwl_Berg', level:18, gear_score:310, respect:890,  pvp_kills:31, missions_done:67,  value:310, rank:null, clan_tag:'BG'  },
      { name:'IronFjord',     level:25, gear_score:440, respect:1580, pvp_kills:63, missions_done:112, value:440, rank:null, clan_tag:'CMC' },
      { name:'ShadowKong',    level:15, gear_score:260, respect:540,  pvp_kills:19, missions_done:44,  value:260, rank:null, clan_tag:'313' },
      { name:'Viper_Oslo',    level:28, gear_score:475, respect:2100, pvp_kills:88, missions_done:144, value:475, rank:null, clan_tag:'CMC' },
      { name:'Arctic_Fox',    level:12, gear_score:220, respect:380,  pvp_kills:12, missions_done:31,  value:220, rank:null, clan_tag:'YG'  },
      { name:'Rogue_Hansen',  level:20, gear_score:350, respect:970,  pvp_kills:41, missions_done:78,  value:350, rank:null, clan_tag:'BDN' },
      { name:'NordAgent',     level:27, gear_score:465, respect:1890, pvp_kills:75, missions_done:130, value:465, rank:null, clan_tag:'BB'  },
      { name:'TacticalHans',  level:9,  gear_score:175, respect:210,  pvp_kills:7,  missions_done:18,  value:175, rank:null, clan_tag:'313' },
      { name:'Storm_Eriksen', level:16, gear_score:275, respect:620,  pvp_kills:24, missions_done:52,  value:275, rank:null, clan_tag:'BDN' },
      { name:'Phantom_Vik',   level:24, gear_score:420, respect:1340, pvp_kills:55, missions_done:101, value:420, rank:null, clan_tag:'BG'  },
      { name:'SHD_Wraith',    level:30, gear_score:498, respect:2640, pvp_kills:102,missions_done:167, value:498, rank:null, clan_tag:'BB'  },
    ].map(b => ({ ...b, is_bot: true }));

    let entries = result.rows;
    if (type !== 'clans') {
      // Merge bots with real players, re-rank by the right field
      const field = type === 'gear_score' ? 'gear_score' : type === 'pvp_kills' ? 'pvp_kills' : type === 'respect' ? 'respect' : 'missions_done';
      const combined = [...entries, ...BOT_ENTRIES].sort((a, b) => (b[field] || b.value || 0) - (a[field] || a.value || 0));
      combined.forEach((e, i) => { e.rank = i + 1; e.value = e[field] || e.value; });
      entries = combined.slice(0, 50);
    }

    // Find player's own rank
    let myRank = null;
    const myEntry = entries.find(r => r.name === req.character.name);
    if (myEntry) {
      myRank = parseInt(myEntry.rank);
    } else if (type !== 'clans') {
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
      entries,
      myRank,
      myCharacter: req.character.name,
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
