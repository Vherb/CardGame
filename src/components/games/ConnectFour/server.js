const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const ConnectFourGame = require('./ConnectFourGame');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

const games = new Map();
let waitingPlayers = [];

const allowedOrigins = ['http://192.168.50.123:3000']; // Update with your allowed origins
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
            waitingPlayers.push(ws);

            if (waitingPlayers.length >= 2) {
              // Create a new game when there are enough waiting players
              game = new ConnectFourGame(6, 7);
              game.players = [waitingPlayers.shift(), waitingPlayers.shift()];

              game.players.forEach((player, index) => {
                player.send(
                  JSON.stringify({
                    type: 'startGame',
                    currentPlayer: game.currentPlayer,
                    playerNumber: index + 1,
                  })
                );
              });

              games.set(game.players[0], game);
              games.set(game.players[1], game);
            }
          }
          break;

        case 'makeMove':
          if (game && game.players.includes(ws) && game.makeMove(data.col)) {
            game.currentPlayer = game.currentPlayer === 'Player 1' ? 'Player 2' : 'Player 1';

            // Send game update to all players in the game
            game.players.forEach((player, index) => {
              player.send(
                JSON.stringify({
                  type: 'gameUpdate',
                  board: game.board,
                  currentPlayer: game.currentPlayer,
                  winner: game.winner,
                  playerNumber: index + 1,
                })
              );
            });
          }
          break;

        default:
          console.error('Invalid message type:', data.type);
      }
    } catch (error) {
      console.error('Invalid message format:', error);
    }
  });

  ws.on('close', () => {
    if (game) {
      game.players = game.players.filter((player) => player !== ws);
      if (game.players.length === 0) {
        games.delete(game.players[0]);
        games.delete(game.players[1]);
      }
    } else {
      waitingPlayers = waitingPlayers.filter((player) => player !== ws);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
