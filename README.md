# THE DIVISION — DARK ZONE MMO

A text-based tactical MMO inspired by Tom Clancy's The Division. Features persistent loot, PvP, clan warfare, base capture, leaderboards, and real-time events.

---

## TECH STACK

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Node.js + Express                   |
| Real-time | Socket.io (global chat, feed, PvP)  |
| Database  | PostgreSQL                          |
| Auth      | JWT + bcrypt                        |
| Frontend  | Vanilla HTML5/CSS3/JS + Canvas API  |

---

## QUICK START

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 2. Clone & Install
```bash
git clone <your-repo>
cd division-mmo
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your database URL and a strong JWT secret
```

### 4. Create Database
```bash
# In psql:
CREATE DATABASE division_mmo;

# Then run schema + seed:
node server/db/init.js
```

### 5. Start Server
```bash
npm start        # production
npm run dev      # development with nodemon
```

Open **http://localhost:3000** in your browser.

---

## FEATURES

### Authentication
- Register with username, email, password, and agent name
- JWT sessions (7-day expiry)
- Character auto-created on registration

### Mission System
- 10 missions across 6 types: Expedition, Mission, Stronghold, Raid, Dark Zone, Bounty
- 5 difficulty tiers: Story → Normal → Hard → Challenging → Heroic
- Gear score gating (min GS requirements)
- Daily missions with 24h cooldown
- XP + credit rewards scale with difficulty

### Loot Engine
- 5 rarity tiers: Common, Rare (High-End), Epic, Named, Exotic
- Difficulty modifiers shift rarity weights (Heroic = 6x exotic chance)
- Per-item stat rolls: Weapon DMG, Armor, Health, Crit Hit, Crit DMG, Skill Haste
- Talents on Named/Epic items
- 4 cache types purchasable with credits (Standard → Exotic)

### Gear Score
- Calculated as average GS across all equipped items
- Updates automatically on equip/unequip
- Drives combat power (DPS, armor, health)

### PvP / Dark Zone
- 3 DZ zones with contamination levels
- Rogue system: attacking non-rogue players marks you ROGUE
- Loot stealing on kill (unequipped items)
- Pay 2,000 Credits to clear rogue status
- K/D tracking, zone history

### Clans
- Create a clan for 5,000 Credits (max 20 members)
- Member roles: Leader, Officer, Member
- Online status tracking (active in last 15 min)
- Base capture system

### Base Capture
- 4 capturable bases across the map
- Clan-vs-clan assault system (GS 300+ required)
- 24-hour hold timer
- Bonuses: loot_boost, xp_boost, credit_boost

### Leaderboards
- 4 types: Gear Score, PvP Kills, Missions Completed, Clan GS
- Shows player's own rank even outside top 50
- Hourly cache refresh

### Real-time (Socket.io)
- Global chat
- Activity feed (exotic drops, base captures, PvP kills)
- Agent online/offline notifications

---

## DATABASE SCHEMA

```
users             — auth accounts
characters        — player stats, gear score, credits, XP
clans             — clan info, level, bank
clan_members      — membership + roles
item_definitions  — loot pool (35 items seeded)
inventory         — player-owned items with rolled stats
missions          — 10 seeded missions
mission_runs      — run history with loot records
bases             — 4 capturable bases
base_battles      — battle resolution history
pvp_events        — kill/death records
activity_feed     — global event log
leaderboard_cache — hourly snapshots
```

---

## API ENDPOINTS

```
POST /api/auth/register        — Register + auto-create character
POST /api/auth/login           — Login, returns JWT
GET  /api/auth/me              — Profile + character + clan

GET  /api/missions             — List all missions
POST /api/missions/:id/run     — Run a mission (combat + loot)
GET  /api/missions/history     — Run history

GET  /api/inventory            — Equipped + stash
POST /api/inventory/:id/equip  — Equip item
POST /api/inventory/:id/sell   — Sell item for credits
POST /api/inventory/open-cache — Open a loot cache

GET  /api/clans                — List all clans
GET  /api/clans/mine           — My clan + members + bases
POST /api/clans                — Create clan (5,000 ¢)
POST /api/clans/:id/join       — Join clan
POST /api/clans/leave          — Leave clan
GET  /api/clans/bases          — All capturable bases
POST /api/clans/bases/:id/attack — Attack a base

GET  /api/pvp/zones            — Dark Zone status
POST /api/pvp/attack/:id       — Attack another player
GET  /api/pvp/feed             — Activity feed
GET  /api/pvp/stats            — Personal PvP stats
POST /api/pvp/rogue/clear      — Pay bounty to clear rogue

GET  /api/leaderboard/:type    — gear_score|pvp_kills|missions|clans
```

---

## EXTENDING THE GAME

### Add New Missions
Insert into the `missions` table. Fields to set:
- `type`: mission, expedition, raid, stronghold, dark_zone, bounty
- `difficulty`: story, normal, hard, challenging, heroic
- `map_x/map_y`: 0.0–1.0 map position
- `loot_bonus_rarity`: guaranteed minimum rarity for first loot roll

### Add New Items
Insert into `item_definitions`. Set `is_named=true` or `is_exotic=true` for special items.

### Add New Zones / Bases
Insert into `bases` table. Set `bonus_type` for the clan benefit.

### Production Deployment
- Set `NODE_ENV=production`
- Use a process manager (PM2)
- Put behind nginx reverse proxy
- Use PostgreSQL with connection pooling (PgBouncer)
- Store JWT_SECRET in environment, not code
- Consider Redis for session caching + Socket.io adapter for multi-instance

---

## FOLDER STRUCTURE

```
division-mmo/
├── server/
│   ├── index.js          — Express + Socket.io server
│   ├── db/
│   │   ├── pool.js       — PostgreSQL connection pool
│   │   └── init.js       — Schema + seed data
│   ├── engine/
│   │   ├── loot.js       — Loot generation, gear score
│   │   └── combat.js     — PvE/PvP combat resolution
│   ├── middleware/
│   │   └── auth.js       — JWT middleware
│   └── routes/
│       ├── auth.js
│       ├── missions.js
│       ├── inventory.js
│       ├── clans.js
│       ├── pvp.js
│       └── leaderboard.js
├── public/
│   ├── index.html        — SPA shell
│   ├── css/main.css      — Full game UI styles
│   └── js/
│       ├── api.js        — API client
│       ├── map.js        — Canvas map engine
│       └── game.js       — Game controller
├── .env.example
├── package.json
└── README.md
```
