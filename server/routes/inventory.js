const router = require('express').Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const lootEngine = require('../engine/loot');

// GET /api/inventory — full inventory
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        i.*,
        d.name, d.slot, d.rarity, d.is_named, d.is_exotic, d.talent, d.flavor_text
      FROM inventory i
      JOIN item_definitions d ON d.id = i.item_def_id
      WHERE i.character_id = $1
      ORDER BY i.gear_score DESC, i.acquired_at DESC
    `, [req.character.id]);

    const equipped = result.rows.filter(r => r.is_equipped);
    const stash    = result.rows.filter(r => !r.is_equipped);

    res.json({
      equipped,
      stash,
      gearScore: req.character.gear_score,
      totalItems: result.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

// POST /api/inventory/:itemId/equip — equip an item
router.post('/:itemId/equip', requireAuth, async (req, res) => {
  const { itemId } = req.params;

  try {
    // Verify ownership
    const itemResult = await db.query(`
      SELECT i.*, d.slot, d.rarity, d.name
      FROM inventory i
      JOIN item_definitions d ON d.id = i.item_def_id
      WHERE i.id = $1 AND i.character_id = $2
    `, [itemId, req.character.id]);

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found in your inventory' });
    }

    const item = itemResult.rows[0];

    // Unequip any currently equipped item in same slot
    await db.query(`
      UPDATE inventory i
      SET is_equipped = false
      FROM item_definitions d
      WHERE i.item_def_id = d.id
        AND i.character_id = $1
        AND d.slot = $2
        AND i.id != $3
    `, [req.character.id, item.slot, itemId]);

    // Equip new item
    await db.query(`UPDATE inventory SET is_equipped = true WHERE id = $1`, [itemId]);

    // Recalculate gear score
    const newGs = await lootEngine.recalcGearScore(req.character.id);

    res.json({
      message: `${item.name} equipped in ${item.slot} slot`,
      gearScore: newGs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to equip item' });
  }
});

// POST /api/inventory/sell-all — sell all unequipped items
router.post('/sell-all', requireAuth, async (req, res) => {
  try {
    const { rarity } = req.body; // optional filter: only sell up to this rarity
    const rarityValues = { common: 50, rare: 200, epic: 600, named: 1500, exotic: 5000 };
    const rarityOrder  = ['common', 'rare', 'epic', 'named', 'exotic'];
    const maxIdx = rarity ? rarityOrder.indexOf(rarity) : rarityOrder.indexOf('rare'); // default: sell common+rare only

    // Fetch all unequipped items up to max rarity
    const itemsResult = await db.query(`
      SELECT i.id, i.gear_score, d.rarity, d.name
      FROM inventory i
      JOIN item_definitions d ON d.id = i.item_def_id
      WHERE i.character_id = $1 AND i.is_equipped = false
    `, [req.character.id]);

    const toSell = itemsResult.rows.filter(item =>
      rarityOrder.indexOf(item.rarity) <= maxIdx
    );

    if (toSell.length === 0) return res.json({ message: 'Nothing to sell', credits: 0, count: 0 });

    const totalCredits = toSell.reduce((sum, item) =>
      sum + (rarityValues[item.rarity] || 50) + Math.floor(item.gear_score * 2), 0
    );

    const ids = toSell.map(i => i.id);
    await db.query(`DELETE FROM inventory WHERE id = ANY($1)`, [ids]);
    await db.query(`UPDATE characters SET credits = credits + $1 WHERE id = $2`, [totalCredits, req.character.id]);

    res.json({
      message: `Sold ${toSell.length} items for ${totalCredits.toLocaleString()} Credits`,
      credits: totalCredits,
      count: toSell.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sell items' });
  }
});

// POST /api/inventory/:itemId/sell — sell for credits
router.post('/:itemId/sell', requireAuth, async (req, res) => {
  const { itemId } = req.params;

  try {
    const itemResult = await db.query(`
      SELECT i.*, d.name, d.rarity, d.slot
      FROM inventory i
      JOIN item_definitions d ON d.id = i.item_def_id
      WHERE i.id = $1 AND i.character_id = $2
    `, [itemId, req.character.id]);

    if (itemResult.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const item = itemResult.rows[0];

    if (item.is_equipped) return res.status(400).json({ error: 'Cannot sell equipped item. Unequip first.' });

    // Sell value by rarity and GS
    const rarityValues = { common: 50, rare: 200, epic: 600, named: 1500, exotic: 5000 };
    const sellValue = (rarityValues[item.rarity] || 50) + Math.floor(item.gear_score * 2);

    await db.query(`DELETE FROM inventory WHERE id = $1`, [itemId]);
    await db.query(`UPDATE characters SET credits = credits + $1 WHERE id = $2`, [sellValue, req.character.id]);

    res.json({
      message: `Sold ${item.name} for ${sellValue.toLocaleString()} Credits`,
      creditsGained: sellValue,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sell item' });
  }
});

// POST /api/inventory/open-cache — open a loot cache
router.post('/open-cache', requireAuth, async (req, res) => {
  const { type = 'standard' } = req.body;

  const costs = { standard: 500, high_end: 2000, named: 8000, exotic: 25000 };
  const cost = costs[type] || 500;

  if (req.character.credits < cost) {
    return res.status(400).json({
      error: `Not enough credits. Need ${cost.toLocaleString()}, have ${parseInt(req.character.credits).toLocaleString()}.`
    });
  }

  try {
    await db.query(`UPDATE characters SET credits = credits - $1 WHERE id = $2`, [cost, req.character.id]);
    const item = await lootEngine.openCache(type, req.character.id);

    if (!item) return res.status(500).json({ error: 'Cache empty' });

    // Log exotic to feed
    if (item.rarity === 'exotic') {
      await db.query(`
        INSERT INTO activity_feed (type, actor_name, detail)
        VALUES ('exotic_drop', $1, $2)
      `, [req.character.name, `Opened ${item.name} from an Exotic Cache!`]);
    }

    res.json({ item, creditsCost: cost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to open cache' });
  }
});

// POST /api/inventory/:itemId/unequip
router.post('/:itemId/unequip', requireAuth, async (req, res) => {
  const { itemId } = req.params;
  try {
    const result = await db.query(`
      UPDATE inventory SET is_equipped = false
      WHERE id = $1 AND character_id = $2 RETURNING id
    `, [itemId, req.character.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    const newGs = await lootEngine.recalcGearScore(req.character.id);
    res.json({ message: 'Item unequipped', gearScore: newGs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unequip' });
  }
});

module.exports = router;
