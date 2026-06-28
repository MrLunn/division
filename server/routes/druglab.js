const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const TIERS = {
  1: { name:'Stash House',  invest:5000,  hourlyRate:0.04, upgradeAt:10000  },
  2: { name:'Lab',          invest:20000, hourlyRate:0.07, upgradeAt:50000  },
  3: { name:'Plantation',   invest:80000, hourlyRate:0.10, upgradeAt:null   },
};

// GET /api/druglab — my lab status
router.get('/', requireAuth, async (req, res) => {
  try {
    const lab = await db.query('SELECT * FROM drug_labs WHERE character_id=$1',[req.character.id]);
    if (!lab.rows[0]) return res.json({ lab: null, tiers: TIERS });

    const l = lab.rows[0];
    const tier = TIERS[l.tier];
    const hoursSince = (Date.now() - new Date(l.last_payout)) / 3600000;
    const pending = Math.floor(l.invested * tier.hourlyRate * Math.min(hoursSince, 24)); // cap at 24h

    res.json({ lab: { ...l, pending, tierInfo: tier }, tiers: TIERS });
  } catch(err) { res.status(500).json({ error:'Failed to load lab' }); }
});

// POST /api/druglab/invest — set up or invest more
router.post('/invest', requireAuth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 1000) return res.status(400).json({ error:'Minimum investment is 1,000 ¢' });

  const me = await db.query('SELECT credits FROM characters WHERE id=$1',[req.character.id]);
  if (me.rows[0].credits < amount) return res.status(400).json({ error:'Insufficient credits' });

  await db.query('UPDATE characters SET credits=credits-$1 WHERE id=$2',[amount, req.character.id]);

  const existing = await db.query('SELECT * FROM drug_labs WHERE character_id=$1',[req.character.id]);
  if (existing.rows[0]) {
    const newInvested = existing.rows[0].invested + amount;
    const tier = TIERS[existing.rows[0].tier];
    const newTier = tier.upgradeAt && newInvested >= tier.upgradeAt
      ? existing.rows[0].tier + 1 : existing.rows[0].tier;
    await db.query('UPDATE drug_labs SET invested=$1,tier=$2 WHERE character_id=$3',[newInvested, newTier, req.character.id]);
    const upgraded = newTier > existing.rows[0].tier;
    res.json({ message:`Invested ${amount.toLocaleString()}¢${upgraded ? ` — Lab upgraded to ${TIERS[newTier].name}!` : ''}`, upgraded, tier: newTier });
  } else {
    await db.query('INSERT INTO drug_labs (character_id,invested) VALUES ($1,$2)',[req.character.id, amount]);
    res.json({ message:`Stash House established with ${amount.toLocaleString()}¢ investment`, tier:1 });
  }
});

// POST /api/druglab/collect — collect pending earnings
router.post('/collect', requireAuth, async (req, res) => {
  const lab = await db.query('SELECT * FROM drug_labs WHERE character_id=$1',[req.character.id]);
  if (!lab.rows[0]) return res.status(404).json({ error:'No lab established' });

  const l = lab.rows[0];
  const tier = TIERS[l.tier];
  const hoursSince = (Date.now() - new Date(l.last_payout)) / 3600000;
  const earned = Math.floor(l.invested * tier.hourlyRate * Math.min(hoursSince, 24));

  if (earned < 100) return res.status(400).json({ error:`Only ${earned}¢ pending — come back later` });

  await db.query('UPDATE drug_labs SET last_payout=NOW() WHERE character_id=$1',[req.character.id]);
  await db.query('UPDATE characters SET credits=credits+$1,respect=respect+5 WHERE id=$2',[earned, req.character.id]);

  res.json({ message:`Collected ${earned.toLocaleString()}¢ from your ${tier.name}`, earned });
});

module.exports = router;
