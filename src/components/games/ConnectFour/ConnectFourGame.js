class ConnectFourGame {
  constructor(rows, columns) {
    this.rows = rows;
    this.columns = columns;
    this.reset();
    this.players = [];
    this.id = Date.now().toString();
  }

  reset() {
    this.board = Array.from({ length: this.rows }, () => Array(this.columns).fill(null));
    this.currentPlayer = 'Player 1';
    this.winner = null;
    this.gameOver = false;
    this.lastMove = null; // {row, col}
  }

  addPlayer(player, username = null) {
    if (this.players.length >= 2) return false;
    this.players.push(player);
    player.playerNumber = this.players.length; // 1 or 2
    player.__username = username;
    return true;
  }

  isFull() { return this.players.length === 2; }
  isEmpty() { return this.players.length === 0; }

  switchPlayer() { this.currentPlayer = this.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1'; }

  findEmptyRow(column) {
    for (let r = this.rows - 1; r >= 0; r--) if (this.board[r][column] === null) return r;
    return -1;
  }

  makeMove(column) {
    if (this.gameOver) return false;
    const row = this.findEmptyRow(column);
    if (row < 0) return false;
    this.board[row][column] = this.currentPlayer;
    this.lastMove = { row, col: column };

    if (this.checkWin(row, column, this.currentPlayer)) {
      this.winner = this.currentPlayer;
      this.gameOver = true;
    } else {
      this.switchPlayer();
    }
    return true;
  }

  // Proper 2-direction scanning per vector
  checkWin(row, col, player) {
    const dirs = [
      [0, 1],  // horizontal
      [1, 0],  // vertical
      [1, 1],  // diag ↘
      [1, -1], // diag ↙
    ];
    for (const [dr, dc] of dirs) {
      let count = 1;
      // forward
      for (let s = 1; s < 4; s++) {
        const r = row + dr * s, c = col + dc * s;
        if (r < 0 || r >= this.rows || c < 0 || c >= this.columns || this.board[r][c] !== player) break;
        count++;
      }
      // backward
      for (let s = 1; s < 4; s++) {
        const r = row - dr * s, c = col - dc * s;
        if (r < 0 || r >= this.rows || c < 0 || c >= this.columns || this.board[r][c] !== player) break;
        count++;
      }
      if (count >= 4) return true;
    }
    return false;
  }
}

module.exports = ConnectFourGame;
