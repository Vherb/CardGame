import React from 'react';

function Dice({ value, fontSize, className }) {
  const diceSymbols = [
    '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'
  ];

  const diceStyle = {
    fontSize: fontSize || '80px', // You can adjust the font size as needed
    display: 'inline-block', // Display dice inline
  };

  return <div className={`dice ${className}`} style={diceStyle}>{diceSymbols[value - 1]}</div>;
}

export default Dice;
