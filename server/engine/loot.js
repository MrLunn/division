/**
 * Division MMO — Loot Engine
 * Handles all item generation, rarity rolls, stat generation,
 * and gear score calculation.
 */

const db = require('../db/pool');

// ============================================================
// RARITY WEIGHTS (out of 1000)
// Higher difficulty missions shift these weights
// ============================================================
const BASE_WEIGHTS = {
  exotic:   2,   // 0.2%
  named:    8,   // 0.8%
  epic:    60,   // 6.0%
  rare:   330,   // 33.0%
  common: 600,   // 60.0%
};

const DIFFICULTY_MULTIPLIERS = {
  story:       { exotic: 0.5, named: 0.5, epic: 0.8,  rare: 1.0,  common: 1.2 },
  normal:      { exotic: 1.0, named: 1.0, epic: 1.0,  rare: 1.0,  common: 1.0 },
  hard:        { exotic: 1.5, named: 2.0, epic: 1.5,  rare: 1.2,  common: 0.7 },
  challenging: { exotic: 3.0, named: 3.0, epic: 2.0,  rare: 1.5,  common: 0.4 },
  heroic:      { exotic: 6.0, named: 5.0, epic: 3.0,  rare: 1.8,  common: 0.2 },
};

// Guaranteed minimum rarity from mission definition
const RARITY_ORDER = ['common', 'rare', 'epic', 'named', 'exotic'];

// ============================================================
// STAT RANGES per rarity (percentage bonuses)
// ============================================================
const STAT_RANGES = {
  exotic:  { min: 20, max: 30 },
  named:   { min: 15, max: 25 },
  epic:    { min: 10, max: 20 },
  rare:    { min: 6,  max: 14 },
  common:  { min: 1,  max: 6  },
};

const STAT_KEYS = ['stat_weapon_dmg', 'stat_armor', 'stat_health', 'stat_crit_hit', 'stat_crit_dmg', 'stat_skill_haste'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedRoll(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'common';
}

// ============================================================
// ROLL RARITY
// ============================================================
function rollRarity(difficulty = 'normal', guaranteedMinRarity = null) {
  const mults = DIFFICULTY_MULTIPLIERS[difficulty] || DIFFICULTY_MULTIPLIERS.normal;
  const weights = {};
  for (const [rarity, baseWeight] of Object.entries(BASE_WEIGHTS)) {
    weights[rarity] = baseWeight * (mults[rarity] || 1.0);
  }

  let rarity = weightedRoll(weights);

  // Apply guaranteed minimum rarity
  if (guaranteedMinRarity) {
    const minIdx = RARITY_ORDER.indexOf(guaranteedMinRarity);
    const rolledIdx = RARITY_ORDER.indexOf(rarity);
    if (rolledIdx < minIdx) rarity = guaranteedMinRarity;
  }

  return rarity;
}

// ============================================================
// GENERATE ITEM STATS
// ============================================================
function generateStats(rarity, itemDef) {
  const range = STAT_RANGES[rarity] || STAT_RANGES.common;
  const numStats = rarity === 'exotic' ? 5 : rarity === 'named' ? 4 : rarity === 'epic' ? 3 : rarity === 'rare' ? 2 : 1;

  // Shuffle and pick stat slots
  const shuffled = [...STAT_KEYS].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, numStats);

  const stats = {};
  STAT_KEYS.forEach(k => stats[k] = 0);

  // Primary stat gets a boost
  stats[chosen[0]] = rand(range.min + 5, range.max + 10);
  for (let i = 1; i < chosen.length; i++) {
    stats[chosen[i]] = rand(range.min, range.max);
  }

  return stats;
}

// ============================================================
// ROLL GEAR SCORE
// ============================================================
function rollGearScore(itemDef, rarity) {
  const variance = itemDef.gs_variance || 5;
  const base = itemDef.base_gs;
  return Math.max(1, base + rand(-variance, variance));
}

// ============================================================
// GENERATE A SINGLE LOOT ITEM
// ============================================================
async function generateItem(options = {}) {
  const {
    difficulty = 'normal',
    guaranteedMinRarity = null,
    forcedRarity = null,
    forcedSlot = null,
    acquiredFrom = 'unknown',
    characterId = null,
  } = options;

  const rarity = forcedRarity || rollRarity(difficulty, guaranteedMinRarity);

  // Fetch matching item definition from DB
  const slotClause = forcedSlot ? `AND slot = '${forcedSlot}'` : '';
  const result = await db.query(`
    SELECT * FROM item_definitions
    WHERE rarity = $1 ${slotClause} AND is_enabled = true
    ORDER BY RANDOM()
    LIMIT 1
  `, [rarity]);

  if (result.rows.length === 0) {
    // Fallback to common if nothing found
    const fallback = await db.query(
      `SELECT * FROM item_definitions WHERE rarity = 'common' ORDER BY RANDOM() LIMIT 1`
    );
    if (fallback.rows.length === 0) return null;
    return buildItem(fallback.rows[0], 'common', acquiredFrom, characterId);
  }

  return buildItem(result.rows[0], rarity, acquiredFrom, characterId);
}

function buildItem(itemDef, rarity, acquiredFrom, characterId) {
  const gs = rollGearScore(itemDef, rarity);
  const stats = generateStats(rarity, itemDef);

  return {
    character_id: characterId,
    item_def_id: itemDef.id,
    gear_score: gs,
    is_equipped: false,
    acquired_from: acquiredFrom,
    ...stats,
    // Metadata for response (not stored directly)
    _meta: {
      name: itemDef.name,
      slot: itemDef.slot,
      rarity,
      talent: itemDef.talent,
      flavor_text: itemDef.flavor_text,
      is_named: itemDef.is_named,
      is_exotic: itemDef.is_exotic,
      gear_score: gs,
      stats,
    }
  };
}

// ============================================================
// SAVE ITEM TO INVENTORY
// ============================================================
async function saveItem(itemData, characterId) {
  const { _meta, ...dbData } = itemData;
  dbData.character_id = characterId;

  const result = await db.query(`
    INSERT INTO inventory (
      character_id, item_def_id, gear_score, is_equipped, acquired_from,
      stat_weapon_dmg, stat_armor, stat_health, stat_crit_hit, stat_crit_dmg, stat_skill_haste
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `, [
    dbData.character_id,
    dbData.item_def_id,
    dbData.gear_score,
    dbData.is_equipped,
    dbData.acquired_from,
    dbData.stat_weapon_dmg,
    dbData.stat_armor,
    dbData.stat_health,
    dbData.stat_crit_hit,
    dbData.stat_crit_dmg,
    dbData.stat_skill_haste,
  ]);

  return { ...itemData, id: result.rows[0].id };
}

// ============================================================
// ROLL A LOOT BATCH (for missions)
// ============================================================
async function rollMissionLoot(mission, characterId) {
  const items = [];
  const rolls = mission.loot_rolls || 2;

  for (let i = 0; i < rolls; i++) {
    // First roll always respects guaranteed rarity
    const guaranteedMin = i === 0 ? mission.loot_bonus_rarity : null;
    const item = await generateItem({
      difficulty: mission.difficulty,
      guaranteedMinRarity: guaranteedMin,
      acquiredFrom: mission.name,
      characterId,
    });
    if (item) {
      const saved = await saveItem(item, characterId);
      items.push(saved._meta);
    }
  }

  return items;
}

// ============================================================
// RECALCULATE CHARACTER GEAR SCORE
// ============================================================
async function recalcGearScore(characterId) {
  // Average GS of equipped items across 6 gear slots + 2 weapon slots
  const result = await db.query(`
    SELECT AVG(i.gear_score) as avg_gs, COUNT(*) as equipped_count
    FROM inventory i
    WHERE i.character_id = $1 AND i.is_equipped = true
  `, [characterId]);

  const avgGs = Math.floor(parseFloat(result.rows[0].avg_gs) || 0);
  await db.query(`UPDATE characters SET gear_score = $1 WHERE id = $2`, [avgGs, characterId]);
  return avgGs;
}

// ============================================================
// OPEN A CACHE (standalone loot roll, e.g. daily reward)
// ============================================================
async function openCache(type, characterId) {
  const settings = {
    standard:   { difficulty: 'normal',      min: null },
    high_end:   { difficulty: 'hard',        min: 'rare' },
    exotic:     { difficulty: 'heroic',      min: 'exotic', forced: 'exotic' },
    named:      { difficulty: 'challenging', min: 'named' },
  };

  const cfg = settings[type] || settings.standard;
  const item = await generateItem({
    difficulty: cfg.difficulty,
    guaranteedMinRarity: cfg.min,
    forcedRarity: cfg.forced || null,
    acquiredFrom: `${type}_cache`,
    characterId,
  });

  if (!item) return null;
  const saved = await saveItem(item, characterId);
  return saved._meta;
}

module.exports = {
  generateItem,
  saveItem,
  rollMissionLoot,
  recalcGearScore,
  openCache,
  rollRarity,
  RARITY_ORDER,
};
