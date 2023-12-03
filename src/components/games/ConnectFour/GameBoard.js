import React, { useState, useEffect } from 'react';
import './GameBoard.css';

const ROWS = 6;
const COLUMNS = 7;

const GameBoard = () => {
  const [board, setBoard] = useState(Array(ROWS).fill(Array(COLUMNS).fill(null)));
  const [currentPlayer, setCurrentPlayer] = useState('Player 1');
  const [ws, setWs] = useState(null);
  const [winner, setWinner] = useState(null);
  const [player1Wins, setPlayer1Wins] = useState(localStorage.getItem('player1Wins') || 0);
  const [player2Wins, setPlayer2Wins] = useState(localStorage.getItem('player2Wins') || 0);

  useEffect(() => {
    const newWs = new WebSocket('ws://localhost:3001');
    newWs.onopen = () => {
      console.log('WebSocket connection established.');
    };

    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'gameUpdate') {
        setBoard(data.board);
        setCurrentPlayer(data.currentPlayer);
        setWinner(data.winner);
      }
    };

    setWs(newWs);

    return () => {
      newWs.close();
    };
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
    // Check if the selected cell is already occupied or if there's a winner
    if (board[row][col] !== null || winner) {
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

    // Switch to the next player
    setCurrentPlayer(currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1');

    // Send move data to the server using WebSocket
    const moveData = {
      type: 'makeMove',
      row,
      col,
      currentPlayer,
    };

    if (ws) {
      ws.send(JSON.stringify(moveData));
    }
  };

  const handleResetGame = () => {
    // Reset the game board, current player, and winner
    setBoard(Array(ROWS).fill(Array(COLUMNS).fill(null)));
    setCurrentPlayer('Player 1');
    setWinner(null);

    // Send a reset game message to the server using WebSocket
    const resetData = {
      type: 'resetGame',
    };

    if (ws) {
      ws.send(JSON.stringify(resetData));
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

  return (
    <div className="center-container">
      <div className="game-board">
        <h1 className="title">Connect Four</h1>
        <div className="turn-indicator">
          {winner ? (
            <h2 className="player">{`${winner} wins!`}</h2>
          ) : (
            <h2 className="player">{`Current Player: ${currentPlayer}`}</h2>
          )}
        </div>
        <div className="wins-container">
          <h4 className="wins">Player 1 Wins: {player1Wins}</h4>
          <h4 className="wins">Player 2 Wins: {player2Wins}</h4>
        </div>
        {renderBoard()}
        <button className="reset-button" onClick={handleResetGame}>Reset Game</button>
      </div>
    </div>
  );
};

export default GameBoard;