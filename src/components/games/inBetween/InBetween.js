import React from 'react';
import { Divider, Grid, Typography } from '@mui/material';
import cardDataJson from '../../../data/cardData.json';
import './InBetween.css';

const InBetweenGame = () => {
    const cardData = JSON.parse(JSON.stringify(cardDataJson));

    const cardBack = '🂠';

    const shuffledCards = cardData
        .map((value) => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);


    const [cards, setCards] = React.useState(shuffledCards);
    const [firstCard, setFirstCard] = React.useState({})
    const [secondCard, setSecondCard] = React.useState({})


    const drawFirstCard = () => {
        setFirstCard(cards.shift())
    }

    const drawSecondCard = () => {
        setSecondCard(cards.shift())
    }

    const drawCards = () => {
        drawFirstCard()
        drawSecondCard()
    }

    return (
        <>
            <center>
                <Card value={cardBack} fontSize='200px' color='navy' onClick={() => drawCards()} />
                <h3>Cards Remaining: {cards.length}</h3>
            </center>

            <Divider style={{ backgroundColor: 'blue' }} />
            <Grid
                container
                columns={2}
                columnSpacing={60}
                alignItems='center'
                justifyContent='center'
            >
                <>
                    <Grid item>
                        <h1> { firstCard.label !== undefined ? `${firstCard.label} of ${firstCard.suit}` : '' } </h1>
                        <Card
                            value={firstCard.unicode}
                            fontSize='150px'
                            color={firstCard.color}
                        />
                    </Grid>
                    <Grid item>
                        <h1> { secondCard.label !== undefined ? `${secondCard.label} of ${secondCard.suit}` : '' } </h1>
                        <Card
                            value={secondCard.unicode}
                            fontSize='150px'
                            color={secondCard.color}
                        />
                    </Grid>
                </>
            </Grid>
        </>
    );
}

function Card({ value, fontSize, color, onClick }) {
    return (
        <div
            onClick={onClick}
            className='card2'
            style={{ color: color, fontSize }}
        >
            {value}
        </div>
    );
}

export default InBetweenGame;
