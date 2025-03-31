const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// تحميل الجلسات من الملف
function loadSessions() {
  try {
    const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

// حفظ الجلسات في الملف
function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

let sessions = loadSessions();
const shortLinks = {};

// تقديم الملفات الثابتة
app.use(express.static(__dirname));

// رابط مختصر للجلسة
app.get('/s/:code', (req, res) => {
  const code = req.params.code;
  const data = shortLinks[code];
  if (!data) {
    return res.status(404).send('الرابط غير صالح أو انتهت صلاحيته.');
  }
  res.redirect(`/join.html?session=${code}`);
});

// API لإظهار الجلسات المفتوحة
app.get('/sessions', (req, res) => {
  const openSessions = Object.entries(sessions)
    .filter(([id, s]) => s.players.length === 1)
    .map(([id, s]) => ({ sessionId: id, player: s.players[0]?.name || '---' }));
  res.json(openSessions);
});

// عند الاتصال بـ Socket.io
io.on('connection', socket => {
  // إنشاء جلسة جديدة
  socket.on('createGameSession', ({ sessionId, name, cards, time }) => {
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        settings: { cards, time },
        players: [],
        ready: 0,
        results: []
      };
      saveSessions(sessions);
    }

    const shortCode = sessionId;
    shortLinks[shortCode] = { sessionId };
    socket.emit('shortLink', shortCode);

    sessions[sessionId].players.push({ id: socket.id, name });
    socket.join(sessionId);
    io.to(sessionId).emit('playerJoined', sessions[sessionId].players.map(p => p.name));

    if (sessions[sessionId].players.length === 2) {
      io.to(sessionId).emit('readyToStart', sessions[sessionId].settings);
    }

    saveSessions(sessions);
  });

  // انضمام لاعب إلى جلسة
  socket.on('joinSession', ({ sessionId, name }) => {
    if (!sessions[sessionId]) return;

    const alreadyJoined = sessions[sessionId].players.find(p => p.id === socket.id);
    if (!alreadyJoined) {
      sessions[sessionId].players.push({ id: socket.id, name });
    }

    socket.join(sessionId);
    io.to(sessionId).emit('playerJoined', sessions[sessionId].players.map(p => p.name));

    if (sessions[sessionId].players.length === 2) {
      io.to(sessionId).emit('readyToStart', sessions[sessionId].settings);
    }

    saveSessions(sessions);
  });

  // بدء اللعبة عندما يكون الجميع جاهزين
  socket.on('startGameNow', sessionId => {
    const session = sessions[sessionId];
    if (!session) return;
    session.ready++;
    if (session.ready === 2) {
      io.to(sessionId).emit('startGame');
    }
  });

  // انتهاء اللعبة وإرسال النتيجة
  socket.on('gameFinished', ({ sessionId, name, score, time }) => {
    const session = sessions[sessionId];
    if (!session) return;
    session.results.push({ name, score, time });
    if (session.results.length === 2) {
      const [p1, p2] = session.results;
      let winner = null;
      let tie = false;
      if (p1.score > p2.score) {
        winner = p1.name;
      } else if (p2.score > p1.score) {
        winner = p2.name;
      } else {
        if (p1.time < p2.time) winner = p1.name;
        else if (p2.time < p1.time) winner = p2.name;
        else tie = true;
      }
      io.to(sessionId).emit('finalResult', { winner, tie, results: session.results });
      delete sessions[sessionId];
      saveSessions(sessions);
    }
  });

  // عند انقطاع الاتصال
  socket.on('disconnect', () => {
    let updated = false;
    for (const sessionId in sessions) {
      const session = sessions[sessionId];
      const initialLength = session.players.length;
      session.players = session.players.filter(p => p.id !== socket.id);
      if (initialLength !== session.players.length) {
        updated = true;
      }
      if (session.players.length === 0) {
        delete sessions[sessionId];
        updated = true;
      }
    }
    if (updated) saveSessions(sessions);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
