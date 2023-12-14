const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const WarGame = require('./WarGame');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

const games = new Map();
let waitingPlayers = [];
let game; // Define game variable outside of the callback function

const allowedOrigins = [
  
  'http://192.168.0.252:3000',
];

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
  console.log('Client connected'); // Add this line

  ws.on('message', (message) => {
    try {
      console.log('Received message:', message); // Add this line

      const data = JSON.parse(message);

      switch (data.type) {
        case 'joinGame':
          if (!game || game.gameOver) {
            waitingPlayers.push(ws);
        
            if (waitingPlayers.length >= 2) {
              // Create a new game when there are enough waiting players
              game = new WarGame(6, 7);
              game.players = [waitingPlayers.shift(), waitingPlayers.shift()];
        
              // Assign player roles (Player 1 and Player 2)
              game.players[0].playerNumber = 1;
              game.players[1].playerNumber = 2;
        
              // Include the usernames in the 'startGame' message
              game.players.forEach((player, index) => {
                game.addPlayer(player);
                console.log(`Player added: ${player} as Player ${player.playerNumber}`);
                player.send(
                  JSON.stringify({
                    type: 'startGame',
                    currentPlayer: game.currentPlayer,
                    playerNumber: player.playerNumber,
                    username: index === 0 ? data.username : null, // Include the username for Player 1
                  })
                );
              });
        
              games.set(game.players[0], game);
              games.set(game.players[1], game);
        
              // Check if two players have joined and the game is ready to start
              if (game.isFull()) {
                game.players.forEach((player) => {
                  player.send(
                    JSON.stringify({
                      type: 'startGame',
                      currentPlayer: game.currentPlayer,
                      playerNumber: player.playerNumber,
                      username: player.playerNumber === 1 ? data.username : null, // Include the username for Player 1
                    })
                  );
                });
              }
            }
          }
          break;
        
        
          case 'makeMove':
            if (game && game.players.includes(ws)) {
              const col = data.col;
          
              // Attempt to make a move and check if it's valid
              const validMove = game.makeMove(col);
          
              if (validMove) {
                // Check for a winner here and set the game as over if needed
                const row = game.findEmptyRow(col); // Find the row where the move was made
                if (game.checkWin(row, col)) { // Pass row and col to checkWin
                  game.gameOver = true;
                }
          
                // Send game update to all players in the game
                game.players.forEach((player) => {
                  player.send(
                    JSON.stringify({
                      type: 'gameUpdate',
                      board: game.board,
                      currentPlayer: game.currentPlayer,
                      winner: game.winner,
                      playerNumber: player.playerNumber,
                    })
                  );
                });
              }
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
        console.log('Client disconnected');
    
        if (game) {
          game.players = game.players.filter((player) => player !== ws);
          if (game.players.length === 0) {
            games.delete(game.players[0]);
            games.delete(game.players[1]);
            game = null;
          }
        } else {
          waitingPlayers = waitingPlayers.filter((player) => player !== ws);
        }
      });
    });

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
