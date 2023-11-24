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

const CenteredText = styled('div')({
  textAlign: 'center',
});

const CardContainer = styled('div')({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  marginTop: '0px', // Increase the margin to create more space
});


const CardItem = styled('div')(({ theme }) => ({
  margin: theme.spacing(1),
}));

const DiceContainer = styled('div')({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '15px',
});

const DiceItem = styled('div')(({ theme }) => ({
  margin: theme.spacing(1),
}));

const CustomPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  marginBottom: theme.spacing(2),
}));




function Game() {
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

  const theme = createTheme();
 const [isAnimating, setIsAnimating] = useState(false);
  const [cardValue1, setCardValue1] = useState('');
  const [cardValue2, setCardValue2] = useState('');
  const [diceValue1, setDiceValue1] = useState(0);
  const [diceValue2, setDiceValue2] = useState(0);
  const [result, setResult] = useState('');
  const [roundOver, setRoundOver] = useState(true);
  const [coins, setCoins] = useState(100);
  const [bet, setBet] = useState(0);
  const [roundResult, setRoundResult] = useState('');
  const [payoutMultiplier, setPayoutMultiplier] = useState(1.2);
  const [descriptionCollapsed, setDescriptionCollapsed] = useState(true);


  const toggleDescription = () => {
    setDescriptionCollapsed(!descriptionCollapsed);
  };
  
  const setToMinimumBet = () => {
    if (roundOver) {
      setBet(0.1); // Set the bet to the minimum value (0.1)
    }
  };

  const divideByTwo = () => {
     if (roundOver ) {
      setBet(bet / 2); // Divide the bet by two
    }
  };

  const multiplyByTwo = () => {
    if (roundOver) {
      setBet(bet * 2); // Multiply the bet by two
    }
  };

  const drawCards = () => {
    if (roundOver) {
      if (coins - bet < 0) {
        setResult('Not enough coins to place the bet.');
        return;
      }

      const index1 = Math.floor(Math.random() * cardValues.length);
      const index2 = Math.floor(Math.random() * cardValues.length);

      setCardValue1(cardValues[index1].unicode);
      setCardValue2(cardValues[index2].unicode);

      setResult('');
      setRoundOver(false);
      setCoins(coins - bet);
      setRoundResult('');
	 

      // Start the card animation
      
    }
  };

  const rollDice = () => {
    if (!roundOver) {
      // Generate random dice rolls (assuming a standard 6-sided die)
      const roll1 = Math.floor(Math.random() * 6) + 1;
      const roll2 = Math.floor(Math.random() * 6) + 1;

      setDiceValue1(roll1);
      setDiceValue2(roll2);

      // Convert face cards and Ace to their correct values
      const cardValue1Number = getCardValue(cardValue1);
      const cardValue2Number = getCardValue(cardValue2);

      const sum = roll1 + roll2;

      if (sum === cardValue1Number + cardValue2Number) {
        // If the sum of dice equals the combined value of cards, you win 10 times the bet
        const winnings = bet * 5;
        const newBalance = (parseFloat(coins) + winnings).toFixed(2);
        setCoins(newBalance);
        setRoundResult(`You won $${winnings.toFixed(2)}! (5x)`);
      } else if (sum === cardValue1Number || sum === cardValue2Number) {
        // If the sum matches one of the card values, it's a tie
        const tieWinnings = bet;
        const newBalance = (parseFloat(coins) + tieWinnings).toFixed(2);
        setCoins(newBalance);
		        setPayoutMultiplier(parseFloat((payoutMultiplier + 0.1).toFixed(1)));
        setRoundResult(`It's a tie! You get your bet back.`);
      } else if (
        (sum > cardValue1Number && sum < cardValue2Number) ||
        (sum < cardValue1Number && sum > cardValue2Number)
      ) {
        // You win when the sum falls between the two card values
        const winnings = bet * payoutMultiplier;
        const newBalance = (parseFloat(coins) + winnings).toFixed(2);
        setCoins(newBalance);

        // Increase the payoutMultiplier by 0.2x for the next round (rounded to 1 decimal place)
        setPayoutMultiplier(parseFloat((payoutMultiplier + 0.3).toFixed(1)));
        setRoundResult(`You won $${winnings.toFixed(2)}!`);
      } else {
        // You lose when the sum is outside the range
        const lostCoins = bet;

        setRoundResult(`You lost $${lostCoins.toFixed(2)}!`);

        // Reset the payoutMultiplier to its initial value when you lose
        setPayoutMultiplier(1.2);
      }

      // Set the roundOver flag to true
      setRoundOver(true);

    }
  };

  const getCardValue = (card) => {
    const selectedCard = cardValues.find((c) => c.unicode === card);
    if (selectedCard) {
      const label = selectedCard.label;
      if (['King', 'Queen', 'Jack'].includes(label)) {
        return 10;
      } else if (label === 'Ace') {
        return 1;
      } else {
        return parseInt(label);
      }
    } else {
      return 0;
    }
  };

  return (
    <ThemeProvider theme={theme}>
	
	  
      <Container className="mt-5" maxWidth="lg">
     

        

        <Grid container spacing={3}>
          <Grid item xs={12}>
            <CustomPaper>
              <Typography variant="h4" className="card-title">
Roll of Cards
              </Typography>
              <Typography variant="h6">
                <u>Balance</u>
              </Typography>
              <Typography variant="body1">
                <b>$</b> {coins}
              </Typography>
              <input
                type="number"
                className="form-control mb-6"
                placeholder="Enter bet amount"
                value={bet}
                onChange={(e) => roundOver && setBet(parseInt(e.target.value))}
                disabled={!roundOver}
              />
			  
        {/* Add buttons below the bet input */}
        <div style={{ marginTop: '10px' }}>
          <Button variant="contained" color="primary" onClick={setToMinimumBet}>
            Min
          </Button>
          <Button variant="contained" color="primary" onClick={divideByTwo}>
            /2
          </Button>
          <Button variant="contained" color="primary" onClick={multiplyByTwo}>
            x2
          </Button>
        </div>
		{/* Display the error message */}
{result && (
  <div className="alert alert-danger mt-2">{result}</div>
)}
    
              <Typography variant="body1">Current Bet: {bet}</Typography>
              <Typography variant="body1">Payout Multiplier: {payoutMultiplier}x</Typography>
              
              {roundOver ? (
                <Button variant="contained" color="primary" onClick={drawCards}>
                  Draw Cards
                </Button>
              ) : (
                <Button variant="contained" color="primary" onClick={rollDice}>
                  Roll Dice
                </Button>
              )}
 <Typography variant="body1">{roundResult}</Typography>
              <Grid container justify="center">
                 <Grid item xs={12} sm={6} className="centered-item">
                  <CardContainer className="cards-container">
                    <CardItem className="card-item">
                      <MyCard value={cardValue1} fontSize="150px" />
                    </CardItem>
                    <CardItem className="card-item">
                      <MyCard value={cardValue2} fontSize="150px" />
                    </CardItem>
                  </CardContainer>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <DiceContainer className="dice-container">
                    <DiceItem className="dice-item">
                      <Dice value={diceValue1} fontSize="100px" />
                    </DiceItem>
                    <DiceItem className="dice-item">
                      <Dice value={diceValue2} fontSize="100px" />
                    </DiceItem>
                  </DiceContainer>
                </Grid>
              </Grid>
			  
            </CustomPaper>
          </Grid>
        </Grid>
		
      </Container>
	     <CenteredText>
          <Button variant="contained" color="primary" onClick={toggleDescription}>
            {descriptionCollapsed ? 'How to play' : 'Hide Description'}
          </Button>
        </CenteredText>
		<CustomPaper className={descriptionCollapsed ? 'd-none' : ''}>
          <Typography variant="body1">
            <strong>Ways to Win:</strong>
            <ul>
              <li>
                If the sum of the dice rolls equals the combined value of the two drawn cards, you win{' '}
                <span className="fw-bold bg-warning">5x</span> your bet.
              </li>
              <li>If you tie with the cards, you get your bet back. Multiplier goes up by <span className="fw-bold bg-warning">0.1x</span> on a tie.</li>
		
              <li>If the sum of the dice rolls falls between the values of the two cards you drew, you win based on the payout multiplier. Multiplier goes up by <span className="fw-bold bg-warning">0.3x</span> on a win.</li>
			 
              <li>If you lose, you lose the bet amount.</li>
           
           
            </ul>
          </Typography>
        </CustomPaper>
    </ThemeProvider>
  );
}

export default Game;
