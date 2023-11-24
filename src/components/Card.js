import React from 'react';

function MyCard({ value, fontSize, className }) {
  const cardStyle = {
    fontSize: fontSize || '80px', // You can adjust the font size as needed
    display: 'inline-block', // Add this line to make cards display inline
	
  };

  return <div className={`card ${className}` } style={cardStyle}>{value}</div>;
}

export default MyCard;
