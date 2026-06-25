/**
 * Division MMO — Combat Engine
 * Handles PvP encounters, mission combat, rogue system
 */

const db = require('../db/pool');

// ============================================================
// CALCULATE COMBAT POWER from character stats
// ============================================================
async function getCharacterPower(characterId) {
  const result = await db.query(`
    SELECT
      c.level,
      c.gear_score,
      COALESCE(SUM(i.stat_weapon_dmg), 0) as total_weapon_dmg,
      COALESCE(SUM(i.stat_armor), 0)      as total_armor,
      COALESCE(SUM(i.stat_health), 0)     as total_health,
      COALESCE(SUM(i.stat_crit_hit), 0)   as total_crit_hit,
      COALESCE(SUM(i.stat_crit_dmg), 0)   as total_crit_dmg,
      COALESCE(SUM(i.stat_skill_haste), 0)as total_skill_haste
    FROM characters c
    LEFT JOIN inventory i ON i.character_id = c.id AND i.is_equipped = true
    WHERE c.id = $1
    GROUP BY c.id
  `, [characterId]);

  if (result.rows.length === 0) return null;
  const r = result.rows[0];

  const baseDps   = 8000 + (r.level * 200) + (r.gear_score * 30) + (r.total_weapon_dmg * 80);
  const baseArmor = 5000 + (r.gear_score * 20) + (r.total_armor * 100);
  const baseHp    = 30000 + (r.gear_score * 50) + (r.total_health * 200);
  const critChance= Math.min(60, 5 + r.total_crit_hit * 2);
  const critMult  = 1.5 + (r.total_crit_dmg * 0.05);

  // Effective DPS with crits
  const effectiveDps = baseDps * (1 + (critChance / 100) * (critMult - 1));

  return {
    dps: Math.floor(effectiveDps),
    armor: Math.floor(baseArmor),
    hp: Math.floor(baseHp),
    critChance: Math.floor(critChance),
    critMult: critMult.toFixed(2),
    gearScore: parseInt(r.gear_score),
  };
}

// ============================================================
// PVP ENCOUNTER — simulated combat resolution
// ============================================================
async function resolvePvp(attackerId, defenderId, zone) {
  const [aPower, dPower] = await Promise.all([
    getCharacterPower(attackerId),
    getCharacterPower(defenderId),
  ]);

  if (!aPower || !dPower) throw new Error('Could not load character stats');

  // Combat simulation: time-to-kill each side
  const aEffectiveHp = dPower.hp + dPower.armor;
  const dEffectiveHp = aPower.hp + aPower.armor;

  const aTimeToKill = aEffectiveHp / aPower.dps;
  const dTimeToKill = dEffectiveHp / dPower.dps;

  // Skill factor (randomness — 15% variance)
  const skillFactor = 0.85 + Math.random() * 0.3;
  const attackerWins = (aTimeToKill * skillFactor) < dTimeToKill;

  // Steal loot from loser
  const loserId = attackerWins ? defenderId : attackerId;
  const stolenLoot = await stealLoot(loserId);

  const winnerId = attackerWins ? attackerId : defenderId;

  // Record pvp event
  await db.query(`
    INSERT INTO pvp_events (attacker_id, defender_id, zone, attacker_won, loot_stolen)
    VALUES ($1, $2, $3, $4, $5)
  `, [attackerId, defenderId, zone, attackerWins, JSON.stringify(stolenLoot)]);

  // Update kill/death counts
  await db.query(`UPDATE characters SET pvp_kills = pvp_kills + 1 WHERE id = $1`, [winnerId]);
  await db.query(`UPDATE characters SET pvp_deaths = pvp_deaths + 1 WHERE id = $1`, [loserId]);

  // Award winner XP and credits
  const xpGain = 500 + Math.floor(dPower.gearScore * 2);
  const creditGain = 200 + Math.floor(Math.random() * 300);
  await db.query(`
    UPDATE characters SET xp = xp + $1, credits = credits + $2 WHERE id = $3
  `, [xpGain, creditGain, winnerId]);

  return {
    attackerWins,
    winnerId,
    loserId,
    stolenLoot,
    xpGain,
    creditGain,
    combatLog: buildCombatLog(aPower, dPower, attackerWins),
  };
}

async function stealLoot(characterId) {
  // Pick up to 2 unequipped items from loser's inventory
  const result = await db.query(`
    SELECT i.id, d.name, d.rarity, i.gear_score
    FROM inventory i
    JOIN item_definitions d ON d.id = i.item_def_id
    WHERE i.character_id = $1 AND i.is_equipped = false
    ORDER BY i.gear_score DESC
    LIMIT 2
  `, [characterId]);

  if (result.rows.length === 0) return [];

  // Remove stolen items
  const ids = result.rows.map(r => r.id);
  if (ids.length > 0) {
    await db.query(`DELETE FROM inventory WHERE id = ANY($1)`, [ids]);
  }

  return result.rows;
}

function buildCombatLog(aPower, dPower, attackerWins) {
  const log = [];
  log.push(`Attacker GS ${aPower.gearScore} vs Defender GS ${dPower.gearScore}`);
  log.push(`Attacker DPS: ${aPower.dps.toLocaleString()} | Defender DPS: ${dPower.dps.toLocaleString()}`);

  const rounds = Math.ceil(3 + Math.random() * 5);
  for (let i = 1; i <= rounds; i++) {
    const aDmg = Math.floor(aPower.dps * (0.3 + Math.random() * 0.4));
    const dDmg = Math.floor(dPower.dps * (0.3 + Math.random() * 0.4));
    const aCrit = Math.random() * 100 < aPower.critChance;
    const dCrit = Math.random() * 100 < dPower.critChance;
    log.push(`Round ${i}: Attacker hit ${aDmg.toLocaleString()}${aCrit ? ' [CRIT!]' : ''} | Defender hit ${dDmg.toLocaleString()}${dCrit ? ' [CRIT!]' : ''}`);
  }

  log.push(attackerWins ? '→ ATTACKER WINS — Defender eliminated' : '→ DEFENDER WINS — Attacker eliminated');
  return log;
}

// ============================================================
// MISSION COMBAT — PvE encounter resolution
// ============================================================
async function resolveMissionCombat(characterId, mission) {
  const power = await getCharacterPower(characterId);
  if (!power) throw new Error('Character not found');

  const minGs = mission.min_gs || 0;

  // Base success rate from gear score vs mission requirement
  const gsRatio = minGs > 0 ? power.gearScore / minGs : 1.5;
  let baseSuccessRate = Math.min(0.95, Math.max(0.1, gsRatio * 0.7));

  // Difficulty modifier
  const diffMods = { story: 1.2, normal: 1.0, hard: 0.85, challenging: 0.7, heroic: 0.55 };
  baseSuccessRate *= (diffMods[mission.difficulty] || 1.0);
  baseSuccessRate = Math.min(0.95, baseSuccessRate);

  const success = Math.random() < baseSuccessRate;

  const combatLog = buildMissionLog(mission, power, success);

  return { success, power, combatLog };
}

function buildMissionLog(mission, power, success) {
  const log = [];
  log.push(`→ Initiating ${mission.name} [${mission.difficulty.toUpperCase()}]`);
  log.push(`Agent GS ${power.gearScore} — DPS ${power.dps.toLocaleString()} — HP ${power.hp.toLocaleString()}`);

  const phases = ['Breaching the perimeter...', 'Engaging hostiles...', 'Pushing to the objective...'];
  if (mission.type === 'dark_zone') phases.push('Watching for rogue agents...');
  if (mission.type === 'raid') phases.push('Coordinating with fireteam...', 'Final boss phase...');

  phases.forEach(p => log.push(`  ⚡ ${p}`));

  if (success) {
    log.push(`✅ MISSION COMPLETE — Objective secured`);
  } else {
    log.push(`❌ MISSION FAILED — Agent KIA — Retry with higher GS`);
  }

  return log;
}

// ============================================================
// ROGUE SYSTEM
// ============================================================
async function goRogue(characterId) {
  const rogueTimer = 300; // 5 minutes
  await db.query(`
    UPDATE characters SET is_rogue = true, rogue_timer = $1 WHERE id = $2
  `, [rogueTimer, characterId]);

  return { rogueTimer, message: 'You are now ROGUE. All agents in the zone are hostile.' };
}

async function clearRogue(characterId) {
  await db.query(`
    UPDATE characters SET is_rogue = false, rogue_timer = 0 WHERE id = $1
  `, [characterId]);
  return { message: 'Rogue status cleared.' };
}

module.exports = {
  getCharacterPower,
  resolvePvp,
  resolveMissionCombat,
  goRogue,
  clearRogue,
};
