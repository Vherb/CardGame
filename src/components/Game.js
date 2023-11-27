import React, { useState, useEffect } from "react";
import MyCard from "./MyCard";
import Dice from "./Dice";
import "./App.css";
import "./Game.css";
import StellarSdk from "stellar-sdk";

import {
	Button,
	Typography,
	Paper,
	Grid,
	Container,
	ThemeProvider,
	createTheme,
	styled,
} from "@mui/material";

const CenteredText = styled("div")({
	textAlign: "center",
});

const CardContainer = styled("div")({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	marginTop: "0px", // Increase the margin to create more space
});

const CardItem = styled("div")(({ theme }) => ({
	margin: theme.spacing(1),
}));

const DiceContainer = styled("div")({
	display: "flex",
	flexDirection: "row",
	alignItems: "center",
	justifyContent: "center",
	marginTop: "15px",
});

const DiceItem = styled("div")(({ theme }) => ({
	margin: theme.spacing(1),
}));

const CustomPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(3),
	marginBottom: theme.spacing(2),
}));

const JackpotMessage = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	background: "#4CAF50", // Background color for the jackpot message
	color: "#fff", // Text color for the jackpot message
	textAlign: "center",
	fontWeight: "bold",
	fontSize: "24px",
	marginBottom: theme.spacing(2),
	border: "2px solid #388E3C", // Border color for the jackpot message
	borderRadius: "10px", // Border radius for the jackpot message
}));

function Game() {
	const cardValues = [
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

	const theme = createTheme();
	const [cardValue1, setCardValue1] = useState("");
	const [cardValue2, setCardValue2] = useState("");
	const [diceValue1, setDiceValue1] = useState(0);
	const [diceValue2, setDiceValue2] = useState(0);
	const [result, setResult] = useState("");
	const [roundOver, setRoundOver] = useState(true);
	const [coins, setCoins] = useState(100);
	const [bet, setBet] = useState(0);
	const [roundResult, setRoundResult] = useState("");
	const [payoutMultiplier, setPayoutMultiplier] = useState(1.2);
	const [descriptionCollapsed, setDescriptionCollapsed] = useState(true);
	const [jackpotInProgress, setJackpotInProgress] = useState(false); // State to track jackpot

	const [account, setAccount] = useState(null);

	
  
	useEffect(() => {
		// Replace 'YOUR_PUBLIC_KEY' with the actual public key of the account you want to query
		const publicKey = 'GDD3QDSS2ZTJNDFF6ZK7D4XNMPH6W7Z3RW5CZPIV56ZW522MHPROFR27';
	  
		// Create a new instance of the Stellar Server
		const server = new StellarSdk.Server('https://horizon-testnet.stellar.org');
	  
		console.log("Public Key:", publicKey);

server.loadAccount(publicKey)
  .then((loadedAccount) => {
    console.log("Account loaded successfully:", loadedAccount);
  })
  .catch((error) => {
    console.error("Error loading account:", error);
  });
		  
	  }, []); // The empty dependency array ensures this effect runs only once when the component mounts


	const toggleDescription = () => {
		setDescriptionCollapsed(!descriptionCollapsed);
	};

	const setToMinimumBet = () => {
		if (roundOver) {
			setBet(0.1); // Set the bet to the minimum value (0.1)
		}
	};

	const divideByTwo = () => {
		if (roundOver) {
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
				setResult("Not enough coins to place the bet.");
				return;
			}

			const index1 = Math.floor(Math.random() * cardValues.length);
			const index2 = Math.floor(Math.random() * cardValues.length);

			setCardValue1(cardValues[index1]);
			setCardValue2(cardValues[index2]);

			setResult("");
			setRoundOver(false);
			setCoins(coins - bet);
			setRoundResult("");

			if (
				cardValues[index1].label === "Ace" &&
				cardValues[index1].color === "red" &&
				cardValues[index2].label === "Ace" &&
				cardValues[index2].color === "red"
			) {
				setJackpotInProgress(true); // Jackpot is in progress
			}
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
			const cardValue1Number = getCardValue(cardValue1.unicode);
			const cardValue2Number = getCardValue(cardValue2.unicode);

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
				// Check for two ones rolled and jackpot in progress
				if (roll1 === 1 && roll2 === 1 && jackpotInProgress) {
					// Special win condition: Two ones rolled and jackpot is in progress
					const JackpotWin = bet * 50;
					const newBalance = (parseFloat(coins) + JackpotWin).toFixed(2);
					setCoins(newBalance);
					setRoundResult(
						`Special win! You won $${JackpotWin.toFixed(2)}! (50x)`
					);
				} else {
					// You lose when the sum is outside the range
					const lostCoins = bet;

					setRoundResult(`You lost $${lostCoins.toFixed(2)}!`);

					// Reset the payoutMultiplier to its initial value when you lose
					setPayoutMultiplier(1.2);
				}
			}
			setJackpotInProgress(false);
			// Set the roundOver flag to true
			setRoundOver(true);
		}
	};

	const getCardValue = (card) => {
		const selectedCard = cardValues.find((c) => c.unicode === card);
		if (selectedCard) {
			const label = selectedCard.label;
			if (["King", "Queen", "Jack"].includes(label)) {
				return 10;
			} else if (label === "Ace") {
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
			<Container className='mt-5' maxWidth='lg'>
				<Grid container spacing={3}>
					<Grid item xs={12}>
						<CustomPaper>
							<Typography variant='h4' className='card-title'>
								Roll of Cards
							</Typography>
							<Typography variant='h6'>
								<u>Balance</u>
							</Typography>
							<div className='balance-box'>
								<Typography variant='body1'>
									<b>$</b> {coins}
								</Typography>
							</div>
							<input
								type='number'
								className='form-control mb-6'
								placeholder='Enter bet amount'
								value={bet}
								onChange={(e) => roundOver && setBet(parseInt(e.target.value))}
								disabled={!roundOver}
							/>

							{/* Add buttons below the bet input */}
							<div style={{ marginTop: "10px" }}>
								<Button
									variant='contained'
									color='primary'
									onClick={setToMinimumBet}
								>
									Min
								</Button>
								<Button
									variant='contained'
									color='primary'
									onClick={divideByTwo}
								>
									/2
								</Button>
								<Button
									variant='contained'
									color='primary'
									onClick={multiplyByTwo}
								>
									x2
								</Button>
							</div>
							{/* Display the error message */}
							{result && (
								<div className='alert alert-danger mt-2'>{result}</div>
							)}

							<Typography variant='body1'>Current Bet: {bet}</Typography>
							<Typography variant='body1'>
								Payout Multiplier: {payoutMultiplier}x
							</Typography>

							{roundOver ? (
								<Button variant='contained' color='primary' onClick={drawCards}>
									Draw Cards
								</Button>
							) : (
								<Button variant='contained' color='primary' onClick={rollDice}>
									Roll Dice
								</Button>
							)}

							<div className='round-result-box '>
								<Typography variant='body1' className='results-label'>
									Results
								</Typography>
								<Typography variant='body1' className='round-result'>
									{roundResult}
								</Typography>
							</div>
							{jackpotInProgress && (
								<div className='jackpot-description'>
									JACKPOT IN PROGRESS! Roll{" "}
									<span className='jackpot-dice'> &#9856; &#9856;</span>
									TO WIN 50X!!
								</div>
							)}

							<Grid container justify='center'>
								<Grid item xs={12} sm={6} className='centered-item'>
									<CardContainer className='cards-container'>
										<CardItem className='card-item'>
											<MyCard
												value={cardValue1.unicode}
												fontSize='150px'
												color={cardValue1.color}
											/>
										</CardItem>
										<CardItem className='card-item'>
											<MyCard
												value={cardValue2.unicode}
												fontSize='150px'
												color={cardValue2.color}
											/>
										</CardItem>
									</CardContainer>
								</Grid>
								<Grid item xs={12} sm={6}>
									<DiceContainer className='dice-container'>
										<DiceItem className='dice-item'>
											<Dice value={diceValue1} fontSize='100px' />
										</DiceItem>
										<DiceItem className='dice-item'>
											<Dice value={diceValue2} fontSize='100px' />
										</DiceItem>
									</DiceContainer>
								</Grid>
							</Grid>
						</CustomPaper>
					</Grid>
				</Grid>
			</Container>
			<CenteredText>
				<Button variant='contained' color='primary' onClick={toggleDescription}>
					{descriptionCollapsed ? "How to play" : "Hide Description"}
				</Button>
			</CenteredText>
			<CustomPaper className={descriptionCollapsed ? "d-none" : ""}>
				<Typography variant='body1'>
					<strong>Ways to Win:</strong>
					<ul>
						<li>
							If the sum of the dice rolls equals the combined value of the two
							drawn cards, you{" "}
							<span className='fw-bold bg-warning'>Win 5x</span> your bet.
						</li>
						<li>
							Draw <span className='jackpot-card'> &#127169; &#127153;</span>{" "}
							and roll <span className='jackpot-dice'> &#9856; &#9856;</span>
							<span className='fw-bold bg-warning'>Win 50x</span> your bet.
						</li>
						<li>
							If you tie with the cards, you get your bet back. Multiplier goes
							up by <span className='fw-bold bg-warning'>0.1x</span> on a tie.
						</li>

						<li>
							If the sum of the dice rolls falls between the values of the two
							cards you drew, you win based on the payout multiplier. Multiplier
							goes up by <span className='fw-bold bg-warning'>0.3x</span> on a
							win.
						</li>

						<li>If you lose, you lose the bet amount.</li>
					</ul>
				</Typography>
			</CustomPaper>
		</ThemeProvider>
	);
}

export default Game;
