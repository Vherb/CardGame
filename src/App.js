import React from "react";
import Game from "./components/games/RollofCards/Game";
import InBetweenGame from "./components/games/inBetween/InBetween";
import GameBoard from "./components/games/ConnectFour/GameBoard"; // Import your Connect Four game component

import "./App.css"; // You can add CSS styles here
import "bootstrap/dist/css/bootstrap.min.css";
import RegistrationForm from "./components/RegistrationForm"; // Import your existing RegistrationForm component
import { Container } from "react-bootstrap";
import { Routes, Route } from "react-router-dom";

function App() {
	return (
		<Routes>
			<Route path='/' element={<Home />} />
			<Route path='/game2' element={<InBetweenGame />} />
			<Route path='/registration' element={<RegistrationForm />} />
			<Route path="/connect-four" element={<GameBoard />} />
		</Routes>
	);
}

function Home() {
	return (
		<div className='App game-background'>
			<Container style={{ marginTop: "64px" }}>
				{/* Add margin to create space below the navigation bar */}
				<Game />
			</Container>
		</div>
	);
}

export default App;
