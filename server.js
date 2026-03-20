const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Game state management
const rooms = new Map(); // { roomId: { players: [], gameState, round, scores } }
const playerRooms = new Map(); // { socketId: roomId }

// Color palette for the game
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#ABEBC6',
  '#F1948A', '#85C1E2', '#F9E79F', '#D7BDE2', '#A9DFBF',
  '#FADBD8', '#FCF3CF', '#D5F4E6', '#EBDEF0', '#FAD7A0'
];

function generateColorSet() {
  const shuffled = [...COLORS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 8);
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    colors: generateColorSet(),
    round: 1,
    scores: {},
    currentPlayer: null,
    clue: '',
    guessing: false,
    guesses: {},
    started: false
  };
}

io.on('connection', (socket) => {
  console.log(`New player connected: ${socket.id}`);

  // Player joins or creates a room
  socket.on('join_room', (roomId, playerName) => {
    roomId = roomId.toLowerCase().trim();
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom(roomId));
    }

    const room = rooms.get(roomId);
    
    if (room.players.length >= 8) {
      socket.emit('error', 'Room is full');
      return;
    }

    socket.join(roomId);
    playerRooms.set(socket.id, roomId);
    
    room.players.push({ id: socket.id, name: playerName });
    room.scores[socket.id] = 0;

    // Notify all players in room
    io.to(roomId).emit('player_joined', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      scores: room.scores
    });

    console.log(`${playerName} joined room ${roomId}`);
  });

  // Start the game
  socket.on('start_game', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    room.started = true;
    room.round = 1;
    startRound(roomId);
  });

  // Provide a clue
  socket.on('provide_clue', (clue) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.currentPlayer !== socket.id) return;

    room.clue = clue.trim();
    room.guessing = true;
    room.guesses = {};

    io.to(roomId).emit('clue_provided', {
      clue: clue,
      guesser: room.currentPlayer
    });
  });

  // Player makes a guess
  socket.on('make_guess', (colorIndex) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room.guessing) return;
    if (socket.id === room.currentPlayer) return; // Clue giver can't guess

    const targetColor = room.colors[colorIndex];
    const isCorrect = room.colors.some((color, idx) => 
      idx === colorIndex && color === room.colors[colorIndex]
    );

    // Simple scoring: correct guess = 1 point
    if (isCorrect) {
      room.scores[socket.id]++;
    }

    room.guesses[socket.id] = {
      playerName: room.players.find(p => p.id === socket.id).name,
      correct: isCorrect,
      color: targetColor
    };

    io.to(roomId).emit('guess_made', {
      guess: room.guesses[socket.id],
      scores: room.scores,
      allGuessed: room.players.filter(p => p.id !== room.currentPlayer).length === 
                  Object.keys(room.guesses).length
    });
  });

  // Next round
  socket.on('next_round', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    room.round++;

    if (room.round > 5) {
      // Game over
      const winner = Object.entries(room.scores).reduce((a, b) => 
        a[1] > b[1] ? a : b
      );
      io.to(roomId).emit('game_over', {
        scores: room.scores,
        winner: room.players.find(p => p.id === winner[0]).name
      });
      return;
    }

    startRound(roomId);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.scores[socket.id];

      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        io.to(roomId).emit('player_left', {
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          scores: room.scores
        });
      }
    }
    playerRooms.delete(socket.id);
    console.log(`Player ${socket.id} disconnected`);
  });
});

function startRound(roomId) {
  const room = rooms.get(roomId);
  room.guessing = false;
  room.clue = '';
  room.guesses = {};

  // Rotate current player
  const currentIndex = room.players.findIndex(p => p.id === room.currentPlayer);
  const nextIndex = (currentIndex + 1) % room.players.length;
  room.currentPlayer = room.players[nextIndex].id;

  io.to(roomId).emit('round_started', {
    round: room.round,
    colors: room.colors,
    clueGiver: room.currentPlayer,
    scores: room.scores
  });
}

server.listen(PORT, () => {
  console.log(`Hues and Cues server running on port ${PORT}`);
});