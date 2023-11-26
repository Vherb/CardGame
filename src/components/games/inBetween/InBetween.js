import React from 'react';
import { Button, Divider, Grid, Typography } from '@mui/material';
import cardDataJson from '../../../data/cardData.json';
import './InBetween.css';
import arrow from '../../../assets/arrow.png'; // Tell webpack this JS file uses this image

const InBetweenGame = () => {
    /** Variables **/
    const CARD_BACK = '🂠';
    const cardData = JSON.parse(JSON.stringify(cardDataJson));
    const shuffledCards = cardData
        .map((value) => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const GameStage = {
        NOT_STARTED: 'NOT_STARTED', // Freshly loaded screen, default stage
        FIRST_STAGE: 'FIRST_STAGE', // First 2 cards have been drawn
        FINISHED: 'FINISHED', // Third card has been drawn
    };

    /** State variables **/
    const [cards, setCards] = React.useState(shuffledCards);
    const [firstCard, setFirstCard] = React.useState({});
    const [secondCard, setSecondCard] = React.useState({});
    const [thirdCard, setThirdCard] = React.useState({});
    const [isPlaying, setIsPlaying] = React.useState(false); // TODO: Replace with setGameStage state

    /** Helper functions **/
    const drawFirstCard = () => {
        setFirstCard(cards.shift());
    };

    const drawSecondCard = () => {
        setSecondCard(cards.shift());
    };

    const drawFirstTwoCards = () => {
        setIsPlaying(true);
        setThirdCard({});
        drawFirstCard();
        drawSecondCard();
    };

    const drawThirdCard = () => {
        setThirdCard(cards.shift());
    };

    /** Components **/
    /**
     * Card component - Used to draw a card on the screen
     */
    const Card = ({ unicodeValue, fontSize, color, onClick }) => {
        return (
            <div
                onClick={onClick}
                className='card2'
                style={{ color: color, fontSize }}
            >
                {unicodeValue}
            </div>
        );
    };

    /**
     * DecisionPrompt component - Prompts the user with a choice of Yes or No
     */
    const DecisionPrompt = () => {
        return (
            <center>
                <img
                    src={arrow}
                    alt='Double-ended arrow'
                    style={{ width: 200 }}
                />
                <br />
                <Typography>Will the next card be in-between?</Typography>
                <Grid
                    container
                    columns={2}
                    columnSpacing={1}
                    justifyContent='center'
                    alignItems='center'
                    style={{ marginTop: 10 }}
                >
                    <Grid item>
                        <Button
                            variant='outlined'
                            color='success'
                            onClick={() => drawThirdCard()}
                        >
                            Yes
                        </Button>
                    </Grid>
                    <Grid item>
                        <Button
                            variant='outlined'
                            color='error'
                            onClick={() => drawThirdCard()}
                        >
                            No
                        </Button>
                    </Grid>
                </Grid>
            </center>
        );
    };

    return (
        <>
            <center>
                <Card
                    unicodeValue={CARD_BACK}
                    fontSize='150px'
                    color='navy'
                    onClick={() => drawFirstTwoCards()}
                />
                <h3>Cards Remaining: {cards.length}</h3>
            </center>

            <Divider style={{ backgroundColor: 'blue' }} />
            <Grid
                container
                columns={3}
                columnSpacing={20}
                alignItems='center'
                justifyContent='center'
            >
                <>
                    <Grid item>
                        <center>
                            <Card
                                unicodeValue={firstCard.unicode}
                                fontSize='150px'
                                color={firstCard.color}
                            />

                            <Typography>
                                {firstCard.label !== undefined
                                    ? `${firstCard.label} of ${firstCard.suit}`
                                    : ''}
                            </Typography>
                        </center>
                    </Grid>
                    <Grid item>{isPlaying && <DecisionPrompt />}</Grid>
                    <Grid item>
                        <center>
                            <Card
                                unicodeValue={secondCard.unicode}
                                fontSize='150px'
                                color={secondCard.color}
                            />
                            <Typography>
                                {secondCard.label !== undefined
                                    ? `${secondCard.label} of ${secondCard.suit}`
                                    : ''}
                            </Typography>
                        </center>
                    </Grid>
                </>
            </Grid>
            <center>
                {thirdCard && (
                    <Card
                        unicodeValue={thirdCard.unicode}
                        fontSize='150px'
                        color={thirdCard.color}
                    />
                )}

                <Typography>
                    {thirdCard.label !== undefined
                        ? `${thirdCard.label} of ${thirdCard.suit}`
                        : ''}
                </Typography>
            </center>
        </>
    );
};

export default InBetweenGame;
