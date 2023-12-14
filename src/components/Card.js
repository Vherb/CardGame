import React from 'react';

const cardValues = [
  // Spades
  { label: "Ace", suit: "Spades", unicode: "🂡", color: "black" },
  { label: "2", suit: "Spades", unicode: "🂢", color: "black" },
  { label: "3", suit: "Spades", unicode: "🂣", color: "black" },
  { label: "4", suit: "Spades", unicode: "🂤", color: "black" },
  { label: "5", suit: "Spades", unicode: "🂥", color: "black" },
  { label: "6", suit: "Spades", unicode: "🂦", color: "black" },
  { label: "7", suit: "Spades", unicode: "🂧", color: "black" },
  { label: "8", suit: "Spades", unicode: "🂨", color: "black" },
  { label: "9", suit: "Spades", unicode: "🂩", color: "black" },
  { label: "10", suit: "Spades", unicode: "🂪", color: "black" },
  { label: "Jack", suit: "Spades", unicode: "🂫", color: "black" },
  { label: "Queen", suit: "Spades", unicode: "🂭", color: "black" },
  { label: "King", suit: "Spades", unicode: "🂮", color: "black" },

  // Clubs
  { label: "Ace", suit: "Clubs", unicode: "🃑" },
  { label: "2", suit: "Clubs", unicode: "🃒", color: "black" },
  { label: "3", suit: "Clubs", unicode: "🃓", color: "black" },
  { label: "4", suit: "Clubs", unicode: "🃔", color: "black" },
  { label: "5", suit: "Clubs", unicode: "🃕", color: "black" },
  { label: "6", suit: "Clubs", unicode: "🃖", color: "black" },
  { label: "7", suit: "Clubs", unicode: "🃗", color: "black" },
  { label: "8", suit: "Clubs", unicode: "🃘", color: "black" },
  { label: "9", suit: "Clubs", unicode: "🃙", color: "black" },
  { label: "10", suit: "Clubs", unicode: "🃚", color: "black" },
  { label: "Jack", suit: "Clubs", unicode: "🃛", color: "black" },
  { label: "Queen", suit: "Clubs", unicode: "🃝", color: "black" },
  { label: "King", suit: "Clubs", unicode: "🃞", color: "black" },

  // Hearts
  { label: "Ace", suit: "Hearts", unicode: "🂱", color: "red" },
  { label: "2", suit: "Hearts", unicode: "🂲", color: "red" },
  { label: "3", suit: "Hearts", unicode: "🂳", color: "red" },
  { label: "4", suit: "Hearts", unicode: "🂴", color: "red" },
  { label: "5", suit: "Hearts", unicode: "🂵", color: "red" },
  { label: "6", suit: "Hearts", unicode: "🂶", color: "red" },
  { label: "7", suit: "Hearts", unicode: "🂷", color: "red" },
  { label: "8", suit: "Hearts", unicode: "🂸", color: "red" },
  { label: "9", suit: "Hearts", unicode: "🂹", color: "red" },
  { label: "10", suit: "Hearts", unicode: "🂺", color: "red" },
  { label: "Jack", suit: "Hearts", unicode: "🂻", color: "red" },
  { label: "Queen", suit: "Hearts", unicode: "🂽", color: "red" },
  { label: "King", suit: "Hearts", unicode: "🂾", color: "red" },

  // Diamonds
  { label: "Ace", suit: "Diamonds", unicode: "🃁", color: "red" },
  { label: "2", suit: "Diamonds", unicode: "🃂", color: "red" },
  { label: "3", suit: "Diamonds", unicode: "🃃", color: "red" },
  { label: "4", suit: "Diamonds", unicode: "🃄", color: "red" },
  { label: "5", suit: "Diamonds", unicode: "🃅", color: "red" },
  { label: "6", suit: "Diamonds", unicode: "🃆", color: "red" },
  { label: "7", suit: "Diamonds", unicode: "🃇", color: "red" },
  { label: "8", suit: "Diamonds", unicode: "🃈", color: "red" },
  { label: "9", suit: "Diamonds", unicode: "🃉", color: "red" },
  { label: "10", suit: "Diamonds", unicode: "🃊", color: "red" },
  { label: "Jack", suit: "Diamonds", unicode: "🃋", color: "red" },
  { label: "Queen", suit: "Diamonds", unicode: "🃍", color: "red" },
  { label: "King", suit: "Diamonds", unicode: "🃎", color: "red" },
];

function MyCard({ fontSize, className }) {
  return (
    <div className={`cards-container ${className}`}>
      {cardValues.map((card, index) => (
        <div key={index} className="card" style={{ color: card.color }}>
          {card.unicode}
        </div>
      ))}
    </div>
  );
}

export default MyCard;
