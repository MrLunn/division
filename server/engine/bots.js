/**
 * Division MMO — Bot Engine
 * Bots move on the map, generate activity, and actively attack real players.
 */

const db = require('../db/pool');

const BOT_NAMES = [
  'Ghost_Larsen', 'NightOwl_Berg', 'IronFjord', 'ShadowKong',
  'Viper_Oslo', 'Arctic_Fox', 'Rogue_Hansen', 'NordAgent',
  'BlizzardOp', 'TacticalHans', 'Ghost_Thorsen', 'Iron_Nygaard',
  'Specter_Mo', 'SHD_Wraith', 'Operator_Lund', 'Storm_Eriksen',
  'Phantom_Vik', 'Reaper_Knudsen', 'DarkZone_Dahl', 'Arctic_Skar',
];

const FACTION_ENEMIES = {
  'Young Guns':         ['YG enforcer', 'Young Guns lieutenant'],
  'B-Gjengen':          ['B-Gang soldier', 'B-Gjengen captain'],
  '313-nettverket':     ['313 operative', 'nettverket enforcer'],
  'Balkan Brotherhood': ['Brotherhood muscle', 'Balkan enforcer'],
  'Bandidos Norway':    ['Bandidos patch-holder', 'MC enforcer'],
  'Comanches MC':       ['Comanche rider', 'MC captain'],
};

const BOT_TIERS = [
  { min: 80,  max: 140, weight: 40, difficulty: 'easy'   },
  { min: 141, max: 200, weight: 35, difficulty: 'normal' },
  { min: 201, max: 280, weight: 20, difficulty: 'hard'   },
  { min: 281, max: 350, weight: 5,  difficulty: 'elite'  },
];

function pickTier() {
  const roll = Math.random() * 100;
  let acc = 0;
  for (const t of BOT_TIERS) { acc += t.weight; if (roll < acc) return t; }
  return BOT_TIERS[1];
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randBot() { return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; }

// ============================================================
// SIMULATE PVP vs BOT (called from pvp route)
// ============================================================
function simulatePvpVsBot(playerGs, playerLevel) {
  const tier   = pickTier();
  const botGs  = randInt(tier.min, tier.max);
  const botName = randBot();
  const gsDelta = playerGs - botGs;
  const winChance = Math.min(0.92, Math.max(0.08, 0.5 + (gsDelta / 100) * 0.3));
  const playerWins = Math.random() < winChance;

  const log = [];
  const rounds = randInt(3, 7);
  let playerHp = 100 + playerLevel * 5;
  let botHp    = 100 + botGs / 10;

  for (let r = 0; r < rounds; r++) {
    const playerDmg = randInt(15, 35) * (1 + playerGs / 500);
    const botDmg    = randInt(12, 30) * (1 + botGs / 500);
    if (playerWins && r === rounds - 1) {
      log.push(`Final burst — ${Math.ceil(botHp)} damage → ${botName} eliminated`);
      botHp = 0;
    } else if (!playerWins && r === rounds - 1) {
      log.push(`${botName} lands killing blow — Agent down`);
      playerHp = 0;
    } else {
      botHp    -= playerDmg;
      playerHp -= botDmg;
      log.push(`Exchange — you deal ${Math.floor(playerDmg)}, take ${Math.floor(botDmg)} · HP: ${Math.max(0, Math.floor(playerHp))}`);
    }
  }

  const credits = playerWins ? Math.floor(randInt(200, 800) * (1 + gsDelta / 200)) : 0;
  const xp      = playerWins ? randInt(500, 1500) : randInt(100, 400);
  return { bot: { name: botName, gs: botGs, tier: tier.difficulty }, playerWins, log, credits, xp };
}

// ============================================================
// BOT WORLD ACTIVITY — feed events every ~4 min
// ============================================================
async function generateBotActivity(io) {
  try {
    const botA = randBot();
    let botB = randBot();
    while (botB === botA) botB = randBot();

    const events = [
      () => global.broadcastActivity(io, { type:'pvp',     text:`☠ ${botA} eliminated ${botB} in the Grønland Dark Zone` }),
      () => global.broadcastActivity(io, { type:'mission', text:`📍 ${botA} neutralized a 313-nettverket cell on Grønlandsleiret` }),
      () => global.broadcastActivity(io, { type:'mission', text:`⚔ ${botB} cleared B-Gjengen from Karl Johans Gate [STREET FIGHT]` }),
      () => global.broadcastActivity(io, { type:'loot',    text:`⚡ ${botA} found an EXOTIC drop raiding Balkan Brotherhood at Bjørvika` }),
      () => global.broadcastActivity(io, { type:'bounty',  text:`☠ BOUNTY: ${botA} placed 3,200¢ on ${botB} after Aker Brygge ambush` }),
      () => global.broadcastActivity(io, { type:'pvp',     text:`☠ ${botB} went ROGUE after eliminating a Bandidos informant in Frogner` }),
      () => global.broadcastActivity(io, { type:'mission', text:`🏰 ${botA} raided Comanches MC compound in Grünerløkka [HEROIC]` }),
      () => global.broadcastActivity(io, { type:'mission', text:`📍 ${botB} broke up Young Guns drug sales at Youngstorget` }),
      () => global.broadcastActivity(io, { type:'loot',    text:`⚡ ${botA} seized Balkan Brotherhood weapons cache at Tjuvholmen` }),
      () => global.broadcastActivity(io, { type:'pvp',     text:`☠ ${botA} and ${botB} clashed over the Ekeberg ridge extraction point` }),
      () => global.broadcastActivity(io, { type:'fightclub', text:`🥊 FIGHT CLUB: ${botA} defeated ${botB} [GS${randInt(200,450)} vs GS${randInt(150,380)}]` }),
      () => global.broadcastActivity(io, { type:'bounty',  text:`💰 ${botA} extorted ${randInt(400,2000).toLocaleString()}¢ from ${botB}` }),
    ];

    // Territory contest events — broadcast to map
  if (Math.random() < 0.3) {
    const districts = [
      { name:'Grønland', faction:'313-nettverket', x:0.68, y:0.38, challenger:'B-Gjengen' },
      { name:'Karl Johans Gate', faction:'B-Gjengen', x:0.50, y:0.40, challenger:'Young Guns' },
      { name:'Aker Brygge', faction:'Young Guns', x:0.28, y:0.58, challenger:'Balkan Brotherhood' },
      { name:'Grünerløkka', faction:'Comanches MC', x:0.72, y:0.22, challenger:'Bandidos Norway' },
    ];
    const contest = districts[Math.floor(Math.random() * districts.length)];
    io.emit('map:territory_contest', contest);
    global.broadcastActivity(io, {
      type:'pvp',
      text:`⚔ TERRITORY: ${contest.challenger} challenging ${contest.faction} for control of ${contest.name}`,
    });
  }

  events[Math.floor(Math.random() * events.length)]();
  } catch(err) { console.error('Bot activity error:', err.message); }
}

// PvP cooldown — 5 minutes between attacks per player
const pvpCooldowns = new Map(); // characterId → timestamp

// BOT AGGRESSION — bots attack real players every 5 min max per player
async function botAggressiveAction(io, connectedAgents) {
  try {
    if (connectedAgents.size === 0) return;

    // Pick a random connected real player who isn't on cooldown
    const agentList = [...connectedAgents.values()];
    const now = Date.now();
    const eligible = agentList.filter(a => {
      const last = pvpCooldowns.get(a.characterId) || 0;
      return now - last > 5 * 60 * 1000; // 5 min cooldown
    });
    if (eligible.length === 0) return;

    const target = eligible[Math.floor(Math.random() * eligible.length)];
    if (!target?.characterId) return;

    // Set cooldown for this player
    pvpCooldowns.set(target.characterId, now);

    // Fetch their character
    const charResult = await db.query('SELECT * FROM characters WHERE id=$1', [target.characterId]);
    if (!charResult.rows[0]) return;
    const char = charResult.rows[0];

    const botName = randBot();
    const botGs   = randInt(
      Math.max(80, char.gear_score - 80),
      char.gear_score + 60
    );

    // Pick a random aggression type
    const roll = Math.random();

    if (roll < 0.35) {
      // BOT PVP ATTACK
      const gsDelta = char.gear_score - botGs;
      const playerWins = Math.random() < Math.min(0.80, Math.max(0.20, 0.5 + gsDelta / 200));
      const creditsStolen = !playerWins ? randInt(100, 500) : 0;
      const xpGained = randInt(200, 600);

      if (!playerWins && creditsStolen > 0) {
        await db.query('UPDATE characters SET credits=GREATEST(0,credits-$1), xp=xp+$2 WHERE id=$3',
          [creditsStolen, xpGained, char.id]);
      } else {
        await db.query('UPDATE characters SET xp=xp+$1, pvp_kills=pvp_kills+1, respect=respect+15 WHERE id=$2',
          [xpGained, char.id]);
      }

      global.notifyAgent(io, char.id, 'bot:attacked', {
        botName, botGs,
        playerWins,
        creditsStolen,
        xpGained,
        message: playerWins
          ? `${botName} [GS${botGs}] attempted to eliminate you in the Dark Zone — you repelled the attack! +${xpGained} XP · +15★`
          : `${botName} [GS${botGs}] ambushed you — lost ${creditsStolen.toLocaleString()}¢. +${xpGained} XP`,
      });

      global.broadcastActivity(io, {
        type: 'pvp',
        text: playerWins
          ? `🛡 ${char.name} repelled ${botName} [GS${botGs}] in the Dark Zone`
          : `☠ ${botName} [GS${botGs}] eliminated ${char.name} — ${creditsStolen.toLocaleString()}¢ looted`,
      });

    } else if (roll < 0.55) {
      // BOT PLACES ACTUAL BOUNTY ON PLAYER in the DB
      const bountyAmt = randInt(500, 2500);
      try {
        // Find or create a bot "poster" character entry (use a special bot UUID constant)
        // For simplicity, place as a system bounty with null poster (skip FK for bots)
        await db.query(`
          INSERT INTO bounties (poster_id, target_id, reward, reason, expires_at)
          SELECT NULL, $1, $2, $3, NOW() + INTERVAL '6 hours'
          WHERE NOT EXISTS (
            SELECT 1 FROM bounties WHERE target_id=$1 AND claimed_by IS NULL AND expires_at > NOW()
          )
        `, [target.characterId, bountyAmt, `${botName} wants revenge — last seen in the Dark Zone`]).catch(() => {});
      } catch(_) {}

      global.notifyAgent(io, char.id, 'bot:bounty', {
        botName, amount: bountyAmt,
        message: `☠ ${botName} just posted a ${bountyAmt.toLocaleString()}¢ bounty on you — other agents are coming!`,
      });
      global.broadcastActivity(io, {
        type: 'bounty',
        text: `☠ BOUNTY: ${botName} posted ${bountyAmt.toLocaleString()}¢ on ${char.name} — wants payback`,
      });

    } else if (roll < 0.70) {
      // BOT EXTORTION DEMAND
      const demandAmt = randInt(300, 1500);
      global.notifyAgent(io, char.id, 'bot:extortion', {
        botName, amount: demandAmt,
        message: `💰 ${botName} demands ${demandAmt.toLocaleString()}¢ — pay or prepare for retaliation.`,
      });

    } else if (roll < 0.82) {
      // BOT TIPS OFF POLICE — attempted arrest via a mission fail simulation
      if (char.level >= 5) {
        global.notifyAgent(io, char.id, 'bot:arrest_tip', {
          botName,
          message: `🚔 ${botName} tipped off the Oslo PD about your last operation — watch your back on heroic missions.`,
        });
      }

    } else {
      // BOT CHALLENGES TO FIGHT CLUB
      global.notifyAgent(io, char.id, 'bot:challenge', {
        botName, botGs,
        message: `🥊 ${botName} [GS${botGs}] has challenged you to the Fight Club bracket this week!`,
      });
    }
  } catch(err) { console.error('Bot aggression error:', err.message); }
}

module.exports = { simulatePvpVsBot, generateBotActivity, botAggressiveAction, BOT_NAMES };
