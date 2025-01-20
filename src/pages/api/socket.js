import { Server } from 'socket.io';

/**
 * An in-memory store for lobby data.
 * 
 * Example structure:
 * {
 *   [lobbyId]: {
 *     players: {
 *       socketId1: { choice: null },
 *       socketId2: { choice: null }
 *     },
 *     // Additional data if needed
 *   }
 * }
 */
const lobbies = {};

export default function SocketHandler(req, res) {
  // If socket server is already set up, exit
  if (res.socket.server.io) {
    console.log('Socket is already running');
    res.end();
    return;
  }

  console.log('Socket is initializing');
  const io = new Server(res.socket.server, {
    path: '/api/socket_io',
    addTrailingSlash: false,
    cors: {
      origin: '*',
    },
  });
  res.socket.server.io = io;

  // Socket.IO Connection
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join a lobby
    socket.on('joinLobby', (lobbyId) => {
      socket.join(lobbyId);

      // Create the lobby in memory if it doesn't exist
      if (!lobbies[lobbyId]) {
        lobbies[lobbyId] = { players: {} };
      }

      // Register player in the lobby
      lobbies[lobbyId].players[socket.id] = { choice: null };
      console.log(`Socket ${socket.id} joined lobby ${lobbyId}`);

      // Let everyone in the lobby know the current player count
      const playerCount = Object.keys(lobbies[lobbyId].players).length;
      io.to(lobbyId).emit('playerCount', playerCount);
    });

    // Player makes a choice
    socket.on('playerChoice', ({ lobbyId, choice }) => {
      if (!lobbies[lobbyId]) return;

      // Record player's choice
      if (lobbies[lobbyId].players[socket.id]) {
        lobbies[lobbyId].players[socket.id].choice = choice;
      }

      // Check if both players have made a choice
      const players = lobbies[lobbyId].players;
      const playerIds = Object.keys(players);
      if (playerIds.length === 2) {
        const [p1, p2] = playerIds;
        const c1 = players[p1].choice;
        const c2 = players[p2].choice;

        if (c1 && c2) {
          // Compute result
          const { outcome, winnerId, loserId } = computeResult(p1, c1, p2, c2);

          // Send result to the lobby
          io.to(lobbyId).emit('roundResult', {
            outcome,    // 'tie' | 'win' | 'lose'
            winnerId,   // If outcome = 'tie', winnerId is null
            loserId,
            choices: { [p1]: c1, [p2]: c2 },
          });

          // Reset choices to allow another round
          players[p1].choice = null;
          players[p2].choice = null;
        }
      }
    });

    // When a client disconnects
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);

      // Clean up from lobbies
      for (const lobbyId in lobbies) {
        if (lobbies[lobbyId].players[socket.id]) {
          delete lobbies[lobbyId].players[socket.id];
          io.to(lobbyId).emit(
            'playerCount',
            Object.keys(lobbies[lobbyId].players).length
          );
          // If lobby is empty, remove it
          if (Object.keys(lobbies[lobbyId].players).length === 0) {
            delete lobbies[lobbyId];
          }
        }
      }
    });
  });

  res.end();
}

/**
 * Helper function to compute the result of a single round.
 * Returns an object with outcome ('tie' or 'win'), and the ID of winner/loser if relevant.
 */
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
