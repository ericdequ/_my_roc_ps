import { Server } from 'socket.io';

const lobbies = {};
/*
 lobbies = {
   [lobbyId]: {
     isTournament: bool,
     maxPlayers: number,
     players: {
       socketId1: { choice: null },
       socketId2: { choice: null },
       ...
     },
     bracket: [
       [ { player1: <id>, player2: <id>, winner: null }, ... ],  // Round 1
       [ ... ],                                                 // Round 2
     ],
     currentRoundIndex: 0,
     lobbyStatus: 'waiting' | 'inProgress' | 'completed'
   }
 }
*/

export default function SocketHandler(req, res) {
  if (res.socket.server.io) {
    console.log('Socket is already running');
    res.end();
    return;
  }

  console.log('Socket is initializing');
  const io = new Server(res.socket.server, {
    path: '/api/rocket_io',
    addTrailingSlash: false,
    cors: {
      origin: '*',
    },
  });
  res.socket.server.io = io;

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create a new lobby
    socket.on('createLobby', ({ lobbyId, isTournament, maxPlayers }) => {
      socket.join(lobbyId);

      lobbies[lobbyId] = {
        isTournament,
        maxPlayers,
        players: {
          [socket.id]: { choice: null },
        },
        bracket: null,
        currentRoundIndex: 0,
        lobbyStatus: 'waiting',
      };

      console.log(`Lobby ${lobbyId} created by socket ${socket.id}`);
      io.to(lobbyId).emit('playerCount', 1);
      io.to(lobbyId).emit('lobbyStatus', 'waiting');
    });

    // Join existing lobby
    socket.on('joinLobby', (lobbyId) => {
      if (!lobbies[lobbyId]) return;

      socket.join(lobbyId);
      lobbies[lobbyId].players[socket.id] = { choice: null };
      console.log(`Socket ${socket.id} joined lobby ${lobbyId}`);

      // Notify players of updated count
      const playerCount = Object.keys(lobbies[lobbyId].players).length;
      io.to(lobbyId).emit('playerCount', playerCount);

      checkStartTournamentIfNeeded(lobbyId, io);
    });

    // A player makes a choice
    socket.on('playerChoice', ({ lobbyId, choice }) => {
      const lobby = lobbies[lobbyId];
      if (!lobby) return;

      // Only record a choice if the player is in the current round's match
      if (lobby.isTournament && lobby.lobbyStatus === 'inProgress') {
        const match = getPlayerMatch(lobby, socket.id);
        if (!match) {
          // Player not in an active match right now
          return;
        }
      }

      if (lobby.players[socket.id]) {
        lobby.players[socket.id].choice = choice;
      }

      // If standard game OR if in the middle of a bracket match:
      if (!lobby.isTournament) {
        handle2PlayerResolution(lobbyId, io);
      } else {
        handleTournamentRound(lobbyId, io);
      }
    });

    // On disconnect, remove player from lobby
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      for (const lobbyId in lobbies) {
        const lobby = lobbies[lobbyId];
        if (lobby.players[socket.id]) {
          delete lobby.players[socket.id];
          const count = Object.keys(lobby.players).length;
          io.to(lobbyId).emit('playerCount', count);
          if (count === 0) {
            delete lobbies[lobbyId];
          }
        }
      }
    });
  });

  res.end();
}

/** ===========================================================
 * 2-PLAYER STANDARD RESOLUTION
 * ============================================================
 * Checks if exactly 2 players have made a choice, then broadcasts the result.
 */
function handle2PlayerResolution(lobbyId, io) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  const players = Object.keys(lobby.players);
  if (players.length < 2) return;

  const [p1, p2] = players;
  const c1 = lobby.players[p1].choice;
  const c2 = lobby.players[p2].choice;
  if (!c1 || !c2) return; // wait until both have chosen

  const { outcome, winnerId, loserId } = computeResult(p1, c1, p2, c2);
  io.to(lobbyId).emit('roundResult', {
    outcome,
    winnerId,
    loserId,
    choices: { [p1]: c1, [p2]: c2 },
  });
  // Reset choices
  lobby.players[p1].choice = null;
  lobby.players[p2].choice = null;
}

/** ===========================================================
 * TOURNAMENT SPECIFIC LOGIC
 * ============================================================
 */
function checkStartTournamentIfNeeded(lobbyId, io) {
  const lobby = lobbies[lobbyId];
  if (!lobby || !lobby.isTournament) return;

  const players = Object.keys(lobby.players);
  const count = players.length;

  if (count === lobby.maxPlayers) {
    // We can start the tournament
    lobby.lobbyStatus = 'inProgress';
    // Generate a simple single-elimination bracket
    lobby.bracket = generateSingleElimination(players);
    // currentRoundIndex = 0
    io.to(lobbyId).emit('lobbyStatus', lobby.lobbyStatus);
    io.to(lobbyId).emit('bracketUpdate', lobby.bracket);
  }
}

function handleTournamentRound(lobbyId, io) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  if (!lobby.bracket) return; // no bracket => not started
  const roundIndex = lobby.currentRoundIndex;
  const roundMatches = lobby.bracket[roundIndex];

  // For each match, see if both players made a choice
  let allMatchesResolved = true;
  for (let i = 0; i < roundMatches.length; i++) {
    const match = roundMatches[i];
    if (!match.winner) {
      // Check both players' choices
      const c1 = lobby.players[match.player1]?.choice;
      const c2 = lobby.players[match.player2]?.choice;
      if (!c1 || !c2) {
        allMatchesResolved = false;
        continue;
      }
      // Determine winner
      const { winnerId } = computeResult(match.player1, c1, match.player2, c2);
      match.winner = winnerId;

      // Reset
      lobby.players[match.player1].choice = null;
      lobby.players[match.player2].choice = null;
    }
  }

  // Broadcast bracket after any changes
  io.to(lobbyId).emit('bracketUpdate', lobby.bracket);

  if (allMatchesResolved) {
    // Move winners to the next round
    if (roundIndex === lobby.bracket.length - 1) {
      // We have a final winner
      lobby.lobbyStatus = 'completed';
      io.to(lobbyId).emit('lobbyStatus', 'completed');
      return;
    }

    lobby.currentRoundIndex++;
    const winners = roundMatches.map((m) => m.winner);
    // Build next round
    const nextRound = [];
    for (let i = 0; i < winners.length; i += 2) {
      if (i + 1 < winners.length) {
        nextRound.push({
          player1: winners[i],
          player2: winners[i + 1],
          winner: null,
        });
      } else {
        // Odd count => this winner might get a bye
        nextRound.push({
          player1: winners[i],
          player2: null,
          winner: winners[i], // auto-advances
        });
      }
    }
    lobby.bracket.push(nextRound);
    io.to(lobbyId).emit('bracketUpdate', lobby.bracket);
  }
}

/** Find the match in the current round that includes this player (if any). */
function getPlayerMatch(lobby, playerId) {
  const roundIndex = lobby.currentRoundIndex;
  const roundMatches = lobby.bracket?.[roundIndex];
  if (!roundMatches) return null;
  return roundMatches.find(
    (m) => m.player1 === playerId || m.player2 === playerId
  );
}

/** Generate a single-elimination bracket from a list of player IDs. */
function generateSingleElimination(players) {
  // Shuffle players for fairness (optional)
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const round1 = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    if (i + 1 < shuffled.length) {
      round1.push({
        player1: shuffled[i],
        player2: shuffled[i + 1],
        winner: null,
      });
    } else {
      // if odd, auto-advance
      round1.push({
        player1: shuffled[i],
        player2: null,
        winner: shuffled[i],
      });
    }
  }
  return [round1];
}

/** Compute RPS result for 2 players. */
function computeResult(p1Id, c1, p2Id, c2) {
  if (c1 === c2) {
    return { outcome: 'tie', winnerId: null, loserId: null };
  }
  const beats = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
  };
  if (beats[c1] === c2) {
    return { outcome: 'win', winnerId: p1Id, loserId: p2Id };
  } else {
    return { outcome: 'win', winnerId: p2Id, loserId: p1Id };
  }
}
