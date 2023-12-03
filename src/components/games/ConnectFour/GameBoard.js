import React, { useState, useEffect } from 'react';
import './GameBoard.css';


const ROWS = 6;
const COLUMNS = 7;

const GameBoard = () => {
  const [board, setBoard] = useState(Array(ROWS).fill(Array(COLUMNS).fill(null)));
  const [currentPlayer, setCurrentPlayer] = useState('Player 1');
  const [ws, setWs] = useState(null);

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
      }
    };

    setWs(newWs);

    return () => {
      newWs.close();
    };
  }, []);

  const handleCellClick = (row, col) => {
    // Check if the selected cell is already occupied
    if (board[row][col] !== null) {
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
          <h2 className="player">Current Player: {currentPlayer}</h2>
        </div>
        {renderBoard()}
      </div>
    </div>
  );
};

export default GameBoard;
