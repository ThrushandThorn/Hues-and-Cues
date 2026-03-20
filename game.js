const socket = io();

let currentPlayer = {};
let currentRoom = '';
let gameState = null;
let isClueGiver = false;

// DOM Elements
const screens = {
  login: document.getElementById('login-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  gameOver: document.getElementById('game-over-screen')
};

const inputs = {
  playerName: document.getElementById('player-name'),
  roomId: document.getElementById('room-id')
};

const buttons = {
  create: document.getElementById('create-btn'),
  join: document.getElementById('join-btn'),
  start: document.getElementById('start-btn'),
  leave: document.getElementById('leave-btn'),
  submitClue: document.getElementById('submit-clue-btn'),
  nextRound: document.getElementById('next-round-btn'),
  playAgain: document.getElementById('play-again-btn'),
  exit: document.getElementById('exit-btn')
};

// Screen management
function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function showError(message) {
  const errorEl = document.getElementById('error-message');
  errorEl.textContent = message;
  errorEl.classList.add('show');
  setTimeout(() => {
    errorEl.classList.remove('show');
  }, 5000);
}

// Join/Create room handlers
buttons.create.addEventListener('click', () => {
  const name = inputs.playerName.value.trim();
  const room = inputs.roomId.value.trim();

  if (!name || !room) {
    showError('Please enter name and room code');
    return;
  }

  currentPlayer = { name, room };
  currentRoom = room;
  socket.emit('join_room', room, name);
});

buttons.join.addEventListener('click', () => {
  const name = inputs.playerName.value.trim();
  const room = inputs.roomId.value.trim();

  if (!name || !room) {
    showError('Please enter name and room code');
    return;
  }

  currentPlayer = { name, room };
  currentRoom = room;
  socket.emit('join_room', room, name);
});

// Lobby handlers
buttons.start.addEventListener('click', () => {
  socket.emit('start_game');
});

buttons.leave.addEventListener('click', () => {
  window.location.reload();
});

// Game handlers
buttons.submitClue.addEventListener('click', () => {
  const clue = document.getElementById('clue-input').value.trim();
  if (clue) {
    socket.emit('provide_clue', clue);
    document.getElementById('clue-input').value = '';
    document.getElementById('clue-input-section').classList.add('hidden');
  }
});

buttons.nextRound.addEventListener('click', () => {
  socket.emit('next_round');
});

buttons.playAgain.addEventListener('click', () => {
  socket.emit('start_game');
  showScreen('game');
});

buttons.exit.addEventListener('click', () => {
  window.location.reload();
});

// Socket events
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('error', (message) => {
  showError(message);
});

socket.on('player_joined', (data) => {
  updateLobbyScreen(data.players, data.scores);
  showScreen('lobby');
});

socket.on('round_started', (data) => {
  gameState = data;
  isClueGiver = data.clueGiver === socket.id;
  renderGameScreen(data);
});

socket.on('clue_provided', (data) => {
  updateGameStatus(data.clue);
});

socket.on('guess_made', (data) => {
  updateGuesses(data.guess, data.scores);
  
  if (data.allGuessed) {
    showNextRoundButton();
  }
});

socket.on('game_over', (data) => {
  renderGameOverScreen(data.scores, data.winner);
});

socket.on('player_left', (data) => {
  if (data.players.length === 0) {
    showError('All players left');
    window.location.reload();
  } else {
    updateLobbyScreen(data.players, data.scores);
  }
});

// Render functions
function updateLobbyScreen(players, scores) {
  const playersList = document.getElementById('players-list');
  playersList.innerHTML = players
    .map(p => `<li>${p.name}</li>`)
    .join('');

  document.getElementById('room-code').textContent = `Room: ${currentRoom}`;

  // Enable start button only if current player is first
  const canStart = players.length > 1;
  buttons.start.disabled = !canStart;
}

function renderGameScreen(data) {
  document.getElementById('round-number').textContent = data.round;

  // Display scores
  const scoresDisplay = document.getElementById('scores-display');
  scoresDisplay.innerHTML = Object.entries(data.scores)
    .map(([id, score]) => {
      const playerName = findPlayerName(id);
      return `<div class="score-item">${playerName}: ${score}</div>`;
    })
    .join('');

  // Display role
  const roleDisplay = document.getElementById('role-display');
  if (isClueGiver) {
    roleDisplay.textContent = '🎭 You are the CLUE GIVER - Give a one-word clue!';
    showClueInput();
  } else {
    const clueGiverName = findPlayerName(data.clueGiver);
    roleDisplay.textContent = `👀 ${clueGiverName} is giving the clue...`;
    hideClueInput();
  }

  // Render color grid
  renderColors(data.colors);

  showScreen('game');
}

function renderColors(colors) {
  const container = document.getElementById('colors-container');
  container.innerHTML = colors
    .map((color, index) => `
      <div 
        class="color-option" 
        style="background-color: ${color}"
        data-index="${index}"
        onclick="handleColorGuess(${index})"
      ></div>
    `)
    .join('');
}

function handleColorGuess(index) {
  if (isClueGiver) {
    showError('You cannot guess - you are the clue giver!');
    return;
  }

  const colorOptions = document.querySelectorAll('.color-option');
  colorOptions.forEach(el => el.classList.remove('selected'));
  colorOptions[index].classList.add('selected');

  socket.emit('make_guess', index);
}

function updateGameStatus(clue) {
  const roleDisplay = document.getElementById('role-display');
  roleDisplay.textContent = `💡 Clue: "${clue}"`;
  hideClueInput();
}

function updateGuesses(guess, scores) {
  const guessesDisplay = document.getElementById('guesses-display');
  guessesDisplay.classList.remove('hidden');

  const guessElement = `
    <div class="guess-item">
      <span>${guess.playerName}</span>
      <span class="${guess.correct ? 'guess-correct' : 'guess-incorrect'}">
        ${guess.correct ? '✓ Correct!' : '✗ Incorrect'}
      </span>
    </div>
  `;

  if (guessesDisplay.innerHTML.includes(guess.playerName)) {
    return; // Already displayed
  }

  guessesDisplay.innerHTML += guessElement;

  // Update scores
  const scoresDisplay = document.getElementById('scores-display');
  scoresDisplay.innerHTML = Object.entries(scores)
    .map(([id, score]) => {
      const playerName = findPlayerName(id);
      return `<div class="score-item">${playerName}: ${score}</div>`;
    })
    .join('');
}

function showNextRoundButton() {
  const nextSection = document.getElementById('next-round-section');
  nextSection.classList.remove('hidden');
}

function renderGameOverScreen(scores, winner) {
  const finalScores = document.getElementById('final-scores');
  const sortedScores = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => {
      const playerName = findPlayerName(id);
      const isWinner = playerName === winner;
      return `
        <div class="final-score-item${isWinner ? ' winner' : ''}">
          <span>${playerName}</span>
          <span>${score} points</span>
        </div>
      `;
    })
    .join('');

  finalScores.innerHTML = `
    <h2>🏆 ${winner} wins!</h2>
    ${sortedScores}
  `;

  showScreen('gameOver');
}

// Helper functions
function findPlayerName(id) {
  // This would ideally be stored, but we'll show ID for now
  if (id === socket.id) return currentPlayer.name;
  return `Player ${id.slice(0, 4)}`;
}

function showClueInput() {
  document.getElementById('clue-input-section').classList.remove('hidden');
}

function hideClueInput() {
  document.getElementById('clue-input-section').classList.add('hidden');
}

// Keyboard shortcuts
document.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (document.getElementById('clue-input-section').classList.contains('hidden') === false) {
      buttons.submitClue.click();
    }
  }
});