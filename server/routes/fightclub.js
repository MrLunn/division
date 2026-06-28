const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { simulatePvpVsBot } = require('../engine/bots');

const ENTRY_FEE = 1000;

function getWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return { week, year: now.getFullYear() };
}

// GET /api/fightclub — current bracket standings
router.get('/', requireAuth, async (req, res) => {
  try {
    const { week, year } = getWeek();
    const bracket = await db.query(`
      SELECT fc.*, c.name, c.gear_score, c.level,
        (fc.entrant_id = $1) as is_me
      FROM fight_club fc
      JOIN characters c ON c.id=fc.entrant_id
      WHERE fc.week=$2 AND fc.year=$3
      ORDER BY fc.wins DESC, fc.losses ASC
    `, [req.character.id, week, year]);

    const myEntry = bracket.rows.find(r => r.is_me);
    const realPrizePool = bracket.rows.length * ENTRY_FEE;

    // Always inject bot opponents so bracket is never empty
    const BOT_ENTRANTS = [
      { entrant_id:'bot-fc-1', name:'Ghost_Larsen',  gear_score:280, level:22, wins:3, losses:1, is_bot:true },
      { entrant_id:'bot-fc-2', name:'IronFjord',      gear_score:440, level:25, wins:5, losses:0, is_bot:true },
      { entrant_id:'bot-fc-3', name:'Viper_Oslo',     gear_score:195, level:14, wins:1, losses:2, is_bot:true },
      { entrant_id:'bot-fc-4', name:'NordAgent',      gear_score:320, level:18, wins:4, losses:1, is_bot:true },
      { entrant_id:'bot-fc-5', name:'Arctic_Fox',     gear_score:175, level:10, wins:0, losses:3, is_bot:true },
    ];

    const allEntrants = [...bracket.rows, ...BOT_ENTRANTS]
      .sort((a,b) => b.wins - a.wins || a.losses - b.losses);

    const prizePool = (allEntrants.length) * ENTRY_FEE;

    res.json({ bracket: allEntrants, myEntry: myEntry || null, prizePool, week, year, entryFee: ENTRY_FEE });
  } catch(err) { res.status(500).json({ error:'Failed to load Fight Club' }); }
});

// POST /api/fightclub/enter — pay to enter this week
router.post('/enter', requireAuth, async (req, res) => {
  const { week, year } = getWeek();
  const me = await db.query('SELECT credits FROM characters WHERE id=$1',[req.character.id]);
  if (me.rows[0].credits < ENTRY_FEE)
    return res.status(400).json({ error:`Entry fee is ${ENTRY_FEE.toLocaleString()}¢` });

  const existing = await db.query(
    'SELECT id FROM fight_club WHERE entrant_id=$1 AND week=$2 AND year=$3',
    [req.character.id, week, year]
  );
  if (existing.rows[0]) return res.status(400).json({ error:'Already entered this week' });

  await db.query('UPDATE characters SET credits=credits-$1 WHERE id=$2',[ENTRY_FEE, req.character.id]);
  await db.query(
    'INSERT INTO fight_club (week,year,entrant_id,entry_fee) VALUES ($1,$2,$3,$4)',
    [week, year, req.character.id, ENTRY_FEE]
  );

  global.broadcastActivity(req.io, { type:'fightclub', text:`🥊 ${req.character.name} entered the Fight Club bracket` });
  res.json({ message:`Entered Fight Club! Entry fee: ${ENTRY_FEE.toLocaleString()}¢` });
});

// POST /api/fightclub/fight/:entrantId — fight another bracket member (real or bot)
router.post('/fight/:entrantId', requireAuth, async (req, res) => {
  const { week, year } = getWeek();
  const isBot = req.params.entrantId.startsWith('bot-fc-');

  const myEntry = await db.query(
    'SELECT * FROM fight_club WHERE entrant_id=$1 AND week=$2 AND year=$3 AND NOT eliminated',
    [req.character.id, week, year]
  );
  if (!myEntry.rows[0]) return res.status(400).json({ error:'Enter the bracket first' });
  if (req.params.entrantId === req.character.id) return res.status(400).json({ error:'Cannot fight yourself' });

  const BOT_STATS = {
    'bot-fc-1':{ name:'Ghost_Larsen',  gear_score:280 },
    'bot-fc-2':{ name:'IronFjord',     gear_score:440 },
    'bot-fc-3':{ name:'Viper_Oslo',    gear_score:195 },
    'bot-fc-4':{ name:'NordAgent',     gear_score:320 },
    'bot-fc-5':{ name:'Arctic_Fox',    gear_score:175 },
  };

  let targetName, oppGs;
  if (isBot) {
    const bot = BOT_STATS[req.params.entrantId];
    if (!bot) return res.status(404).json({ error:'Bot not found' });
    targetName = bot.name; oppGs = bot.gear_score;
  } else {
    const te = await db.query(
      'SELECT fc.*, c.name, c.gear_score FROM fight_club fc JOIN characters c ON c.id=fc.entrant_id WHERE fc.entrant_id=$1 AND fc.week=$2 AND fc.year=$3',
      [req.params.entrantId, week, year]
    );
    if (!te.rows[0]) return res.status(404).json({ error:'Opponent not in bracket' });
    targetName = te.rows[0].name; oppGs = te.rows[0].gear_score;
  }

  const myGs = req.character.gear_score;
  const gsDelta = myGs - oppGs;
  const iWin = Math.random() < Math.min(0.90, Math.max(0.10, 0.5 + (gsDelta / 200)));

  await db.query('UPDATE fight_club SET wins=wins+$1,losses=losses+$2 WHERE entrant_id=$3 AND week=$4 AND year=$5',
    [iWin?1:0, iWin?0:1, req.character.id, week, year]);
  if (!isBot) {
    await db.query('UPDATE fight_club SET wins=wins+$1,losses=losses+$2 WHERE entrant_id=$3 AND week=$4 AND year=$5',
      [iWin?0:1, iWin?1:0, req.params.entrantId, week, year]);
  }

  const xp = iWin ? 1500 : 300;
  const respect = iWin ? 40 : 5;
  await db.query('UPDATE characters SET xp=xp+$1,respect=respect+$2,pvp_kills=pvp_kills+$3 WHERE id=$4',
    [xp, respect, iWin?1:0, req.character.id]);

  global.broadcastActivity(req.io, {
    type:'fightclub',
    text:`🥊 FIGHT CLUB: ${iWin?req.character.name:targetName} defeated ${iWin?targetName:req.character.name}`,
  });

  res.json({
    playerWins:iWin, opponentName:targetName, opponentGs:oppGs, xp, respect,
    log:[
      `FIGHT CLUB — ${req.character.name} (GS${myGs}) vs ${targetName} (GS${oppGs})`,
      `GS differential: ${gsDelta>0?'+':''}${gsDelta}`,
      iWin ? `${req.character.name} wins by KO!` : `${targetName} takes the round.`,
    ],
  });
});

module.exports = router;
