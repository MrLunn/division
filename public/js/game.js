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
  },

  // ============================================================
  // HUD
  // ============================================================
  updateHUD() {
    const c = this.character;
    if (!c) return;
    document.getElementById('hud-name').textContent = c.name;
    document.getElementById('hud-level').textContent = `LV.${c.level}`;
    document.getElementById('hud-gs').textContent = `GS ${c.gear_score || 0}`;
    document.getElementById('hud-credits').textContent = parseInt(c.credits || 0).toLocaleString() + ' ¢';

    const hpPct = Math.min(100, 50 + (c.gear_score || 0) / 10) + '%';
    const armorPct = Math.min(100, 30 + (c.gear_score || 0) / 15) + '%';
    const xpPct = Math.min(100, ((c.xp % 10000) / 10000) * 100) + '%';

    document.getElementById('hud-health-bar').style.width = hpPct;
    document.getElementById('hud-armor-bar').style.width = armorPct;
    document.getElementById('hud-xp-bar').style.width = xpPct;

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
    el.innerHTML = missions.slice(0, 8).map(m => `
      <div class="mission-list-item" onclick="window.Game.runMission('${m.id}', '${m.name}')">
        <div class="mli-name">${m.name}</div>
        <div class="mli-type">${m.type.toUpperCase()} · ${m.difficulty.toUpperCase()} · GS ${m.min_gs || '0'}+</div>
        <div class="mli-prog"><div class="mli-prog-fill" style="width:${Math.min(100, m.completions * 10)}%"></div></div>
      </div>
    `).join('');
  },

  renderFeed(feedItems) {
    const el = document.getElementById('activity-feed');
    if (!el) return;
    el.innerHTML = (feedItems || []).slice(0, 20).map(f => {
      const cls = f.type === 'exotic_drop' ? 'exotic' : f.type === 'base_capture' ? 'base' : f.type === 'pvp_kill' ? 'pvp' : 'complete';
      return `<div class="feed-item ${cls}">${f.actor_name}: ${f.detail}</div>`;
    }).join('') || '<div class="feed-item">No recent activity</div>';
  },

  prependFeed(event) {
    const el = document.getElementById('activity-feed');
    if (!el) return;
    const cls = event.type === 'exotic_drop' ? 'exotic' : event.type === 'base_capture' ? 'base' : event.type === 'pvp_kill' ? 'pvp' : 'complete';
    const item = document.createElement('div');
    item.className = `feed-item ${cls}`;
    item.textContent = `${event.actor_name}: ${event.detail}`;
    el.prepend(item);
    if (el.children.length > 25) el.lastChild.remove();
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

      titleEl.textContent = result.success
        ? `✅ MISSION COMPLETE — ${missionName.toUpperCase()}`
        : `❌ MISSION FAILED — ${missionName.toUpperCase()}`;

      if (result.success && result.loot?.length > 0) {
        await this.delay(400);
        lootEl.style.display = 'block';
        lootItems.innerHTML = '';

        for (const item of result.loot) {
          await this.delay(300);
          lootItems.appendChild(this.buildLootCard(item));
          if (item.rarity === 'exotic') {
            this.notify(`⚡ EXOTIC DROP: ${item.name}!`, 'exotic', 5000);
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

  buildLootCard(item) {
    const div = document.createElement('div');
    div.className = 'loot-item-card';
    div.style.borderLeftColor = this.rarityColor(item.rarity);
    div.innerHTML = `
      <div class="lic-name" style="color:${this.rarityColor(item.rarity)}">${item.name}
        <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span>
      </div>
      <div class="lic-slot">${item.slot?.toUpperCase()} SLOT</div>
      <div class="lic-gs">${item.gear_score}</div>
      ${item.talent ? `<div class="lic-talent">⚡ TALENT: ${item.talent}</div>` : ''}
      ${item.stats ? `<div class="lic-stats">${this.formatStats(item.stats)}</div>` : ''}
    `;
    return div;
  },

  formatStats(stats) {
    if (!stats) return '';
    return Object.entries(stats)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${v}% ${k.replace('stat_', '').replace(/_/g, ' ').toUpperCase()}`)
      .join('  ');
  },

  rarityColor(rarity) {
    const colors = { common: '#556070', rare: '#0070dd', epic: '#a335ee', named: '#00ccff', exotic: '#ff8000' };
    return colors[rarity] || '#888';
  },

  // ============================================================
  // INVENTORY VIEW
  // ============================================================
  async loadInventoryView() {
    try {
      const inv = await API.inventory.get();
      document.getElementById('inv-gs-display').textContent = `GS ${inv.gearScore}`;
      this.renderEquipped(inv.equipped);
      this.renderStash(inv.stash);
    } catch (e) {
      this.notify(e.message, 'error');
    }
  },

  renderEquipped(items) {
    const slots = ['mask', 'chest', 'gloves', 'holster', 'legs', 'backpack', 'primary', 'secondary', 'sidearm'];
    const el = document.getElementById('equipped-grid');
    el.innerHTML = slots.map(slot => {
      const item = items.find(i => i.slot === slot);
      if (!item) {
        return `<div class="gear-slot empty" style="color:var(--muted);font-size:10px;text-align:center;justify-content:center;display:flex;align-items:center">
          <div><div style="letter-spacing:2px">${slot.toUpperCase()}</div><div style="font-size:9px;color:var(--muted)">EMPTY</div></div>
        </div>`;
      }
      return `<div class="gear-slot" onclick="window.Game.showItem('${item.id}', '${item.name}', '${item.rarity}', ${item.gear_score}, true, '${item.slot || slot}')">
        <div class="gs-label-sm">${slot.toUpperCase()}</div>
        <div class="gs-item-name" style="color:${this.rarityColor(item.rarity)}">${item.name}</div>
        <div><span class="gs-item-gs">${item.gear_score}</span></div>
        <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span>
      </div>`;
    }).join('');
  },

  renderStash(items) {
    const el = document.getElementById('stash-list');
    document.getElementById('stash-count').textContent = `${items.length} items`;
    if (items.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px 0">Run missions to earn loot</div>';
      return;
    }
    el.innerHTML = items.map(item => `
      <div class="stash-item" onclick="window.Game.showItem('${item.id}', '${item.name}', '${item.rarity}', ${item.gear_score}, false, '${item.slot}')">
        <div class="si-gs" style="color:${this.rarityColor(item.rarity)}">${item.gear_score}</div>
        <div class="si-info">
          <div class="si-name" style="color:${this.rarityColor(item.rarity)}">${item.name}</div>
          <div class="si-slot">${item.slot?.toUpperCase()} <span class="rarity-tag rt-${item.rarity}">${item.rarity.toUpperCase()}</span></div>
        </div>
      </div>
    `).join('');
  },

  showItem(id, name, rarity, gs, isEquipped, slot) {
    this.currentItemId = id;
    const modal = document.getElementById('item-modal');
    const content = document.getElementById('item-modal-content');
    const equipBtn = document.getElementById('item-equip-btn');
    const sellBtn = document.getElementById('item-sell-btn');

    content.innerHTML = `
      <div class="item-detail-header">
        <div>
          <div style="font-size:10px;letter-spacing:2px;color:var(--muted)">${slot?.toUpperCase()} SLOT</div>
          <div style="font-size:20px;font-weight:700;color:${this.rarityColor(rarity)};margin:4px 0">${name}</div>
          <span class="rarity-tag rt-${rarity}">${rarity.toUpperCase()}</span>
          ${isEquipped ? '<span style="margin-left:6px;font-size:10px;color:var(--green)">● EQUIPPED</span>' : ''}
        </div>
        <div class="item-gs-big">${gs}</div>
      </div>
    `;
    equipBtn.textContent = isEquipped ? 'UNEQUIP' : 'EQUIP';
    equipBtn.onclick = isEquipped ? () => this.unequipItem(id) : () => this.equipCurrentItem();
    sellBtn.style.display = isEquipped ? 'none' : 'block';
    modal.style.display = 'flex';
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

  enterDZ() { this.notify('Entering Dark Zone — watch for rogues!', 'error'); },

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
        return `<div class="lb-row ${isYou ? 'you' : ''}">
          ${rankLabel(entry.rank)}
          <div class="lb-name">
            ${entry.name || entry.clan_name}
            ${isYou ? '<span class="you-tag">[YOU]</span>' : ''}
            <div class="lb-clan">${entry.clan_tag ? `[${entry.clan_tag}]` : ''}</div>
          </div>
          <div class="lb-value">${formatVal(type, entry.value)}</div>
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
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
};

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
