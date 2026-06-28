// Oslo missions seed v2
/**
 * Division MMO — Database Initialization
 * Run: node server/db/init.js
 * Requires: PostgreSQL running + .env configured
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/division_mmo'
});

const schema = `
-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ,
  is_banned     BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- CHARACTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS characters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(32) NOT NULL,
  level           INT DEFAULT 1,
  xp              BIGINT DEFAULT 0,
  gear_score      INT DEFAULT 0,
  credits         BIGINT DEFAULT 500,
  crafting_mats   INT DEFAULT 0,
  dz_keys         INT DEFAULT 0,
  pvp_kills       INT DEFAULT 0,
  pvp_deaths      INT DEFAULT 0,
  missions_done   INT DEFAULT 0,
  respect         INT DEFAULT 0,
  is_rogue        BOOLEAN DEFAULT FALSE,
  rogue_timer     INT DEFAULT 0,
  is_jailed       BOOLEAN DEFAULT FALSE,
  jail_until      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================================
-- CLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS clans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(32) UNIQUE NOT NULL,
  tag          VARCHAR(6) UNIQUE NOT NULL,
  description  TEXT,
  leader_id    UUID REFERENCES characters(id),
  level        INT DEFAULT 1,
  xp           BIGINT DEFAULT 0,
  credits      BIGINT DEFAULT 0,
  is_bot       BOOLEAN DEFAULT FALSE,
  bot_gs       INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id      UUID REFERENCES clans(id) ON DELETE CASCADE,
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  role         VARCHAR(16) DEFAULT 'member', -- leader, officer, member
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (clan_id, character_id)
);

-- ============================================================
-- LOOT TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS item_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(64) NOT NULL,
  slot         VARCHAR(32) NOT NULL,  -- chest, mask, gloves, holster, legs, backpack, primary, secondary, sidearm
  rarity       VARCHAR(16) NOT NULL,  -- common, uncommon, rare, epic, named, exotic
  base_gs      INT NOT NULL,
  gs_variance  INT DEFAULT 5,
  is_named     BOOLEAN DEFAULT FALSE,
  is_exotic    BOOLEAN DEFAULT FALSE,
  talent       VARCHAR(64),           -- unique talent name if any
  flavor_text  TEXT,
  is_enabled   BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- PLAYER INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id    UUID REFERENCES characters(id) ON DELETE CASCADE,
  item_def_id     UUID REFERENCES item_definitions(id),
  gear_score      INT NOT NULL,
  is_equipped     BOOLEAN DEFAULT FALSE,
  slot_override   VARCHAR(32),
  stat_weapon_dmg INT DEFAULT 0,
  stat_armor      INT DEFAULT 0,
  stat_health     INT DEFAULT 0,
  stat_crit_hit   INT DEFAULT 0,
  stat_crit_dmg   INT DEFAULT 0,
  stat_skill_haste INT DEFAULT 0,
  acquired_at     TIMESTAMPTZ DEFAULT NOW(),
  acquired_from   VARCHAR(64)  -- mission name, pvp, crafting, etc.
);

-- ============================================================
-- MISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS missions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(64) NOT NULL,
  description   TEXT,
  type          VARCHAR(16) NOT NULL,  -- mission, expedition, raid, bounty, daily
  difficulty    VARCHAR(16) DEFAULT 'normal', -- story, normal, hard, challenging, heroic
  map_x         FLOAT DEFAULT 0.5,
  map_y         FLOAT DEFAULT 0.5,
  min_gs        INT DEFAULT 0,
  xp_reward     INT DEFAULT 500,
  credit_reward INT DEFAULT 250,
  loot_rolls    INT DEFAULT 2,
  loot_bonus_rarity VARCHAR(16), -- guaranteed rarity tier minimum
  duration_secs INT DEFAULT 30,  -- simulated mission time
  is_daily      BOOLEAN DEFAULT FALSE,
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS mission_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID REFERENCES characters(id) ON DELETE CASCADE,
  mission_id    UUID REFERENCES missions(id),
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  success       BOOLEAN,
  loot_earned   JSONB DEFAULT '[]'
);

-- ============================================================
-- BASES (Clan Capture Points)
-- ============================================================
CREATE TABLE IF NOT EXISTS bases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(64) NOT NULL,
  zone            VARCHAR(32) NOT NULL,
  map_x           FLOAT DEFAULT 0.5,
  map_y           FLOAT DEFAULT 0.5,
  held_by_clan    UUID REFERENCES clans(id) ON DELETE SET NULL,
  captured_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  defense_rating  INT DEFAULT 100,
  bonus_type      VARCHAR(32)  -- loot_boost, xp_boost, credit_boost
);

CREATE TABLE IF NOT EXISTS base_battles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id         UUID REFERENCES bases(id),
  attacker_clan   UUID REFERENCES clans(id),
  defender_clan   UUID REFERENCES clans(id),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  winner_clan     UUID REFERENCES clans(id),
  attacker_score  INT DEFAULT 0,
  defender_score  INT DEFAULT 0
);

-- ============================================================
-- PVP / DARK ZONE
-- ============================================================
CREATE TABLE IF NOT EXISTS pvp_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id   UUID REFERENCES characters(id),
  defender_id   UUID REFERENCES characters(id),
  zone          VARCHAR(32),
  attacker_won  BOOLEAN,
  loot_stolen   JSONB DEFAULT '[]',
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ACTIVITY FEED (Global)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_feed (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(32) NOT NULL,  -- pvp_kill, exotic_drop, base_capture, mission_complete
  actor_name  VARCHAR(32),
  target_name VARCHAR(32),
  detail      TEXT,
  is_rogue    BOOLEAN DEFAULT FALSE,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LEADERBOARD SNAPSHOTS (updated hourly via cron)
-- ============================================================
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  type        VARCHAR(32) NOT NULL,
  rank        INT NOT NULL,
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  clan_id     UUID REFERENCES clans(id) ON DELETE SET NULL,
  value       BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (type, rank)
);

-- Daily contracts (3 per day, reset at midnight)
CREATE TABLE IF NOT EXISTS daily_contracts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day          DATE NOT NULL DEFAULT CURRENT_DATE,
  slot         INT NOT NULL CHECK (slot IN (1,2,3)),
  type         VARCHAR(32) NOT NULL,  -- missions, kills, caches, darkzone
  target       INT NOT NULL,
  xp_reward    INT NOT NULL DEFAULT 1000,
  credit_reward INT NOT NULL DEFAULT 500,
  description  TEXT NOT NULL,
  UNIQUE(day, slot)
);

-- Contract progress per character
CREATE TABLE IF NOT EXISTS contract_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  contract_id  UUID REFERENCES daily_contracts(id) ON DELETE CASCADE,
  progress     INT NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT false,
  claimed      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(character_id, contract_id)
);

-- Bounty board
CREATE TABLE IF NOT EXISTS bounties (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id    UUID REFERENCES characters(id) ON DELETE CASCADE,
  target_id    UUID REFERENCES characters(id) ON DELETE CASCADE,
  reward       INT NOT NULL,
  reason       TEXT,
  claimed_by   UUID REFERENCES characters(id) ON DELETE SET NULL,
  claimed_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Loot cache events (server-wide)
CREATE TABLE IF NOT EXISTS cache_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spawned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  map_x        FLOAT NOT NULL,
  map_y        FLOAT NOT NULL,
  district     VARCHAR(64),
  rarity       VARCHAR(16) NOT NULL DEFAULT 'named',
  claimed_by   UUID REFERENCES characters(id) ON DELETE SET NULL,
  claimed_at   TIMESTAMPTZ
);

-- Jail events — agents arrested after failed heroic missions
CREATE TABLE IF NOT EXISTS jail_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prisoner_id  UUID REFERENCES characters(id) ON DELETE CASCADE,
  jailbreak_bounty  INT NOT NULL DEFAULT 500,
  released_by  UUID REFERENCES characters(id) ON DELETE SET NULL,
  released_at  TIMESTAMPTZ,
  auto_release BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- Extortion demands
CREATE TABLE IF NOT EXISTS extortions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extorter_id   UUID REFERENCES characters(id) ON DELETE CASCADE,
  target_id     UUID REFERENCES characters(id) ON DELETE CASCADE,
  amount        INT NOT NULL,
  paid          BOOLEAN DEFAULT FALSE,
  deadline      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '12 hours',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Drug labs (hashplantasje) — passive income
CREATE TABLE IF NOT EXISTS drug_labs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  UUID REFERENCES characters(id) ON DELETE CASCADE UNIQUE,
  tier          INT DEFAULT 1,  -- 1=stash house, 2=lab, 3=plantation
  invested      INT DEFAULT 0,
  last_payout   TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Fight club brackets
CREATE TABLE IF NOT EXISTS fight_club (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week          INT NOT NULL,
  year          INT NOT NULL,
  entrant_id    UUID REFERENCES characters(id) ON DELETE CASCADE,
  wins          INT DEFAULT 0,
  losses        INT DEFAULT 0,
  eliminated    BOOLEAN DEFAULT FALSE,
  entry_fee     INT DEFAULT 1000,
  UNIQUE(week, year, entrant_id)
);

-- Clan PvP attacks
CREATE TABLE IF NOT EXISTS clan_attacks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_clan UUID REFERENCES clans(id) ON DELETE CASCADE,
  defender_clan UUID REFERENCES clans(id) ON DELETE CASCADE,
  attacker_won  BOOLEAN,
  credits_looted INT DEFAULT 0,
  xp_gained     INT DEFAULT 0,
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Recalibration log (one reroll per item)
CREATE TABLE IF NOT EXISTS recalibrations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE UNIQUE,
  stat_changed VARCHAR(32) NOT NULL,
  old_value    INT NOT NULL,
  new_value    INT NOT NULL,
  cost         INT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory(character_id);
CREATE INDEX IF NOT EXISTS idx_inventory_equipped ON inventory(character_id, is_equipped);
CREATE INDEX IF NOT EXISTS idx_mission_runs_character ON mission_runs(character_id);
CREATE INDEX IF NOT EXISTS idx_pvp_events_attacker ON pvp_events(attacker_id);
CREATE INDEX IF NOT EXISTS idx_pvp_events_defender ON pvp_events(defender_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_time ON activity_feed(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_clan_members_clan ON clan_members(clan_id);
CREATE INDEX IF NOT EXISTS idx_bounties_target ON bounties(target_id);
CREATE INDEX IF NOT EXISTS idx_bounties_active ON bounties(expires_at) WHERE claimed_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_progress_char ON contract_progress(character_id);
CREATE INDEX IF NOT EXISTS idx_cache_events_active ON cache_events(expires_at) WHERE claimed_by IS NULL;
`;

const seedMissions = `
DELETE FROM mission_runs;
DELETE FROM missions;
INSERT INTO missions (name, description, type, difficulty, map_x, map_y, min_gs, xp_reward, credit_reward, loot_rolls, loot_bonus_rarity, duration_secs) VALUES
('Aker Brygge Pier',    'Young Guns have seized the Aker Brygge ferry terminals. The 2006 waterfront shootout started here — finish it.',                   'mission',    'hard',        0.28, 0.58, 100, 2400, 1200, 3, 'rare',   45),
('Karl Johans Gate',    'B-Gjengen control every block from Stortinget to Jernbanetorget. Street fight down the main boulevard.',                            'street_fight','challenging', 0.50, 0.40, 200, 3600, 2000, 3, 'epic',   60),
('Gronland Sweep',      '313-nettverket has fortified Grønland. Intel points to a weapons cache on Grønlandsleiret. Neutralize the cell.',                  'expedition', 'heroic',      0.68, 0.38, 350, 6000, 4000, 4, 'named',  90),
('Operahuset',          'Balkan Brotherhood turned the Opera House into an arms staging ground. Serbian passports, Yugoslav-era weapons. Assault at dawn.',  'stronghold', 'heroic',      0.60, 0.62, 400, 8000, 5000, 4, 'named',  90),
('Frogner Park',        'Bandidos Norway spotted caching weapons near Vigelandsparken. Arms trafficking enforcer — take him down.',                          'bounty',     'challenging', 0.18, 0.28, 200, 2000, 1000, 2, 'rare',   40),
('Grunerloekka Raid',   'Comanches MC barricaded Thorvald Meyers gate. Banned by the Supreme Court — they have nothing left to lose. 4 agents required.',   'raid',       'heroic',      0.72, 0.22, 450,12000, 8000, 6, 'exotic', 180),
('Stortinget',          'B-Gjengen are using parliament square as a narcotics dead drop. Shut it down before morning crowds arrive.',                        'mission',    'challenging', 0.44, 0.36, 200, 3200, 1800, 3, 'epic',   60),
('Ekeberg Ridge',       'Three factions — Young Guns, 313, and Balkan Brotherhood — fighting over Ekeberg ridge. Dark Zone extraction point active.',        'dark_zone',  'heroic',      0.76, 0.68, 300, 1800,  500, 2, 'epic',   30),
('Daily Youngstorget',  'Young Guns running open-air drug sales from Youngstorget. Clear the square before market hours.',                                   'daily',      'normal',      0.55, 0.32,   0, 1200,  600, 2, 'rare',   30),
('Tjuvholmen Base',     'Balkan Brotherhood money-laundering hub in the gallery district. Accountants, enforcers, Serbian passports. Raid the compound.',    'base_raid',  'heroic',      0.20, 0.66, 300, 4000, 2000, 4, 'named',  120)
;
`;

const seedItems = `
DELETE FROM inventory;
DELETE FROM item_definitions;
INSERT INTO item_definitions (name, slot, rarity, base_gs, gs_variance, is_named, is_exotic, talent, flavor_text) VALUES
-- EXOTICS (GS 490-500, fixed)
('Eagle Bearer',   'primary',  'exotic', 500, 0, false, true,  'Tenacity',            'The eagle always finds its prey.'),
('Nemesis',        'primary',  'exotic', 500, 0, false, true,  'Nemesis',             'Justice, delayed but never denied.'),
('Merciless',      'primary',  'exotic', 500, 0, false, true,  'Binary Trigger',      'No mercy for the wicked.'),
('Chameleon',      'primary',  'exotic', 495, 0, false, true,  'Adaptive Instincts',  'Adapt or die.'),
('Pestilence',     'primary',  'exotic', 495, 0, false, true,  'Plague of Oslo',      'The city was already sick before we arrived.'),
('The Chatterbox', 'primary',  'exotic', 490, 0, false, true,  'Incessant Chatter',   'Never stops talking. Never misses.'),
('Bullet King',    'primary',  'exotic', 490, 0, false, true,  'Never Empty',         'The mag never runs dry.'),
('Providence Mask','mask',     'exotic', 500, 0, false, true,  'Scholar',             'Knowledge is the ultimate weapon.'),
('Contractor Gloves','gloves', 'exotic', 495, 0, false, true,  'Contractor',          'Every contract fulfilled.'),
-- NAMED (GS 440-480)
('Vanguard Faceplate', 'mask',     'named', 460, 10, true, false, 'Protector',     'Shield those who cannot shield themselves.'),
('Atlas Backplate',    'chest',    'named', 470, 10, true, false, 'Armor Kit',     'Issued to field commanders only.'),
('Gunslinger Rig',     'holster',  'named', 455, 10, true, false, 'Fast Hands',    'Draw faster. Survive longer.'),
('Tactician Kneepads', 'legs',     'named', 460, 10, true, false, 'Deft Hands',    'Tactical movement under fire.'),
('Striker Gloves',     'gloves',   'named', 455, 10, true, false, 'Killing Machine','Every hit counts double.'),
('Atlas Backpack',     'backpack', 'named', 465, 10, true, false, 'Vigilance',     'Field-tested. Division-approved.'),
('NordRifle Mk.IV',    'primary',  'named', 475, 8,  true, false, 'Overwatch',     'Patience rewarded.'),
('SHD Sidearm Pro',    'sidearm',  'named', 450, 8,  true, false, 'Precision',     'Issue weapon. Never returned.'),
('Berserker SMG',      'secondary','named', 465, 8,  true, false, 'Bloodlust',     'The more it hurts, the faster it fires.'),
-- EPIC (GS 350-420)
('Overlord Chest',     'chest',    'epic',  400, 25, false, false, 'Unbreakable', NULL),
('Operative Mask',     'mask',     'epic',  385, 25, false, false, 'Focus',       NULL),
('Assault Kneepads',   'legs',     'epic',  375, 25, false, false, 'Tenacity',    NULL),
('Marksman Gloves',    'gloves',   'epic',  380, 25, false, false, 'Precision',   NULL),
('Combat Holster',     'holster',  'epic',  370, 25, false, false, 'Swift',       NULL),
('Enforcer Backpack',  'backpack', 'epic',  390, 25, false, false, 'Hardened',    NULL),
('Punisher Rifle',     'primary',  'epic',  410, 20, false, false, 'Strained',    NULL),
('Vector SMG',         'secondary','epic',  405, 20, false, false, 'Killer',      NULL),
('SHD Sidearm',        'sidearm',  'epic',  380, 20, false, false, 'Responsive',  NULL),
-- RARE / HIGH-END (GS 220-320)
('Operator Chest',    'chest',    'rare',  270, 40, false, false, NULL, NULL),
('Field Mask',        'mask',     'rare',  255, 40, false, false, NULL, NULL),
('Ranger Legs',       'legs',     'rare',  250, 40, false, false, NULL, NULL),
('Assault Gloves',    'gloves',   'rare',  245, 40, false, false, NULL, NULL),
('Patrol Holster',    'holster',  'rare',  240, 40, false, false, NULL, NULL),
('Scout Backpack',    'backpack', 'rare',  255, 40, false, false, NULL, NULL),
('M4 Carbine',        'primary',  'rare',  280, 35, false, false, NULL, NULL),
('Glock Sidearm',     'sidearm',  'rare',  260, 35, false, false, NULL, NULL),
('MP5 SMG',           'secondary','rare',  265, 35, false, false, NULL, NULL),
-- COMMON / UNCOMMON (GS 100-200)
('Standard Vest',     'chest',    'common', 150, 40, false, false, NULL, NULL),
('Standard Mask',     'mask',     'common', 140, 40, false, false, NULL, NULL),
('Patrol Legs',       'legs',     'common', 135, 40, false, false, NULL, NULL),
('Basic Gloves',      'gloves',   'common', 130, 40, false, false, NULL, NULL),
('Pistol Mk.1',       'sidearm',  'common', 145, 35, false, false, NULL, NULL),
('Field Holster',     'holster',  'common', 125, 40, false, false, NULL, NULL),
('Basic Backpack',    'backpack', 'common', 132, 40, false, false, NULL, NULL),
('Standard Rifle',    'primary',  'common', 155, 35, false, false, NULL, NULL),
('Compact SMG',       'secondary','common', 148, 35, false, false, NULL, NULL)
ON CONFLICT DO NOTHING;
`;

const seedBases = `
INSERT INTO bases (name, zone, map_x, map_y, defense_rating, bonus_type) VALUES
('Warlord Compound',   'Dark Zone North',  0.78, 0.55, 150, 'loot_boost'),
('Financial Tower',    'Dark Zone Central',0.55, 0.45, 120, 'credit_boost'),
('Midtown Outpost',    'Midtown',          0.35, 0.25, 100, 'xp_boost'),
('Harbor Control',     'South Perimeter',  0.20, 0.70, 80,  'loot_boost')
ON CONFLICT DO NOTHING;
`;

async function init() {
  const client = await pool.connect();
  try {
    console.log('🔧 Initializing Division MMO database...\n');
    await client.query(schema);
    console.log('✅ Schema created');
    // Migrate existing DB
    await client.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS respect INT DEFAULT 0`);
    await client.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_jailed BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS jail_until TIMESTAMPTZ`);
    await client.query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS bot_gs INT DEFAULT 0`);
    // Drop global unique constraint on character names if it exists
    await client.query(`ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_name_key`).catch(() => {});
    await client.query(seedMissions);
    console.log('✅ Missions seeded');
    await client.query(seedItems);
    console.log('✅ Item definitions seeded');
    await client.query(seedBases);
    console.log('✅ Bases seeded');

    // Seed bot clans (Oslo criminal faction gangs)
    await client.query(`
      INSERT INTO clans (name, tag, description, is_bot, bot_gs, level, xp, credits) VALUES
      ('Young Guns',         'YG',   'Waterfront crew. Ran Aker Brygge in the 2000s.',                         true, 180, 8,  420000, 95000),
      ('B-Gjengen',          'BG',   'Karl Johans gate and Tøyen. Oldest rivalry in Oslo.',                    true, 220, 10, 580000, 140000),
      ('313-nettverket',     '313',  'Grønland crew. Street-level but dangerous.',                             true, 195, 9,  490000, 110000),
      ('Balkan Brotherhood', 'BB',   'Serbian-Montenegrin arms network. Operate out of Bjørvika.',             true, 340, 15, 920000, 280000),
      ('Bandidos Norway',    'BDN',  'Five Norwegian chapters. Drug and arms trafficking.',                    true, 290, 13, 770000, 210000),
      ('Comanches MC',       'CMC',  'Banned by the Supreme Court 2024. Nothing left to lose.',               true, 370, 16, 1050000, 320000)
      ON CONFLICT (name) DO UPDATE SET is_bot=true, bot_gs=EXCLUDED.bot_gs, level=EXCLUDED.level, xp=EXCLUDED.xp, credits=EXCLUDED.credits
    `);
    console.log('✅ Bot clans seeded');
    console.log('\n🎮 Database ready! Run: npm start\n');
  } catch (err) {
    console.error('❌ Init error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

init();
