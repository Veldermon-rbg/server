// =========================
// BLEND IN Master Server
// =========================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.get("/", (req, res) => {
  res.send("Blend In server running.");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// --------------------------------------
// LOBBY STORAGE
// --------------------------------------

const lobbies = {}; 
// structure:
// lobbies[code] = {
//   hostId,
//   players: { socketId: { name } },
//   phase: "waiting" | "round" | "voting" | "results",
//   topic: null,
//   fakerId: null,
//   roundNumber: 0
// };

// --------------------------------------
// UTILS
// --------------------------------------

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --------------------------------------
// SOCKETS
// --------------------------------------

io.on("connection", (socket) => {
  // HOST CREATES LOBBY
  socket.on("host.createLobby", () => {
    let code = generateCode();
    while (lobbies[code]) code = generateCode();

    lobbies[code] = {
      hostId: socket.id,
      players: {},
      phase: "waiting",
      topic: null,
      fakerId: null,
      roundNumber: 0,
    };

    socket.join(code);
    socket.emit("host.lobbyCreated", { code });
  });

  // PLAYER JOINS
  socket.on("player.joinLobby", (data) => {
    const { code, name } = data;
    const lobby = lobbies[code];
    if (!lobby) {
      socket.emit("player.joinError", "LobbyNotFound");
      return;
    }

    lobby.players[socket.id] = { name };
    socket.join(code);

    // notify player they joined
    socket.emit("player.joined", { code, name });

    // update everyone
    io.to(code).emit("lobby.updatePlayers", Object.values(lobby.players));
  });

  // HOST STARTS ROUND
  socket.on("host.startRound", ({ code, topic }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    lobby.topic = topic;
    lobby.roundNumber += 1;

    const allPlayers = Object.keys(lobby.players);
    lobby.fakerId = pickRandom(allPlayers);

    lobby.phase = "round";

    // notify truth-tellers
    allPlayers.forEach((pId) => {
      if (pId === lobby.fakerId) {
        io.to(pId).emit("round.role", { role: "faker", topicList: ["fake", "placeholder", "you’ll fill"] });
      } else {
        io.to(pId).emit("round.role", { role: "truth", topic });
      }
    });

    io.to(code).emit("round.started", {
      round: lobby.roundNumber,
      playerCount: allPlayers.length,
    });
  });

  // PLAYER SENDS WORD
  socket.on("player.sendWord", ({ code, word }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    io.to(code).emit("round.wordPlayed", {
      player: lobby.players[socket.id].name,
      word,
    });
  });

  // HOST STARTS VOTE PHASE
  socket.on("host.openVoting", ({ code }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    lobby.phase = "voting";
    io.to(code).emit("round.votingStarted");
  });

  // PLAYER VOTES
  socket.on("player.vote", ({ code, votedSocket }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    io.to(code).emit("round.voteCast", {
      voter: lobby.players[socket.id].name,
      target: lobby.players[votedSocket].name,
    });
  });

  // HOST ENDS ROUND
  socket.on("host.endRound", ({ code }) => {
    const lobby = lobbies[code];
    if (!lobby) return;

    io.to(code).emit("round.results", {
      faker: lobby.players[lobby.fakerId].name,
      topic: lobby.topic,
    });

    // reset between rounds
    lobby.phase = "waiting";
    lobby.topic = null;
    lobby.fakerId = null;
  });

  // CLEANUP ON DISCONNECT
  socket.on("disconnect", () => {
    for (const code in lobbies) {
      const lobby = lobbies[code];

      // host disconnect = delete lobby
      if (lobby.hostId === socket.id) {
        io.to(code).emit("lobby.closed");
        delete lobbies[code];
        continue;
      }

      if (lobby.players[socket.id]) {
        delete lobby.players[socket.id];
        io.to(code).emit("lobby.updatePlayers", Object.values(lobby.players));
      }
    }
  });
});

// --------------------------------------
// START SERVER
// --------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Blend In server running on port " + PORT);
});
