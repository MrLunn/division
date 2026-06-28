const router = require('express').Router();
const db     = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

// GET /api/extortion — my active demands (sent and received) + bot targets
router.get('/', requireAuth, async (req, res) => {
  try {
    const sent = await db.query(`
      SELECT e.*, c.name as target_name, c.gear_score as target_gs
      FROM extortions e JOIN characters c ON c.id=e.target_id
      WHERE e.extorter_id=$1 AND e.deadline > NOW() AND NOT e.paid
      ORDER BY e.created_at DESC
    `, [req.character.id]);
    const received = await db.query(`
      SELECT e.*, c.name as extorter_name, c.gear_score as extorter_gs
      FROM extortions e JOIN characters c ON c.id=e.extorter_id
      WHERE e.target_id=$1 AND e.deadline > NOW() AND NOT e.paid
      ORDER BY e.created_at DESC
    `, [req.character.id]);

    // Inject bot targets that can be extorted (weaker than player)
    const gs = req.character.gear_score || 100;
    const credits = req.character.credits || 1000;
    const BOT_TARGETS = [
      { id:'bot-ext-1', name:'TacticalHans',  gear_score:175, level:9,  isBot:true, suggestedAmount: Math.max(200, Math.floor(credits * 0.05)) },
      { id:'bot-ext-2', name:'Arctic_Fox',    gear_score:220, level:12, isBot:true, suggestedAmount: Math.max(300, Math.floor(credits * 0.08)) },
      { id:'bot-ext-3', name:'ShadowKong',    gear_score:260, level:15, isBot:true, suggestedAmount: Math.max(500, Math.floor(credits * 0.12)) },
    ].filter(b => b.gear_score < gs * 1.5);

    res.json({ sent: sent.rows, received: received.rows, botTargets: BOT_TARGETS });
  } catch(err) { res.status(500).json({ error:'Failed to load extortions' }); }
});

// POST /api/extortion/bot/:botId — extort a bot (instant payout with risk)
router.post('/bot/:botId', requireAuth, async (req, res) => {
  const { amount } = req.body;
  const BOT_DATA = {
    'bot-ext-1':{ name:'TacticalHans', gs:175 },
    'bot-ext-2':{ name:'Arctic_Fox',   gs:220 },
    'bot-ext-3':{ name:'ShadowKong',   gs:260 },
  };
  const bot = BOT_DATA[req.params.botId];
  if (!bot) return res.status(404).json({ error:'Bot not found' });
  if (!amount || amount < 200) return res.status(400).json({ error:'Minimum 200¢' });
  if (bot.gs > req.character.gear_score * 1.5) return res.status(400).json({ error:'Target too powerful' });

  // 70% success rate for bots
  const success = Math.random() < 0.70;
  if (success) {
    await db.query('UPDATE characters SET credits=credits+$1,respect=respect+20 WHERE id=$2',[amount, req.character.id]);
    global.broadcastActivity(req.io, { type:'extortion', text:`💰 ${req.character.name} extorted ${amount.toLocaleString()}¢ from ${bot.name}` });
    res.json({ success:true, message:`${bot.name} paid up — +${amount.toLocaleString()}¢ · +20★`, amount });
  } else {
    const lost = Math.floor(amount * 0.5);
    await db.query('UPDATE characters SET credits=GREATEST(0,credits-$1),respect=GREATEST(0,respect-10) WHERE id=$2',[lost, req.character.id]);
    global.broadcastActivity(req.io, { type:'pvp', text:`⚠ ${req.character.name} tried to extort ${bot.name} and got robbed instead — lost ${lost.toLocaleString()}¢` });
    res.json({ success:false, message:`${bot.name} refused and counter-attacked — lost ${lost.toLocaleString()}¢ · -10★`, lost });
  }
});

// POST /api/extortion — place a demand
router.post('/', requireAuth, async (req, res) => {
  const { targetId, amount } = req.body;
  if (!targetId || !amount || amount < 200)
    return res.status(400).json({ error:'Minimum extortion is 200 ¢' });
  if (targetId === req.character.id)
    return res.status(400).json({ error:"Can't extort yourself" });

  const target = await db.query('SELECT id,name,gear_score,credits FROM characters WHERE id=$1',[targetId]);
  if (!target.rows[0]) return res.status(404).json({ error:'Target not found' });
  const t = target.rows[0];

  // Can't extort players with more than 50% higher GS (honour code)
  if (t.gear_score > req.character.gear_score * 1.5)
    return res.status(400).json({ error:'Target is too powerful — find a weaker mark' });

  // Check for existing demand
  const existing = await db.query(
    'SELECT id FROM extortions WHERE extorter_id=$1 AND target_id=$2 AND deadline>NOW() AND NOT paid',
    [req.character.id, targetId]
  );
  if (existing.rows.length) return res.status(400).json({ error:'You already have an active demand on this agent' });

  await db.query(
    'INSERT INTO extortions (extorter_id, target_id, amount) VALUES ($1,$2,$3)',
    [req.character.id, targetId, amount]
  );

  global.notifyAgent(req.io, targetId, 'extortion:demand', {
    from: req.character.name, amount, hoursLeft: 12,
  });
  global.broadcastActivity(req.io, {
    type:'extortion',
    text:`💰 ${req.character.name} placed a ${amount.toLocaleString()}¢ demand on ${t.name}`,
  });

  res.status(201).json({ message:`Demand sent to ${t.name} — they have 12 hours to pay` });
});

// POST /api/extortion/:id/pay — pay up
router.post('/:id/pay', requireAuth, async (req, res) => {
  const e = await db.query(
    'SELECT * FROM extortions WHERE id=$1 AND target_id=$2 AND deadline>NOW() AND NOT paid',
    [req.params.id, req.character.id]
  );
  if (!e.rows[0]) return res.status(404).json({ error:'Demand not found or expired' });
  const demand = e.rows[0];

  const me = await db.query('SELECT credits FROM characters WHERE id=$1',[req.character.id]);
  if (me.rows[0].credits < demand.amount)
    return res.status(400).json({ error:'Insufficient credits' });

  await db.query('UPDATE extortions SET paid=true WHERE id=$1',[demand.id]);
  await db.query('UPDATE characters SET credits=credits-$1,respect=GREATEST(0,respect-10) WHERE id=$2',[demand.amount, req.character.id]);
  await db.query('UPDATE characters SET credits=credits+$1,respect=respect+30 WHERE id=$2',[demand.amount, demand.extorter_id]);

  global.notifyAgent(req.io, demand.extorter_id, 'extortion:paid', {
    from: req.character.name, amount: demand.amount,
  });
  res.json({ message:`Paid ${demand.amount.toLocaleString()}¢. Demand cleared.` });
});

// POST /api/extortion/:id/refuse — refuse and trigger auto-attack
router.post('/:id/refuse', requireAuth, async (req, res) => {
  const e = await db.query(
    'SELECT * FROM extortions WHERE id=$1 AND target_id=$2 AND deadline>NOW() AND NOT paid',
    [req.params.id, req.character.id]
  );
  if (!e.rows[0]) return res.status(404).json({ error:'Demand not found' });
  await db.query('UPDATE extortions SET deadline=NOW() WHERE id=$1',[e.rows[0].id]);

  // Notify extorter their demand was refused
  global.notifyAgent(req.io, e.rows[0].extorter_id, 'extortion:refused', { by: req.character.name });
  global.broadcastActivity(req.io, { type:'extortion', text:`🤜 ${req.character.name} refused ${e.rows[0].amount.toLocaleString()}¢ demand — retaliation incoming` });
  res.json({ message:'Demand refused. Watch your back.' });
});

module.exports = router;
