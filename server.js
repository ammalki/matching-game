const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// تخزين الجلسات وروابطها المختصرة
const sessions = {};
const shortLinks = {}; // key: shortCode, value: { sessionId, name, cards, time }

app.use(express.static(__dirname));

// ====== توجيه الروابط المختصرة ======
app.get('/s/:code', (req, res) => {
  const code = req.params.code;
  const data = shortLinks[code];
  if (!data) {
    return res.status(404).send('الرابط غير صالح أو انتهت صلاحيته.');
  }

  // إعادة التوجيه إلى game.html مع البيانات
  const redirectUrl = `/game.html?session=${data.sessionId}`;
res.redirect(redirectUrl);
});

// ====== WebSocket Events ======
io.on('connection', socket => {
  socket.on('createGameSession', ({ sessionId, name, cards, time }) => {
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        settings: { cards, time },
        players: [],
        ready: 0,
        results: []
      };
    }

    // توليد كود مختصر
    const shortCode = Math.floor(10000 + Math.random() * 90000).toString();
    shortLinks[shortCode] = { sessionId, name, cards, time };

    socket.emit('shortLink', shortCode); // إرسال الكود المختصر للواجهة

    sessions[sessionId].players.push({ id: socket.id, name });
    socket.join(sessionId);
    io.to(sessionId).emit('playerJoined', sessions[sessionId].players.map(p => p.name));

    if (sessions[sessionId].players.length === 2) {
      io.to(sessionId).emit('readyToStart', sessions[sessionId].settings);
    }
  });

  socket.on('joinSession', ({ sessionId, name }) => {
    if (!sessions[sessionId]) return;
    sessions[sessionId].players.push({ id: socket.id, name });
    socket.join(sessionId);
    io.to(sessionId).emit('playerJoined', sessions[sessionId].players.map(p => p.name));
    if (sessions[sessionId].players.length === 2) {
      io.to(sessionId).emit('readyToStart', sessions[sessionId].settings);
    }
  });

  socket.on('startGameNow', sessionId => {
    const session = sessions[sessionId];
    if (!session) return;
    session.ready++;
    if (session.ready === 2) {
      io.to(sessionId).emit('startGame');
    }
  });

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
    }
  });

  socket.on('disconnect', () => {
    for (const sessionId in sessions) {
      const session = sessions[sessionId];
      session.players = session.players.filter(p => p.id !== socket.id);
      if (session.players.length === 0) {
        delete sessions[sessionId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
