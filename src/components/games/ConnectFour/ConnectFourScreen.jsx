/* eslint-disable react/jsx-pascal-case */
import React from "react";
import "./ConnectFourScreen.css";
import GameBoard from "./GameBoard";
import NavBar from "./../../NavBar"; // <-- your existing nav

export default function ConnectFourScreen() {
  return (
    <div className="cf-screen">
      {/* Your fixed NavBar */}
      <NavBar />

      {/* Spacer so content starts directly below your NavBar */}
      <div className="nav-spacer" aria-hidden="true" />

      {/* Scrollable content area */}
      <main className="app-content">
        {/* Embedded mode: GameBoard hides its own header/spacer */}
        <GameBoard embedded />
      </main>
    </div>
  );
}
