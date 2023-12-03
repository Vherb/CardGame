class ConnectFourGame {
  constructor(rows, columns) {
    this.rows = rows;
    this.columns = columns;
    this.board = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => null)
    );
    this.currentPlayer = 'Player 1'; // Start with Player 1
    this.otherPlayer = 'Player 2';    // Player 2
    this.winner = null;
    this.gameOver = false;
  }

  // ... Rest of the class methods ...

  makeMove(column) {
    if (this.gameOver) {
      return false; // Game is already over
    }

    // Find the lowest available row in the selected column
    let row = this.rows - 1;
    while (row >= 0 && this.board[row][column] !== null) {
      row--;
    }

    if (row < 0) {
      return false; // Column is full
    }

    // Place the player's token in the selected cell
    this.board[row][column] = this.currentPlayer;

    // Check for a win
    if (this.checkWin(row, column)) {
      this.winner = this.currentPlayer;
      this.gameOver = true;
    } else {
      // Switch to the next player
      this.currentPlayer = this.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';
    }

    return true; // Move was successful
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
          c < this.columns && // Corrected line
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

module.exports = ConnectFourGame;
