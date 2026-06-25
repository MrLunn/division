/**
 * Division MMO — Map Engine
 * Animated canvas map with mission markers, pulse effects, agent position
 */

const MapEngine = {
  canvas: null,
  ctx: null,
  W: 0, H: 0,
  missions: [],
  hovered: null,
  agentPos: { x: 0.18, y: 0.28 },
  pulseT: 0,
  animFrame: null,
  selectedMission: null,

  init() {
    this.canvas = document.getElementById('map-canvas');
    if (!this.canvas) return;
    this.resize();
    this.canvas.addEventListener('mousemove', (e) => this.onHover(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hovered = null;
      document.getElementById('map-tooltip').style.display = 'none';
    });
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (!this.canvas) return;
    this.W = this.canvas.offsetWidth;
    this.H = this.canvas.offsetHeight;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
  },

  setMissions(missions) {
    this.missions = missions || [];
  },

  start() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.loop();
  },

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  },

  loop() {
    this.pulseT += 0.03;
    this.draw();
    this.animFrame = requestAnimationFrame(() => this.loop());
  },

  draw() {
    const { ctx, W, H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    this.drawBackground();
    this.drawStreets();
    this.drawBlocks();
    this.drawDZBorder();
    this.drawMissions();
    this.drawAgent();
  },

  drawBackground() {
    const { ctx, W, H } = this;
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);
  },

  drawStreets() {
    const { ctx, W, H } = this;
    ctx.strokeStyle = '#0c1018';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 28) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 28) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Major arteries
    ctx.strokeStyle = '#10161e';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(p => {
      ctx.beginPath(); ctx.moveTo(p * W, 0); ctx.lineTo(p * W, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p * H); ctx.lineTo(W, p * H); ctx.stroke();
    });
  },

  drawBlocks() {
    const { ctx, W, H } = this;
    const blocks = [
      [0.03,0.03,0.18,0.16],[0.25,0.04,0.20,0.12],[0.48,0.06,0.20,0.14],[0.73,0.04,0.22,0.18],
      [0.03,0.28,0.14,0.20],[0.52,0.26,0.16,0.18],[0.73,0.28,0.22,0.16],
      [0.05,0.60,0.20,0.24],[0.30,0.62,0.22,0.22],[0.57,0.68,0.26,0.20],
      [0.05,0.50,0.10,0.08], [0.80,0.52,0.14,0.10],
    ];
    blocks.forEach(([bx, by, bw, bh]) => {
      const l = 0.06 + Math.random() * 0.02;
      ctx.fillStyle = `rgb(${Math.floor(l*240)},${Math.floor(l*230)},${Math.floor(l*200)})`;
      ctx.fillRect(bx * W, by * H, bw * W, bh * H);
      // Windows
      const winColor = `rgba(180,200,240,${0.05 + Math.sin(this.pulseT * 0.5 + bx * 10) * 0.02})`;
      ctx.fillStyle = winColor;
      for (let wx = bx * W + 4; wx < (bx + bw) * W - 4; wx += 8) {
        for (let wy = by * H + 4; wy < (by + bh) * H - 4; wy += 8) {
          if (Math.random() > 0.5) ctx.fillRect(wx, wy, 4, 3);
        }
      }
      ctx.strokeStyle = '#111820';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx * W, by * H, bw * W, bh * H);
    });
  },

  drawDZBorder() {
    const { ctx, W, H } = this;
    const x = W * 0.22, y = H * 0.46, w = W * 0.62, h = H * 0.42;
    ctx.strokeStyle = `rgba(231,76,60,${0.4 + Math.sin(this.pulseT) * 0.15})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(231,76,60,0.03)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(231,76,60,0.7)';
    ctx.font = 'bold 9px Share Tech Mono';
    ctx.fillText('DARK ZONE PERIMETER', x + 8, y + 13);
  },

  drawMissions() {
    const { ctx, W, H } = this;
    this.missions.forEach((m, i) => {
      const mx = m.map_x * W, my = m.map_y * H;
      const isHover = this.hovered === i;
      const pulse = Math.sin(this.pulseT + i * 1.2) * 0.5 + 0.5;
      const color = this.missionColor(m);

      // Pulse rings
      for (let r = 0; r < 2; r++) {
        const radius = 20 + r * 12 + pulse * 8;
        const alpha = (0.3 - r * 0.1) * pulse;
        ctx.beginPath();
        ctx.arc(mx, my, radius, 0, Math.PI * 2);
        ctx.strokeStyle = color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Outer ring
      ctx.beginPath();
      ctx.arc(mx, my, isHover ? 14 : 11, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = isHover ? 2 : 1.5;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? color : color + 'aa';
      ctx.fill();

      // Progress arc (for completions)
      const progress = parseFloat(m.completions) > 0 ? Math.min(1, parseFloat(m.completions) / 10) : 0;
      if (progress > 0) {
        ctx.beginPath();
        ctx.arc(mx, my, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.save();
      ctx.font = isHover ? 'bold 11px Rajdhani' : '10px Rajdhani';
      ctx.fillStyle = isHover ? '#ffffff' : '#7a909a';
      ctx.textAlign = 'center';
      ctx.fillText(m.name.toUpperCase(), mx, my + 26);
      ctx.restore();
    });
  },

  drawAgent() {
    const { ctx, W, H, pulseT } = this;
    const x = this.agentPos.x * W, y = this.agentPos.y * H;
    const p = Math.sin(pulseT * 2.5) * 2;

    // Outer pulse
    ctx.beginPath();
    ctx.arc(x, y, 12 + p, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(58,143,212,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Agent dot
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#3a8fd4';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Label
    ctx.font = 'bold 10px Rajdhani';
    ctx.fillStyle = '#3a8fd4';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', x, y + 20);
  },

  missionColor(m) {
    const colors = {
      expedition:  '#f4a116',
      mission:     '#a335ee',
      stronghold:  '#00ccff',
      dark_zone:   '#e74c3c',
      raid:        '#2ecc71',
      base_raid:   '#9b59b6',
      bounty:      '#3a8fd4',
      daily:       '#f4a116',
    };
    return colors[m.type] || '#888';
  },

  onHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let found = null;

    for (let i = 0; i < this.missions.length; i++) {
      const m = this.missions[i];
      const dx = mx - m.map_x * this.W;
      const dy = my - m.map_y * this.H;
      if (Math.sqrt(dx * dx + dy * dy) < 20) { found = i; break; }
    }

    this.hovered = found;
    const tt = document.getElementById('map-tooltip');

    if (found !== null) {
      const m = this.missions[found];
      tt.innerHTML = `
        <h4>${m.name}</h4>
        <div class="tt-diff">${m.type.toUpperCase()} · ${m.difficulty.toUpperCase()}</div>
        <div class="tt-gs">MIN GS: ${m.min_gs || 'NONE'}</div>
        <div class="tt-reward">+${m.xp_reward?.toLocaleString()} XP · +${m.credit_reward?.toLocaleString()} ¢</div>
        <button class="tt-launch" onclick="window.Game.runMission('${m.id}', '${m.name}')">⚡ LAUNCH MISSION</button>
      `;
      tt.style.display = 'block';
      const ttX = Math.min(mx + 20, this.W - 270);
      const ttY = Math.min(my - 10, this.H - 160);
      tt.style.left = ttX + 'px';
      tt.style.top = ttY + 'px';
    } else {
      tt.style.display = 'none';
    }
  },

  onClick(e) {
    if (this.hovered !== null) {
      const m = this.missions[this.hovered];
      if (m) window.Game?.runMission(m.id, m.name);
    }
  },
};

window.MapEngine = MapEngine;
