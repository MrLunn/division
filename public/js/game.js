// Oslo map integration
/**
 * Division MMO — Game Controller
 * Manages auth, views, and all game state/actions
 */

const Game = {
  token: null,
  user: null,
  character: null,
  clan: null,
  socket: null,
  currentItemId: null,
  missions: [],

  // ============================================================
  // INIT
  // ============================================================
  async init() {
    this.token = localStorage.getItem('div_token');
    if (this.token) {
      try {
        const data = await API.auth.me();
        this.user = data.user;
        this.character = data.character;
        this.clan = data.clan;
        this.showGame();
      } catch {
        localStorage.removeItem('div_token');
        this.showAuth();
      }
    } else {
      this.showAuth();
    }
  },

  showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
  },

  showGame() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    this.connectSocket();
    this.updateHUD();
    this.loadView('map');
    setTimeout(() => this.checkActiveEvent(), 2000);
    setTimeout(() => this.dailyIntelDrop(), 3000);
  },

  dailyIntelDrop() {
    const lastDrop = localStorage.getItem('division_last_drop');
    const today = new Date().toDateString();
    if (lastDrop === today) return; // already got today's drop
    localStorage.setItem('division_last_drop', today);

    const drops = [
      { text:'⚡ INTEL DROP: SHD network detected a supply crate near Youngstorget — mission XP doubled for 1 hour', type:'xp' },
      { text:'⚡ INTEL DROP: B-Gjengen shipment intercepted — all Dark Zone loot quality boosted today', type:'loot' },
      { text:'⚡ INTEL DROP: Oslo PD on high alert — arrest chance on heroic missions halved until midnight', type:'safe' },
      { text:'⚡ INTEL DROP: Underground poker den is hot tonight — winnings multiplied by 1.5x', type:'credits' },
      { text:'⚡ INTEL DROP: Comanches MC territory is undefended — raid success rate boosted by 20%', type:'raid' },
      { text:'⚡ INTEL DROP: Classified cache spotted near Operahuset — check the cache event timer', type:'cache' },
    ];
    const drop = drops[Math.floor(Math.random() * drops.length)];

    // Big animated banner
    setTimeout(() => {
      this.notify(drop.text, 'success', 10000);
      this.flashScreen('#39ff14');
      // Also prepend to feed
      this.prependFeed({ type:'cache_spawn', text: drop.text });
    }, 1500);
  },

  // ============================================================
  // SOCKET
  // ============================================================
  connectSocket() {
    if (typeof io === 'undefined') return;
    this.socket = io({ auth: { token: this.token } });

    this.socket.on('connect', () => {
      this.socket.emit('agent:register', {
        characterId: this.character.id,
        characterName: this.character.name,
      });
    });

    this.socket.on('feed:activity', (event) => this.prependFeed(event));

    this.socket.on('chat:message', ({ sender, message, time }) => {
      this.appendChat(sender, message, time);
    });

    this.socket.on('world:agent_online', ({ name }) => {
      if (name !== this.character.name)
        this.notify(`${name} deployed to the field`, 'info');
    });

    // Bounty placed on you
    this.socket.on('bounty:placed', ({ reward, poster, reason }) => {
      const alertEl  = document.getElementById('bounty-alert');
      const alertTxt = document.getElementById('bounty-alert-text');
      if (alertEl && alertTxt) {
        alertTxt.innerHTML = `<strong style="color:var(--accent)">${poster}</strong> posted ${Number(reward).toLocaleString()} ¢ on your head${reason ? `<br><em style="color:var(--muted2)">"${reason}"</em>` : ''}`;
        alertEl.style.display = 'block';
      }
      this.notify(`☠ You have a bounty on your head! ${Number(reward).toLocaleString()} ¢`, 'error', 6000);
      this.flashScreen('#e74c3c');
    });

    // Arrested
    this.socket.on('jail:arrested', ({ minutes, eventId }) => {
      if (this.character) {
        this.character.is_jailed = true;
        this.character.jail_until = new Date(Date.now() + minutes * 60000).toISOString();
      }
      this.updateHUD();
      this._jailEventId = eventId;
      this.notify(`🚔 ARRESTED — ${minutes} minutes in custody. Post a jailbreak bounty to get out faster!`, 'error', 8000);
      this.flashScreen('#e74c3c');
      // Show jail indicator
      const jailEl = document.getElementById('jail-indicator');
      if (jailEl) jailEl.style.display = 'flex';
    });

    // BOT ATTACKS — bots actively target you
    this.socket.on('bot:attacked', ({ botName, botGs, playerWins, creditsStolen, xpGained, message }) => {
      if (playerWins) {
        this.notify(`🛡 ${message}`, 'success', 6000);
        this.flashScreen('#2ecc71');
      } else {
        this.notify(`☠ ${message}`, 'error', 7000);
        this.flashScreen('#e74c3c');
        // Shake the HUD bar
        const hudBar = document.getElementById('hud-bar');
        if (hudBar) { hudBar.style.animation = 'hudShake 0.4s ease'; setTimeout(() => { hudBar.style.animation = ''; }, 400); }
        // Pulse the health bar red
        const healthBar = document.getElementById('hud-health-bar');
        if (healthBar) { healthBar.style.background = '#e74c3c'; setTimeout(() => { healthBar.style.background = 'var(--health)'; }, 800); }
      }
      API.auth.me().then(me => { this.character = me.character; this.updateHUD(); }).catch(() => {});
    });

    this.socket.on('bot:bounty', ({ botName, amount, message }) => {
      this.notify(`☠ ${message}`, 'error', 8000);
      this.flashScreen('#e74c3c');
      // Show bounty alert banner
      const alertEl  = document.getElementById('bounty-alert');
      const alertTxt = document.getElementById('bounty-alert-text');
      if (alertEl && alertTxt) {
        alertTxt.innerHTML = `<strong style="color:var(--red)">${botName}</strong> posted <strong>${amount.toLocaleString()}¢</strong> on your head`;
        alertEl.style.display = 'block';
        setTimeout(() => { alertEl.style.display = 'none'; }, 10000);
      }
    });

    this.socket.on('bot:extortion', ({ botName, amount, message }) => {
      this.notify(`💰 ${message}`, 'error', 7000);
      this.flashScreen('#e8890c');
    });

    this.socket.on('bot:arrest_tip', ({ botName, message }) => {
      this.notify(`🚔 ${message}`, 'error', 6000);
    });

    this.socket.on('bot:challenge', ({ botName, botGs, message }) => {
      this.notify(`🥊 ${message}`, '', 6000);
    });

    // Territory contests on the map
    this.socket.on('map:territory_contest', (contest) => {
      if (MapEngine && MapEngine.triggerTerritoryContest) {
        MapEngine.triggerTerritoryContest(contest);
      }
      this.notify(`⚔ ${contest.challenger} vs ${contest.faction} — ${contest.name} is contested!`, 'error', 5000);
    });

    // Released from jail
    this.socket.on('jail:released', ({ by }) => {
      if (this.character) { this.character.is_jailed = false; this.character.jail_until = null; }
      this.updateHUD();
      this.notify(`🔓 Broken out by ${by}! Back in action.`, 'success', 5000);
      this.flashScreen('#2ecc71');
    });

    // Extortion demands
    this.socket.on('extortion:demand', ({ from, amount, hoursLeft }) => {
      this.notify(`💰 ${from} demands ${amount.toLocaleString()}¢ — pay within ${hoursLeft}h or face consequences`, 'error', 8000);
      this.flashScreen('#e8890c');
    });
    this.socket.on('extortion:paid', ({ from, amount }) => {
      this.notify(`💰 ${from} paid your ${amount.toLocaleString()}¢ demand · +30★`, 'success', 4000);
    });
    this.socket.on('extortion:refused', ({ by }) => {
      this.notify(`⚠ ${by} refused your demand — retaliate!`, 'error', 5000);
    });
    this.socket.on('pvp:attacked', ({ by, iWon }) => {
      if (iWon) {
        this.notify(`🛡 ${by} attacked you but failed!`, 'success', 4000);
      } else {
        this.notify(`☠ ${by} eliminated you in a leaderboard attack!`, 'error', 5000);
        this.flashScreen('#e74c3c');
      }
    });

    // Cache event spawned
    this.socket.on('event:cache_spawned', (event) => {
      this.showCacheEvent(event);
      this.notify(`⚡ CACHE EVENT: ${event.rarity.toUpperCase()} cache at ${event.district}!`, 'success', 5000);
    });

    // Cache event claimed by someone else
    this.socket.on('event:cache_claimed', ({ claimedBy, district }) => {
      const banner = document.getElementById('cache-event-banner');
      const text   = document.getElementById('cache-event-text');
      if (banner) {
        if (text) text.textContent = `${district} cache secured by ${claimedBy}`;
        const btn = document.getElementById('cache-event-btn');
        if (btn) btn.style.display = 'none';
        if (this._eventTimer) clearInterval(this._eventTimer);
        setTimeout(() => { if (banner) banner.style.display = 'none'; }, 5000);
      }
    });
  },

  // ============================================================
  // HUD
  // ============================================================
  // Criminal rank titles — inspired by Nordic Mafia
  RANKS: [
    { minLevel: 1,  title: 'Wannabe',    color: '#628098' },
    { minLevel: 4,  title: 'Bråkmaker',  color: '#e8890c' },
    { minLevel: 8,  title: 'Gangster',   color: '#e74c3c' },
    { minLevel: 13, title: 'Løytnant',   color: '#8e44ad' },
    { minLevel: 18, title: 'Capo',       color: '#2980b9' },
    { minLevel: 23, title: 'Underboss',  color: '#16a085' },
    { minLevel: 27, title: 'Don',        color: '#e67e22' },
  ],

  getRank(level) {
    let rank = this.RANKS[0];
    for (const r of this.RANKS) {
      if (level >= r.minLevel) rank = r;
      else break;
    }
    return rank;
  },

  updateHUD() {
    const c = this.character;
    if (!c) return;

    const rank = this.getRank(c.level || 1);
    const prevRank = this._lastRank;
    if (prevRank && prevRank.title !== rank.title) {
      // RANK UP!
      this.notify(`⬆ RANK UP — You are now a ${rank.title.toUpperCase()}!`, 'success', 8000);
      this.flashScreen(rank.color);
      const nameEl = document.getElementById('hud-name');
      if (nameEl) { nameEl.classList.remove('rank-up'); void nameEl.offsetWidth; nameEl.classList.add('rank-up'); }
    }
    this._lastRank = rank;

    // Name + rank badge
    document.getElementById('hud-name').textContent = c.name;
    const levelEl = document.getElementById('hud-level');
    if (levelEl) {
      levelEl.innerHTML = `<span style="color:${rank.color};font-weight:700">${rank.title}</span> <span style="color:var(--muted2);font-size:10px">LV.${c.level}</span>`;
    }

    // Respect
    const respectEl = document.getElementById('hud-respect');
    if (respectEl) respectEl.textContent = (c.respect || 0).toLocaleString();

    // Jail indicator
    const jailEl = document.getElementById('jail-indicator');
    if (jailEl) {
      if (c.is_jailed && c.jail_until && new Date(c.jail_until) > new Date()) {
        const minsLeft = Math.ceil((new Date(c.jail_until) - Date.now()) / 60000);
        jailEl.style.display = 'flex';
        jailEl.innerHTML = `🚔 IN CUSTODY — ${minsLeft}m remaining`;
      } else {
        jailEl.style.display = 'none';
      }
    }

    // Animate GS if it changed
    const gsEl = document.getElementById('hud-gs');
    const prevGs = parseInt(gsEl?.textContent) || 0;
    const newGs = c.gear_score || 0;
    if (gsEl && prevGs !== newGs && prevGs !== 0) {
      this.animateGSTick(prevGs, newGs);
      gsEl.classList.remove('gs-pop');
      void gsEl.offsetWidth;
      gsEl.classList.add('gs-pop');
    } else if (gsEl) {
      gsEl.textContent = newGs;
    }

    document.getElementById('hud-credits').textContent = parseInt(c.credits || 0).toLocaleString() + ' ¢';

    const hp    = Math.min(100, 50 + (c.gear_score || 0) / 10);
    const armor = Math.min(100, 30 + (c.gear_score || 0) / 15);
    const xp    = Math.min(100, ((c.xp % 10000) / 10000) * 100);

    document.getElementById('hud-health-bar').style.width = hp + '%';
    document.getElementById('hud-armor-bar').style.width  = armor + '%';
    document.getElementById('hud-xp-bar').style.width     = xp + '%';

    const hn = document.getElementById('hud-health-num');
    const an = document.getElementById('hud-armor-num');
    const xn = document.getElementById('hud-xp-num');
    if (hn) hn.textContent = Math.round(hp) + '%';
    if (an) an.textContent = Math.round(armor) + '%';
    if (xn) xn.textContent = Math.round(xp) + '%';

    // Goal / next rank progress
    const goalEl = document.getElementById('rank-progress');
    if (goalEl && c.level) {
      const nextRank = this.RANKS.find(r => r.minLevel > (c.level || 1));
      if (nextRank) {
        const prevRankLevel = rank.minLevel;
        const levelsNeeded  = nextRank.minLevel - prevRankLevel;
        const levelsGained  = (c.level - prevRankLevel);
        const pct = Math.min(100, (levelsGained / levelsNeeded) * 100);
        goalEl.innerHTML = `
          <div style="font-size:9px;letter-spacing:2px;color:var(--muted2);margin-bottom:3px">NEXT RANK</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;font-weight:700;color:${nextRank.color}">${nextRank.title}</span>
            <div style="flex:1;height:4px;background:var(--border)">
              <div style="height:100%;width:${pct}%;background:${nextRank.color};transition:width 0.8s ease"></div>
            </div>
            <span style="font-size:10px;color:var(--muted2)">LV${nextRank.minLevel}</span>
          </div>`;
      } else {
        goalEl.innerHTML = `<div style="font-size:11px;color:var(--exotic);letter-spacing:2px">★ MAX RANK — DON ★</div>`;
      }
    }

    const rogueIndicator = document.getElementById('rogue-indicator');
    if (rogueIndicator) rogueIndicator.style.display = c.is_rogue ? 'block' : 'none';
  },

  notify(msg, type = '', duration = 3000) {
    const b = document.getElementById('notif-banner');
    b.textContent = msg;
    b.className = 'notif-banner' + (type ? ` ${type}` : '');
    b.style.display = 'block';
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => b.style.display = 'none', duration);
  },

  // ============================================================
  // VIEW SWITCHING
  // ============================================================
  loadView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));

    const view = document.getElementById(`view-${name}`);
    if (view) view.classList.add('active');

    const btn = document.querySelector(`[data-view="${name}"]`);
    if (btn) btn.classList.add('active');

    const loaders = {
      map:         () => this.loadMapView(),
      inventory:   () => this.loadInventoryView(),
      contracts:   () => this.loadContractsView(),
      bounties:    () => this.loadBountiesView(),
      jail:        () => this.loadJailView(),
      extortion:   () => this.loadExtortionView(),
      druglab:     () => this.loadDrugLabView(),
      fightclub:   () => this.loadFightClubView(),
      poker:       () => this.loadPokerView(),
      darkzone:    () => this.loadDarkZoneView(),
      clans:       () => this.loadClansView(),
      leaderboard: () => this.loadLeaderboardView(),
    };
    loaders[name]?.();
  },

  // ============================================================
  // MAP VIEW
  // ============================================================
  async loadMapView() {
    MapEngine.init();
    this._initBotAgentGS();
    try {
      const { missions } = await API.missions.list();
      this.missions = missions;
      MapEngine.setMissions(missions);
      MapEngine.start();
      this.renderMissionList(missions);
    } catch (e) {
      this.notify(e.message, 'error');
    }
    try {
      const { feed } = await API.pvp.feed();
      this.renderFeed(feed);
    } catch {}
  },

  renderMissionList(missions) {
    const el = document.getElementById('mission-list');
    if (!el) return;
    const diffColor = { normal:'var(--socom-green)', challenging:'var(--socom-amber)', hard:'#ff8c00', heroic:'var(--socom-red)' };
    el.innerHTML = missions.slice(0, 8).map(m => {
      const dc = diffColor[m.difficulty] || 'var(--socom-green)';
      return `
        <div class="mission-brief" style="margin-bottom:6px;cursor:pointer" onclick="window.Game.runMission('${m.id}','${m.name}')">
          <div class="brief-header">${m.type?.replace('_',' ').toUpperCase()} // GS ${m.min_gs || '0'}+</div>
          <div class="brief-designator">
            <span class="key">OBJECTIVE:</span><span class="val">${m.name}</span>
          </div>
          <div class="brief-designator">
            <span class="key">CLEARANCE:</span><span class="val" style="color:${dc}">${m.difficulty?.toUpperCase()}</span>
          </div>
        </div>`;
    }).join('');
  },

  renderFeed(feedItems) {
    const el = document.getElementById('activity-feed');
    if (!el) return;
    el.innerHTML = (feedItems || []).slice(0, 25).map(f => {
      const text = f.text || (f.actor_name ? `${f.actor_name}: ${f.detail}` : f.detail || '');
      const cls  = this._feedClass(f.type);
      return `<div class="feed-item ${cls}" style="animation:feedIn 0.3s ease">${text}</div>`;
    }).join('') || '<div class="feed-item">Waiting for field activity...</div>';
  },

  _feedClass(type) {
    if (!type) return '';
    if (['pvp','pvp_kill','arrest','jailbreak','clan_raid_win'].includes(type)) return 'pvp';
    if (['exotic_drop','cache_claimed','cache_spawn'].includes(type)) return 'exotic';
    if (['base_capture','clan_raid_loss'].includes(type)) return 'base';
    if (['bounty','bounty_claimed','extortion'].includes(type)) return 'pvp';
    if (['fightclub'].includes(type)) return 'exotic';
    return 'complete';
  },

  prependFeed(event) {
    const el = document.getElementById('activity-feed');
    if (!el) return;
    const text = event.text || (event.actor_name ? `${event.actor_name}: ${event.detail}` : '');
    if (!text) return;
    const cls  = this._feedClass(event.type);
    // SOCOM-style prefix codes
    const prefixes = {
      pvp:           'KIA //', bounty: 'INTEL //', jailbreak: 'EXTRACT //',
      arrest:        'DETAIN //', cache_spawn: 'CACHE //', cache_claimed: 'SECURED //',
      mission:       'OPS //', loot: 'INTEL //', fightclub: 'ARENA //',
      complete:      'OPS //', extortion: 'INTEL //', clan_raid_win: 'RAID //',
    };
    const prefix = prefixes[event.type] || '// ';
    const item = document.createElement('div');
    item.className = `feed-item ${cls}`;
    item.style.animation = 'feedIn 0.4s ease';
    item.innerHTML = `<span style="opacity:0.45;margin-right:6px">${prefix}</span>${text}`;
    el.prepend(item);
    if (el.children.length > 30) el.lastChild.remove();
  },

  // ============================================================
  // RUN MISSION
  // ============================================================
  async runMission(missionId, missionName) {
    const modal = document.getElementById('mission-modal');
    const titleEl = document.getElementById('mission-modal-title');
    const logEl = document.getElementById('mission-combat-log');
    const lootEl = document.getElementById('mission-loot-reveal');
    const lootItems = document.getElementById('mission-loot-items');

    titleEl.textContent = `DEPLOYING — ${missionName.toUpperCase()}`;
    logEl.innerHTML = '<span style="color:var(--muted2)">Initializing mission...</span>';
    lootEl.style.display = 'none';
    modal.style.display = 'flex';

    try {
      const result = await API.missions.run(missionId);

      // Render combat log line by line with delay
      logEl.innerHTML = '';
      for (let i = 0; i < result.combatLog.length; i++) {
        await this.delay(80);
        const line = document.createElement('div');
        const txt = result.combatLog[i];
        if (txt.startsWith('✅')) line.className = 'log-success';
        else if (txt.startsWith('❌')) line.className = 'log-fail';
        else line.className = 'log-hit';
        line.textContent = txt;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
      }

      const succeeded = result.success;
      titleEl.innerHTML = succeeded
        ? `<span style="color:var(--socom-green);font-family:var(--font-hud);letter-spacing:4px">[ MISSION COMPLETE ]</span><div style="font-size:11px;color:rgba(57,255,20,0.5);margin-top:4px;letter-spacing:3px">${missionName.toUpperCase()}</div>`
        : `<span style="color:var(--socom-red);font-family:var(--font-hud);letter-spacing:4px">[ MISSION FAILED ]</span><div style="font-size:11px;color:rgba(255,34,0,0.5);margin-top:4px;letter-spacing:3px">${missionName.toUpperCase()}</div>`;

      if (result.success && result.loot?.length > 0) {
        await this.delay(400);
        lootEl.style.display = 'block';
        lootItems.innerHTML = '';

        for (const item of result.loot) {
          // Stagger by rarity — rarer items drop slower for tension
          const delay = item.rarity === 'exotic' ? 900
                      : item.rarity === 'named'  ? 700
                      : item.rarity === 'epic'   ? 500 : 300;
          await this.delay(delay);
          lootItems.appendChild(this.buildLootCard(item));

          if (item.rarity === 'exotic') {
            this.notify(`⚡ EXOTIC DROP: ${item.name}!`, 'exotic', 5000);
            this.flashScreen('#e67e22');
          } else if (item.rarity === 'named') {
            this.notify(`✨ NAMED ITEM: ${item.name}`, 'success', 4000);
            this.flashScreen('#16a085');
          } else if (item.rarity === 'epic') {
            this.notify(`◆ EPIC GEAR: ${item.name}`, '', 2500);
          }
        }

        // Update rewards display
        if (result.rewards) {
          const rewards = document.createElement('div');
          rewards.style.cssText = 'margin-top:12px;font-size:12px;color:var(--accent);font-family:var(--font-hud)';
          rewards.textContent = `+${result.rewards.xp.toLocaleString()} XP   +${result.rewards.credits.toLocaleString()} ¢`;
          lootEl.appendChild(rewards);
        }

        // Refresh character data
        const me = await API.auth.me();
        this.character = me.character;
        this.updateHUD();
      }
    } catch (e) {
      logEl.innerHTML = `<div class="log-fail">${e.message}</div>`;
      titleEl.textContent = 'MISSION BLOCKED';
    }
  },

  // Custom SVG icons — tactical/military line art, no emoji
  SLOT_ICONS: {
    mask: {
      label: 'MASK',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3C7 3 4 6 4 10v5c0 2 1.5 4 3 5l1 1h8l1-1c1.5-1 3-3 3-5v-5c0-4-3-7-8-7z"/>
        <path d="M8 11c0 1 .8 2 1.5 2s1.5-1 1.5-2"/>
        <path d="M13 11c0 1 .8 2 1.5 2s1.5-1 1.5-2"/>
        <path d="M9 16h6"/>
        <path d="M4 10h2M18 10h2"/>
      </svg>`
    },
    chest: {
      label: 'CHEST',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 4h14l1 4H4L5 4z"/>
        <path d="M4 8v11a1 1 0 001 1h14a1 1 0 001-1V8"/>
        <path d="M9 8v4M15 8v4"/>
        <path d="M10 12h4"/>
        <path d="M7 14h2M15 14h2"/>
        <path d="M6 17h12"/>
      </svg>`
    },
    gloves: {
      label: 'GLOVES',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 20V10.5a1.5 1.5 0 013 0V15"/>
        <path d="M11 13V9a1.5 1.5 0 013 0v4"/>
        <path d="M14 11.5V10a1.5 1.5 0 013 0v5"/>
        <path d="M17 13.5v-2a1.5 1.5 0 013 0V17a6 6 0 01-6 6H9a6 6 0 01-6-6v-3.5"/>
        <path d="M3 13.5V10a1.5 1.5 0 013 0V20"/>
      </svg>`
    },
    holster: {
      label: 'HOLSTER',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="13" height="8" rx="1"/>
        <path d="M16 7h3a1 1 0 011 1v1a1 1 0 01-1 1h-3"/>
        <path d="M8 11v10l2 1 2-1V11"/>
        <path d="M5 7h5M5 5h3"/>
      </svg>`
    },
    legs: {
      label: 'LEGS',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 2h10v8l-2 6-1 3a1 1 0 01-2 0l-1-3-2-6V2z"/>
        <path d="M7 2L5 14l1 4 2 4h2"/>
        <path d="M17 2l2 12-1 4-2 4h-2"/>
        <path d="M7 8h10"/>
        <path d="M9 2v6M15 2v6"/>
      </svg>`
    },
    backpack: {
      label: 'BACKPACK',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="7" width="16" height="14" rx="2"/>
        <path d="M8 7V5a4 4 0 018 0v2"/>
        <path d="M9 7v14M15 7v14"/>
        <path d="M4 13h4M16 13h4"/>
        <rect x="9" y="12" width="6" height="5" rx="1"/>
      </svg>`
    },
    primary: {
      label: 'PRIMARY',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 14h14v-4H2v4z"/>
        <path d="M16 13h2l3-1v-2l-3-1h-2"/>
        <path d="M6 10V8l-1-1H4v5h1l1-1v-2zM10 10V8"/>
        <path d="M8 14v3h2l1-3"/>
        <path d="M14 10h-2"/>
      </svg>`
    },
    secondary: {
      label: 'SECONDARY',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 13h10v-3H2v3z"/>
        <path d="M12 12.5h2l2-.5v-1l-2-.5h-2"/>
        <path d="M4 10V8.5L3 8H2v4h1l1-.5V10zM7 10V8.5"/>
        <path d="M6 13v2.5h2l.5-2.5"/>
        <path d="M16 11.5h4l2-.5v-1l-2-.5h-4"/>
      </svg>`
    },
    sidearm: {
      label: 'SIDEARM',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 8h11l3 2v2H4V8z"/>
        <path d="M18 10h2v1.5"/>
        <path d="M7 12v5h3v-3l1-2"/>
        <path d="M4 8V6h3v2"/>
        <path d="M13 8v4"/>
        <path d="M6 9.5h5"/>
      </svg>`
    },
  },

  STAT_META: {
    stat_health:      { label: 'HEALTH BONUS',  color: '#2ecc71', icon: '♥' },
    stat_armor:       { label: 'ARMOR RATING',  color: '#5dade2', icon: '◈' },
    stat_weapon_dmg:  { label: 'WEAPON DAMAGE', color: '#e74c3c', icon: '⚔' },
    stat_crit_hit:    { label: 'CRIT CHANCE',   color: '#f4a116', icon: '◎' },
    stat_crit_dmg:    { label: 'CRIT DAMAGE',   color: '#e67e22', icon: '💥' },
    stat_skill_haste: { label: 'SKILL HASTE',   color: '#af7ac5', icon: '⚡' },
  },

  buildLootCard(item) {
    const div = document.createElement('div');
    div.className = 'loot-item-card';
    div.style.borderLeftColor = this.rarityColor(item.rarity);

    const slotInfo = this.SLOT_ICONS[item.slot] || { icon: '◆', label: (item.slot || '').toUpperCase() };
    const statsHtml = this.renderStatBars(item.stats);
    const isWeapon = ['primary','secondary','sidearm'].includes(item.slot);

    div.innerHTML = `
      <div class="lic-header">
        <div class="lic-slot-icon" style="color:${this.rarityColor(item.rarity)};width:36px;height:36px;flex-shrink:0">${slotInfo.icon}</div>
        <div class="lic-header-info">
          <div class="lic-name" style="color:${this.rarityColor(item.rarity)}">${item.name}
            <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span>
          </div>
          <div class="lic-slot">${slotInfo.label} · ${isWeapon ? 'WEAPON' : 'GEAR'}</div>
        </div>
        <div class="lic-gs-block">
          <div class="lic-gs">${item.gear_score}</div>
          <div style="font-size:9px;color:var(--muted2);letter-spacing:1px">GS</div>
        </div>
      </div>
      ${item.talent ? `<div class="lic-talent">⚡ ${item.talent}</div>` : ''}
      ${statsHtml}
      ${item.flavor_text ? `<div class="lic-flavor">"${item.flavor_text}"</div>` : ''}
    `;

    if (item.rarity === 'exotic' || item.rarity === 'named') {
      div.classList.add('loot-shimmer');
    }
    return div;
  },

  renderStatBars(itemOrStats) {
    if (!itemOrStats) return '';
    // Normalise: flat DB row has stat_* keys directly; loot card has a stats sub-object
    const STAT_KEYS = ['stat_health','stat_armor','stat_weapon_dmg','stat_crit_hit','stat_crit_dmg','stat_skill_haste'];
    let stats = {};
    if (itemOrStats.stat_health !== undefined || itemOrStats.stat_armor !== undefined) {
      // Flat DB row
      STAT_KEYS.forEach(k => { if (itemOrStats[k] > 0) stats[k] = itemOrStats[k]; });
    } else {
      // Nested stats object
      stats = itemOrStats;
    }
    const active = Object.entries(stats).filter(([, v]) => v > 0);
    if (active.length === 0) return '';
    return `<div class="lic-stats-grid">${
      active.map(([key, val]) => {
        const meta = this.STAT_META[key] || { label: key, color: '#888', icon: '◆' };
        const pct = Math.min(100, (val / 35) * 100);
        return `<div class="stat-row">
          <span class="stat-icon" style="color:${meta.color}">${meta.icon}</span>
          <span class="stat-label">${meta.label}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%;background:${meta.color}"></div></div>
          <span class="stat-val" style="color:${meta.color}">+${val}%</span>
        </div>`;
      }).join('')
    }</div>`;
  },

  formatStats(stats) {
    if (!stats) return '';
    return Object.entries(stats)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${v}% ${k.replace('stat_','').replace(/_/g,' ').toUpperCase()}`)
      .join('  ');
  },

  rarityColor(rarity) {
    const c = { common: '#556070', rare: '#2980b9', epic: '#8e44ad', named: '#16a085', exotic: '#e67e22' };
    return c[rarity] || '#888';
  },

  renderEquipped(items) {
    const slots = ['mask','chest','gloves','holster','legs','backpack','primary','secondary','sidearm'];
    const el = document.getElementById('equipped-grid');
    el.innerHTML = slots.map(slot => {
      const info = this.SLOT_ICONS[slot] || { icon: '◆', label: slot.toUpperCase() };
      const item = items.find(i => i.slot === slot);
      if (!item) {
        return `<div class="gear-slot empty">
          <div class="gear-slot-icon" style="width:32px;height:32px;opacity:0.25;color:var(--muted2)">${info.icon}</div>
          <div class="gear-slot-label">${info.label}</div>
          <div class="gear-slot-empty-text">EMPTY</div>
        </div>`;
      }
      const topStat = item.stats
        ? Object.entries(item.stats).filter(([,v]) => v > 0).sort(([,a],[,b]) => b - a)[0]
        : null;
      const m = topStat ? this.STAT_META[topStat[0]] : null;
      const statLine = m
        ? `<div class="gear-top-stat" style="color:${m.color}">${m.icon} +${topStat[1]}% ${m.label}</div>`
        : '';
      return `<div class="gear-slot" onclick="window.Game.showItem('${item.id}')">
        <div class="gear-slot-icon" style="width:32px;height:32px;color:${this.rarityColor(item.rarity)}">${info.icon}</div>
        <div class="gear-slot-label">${info.label}</div>
        <div class="gs-item-name" style="color:${this.rarityColor(item.rarity)}">${item.name}</div>
        <div class="gs-item-gs">${item.gear_score}</div>
        <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span>
        ${statLine}
      </div>`;
    }).join('');
  },

  renderStash(items) {
    const el = document.getElementById('stash-list');
    document.getElementById('stash-count').textContent = `${items.length} items`;
    if (items.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:16px 0;text-align:center">Run missions to earn loot</div>';
      return;
    }
    el.innerHTML = items.map(item => {
      const info = this.SLOT_ICONS[item.slot] || { icon: '◆', label: (item.slot||'').toUpperCase() };
      const topStat = item.stats
        ? Object.entries(item.stats).filter(([,v]) => v > 0).sort(([,a],[,b]) => b - a)[0]
        : null;
      const m = topStat ? this.STAT_META[topStat[0]] : null;
      return `<div class="stash-item" onclick="window.Game.showItem('${item.id}')">
        <div class="si-icon" style="width:28px;height:28px;flex-shrink:0;color:${this.rarityColor(item.rarity)}">${info.icon}</div>
        <div class="si-gs" style="color:${this.rarityColor(item.rarity)}">${item.gear_score}</div>
        <div class="si-info">
          <div class="si-name" style="color:${this.rarityColor(item.rarity)}">${item.name}</div>
          <div class="si-slot">${info.label} <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span></div>
          ${m ? `<div style="font-size:10px;color:${m.color};margin-top:2px">${m.icon} +${topStat[1]}% ${m.label}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  },


  // ============================================================
  // INVENTORY VIEW
  // ============================================================
  async loadInventoryView() {
    try {
      const inv = await API.inventory.get();
      this._inventory = inv;
      document.getElementById('inv-gs-display').textContent = `GS ${inv.gearScore}`;
      this.renderEquipped(inv.equipped);
      this.renderStash(inv.stash);
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },





  showItem(id) {
    const all = [...(this._inventory?.equipped || []), ...(this._inventory?.stash || [])];
    const item = all.find(i => i.id === id);
    if (!item) return;

    this.currentItemId = id;
    const modal    = document.getElementById('item-modal');
    const content  = document.getElementById('item-modal-content');
    const equipBtn = document.getElementById('item-equip-btn');
    const sellBtn  = document.getElementById('item-sell-btn');

    const info = this.SLOT_ICONS[item.slot] || { icon: '◆', label: (item.slot||'').toUpperCase() };
    const isEquipped = item.is_equipped;
    const isWeapon = ['primary','secondary','sidearm'].includes(item.slot);
    const rarityValues = { common: 50, rare: 200, epic: 600, named: 1500, exotic: 5000 };
    const sellValue = (rarityValues[item.rarity] || 50) + Math.floor(item.gear_score * 2);
    const statsHtml = this.renderStatBars(item);

    content.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px">
        <div style="width:52px;height:52px;flex-shrink:0;color:${this.rarityColor(item.rarity)}">${info.icon}</div>
        <div style="flex:1">
          <div style="font-size:9px;letter-spacing:3px;color:var(--muted2)">${info.label} · ${isWeapon ? 'WEAPON' : 'GEAR'}${isEquipped ? ' · <span style=\'color:var(--health)\'>● EQUIPPED</span>' : ''}</div>
          <div style="font-size:20px;font-weight:700;color:${this.rarityColor(item.rarity)};margin:4px 0">${item.name}</div>
          <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span>
          ${item.talent ? `<div style="margin-top:8px;font-size:11px;color:var(--cyan);padding:4px 8px;background:rgba(26,188,156,0.08);border-left:2px solid var(--cyan)">⚡ ${item.talent}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-hud);font-size:42px;font-weight:700;color:var(--accent);line-height:1">${item.gear_score}</div>
          <div style="font-size:9px;color:var(--muted2);letter-spacing:2px">GEAR SCORE</div>
          <div style="font-size:12px;color:var(--green);margin-top:6px;font-family:var(--font-hud)">${sellValue.toLocaleString()} ¢</div>
          <div style="font-size:9px;color:var(--muted);letter-spacing:1px">SELL VALUE</div>
        </div>
      </div>
      <div style="font-size:9px;letter-spacing:3px;color:var(--muted2);margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px">STATS</div>
      ${statsHtml || '<div style="color:var(--muted);font-size:11px;padding:6px 0">No bonus stats on this item</div>'}
      ${item.flavor_text ? `<div style="margin-top:12px;font-size:10px;color:var(--muted);font-style:italic;border-top:1px solid var(--border);padding-top:8px">"${item.flavor_text}"</div>` : ''}
      <div style="margin-top:10px;padding:8px 10px;background:var(--bg3);border:1px solid var(--border);font-size:10px;color:var(--muted2);line-height:1.6">
        <span style="color:var(--accent);letter-spacing:1px">// LOOT TIERS UNLOCK BY LEVEL</span><br>
        Rare LV3 · Epic LV8 · Named LV15 · Exotic LV22
      </div>
    `;

    equipBtn.textContent = isEquipped ? 'UNEQUIP' : `EQUIP (${(item.slot||'').toUpperCase()})`;
    equipBtn.onclick = isEquipped ? () => this.unequipItem(id) : () => this.equipCurrentItem();
    sellBtn.style.display = isEquipped ? 'none' : 'inline-block';
    modal.style.display = 'flex';
  },

  async sellAllJunk() {
    // Sells all common + rare unequipped items by default
    const rarity = 'rare'; // sells common + rare
    if (!confirm(`Sell all Common & Rare items from your stash?\nEpic, Named and Exotic items are kept.`)) return;
    try {
      const result = await API.inventory.sellAll(rarity);
      this.notify(result.message, 'success');
      this.loadInventoryView();
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },


  async equipCurrentItem() {
    try {
      const result = await API.inventory.equip(this.currentItemId);
      this.notify(result.message, 'success');
      hideModal('item-modal');
      this.loadInventoryView();
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async unequipItem(id) {
    try {
      const result = await API.inventory.unequip(id);
      this.notify('Item unequipped', 'success');
      hideModal('item-modal');
      this.loadInventoryView();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async sellCurrentItem() {
    try {
      const result = await API.inventory.sell(this.currentItemId);
      this.notify(result.message, 'success');
      hideModal('item-modal');
      this.loadInventoryView();
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async openCache(type) {
    try {
      const result = await API.inventory.openCache(type);
      const item = result.item;
      const cacheResult = document.getElementById('cache-result');
      cacheResult.style.display = 'block';
      cacheResult.innerHTML = '';
      cacheResult.appendChild(this.buildLootCard(item));

      if (item.rarity === 'exotic') this.notify(`⚡ EXOTIC: ${item.name}!`, 'exotic', 5000);
      else if (item.rarity === 'named') this.notify(`✨ NAMED ITEM: ${item.name}`, 'success', 4000);
      else this.notify(`Received: ${item.name}`, '', 2000);

      await this.delay(200);
      this.loadInventoryView();
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  // ============================================================
  // DARK ZONE VIEW
  // ============================================================
  async loadDarkZoneView() {
    try {
      const [{ zones, occupiedBases }, pvpStats, { feed }] = await Promise.all([
        API.pvp.zones(),
        API.pvp.stats(),
        API.pvp.feed(),
      ]);

      this.renderZones(zones);
      this.renderBases(occupiedBases);
      this.renderPvpStats(pvpStats);
      this.renderPvpFeed(feed);
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  renderZones(zones) {
    const el = document.getElementById('dz-zones');
    const statuses = { high: ['HOSTILE', '#e74c3c'], medium: ['CONTESTED', '#f4a116'], low: ['CLEAR', '#27ae60'] };
    el.innerHTML = zones.map(z => {
      const [label, color] = statuses[z.contamination] || ['CLEAR', '#27ae60'];
      return `<div class="zone-card" style="border-left-color:${color}" onclick="window.Game.notify('Entering ${z.name}...')">
        <div>
          <div class="zc-name">${z.name}</div>
          <div class="zc-info">${z.agentCount} agents · ${z.contamination} contamination${z.rogueCount > 0 ? ` · ${z.rogueCount} ROGUES` : ''}</div>
        </div>
        <div class="zc-status" style="color:${color}">${label}</div>
      </div>`;
    }).join('');
  },

  renderBases(bases) {
    const el = document.getElementById('dz-bases');
    if (!bases?.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">No bases currently occupied by clans</div>';
      return;
    }
    el.innerHTML = bases.map(b => `
      <div class="base-card">
        <div class="bc-name">${b.base_name}</div>
        <div class="bc-info">Held by [${b.clan_tag}] ${b.clan_name} · ${b.zone}</div>
        <button class="base-attack-btn" onclick="window.Game.attackBase('${b.base_id}')">⚔ ASSAULT BASE</button>
      </div>
    `).join('');
  },

  renderPvpStats(stats) {
    const el = document.getElementById('pvp-stats-display');
    el.innerHTML = `
      <div class="pvp-stat-row"><span class="pvs-label">PVP KILLS</span><span class="pvs-val">${stats.kills}</span></div>
      <div class="pvp-stat-row"><span class="pvs-label">DEATHS</span><span class="pvs-val">${stats.deaths}</span></div>
      <div class="pvp-stat-row"><span class="pvs-label">K/D RATIO</span><span class="pvs-val">${stats.kd}</span></div>
      <div class="pvp-stat-row"><span class="pvs-label">ZONES ENTERED</span><span class="pvs-val">${stats.zonesEntered}</span></div>
    `;
  },

  renderPvpFeed(feed) {
    const el = document.getElementById('pvp-feed');
    el.innerHTML = (feed || []).slice(0, 20).map(f => {
      const isRogue = f.is_rogue;
      const color = isRogue ? 'var(--red)' : f.type === 'base_capture' ? 'var(--purple)' : 'var(--muted2)';
      return `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11px;font-family:var(--font-hud);color:${color}">
        ${f.actor_name}: ${f.detail} ${isRogue ? '[ROGUE]' : ''}
      </div>`;
    }).join('');
  },

  // Give bots their GS values so the map tooltip shows them
  _initBotAgentGS() {
    if (!window.MapEngine) return;
    const gsMap = {
      'Ghost_Larsen': 280, 'IronFjord': 440, 'NordAgent': 320,
      'Viper_Oslo': 195, 'SHD_Wraith': 475,
    };
    MapEngine.botAgents.forEach(b => { b.gs = gsMap[b.name] || 220; });
  },

  async attackBotOnMap(botName, botGs) {
    try {
      this.notify(`Engaging ${botName}...`, '', 1000);
      await this.delay(900);
      const result = await API.post('/pvp/attack-bot');
      // Override result display to show map-bot context
      const logEl = document.getElementById('pvp-combat-log');
      if (logEl) {
        logEl.style.display = 'block';
        logEl.innerHTML = [
          `<div style="color:var(--muted2);font-size:10px;letter-spacing:2px;margin-bottom:6px">// MAP ENCOUNTER: ${result.bot.name} [GS ${result.bot.gs} · ${result.bot.tier.toUpperCase()}]</div>`,
          ...(result.log||[]).map(l => {
            const isKill = l.includes('eliminated')||l.includes('killing blow');
            return `<div class="${isKill?(result.playerWins?'log-success':'log-fail'):'log-hit'}">${l}</div>`;
          }),
          result.playerWins
            ? `<div class="log-success" style="margin-top:6px">// ELIMINATED · +${result.credits?.toLocaleString()}¢ · +${result.xp} XP</div>`
            : `<div class="log-fail" style="margin-top:6px">// AGENT DOWN · +${result.xp} XP</div>`,
        ].join('');
      }
      if (result.playerWins) {
        this.flashScreen('#e8890c');
        this.notify(`☠ ${result.bot.name} eliminated on the map · +${result.credits?.toLocaleString()}¢`, 'success', 4000);
        // Remove bot from map temporarily
        const bot = MapEngine.botAgents.find(b => b.name === result.bot.name);
        if (bot) { bot._hidden = true; setTimeout(() => { delete bot._hidden; }, 30000); }
      } else {
        this.flashScreen('#e74c3c');
        this.notify(`${result.bot.name} [GS${result.bot.gs}] took you down on the map`, 'error', 4000);
      }
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch(e) { this.notify(e.message,'error'); }
  },

  async fightBot() {
    try {
      this.notify('Scanning for hostile agents...', '');
      await this.delay(800);
      const result = await API.post('/pvp/attack-bot');
      const logEl = document.getElementById('pvp-combat-log');
      if (logEl) {
        logEl.style.display = 'block';
        logEl.innerHTML = [
          `<div style="color:var(--muted2);margin-bottom:6px;letter-spacing:2px;font-size:10px">// ENCOUNTER: ${result.bot.name} [GS ${result.bot.gs} · ${result.bot.tier.toUpperCase()}]</div>`,
          ...(result.log || []).map(l => {
            const isKill = l.includes('eliminated') || l.includes('killing blow');
            return `<div class="${isKill ? (result.playerWins ? 'log-success' : 'log-fail') : 'log-hit'}">${l}</div>`;
          }),
          result.playerWins
            ? `<div class="log-success" style="margin-top:6px;font-size:12px">// RESULT: VICTORY — +${result.credits.toLocaleString()} ¢ · +${result.xp.toLocaleString()} XP</div>`
            : `<div class="log-fail"   style="margin-top:6px;font-size:12px">// RESULT: ELIMINATED — +${result.xp.toLocaleString()} XP · regroup and try again</div>`,
        ].join('');
      }
      if (result.playerWins) {
        this.flashScreen('#2ecc71');
        this.notify(`☠ ${result.bot.name} eliminated · +${result.credits.toLocaleString()} ¢`, 'success', 3000);
      } else {
        this.flashScreen('#e74c3c');
        this.notify(`Agent down · ${result.bot.name} [GS${result.bot.gs}] was too strong`, 'error', 3000);
      }
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async clearRogue() {
    try {
      const result = await API.pvp.clearRogue();
      this.notify(result.message, 'success');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  async attackBase(baseId) {
    try {
      const result = await API.clans.attackBase(baseId);
      this.notify(result.message, result.attackerWins ? 'success' : 'error', 5000);
      await this.delay(500);
      this.loadDarkZoneView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // CLANS VIEW
  // ============================================================
  async loadClansView() {
    try {
      const [clanData, allClans] = await Promise.all([
        API.clans.mine(),
        API.clans.list(),
      ]);

      this.clan = clanData.clan;
      this.renderMyClan(clanData);
      this.renderClanList(allClans.clans);
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  renderMyClan(data) {
    const el = document.getElementById('my-clan-content');
    if (!data.clan) {
      el.innerHTML = `<div style="color:var(--muted);padding:12px 0;font-size:13px">
        Not in a clan.<br><br>
        <span style="font-size:11px">Join an existing clan or found your own for 5,000 Credits.</span>
      </div>`;
      return;
    }
    const c = data.clan;
    const bases = data.bases || [];
    el.innerHTML = `
      <div class="clan-name-big">${c.name}</div>
      <div class="clan-tag-display">[${c.tag}] · Lv.${c.level} · Role: ${data.clan.role?.toUpperCase()}</div>
      <div class="panel-title" style="margin-top:10px">MEMBERS (${data.members?.length || 0}/20)</div>
      ${(data.members || []).map(m => `
        <div class="member-row">
          <div class="online-dot ${m.is_online ? 'on' : 'off'}"></div>
          <div class="mr-name">${m.name}</div>
          <div class="mr-gs">${m.gear_score}</div>
          <div class="mr-role">${m.role?.toUpperCase()}</div>
        </div>
      `).join('')}
      ${bases.length > 0 ? `
        <div class="panel-title" style="margin-top:10px">HELD BASES</div>
        ${bases.map(b => `
          <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <div style="color:var(--purple);font-weight:700">${b.name}</div>
            <div style="color:var(--muted);font-size:11px">${b.zone} · Bonus: ${b.bonus_type?.replace('_', ' ')}</div>
          </div>
        `).join('')}
      ` : ''}
      <div style="margin-top:12px">
        <button class="btn-secondary" onclick="window.Game.leaveClan()">LEAVE CLAN</button>
      </div>
    `;
  },

  renderClanList(clans) {
    const el = document.getElementById('clan-list');
    if (!clans?.length) {
      el.innerHTML = '<div style="color:var(--muted);padding:12px 0;font-size:13px">No clans yet. Be the first to found one!</div>';
      return;
    }
    el.innerHTML = clans.map(c => `
      <div class="clan-list-item">
        <div>
          <div class="cli-tag">[${c.tag}]</div>
          <div class="cli-name">${c.name}</div>
          <div class="cli-info">${c.member_count}/20 members · Lv.${c.level}</div>
        </div>
        ${this.clan ? '' : `<button class="btn-join" onclick="window.Game.joinClan('${c.id}')">JOIN</button>`}
      </div>
    `).join('');
  },

  showCreateClan() {
    if (this.clan) { this.notify('Already in a clan. Leave first.', 'error'); return; }
    document.getElementById('create-clan-modal').style.display = 'flex';
  },

  async createClan() {
    const name = document.getElementById('clan-name').value.trim();
    const tag  = document.getElementById('clan-tag').value.trim();
    const desc = document.getElementById('clan-desc').value.trim();
    document.getElementById('clan-error').textContent = '';

    if (!name || !tag) { document.getElementById('clan-error').textContent = 'Name and tag required'; return; }
    try {
      const result = await API.clans.create({ name, tag, description: desc });
      this.notify(result.message, 'success');
      hideModal('create-clan-modal');
      this.loadClansView();
    } catch (e) {
      document.getElementById('clan-error').textContent = e.message;
    }
  },

  async joinClan(id) {
    try {
      const result = await API.clans.join(id);
      this.notify(result.message, 'success');
      this.loadClansView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  async leaveClan() {
    if (!confirm('Leave your clan?')) return;
    try {
      const result = await API.clans.leave();
      this.notify(result.message, 'success');
      this.clan = null;
      this.loadClansView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // LEADERBOARD VIEW
  // ============================================================
  async loadLeaderboardView() {
    await this.fetchLeaderboard('gear_score');
  },

  async fetchLeaderboard(type) {
    try {
      const data = await API.leaderboard.get(type);
      const myRankEl = document.getElementById('lb-my-rank');
      myRankEl.innerHTML = `Your rank: <strong>#${data.myRank || '?'}</strong>`;

      const el = document.getElementById('lb-entries');
      const rankLabel = (rank) => {
        if (rank == 1) return '<span class="lb-rank gold">#1</span>';
        if (rank == 2) return '<span class="lb-rank silver">#2</span>';
        if (rank == 3) return '<span class="lb-rank bronze">#3</span>';
        return `<span class="lb-rank">#${rank}</span>`;
      };

      const formatVal = (type, v) => {
        if (type === 'gear_score') return v;
        if (type === 'pvp_kills' || type === 'missions') return parseInt(v).toLocaleString();
        if (type === 'clans') return parseInt(v).toLocaleString() + ' GS';
        return v;
      };

      el.innerHTML = data.entries.map(entry => {
        const isYou = entry.name === this.character?.name;
        const entryRank = this.getRank(entry.level || 1);
        const isBot = entry.is_bot;
        // Bots use their name as a fake ID for the attack-bot endpoint
        const attackId = isBot ? null : entry.character_id;
        return `<div class="lb-row ${isYou ? 'you' : ''}">
          ${rankLabel(entry.rank)}
          <div class="lb-name">
            <div>${entry.name || entry.clan_name}
              ${isYou ? '<span class="you-tag">[YOU]</span>' : ''}
              ${isBot ? '<span style="font-size:9px;color:rgba(57,255,20,0.3);letter-spacing:1px;margin-left:4px">[AGENT]</span>' : ''}
            </div>
            <div style="font-size:10px;display:flex;gap:8px;margin-top:2px">
              ${entry.name ? `<span style="color:${entryRank.color}">${entryRank.title}</span>` : ''}
              ${entry.clan_tag ? `<span class="lb-clan">[${entry.clan_tag}]</span>` : ''}
              ${entry.respect ? `<span style="color:var(--socom-green)">★ ${Number(entry.respect).toLocaleString()}</span>` : ''}
              ${entry.member_count ? `<span style="color:rgba(57,255,20,0.4)">${entry.member_count} members</span>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="lb-value">${formatVal(type, entry.value)}</div>
            ${!isYou && type !== 'clans' && (attackId || isBot)
              ? `<button onclick="${isBot ? `Game.fightBot()` : `Game.leaderboardAttack('${attackId}','${entry.name}',${entry.gear_score||0})`}"
                  style="font-size:9px;letter-spacing:1px;padding:3px 10px;background:transparent;border:1px solid var(--socom-red);color:var(--socom-red);cursor:pointer;font-family:var(--font-hud);clip-path:polygon(0 0,calc(100% - 4px) 0,100% 4px,100% 100%,4px 100%,0 calc(100% - 4px))">ATTACK</button>`
              : ''}
            ${type === 'clans' && entry.clan_id
              ? `<button onclick="Game.attackClan('${entry.clan_id}','${entry.clan_name||entry.name}')"
                  style="font-size:9px;letter-spacing:1px;padding:3px 10px;background:transparent;border:1px solid var(--socom-red);color:var(--socom-red);cursor:pointer;font-family:var(--font-hud);clip-path:polygon(0 0,calc(100% - 4px) 0,100% 4px,100% 100%,4px 100%,0 calc(100% - 4px))">RAID</button>`
              : ''}
          </div>
        </div>`;
      }).join('');
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  // ============================================================
  // CHAT
  // ============================================================
  appendChat(sender, message, time) {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="cm-name">${sender}:</span> ${this.escHtml(message)}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    if (el.children.length > 50) el.firstChild.remove();
  },

  escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // ============================================================
  // UTILS
  // ============================================================
  // Dopamine: brief colour flash over the whole screen (exotic/named drops)
  flashScreen(color) {
    const flash = document.createElement('div');
    flash.style.cssText = `position:fixed;inset:0;background:${color};opacity:0.12;z-index:9999;pointer-events:none;animation:screenFlash 0.5s ease forwards`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);
  },

  // Dopamine: tick up the GS counter visually
  animateGSTick(from, to) {
    const el = document.getElementById('hud-gs');
    if (!el || from === to) return;
    const step = to > from ? 1 : -1;
    let cur = from;
    const interval = setInterval(() => {
      cur += step;
      el.textContent = cur;
      if (cur === to) clearInterval(interval);
    }, 40);
  },

  delay: (ms) => new Promise(r => setTimeout(r, ms)),

  // ============================================================
  // DAILY CONTRACTS
  // ============================================================
  async loadContractsView() {
    await Promise.all([this.loadContracts(), this.loadRecalibrationPanel()]);
  },

  async loadContracts() {
    try {
      const data = await ContractsAPI.get();
      const el = document.getElementById('contracts-list');
      const resetEl = document.getElementById('contracts-reset');
      if (resetEl) resetEl.textContent = `RESETS AT MIDNIGHT OSLO TIME`;

      if (!data.contracts.length) {
        el.innerHTML = '<div style="color:var(--muted);font-size:12px">No contracts today — check back tomorrow.</div>';
        return;
      }

      el.innerHTML = data.contracts.map(c => {
        const prog = c.progress || 0;
        const pct  = Math.min(100, (prog / c.target) * 100);
        const done = c.completed;
        const claimed = c.claimed;
        const color = done ? 'var(--accent)' : 'var(--border3)';
        return `
          <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${color};padding:14px 16px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700;color:${done ? 'var(--accent)' : 'var(--text)'};margin-bottom:3px">${c.description}</div>
                <div style="font-size:10px;color:var(--muted2);letter-spacing:1px">
                  +${Number(c.xp_reward).toLocaleString()} XP &nbsp;·&nbsp; +${Number(c.credit_reward).toLocaleString()} ¢
                </div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-family:var(--font-hud);font-size:18px;color:${done ? 'var(--accent)' : 'var(--text2)'}">
                  ${prog}/${c.target}
                </div>
                ${done && !claimed
                  ? `<button class="btn-primary" style="padding:4px 14px;font-size:10px;margin-top:4px" onclick="Game.claimContract('${c.id}')">CLAIM</button>`
                  : claimed ? `<div style="font-size:10px;color:var(--green);letter-spacing:1px;margin-top:4px">✓ CLAIMED</div>` : ''
                }
              </div>
            </div>
            <div style="height:4px;background:var(--border);margin-top:4px">
              <div style="height:100%;width:${pct}%;background:${done ? 'var(--accent)' : 'var(--border3)'};transition:width 0.6s ease"></div>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async claimContract(id) {
    try {
      const r = await ContractsAPI.claim(id);
      this.notify(`✓ ${r.message} · +${r.xp.toLocaleString()} XP · +${r.credits.toLocaleString()} ¢`, 'success', 4000);
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadContracts();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // BOUNTY BOARD
  // ============================================================
  async loadBountiesView() {
    try {
      const data = await BountiesAPI.get();
      const el = document.getElementById('bounties-list');
      if (!data.bounties.length) {
        el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No active bounties. Be the first to post one.</div>';
        return;
      }
      el.innerHTML = data.bounties.map(b => {
        const isMyBounty = b.poster_name === this.character?.name;
        const expires = new Date(b.expires_at);
        const hoursLeft = Math.max(0, Math.round((expires - Date.now()) / 3600000));
        return `
          <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--red);padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:2px">☠ ${b.target_name}</div>
              <div style="font-size:10px;color:var(--muted2)">GS ${b.target_gs} · LV${b.target_level} · posted by ${b.poster_name}</div>
              ${b.reason ? `<div style="font-size:11px;color:var(--text2);margin-top:4px;font-style:italic">"${b.reason}"</div>` : ''}
              <div style="font-size:10px;color:var(--muted);margin-top:4px">${hoursLeft}h remaining</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:var(--font-hud);font-size:22px;font-weight:700;color:var(--accent)">${Number(b.reward).toLocaleString()} ¢</div>
              ${!isMyBounty ? `<button class="btn-danger" style="font-size:10px;padding:4px 12px;margin-top:6px" onclick="Game.claimBounty('${b.id}')">CLAIM</button>` : '<div style="font-size:10px;color:var(--muted);margin-top:6px">YOUR BOUNTY</div>'}
            </div>
          </div>`;
      }).join('');
    } catch (e) { this.notify(e.message, 'error'); }
  },

  async postBounty() {
    const name   = document.getElementById('bounty-target-name').value.trim();
    const reward = parseInt(document.getElementById('bounty-reward').value);
    const reason = document.getElementById('bounty-reason').value.trim();
    const errEl  = document.getElementById('bounty-error');
    errEl.textContent = '';

    if (!name) { errEl.textContent = 'Enter a target agent name'; return; }
    if (!reward || reward < 500) { errEl.textContent = 'Minimum bounty is 500 credits'; return; }

    try {
      // Look up target by name first
      const lb = await API.get('/leaderboard/gear_score');
      const target = lb.entries?.find(e => e.name?.toLowerCase() === name.toLowerCase());
      if (!target) { errEl.textContent = 'Agent not found — they must appear on the leaderboard'; return; }

      await BountiesAPI.post(target.character_id, reward, reason || null);
      this.notify(`☠ Bounty posted on ${name} for ${reward.toLocaleString()} ¢`, 'error', 4000);
      document.getElementById('bounty-target-name').value = '';
      document.getElementById('bounty-reward').value = '';
      document.getElementById('bounty-reason').value = '';
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadBountiesView();
    } catch (e) { errEl.textContent = e.message; }
  },

  async claimBounty(id) {
    try {
      const r = await BountiesAPI.claim(id);
      this.notify(`🎯 ${r.message}`, 'success', 5000);
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadBountiesView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // CACHE EVENTS
  // ============================================================
  _activeEvent: null,
  _eventTimer: null,

  showCacheEvent(event) {
    this._activeEvent = event;
    const banner = document.getElementById('cache-event-banner');
    const text   = document.getElementById('cache-event-text');
    const btn    = document.getElementById('cache-event-btn');
    if (!banner) return;

    const isClaimed = !!event.claimed_by;
    text.textContent = isClaimed
      ? `${event.district} cache secured by ${event.claimed_by_name}`
      : `${event.rarity.toUpperCase()} cache spotted at ${event.district}`;
    btn.style.display = isClaimed ? 'none' : 'block';
    banner.style.display = 'flex';

    if (!isClaimed) {
      if (this._eventTimer) clearInterval(this._eventTimer);
      this._eventTimer = setInterval(() => {
        const secs = Math.max(0, Math.floor((new Date(event.expires_at) - Date.now()) / 1000));
        const m = Math.floor(secs / 60), s = secs % 60;
        const timerEl = document.getElementById('cache-event-timer');
        if (timerEl) timerEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
        if (secs <= 0) {
          clearInterval(this._eventTimer);
          banner.style.display = 'none';
        }
      }, 1000);
    } else {
      if (this._eventTimer) clearInterval(this._eventTimer);
    }
  },

  async claimCacheEvent() {
    if (!this._activeEvent) return;
    try {
      const r = await EventsAPI.claim(this._activeEvent.id);
      this.notify(`⚡ ${r.message} · +${r.credits.toLocaleString()} ¢ · +${r.xp.toLocaleString()} XP [${r.rarity.toUpperCase()}]`, 'success', 6000);
      if (r.rarity === 'exotic') this.flashScreen('#e67e22');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  async checkActiveEvent() {
    try {
      const data = await EventsAPI.active();
      if (data.event) this.showCacheEvent(data.event);
    } catch (e) { /* silent fail */ }
  },

  // ============================================================
  // GEAR RECALIBRATION
  // ============================================================
  async loadRecalibrationPanel() { /* shown when stash item clicked — see below */ },

  async openRecalibration(inventoryId) {
    try {
      const data = await RecalibrationAPI.preview(inventoryId);
      const modal = document.getElementById('recal-modal');
      const content = document.getElementById('recal-modal-content');
      const confirmBtn = document.getElementById('recal-confirm-btn');

      if (!data.canReroll) {
        content.innerHTML = `
          <div style="padding:14px;background:var(--bg3);border:1px solid var(--border);border-left:2px solid var(--red);margin-bottom:14px">
            <div style="color:var(--red);font-size:12px">This item has already been recalibrated once and cannot be rerolled again.</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--accent)">${data.item.name}</div>`;
        confirmBtn.style.display = 'none';
        modal.style.display = 'flex';
        return;
      }

      const statMeta = {
        stat_health:      { label:'HEALTH BONUS',  color:'#2ecc71', icon:'♥' },
        stat_armor:       { label:'ARMOR RATING',  color:'#5dade2', icon:'◈' },
        stat_weapon_dmg:  { label:'WEAPON DAMAGE', color:'#e74c3c', icon:'⚔' },
        stat_crit_hit:    { label:'CRIT CHANCE',   color:'#f4a116', icon:'◎' },
        stat_crit_dmg:    { label:'CRIT DAMAGE',   color:'#e67e22', icon:'💥' },
        stat_skill_haste: { label:'SKILL HASTE',   color:'#af7ac5', icon:'⚡' },
      };

      let selectedStat = null;
      const statsHtml = Object.entries(data.stats).map(([key, val]) => {
        const m = statMeta[key] || { label: key, color: '#888', icon: '◆' };
        const pct = Math.min(100, (val / 35) * 100);
        return `
          <div class="recal-stat-row" data-stat="${key}" onclick="Game._selectRecalStat('${key}', this)"
            style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border:1px solid var(--border);border-left:2px solid var(--border3);margin-bottom:5px;transition:all 0.15s">
            <span style="color:${m.color};width:14px;text-align:center">${m.icon}</span>
            <span style="color:var(--text2);flex:1;font-size:11px">${m.label}</span>
            <div style="width:80px;height:4px;background:var(--border)">
              <div style="height:100%;width:${pct}%;background:${m.color}"></div>
            </div>
            <span style="font-family:var(--font-hud);color:${m.color};font-size:12px;width:36px;text-align:right">+${val}%</span>
            <span style="font-size:10px;color:var(--muted);letter-spacing:1px;width:50px;text-align:right">REROLL</span>
          </div>`;
      }).join('');

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--accent)">${data.item.name}</div>
            <div style="font-size:10px;color:var(--muted2);letter-spacing:1px;margin-top:2px">GS ${data.item.gearScore} · ${data.item.rarity.toUpperCase()}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--muted2)">REROLL COST</div>
            <div style="font-family:var(--font-hud);font-size:20px;color:var(--accent)">${Number(data.cost).toLocaleString()} ¢</div>
          </div>
        </div>
        <div style="font-size:9px;letter-spacing:3px;color:var(--muted2);margin-bottom:8px">SELECT STAT TO REROLL</div>
        ${statsHtml}
        <div id="recal-selected-stat" style="font-size:11px;color:var(--muted);margin-top:8px">Click a stat above to select it for rerolling.</div>
      `;

      this._recalInventoryId = inventoryId;
      this._recalSelectedStat = null;
      confirmBtn.style.display = 'none';
      confirmBtn.onclick = () => this.executeRecalibration();
      modal.style.display = 'flex';
    } catch (e) { this.notify(e.message, 'error'); }
  },

  _selectRecalStat(stat, el) {
    document.querySelectorAll('.recal-stat-row').forEach(r => {
      r.style.borderLeftColor = 'var(--border3)';
      r.style.background = 'transparent';
    });
    el.style.borderLeftColor = 'var(--accent)';
    el.style.background = 'var(--accent-dim)';
    this._recalSelectedStat = stat;
    const statMeta = {
      stat_health:'HEALTH BONUS', stat_armor:'ARMOR RATING', stat_weapon_dmg:'WEAPON DAMAGE',
      stat_crit_hit:'CRIT CHANCE', stat_crit_dmg:'CRIT DAMAGE', stat_skill_haste:'SKILL HASTE',
    };
    document.getElementById('recal-selected-stat').innerHTML =
      `Selected: <strong style="color:var(--accent)">${statMeta[stat] || stat}</strong> — this will be rerolled.`;
    document.getElementById('recal-confirm-btn').style.display = 'inline-block';
  },

  async executeRecalibration() {
    if (!this._recalInventoryId || !this._recalSelectedStat) return;
    try {
      const r = await RecalibrationAPI.reroll(this._recalInventoryId, this._recalSelectedStat);
      hideModal('recal-modal');
      this.notify(
        `🔧 Recalibrated: ${r.stat.replace('stat_','').replace(/_/g,' ').toUpperCase()} → +${r.newValue}% (was +${r.oldValue}%) · cost ${r.cost.toLocaleString()} ¢`,
        r.newValue > r.oldValue ? 'success' : '',
        5000
      );
      if (r.newValue > r.oldValue) this.flashScreen('#5dade2');
      this.loadInventoryView();
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // JAIL VIEW
  // ============================================================
  _bailedBots: new Set(),

  async loadJailView() {
    try {
      const data = await JailAPI.list();
      const el   = document.getElementById('jail-list');
      const myJailEl = document.getElementById('my-jail-status');

      const c = this.character;
      if (c?.is_jailed && c.jail_until && new Date(c.jail_until) > new Date()) {
        const minsLeft = Math.ceil((new Date(c.jail_until) - Date.now()) / 60000);
        if (myJailEl) myJailEl.innerHTML = `
          <div class="mission-brief" style="margin-bottom:14px">
            <div class="brief-header" style="color:var(--socom-red)">🚔 YOU ARE IN CUSTODY</div>
            <div class="brief-designator"><span class="key">TIME REMAINING:</span><span class="val" style="color:var(--socom-red)">${minsLeft} MINUTES</span></div>
            <div class="brief-designator" style="margin-top:8px;font-size:11px;color:var(--muted2)">Raise your jailbreak bounty to attract rescuers faster.</div>
            ${this._jailEventId ? `
              <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
                <input type="number" id="raise-bounty-amount" placeholder="Amount (¢)" min="100"
                  style="background:#000;border:1px solid var(--socom-green);color:var(--socom-green);padding:6px 10px;font-family:var(--font-hud);font-size:13px;outline:none;flex:1">
                <button class="btn-socom" onclick="Game.raiseBounty()">[ RAISE BOUNTY ]</button>
              </div>` : ''}
          </div>`;
      } else if (myJailEl) { myJailEl.innerHTML = ''; }

      // Filter out bots this player already bailed
      const visiblePrisoners = data.prisoners.filter(p => !this._bailedBots.has(p.id));

      if (!visiblePrisoners.length) {
        el.innerHTML = '<div class="socom-data" style="padding:20px 0;text-align:center;opacity:0.5">NO AGENTS IN CUSTODY — OSLO STREETS ARE CLEAR</div>';
        return;
      }

      el.innerHTML = visiblePrisoners.map(p => {
        const isMe   = p.prisoner_id === this.character?.id;
        const minsLeft = p.is_bot ? 30 : Math.max(0, Math.ceil((new Date(p.jail_until || Date.now() + 30*60000) - Date.now()) / 60000));
        const bounty = Number(p.jailbreak_bounty).toLocaleString();
        return `
          <div class="mission-brief" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="brief-header" style="color:${isMe ? 'var(--socom-red)' : p.is_bot ? 'var(--socom-amber)' : 'var(--socom-green)'}">
                🚔 ${p.prisoner_name}${isMe ? ' — YOU' : p.is_bot ? ' [BOT AGENT]' : ''}
              </div>
              <div class="brief-designator"><span class="key">GS:</span><span class="val">${p.gear_score}</span> &nbsp; <span class="key">LV:</span><span class="val">${p.level}</span> &nbsp; <span class="key">TIME LEFT:</span><span class="val" style="color:var(--socom-red)">${minsLeft}m</span></div>
            </div>
            <div style="text-align:right">
              <div class="socom-timer" style="font-size:22px">${bounty} ¢</div>
              <div style="font-size:9px;color:var(--muted2);letter-spacing:2px;margin-bottom:6px">JAILBREAK REWARD</div>
              ${!isMe ? `<button class="btn-socom" onclick="Game.breakOut('${p.id}', '${p.prisoner_name}', ${!!p.is_bot})">[ BREAK OUT ]</button>` : ''}
            </div>
          </div>`;
      }).join('');
    } catch (e) { this.notify(e.message, 'error'); }
  },

  async breakOut(eventId, prisonerName, isBot = false) {
    try {
      const r = await JailAPI.breakOut(eventId);
      // Track bailed bots so they don't reappear
      if (isBot) this._bailedBots.add(eventId);
      this.notify(`🔓 ${r.message}`, 'success', 5000);
      this.flashScreen('#2ecc71');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadJailView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  async raiseBounty() {
    const amount = parseInt(document.getElementById('raise-bounty-amount')?.value);
    if (!amount || amount < 100) { this.notify('Minimum top-up is 100 ¢', 'error'); return; }
    if (!this._jailEventId) return;
    try {
      const r = await JailAPI.raiseBounty(this._jailEventId, amount);
      this.notify(r.message, 'success');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadJailView();
    } catch (e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // LEADERBOARD PVP — attack player or clan directly
  // ============================================================
  async leaderboardAttack(characterId, name, gs) {
    if (!confirm(`Attack ${name} (GS${gs})?\n\nThis will cost you respect if you lose.`)) return;
    try {
      const r = await API.post(`/pvp/attack-player/${characterId}`);
      const color = r.playerWins ? '#2ecc71' : '#e74c3c';
      this.flashScreen(color);
      this.notify(
        r.playerWins
          ? `☠ ${r.targetName} eliminated · +${r.credits.toLocaleString()}¢ · +${r.xp} XP · +${r.respect}★`
          : `⚠ Defeated by ${r.targetName} · +${r.xp} XP`,
        r.playerWins ? 'success' : 'error', 4000
      );
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.fetchLeaderboard(document.querySelector('.lb-tab.active')?.dataset?.type || 'gear_score');
    } catch(e) { this.notify(e.message, 'error'); }
  },

  async attackClan(clanId, clanName) {
    if (!confirm(`Raid ${clanName}?\n\nWin to loot credits from their treasury.`)) return;
    try {
      const r = await API.post(`/pvp/attack-clan/${clanId}`);
      this.flashScreen(r.playerWins ? '#e8890c' : '#e74c3c');
      const logEl = document.getElementById('pvp-combat-log');
      if (logEl) {
        logEl.style.display = 'block';
        logEl.innerHTML = r.log.map((l, i) =>
          `<div class="${i===r.log.length-1 ? (r.playerWins?'log-success':'log-fail') : 'log-hit'}">${l}</div>`
        ).join('');
      }
      this.notify(
        r.playerWins
          ? `⚔ Raid success — looted ${r.creditsLooted.toLocaleString()}¢ from ${r.clanName} · +${r.respect}★`
          : `⚔ Raid failed — ${r.clanName} held their ground · +${r.respect}★`,
        r.playerWins ? 'success' : 'error', 5000
      );
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
    } catch(e) { this.notify(e.message, 'error'); }
  },

  // ============================================================
  // EXTORTION
  // ============================================================
  async loadExtortionView() {
    try {
      const data = await ExtortionAPI.get();
      const sentEl = document.getElementById('extortion-sent');
      const recEl  = document.getElementById('extortion-received');
      const botEl  = document.getElementById('extortion-bots');

      // Bot targets panel
      if (botEl && data.botTargets?.length) {
        botEl.innerHTML = `
          <div class="panel-title" style="margin-bottom:10px">// WEAK AGENTS — EXTORT NOW</div>
          ${data.botTargets.map(b => `
            <div class="mission-brief" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div class="brief-header">${b.name}</div>
                <div class="brief-designator"><span class="key">GS:</span><span class="val">${b.gear_score}</span> <span class="key">LV:</span><span class="val">${b.level}</span></div>
              </div>
              <div style="text-align:right">
                <div class="socom-data" style="font-size:16px;margin-bottom:6px">${b.suggestedAmount?.toLocaleString()} ¢ <span style="opacity:0.4;font-size:10px">suggested</span></div>
                <button class="btn-socom" style="font-size:10px;padding:4px 12px" onclick="Game.extortBot('${b.id}',${b.suggestedAmount})">[ DEMAND ]</button>
              </div>
            </div>`).join('')}`;
      } else if (botEl) {
        botEl.innerHTML = '<div class="panel-title" style="margin-bottom:10px">// WEAK AGENTS</div><div class="socom-data" style="opacity:0.4">No weaker agents to extort at your GS level.</div>';
      }

      sentEl.innerHTML = data.sent.length === 0
        ? '<div class="socom-data" style="opacity:0.4;padding:8px 0">No active demands sent.</div>'
        : data.sent.map(e => `
          <div class="mission-brief" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="brief-header">DEMAND → ${e.target_name}</div>
              <div class="brief-designator"><span class="key">DEADLINE:</span><span class="val">${new Date(e.deadline).toLocaleTimeString()}</span></div>
            </div>
            <div class="socom-timer" style="font-size:18px">${Number(e.amount).toLocaleString()} ¢</div>
          </div>`).join('');

      recEl.innerHTML = data.received.length === 0
        ? '<div class="socom-data" style="opacity:0.4;padding:8px 0">No demands on you.</div>'
        : data.received.map(e => `
          <div class="mission-brief" style="margin-bottom:8px;border-left-color:var(--socom-red)">
            <div class="brief-header" style="color:var(--socom-red)">⚠ DEMAND FROM ${e.extorter_name}</div>
            <div class="brief-designator"><span class="key">AMOUNT:</span><span class="val" style="color:var(--socom-red)">${Number(e.amount).toLocaleString()}¢</span></div>
            <div class="brief-designator"><span class="key">DEADLINE:</span><span class="val">${new Date(e.deadline).toLocaleString()}</span></div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-socom" onclick="Game.payExtortion('${e.id}')">[ PAY UP ]</button>
              <button class="btn-socom" style="border-color:var(--socom-red);color:var(--socom-red)" onclick="Game.refuseExtortion('${e.id}')">[ REFUSE ]</button>
            </div>
          </div>`).join('');
    } catch(e) { this.notify(e.message,'error'); }
  },

  async extortBot(botId, amount) {
    try {
      const r = await API.post(`/extortion/bot/${botId}`, { amount });
      if (r.success) {
        this.notify(`💰 ${r.message}`, 'success', 4000);
        this.flashScreen('#e8890c');
      } else {
        this.notify(`⚠ ${r.message}`, 'error', 4000);
        this.flashScreen('#e74c3c');
      }
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadExtortionView();
    } catch(e) { this.notify(e.message,'error'); }
  },

  async sendExtortion() {
    const targetName = document.getElementById('ext-target').value.trim();
    const amount = parseInt(document.getElementById('ext-amount').value);
    const errEl = document.getElementById('ext-error');
    errEl.textContent = '';
    if (!targetName || !amount || amount < 200) { errEl.textContent = 'Enter a target and amount (min 200¢)'; return; }
    try {
      const lb = await API.get('/leaderboard/gear_score');
      const target = lb.entries?.find(e => e.name?.toLowerCase() === targetName.toLowerCase());
      if (!target) { errEl.textContent = 'Agent not found on leaderboard'; return; }
      await ExtortionAPI.send(target.character_id, amount);
      this.notify(`💰 Demand sent to ${targetName}`, '', 3000);
      document.getElementById('ext-target').value = '';
      document.getElementById('ext-amount').value = '';
      this.loadExtortionView();
    } catch(e) { errEl.textContent = e.message; }
  },

  async payExtortion(id) {
    try {
      const r = await ExtortionAPI.pay(id);
      this.notify(r.message, 'success');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadExtortionView();
    } catch(e) { this.notify(e.message,'error'); }
  },

  async refuseExtortion(id) {
    try {
      const r = await ExtortionAPI.refuse(id);
      this.notify(r.message, '', 3000);
      this.loadExtortionView();
    } catch(e) { this.notify(e.message,'error'); }
  },

  // ============================================================
  // DRUG LAB
  // ============================================================
  async loadDrugLabView() {
    try {
      const data = await DrugLabAPI.get();
      const el = document.getElementById('druglab-panel');
      if (!data.lab) {
        el.innerHTML = `
          <div style="font-size:11px;color:var(--muted2);line-height:1.7;margin-bottom:16px">
            Establish a stash house to start generating passive income. Earnings tick every hour while you're offline.
          </div>
          <div style="margin-bottom:14px">
            ${Object.entries(data.tiers).map(([t,tier]) => `
              <div class="pvp-stat-row"><span class="pvs-label">Tier ${t}: ${tier.name}</span><span class="pvs-val">${(tier.hourlyRate*100).toFixed(0)}%/hr</span></div>
            `).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" id="lab-invest-amount" placeholder="Investment (¢)" min="5000" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:8px 12px;font-family:var(--font-hud);font-size:13px;outline:none;flex:1">
            <button class="btn-primary" style="padding:8px 18px" onclick="Game.investLab()">ESTABLISH</button>
          </div>
          <div id="lab-error" style="color:var(--red);font-size:11px;margin-top:6px"></div>`;
        return;
      }
      const l = data.lab;
      const t = l.tierInfo;
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:14px">
          <div>
            <div style="font-size:9px;letter-spacing:3px;color:var(--muted2)">OPERATION</div>
            <div style="font-size:20px;font-weight:700;color:var(--accent)">${t.name}</div>
            <div style="font-size:10px;color:var(--muted2)">Tier ${l.tier} · ${(t.hourlyRate*100).toFixed(0)}% per hour</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:9px;letter-spacing:2px;color:var(--muted2)">INVESTED</div>
            <div style="font-family:var(--font-hud);font-size:20px;color:var(--accent)">${Number(l.invested).toLocaleString()} ¢</div>
          </div>
        </div>
        <div style="background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:9px;letter-spacing:2px;color:var(--green);margin-bottom:2px">PENDING EARNINGS</div>
            <div style="font-family:var(--font-hud);font-size:24px;font-weight:700;color:var(--green)">${Number(l.pending).toLocaleString()} ¢</div>
          </div>
          <button class="btn-primary" onclick="Game.collectLab()">COLLECT</button>
        </div>
        ${t.upgradeAt ? `
          <div style="font-size:10px;color:var(--muted2);margin-bottom:10px">
            Upgrade at ${Number(t.upgradeAt).toLocaleString()}¢ invested
            (${Number(t.upgradeAt - l.invested).toLocaleString()}¢ to go)
          </div>` : '<div style="font-size:10px;color:var(--exotic);margin-bottom:10px">MAX TIER — Plantation operational</div>'}
        <div style="display:flex;gap:8px;align-items:center">
          <input type="number" id="lab-invest-amount" placeholder="Invest more (¢)" min="1000" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:8px 12px;font-family:var(--font-hud);font-size:13px;outline:none;flex:1">
          <button class="btn-secondary" style="padding:8px 18px" onclick="Game.investLab()">INVEST MORE</button>
        </div>
        <div id="lab-error" style="color:var(--red);font-size:11px;margin-top:6px"></div>`;
    } catch(e) { this.notify(e.message,'error'); }
  },

  async investLab() {
    const amount = parseInt(document.getElementById('lab-invest-amount')?.value);
    const errEl = document.getElementById('lab-error');
    if (errEl) errEl.textContent = '';
    if (!amount || amount < 1000) { if(errEl) errEl.textContent='Minimum 1,000¢'; return; }
    try {
      const r = await DrugLabAPI.invest(amount);
      this.notify(r.message, 'success', 4000);
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadDrugLabView();
    } catch(e) { const errEl = document.getElementById('lab-error'); if(errEl) errEl.textContent = e.message; }
  },

  async collectLab() {
    try {
      const r = await DrugLabAPI.collect();
      this.notify(r.message, 'success', 4000);
      this.flashScreen('#2ecc71');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadDrugLabView();
    } catch(e) { this.notify(e.message,'error'); }
  },

  // ============================================================
  // POKER DEN — Underground Blackjack
  // ============================================================
  _poker: {
    deck: [], player: [], dealer: [], bet: 0,
    chips: 0, wins: 0, losses: 0, biggest: 0,
    phase: 'bet', // bet | playing | done
  },

  loadPokerView() {
    const p = this._poker;
    p.chips = parseInt(this.character?.credits || 0);
    this._updatePokerSidebar();
    this._pokerShowBetControls();
  },

  _pokerCard(rank, suit) {
    const suitColors = { '♥':'#e74c3c', '♦':'#e74c3c', '♣':'#d0dae8', '♠':'#d0dae8' };
    const color = suitColors[suit] || '#d0dae8';
    return { rank, suit, color, hidden: false };
  },

  _pokerValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      if (c.hidden) continue;
      if (['J','Q','K'].includes(c.rank)) total += 10;
      else if (c.rank === 'A') { total += 11; aces++; }
      else total += parseInt(c.rank);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  },

  _pokerDeck() {
    const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const suits = ['♠','♥','♦','♣'];
    const deck = [];
    for (const r of ranks) for (const s of suits) deck.push(this._pokerCard(r, s));
    // Shuffle (Fisher-Yates)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  },

  _renderPokerCards(cards, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = cards.map(c => {
      if (c.hidden) return `
        <div style="width:56px;height:80px;background:var(--bg3);border:1px solid var(--border2);
          clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,6px 100%,0 calc(100% - 6px));
          display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--border2)">?</div>`;
      return `
        <div style="width:56px;height:80px;background:var(--bg2);border:1px solid var(--border2);
          clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,6px 100%,0 calc(100% - 6px));
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:4px;animation:lootDrop 0.25s ease">
          <div style="font-size:18px;font-weight:700;color:${c.color};font-family:var(--font-hud)">${c.rank}</div>
          <div style="font-size:16px;color:${c.color}">${c.suit}</div>
        </div>`;
    }).join('');
  },

  _updatePokerScores() {
    const p = this._poker;
    const pScore = this._pokerValue(p.player);
    const dVisible = p.dealer.filter(c => !c.hidden);
    const dScore = this._pokerValue(dVisible);
    const pEl = document.getElementById('poker-player-score');
    const dEl = document.getElementById('poker-dealer-score');
    if (pEl) pEl.textContent = `Score: ${pScore}${pScore > 21 ? ' — BUST!' : pScore === 21 ? ' — 21!' : ''}`;
    if (dEl) dEl.textContent = p.phase === 'done' ? `Score: ${this._pokerValue(p.dealer)}` : `Score: ${dScore} + ?`;
  },

  _updatePokerSidebar() {
    const p = this._poker;
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('poker-chips',   (this.character?.credits || 0).toLocaleString() + ' ¢');
    set('poker-bet-display', p.bet ? p.bet.toLocaleString() + ' ¢' : '—');
    set('poker-wins',    p.wins);
    set('poker-losses',  p.losses);
    set('poker-biggest', p.biggest.toLocaleString() + ' ¢');
    const betDisplay = document.getElementById('poker-current-bet');
    if (betDisplay) betDisplay.textContent = p.bet ? `BET: ${p.bet.toLocaleString()} ¢` : '';
  },

  _pokerShowBetControls() {
    const controls = document.getElementById('poker-controls');
    const actions  = document.getElementById('poker-action-btns');
    const result   = document.getElementById('poker-result');
    if (controls) controls.style.display = 'flex';
    if (actions)  actions.style.display  = 'none';
    if (result)   result.style.display   = 'none';
    this._renderPokerCards([], 'poker-dealer-cards');
    this._renderPokerCards([], 'poker-player-cards');
    const pScore = document.getElementById('poker-player-score');
    const dScore = document.getElementById('poker-dealer-score');
    if (pScore) pScore.textContent = '';
    if (dScore) dScore.textContent = '';
  },

  pokerBet(amount) {
    const p = this._poker;
    const credits = this.character?.credits || 0;
    if (amount > credits) { this.notify(`Not enough credits — need ${amount.toLocaleString()}¢`, 'error'); return; }
    p.bet = amount;
    p.deck = this._pokerDeck();
    p.player = [p.deck.pop(), p.deck.pop()];
    p.dealer = [p.deck.pop(), { ...p.deck.pop(), hidden: true }];
    p.phase = 'playing';

    this._renderPokerCards(p.player, 'poker-player-cards');
    this._renderPokerCards(p.dealer, 'poker-dealer-cards');
    this._updatePokerScores();
    this._updatePokerSidebar();

    const controls = document.getElementById('poker-controls');
    const actions  = document.getElementById('poker-action-btns');
    const doubleBtn = document.getElementById('poker-double-btn');
    if (controls) controls.style.display = 'none';
    if (actions)  actions.style.display  = 'flex';
    if (doubleBtn) doubleBtn.style.opacity = '1';

    // Check natural blackjack
    if (this._pokerValue(p.player) === 21) {
      setTimeout(() => this._pokerStandProcess(), 600);
    }
  },

  pokerHit() {
    const p = this._poker;
    if (p.phase !== 'playing') return;
    p.player.push(p.deck.pop());
    const doubleBtn = document.getElementById('poker-double-btn');
    if (doubleBtn) doubleBtn.style.opacity = '0.3';
    this._renderPokerCards(p.player, 'poker-player-cards');
    this._updatePokerScores();
    if (this._pokerValue(p.player) > 21) this._pokerEnd('bust');
  },

  pokerStand() {
    if (this._poker.phase !== 'playing') return;
    this._pokerStandProcess();
  },

  async pokerDouble() {
    const p = this._poker;
    if (p.phase !== 'playing' || p.player.length !== 2) return;
    const credits = this.character?.credits || 0;
    if (p.bet * 2 > credits) { this.notify('Not enough credits to double down', 'error'); return; }
    p.bet *= 2;
    p.player.push(p.deck.pop());
    this._renderPokerCards(p.player, 'poker-player-cards');
    this._updatePokerScores();
    this._updatePokerSidebar();
    await this.delay(400);
    if (this._pokerValue(p.player) > 21) this._pokerEnd('bust');
    else this._pokerStandProcess();
  },

  async _pokerStandProcess() {
    const p = this._poker;
    p.phase = 'done';
    // Reveal hole card
    p.dealer.forEach(c => { c.hidden = false; });
    this._renderPokerCards(p.dealer, 'poker-dealer-cards');
    this._updatePokerScores();
    await this.delay(500);

    // Dealer hits soft 17
    while (this._pokerValue(p.dealer) < 17) {
      await this.delay(500);
      p.dealer.push(p.deck.pop());
      this._renderPokerCards(p.dealer, 'poker-dealer-cards');
      this._updatePokerScores();
    }

    const pScore = this._pokerValue(p.player);
    const dScore = this._pokerValue(p.dealer);
    const isBlackjack = p.player.length === 2 && pScore === 21;

    if (pScore > 21) this._pokerEnd('bust');
    else if (dScore > 21) this._pokerEnd('dealer_bust');
    else if (isBlackjack && dScore !== 21) this._pokerEnd('blackjack');
    else if (pScore > dScore) this._pokerEnd('win');
    else if (pScore === dScore) this._pokerEnd('push');
    else this._pokerEnd('lose');
  },

  async _pokerEnd(outcome) {
    const p = this._poker;
    p.phase = 'done';

    const msgs = {
      bust:        { text:'BUST — You went over 21', color:'var(--red)',    credit: -p.bet },
      dealer_bust: { text:'DEALER BUSTS — You win!', color:'var(--green)',  credit: p.bet  },
      blackjack:   { text:'BLACKJACK! 3:2 payout',   color:'var(--exotic)', credit: Math.floor(p.bet * 1.5) },
      win:         { text:'YOU WIN',                  color:'var(--green)',  credit: p.bet  },
      push:        { text:'PUSH — Bet returned',      color:'var(--muted2)', credit: 0      },
      lose:        { text:'DEALER WINS',               color:'var(--red)',    credit: -p.bet },
    };

    const outcome_data = msgs[outcome];
    const result = document.getElementById('poker-result');
    const actions = document.getElementById('poker-action-btns');
    if (actions) actions.style.display = 'none';
    if (result) {
      result.style.display = 'block';
      result.style.borderColor = outcome_data.color;
      result.style.background = outcome_data.color + '22';
      result.style.color = outcome_data.color;
      result.innerHTML = `
        <div style="font-size:20px;font-weight:700;letter-spacing:3px;margin-bottom:8px">${outcome_data.text}</div>
        <div style="font-family:var(--font-hud);font-size:18px">${outcome_data.credit >= 0 ? '+' : ''}${outcome_data.credit.toLocaleString()}¢</div>
        <button onclick="Game._pokerNewRound()" style="margin-top:12px;background:var(--accent);border:none;color:#000;padding:8px 24px;font-family:var(--font-ui);font-size:12px;font-weight:700;letter-spacing:2px;cursor:pointer;clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,6px 100%,0 calc(100% - 6px))">DEAL AGAIN</button>`;
    }

    // Apply credit change to server
    if (outcome_data.credit !== 0) {
      try {
        const delta = outcome_data.credit;
        await API.post('/pvp/poker-settle', { delta, bet: p.bet, outcome }).catch(() => {});
        // Update locally for immediate feedback
        if (this.character) this.character.credits = Math.max(0, (this.character.credits||0) + delta);
        this.updateHUD();
      } catch(_) {}
    }

    // Track stats
    if (['win','dealer_bust','blackjack'].includes(outcome)) {
      p.wins++;
      if (outcome_data.credit > p.biggest) p.biggest = outcome_data.credit;
      this.flashScreen('#2ecc71');
    } else if (['bust','lose'].includes(outcome)) {
      p.losses++;
      this.flashScreen('#e74c3c');
    }
    p.bet = 0;
    this._updatePokerSidebar();
  },

  _pokerNewRound() {
    this._poker.phase = 'bet';
    this._pokerShowBetControls();
  },
  async loadFightClubView() {
    try {
      const data = await FightClubAPI.get();
      const el = document.getElementById('fightclub-bracket');
      const infoEl = document.getElementById('fightclub-info');
      const myEntryEl = document.getElementById('fightclub-my-entry');

      if (infoEl) infoEl.innerHTML = `
        <div class="pvp-stat-row"><span class="pvs-label">Entry fee</span><span class="pvs-val">${Number(data.entryFee).toLocaleString()} ¢</span></div>
        <div class="pvp-stat-row"><span class="pvs-label">Prize pool</span><span class="pvs-val" style="color:var(--green)">${Number(data.prizePool).toLocaleString()} ¢</span></div>
        <div class="pvp-stat-row"><span class="pvs-label">Entrants</span><span class="pvs-val">${data.bracket.length}</span></div>
        <div class="pvp-stat-row"><span class="pvs-label">Week</span><span class="pvs-val">${data.week}</span></div>`;

      if (myEntryEl) {
        myEntryEl.innerHTML = data.myEntry
          ? `<div style="background:var(--accent-dim);border:1px solid var(--accent);padding:10px 14px;margin-bottom:10px">
              <div style="font-size:9px;letter-spacing:2px;color:var(--accent);margin-bottom:4px">YOUR STANDING</div>
              <div style="font-family:var(--font-hud);font-size:18px;font-weight:700">${data.myEntry.wins}W / ${data.myEntry.losses}L</div>
            </div>`
          : `<button class="btn-danger" style="width:100%;margin-bottom:10px" onclick="Game.enterFightClub()">ENTER THIS WEEK (${data.entryFee.toLocaleString()}¢)</button>`;
      }

      el.innerHTML = data.bracket.length === 0
        ? '<div style="color:var(--muted);font-size:11px;padding:8px 0">No entrants yet this week. Be the first.</div>'
        : data.bracket.map((e, i) => {
            const isMe = e.entrant_id === this.character?.id;
            const rank = this.getRank(e.level || 1);
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border);${isMe?'background:var(--accent-dim)':''}">
              <div style="font-size:9px;color:var(--muted);width:20px;text-align:center">${i+1}</div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${e.name}${isMe?' <span style="color:var(--accent)">[YOU]</span>':''}</div>
                <div style="font-size:10px;color:${rank.color}">${rank.title} · GS ${e.gear_score}</div>
              </div>
              <div style="font-family:var(--font-hud);font-size:14px;color:var(--green)">${e.wins}W</div>
              <div style="font-family:var(--font-hud);font-size:12px;color:var(--red)">${e.losses}L</div>
              ${data.myEntry && !isMe
                ? `<button onclick="Game.fightClubMatch('${e.entrant_id}')" style="font-size:9px;padding:3px 10px;background:rgba(232,137,12,0.15);border:1px solid var(--accent);color:var(--accent);cursor:pointer;font-weight:700">FIGHT</button>`
                : ''}
            </div>`;
          }).join('');
    } catch(e) { this.notify(e.message,'error'); }
  },

  async enterFightClub() {
    try {
      const r = await FightClubAPI.enter();
      this.notify(r.message, 'success');
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadFightClubView();
    } catch(e) { this.notify(e.message,'error'); }
  },

  async fightClubMatch(entrantId) {
    try {
      const r = await FightClubAPI.fight(entrantId);
      this.flashScreen(r.playerWins ? '#e8890c' : '#e74c3c');
      this.notify(
        r.playerWins
          ? `🥊 ${r.opponentName} defeated! +${r.xp} XP · +${r.respect}★`
          : `🥊 Lost to ${r.opponentName} · +${r.xp} XP`,
        r.playerWins ? 'success' : 'error', 4000
      );
      const me = await API.auth.me();
      this.character = me.character;
      this.updateHUD();
      this.loadFightClubView();
    } catch(e) { this.notify(e.message,'error'); }
  },

}; // end Game

// ============================================================
// GLOBAL FUNCTIONS (called from HTML)
// ============================================================
window.Game = Game;

function switchView(v) { Game.loadView(v); }
function openCache(type) { Game.openCache(type); }
function enterDZ() { Game.enterDZ(); }
function clearRogue() { Game.clearRogue(); }
function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  if (Game.socket) Game.socket.emit('chat:message', { message: msg, zone: 'global' });
  input.value = '';
  // Append locally immediately
  Game.appendChat(Game.character?.name || 'You', msg, new Date().toISOString());
}

function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', i === (tab === 'login' ? 0 : 1));
  });
  document.getElementById('tab-login').style.display  = tab === 'login'    ? 'flex' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'flex' : 'none';
}

async function doLogin() {
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';
  try {
    const data = await API.auth.login(email, password);
    localStorage.setItem('div_token', data.token);
    Game.token = data.token;
    Game.user = data.user;
    Game.character = data.character;
    Game.showGame();
  } catch (e) {
    document.getElementById('login-error').textContent = e.message;
  }
}

async function doRegister() {
  const data = {
    username:      document.getElementById('reg-username').value,
    email:         document.getElementById('reg-email').value,
    characterName: document.getElementById('reg-charname').value,
    password:      document.getElementById('reg-password').value,
  };
  document.getElementById('reg-error').textContent = '';
  try {
    const result = await API.auth.register(data);
    localStorage.setItem('div_token', result.token);
    Game.token = result.token;
    Game.user = result.user;
    Game.character = result.character;
    Game.showGame();
  } catch (e) {
    document.getElementById('reg-error').textContent = e.message;
  }
}

function logout() {
  localStorage.removeItem('div_token');
  if (Game.socket) Game.socket.disconnect();
  MapEngine.stop();
  Game.showAuth();
}

function hideModal(id) {
  document.getElementById(id).style.display = 'none';
}

function showCreateClan() { Game.showCreateClan(); }
function createClan()     { Game.createClan(); }

function loadLeaderboard(type, el) {
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  Game.fetchLeaderboard(type);
}

function equipCurrentItem() { Game.equipCurrentItem(); }
function sellCurrentItem()  { Game.sellCurrentItem(); }

// Boot
window.addEventListener('DOMContentLoaded', () => Game.init());
