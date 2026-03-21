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
const rooms = new Map();
const playerRooms = new Map();

// Generate 120 colors with many similar shades for difficulty
function generateColorSet() {
  const colors = [];
  const baseHues = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345];
  
  // For each hue, create multiple saturation/lightness variations
  baseHues.forEach(hue => {
    // Create 5 variations per hue: different saturations and lightness
    for (let sat = 30; sat <= 100; sat += 17.5) {
      for (let light = 30; light <= 70; light += 10) {
        colors.push(`hsl(${hue}, ${sat}%, ${light}%)`);
      }
    }
  });

  // Shuffle and return 120 colors
  return colors.sort(() => Math.random() - 0.5).slice(0, 120);
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    colors: generateColorSet(),
    round: 1,
    scores: {},
    currentPlayer: null,
    hostId: null, // Only host can start game
    correctColorIndex: null,
    clue: '',
    clueWordCount: 1, // Track if we're on 2-word clue
    clueGiven: false,
    guessing: false,
    guesses: {},
    playerAttempts: {}, // Track attempts per player: { playerId: attemptNumber }
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
    
    if (room.players.length >= 8) {
      socket.emit('error', 'Room is full');
      return;
    }

    socket.join(roomId);
    playerRooms.set(socket.id, roomId);
    
    room.players.push({ id: socket.id, name: playerName });
    room.scores[socket.id] = 0;

    // First player to join is the host
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
    
    // Only host can start game
    if (room.hostId !== socket.id) {
      socket.emit('error', 'Only the host can start the game');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    room.started = true;
    room.round = 1;
    startRound(roomId);
  });

  // Clue giver picks the correct color FIRST
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

  // Provide a clue (1 word on first attempt, 2 words on second attempt)
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

    // Validate word count based on which clue this is
    const expectedWords = room.clueWordCount;
    if (wordCount !== expectedWords) {
      socket.emit('error', `Clue must be ${expectedWords} word${expectedWords > 1 ? 's' : ''}! You gave ${wordCount}.`);
      return;
    }

    room.clue = trimmedClue;
    room.clueGiven = true;
    room.guessing = true;
    room.guesses = {};
    room.playerAttempts = {}; // Reset attempts for this round

    io.to(roomId).emit('clue_provided', {
      clue: trimmedClue,
      clueGiver: room.currentPlayer,
      colorCount: room.colors.length,
      isSecondClue: room.clueWordCount === 2
    });
  });

  // Player makes a guess
  socket.on('make_guess', (colorIndex) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room.guessing) return;
    if (socket.id === room.currentPlayer) return;

    // Track attempts
    if (!room.playerAttempts[socket.id]) {
      room.playerAttempts[socket.id] = 0;
    }
    room.playerAttempts[socket.id]++;

    const attemptNumber = room.playerAttempts[socket.id];
    const isCorrect = colorIndex === room.correctColorIndex;

    if (isCorrect) {
      room.scores[socket.id]++;
    }

    room.guesses[socket.id] = {
      playerName: room.players.find(p => p.id === socket.id).name,
      correct: isCorrect,
      attempt: attemptNumber
    };

    const allGuessedOrFailed = room.players
      .filter(p => p.id !== room.currentPlayer)
      .every(p => {
        const playerGuesses = room.guesses[p.id];
        return playerGuesses && (playerGuesses.correct || playerGuesses.attempt >= 2);
      });

    io.to(roomId).emit('guess_made', {
      guess: room.guesses[socket.id],
      scores: room.scores,
      allGuessedOrFailed: allGuessedOrFailed,
      canGiveSecondClue: !isCorrect && attemptNumber === 1 && room.clueWordCount === 1
    });

    // Check if this was the last attempt for this player
    if (!isCorrect && attemptNumber === 1) {
      socket.emit('attempt_failed', {
        message: 'First attempt failed. Clue giver will provide a 2-word clue.',
        roundsRemaining: 2 - attemptNumber
      });
    }
  });

  // Clue giver provides second clue (2 words)
  socket.on('provide_second_clue', (clue) => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room.currentPlayer !== socket.id) return;
    if (room.clueWordCount !== 1) return; // Can only give second clue once

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

  // Next round (only allowed when all players have guessed/failed)
  socket.on('next_round', () => {
    const roomId = playerRooms.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    
    // Verify all players have completed their attempts
    const nonClueGivers = room.players.filter(p => p.id !== room.currentPlayer);
    const allComplete = nonClueGivers.every(p => {
      const guess = room.guesses[p.id];
      return guess && (guess.correct || guess.attempt >= 2);
    });

    if (!allComplete) {
      socket.emit('error', 'Not all players have finished their attempts');
      return;
    }

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

  socket.on('disconnect', () => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.scores[socket.id];

      // If host disconnected, assign new host
      if (room.hostId === socket.id && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }

      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        io.to(roomId).emit('player_left', {
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          scores: room.scores,
          hostId: room.hostId
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
  room.clueWordCount = 1; // Reset to 1-word clue
  room.clueGiven = false;
  room.correctColorIndex = null;
  room.guesses = {};
  room.playerAttempts = {};

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