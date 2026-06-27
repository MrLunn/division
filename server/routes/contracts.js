/**
 * Daily Contracts — 3 rotating objectives that reset at midnight
 */
const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const CONTRACT_TEMPLATES = [
  { type:'missions',  target:2,  desc:'Complete 2 missions in Oslo',         xp:1200, credits:600  },
  { type:'missions',  target:5,  desc:'Complete 5 missions of any type',     xp:2500, credits:1200 },
  { type:'kills',     target:10, desc:'Eliminate 10 enemies in the field',   xp:1000, credits:500  },
  { type:'kills',     target:25, desc:'Eliminate 25 enemies total',          xp:2000, credits:1000 },
  { type:'darkzone',  target:1,  desc:'Complete 1 Dark Zone operation',      xp:1500, credits:800  },
  { type:'darkzone',  target:3,  desc:'Run 3 Dark Zone extractions',         xp:3000, credits:1500 },
  { type:'caches',    target:1,  desc:'Open 1 loot cache of any type',       xp:800,  credits:400  },
  { type:'caches',    target:3,  desc:'Open 3 loot caches',                  xp:2000, credits:1000 },
  { type:'street',    target:1,  desc:'Complete a street fight',             xp:1800, credits:900  },
  { type:'missions',  target:1,  desc:'Complete 1 heroic-difficulty mission',xp:2000, credits:1000 },
];

// Ensure today's contracts exist — called on GET
async function ensureTodaysContracts() {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.query('SELECT id FROM daily_contracts WHERE day=$1', [today]);
  if (existing.rows.length >= 3) return;

  // Pick 3 non-repeating random templates
  const shuffled = [...CONTRACT_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3);
  for (let i = 0; i < 3; i++) {
    const t = shuffled[i];
    await db.query(`
      INSERT INTO daily_contracts (day, slot, type, target, xp_reward, credit_reward, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (day, slot) DO NOTHING
    `, [today, i + 1, t.type, t.target, t.xp, t.credits, t.desc]);
  }
}

// GET /api/contracts — today's 3 contracts with my progress
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureTodaysContracts();
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.query(`
      SELECT dc.*, cp.progress, cp.completed, cp.claimed, cp.id as progress_id
      FROM daily_contracts dc
      LEFT JOIN contract_progress cp
        ON cp.contract_id = dc.id AND cp.character_id = $1
      WHERE dc.day = $2
      ORDER BY dc.slot
    `, [req.character.id, today]);
    res.json({ contracts: result.rows, resetAt: today + 'T23:59:59Z' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load contracts' });
  }
});

// POST /api/contracts/:id/claim — claim completed contract reward
router.post('/:id/claim', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const cp = await db.query(`
      SELECT cp.*, dc.xp_reward, dc.credit_reward, dc.description
      FROM contract_progress cp
      JOIN daily_contracts dc ON dc.id = cp.contract_id
      WHERE cp.contract_id=$1 AND cp.character_id=$2
    `, [id, req.character.id]);

    if (!cp.rows[0]) return res.status(404).json({ error: 'Contract not found' });
    const c = cp.rows[0];
    if (!c.completed) return res.status(400).json({ error: 'Contract not yet completed' });
    if (c.claimed)    return res.status(400).json({ error: 'Already claimed' });

    await db.query('UPDATE contract_progress SET claimed=true WHERE contract_id=$1 AND character_id=$2',
      [id, req.character.id]);
    await db.query('UPDATE characters SET xp=xp+$1, credits=credits+$2 WHERE id=$3',
      [c.xp_reward, c.credit_reward, req.character.id]);

    res.json({
      message: `Contract complete: ${c.description}`,
      xp: c.xp_reward,
      credits: c.credit_reward,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to claim' });
  }
});

// Internal: increment contract progress (called from missions route)
async function tickContract(characterId, type, amount = 1) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const contracts = await db.query(`
      SELECT dc.id, dc.target FROM daily_contracts dc
      LEFT JOIN contract_progress cp ON cp.contract_id=dc.id AND cp.character_id=$1
      WHERE dc.day=$2 AND dc.type=$3 AND (cp.completed IS NULL OR cp.completed=false)
    `, [characterId, today, type]);

    for (const c of contracts.rows) {
      await db.query(`
        INSERT INTO contract_progress (character_id, contract_id, progress, completed)
        VALUES ($1, $2, $3, $3>=$4)
        ON CONFLICT (character_id, contract_id) DO UPDATE
          SET progress   = LEAST(contract_progress.progress + $3, $4),
              completed  = (LEAST(contract_progress.progress + $3, $4) >= $4)
      `, [characterId, c.id, amount, c.target]);
    }
  } catch (err) {
    console.error('tickContract error:', err.message);
  }
}

module.exports = router;
module.exports.tickContract = tickContract;
