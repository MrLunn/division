/**
 * Gear Recalibration — spend credits to reroll one stat on an item
 * One reroll per item, ever.
 */
const router  = require('express').Router();
const db      = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const REROLL_COST = { common: 500, rare: 2000, epic: 6000, named: 15000, exotic: 30000 };
const STAT_KEYS   = ['stat_health','stat_armor','stat_weapon_dmg','stat_crit_hit','stat_crit_dmg','stat_skill_haste'];

// GET /api/recalibration/:inventoryId — preview cost and current stats
router.get('/:inventoryId', requireAuth, async (req, res) => {
  try {
    const inv = await db.query(`
      SELECT i.*, d.name, d.rarity, d.gear_score
      FROM inventory i JOIN item_definitions d ON d.id=i.item_def_id
      WHERE i.id=$1 AND i.character_id=$2
    `, [req.params.inventoryId, req.character.id]);

    if (!inv.rows[0]) return res.status(404).json({ error: 'Item not found' });
    const item = inv.rows[0];

    const alreadyRerolled = await db.query(
      'SELECT id FROM recalibrations WHERE inventory_id=$1', [item.id]
    );

    const stats = {};
    STAT_KEYS.forEach(k => { if (item[k] > 0) stats[k] = item[k]; });

    res.json({
      item: { id: item.id, name: item.name, rarity: item.rarity, gearScore: item.gear_score },
      stats,
      cost:     REROLL_COST[item.rarity] || 2000,
      canReroll: alreadyRerolled.rows.length === 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load item' });
  }
});

// POST /api/recalibration/:inventoryId — execute the reroll
router.post('/:inventoryId', requireAuth, async (req, res) => {
  const { statToReroll } = req.body;
  if (!STAT_KEYS.includes(statToReroll))
    return res.status(400).json({ error: 'Invalid stat' });

  try {
    const inv = await db.query(`
      SELECT i.*, d.name, d.rarity, d.gear_score
      FROM inventory i JOIN item_definitions d ON d.id=i.item_def_id
      WHERE i.id=$1 AND i.character_id=$2
    `, [req.params.inventoryId, req.character.id]);

    if (!inv.rows[0]) return res.status(404).json({ error: 'Item not found' });
    const item = inv.rows[0];
    const cost = REROLL_COST[item.rarity] || 2000;

    // Already rerolled?
    const already = await db.query('SELECT id FROM recalibrations WHERE inventory_id=$1', [item.id]);
    if (already.rows[0]) return res.status(400).json({ error: 'This item has already been recalibrated' });

    // Check credits
    const me = await db.query('SELECT credits FROM characters WHERE id=$1', [req.character.id]);
    if (me.rows[0].credits < cost) return res.status(400).json({ error: 'Insufficient credits' });

    const oldValue = item[statToReroll] || 0;

    // Roll a new value: guaranteed improvement, random ±range by rarity
    const rarityBonus = { common:5, rare:10, epic:18, named:25, exotic:35 };
    const maxStat = rarityBonus[item.rarity] || 10;
    // New value: at least 1 higher than old, up to max for rarity
    const minNew = Math.max(oldValue + 1, Math.floor(maxStat * 0.5));
    const newValue = Math.floor(minNew + Math.random() * (maxStat - minNew + 1));

    // Apply
    await db.query(`UPDATE inventory SET ${statToReroll}=$1 WHERE id=$2`, [newValue, item.id]);
    await db.query('UPDATE characters SET credits=credits-$1 WHERE id=$2', [cost, req.character.id]);
    await db.query(`
      INSERT INTO recalibrations (inventory_id, stat_changed, old_value, new_value, cost)
      VALUES ($1,$2,$3,$4,$5)
    `, [item.id, statToReroll, oldValue, newValue, cost]);

    res.json({
      message:  `Recalibration complete`,
      stat:     statToReroll,
      oldValue,
      newValue,
      improved: newValue - oldValue,
      cost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Recalibration failed' });
  }
});

module.exports = router;
