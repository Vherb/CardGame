// Dice.jsx
import React from "react";

/**
 * Props:
 * - value: 1..6
 * - fontSize: inherits from parent by default (e.g., .dice-item in Game.css)
 * - className: optional class names
 * - boxScale: scales the white box relative to the glyph's 1em box (default 1.0)
 * - yNudgeEm: vertical nudge for the glyph (em units) to visually center (default -0.06)
 */
function Dice({
  value = 1,
  fontSize = "inherit",
  className = "",
  boxScale = 0.5,   // try 0.94–0.98 if you want it a hair tighter than the glyph
  yNudgeEm = -0.06, // match whatever you used on MyCard (e.g., -0.06)
  border = "1px solid rgba(255,255,255,0.25)",
}) {
  const diceSymbols = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  const safeIndex = ((value - 1) % 6 + 6) % 6;
  const glyph = diceSymbols[safeIndex];

  return (
    // RELATIVE wrapper so we can position a 1em x 1em white square *behind* the emoji
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        lineHeight: 1,
        background: "transparent",
        padding: 0,
        margin: 0,
        fontSize, // drives both the glyph AND the 1em underlay
      }}
      aria-label={`Die showing ${safeIndex + 1}`}
    >
      {/* Exact-size white box underlay: 1em x 1em, centered, scalable */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "1em",
          height: "1em",
          transform: `translate(-50%, -50%) scale(${boxScale})`,
          background: "#ffffff",
          border,
          borderRadius: 0,   // square edges
          boxShadow: "0 4px 12px rgba(0,0,0,.28)",
          pointerEvents: "none", // purely decorative
        }}
      />

      {/* The dice glyph itself */}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          display: "inline-block",
          lineHeight: 1,
          margin: 0,
          padding: 0,
          transform: `translateY(${yNudgeEm}em)`,
          background: "transparent",
        }}
      >
        {glyph}
      </span>
    </span>
  );
}

export default Dice;
