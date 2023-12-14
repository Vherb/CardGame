class WarGame {
  constructor(rows, columns) {
    this.rows = rows;
    this.columns = columns;
    this.board = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => null)
    );
    this.currentPlayer = 'Player 1'; // Start with Player 1
    this.winner = null;
    this.gameOver = false;
    this.players = []; // Store the players in the game
    this.id = Date.now().toString(); // Assign a unique game ID
  }

// Add a player to the game
addPlayer(player) {
  if (this.players.length < 2) {
    this.players.push(player);
    
    // Assign player numbers based on the order of joining
    if (this.players.length === 1) {
      player.playerNumber = 1;
    } else if (this.players.length === 2) {
      player.playerNumber = 2;
    }
    
    console.log(`Player added: ${player} as Player ${player.playerNumber}`);
  } else {
    console.log('Game is already full. Cannot add more players.');
  }
}


  // Remove a player from the game
  removePlayer(player) {
    this.players = this.players.filter((p) => p !== player);
    console.log(`Player removed: ${player}`);
  }

  // Check if the game is full (has two players)
  isFull() {
    return this.players.length === 2;
  }

  // Switch to the next player
  switchPlayer() {
    this.currentPlayer = this.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';
    console.log(`Switched to ${this.currentPlayer}`);
  }

  // Get the player number (1 or 2) for a given player
  getPlayerNumber(player) {
    return this.players.indexOf(player) + 1;
  }

  // Check if the game is empty (has no players)
  isEmpty() {
    return this.players.length === 0;
  }

  makeMove(column) {
    if (this.gameOver) {
      console.log('Game is already over. Cannot make a move.');
      return false; // Game is already over
    }
  
    const row = this.findEmptyRow(column);
    if (row === -1) {
      console.log('Column is full. Cannot make a move.');
      return false; // Column is full
    }
  
    this.board[row][column] = this.currentPlayer;
  
    if (this.checkWin(row, column)) {
      this.winner = this.currentPlayer;
      this.gameOver = true;
      console.log(`Player ${this.winner} wins! Game over.`);
    }
  
    // Switch the current player after each move
    this.switchPlayer();
  
    return true; // Move was successful
  }
  
  


  findEmptyRow(column) {
    for (let row = this.rows - 1; row >= 0; row--) {
      if (this.board[row][column] === null) {
        return row;
      }
    }
    return -1; // Column is full
  }

  checkWin(row, col) {
    const directions = [
      [0, 1],     // Right
      [1, 0],     // Down
      [1, 1],     // Diagonal down-right
      [1, -1],    // Diagonal down-left
    ];

    for (const [dr, dc] of directions) {
      let count = 1; // Count consecutive tokens in a direction

      // Check for consecutive tokens in both directions
      for (let i = 1; i <= 3; i++) {
        const r = row + i * dr;
        const c = col + i * dc;
        if (
          r >= 0 &&
          r < this.rows &&
          c >= 0 &&
          c < this.columns &&
          this.board[r][c] === this.currentPlayer
        ) {
          count++;
        } else {
          break; // Stop checking in this direction
        }
      }

      if (count >= 4) {
        return true; // Player has won
      }
    }

    return false; // No win
  }
}



module.exports = WarGame;
