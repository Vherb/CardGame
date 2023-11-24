import React, { useState } from 'react';
import MyCard from './MyCard';
import Dice from './Dice';
import './App.css';
import {
    Button,
    Typography,
    Paper,
    Grid,
    Container,
    ThemeProvider,
    createTheme,
    styled,
    AppBar,
    Toolbar,
    IconButton,
} from '@mui/material';


function Game2() {
    const cardValues = [
        { label: 'Ace', suit: 'Spades', unicode: '🂡' },
        { label: '2', suit: 'Spades', unicode: '🂢' },
        { label: '3', suit: 'Spades', unicode: '🂣' },
        { label: '4', suit: 'Spades', unicode: '🂤' },
        { label: '5', suit: 'Spades', unicode: '🂥' },
        { label: '6', suit: 'Spades', unicode: '🂦' },
        { label: '7', suit: 'Spades', unicode: '🂧' },
        { label: '8', suit: 'Spades', unicode: '🂨' },
        { label: '9', suit: 'Spades', unicode: '🂩' },
        { label: '10', suit: 'Spades', unicode: '🂪' },
        { label: 'Jack', suit: 'Spades', unicode: '🂫' },
        { label: 'Queen', suit: 'Spades', unicode: '🂭' },
        { label: 'King', suit: 'Spades', unicode: '🂮' },

        { label: 'Ace', suit: 'Clubs', unicode: '🃑' },
        { label: '2', suit: 'Clubs', unicode: '🃒' },
        { label: '3', suit: 'Clubs', unicode: '🃓' },
        { label: '4', suit: 'Clubs', unicode: '🃔' },
        { label: '5', suit: 'Clubs', unicode: '🃕' },
        { label: '6', suit: 'Clubs', unicode: '🃖' },
        { label: '7', suit: 'Clubs', unicode: '🃗' },
        { label: '8', suit: 'Clubs', unicode: '🃘' },
        { label: '9', suit: 'Clubs', unicode: '🃙' },
        { label: '10', suit: 'Clubs', unicode: '🃚' },
        { label: 'Jack', suit: 'Clubs', unicode: '🃛' },
        { label: 'Queen', suit: 'Clubs', unicode: '🃝' },
        { label: 'King', suit: 'Clubs', unicode: '🃞' },

        { label: 'Ace', suit: 'Hearts', unicode: '🂱' },
        { label: '2', suit: 'Hearts', unicode: '🂲' },
        { label: '3', suit: 'Hearts', unicode: '🂳' },
        { label: '4', suit: 'Hearts', unicode: '🂴' },
        { label: '5', suit: 'Hearts', unicode: '🂵' },
        { label: '6', suit: 'Hearts', unicode: '🂶' },
        { label: '7', suit: 'Hearts', unicode: '🂷' },
        { label: '8', suit: 'Hearts', unicode: '🂸' },
        { label: '9', suit: 'Hearts', unicode: '🂹' },
        { label: '10', suit: 'Hearts', unicode: '🂺' },
        { label: 'Jack', suit: 'Hearts', unicode: '🂻' },
        { label: 'Queen', suit: 'Hearts', unicode: '🂽' },
        { label: 'King', suit: 'Hearts', unicode: '🂾' },

        { label: 'Ace', suit: 'Diamonds', unicode: '🃁' },
        { label: '2', suit: 'Diamonds', unicode: '🃂' },
        { label: '3', suit: 'Diamonds', unicode: '🃃' },
        { label: '4', suit: 'Diamonds', unicode: '🃄' },
        { label: '5', suit: 'Diamonds', unicode: '🃅' },
        { label: '6', suit: 'Diamonds', unicode: '🃆' },
        { label: '7', suit: 'Diamonds', unicode: '🃇' },
        { label: '8', suit: 'Diamonds', unicode: '🃈' },
        { label: '9', suit: 'Diamonds', unicode: '🃉' },
        { label: '10', suit: 'Diamonds', unicode: '🃊' },
        { label: 'Jack', suit: 'Diamonds', unicode: '🃋' },
        { label: 'Queen', suit: 'Diamonds', unicode: '🃍' },
        { label: 'King', suit: 'Diamonds', unicode: '🃎' },
    ];


    return (
            <h1> Charlie mf gammmmmmmmmmmmmmme </h1>
    );
}

export default Game2;
