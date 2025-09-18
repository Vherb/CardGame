// MyCard.jsx
import React from "react";

function MyCard({ value, fontSize = "inherit", color = "inherit" }) {
  return (
    <span
      // Tight white plate behind the glyph
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#ffffff",
        border: "2px solid rgba(255,255,255,0.18)",
        borderRadius: "10px",
        padding: "4px 6px",
        lineHeight: 1,
        boxShadow: "0 4px 12px rgba(0,0,0,.28)",
      }}
    >
      <span
        // The emoji glyph; nudged upward to counter baseline bias
        style={{
          color,
          fontSize,       // inherits from parent .card-item
          lineHeight: 1,
          display: "inline-block",
          background: "transparent",
          margin: 0,
          padding: 0,
          position: "relative",
          transform: "translateY(-0.06em)", // <-- vertical nudge up
        }}
      >
        {value}
      </span>
    </span>
  );
}

export default MyCard;
