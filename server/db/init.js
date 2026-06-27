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
  is_rogue        BOOLEAN DEFAULT FALSE,
  rogue_timer     INT DEFAULT 0,
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
  type        VARCHAR(32) NOT NULL,  -- gear_score, pvp_kills, missions, clan_gs
  rank        INT NOT NULL,
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  clan_id     UUID REFERENCES clans(id) ON DELETE SET NULL,
  value       BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (type, rank)
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
`;

const seedMissions = `
INSERT INTO missions (name, description, type, difficulty, map_x, map_y, min_gs, xp_reward, credit_reward, loot_rolls, loot_bonus_rarity, duration_secs) VALUES
('Lincoln Tunnel',       'Secure the Lincoln Tunnel entrance and push back Rikers forces.',             'expedition', 'hard',        0.18, 0.28, 100, 2400, 1200, 3, 'rare',   45),
('Rooftop Comms',        'Restore SHD communication towers across Midtown.',                            'mission',    'challenging', 0.42, 0.18, 200, 3600, 2000, 3, 'epic',   60),
('Grand Washington',     'Assault the Grand Washington Hotel — Hunters inside.',                        'stronghold', 'heroic',      0.65, 0.38, 350, 6000, 4000, 4, 'named',  90),
('DZ South Landmark',    'Claim the contaminated cache at the South landmark.',                         'dark_zone',  'challenging', 0.28, 0.58, 150, 1800, 500,  2, 'epic',   30),
('Wall Street',          'Push through Wall Street and reach the evacuation point.',                    'mission',    'normal',      0.55, 0.65, 0,   900,  450,  2, 'common', 30),
('Warlord Base Assault', 'Assault the Warlord-held base — clan capture point.',                        'base_raid',  'heroic',      0.78, 0.55, 300, 4000, 2000, 4, 'named',  120),
('Times Square Sweep',   'Neutralize rogue agents operating in Times Square.',                         'bounty',     'hard',        0.38, 0.40, 200, 2000, 1000, 2, 'rare',   40),
('Dark Hours Raid',      'Four-agent incursion into the Occupied Dark Zone — exotic tier rewards.',     'raid',       'heroic',      0.50, 0.30, 450, 12000,8000, 6, 'exotic', 180),
('Supply Drop',          'Intercept an enemy supply convoy before it reaches the base.',               'mission',    'hard',        0.25, 0.75, 150, 1600, 800,  2, 'rare',   35),
('Campus Rescue',        'Evacuate civilians trapped on the NYU campus.',                              'mission',    'story',       0.70, 0.20, 0,   500,  200,  1, 'common', 20)
ON CONFLICT DO NOTHING;
`;

const seedItems = `
INSERT INTO item_definitions (name, slot, rarity, base_gs, gs_variance, is_named, is_exotic, talent, flavor_text) VALUES
-- EXOTICS
('Eagle Bearer',   'primary',  'exotic', 155, 0, false, true,  'Tenacity',       'The eagle always finds its prey.'),
('Nemesis',        'primary',  'exotic', 155, 0, false, true,  'Nemesis',        'Justice, delayed but never denied.'),
('Merciless',      'primary',  'exotic', 155, 0, false, true,  'Binary Trigger', 'No mercy for the wicked.'),
('Chameleon',      'primary',  'exotic', 155, 0, false, true,  'Adaptive Instincts','Adapt or die.'),
('Pestilence',     'primary',  'exotic', 155, 0, false, true,  'Plague of the Outcasts','Spread the sickness.'),
('The Chatterbox', 'primary',  'exotic', 155, 0, false, true,  'Incessant Chatter','Never stops talking. Never misses.'),
('Bullet King',    'primary',  'exotic', 155, 0, false, true,  'Never Empty',    'The mag never runs dry.'),
-- NAMED
('Vanguard Faceplate', 'mask',     'named', 152, 2, true, false, 'Protector',   'Shield those who cannot shield themselves.'),
('Atlas Backplate',    'chest',    'named', 150, 3, true, false, 'Armor Kit',   'Issued to field commanders only.'),
('Gunslinger Rig',     'holster',  'named', 148, 2, true, false, 'Fast Hands',  'Draw faster. Survive longer.'),
('Tactician Kneepads', 'legs',     'named', 150, 2, true, false, 'Deft Hands',  'Tactical movement under fire.'),
('Striker Gloves',     'gloves',   'named', 148, 3, true, false, 'Killing Machine','Every hit counts double.'),
('Atlas Backpack',     'backpack', 'named', 150, 2, true, false, 'Vigilance',   'Field-tested. Division-approved.'),
-- EPIC
('Overlord Chest',     'chest',    'epic',  148, 5, false, false, 'Unbreakable', NULL),
('Operative Mask',     'mask',     'epic',  145, 5, false, false, 'Focus',       NULL),
('Assault Kneepads',   'legs',     'epic',  144, 5, false, false, 'Tenacity',    NULL),
('Marksman Gloves',    'gloves',   'epic',  146, 5, false, false, 'Precision',   NULL),
('Combat Holster',     'holster',  'epic',  143, 5, false, false, 'Swift',       NULL),
('Enforcer Backpack',  'backpack', 'epic',  145, 5, false, false, 'Hardened',    NULL),
('Punisher Rifle',     'primary',  'epic',  148, 4, false, false, 'Strained',    NULL),
('Vector SMG',         'secondary','epic',  148, 4, false, false, 'Killer',      NULL),
-- RARE / HIGH-END
('Operator Chest',    'chest',    'rare',  140, 8, false, false, NULL, NULL),
('Field Mask',        'mask',     'rare',  138, 8, false, false, NULL, NULL),
('Ranger Legs',       'legs',     'rare',  137, 8, false, false, NULL, NULL),
('Assault Gloves',    'gloves',   'rare',  135, 8, false, false, NULL, NULL),
('Patrol Holster',    'holster',  'rare',  133, 8, false, false, NULL, NULL),
('Scout Backpack',    'backpack', 'rare',  136, 8, false, false, NULL, NULL),
('M4 Carbine',        'primary',  'rare',  140, 6, false, false, NULL, NULL),
('Glock Sidearm',     'sidearm',  'rare',  138, 6, false, false, NULL, NULL),
-- COMMON / UNCOMMON
('Standard Vest',     'chest',    'common',100,15, false, false, NULL, NULL),
('Standard Mask',     'mask',     'common', 95,15, false, false, NULL, NULL),
('Patrol Legs',       'legs',     'common', 92,15, false, false, NULL, NULL),
('Basic Gloves',      'gloves',   'common', 90,15, false, false, NULL, NULL),
('Pistol Mk.1',       'sidearm',  'common', 95,10, false, false, NULL, NULL)
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
    // Drop global unique constraint on character names if it exists (names only need to be unique per user)
    await client.query(`
      ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_name_key;
    `).catch(() => {}); // ignore if already gone
    await client.query(seedMissions);
    console.log('✅ Missions seeded');
    await client.query(seedItems);
    console.log('✅ Item definitions seeded');
    await client.query(seedBases);
    console.log('✅ Bases seeded');
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
