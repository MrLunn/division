/**
 * Division MMO — Bot Engine
 * Simulates human PvP activity when population is low.
 * Bots have realistic names, gear scores, and activity patterns.
 */

const db = require('../db/pool');

// Oslo-themed bot names
const BOT_NAMES = [
  'Ghost_Larsen','NightOwl_Berg','IronFjord','ShadowKong',
  'Viper_Oslo','Arctic_Fox','DarkZone_Dahl','Reaper_Knudsen',
  'Storm_Eriksen','Phantom_Vik','Rogue_Hansen','NordAgent',
  'BlizzardOp','TacticalHans','Ghost_Thorsen','Iron_Nygaard',
  'Specter_Mo','OutcastHunter','SHD_Wraith','Operator_Lund',
];

// Bot tier presets
const BOT_TIERS = [
  { min: 80,  max: 140, weight: 40, difficulty: 'easy'   },
  { min: 141, max: 200, weight: 35, difficulty: 'normal' },
  { min: 201, max: 280, weight: 20, difficulty: 'hard'   },
  { min: 281, max: 350, weight: 5,  difficulty: 'elite'  },
];

function pickTier() {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const t of BOT_TIERS) {
    acc += t.weight;
    if (roll < acc) return t;
  }
  return BOT_TIERS[1];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// SIMULATE A PVP ENCOUNTER vs a bot
// Returns outcome from the player's perspective
// ============================================================
function simulatePvpVsBot(playerGs, playerLevel) {
  const tier  = pickTier();
  const botGs = randInt(tier.min, tier.max);
  const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

  // GS differential heavily influences outcome
  const gsDelta = playerGs - botGs;
  // Base win chance 50%, ±30% per 100 GS difference
  const winChance = Math.min(0.92, Math.max(0.08, 0.5 + (gsDelta / 100) * 0.3));

  const playerWins = Math.random() < winChance;

  // Simulate combat rounds
  const log = [];
  const rounds = randInt(3, 7);
  let playerHp = 100 + playerLevel * 5;
  let botHp    = 100 + (botGs / 10);

  for (let r = 0; r < rounds; r++) {
    const playerDmg = randInt(15, 35) * (1 + playerGs / 500);
    const botDmg    = randInt(12, 30) * (1 + botGs   / 500);

    if (playerWins && r === rounds - 1) {
      log.push(`Final burst — ${Math.ceil(botHp)} damage → ${botName} eliminated`);
      botHp = 0;
    } else if (!playerWins && r === rounds - 1) {
      log.push(`${botName} lands killing blow — Agent down`);
      playerHp = 0;
    } else {
      botHp    -= playerDmg;
      playerHp -= botDmg;
      log.push(`Exchange — you deal ${Math.floor(playerDmg)}, take ${Math.floor(botDmg)} · HP: ${Math.max(0,Math.floor(playerHp))}`);
    }
  }

  const credits = playerWins ? randInt(200, 800) * (1 + gsDelta / 200) : 0;
  const xp      = playerWins ? randInt(500, 1500) : randInt(100, 400);

  return {
    bot: { name: botName, gs: botGs, tier: tier.difficulty },
    playerWins,
    log,
    credits: Math.floor(credits),
    xp:      Math.floor(xp),
  };
}

// ============================================================
// GENERATE FAKE PVP ACTIVITY FOR FEED
// Called periodically to make the world feel alive
// ============================================================
async function generateBotActivity(io) {
  try {
    const botA = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    let   botB = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    while (botB === botA) botB = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

    const events = [
      () => global.broadcastActivity(io, { type:'pvp',     text:`☠ ${botA} eliminated ${botB} in the Dark Zone` }),
      () => global.broadcastActivity(io, { type:'mission', text:`📍 ${botA} completed Operahuset [HEROIC]` }),
      () => global.broadcastActivity(io, { type:'mission', text:`⚔ ${botB} cleared Karl Johans Gate [STREET FIGHT]` }),
      () => global.broadcastActivity(io, { type:'loot',    text:`⚡ ${botA} found an EXOTIC drop from Grünerløkka Raid` }),
      () => global.broadcastActivity(io, { type:'bounty',  text:`☠ BOUNTY: ${botA} placed 2,500¢ on ${botB}` }),
      () => global.broadcastActivity(io, { type:'pvp',     text:`☠ ${botB} went ROGUE in Grønland — tread carefully` }),
      () => global.broadcastActivity(io, { type:'mission', text:`🏰 ${botA} stormed Tjuvholmen Base [HEROIC]` }),
    ];

    const pick = events[Math.floor(Math.random() * events.length)];
    pick();
  } catch (err) {
    console.error('Bot activity error:', err.message);
  }
}

module.exports = { simulatePvpVsBot, generateBotActivity, BOT_NAMES };
