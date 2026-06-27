/**
 * Division MMO — API Client
 * All fetch calls to the backend
 */

const API = {
  base: '/api',

  async request(method, path, body) {
    const token = localStorage.getItem('div_token');
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(this.base + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get:    (path)       => API.request('GET',    path),
  post:   (path, body) => API.request('POST',   path, body),
  delete: (path)       => API.request('DELETE', path),

  // AUTH
  auth: {
    login:    (email, password) => API.post('/auth/login', { email, password }),
    register: (d) => API.post('/auth/register', d),
    me:       ()  => API.get('/auth/me'),
  },

  // MISSIONS
  missions: {
    list:    ()   => API.get('/missions'),
    run:     (id) => API.post(`/missions/${id}/run`),
    history: ()   => API.get('/missions/history'),
  },

  // INVENTORY
  inventory: {
    get:       ()       => API.get('/inventory'),
    equip:     (id)     => API.post(`/inventory/${id}/equip`),
    unequip:   (id)     => API.post(`/inventory/${id}/unequip`),
    sell:      (id)     => API.post(`/inventory/${id}/sell`),
    sellAll:   (rarity) => API.post('/inventory/sell-all', { rarity }),
    openCache: (type)   => API.post('/inventory/open-cache', { type }),
  },

  // CLANS
  clans: {
    list:   ()    => API.get('/clans'),
    mine:   ()    => API.get('/clans/mine'),
    create: (d)   => API.post('/clans', d),
    join:   (id)  => API.post(`/clans/${id}/join`),
    leave:  ()    => API.post('/clans/leave'),
    bases:  ()    => API.get('/clans/bases'),
    attackBase: (id) => API.post(`/clans/bases/${id}/attack`),
  },

  // PVP
  pvp: {
    zones:  ()            => API.get('/pvp/zones'),
    feed:   ()            => API.get('/pvp/feed'),
    stats:  ()            => API.get('/pvp/stats'),
    attack: (id, zone)    => API.post(`/pvp/attack/${id}`, { zone }),
    clearRogue: ()        => API.post('/pvp/rogue/clear'),
  },

  // LEADERBOARD
  leaderboard: {
    get: (type) => API.get(`/leaderboard/${type}`),
  },
};

window.API = API;

const ContractsAPI = {
  get:   ()   => API.get('/contracts'),
  claim: (id) => API.post(`/contracts/${id}/claim`),
};

const BountiesAPI = {
  get:    ()                       => API.get('/bounties'),
  post:   (targetId, reward, reason) => API.post('/bounties', { targetId, reward, reason }),
  claim:  (id)                     => API.post(`/bounties/${id}/claim`),
};

const EventsAPI = {
  active: ()   => API.get('/events/active'),
  claim:  (id) => API.post(`/events/${id}/claim`),
};

const RecalibrationAPI = {
  preview: (invId)              => API.get(`/recalibration/${invId}`),
  reroll:  (invId, statToReroll) => API.post(`/recalibration/${invId}`, { statToReroll }),
};
