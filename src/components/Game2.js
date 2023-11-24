import React from 'react';
import MyCard from './MyCard';
import './App.css';

function Game2() {
    const cardValues = [
        { label: 'Ace', suit: 'Spades', unicode: '🂡', color: 'black' },
        { label: '2', suit: 'Spades', unicode: '🂢', color: 'black' },
        { label: '3', suit: 'Spades', unicode: '🂣', color: 'black' },
        { label: '4', suit: 'Spades', unicode: '🂤', color: 'black' },
        { label: '5', suit: 'Spades', unicode: '🂥', color: 'black' },
        { label: '6', suit: 'Spades', unicode: '🂦', color: 'black' },
        { label: '7', suit: 'Spades', unicode: '🂧', color: 'black' },
        { label: '8', suit: 'Spades', unicode: '🂨', color: 'black' },
        { label: '9', suit: 'Spades', unicode: '🂩', color: 'black' },
        { label: '10', suit: 'Spades', unicode: '🂪', color: 'black' },
        { label: 'Jack', suit: 'Spades', unicode: '🂫', color: 'black' },
        { label: 'Queen', suit: 'Spades', unicode: '🂭', color: 'black' },
        { label: 'King', suit: 'Spades', unicode: '🂮', color: 'black' },

        { label: 'Ace', suit: 'Clubs', unicode: '🃑' },
        { label: '2', suit: 'Clubs', unicode: '🃒', color: 'black' },
        { label: '3', suit: 'Clubs', unicode: '🃓', color: 'black' },
        { label: '4', suit: 'Clubs', unicode: '🃔', color: 'black' },
        { label: '5', suit: 'Clubs', unicode: '🃕', color: 'black' },
        { label: '6', suit: 'Clubs', unicode: '🃖', color: 'black' },
        { label: '7', suit: 'Clubs', unicode: '🃗', color: 'black' },
        { label: '8', suit: 'Clubs', unicode: '🃘', color: 'black' },
        { label: '9', suit: 'Clubs', unicode: '🃙', color: 'black' },
        { label: '10', suit: 'Clubs', unicode: '🃚', color: 'black' },
        { label: 'Jack', suit: 'Clubs', unicode: '🃛', color: 'black' },
        { label: 'Queen', suit: 'Clubs', unicode: '🃝', color: 'black' },
        { label: 'King', suit: 'Clubs', unicode: '🃞', color: 'black' },

        { label: 'Ace', suit: 'Hearts', unicode: '🂱', color: 'red' },
        { label: '2', suit: 'Hearts', unicode: '🂲', color: 'red' },
        { label: '3', suit: 'Hearts', unicode: '🂳', color: 'red' },
        { label: '4', suit: 'Hearts', unicode: '🂴', color: 'red' },
        { label: '5', suit: 'Hearts', unicode: '🂵', color: 'red' },
        { label: '6', suit: 'Hearts', unicode: '🂶', color: 'red' },
        { label: '7', suit: 'Hearts', unicode: '🂷', color: 'red' },
        { label: '8', suit: 'Hearts', unicode: '🂸', color: 'red' },
        { label: '9', suit: 'Hearts', unicode: '🂹', color: 'red' },
        { label: '10', suit: 'Hearts', unicode: '🂺', color: 'red' },
        { label: 'Jack', suit: 'Hearts', unicode: '🂻', color: 'red' },
        { label: 'Queen', suit: 'Hearts', unicode: '🂽', color: 'red' },
        { label: 'King', suit: 'Hearts', unicode: '🂾', color: 'red' },

        { label: 'Ace', suit: 'Diamonds', unicode: '🃁', color: 'red' },
        { label: '2', suit: 'Diamonds', unicode: '🃂', color: 'red' },
        { label: '3', suit: 'Diamonds', unicode: '🃃', color: 'red' },
        { label: '4', suit: 'Diamonds', unicode: '🃄', color: 'red' },
        { label: '5', suit: 'Diamonds', unicode: '🃅', color: 'red' },
        { label: '6', suit: 'Diamonds', unicode: '🃆', color: 'red' },
        { label: '7', suit: 'Diamonds', unicode: '🃇', color: 'red' },
        { label: '8', suit: 'Diamonds', unicode: '🃈', color: 'red' },
        { label: '9', suit: 'Diamonds', unicode: '🃉', color: 'red' },
        { label: '10', suit: 'Diamonds', unicode: '🃊', color: 'red' },
        { label: 'Jack', suit: 'Diamonds', unicode: '🃋', color: 'red' },
        { label: 'Queen', suit: 'Diamonds', unicode: '🃍', color: 'red' },
        { label: 'King', suit: 'Diamonds', unicode: '🃎', color: 'red', },
    ];

    return (
        <>
            {cardValues.map((card) => (
                <>
                    <h1> {card.label} </h1>
                    <MyCard value={card.unicode} fontSize='150px' color={card.color} />
                </>
            ))}
        </>
    );
}

export default Game2;
