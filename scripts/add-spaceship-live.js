// Live update - add spaceship to AI Box #9271 without server restart
// This sends the update through WebSocket just like editing a cube in the game

const spaceshipData = {
  type: 'spaceship',
  parts: [
    // Main fuselage (body)
    {
      name: 'fuselage',
      shape: 'cylinder',
      position: [0.5, 0.4, 0.5],
      scale: [0.15, 0.5, 0.15],
      rotation: [0, 0, 0],
      color: '#cbd5e1',
      metalness: 0.8,
      roughness: 0.3
    },
    // Nose cone
    {
      name: 'nose',
      shape: 'cone',
      position: [0.5, 0.75, 0.5],
      scale: [0.15, 0.2, 0.15],
      rotation: [0, 0, 0],
      color: '#dc2626',
      metalness: 0.9,
      roughness: 0.2
    },
    // Cockpit window
    {
      name: 'cockpit',
      shape: 'sphere',
      position: [0.5, 0.6, 0.35],
      scale: [0.08, 0.08, 0.08],
      rotation: [0, 0, 0],
      color: '#3b82f6',
      metalness: 0.1,
      roughness: 0.1,
      emissive: '#1e40af',
      emissiveIntensity: 0.5
    },
    // Left wing
    {
      name: 'wing_left',
      shape: 'box',
      position: [0.25, 0.35, 0.5],
      scale: [0.25, 0.05, 0.15],
      rotation: [0, 0, 0.3],
      color: '#ef4444',
      metalness: 0.7,
      roughness: 0.4
    },
    // Right wing
    {
      name: 'wing_right',
      shape: 'box',
      position: [0.75, 0.35, 0.5],
      scale: [0.25, 0.05, 0.15],
      rotation: [0, 0, -0.3],
      color: '#ef4444',
      metalness: 0.7,
      roughness: 0.4
    },
    // Left engine
    {
      name: 'engine_left',
      shape: 'cylinder',
      position: [0.35, 0.15, 0.5],
      scale: [0.08, 0.25, 0.08],
      rotation: [0, 0, 0],
      color: '#64748b',
      metalness: 0.9,
      roughness: 0.2
    },
    // Right engine
    {
      name: 'engine_right',
      shape: 'cylinder',
      position: [0.65, 0.15, 0.5],
      scale: [0.08, 0.25, 0.08],
      rotation: [0, 0, 0],
      color: '#64748b',
      metalness: 0.9,
      roughness: 0.2
    },
    // Left thruster glow
    {
      name: 'thruster_left',
      shape: 'sphere',
      position: [0.35, 0.05, 0.5],
      scale: [0.06, 0.06, 0.06],
      rotation: [0, 0, 0],
      color: '#f59e0b',
      metalness: 0.1,
      roughness: 0.1,
      emissive: '#f59e0b',
      emissiveIntensity: 2.0
    },
    // Right thruster glow
    {
      name: 'thruster_right',
      shape: 'sphere',
      position: [0.65, 0.05, 0.5],
      scale: [0.06, 0.06, 0.06],
      rotation: [0, 0, 0],
      color: '#f59e0b',
      metalness: 0.1,
      roughness: 0.1,
      emissive: '#f59e0b',
      emissiveIntensity: 2.0
    },
    // Left fin
    {
      name: 'fin_left',
      shape: 'box',
      position: [0.35, 0.25, 0.3],
      scale: [0.05, 0.15, 0.1],
      rotation: [0, 0, 0],
      color: '#dc2626',
      metalness: 0.7,
      roughness: 0.3
    },
    // Right fin
    {
      name: 'fin_right',
      shape: 'box',
      position: [0.65, 0.25, 0.3],
      scale: [0.05, 0.15, 0.1],
      rotation: [0, 0, 0],
      color: '#dc2626',
      metalness: 0.7,
      roughness: 0.3
    }
  ]
};

console.log('====================================');
console.log('LIVE SPACESHIP INJECTION - NO RESTART');
console.log('====================================');
console.log('');
console.log('📋 Copy and paste this into your BROWSER CONSOLE:');
console.log('');
console.log('------- START COPY HERE -------');
console.log('');
console.log(`
// Find AI Box #9271
const aiBox = window.__CF_REMOTE_CUBES__.find(c => c.isAIBox && c.aiBoxLabel === 'AI Box #9271');
if (!aiBox) {
  console.error('❌ AI Box #9271 not found!');
} else {
  console.log('✅ Found AI Box #9271:', aiBox.id);
  
  // Use the built-in function to add content
  if (window.__CF_ADD_AI_CONTENT__) {
    window.__CF_ADD_AI_CONTENT__('9271', ${JSON.stringify(spaceshipData, null, 2)});
    console.log('🚀 Spaceship added! Check the box!');
  } else {
    console.error('❌ __CF_ADD_AI_CONTENT__ function not available');
  }
}
`);
console.log('');
console.log('------- END COPY HERE -------');
console.log('');
console.log('This will:');
console.log('1. Find AI Box #9271 in the current game');
console.log('2. Add the spaceship content to it');
console.log('3. Sync the update to the server and other players');
console.log('4. Save it to the game state (persists on server restart)');
console.log('');
console.log('No server restart needed! 🎉');
