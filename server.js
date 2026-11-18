const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// =========================================================================
// AUTHORITATIVE SHARED GALAXY & CHAT STATE
// =========================================================================
const GALAXY_STATE = {
  epoch: 1,
  poolSol: 0.00,
  planets: {
    wif:      { id: 'wif',      name: 'Knit-Prime', owner: 'wif',     hp: 100, maxHp: 100, level: 1, garrison: 3 },
    bonk:     { id: 'bonk',     name: 'Bonk-IV',    owner: 'bonk',    hp: 100, maxHp: 100, level: 1, garrison: 3 },
    pepe:     { id: 'pepe',     name: 'Kekistan-9', owner: 'pepe',    hp: 105, maxHp: 105, level: 1, garrison: 3 },
    popcat:   { id: 'popcat',   name: 'Meow-Cryo',  owner: 'popcat',  hp: 130, maxHp: 130, level: 1, garrison: 3 },
    pumpmoon: { id: 'pumpmoon', name: 'Pump-Moon',  owner: 'neutral', hp: 75,  maxHp: 75,  level: 1, garrison: 1 },
    rugrock:  { id: 'rugrock',  name: 'Rug-Rock',   owner: 'neutral', hp: 85,  maxHp: 85,  level: 1, garrison: 1 }
  },
  messages: [
    { chan: 'global', sender: 'System', tag: 'SOL', color: '#14F195', text: 'Live Multiplayer Trenches online! Chat & raid in real time.' }
  ]
};

const onlinePlayers = new Map();

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    game: 'DEGEN GALAXY ($DGALAXY)',
    onlinePlayers: onlinePlayers.size,
    epoch: GALAXY_STATE.epoch,
    poolSol: GALAXY_STATE.poolSol
  });
});

// Passive planetary shield regen every 3 seconds
setInterval(() => {
  let changed = false;
  Object.values(GALAXY_STATE.planets).forEach(pl => {
    if (pl.hp < pl.maxHp) {
      pl.hp = Math.min(pl.maxHp, pl.hp + 2);
      changed = true;
    }
  });
  if (changed) {
    io.emit('galaxy_sync', {
      planets: GALAXY_STATE.planets,
      poolSol: GALAXY_STATE.poolSol,
      onlineCount: onlinePlayers.size
    });
  }
}, 3000);

io.on('connection', (socket) => {
  // Send immediate snapshot to newly connected player
  socket.emit('init_state', {
    epoch: GALAXY_STATE.epoch,
    poolSol: GALAXY_STATE.poolSol,
    planets: GALAXY_STATE.planets,
    messages: GALAXY_STATE.messages,
    onlineCount: onlinePlayers.size + 1
  });

  socket.on('join_commander', (data) => {
    const cleanName = String(data?.name || 'AnonDegen').slice(0, 20);
    const faction = String(data?.faction || 'wif');
    onlinePlayers.set(socket.id, { name: cleanName, faction, wallet: data?.wallet || null });
    io.emit('online_count', onlinePlayers.size);
  });

  // Real-time Global & Team Chat Broadcast
  socket.on('send_chat', (payload) => {
    const text = String(payload?.text || '').trim().slice(0, 120);
    if (!text) return;
    const msg = {
      chan: payload?.chan === 'team' ? 'team' : 'global',
      sender: String(payload?.sender || 'AnonDegen').slice(0, 20),
      tag: String(payload?.tag || 'SOL').slice(0, 6),
      color: String(payload?.color || '#14F195'),
      text
    };
    GALAXY_STATE.messages.push(msg);
    if (GALAXY_STATE.messages.length > 50) GALAXY_STATE.messages.shift();
    io.emit('chat_message', msg);
  });

  // Live Multiplayer Raid Squadron Broadcast + Authoritative Planet Damage
  socket.on('launch_raid', (payload) => {
    const target = GALAXY_STATE.planets[payload?.targetId];
    if (!target) return;

    const attackerOwner = String(payload?.attackerOwner || 'wif');
    const dmg = Math.max(10, Math.min(400, Number(payload?.dmg || 35)));

    // Broadcast 3D squadron flight to ALL connected players immediately
    io.emit('remote_raid_launched', {
      fromId: payload?.fromId || attackerOwner,
      targetId: target.id,
      attackerOwner,
      shipType: payload?.shipType || 'interceptor',
      dmg,
      isRally: Boolean(payload?.isRally),
      sender: String(payload?.sender || 'Commander').slice(0, 20)
    });

    // Apply impact damage after flight travel delay
    setTimeout(() => {
      const pl = GALAXY_STATE.planets[target.id];
      if (!pl) return;
      pl.hp -= dmg;
      let capturedBy = null;
      if (pl.hp <= 0) {
        pl.owner = attackerOwner;
        pl.hp = Math.round(pl.maxHp * 0.75);
        pl.garrison = 3;
        capturedBy = attackerOwner;
      }
      io.emit('planet_updated', { planet: pl, capturedBy, attackerName: payload?.sender || 'Commander' });
    }, 1800);
  });

  // Live Jackpot & Planet Shield Updates
  socket.on('deposit_confirmed', (payload) => {
    const added = Number(payload?.addedSol || 0);
    if (added > 0 && added <= 50) {
      GALAXY_STATE.poolSol = +(GALAXY_STATE.poolSol + added).toFixed(2);
      io.emit('pool_updated', GALAXY_STATE.poolSol);
    }
  });

  socket.on('upgrade_planet', (payload) => {
    const pl = GALAXY_STATE.planets[payload?.planetId];
    if (!pl) return;
    pl.level += 1;
    pl.maxHp += 35;
    pl.hp = pl.maxHp;
    pl.garrison = Math.min(8, pl.garrison + 1);
    io.emit('planet_updated', { planet: pl, capturedBy: null });
  });

  socket.on('disconnect', () => {
    onlinePlayers.delete(socket.id);
    io.emit('online_count', onlinePlayers.size);
  });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DEGEN GALAXY Multiplayer Server running on 0.0.0.0:${PORT}`);
});