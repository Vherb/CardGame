import React, { useState, useEffect } from 'react';
import './GameBoard.css';
import NavBar from "./../../NavBar";


const ROWS = 6;
const COLUMNS = 7;

const GameBoard = () => {
  const [board, setBoard] = useState(Array(ROWS).fill(Array(COLUMNS).fill(null)));
  const [currentPlayer, setCurrentPlayer] = useState('Looking for another player...');
  const [ws, setWs] = useState(null);
  const [winner, setWinner] = useState(null);
  const [player1Wins, setPlayer1Wins] = useState(localStorage.getItem('player1Wins') || 0);
  const [player2Wins, setPlayer2Wins] = useState(localStorage.getItem('player2Wins') || 0);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [playerRole, setPlayerRole] = useState(null);
  

  const initializeWebSocket = () => {
    const newWs = new WebSocket('ws://localhost:3001');
    newWs.onopen = () => {
      console.log('WebSocket connection established.');
      setCurrentPlayer(playerRole ? `You're ${playerRole}` : 'Looking for another player...');
    };

    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'gameUpdate') {
        setBoard(data.board);
        setCurrentPlayer(data.currentPlayer);
        setWinner(data.winner);
      } else if (data.type === 'startGame') {
        setIsGameStarted(true);
        setPlayerRole(data.playerNumber === 1 ? 'Player 1' : 'Player 2');
        setCurrentPlayer(data.playerNumber === 1 ? 'Player 1' : 'Player 2');
      }
    };

    setWs(newWs);

    return () => {
      newWs.close();
    };
  };

  useEffect(() => {
    // Retrieve the username from local storage
    const storedUsername = localStorage.getItem('username');
    if (storedUsername) {
      setPlayerRole(storedUsername);
    }
    initializeWebSocket();
  }, []);
  const checkForWinner = (board, row, col) => {
    const currentPlayer = board[row][col];

    // Check horizontally
    let count = 0;
    for (let c = 0; c < COLUMNS; c++) {
      if (board[row][c] === currentPlayer) {
        count++;
        if (count === 4) return true; // Four in a row horizontally
      } else {
        count = 0;
      }
    }

    // Check vertically
    count = 0;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][col] === currentPlayer) {
        count++;
        if (count === 4) return true; // Four in a row vertically
      } else {
        count = 0;
      }
    }

    // Check diagonally (top-left to bottom-right)
    count = 0;
    const startRow = Math.max(0, row - col);
    const startCol = Math.max(0, col - row);
    for (let r = startRow, c = startCol; r < ROWS && c < COLUMNS; r++, c++) {
      if (board[r][c] === currentPlayer) {
        count++;
        if (count === 4) return true; // Four in a row diagonally
      } else {
        count = 0;
      }
    }

    // Check diagonally (top-right to bottom-left)
    count = 0;
    const startRow2 = Math.max(0, row - (COLUMNS - 1 - col));
    const startCol2 = Math.min(COLUMNS - 1, col + row);
    for (let r = startRow2, c = startCol2; r < ROWS && c >= 0; r++, c--) {
      if (board[r][c] === currentPlayer) {
        count++;
        if (count === 4) return true; // Four in a row diagonally
      } else {
        count = 0;
      }
    }

    return false; // No win
  };

  const handleCellClick = (row, col) => {
    if (board[row][col] !== null || winner || !isGameStarted || playerRole !== currentPlayer) {
      return;
    }
  
    // Find the lowest available row in the selected column
    let newRow = ROWS - 1;
    while (newRow >= 0 && board[newRow][col] !== null) {
      newRow--;
    }
  
    // Update the board with the current player's token in the selected cell
    const newBoard = board.map((row) => [...row]);
    newBoard[newRow][col] = currentPlayer;
    setBoard(newBoard);
  
    // Check for a winner
    if (checkForWinner(newBoard, newRow, col)) {
      setWinner(currentPlayer);
  
      // Update the win count in local storage
      if (currentPlayer === 'Player 1') {
        const newWins = parseInt(player1Wins) + 1;
        setPlayer1Wins(newWins);
        localStorage.setItem('player1Wins', newWins);
      } else {
        const newWins = parseInt(player2Wins) + 1;
        setPlayer2Wins(newWins);
        localStorage.setItem('player2Wins', newWins);
      }
    }
  
    // Send move data to the server using WebSocket
    const moveData = {
      type: 'makeMove',
      col,
    };
  
    if (ws) {
      ws.send(JSON.stringify(moveData));
    }
  };
  
  

  const renderBoard = () => {
    return (
      <div className="board">
        {Array.from({ length: COLUMNS }).map((_, colIndex) => (
          <div key={colIndex} className="column">
            {Array.from({ length: ROWS }).map((_, rowIndex) => (
              <div
                key={`${colIndex}-${rowIndex}`}
                className={`cell ${board[rowIndex][colIndex] ? `Player-${board[rowIndex][colIndex]}` : ''}`}
                onClick={() => handleCellClick(rowIndex, colIndex)}
              >
                {board[rowIndex][colIndex] === 'Player 1' && (
                  <div className="circle red-circle"></div>
                )}
                {board[rowIndex][colIndex] === 'Player 2' && (
                  <div className="circle blue-circle"></div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const handleResetGame = () => {
    // Reset the game board, current player, and winner
    setBoard(Array(ROWS).fill(Array(COLUMNS).fill(null)));
    setCurrentPlayer('Player 1');
    setWinner(null);
    setIsGameStarted(false);

    // Send a reset game message to the server using WebSocket
    const resetData = {
      type: 'resetGame',
    };

    if (ws) {
      ws.send(JSON.stringify(resetData));
    }
  };

  const handleResetWinCount = () => {
    // Reset the win counts and clear local storage
    setPlayer1Wins(0);
    setPlayer2Wins(0);
    localStorage.removeItem('player1Wins');
    localStorage.removeItem('player2Wins');
  };

  const handleJoinGame = () => {
    console.log('Game joined.'); // Log that the game has been joined
    const joinData = {
      type: 'joinGame',
      username: localStorage.getItem('username'), // Retrieve the username from local storage
    };
  
    // Send a request for a player role to the server using WebSocket
    if (ws) {
      ws.send(JSON.stringify(joinData));
    }
  };
  

  

  return (
    <div className="center-container">
      <NavBar/>
      <div className="game-board">
        <h1 className="title">Connect Four</h1>
        <div className="turn-indicator">
  <h2 className="player">
    {winner ? (
      `${winner} wins!`
    ) : (
      isGameStarted ? (
        <span>
          You're {playerRole} <br />
          It's {currentPlayer === 'Player 1' ? 'Player 1' : 'Player 2'}'s Turn
        </span>
      ) : (
        'Waiting for another player...'
      )
    )}
  </h2>
</div>

        <div className="wins-container">
          <h4 className="wins">Player 1 Wins: {player1Wins}</h4>
          <h4 className="wins">Player 2 Wins: {player2Wins}</h4>
        </div>
        {isGameStarted ? (
          renderBoard()
        ) : (
          <button className="join-game-button" onClick={handleJoinGame}>
            Join Game
          </button>
        )}
        <button className="reset-button" onClick={handleResetGame}>
          Reset Game
        </button>
        <button className="reset-win-button" onClick={handleResetWinCount}>
          Reset Win Count
        </button>
      </div>
    </div>
  );
};

export default GameBoard;