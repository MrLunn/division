/**
 * Division MMO — Oslo City Map Engine
 * Hand-drawn tactical map of Oslo with real districts, streets,
 * fjord, and mission locations placed on actual geography.
 */

const MapEngine = {
  canvas: null,
  ctx: null,
  W: 0, H: 0,
  missions: [],
  hovered: null,
  agentPos: null,
  pulseT: 0,
  animFrame: null,

  osloMissions: [
    { key: 'Aker Brygge Pier',   dbName: 'Aker Brygge Pier',   desc: 'Young Guns have seized the Aker Brygge ferry terminals. The 2006 waterfront shooting started here — finish it.', type: 'mission',    diff: 'hard',        color: '#a335ee', x: 0.28, y: 0.58, street: 'Bryggegata',           district: 'Aker Brygge',  faction: 'Young Guns'         },
    { key: 'Karl Johans Gate',   dbName: 'Karl Johans Gate',   desc: 'B-Gjengen control every block from Stortinget to Jernbanetorget. Street fight through the main boulevard.', type: 'street_fight', diff: 'challenging', color: '#e74c3c', x: 0.50, y: 0.40, street: 'Karl Johans gate',     district: 'Sentrum',      faction: 'B-Gjengen'          },
    { key: 'Grønland Sweep',     dbName: 'Gronland Sweep',     desc: '313-nettverket has fortified Grønland. Intel says weapons cache is inside the old warehouse on Grønlandsleiret.', type: 'expedition', diff: 'heroic',      color: '#f4a116', x: 0.68, y: 0.38, street: 'Grønlandsleiret',       district: 'Grønland',     faction: '313-nettverket'     },
    { key: 'Operahuset',         dbName: 'Operahuset',         desc: 'Balkan Brotherhood have turned the Opera House into a staging ground for arms shipments from Serbia. Assault from the waterfront.', type: 'stronghold', diff: 'heroic',    color: '#00ccff', x: 0.60, y: 0.62, street: 'Kirsten Flagstads Plass', district: 'Bjørvika',     faction: 'Balkan Brotherhood' },
    { key: 'Frogner Park',       dbName: 'Frogner Park',       desc: 'Bandidos Norway spotted caching weapons near Vigelandsparken. Elite enforcer with known arms trafficking connections.', type: 'bounty',     diff: 'challenging', color: '#3a8fd4', x: 0.18, y: 0.28, street: 'Kirkeveien',            district: 'Frogner',      faction: 'Bandidos Norway'    },
    { key: 'Grünerløkka Raid',  dbName: 'Grunerloekka Raid',  desc: 'Comanches MC have barricaded Thorvald Meyers gate. Banned by the Supreme Court — they have nothing left to lose.', type: 'raid',       diff: 'heroic',      color: '#2ecc71', x: 0.72, y: 0.22, street: 'Thorvald Meyers gate',  district: 'Grünerløkka',  faction: 'Comanches MC'       },
    { key: 'Stortinget',         dbName: 'Stortinget',         desc: 'B-Gjengen are using parliament square as a dead drop for narcotics. Shut it down before the morning crowds arrive.', type: 'mission',    diff: 'challenging', color: '#a335ee', x: 0.44, y: 0.36, street: 'Stortingsgata',          district: 'Sentrum',      faction: 'B-Gjengen'          },
    { key: 'Ekeberg Ridge',      dbName: 'Ekeberg Ridge',      district: 'Ekeberg',     faction: 'Mixed',             desc: 'Three factions fighting over Ekeberg ridge. Young Guns, 313, and Balkan Brotherhood all want the hilltop extraction point.', type: 'dark_zone',  diff: 'heroic',      color: '#e74c3c', x: 0.76, y: 0.68, street: 'Kongshavn'              },
    { key: 'Daily: Youngstorget', dbName: 'Daily Youngstorget', desc: 'Young Guns are running open-air drug sales from Youngstorget. Clear the square before market hours.', type: 'daily',      diff: 'normal',      color: '#f4a116', x: 0.55, y: 0.32, street: 'Møllergata',             district: 'Sentrum',      faction: 'Young Guns'         },
    { key: 'Tjuvholmen Base',    dbName: 'Tjuvholmen Base',    desc: 'Balkan Brotherhood money-laundering hub in the gallery district. Accountants, enforcers, and a lot of Serbian passports.', type: 'base_raid',  diff: 'heroic',      color: '#9b59b6', x: 0.20, y: 0.66, street: 'Tjuvholmen Allé',       district: 'Tjuvholmen',   faction: 'Balkan Brotherhood' },
  ],

  init() {
    this.canvas = document.getElementById('map-canvas');
    if (!this.canvas) return;
this.ctx = this.canvas.getContext('2d');
        this.resize();
    this.canvas.addEventListener('mousemove', (e) => this.onHover(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hovered = null;
      const tt = document.getElementById('map-tooltip');
      if (tt) tt.style.display = 'none';
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

  setMissions(missions) { this.missions = missions || []; },

  getMergedMissions() {
    return this.osloMissions.map(loc => {
      const dbMatch = this.missions.find(m =>
        m.name.toLowerCase() === loc.dbName.toLowerCase()
      );
      return { ...loc, dbMission: dbMatch || null };
    });
  },

  start() { if (this.animFrame) cancelAnimationFrame(this.animFrame); this.loop(); },
  stop()  { if (this.animFrame) cancelAnimationFrame(this.animFrame); this.animFrame = null; },

  // Bot agents moving on the map — live positions
  botAgents: [
    { name:'Ghost_Larsen',  x:0.72, y:0.22, vx:0.0003, vy:0.0002, color:'#e74c3c',  faction:'CMC'  },
    { name:'IronFjord',     x:0.28, y:0.58, vx:-0.0002,vy:0.0003, color:'#a335ee',  faction:'BB'   },
    { name:'NordAgent',     x:0.55, y:0.32, vx:0.0004, vy:-0.0002,color:'#e8890c',  faction:'BG'   },
    { name:'Viper_Oslo',    x:0.44, y:0.62, vx:-0.0003,vy:-0.0003,color:'#2ecc71',  faction:'BDN'  },
    { name:'SHD_Wraith',    x:0.20, y:0.28, vx:0.0002, vy:0.0004, color:'#5dade2',  faction:'BB'   },
  ],

  // Animated connection lines between bot agents (faction activity)
  connectionLines: [],
  lastLineSpawn: 0,

  // Territory contests — flashing district overlays
  _territoryContests: [],

  triggerTerritoryContest(contest) {
    this._territoryContests.push({ ...contest, born: Date.now(), alpha: 0, phase: 'in' });
    setTimeout(() => {
      this._territoryContests = this._territoryContests.filter(c => c.name !== contest.name);
    }, 12000);
  },

  drawTerritoryContests() {
    const { ctx, W, H, pulseT } = this;
    const now = Date.now();
    this._territoryContests.forEach(c => {
      const age = (now - c.born) / 1000;
      const flash = Math.sin(pulseT * 6) * 0.5 + 0.5; // fast flash
      const alpha = Math.min(0.35, age * 0.15) * flash;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(c.x * W, c.y * H, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = Math.min(0.8, age * 0.3) * flash;
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Contest label
      ctx.globalAlpha = Math.min(0.9, age * 0.4);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(W * 0.009)}px Share Tech Mono`;
      ctx.textAlign = 'center';
      ctx.fillText('⚔ CONTESTED', c.x * W, c.y * H - 50);
      ctx.fillStyle = '#e74c3c';
      ctx.font = `${Math.floor(W * 0.007)}px Share Tech Mono`;
      ctx.fillText(c.challenger + ' vs ' + c.faction, c.x * W, c.y * H - 38);
      ctx.restore();
    });
  },

  loop() {
    this.pulseT += 0.018;
    this.updateBotAgents();
    this.updateConnectionLines();
    this.draw();
    this.animFrame = requestAnimationFrame(() => this.loop());
  },

  updateBotAgents() {
    const t = this.pulseT;
    this.botAgents.forEach((bot, i) => {
      // Smooth wandering using sine waves with different phases
      bot.x += bot.vx * Math.sin(t * 0.3 + i * 1.7);
      bot.y += bot.vy * Math.cos(t * 0.4 + i * 2.1);
      // Bounce off edges with padding
      if (bot.x < 0.12 || bot.x > 0.88) bot.vx *= -1;
      if (bot.y < 0.08 || bot.y > 0.82) bot.vy *= -1;
      bot.x = Math.max(0.12, Math.min(0.88, bot.x));
      bot.y = Math.max(0.08, Math.min(0.82, bot.y));
    });
  },

  updateConnectionLines() {
    const now = Date.now();
    // Spawn new lines occasionally
    if (now - this.lastLineSpawn > 2500 + Math.random() * 3000) {
      this.lastLineSpawn = now;
      const a = this.botAgents[Math.floor(Math.random() * this.botAgents.length)];
      const b = this.botAgents[Math.floor(Math.random() * this.botAgents.length)];
      if (a !== b) {
        this.connectionLines.push({
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          color: Math.random() > 0.5 ? '#e74c3c' : '#e8890c',
          alpha: 0, phase: 'in', born: now,
        });
      }
    }
    // Age lines
    this.connectionLines = this.connectionLines.filter(l => {
      const age = (now - l.born) / 1000;
      if (l.phase === 'in')  { l.alpha = Math.min(0.6, l.alpha + 0.04); if (l.alpha >= 0.6) l.phase = 'hold'; }
      if (l.phase === 'hold'){ if (age > 2.5) l.phase = 'out'; }
      if (l.phase === 'out') { l.alpha = Math.max(0, l.alpha - 0.025); }
      return l.alpha > 0;
    });
  },

  draw() {
    const { ctx, W, H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    this.drawBase(); this.drawFjord(); this.drawDistricts();
    this.drawTerritoryContests();
    this.drawConnectionLines();
    this.drawStreets(); this.drawStreetLabels(); this.drawDistrictLabels();
    this.drawDZBorder(); this.drawMissions();
    this.drawBotAgents();
    this.drawAgent();
    this.drawScanLine();
  },

  drawConnectionLines() {
    const { ctx, W, H } = this;
    this.connectionLines.forEach(l => {
      ctx.save();
      ctx.globalAlpha = l.alpha;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(l.x1 * W, l.y1 * H);
      ctx.lineTo(l.x2 * W, l.y2 * H);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small circles at endpoints
      ctx.fillStyle = l.color;
      ctx.beginPath(); ctx.arc(l.x1 * W, l.y1 * H, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(l.x2 * W, l.y2 * H, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  },

  drawBotAgents() {
    const { ctx, W, H, pulseT } = this;
    this.botAgents.forEach((bot, i) => {
      if (bot._hidden) return; // temporarily eliminated
      const x = bot.x * W, y = bot.y * H;
      const pulse = Math.sin(pulseT * 2 + i * 0.8) * 0.5 + 0.5;

      // Outer ping
      ctx.save();
      ctx.globalAlpha = pulse * 0.3;
      ctx.strokeStyle = bot.color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 8 + pulse * 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Inner dot
      ctx.save();
      ctx.globalAlpha = 0.7 + pulse * 0.3;
      ctx.fillStyle = bot.color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Name label (small, faded)
      ctx.save();
      ctx.globalAlpha = 0.4 + pulse * 0.25;
      ctx.fillStyle = bot.color;
      ctx.font = `bold ${Math.floor(W * 0.008)}px Share Tech Mono`;
      ctx.textAlign = 'center';
      ctx.fillText(bot.name.split('_')[0], x, y - 10);
      ctx.restore();
    });
  },

  // Radar sweep line — rotates across the whole map
  drawScanLine() {
    const { ctx, W, H, pulseT } = this;
    const cx = W * 0.5, cy = H * 0.45;
    const angle = (pulseT * 0.4) % (Math.PI * 2);
    const radius = Math.max(W, H) * 0.9;

    const grad = ctx.createLinearGradient(
      cx, cy,
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius
    );
    grad.addColorStop(0, 'rgba(46,204,113,0.12)');
    grad.addColorStop(0.6, 'rgba(46,204,113,0.04)');
    grad.addColorStop(1, 'rgba(46,204,113,0)');

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(46,204,113,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();

    // Filled wedge for the sweep trail
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle - 0.5, angle);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  },


  drawBase() {
    const { ctx, W, H } = this;
    ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  },

  drawFjord() {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H*0.72);
    ctx.bezierCurveTo(W*0.05,H*0.68, W*0.12,H*0.70, W*0.20,H*0.75);
    ctx.bezierCurveTo(W*0.30,H*0.80, W*0.40,H*0.78, W*0.50,H*0.82);
    ctx.bezierCurveTo(W*0.60,H*0.86, W*0.72,H*0.82, W*0.80,H*0.78);
    ctx.lineTo(W,H*0.80); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle = '#050d18'; ctx.fill();
    ctx.strokeStyle = '#0a2035'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(30,80,140,0.15)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const yOff = H*0.76 + i*(H*0.03) + Math.sin(this.pulseT*0.5+i)*2;
      ctx.beginPath(); ctx.moveTo(W*0.05, yOff);
      ctx.bezierCurveTo(W*0.25,yOff+4, W*0.5,yOff-3, W*0.80,yOff+2); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(W*0.18,H*0.60);
    ctx.bezierCurveTo(W*0.20,H*0.62, W*0.22,H*0.65, W*0.26,H*0.68);
    ctx.bezierCurveTo(W*0.30,H*0.72, W*0.35,H*0.74, W*0.38,H*0.72);
    ctx.lineTo(W*0.40,H*0.78); ctx.lineTo(W*0.15,H*0.78);
    ctx.bezierCurveTo(W*0.10,H*0.72, W*0.12,H*0.64, W*0.18,H*0.60);
    ctx.fillStyle = '#050d18'; ctx.fill(); ctx.strokeStyle='#0a2035'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle='rgba(20,60,110,0.7)';
    ctx.font = `bold ${Math.floor(W*0.012)}px "Share Tech Mono"`;
    ctx.letterSpacing='4px'; ctx.textAlign='center';
    ctx.fillText('OSLOFJORDEN', W*0.45, H*0.91);
    ctx.restore();
  },

  drawDistricts() {
    const { ctx, W, H } = this;
    const dists = [
      {x:0.00,y:0.10,w:0.22,h:0.55,b:0.055},{x:0.22,y:0.05,w:0.18,h:0.25,b:0.048},
      {x:0.22,y:0.30,w:0.28,h:0.38,b:0.060},{x:0.40,y:0.05,w:0.22,h:0.25,b:0.045},
      {x:0.62,y:0.05,w:0.20,h:0.30,b:0.042},{x:0.62,y:0.35,w:0.20,h:0.28,b:0.050},
      {x:0.50,y:0.55,w:0.28,h:0.20,b:0.052},{x:0.08,y:0.55,w:0.18,h:0.18,b:0.048},
      {x:0.82,y:0.08,w:0.18,h:0.55,b:0.040},{x:0.82,y:0.58,w:0.18,h:0.22,b:0.038},
    ];
    dists.forEach(d => {
      const bv = d.b;
      ctx.fillStyle = `rgb(${Math.floor(bv*255)},${Math.floor(bv*240)},${Math.floor(bv*200)})`;
      ctx.fillRect(d.x*W,d.y*H,d.w*W,d.h*H);
      ctx.fillStyle = `rgba(200,210,160,${0.04+Math.sin(this.pulseT*0.3+d.x*10)*0.01})`;
      const cols=Math.floor(d.w*W/10), rows=Math.floor(d.h*H/10);
      for(let ci=0;ci<cols;ci++) for(let ri=0;ri<rows;ri++)
        if((ci+ri+Math.floor(d.x*7))%3===0) ctx.fillRect(d.x*W+ci*10+2,d.y*H+ri*10+2,3,2);
      ctx.strokeStyle='#111820'; ctx.lineWidth=0.8; ctx.strokeRect(d.x*W,d.y*H,d.w*W,d.h*H);
    });
  },

  drawStreets() {
    const { ctx, W, H } = this;
    const streets = [
      {pts:[[0.22,0.40],[0.30,0.39],[0.38,0.38],[0.46,0.37],[0.54,0.36],[0.62,0.35]],w:2.5,t:'major'},
      {pts:[[0.22,0.30],[0.38,0.22],[0.56,0.20],[0.72,0.26],[0.80,0.40],[0.78,0.58],[0.60,0.65],[0.40,0.68],[0.22,0.62],[0.16,0.48],[0.22,0.30]],w:1.8,t:'ring'},
      {pts:[[0.00,0.64],[0.08,0.62],[0.18,0.60],[0.28,0.58],[0.40,0.60],[0.54,0.63],[0.65,0.64],[0.76,0.66]],w:3,t:'highway'},
      {pts:[[0.00,0.38],[0.08,0.36],[0.16,0.34],[0.22,0.34]],w:1.8,t:'major'},
      {pts:[[0.62,0.35],[0.70,0.34],[0.78,0.36],[0.84,0.40]],w:1.5,t:'street'},
      {pts:[[0.18,0.10],[0.18,0.22],[0.18,0.34],[0.18,0.46],[0.20,0.58]],w:1.5,t:'street'},
      {pts:[[0.44,0.34],[0.52,0.32],[0.62,0.30],[0.70,0.26]],w:1.2,t:'street'},
      {pts:[[0.62,0.10],[0.66,0.18],[0.68,0.26],[0.68,0.34]],w:1.2,t:'street'},
      {pts:[[0.54,0.05],[0.56,0.14],[0.58,0.22],[0.60,0.30],[0.62,0.38]],w:1.5,t:'river'},
      {pts:[[0.44,0.22],[0.44,0.30],[0.44,0.38],[0.46,0.46]],w:1.2,t:'street'},
      {pts:[[0.52,0.24],[0.52,0.32],[0.54,0.40]],w:1.0,t:'street'},
      {pts:[[0.44,0.60],[0.52,0.59],[0.60,0.60],[0.70,0.62],[0.78,0.64]],w:2,t:'major'},
      {pts:[[0.14,0.60],[0.18,0.64],[0.20,0.68]],w:1.2,t:'street'},
      {pts:[[0.62,0.42],[0.68,0.44],[0.76,0.50],[0.80,0.58]],w:1.2,t:'street'},
    ];
    streets.forEach(s => {
      if(s.pts.length<2) return;
      ctx.beginPath(); ctx.moveTo(s.pts[0][0]*W,s.pts[0][1]*H);
      for(let i=1;i<s.pts.length;i++) ctx.lineTo(s.pts[i][0]*W,s.pts[i][1]*H);
      ctx.strokeStyle=s.t==='highway'?'#1e4070':s.t==='major'?'#1e3050':s.t==='ring'?'#182840':s.t==='river'?'#0a2848':'#152030';
      ctx.lineWidth=s.w; ctx.setLineDash([]); ctx.stroke();
      if(s.t==='highway'||s.t==='major'){
        ctx.beginPath(); ctx.moveTo(s.pts[0][0]*W,s.pts[0][1]*H);
        for(let i=1;i<s.pts.length;i++) ctx.lineTo(s.pts[i][0]*W,s.pts[i][1]*H);
        ctx.strokeStyle='rgba(30,70,120,0.3)'; ctx.lineWidth=0.5; ctx.setLineDash([4,6]); ctx.stroke(); ctx.setLineDash([]);
      }
    });
  },

  drawStreetLabels() {
    const { ctx, W, H } = this;
    const labels = [
      {text:'KARL JOHANS GATE',x:0.40,y:0.375,angle:-0.025,fight:true},
      {text:'DRAMMENSVEIEN',x:0.10,y:0.352,angle:-0.04,fight:false},
      {text:'GRØNLANDSLEIRET',x:0.70,y:0.332,angle:0.04,fight:true},
      {text:'E18 MOTORVEIEN',x:0.42,y:0.618,angle:0.02,fight:false},
      {text:'KIRKEVEIEN',x:0.135,y:0.35,angle:1.57,fight:false},
      {text:'THORVALD MEYERS GT',x:0.695,y:0.18,angle:1.45,fight:true},
      {text:'AKERSGATA',x:0.415,y:0.33,angle:1.57,fight:false},
      {text:'DRONNING EUFEMIAS GT',x:0.60,y:0.592,angle:0.03,fight:false},
      {text:'STORTINGSGATA',x:0.38,y:0.31,angle:-0.03,fight:false},
      {text:'MØLLERGATA',x:0.502,y:0.30,angle:1.55,fight:false},
      {text:'TJUVHOLMEN ALLÉ',x:0.155,y:0.648,angle:1.0,fight:false},
      {text:'SCHWEIGAARDS GT',x:0.70,y:0.50,angle:0.6,fight:false},
    ];
    labels.forEach(l => {
      ctx.save(); ctx.translate(l.x*W,l.y*H); ctx.rotate(l.angle);
      ctx.font=`${l.fight?'bold ':''}${Math.max(7,Math.floor(W*0.0075))}px "Share Tech Mono"`;
      ctx.textAlign='center'; ctx.letterSpacing='1px';
      if(l.fight){
        ctx.fillStyle='rgba(220,80,30,0.85)';
        const tw=ctx.measureText(l.text).width;
        ctx.fillRect(-tw/2-3,-9,tw+6,11);
        ctx.fillStyle='#fff'; ctx.fillText(l.text,0,0);
        ctx.fillStyle='#f4a116';
        ctx.font=`${Math.max(7,Math.floor(W*0.007))}px sans-serif`;
        ctx.fillText('⚔',-ctx.measureText(l.text).width/2-10,0);
      } else {
        ctx.fillStyle='rgba(40,80,140,0.5)'; ctx.fillText(l.text,0,0);
      }
      ctx.restore();
    });
  },

  drawDistrictLabels() {
    const { ctx, W, H } = this;
    [
      {text:'FROGNER',x:0.08,y:0.18},{text:'ST. HANSHAUGEN',x:0.30,y:0.14},
      {text:'SENTRUM',x:0.34,y:0.52},{text:'GRÜNERLØKKA',x:0.52,y:0.14},
      {text:'GRØNLAND',x:0.70,y:0.16},{text:'GAMLEBYEN',x:0.70,y:0.46},
      {text:'BJØRVIKA',x:0.60,y:0.56},{text:'AKER BRYGGE',x:0.14,y:0.58},
      {text:'TJUVHOLMEN',x:0.16,y:0.68},{text:'EKEBERG',x:0.88,y:0.72},
      {text:'TØYEN',x:0.88,y:0.24},
    ].forEach(l => {
      ctx.save();
      ctx.font=`${Math.max(8,Math.floor(W*0.009))}px Rajdhani`;
      ctx.fillStyle='rgba(80,110,160,0.4)'; ctx.textAlign='center'; ctx.letterSpacing='3px';
      ctx.fillText(l.text,l.x*W,l.y*H); ctx.restore();
    });
  },

  drawDZBorder() {
    const { ctx, W, H } = this;
    const alpha=0.35+Math.sin(this.pulseT*0.7)*0.08;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W*0.62,H*0.08); ctx.lineTo(W,H*0.08); ctx.lineTo(W,H*0.78);
    ctx.lineTo(W*0.78,H*0.78); ctx.lineTo(W*0.62,H*0.65); ctx.closePath();
    ctx.strokeStyle=`rgba(231,76,60,${alpha})`; ctx.lineWidth=1.5; ctx.setLineDash([8,5]); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle='rgba(231,76,60,0.04)'; ctx.fill();
    ctx.font=`bold ${Math.max(8,Math.floor(W*0.009))}px "Share Tech Mono"`;
    ctx.fillStyle=`rgba(231,76,60,${alpha+0.2})`; ctx.textAlign='left'; ctx.letterSpacing='3px';
    ctx.fillText('⚠ DARK ZONE',W*0.64,H*0.12);
    ctx.restore();
  },

  drawMissions() {
    const { ctx, W, H } = this;
    this.getMergedMissions().forEach((m,i) => {
      const mx=m.x*W, my=m.y*H, isHov=this.hovered===i;
      const pulse=Math.sin(this.pulseT+i*1.3)*0.5+0.5;
      const isSF=m.type==='street_fight';
      for(let r=0;r<(isHov?3:2);r++){
        const radius=(isHov?22:18)+r*10+pulse*6;
        const alpha=(0.25-r*0.07)*pulse;
        ctx.beginPath(); ctx.arc(mx,my,radius,0,Math.PI*2);
        ctx.strokeStyle=m.color+Math.floor(alpha*255).toString(16).padStart(2,'0');
        ctx.lineWidth=0.8; ctx.stroke();
      }
      if(isSF){
        const s=isHov?11:9;
        ctx.save(); ctx.translate(mx,my); ctx.rotate(Math.PI/4);
        ctx.strokeStyle=m.color; ctx.lineWidth=isHov?2:1.5; ctx.strokeRect(-s,-s,s*2,s*2);
        ctx.fillStyle=isHov?m.color:m.color+'aa'; ctx.fillRect(-s+1,-s+1,s*2-2,s*2-2);
        ctx.restore();
        ctx.fillStyle='#fff'; ctx.font=`${Math.floor(W*0.012)}px sans-serif`;
        ctx.textAlign='center'; ctx.fillText('⚔',mx,my+4);
      } else {
        ctx.beginPath(); ctx.arc(mx,my,isHov?13:10,0,Math.PI*2);
        ctx.strokeStyle=m.color; ctx.lineWidth=isHov?2:1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx,my,isHov?7:5,0,Math.PI*2);
        ctx.fillStyle=isHov?m.color:m.color+'cc'; ctx.fill();
      }
      ctx.save();
      ctx.font=`${isHov?'bold ':''}${Math.max(9,Math.floor(W*0.009))}px Rajdhani`;
      ctx.textAlign='center';
      if(isHov){
        const tw=ctx.measureText(m.key).width;
        ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(mx-tw/2-4,my+14,tw+8,14);
        ctx.fillStyle=m.color;
      } else { ctx.fillStyle='rgba(180,200,220,0.7)'; }
      ctx.fillText(m.key.toUpperCase(),mx,my+24); ctx.restore();
    });
  },

  drawAgent() {
    const { ctx, W, H, pulseT } = this;
    const x=W*0.48, y=H*0.39, p=Math.sin(pulseT*2.5)*2;
    ctx.beginPath(); ctx.arc(x,y,14+p,0,Math.PI*2);
    ctx.strokeStyle='rgba(58,143,212,0.35)'; ctx.lineWidth=1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x,y,7,0,Math.PI*2); ctx.fillStyle='#3a8fd4'; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    ctx.font=`bold ${Math.floor(W*0.009)}px Rajdhani`;
    ctx.fillStyle='#3a8fd4'; ctx.textAlign='center'; ctx.fillText('YOU',x,y+20);
  },

  onHover(e) {
    const rect=this.canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const tt=document.getElementById('map-tooltip');
    if(!tt) return;

    // Check bot agents first
    let hoveredBot=null;
    for(const bot of this.botAgents){
      const dx=mx-bot.x*this.W, dy=my-bot.y*this.H;
      if(Math.sqrt(dx*dx+dy*dy)<18){hoveredBot=bot;break;}
    }
    this.hoveredBot=hoveredBot;
    if(hoveredBot){
      this.canvas.style.cursor='crosshair';
      const tier=hoveredBot.gs>350?'ELITE':hoveredBot.gs>250?'HARD':hoveredBot.gs>150?'NORMAL':'EASY';
      const bountyLine=hoveredBot.bounty?`<div class="tt-reward">☠ BOUNTY: ${hoveredBot.bounty.toLocaleString()}¢</div>`:'';
      tt.innerHTML=`<h4 style="color:${hoveredBot.color}">${hoveredBot.name}</h4>
        <div class="tt-diff" style="color:${hoveredBot.color}88">ROGUE AGENT · ${tier}</div>
        <div style="font-size:11px;color:var(--muted2);margin-bottom:6px">⚠ ${hoveredBot.faction} operative</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px">GS ${hoveredBot.gs||'???'} · Active in Dark Zone</div>
        ${bountyLine}
        <button class="tt-launch" style="background:var(--red);border:none" onclick="window.Game&&window.Game.attackBotOnMap('${hoveredBot.name}',${hoveredBot.gs||200})">☠ ATTACK AGENT</button>`;
      tt.style.display='block';
      tt.style.left=Math.min(mx+22,this.W-260)+'px';
      tt.style.top=Math.min(my-10,this.H-175)+'px';
      return;
    }
    this.canvas.style.cursor='default';

    const merged=this.getMergedMissions();
    let found=null;
    for(let i=0;i<merged.length;i++){
      const m=merged[i], dx=mx-m.x*this.W, dy=my-m.y*this.H;
      if(Math.sqrt(dx*dx+dy*dy)<22){found=i;break;}
    }
    this.hovered=found;
    if(found!==null){
      const m=merged[found];
      const typeLabels={street_fight:'⚔ STREET FIGHT',mission:'📍 MISSION',expedition:'⚡ EXPEDITION',stronghold:'🏰 STRONGHOLD',dark_zone:'⚠ DARK ZONE',raid:'💀 RAID',bounty:'🎯 BOUNTY',base_raid:'🏳 BASE CAPTURE',daily:'📅 DAILY'};
      const missionId=m.dbMission?m.dbMission.id:'';
      tt.innerHTML=`<h4 style="color:${m.color}">${m.key}</h4>
        <div class="tt-diff" style="color:${m.color}88">${typeLabels[m.type]||m.type.toUpperCase()} · ${m.diff.toUpperCase()}</div>
        <div style="font-size:11px;color:var(--muted2);margin-bottom:4px">📍 ${m.street}, ${m.district}</div>
        ${m.faction?`<div style="font-size:10px;color:#e74c3c;letter-spacing:1px;margin-bottom:6px">⚠ ${m.faction}</div>`:''}
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${m.desc}</div>
        ${m.dbMission?'<div class="tt-reward">+'+m.dbMission.xp_reward?.toLocaleString()+' XP · +'+m.dbMission.credit_reward?.toLocaleString()+' ¢</div>':'<div class="tt-reward" style="color:var(--muted2)">No mission data</div>'}
        <button class="tt-launch" onclick="window.Game&&window.Game.runMission('${missionId}','${m.key.replace(/'/g,"\\'")}')">⚡ LAUNCH MISSION</button>`;
      tt.style.display='block';
      tt.style.left=Math.min(mx+22,this.W-260)+'px';
      tt.style.top=Math.min(my-10,this.H-175)+'px';
    } else { tt.style.display='none'; }
  },

  onClick(e) {
    if(this.hoveredBot){ window.Game&&window.Game.attackBotOnMap(this.hoveredBot.name,this.hoveredBot.gs||200); return; }
    if(this.hovered!==null){
      const m=this.getMergedMissions()[this.hovered];
      if(m&&m.dbMission&&window.Game) window.Game.runMission(m.dbMission.id,m.key);
      else if(m&&window.Game) window.Game.notify(m.key+' — sync with server to unlock','error');
    }
  },
};

window.MapEngine = MapEngine;