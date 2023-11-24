import React from 'react';

function MyCard({ value, fontSize }) {
  return (
    <div className="card" style={{ width: '100px', fontSize }}>
    
        {value}
      </div>
  
  );
}

export default MyCard;
