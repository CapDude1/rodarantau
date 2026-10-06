'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const port = Number(process.env.PORT || 3000);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const maxRooms = 500;
const rooms = new Map();
const indexPath = path.join(__dirname, 'index.html');
const properties = [
  { index:1, name:'Warung Kopi', price:30, rent:7 },
  { index:3, name:'Kios Bunga', price:35, rent:8 },
  { index:6, name:'Bengkel Roda', price:40, rent:9 },
  { index:8, name:'Kedai Roti', price:45, rent:10 },
  { index:11, name:'Studio Kain', price:50, rent:12 },
  { index:13, name:'Toko Buku', price:55, rent:13 },
  { index:16, name:'Kebun Kota', price:60, rent:14 },
  { index:18, name:'Rumah Musik', price:65, rent:15 },
  { index:20, name:'Paviliun Seni', price:70, rent:17 },
  { index:22, name:'Pusat Kriya', price:75, rent:18 }
];
const events = [
  { text:'Festival kampung ramai! Usahamu mendapat tambahan 15 jt.', amount:15 },
  { text:'Pesanan daring melonjak. Kamu mendapat 12 jt.', amount:12 },
  { text:'Perbaikan atap mendadak menghabiskan 10 jt.', amount:-10 },
  { text:'Kamu membantu tetangga; warga membalas dengan 8 jt.', amount:8 },
  { text:'Harga bahan naik. Kamu mengeluarkan 12 jt.', amount:-12 },
  { text:'Karya lokalmu terpilih untuk pameran. Kamu mendapat 20 jt.', amount:20 },
  { text:'Dompetmu ditemukan warga. Kamu mendapat kembali 6 jt.', amount:6 },
  { text:'Sepeda perlu diservis. Biayanya 8 jt.', amount:-8 }
];

function send(socket, packet) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
}

function fail(socket, message) {
  send(socket, { type:'error', message });
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 18);
}

function makeCode() {
  let code;
  do {
    code = Array.from({ length:5 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function appendLog(room, text) {
  room.log.unshift(text);
  room.log = room.log.slice(0, 12);
  room.lastEvent = text;
}

function publicState(room) {
  return {
    code:room.code,
    status:room.status,
    hostId:room.hostId,
    round:room.round,
    currentPlayer:room.currentPlayer,
    phase:room.phase,
    landed:room.landed,
    dice:room.dice,
    owners:room.owners,
    lastEvent:room.lastEvent,
    log:room.log,
    winnerId:room.winnerId,
    players:room.players.map(player => ({
      id:player.id,
      name:player.name,
      cash:player.cash,
      position:player.position,
      online:player.online,
      properties:player.properties
    }))
  };
}

function broadcast(room) {
  const packet = JSON.stringify({ type:'state', state:publicState(room) });
  for (const socket of room.clients.values()) {
    if (socket.readyState === WebSocket.OPEN) socket.send(packet);
  }
}

function createPlayer(name) {
  return {
    id:randomUUID(),
    token:randomUUID(),
    name,
    cash:100,
    position:0,
    online:true,
    properties:[]
  };
}

function makeRoom(name) {
  const player = createPlayer(name);
  const room = {
    code:makeCode(),
    hostId:player.id,
    status:'lobby',
    players:[player],
    clients:new Map(),
    round:1,
    currentPlayer:0,
    phase:'roll',
    landed:null,
    dice:null,
    owners:Array(24).fill(null),
    log:['Room dibuat. Bagikan kode undangan ke temanmu.'],
    lastEvent:'Kelilingi kota, bangun usaha, dan buat setiap langkah berarti.',
    winnerId:null
  };
  rooms.set(room.code, room);
  return { room, player };
}

function joinRoom(socket, message) {
  if (socket.roomCode) return fail(socket, 'Koneksi ini sudah bergabung ke room.');
  const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
  const room = rooms.get(code);
  if (!room) return fail(socket, 'Room tidak ditemukan. Periksa kembali kodenya.');

  const token = typeof message.token === 'string' ? message.token : '';
  let player = room.players.find(candidate => candidate.token === token && token);
  const reconnected = Boolean(player);
  if (!player) {
    const name = cleanName(message.name);
    if (!name) return fail(socket, 'Isi nama pemain terlebih dahulu.');
    if (room.status !== 'lobby') return fail(socket, 'Permainan sudah dimulai dan kode ini tidak memiliki kursi tersimpan.');
    if (room.players.length >= 4) return fail(socket, 'Room sudah penuh. Maksimal 4 pemain.');
    player = createPlayer(name);
    room.players.push(player);
    appendLog(room, `${player.name} bergabung ke room.`);
  }

  const previous = room.clients.get(player.token);
  if (previous && previous !== socket) previous.close(4001, 'Session reconnected elsewhere');
  player.online = true;
  room.clients.set(player.token, socket);
  socket.roomCode = room.code;
  socket.playerToken = player.token;
  socket.playerId = player.id;
  send(socket, {
    type:'welcome',
    code:room.code,
    token:player.token,
    playerId:player.id,
    name:player.name,
    reconnected
  });
  broadcast(room);
}

function startGame(room, player) {
  if (player.id !== room.hostId) return 'Hanya pemilik room yang dapat memulai permainan.';
  if (room.status !== 'lobby') return 'Permainan sudah dimulai.';
  if (room.players.filter(candidate => candidate.online).length < 2) return 'Diperlukan minimal 2 pemain yang sedang terhubung.';
  room.status = 'playing';
  room.round = 1;
  room.currentPlayer = 0;
  room.phase = 'roll';
  appendLog(room, `Permainan dimulai dengan ${room.players.length} pemain. Semoga sukses!`);
  return null;
}

function finishGame(room) {
  room.status = 'finished';
  room.phase = 'finished';
  const ranked = room.players.slice().sort((a,b) => {
    const worthA = a.cash + a.properties.reduce((sum, property) => sum + property.price + property.level * property.price * .35, 0);
    const worthB = b.cash + b.properties.reduce((sum, property) => sum + property.price + property.level * property.price * .35, 0);
    return worthB - worthA;
  });
  room.winnerId = ranked[0].id;
  appendLog(room, `${ranked[0].name} memenangkan permainan dengan kekayaan bersih tertinggi!`);
}

function landOnSpace(room, player, spaceIndex) {
  room.landed = spaceIndex;
  const property = properties.find(candidate => candidate.index === spaceIndex);
  if (property) {
    const ownerId = room.owners[spaceIndex];
    if (!ownerId) {
      room.phase = 'buy';
      appendLog(room, `${player.name} tiba di ${property.name}.`);
      room.lastEvent = `${property.name} belum dimiliki. Beli untuk membangun usaha atau lanjutkan perjalananmu.`;
      return;
    }
    if (ownerId === player.id) {
      room.phase = 'ready';
      appendLog(room, `${player.name} singgah di usahanya sendiri, ${property.name}.`);
      room.lastEvent = `Kamu berada di ${property.name}. Tingkatkan usaha untuk menaikkan sewanya.`;
      return;
    }
    const owner = room.players.find(candidate => candidate.id === ownerId);
    const ownedProperty = owner.properties.find(candidate => candidate.index === spaceIndex);
    const rent = property.rent + ownedProperty.level * 4;
    player.cash -= rent;
    owner.cash += rent;
    room.phase = 'ready';
    appendLog(room, `${player.name} membayar sewa ${rent} jt kepada ${owner.name} di ${property.name}.`);
    room.lastEvent = `${player.name} membayar sewa ${rent} jt kepada ${owner.name}.`;
    return;
  }

  room.phase = 'ready';
  if (spaceIndex === 0) {
    room.lastEvent = `${player.name} tiba di Alun-alun. Lewati lagi untuk mendapat 20 jt.`;
  } else if ([2,9,14,21].includes(spaceIndex)) {
    const card = events[randomInt(events.length)];
    player.cash += card.amount;
    room.lastEvent = card.text;
    appendLog(room, `${player.name}: ${card.text}`);
  } else if ([4,10,17].includes(spaceIndex)) {
    player.cash += 12;
    room.lastEvent = `${player.name} mendapat peluang dagang di pasar dan meraih 12 jt.`;
    appendLog(room, `${player.name} mendapat 12 jt dari pasar.`);
  } else if ([5,12,19].includes(spaceIndex)) {
    player.cash -= 12;
    room.lastEvent = `${player.name} membayar retribusi kota sebesar 12 jt.`;
    appendLog(room, `${player.name} membayar retribusi 12 jt.`);
  } else {
    player.cash += 8;
    room.lastEvent = `${player.name} mendapat bonus kegiatan warga sebesar 8 jt.`;
    appendLog(room, `${player.name} mendapat bonus warga 8 jt.`);
  }
}

function handleAction(room, sender, action) {
  if (room.status !== 'playing') return 'Permainan belum berlangsung.';
  const player = room.players[room.currentPlayer];
  if (!player) return 'Giliran pemain tidak valid.';
  if (player.online && player.id !== sender.id) return 'Belum giliranmu.';

  if (action === 'roll') {
    if (room.phase !== 'roll') return 'Selesaikan aksi pada petak ini terlebih dahulu.';
    const dice = randomInt(1,7);
    const previous = player.position;
    const next = (previous + dice) % 24;
    if (previous + dice >= 24) {
      player.cash += 20;
      appendLog(room, `${player.name} melewati Alun-alun dan mendapat 20 jt.`);
    }
    player.position = next;
    room.dice = dice;
    appendLog(room, `${player.name} melempar ${dice} dan maju ke ${properties.find(item => item.index === next)?.name || `petak ${next+1}`}.`);
    landOnSpace(room, player, next);
    return null;
  }

  if (action === 'buy') {
    if (room.phase !== 'buy') return 'Tidak ada properti yang dapat dibeli saat ini.';
    const property = properties.find(candidate => candidate.index === room.landed);
    if (!property || room.owners[property.index]) return 'Properti ini sudah tidak tersedia.';
    if (player.cash < property.price) return 'Kasmu tidak cukup untuk membeli tempat usaha ini.';
    player.cash -= property.price;
    player.properties.push({ index:property.index, price:property.price, level:0 });
    room.owners[property.index] = player.id;
    room.phase = 'ready';
    appendLog(room, `${player.name} membeli ${property.name} seharga ${property.price} jt.`);
    room.lastEvent = `${property.name} sekarang menjadi milik ${player.name}. Usaha ini bisa ditingkatkan saat berada di petaknya.`;
    return null;
  }

  if (action === 'decline') {
    if (room.phase !== 'buy') return 'Tidak ada pembelian yang perlu dilewati.';
    room.phase = 'ready';
    appendLog(room, `${player.name} melewati kesempatan membeli properti.`);
    room.lastEvent = `${player.name} memilih tidak membeli properti kali ini.`;
    return null;
  }

  if (action === 'upgrade') {
    if (room.phase !== 'ready') return 'Selesaikan aksi saat ini terlebih dahulu.';
    const owned = player.properties.find(property => property.index === room.landed);
    if (!owned || owned.level >= 2) return 'Usaha ini tidak dapat ditingkatkan lagi.';
    if (player.cash < owned.price) return 'Kasmu tidak cukup untuk meningkatkan usaha.';
    player.cash -= owned.price;
    owned.level += 1;
    appendLog(room, `${player.name} meningkatkan usaha di petak ${room.landed+1} ke level ${owned.level}.`);
    room.lastEvent = `Usaha meningkat ke level ${owned.level}. Sewanya bertambah 4 jt per kunjungan.`;
    return null;
  }

  if (action === 'end') {
    if (room.phase !== 'ready') return 'Selesaikan aksi pada petak ini terlebih dahulu.';
    room.dice = null;
    room.landed = null;
    room.phase = 'roll';
    if (room.currentPlayer === room.players.length - 1) {
      room.round += 1;
      if (room.round > 12) {
        finishGame(room);
        return null;
      }
      room.currentPlayer = 0;
    } else {
      room.currentPlayer += 1;
    }
    appendLog(room, `Giliran selanjutnya: ${room.players[room.currentPlayer].name}.`);
    room.lastEvent = `Sekarang giliran ${room.players[room.currentPlayer].name}.`;
    return null;
  }
  return 'Aksi permainan tidak dikenali.';
}

const server = http.createServer((request, response) => {
  if ((request.method === 'GET' || request.method === 'HEAD') && (request.url === '/' || request.url === '/index.html')) {
    response.writeHead(200, {
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer'
    });
    if (request.method === 'HEAD') return response.end();
    return fs.createReadStream(indexPath).pipe(response);
  }
  response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', 'X-Content-Type-Options':'nosniff' });
  response.end('Tidak ditemukan');
});

const wss = new WebSocketServer({ server, maxPayload:8192 });
wss.on('connection', socket => {
  socket.on('message', (raw, isBinary) => {
    if (isBinary) return fail(socket, 'Format pesan tidak didukung.');
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return fail(socket, 'Pesan tidak dapat dibaca.');
    }
    if (!message || typeof message.type !== 'string') return fail(socket, 'Jenis pesan tidak valid.');

    if (message.type === 'create') {
      if (socket.roomCode) return fail(socket, 'Koneksi ini sudah bergabung ke room.');
      if (rooms.size >= maxRooms) return fail(socket, 'Server sedang penuh. Coba lagi nanti.');
      const name = cleanName(message.name);
      if (!name) return fail(socket, 'Isi nama pemain terlebih dahulu.');
      const { room, player } = makeRoom(name);
      room.clients.set(player.token, socket);
      socket.roomCode = room.code;
      socket.playerToken = player.token;
      socket.playerId = player.id;
      send(socket, { type:'welcome', code:room.code, token:player.token, playerId:player.id, name:player.name, reconnected:false });
      broadcast(room);
      return;
    }

    if (message.type === 'join') return joinRoom(socket, message);

    const room = rooms.get(socket.roomCode);
    const player = room && room.players.find(candidate => candidate.id === socket.playerId);
    if (!room || !player || room.clients.get(player.token) !== socket) return fail(socket, 'Kamu tidak terhubung ke room aktif.');

    if (message.type === 'start') {
      const error = startGame(room, player);
      if (error) return fail(socket, error);
      broadcast(room);
      return;
    }
    if (message.type === 'leave') {
      room.clients.delete(player.token);
      player.online = false;
      if (room.status === 'lobby') {
        room.players = room.players.filter(candidate => candidate.id !== player.id);
        if (room.players.length === 0) {
          rooms.delete(room.code);
          socket.roomCode = null;
          return;
        }
        if (room.hostId === player.id) room.hostId = room.players[0].id;
        appendLog(room, `${player.name} keluar dari room.`);
      } else {
        appendLog(room, `${player.name} meninggalkan permainan; giliran ini dapat dilanjutkan pemain lain.`);
      }
      socket.roomCode = null;
      broadcast(room);
      return;
    }
    if (message.type === 'action') {
      const error = handleAction(room, player, message.action);
      if (error) return fail(socket, error);
      broadcast(room);
      return;
    }
    fail(socket, 'Jenis pesan tidak dikenal.');
  });

  socket.on('close', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(candidate => candidate.id === socket.playerId);
    if (!player || room.clients.get(player.token) !== socket) return;
    room.clients.delete(player.token);
    player.online = false;
    if (room.hostId === player.id) {
      const replacement = room.players.find(candidate => candidate.online);
      if (replacement) room.hostId = replacement.id;
    }
    appendLog(room, `${player.name} terputus. Gilirannya dapat dilanjutkan oleh pemain lain.`);
    broadcast(room);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Roda Rantau berjalan di http://localhost:${port}`);
});
