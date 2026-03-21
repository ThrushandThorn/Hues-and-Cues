const socket = io();

let currentPlayer = {};
let currentRoom = '';
let gameState = null;
let isClueGiver = false;
let isHost = false;
let selectedCorrectColor = null;
let playerNames = {}; // id -> name

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
  submitSecondClue: document.getElementById('submit-second-clue-btn'),
  nextRound: document.getElementById('next-round-btn'),
  playAgain: document.getElementById('play-again-btn'),
  exit: document.getElementById('exit-btn')
};

function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function showError(message, elementId = 'error-message') {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

// Join/Create room
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
  const startError = document.getElementById('start-error');
  if (!isHost) {
    startError.textContent = 'Only the host can start the game';
    startError.classList.add('show');
    setTimeout(() => startError.classList.remove('show'), 5000);
    return;
  }
  socket.emit('start_game');
});

buttons.leave.addEventListener('click', () => {
  window.location.reload();
});

// Game handlers
buttons.submitClue.addEventListener('click', () => {
  const clue = document.getElementById('clue-input').value.trim();
  if (!clue) {
    showError('Please enter a clue');
    return;
  }
  if (selectedCorrectColor === null) {
    showError('Pick a color first!');
    return;
  }
  socket.emit('provide_clue', clue);
  document.getElementById('clue-input').value = '';
  document.getElementById('clue-input-section').classList.add('hidden');
});

buttons.submitSecondClue.addEventListener('click', () => {
  const clue = document.getElementById('second-clue-input').value.trim();
  if (!clue) {
    showError('Please enter a clue');
    return;
  }
  socket.emit('provide_second_clue', clue);
  document.getElementById('second-clue-input').value = '';
  document.getElementById('second-clue-prompt').classList.add('hidden');
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
  updatePlayerNames(data.players);
  updateLobbyScreen(data.players, data.scores, data.hostId);
  showScreen('lobby');
});

socket.on('round_started', (data) => {
  gameState = data;
  isClueGiver = data.clueGiver === socket.id;
  selectedCorrectColor = null;

  const nextSection = document.getElementById('next-round-section');
  nextSection.classList.add('hidden');

  renderGameScreen(data);
});

socket.on('correct_color_picked', () => {
  document.getElementById('pick-color-prompt').classList.add('hidden');
  document.getElementById('clue-input-section').classList.remove('hidden');
  document.getElementById('clue-instructions').textContent =
    'Give a one-word clue for the color above:';
  document.getElementById('clue-input').placeholder = 'One word';
});

socket.on('clue_provided', (data) => {
  updateGameStatus(data.clue, data.isSecondClue);
});

socket.on('second_clue_provided', (data) => {
  updateGameStatus(data.clue, true);
});

socket.on('guess_made', (data) => {
  updateGuesses(data.guess, data.scores, data.canGiveSecondClue);
  if (data.allGuessedOrFailed) {
    showNextRoundButton();
  }
});

socket.on('attempt_failed', (data) => {
  showError(data.message);
});

socket.on('game_over', (data) => {
  renderGameOverScreen(data.scores, data.winner);
});

socket.on('player_left', (data) => {
  if (data.players.length === 0) {
    showError('All players left');
    window.location.reload();
  } else {
    updatePlayerNames(data.players);
    updateLobbyScreen(data.players, data.scores, data.hostId);
  }
});

// Helpers
function updatePlayerNames(players) {
  playerNames = {};
  players.forEach(p => { playerNames[p.id] = p.name; });
}

function updateLobbyScreen(players, scores, hostId) {
  isHost = hostId === socket.id;

  const playersList = document.getElementById('players-list');
  playersList.innerHTML = players
    .map(p => `<li>${p.name}${p.id === hostId ? ' 👑' : ''}</li>`)
    .join('');

  document.getElementById('room-code').textContent = `Room: ${currentRoom}`;

  const hostBadge = document.getElementById('host-badge');
  if (isHost) hostBadge.classList.remove('hidden');
  else hostBadge.classList.add('hidden');

  const canStart = players.length > 1;
  buttons.start.disabled = !canStart;

  // Update scores in lobby if needed
  const scoresDisplay = document.getElementById('scores-display');
  if (scoresDisplay) {
    scoresDisplay.innerHTML = Object.entries(scores || {})
      .map(([id, score]) => {
        const name = findPlayerName(id);
        return `<div class="score-item">${name}: ${score}</div>`;
      })
      .join('');
  }
}

function renderGameScreen(data) {
  document.getElementById('round-number').textContent = data.round;

  const scoresDisplay = document.getElementById('scores-display');
  scoresDisplay.innerHTML = Object.entries(data.scores)
    .map(([id, score]) => {
      const name = findPlayerName(id);
      return `<div class="score-item">${name}: ${score}</div>`;
    })
    .join('');

  const roleDisplay = document.getElementById('role-display');
  const clueGiverSection = document.getElementById('clue-giver-section');

  if (isClueGiver) {
    roleDisplay.textContent = '🎭 You are the CLUE GIVER';
    clueGiverSection.classList.remove('hidden');
    document.getElementById('pick-color-prompt').classList.remove('hidden');
    document.getElementById('clue-input-section').classList.add('hidden');
    document.getElementById('second-clue-prompt').classList.add('hidden');
  } else {
    const clueGiverName = findPlayerName(data.clueGiver);
    roleDisplay.textContent = `👀 ${clueGiverName} is giving the clue...`;
    clueGiverSection.classList.add('hidden');
  }

  renderColors(data.colors);

  const guessesDisplay = document.getElementById('guesses-display');
  guessesDisplay.innerHTML = '';
  guessesDisplay.classList.add('hidden');

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
        onclick="handleColorClick(${index})"
      ></div>
    `)
    .join('');
}

function handleColorClick(index) {
  if (isClueGiver) {
    document.querySelectorAll('.color-option').forEach(el =>
      el.classList.remove('selected')
    );
    document.querySelectorAll('.color-option')[index].classList.add('selected');
    selectedCorrectColor = index;
    socket.emit('pick_correct_color', index);
  } else {
    socket.emit('make_guess', index);
    document.querySelectorAll('.color-option')[index].classList.add('selected');
  }
}

function updateGameStatus(clue, isSecondClue) {
  const roleDisplay = document.getElementById('role-display');
  roleDisplay.textContent = `💡 Clue: "${clue}"${isSecondClue ? ' (Second clue)' : ''}`;

  const clueGiverSection = document.getElementById('clue-giver-section');
  clueGiverSection.classList.add('hidden');
}

function updateGuesses(guess, scores, canGiveSecondClue) {
  const guessesDisplay = document.getElementById('guesses-display');
  guessesDisplay.classList.remove('hidden');

  const attemptText = guess.attempt === 2 ? ' (2nd guess)' : ' (1st guess)';
  const pointsText = `+${guess.points} pt${guess.points === 1 ? '' : 's'}`;

  const guessElement = `
    <div class="guess-item">
      <span>${guess.playerName}${attemptText}</span>
      <span class="${guess.correct ? 'guess-correct' : 'guess-incorrect'}">
        ${guess.correct ? '✓ Correct' : '✗'} — ${pointsText}
      </span>
    </div>
  `;
  guessesDisplay.innerHTML += guessElement;

  const scoresDisplay = document.getElementById('scores-display');
  scoresDisplay.innerHTML = Object.entries(scores)
    .map(([id, score]) => {
      const name = findPlayerName(id);
      return `<div class="score-item">${name}: ${score}</div>`;
    })
    .join('');

  if (isClueGiver && canGiveSecondClue) {
    const section = document.getElementById('clue-giver-section');
    section.classList.remove('hidden');
    document.getElementById('pick-color-prompt').classList.add('hidden');
    document.getElementById('clue-input-section').classList.add('hidden');
    document.getElementById('second-clue-prompt').classList.remove('hidden');
  }
}

function showNextRoundButton() {
  document.getElementById('next-round-section').classList.remove('hidden');
}

function renderGameOverScreen(scores, winnerName) {
  const finalScores = document.getElementById('final-scores');
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => {
      const name = findPlayerName(id);
      const isWinner = name === winnerName;
      return `
        <div class="final-score-item${isWinner ? ' winner' : ''}">
          <span>${name}</span>
          <span>${score} points</span>
        </div>
      `;
    })
    .join('');

  finalScores.innerHTML = `
    <h2>🏆 ${winnerName} wins!</h2>
    ${sorted}
  `;
  showScreen('gameOver');
}

function findPlayerName(id) {
  if (playerNames[id]) return playerNames[id];
  if (id === socket.id) return currentPlayer.name || 'You';
  return `Player ${id.slice(0, 4)}`;
}

// Enter key shortcuts
document.addEventListener('keypress', (e) => {
  if (e.key !== 'Enter') return;

  const clueSection = document.getElementById('clue-input-section');
  const secondSection = document.getElementById('second-clue-prompt');

  if (!clueSection.classList.contains('hidden')) {
    buttons.submitClue.click();
  } else if (!secondSection.classList.contains('hidden')) {
    buttons.submitSecondClue.click();
  }
});
