import React, { useEffect, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Reuse the same socket instance to avoid multiple connections.
 */
let socket;

/**
 * Utility function:
 * Given a lobby ID, return a shareable link that includes the query parameter (?lobbyId=XXX).
 */
function getShareableLink(lobbyId) {
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.origin}?lobbyId=${lobbyId}`;
}

/**
 * The main Home component, which acts as the Rock-Paper-Scissors lobby and
 * optionally handles tournament creation and display.
 */
export default function Home() {
  // ------------------------
  // State Hooks
  // ------------------------
  const [socketConnected, setSocketConnected] = useState(false); // Track if socket is connected
  const [loading, setLoading] = useState(true);                  // High-level loading state

  const [lobbyId, setLobbyId] = useState(null);
  const [lobbyIdInput, setLobbyIdInput] = useState('');

  // Player & game state
  const [playerCount, setPlayerCount] = useState(0);
  const [roundResult, setRoundResult] = useState(null);

  // Tournament states
  const [isTournament, setIsTournament] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(2); // default: 2 players for quick games
  const [tournamentBracket, setTournamentBracket] = useState(null);
  const [lobbyStatus, setLobbyStatus] = useState('waiting'); // 'waiting' | 'inProgress' | 'completed'

  // ------------------------
  // Effects: Socket connection and auto-lobby
  // ------------------------
  useEffect(() => {
    // Hit our Next.js API route to ensure the Socket.IO server is initialized.
    fetch('/api/rocket')
      .then(() => {
        // Initialize the socket client.
        socket = io({
          path: '/api/rocket_io',
        });

        // Socket connection event.
        socket.on('connect', () => {
          setSocketConnected(true);
          setLoading(false);
        });

        // Listen for real-time game events.
        socket.on('playerCount', (count) => {
          setPlayerCount(count);
        });

        socket.on('roundResult', (data) => {
          setRoundResult(data);
        });

        socket.on('lobbyStatus', (status) => {
          setLobbyStatus(status);
        });

        socket.on('bracketUpdate', (bracket) => {
          setTournamentBracket(bracket);
        });

        // On socket disconnect, show user something in UI or reset states
        socket.on('disconnect', () => {
          setSocketConnected(false);
        });
      })
      .catch((err) => {
        console.error('Error initializing socket:', err);
        setLoading(false);
      });

    // Cleanup: Disconnect the socket when this component unmounts.
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  /**
   * Auto-join from URL query param:
   * If ?lobbyId=XYZ is present, pre-fill the lobby ID input.
   */
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const autoJoinLobbyId = urlParams.get('lobbyId');
      if (autoJoinLobbyId) {
        setLobbyIdInput(autoJoinLobbyId);
      }
    }
  }, []);

  // ------------------------
  // Callbacks: Lobby creation, join, handle user choice
  // ------------------------

  /**
   * Creates a brand-new lobby (tournament or non-tournament),
   * generating a short unique ID, then notifies the server via socket.
   */
  const createLobby = useCallback(() => {
    if (!socketConnected) {
      alert('Still connecting to server. Please wait a moment and try again.');
      return;
    }

    // Example short lobby ID
    const newLobbyId = uuidv4().slice(0, 6);

    // Update local states
    setLobbyId(newLobbyId);
    setLobbyIdInput(newLobbyId);

    // Tell server to create the lobby
    socket.emit('createLobby', {
      lobbyId: newLobbyId,
      isTournament,
      maxPlayers,
    });
  }, [isTournament, maxPlayers, socketConnected]);

  /**
   * Joins an existing lobby if a valid ID is provided.
   */
  const joinLobby = () => {
    if (!lobbyIdInput) {
      alert('Please enter a valid Lobby ID first.');
      return;
    }

    if (!socketConnected) {
      alert('Still connecting to server. Please wait a moment and try again.');
      return;
    }

    setLobbyId(lobbyIdInput);
    socket.emit('joinLobby', lobbyIdInput);
  };

  /**
   * Called when a user chooses "Rock," "Paper," or "Scissors."
   */
  const handleChoice = (choice) => {
    if (!lobbyId) {
      alert('You must be in a lobby to choose.');
      return;
    }
    if (!socketConnected) {
      alert('Not connected to the server. Please wait or rejoin.');
      return;
    }

    socket.emit('playerChoice', { lobbyId, choice });
  };

  /**
   * Copies the shareable link to the clipboard and notifies the user.
   */
  const copyLink = () => {
    const link = getShareableLink(lobbyId);
    navigator.clipboard.writeText(link);
    alert('Lobby link copied to clipboard!');
  };

  // ------------------------
  // Render UI
  // ------------------------

  // 1) If still loading the socket, show a simple loading indicator.
  if (loading) {
    return (
      <div style={styles.container}>
        <h1>Loading RPS Lobby...</h1>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1>Rock-Paper-Scissors Lobby</h1>
      {!socketConnected && (
        <p style={{ color: 'red' }}>
          <strong>Not connected to server...</strong>
        </p>
      )}

      {/* If user hasn't created or joined a lobby, show the lobby creation UI */}
      {!lobbyId && (
        <div style={styles.lobbyActions}>
          <div>
            <label style={{ marginRight: 8 }}>
              <input
                type="checkbox"
                checked={isTournament}
                onChange={(e) => {
                  setIsTournament(e.target.checked);
                  // If user toggles "Tournament mode," default to 4 max players
                  setMaxPlayers(e.target.checked ? 4 : 2);
                }}
              />
              Tournament mode?
            </label>

            {/* If tournament is toggled, let the user pick a max player size */}
            {isTournament && (
              <>
                <br />
                <label>
                  Max Players:
                  <select
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(Number(e.target.value))}
                    style={{ marginLeft: 8 }}
                  >
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                    <option value={8}>8</option>
                    <option value={16}>16</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <button onClick={createLobby} style={styles.button}>
            Create {isTournament ? 'Tournament' : 'Lobby'}
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

      {/* Once we have a lobby ID, display the main game UI */}
      {lobbyId && (
        <div>
          <h3>Lobby ID: {lobbyId}</h3>
          <p>Players Connected: {playerCount}</p>

          <button onClick={copyLink} style={styles.button}>
            Share Lobby Link
          </button>

          {/* If in tournament mode, show bracket information */}
          {isTournament && (
            <TournamentDisplay
              bracket={tournamentBracket}
              lobbyStatus={lobbyStatus}
            />
          )}

          {/* If not a tournament OR if a tournament is in progress, show RPS game UI */}
          {(!isTournament || (isTournament && lobbyStatus === 'inProgress')) && (
            <div>
              {/* If fewer than 2 players, notify that we're waiting */}
              {playerCount < 2 && (
                <p style={{ color: 'red' }}>
                  Waiting for at least 2 players to start...
                </p>
              )}

              <ChoiceButtons
                playerCount={playerCount}
                handleChoice={handleChoice}
                roundResult={roundResult}
              />
            </div>
          )}

          {/* If a tournament is done, show final message */}
          {isTournament && lobbyStatus === 'completed' && (
            <div style={{ marginTop: 20 }}>
              <h2 style={{ color: 'green' }}>Tournament Completed!</h2>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Component that renders the choice buttons (Rock/Paper/Scissors) and the round result.
 */
function ChoiceButtons({ playerCount, handleChoice, roundResult }) {
  // Only show RPS buttons if we have 2 or more players
  if (playerCount < 2) return null;

  return (
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
  );
}

/**
 * Component to display the result of the most recent round (win/lose or tie).
 */
function ResultDisplay({ roundResult }) {
  const { outcome, winnerId, loserId, choices } = roundResult;

  if (outcome === 'tie') {
    const choice = Object.values(choices)[0];
    return <p>Tie! Both chose {choice}.</p>;
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

/**
 * Component for tournament brackets.
 * If no bracket is generated yet, it shows a "Waiting..." message.
 * Otherwise, it iterates rounds & matches to display structured bracket data.
 */
function TournamentDisplay({ bracket, lobbyStatus }) {
  if (!bracket) {
    return <p>Waiting for more players to start the tournament...</p>;
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2>Tournament Bracket</h2>
      {bracket.map((round, rIndex) => (
        <div key={`round-${rIndex}`} style={{ marginBottom: 10 }}>
          <h4>Round {rIndex + 1}</h4>
          {round.map((match, mIndex) => (
            <div key={`match-${rIndex}-${mIndex}`}>
              {match.player1} vs {match.player2}
              {match.winner && <strong> — Winner: {match.winner}</strong>}
            </div>
          ))}
        </div>
      ))}

      {lobbyStatus === 'inProgress' && <p>Round in progress...</p>}
    </div>
  );
}

/**
 * A simple stylesheet for inline styling. In production, consider using
 * a CSS/SCSS module, Styled Components, or a utility class approach.
 */
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
