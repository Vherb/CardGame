import React, { useState, useEffect } from 'react';
import './GameTable.css';
import NavBar from "../../NavBar";
import cardData from '../../../data/cardData.json';

const GameTable = () => {
  // Shuffle cards
  const shuffleCards = () => {
    return [...cardData]
      .map(value => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value);
  };

  // State variables
  const [deck, setDeck] = useState([]);
  const [playerCard, setPlayerCard] = useState(null);
  const [opponentCard, setOpponentCard] = useState(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);

  // Initialize and shuffle cards
  useEffect(() => {
    setDeck(shuffleCards());
  }, []);

  // Draw cards for player and opponent
  const drawCards = () => {
    if (deck.length >= 2) {
      const newDeck = [...deck];
      const newPlayerCard = newDeck.shift();
      const newOpponentCard = newDeck.shift();

      setDeck(newDeck);
      setPlayerCard(newPlayerCard);
      setOpponentCard(newOpponentCard);

      // Update scores based on card value
      if (newPlayerCard.value > newOpponentCard.value) {
        setPlayerScore(playerScore + 1);
      } else if (newPlayerCard.value < newOpponentCard.value) {
        setOpponentScore(opponentScore + 1);
      }
      // Ties result in no score change
    }
  };

  return (
    <div className="center-container">
      <NavBar />
      <div className="game-container">
        <h1>War Card Game</h1>
        <button onClick={drawCards} disabled={deck.length < 2}>Draw Cards</button>
        <div className="card-display">
          <h3>Player's Card:</h3>
          {playerCard && <div>{playerCard.unicode}</div>}
        </div>
        <div className="card-display">
          <h3>Opponent's Card:</h3>
          {opponentCard && <div>{opponentCard.unicode} </div>}
        </div>
        <div className="scoreboard">
          <h2>Scores</h2>
          <h3>Player: {playerScore}</h3>
          <h3>Opponent: {opponentScore}</h3>
        </div>
        <div>
          <h3>Cards Remaining: {deck.length}</h3>
        </div>
      </div>
    </div>
  );
};

export default GameTable;
