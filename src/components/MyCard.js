import React from 'react';

function MyCard({ value, fontSize, color }) {
  return (
    <div className="card" style={{ color: color, width: '100px', fontSize }}>
    
        {value}
      </div>
  
  );
}

export default MyCard;
