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
    const prizePool = bracket.rows.length * ENTRY_FEE;

    res.json({ bracket: bracket.rows, myEntry: myEntry || null, prizePool, week, year, entryFee: ENTRY_FEE });
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

// POST /api/fightclub/fight/:entrantId — fight another bracket member
router.post('/fight/:entrantId', requireAuth, async (req, res) => {
  const { week, year } = getWeek();

  const myEntry = await db.query(
    'SELECT * FROM fight_club WHERE entrant_id=$1 AND week=$2 AND year=$3 AND NOT eliminated',
    [req.character.id, week, year]
  );
  if (!myEntry.rows[0]) return res.status(400).json({ error:'Not entered in this week\'s bracket — enter first' });

  const targetEntry = await db.query(
    'SELECT fc.*, c.name, c.gear_score, c.level FROM fight_club fc JOIN characters c ON c.id=fc.entrant_id WHERE fc.entrant_id=$1 AND fc.week=$2 AND fc.year=$3',
    [req.params.entrantId, week, year]
  );
  if (!targetEntry.rows[0]) return res.status(404).json({ error:'Opponent not in this week\'s bracket' });
  if (req.params.entrantId === req.character.id) return res.status(400).json({ error:'Cannot fight yourself' });

  const target = targetEntry.rows[0];

  // Simulate fight
  const myGs  = req.character.gear_score;
  const oppGs = target.gear_score;
  const gsDelta = myGs - oppGs;
  const winChance = Math.min(0.90, Math.max(0.10, 0.5 + (gsDelta / 200)));
  const iWin = Math.random() < winChance;

  // Update bracket records
  if (iWin) {
    await db.query('UPDATE fight_club SET wins=wins+1 WHERE entrant_id=$1 AND week=$2 AND year=$3',[req.character.id,week,year]);
    await db.query('UPDATE fight_club SET losses=losses+1 WHERE entrant_id=$1 AND week=$2 AND year=$3',[req.params.entrantId,week,year]);
  } else {
    await db.query('UPDATE fight_club SET losses=losses+1 WHERE entrant_id=$1 AND week=$2 AND year=$3',[req.character.id,week,year]);
    await db.query('UPDATE fight_club SET wins=wins+1 WHERE entrant_id=$1 AND week=$2 AND year=$3',[req.params.entrantId,week,year]);
  }

  // XP reward
  const xp = iWin ? 1500 : 300;
  const respect = iWin ? 40 : 5;
  await db.query('UPDATE characters SET xp=xp+$1, respect=respect+$2, pvp_kills=pvp_kills+$3 WHERE id=$4',
    [xp, respect, iWin ? 1 : 0, req.character.id]);

  // Check if winner gets prize (top 1 with 3+ wins)
  const leaderCheck = await db.query(
    'SELECT * FROM fight_club WHERE week=$1 AND year=$2 ORDER BY wins DESC LIMIT 1',
    [week, year]
  );
  const isLeader = leaderCheck.rows[0]?.entrant_id === req.character.id && iWin;

  global.broadcastActivity(req.io, {
    type:'fightclub',
    text:`🥊 FIGHT CLUB: ${iWin ? req.character.name : target.name} defeated ${iWin ? target.name : req.character.name}`,
  });

  res.json({
    playerWins: iWin,
    opponentName: target.name,
    opponentGs: oppGs,
    xp, respect,
    isLeader,
    log: [
      `FIGHT CLUB — ${req.character.name} (GS${myGs}) vs ${target.name} (GS${oppGs})`,
      `GS advantage: ${gsDelta > 0 ? '+' : ''}${gsDelta}`,
      iWin ? `${req.character.name} wins by knockout!` : `${target.name} takes the round.`,
    ],
  });
});

module.exports = router;
