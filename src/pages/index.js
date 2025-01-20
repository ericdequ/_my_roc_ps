import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

let socket;

export default function Home() {
  const [lobbyIdInput, setLobbyIdInput] = useState('');
  const [lobbyId, setLobbyId] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [roundResult, setRoundResult] = useState(null);

  // Connect to socket server once on component mount
  useEffect(() => {
    // We call our custom API route to ensure the server is set up
    fetch('/api/socket')
      .then(() => {
        socket = io({
          path: '/api/socket_io',
        });

        // Listen for playerCount updates
        socket.on('playerCount', (count) => {
          setPlayerCount(count);
        });

        // Listen for round results
        socket.on('roundResult', (data) => {
          setRoundResult(data);
        });
      })
      .catch((err) => console.error(err));

    // Cleanup on unmount
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  const createLobby = () => {
    // Generate a unique lobby ID (use any strategy you like)
    const newLobbyId = uuidv4().slice(0, 6); // e.g., 6-char code
    setLobbyId(newLobbyId);
    setLobbyIdInput(newLobbyId);

    // Join the lobby
    socket.emit('joinLobby', newLobbyId);
  };

  const joinLobby = () => {
    if (!lobbyIdInput) return;
    setLobbyId(lobbyIdInput);
    socket.emit('joinLobby', lobbyIdInput);
  };

  const handleChoice = (choice) => {
    if (!lobbyId) return;
    socket.emit('playerChoice', { lobbyId, choice });
  };

  return (
    <div style={styles.container}>
      <h1>2-Player RPS Lobby</h1>

      {!lobbyId && (
        <div style={styles.lobbyActions}>
          <button onClick={createLobby} style={styles.button}>
            Create Lobby
          </button>
          <div style={styles.row}>
            <input
              type="text"
              placeholder="Lobby ID..."
              value={lobbyIdInput}
              onChange={(e) => setLobbyIdInput(e.target.value)}
            />
            <button onClick={joinLobby} style={styles.button}>
              Join Lobby
            </button>
          </div>
        </div>
      )}

      {lobbyId && (
        <div>
          <p>
            <strong>Lobby ID:</strong> {lobbyId}
          </p>
          <p>
            <strong>Players in Lobby:</strong> {playerCount}
          </p>

          {playerCount < 2 && (
            <p style={{ color: 'red' }}>
              Waiting for another player to join...
            </p>
          )}

          {playerCount === 2 && (
            <>
              <div style={styles.row}>
                <button onClick={() => handleChoice('rock')} style={styles.button}>
                  Rock
                </button>
                <button onClick={() => handleChoice('paper')} style={styles.button}>
                  Paper
                </button>
                <button onClick={() => handleChoice('scissors')} style={styles.button}>
                  Scissors
                </button>
              </div>
              {roundResult && <ResultDisplay roundResult={roundResult} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultDisplay({ roundResult }) {
  const { outcome, winnerId, loserId, choices } = roundResult;

  // You can determine if "you" are the winner by comparing `socket.id` with `winnerId`
  // But for demonstration, we’ll just display the outcome for both players.
  if (outcome === 'tie') {
    return (
      <p>
        Tie! Both chose {Object.values(choices)[0]}.
      </p>
    );
  }

  return (
    <div>
      <p>
        Winner: {winnerId} with {choices[winnerId]}
      </p>
      <p>
        Loser: {loserId} with {choices[loserId]}
      </p>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 30,
    fontFamily: 'sans-serif',
  },
  lobbyActions: {
    marginBottom: 20,
  },
  row: {
    display: 'flex',
    gap: 10,
    marginTop: 10,
  },
  button: {
    padding: '6px 12px',
    cursor: 'pointer',
  },
};
