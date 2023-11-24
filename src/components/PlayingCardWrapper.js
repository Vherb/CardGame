// PlayingCardWrapper.js
import React from 'react';
import { PlayingCard } from 'react-playing-cards';

const PlayingCardWrapper = ({ label, unicode }) => {
  let rank;
  let suit;

  switch (label) {
    case 'Ace':
      rank = 'A';
      break;
    case '2':
      rank = '2';
      break;
    case '3':
      rank = '3';
      break;
    case '4':
      rank = '4';
      break;
    case '5':
      rank = '5';
      break;
    case '6':
      rank = '6';
      break;
    case '7':
      rank = '7';
      break;
    case '8':
      rank = '8';
      break;
    case '9':
      rank = '9';
      break;
    case '10':
      rank = 'T';
      break;
    case 'Jack':
      rank = 'J';
      break;
    case 'Queen':
      rank = 'Q';
      break;
    case 'King':
      rank = 'K';
      break;
    default:
      rank = '';
      break;
  }

  if (unicode.includes('♠')) {
    suit = 'spades';
  } else if (unicode.includes('♥')) {
    suit = 'hearts';
  } else if (unicode.includes('♦')) {
    suit = 'diamonds';
  } else if (unicode.includes('♣')) {
    suit = 'clubs';
  }

  return <PlayingCard rank={rank} suit={suit} />;
};

export default PlayingCardWrapper;
