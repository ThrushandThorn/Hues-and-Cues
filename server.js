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

// Board layout: 10 rows × 20 columns = 200 organized colors
const ROWS = 10;
const COLS = 20;

// Game state management
const rooms = new Map();
const playerRooms = new Map();

// Build a structured gradient board: hue across, lightness down
function generateColorSet() {
  const colors = [];
  for (let r = 0; r < ROWS; r++) {
    const light = 30 + (r * (40 / (ROWS - 1))); // 30% .. 70%
    for (let c = 0; c < COLS; c++) {
      const hue = (c * 360) / COLS; // 0 .. <360
      colors.push(`hsl(${Math.round(hue)}, 80%, ${Math.round(light)}%)`);
    }
  }
  return colors;
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],                 // [{id,name}]
    colors: generateColorSet(),  // 200 fixed colors
    round: 1,
    scores: {},
    currentPlayer: null,         // clue giver socket id
    hostId: null,
    correctColorIndex: null,
    clue: '',
    clueWordCount: 1,            // 1-word first clue, 2-word second clue
    clueGiven: false,
    guessing: false,
    guesses: {},                 // { playerId: {playerName, correct, points, attempt} }
    playerAttempts: {},          // { playerId: attemptNumber (1 or 2) }
    guessPositions: {},          // { playerId: [index1, index2] }
    occupiedIndices: new Set(),  // color squares already taken
    cueGiverPoints: 0,           // per-round tally for cue giver
    started: false
  };
}

io.on('connection', (socket) => {
  console.log(`New player connected: ${socket.id}`);

  socket.on('join_room', (roomId, playerName) => {
    roomId = roomId.toLowerCase().trim();

    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoom(roomId));
    }

    const room = rooms.get(roomId);

    if (room.players.length >= 10) {
      socket.emit('error', 'Room is full (max 10 players)');
      return;
    }

    socket.join(roomId);
    playerRooms.set(socket.id, roomId);

    room.players.push({ id: socket.id, name: playerName });
    room.scores[socket.id] = room.scores[socket.id] || 0;

    // First player is host
    if (room.hostId === null) {
      room.hostId = socket.id;
    }

    io.to(roomId).emit('player_joined', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      scores: room.scores,
      hostId: room.hostId
    });

    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on('start_game', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);

    // Only host can start
    if (room.hostId !== socket.id) {
      socket.emit('error', 'Only the host can start the game');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    // New game: reset scores and round
    room.scores = {};
    room.players.forEach(p => { room.scores[p.id] = 0; });
    room.started = true;
    room.round = 1;

    startRound(roomId);
  });

  // Clue giver picks the correct color FIRST (hidden target)
  socket.on('pick_correct_color', (colorIndex) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.currentPlayer !== socket.id) return;
    if (room.clueGiven) return;

    room.correctColorIndex = colorIndex;

    io.to(roomId).emit('correct_color_picked', {
      playerName: room.players.find(p => p.id === socket.id).name
    });
  });

  // Provide a clue: 1-word first, 2-word second
  socket.on('provide_clue', (clue) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.currentPlayer !== socket.id) return;
    if (room.correctColorIndex === null) {
      socket.emit('error', 'Pick the correct color first!');
      return;
    }

    const trimmedClue = clue.trim();
    const wordCount = trimmedClue.split(/\s+/).length;

    const expectedWords = room.clueWordCount; // 1 for first clue, 2 for second
    if (wordCount !== expectedWords) {
      socket.emit(
        'error',
        `Clue must be ${expectedWords} word${expectedWords > 1 ? 's' : ''}! You gave ${wordCount}.`
      );
      return;
    }

    room.clue = trimmedClue;
    room.clueGiven = true;
    room.guessing = true;

    if (room.clueWordCount === 1) {
      // First clue: reset guesses & attempts for first-guess round
      room.guesses = {};
      room.playerAttempts = {};
      room.guessPositions = {};
      room.occupiedIndices = new Set();
      room.cueGiverPoints = 0;
    }

    io.to(roomId).emit('clue_provided', {
      clue: trimmedClue,
      clueGiver: room.currentPlayer,
      colorCount: room.colors.length,
      isSecondClue: room.clueWordCount === 2
    });
  });

  // Clue giver provides second (2-word) clue after first attempts
  socket.on('provide_second_clue', (clue) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.currentPlayer !== socket.id) return;
    if (room.clueWordCount !== 1) return; // only once per round

    const trimmedClue = clue.trim();
    const wordCount = trimmedClue.split(/\s+/).length;

    if (wordCount !== 2) {
      socket.emit('error', `Second clue must be 2 words! You gave ${wordCount}.`);
      return;
    }

    room.clue = trimmedClue;
    room.clueWordCount = 2;

    io.to(roomId).emit('second_clue_provided', {
      clue: trimmedClue,
      clueGiver: room.currentPlayer
    });
  });

  // Player makes a guess
  socket.on('make_guess', (colorIndex) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room.guessing || !room.clueGiven) return; // no guessing before clue
    if (socket.id === room.currentPlayer) return;

    // Allowed attempts depend on clue stage:
    // 1 attempt after 1-word clue, 2 after 2-word clue
    const allowedAttempts = room.clueWordCount;
    if (!room.playerAttempts[socket.id]) {
      room.playerAttempts[socket.id] = 0;
    }
    if (room.playerAttempts[socket.id] >= allowedAttempts) {
      socket.emit('error', 'You cannot guess again yet');
      return;
    }

    // Each color square can only be used once
    if (room.occupiedIndices.has(colorIndex)) {
      socket.emit('error', 'That color has already been chosen');
      return;
    }

    room.playerAttempts[socket.id] += 1;
    const attemptNumber = room.playerAttempts[socket.id];

    room.occupiedIndices.add(colorIndex);

    // Store positions for end-of-round scoring
    if (!room.guessPositions[socket.id]) {
      room.guessPositions[socket.id] = [];
    }
    room.guessPositions[socket.id].push(colorIndex);

    // For UI: mark exact vs not (points come later)
    const targetIndex = room.correctColorIndex;
    const guessRow = Math.floor(colorIndex / COLS);
    const guessCol = colorIndex % COLS;
    const targetRow = Math.floor(targetIndex / COLS);
    const targetCol = targetIndex % COLS;
    const dx = Math.abs(guessRow - targetRow);
    const dy = Math.abs(guessCol - targetCol);
    const chebyshev = Math.max(dx, dy);
    const isExact = chebyshev === 0;

    room.guesses[socket.id] = {
      playerName: room.players.find(p => p.id === socket.id).name,
      correct: isExact,
      points: 0,  // actual points assigned at end of round
      attempt: attemptNumber
    };

    const nonClueGivers = room.players.filter(p => p.id !== room.currentPlayer);
    // All done when every non-clue-giver has attempts == 2
    const allSecondGuessesDone = nonClueGivers.every(p => {
      const attempts = room.playerAttempts[p.id] || 0;
      return attempts >= 2;
    });

    io.to(roomId).emit('guess_made', {
      guess: room.guesses[socket.id],
      scores: room.scores,
      allGuessedOrFailed: allSecondGuessesDone,
      canGiveSecondClue:
        !isExact &&
        attemptNumber === 1 &&
        room.clueWordCount === 1,
      colorIndex // for marking taken squares client-side
    });

    if (!isExact && attemptNumber === 1 && room.clueWordCount === 1) {
      socket.emit('attempt_failed', {
        message: 'First attempt recorded. You will get one more guess after the second clue.',
        roundsRemaining: 1
      });
    }

    // When everyone has made 2nd guesses, reveal correct color immediately
    if (allSecondGuessesDone) {
      io.to(roomId).emit('all_guesses_complete', {
        correctColorIndex: room.correctColorIndex
      });
    }
  });

  // Next round (only host; everyone must have 2 guesses)
  socket.on('next_round', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);

    // Only host can advance rounds
    if (room.hostId !== socket.id) {
      socket.emit('error', 'Only the host can advance to the next round');
      return;
    }

    const nonClueGivers = room.players.filter(p => p.id !== room.currentPlayer);
    const allComplete = nonClueGivers.every(p => {
      const attempts = room.playerAttempts[p.id] || 0;
      return attempts >= 2;
    });

    if (!allComplete) {
      socket.emit('error', 'Not all players have finished their guesses');
      return;
    }

    const roundPoints = scoreRound(room);

    io.to(roomId).emit('round_scored', {
      roundPoints,
      scores: room.scores
      // correctColorIndex already revealed by all_guesses_complete
    });

    room.round++;

    if (room.round > 5) {
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

  socket.on('disconnect', () => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.scores[socket.id];

      // If host leaves, next player becomes host
      if 
