class ConnectFourGame {
  constructor(rows, columns) {
    this.rows = rows;
    this.columns = columns;
    this.board = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => null)
    );
    this.currentPlayer = 'Player 1'; // Start with Player 1
    this.winner = null;
    this.gameOver = false;
  }

  makeMove(column) {
    if (this.gameOver) {
      return false; // Game is already over
    }

    const row = this.findEmptyRow(column);
    if (row === -1) {
      return false; // Column is full
    }

    this.board[row][column] = this.currentPlayer;

    if (this.checkWin(row, column)) {
      this.winner = this.currentPlayer;
      this.gameOver = true;
    } else {
      this.currentPlayer = this.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';
    }

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

module.exports = ConnectFourGame;
