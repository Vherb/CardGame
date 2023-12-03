const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors'); // Import the cors middleware
const ConnectFourGame = require('./ConnectFourGame'); // Import the ConnectFourGame class

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

const games = new Map();

// Configure CORS for WebSocket connections
const allowedOrigins = ['http://localhost:3000']; // Add your React app's origin
const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

app.use(cors(corsOptions));

wss.on('connection', (ws) => {
  let game;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'joinGame':
  if (!game || game.gameOver) {
    game = new ConnectFourGame(6, 7); // Create a new game instance
    game.players = [ws];
    games.set(ws, game);
    ws.send(JSON.stringify({ type: 'startGame', currentPlayer: game.currentPlayer }));
  } else if (game.players.length === 1) {
    game.players.push(ws);
    ws.send(JSON.stringify({ type: 'startGame', currentPlayer: game.currentPlayer }));
  } else {
    ws.close();
  }
  break;


        case 'makeMove':
          if (game.makeMove(data.col)) {
            // Update currentPlayer in the game instance
            game.currentPlayer = game.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';

            // Send game updates to all players
            game.players.forEach((player) => {
              player.send(
                JSON.stringify({
                  type: 'gameUpdate',
                  board: game.board,
                  currentPlayer: game.currentPlayer, // Update current player
                  winner: game.winner,
                })
              );
            });
          }
          break;
      }
    } catch (error) {
      console.error('Invalid message format:', error);
    }
  });

  ws.on('close', () => {
    if (game) {
      game.players = game.players.filter((player) => player !== ws);
      if (game.players.length === 0) {
        games.delete(ws);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
