// Script to add spaceship content to AI Box #9271 in Connect Four saved game
const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.join(__dirname, '..', 'src', 'components', 'games', 'ConnectFour', 'rooms.save.json');

// Spaceship design - 11 parts scaled to fit within the box (0-1 range)
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

function main() {
  try {
    console.log('Reading saved game file:', SAVE_FILE);
    
    // Check if file exists
    if (!fs.existsSync(SAVE_FILE)) {
      console.error('ERROR: Save file not found at', SAVE_FILE);
      process.exit(1);
    }

    // Read and parse JSON
    const rawData = fs.readFileSync(SAVE_FILE, 'utf8');
    const saveData = JSON.parse(rawData);
    
    console.log(`Found ${saveData.rooms.length} saved rooms`);
    
    // Find AI Box #9271
    let foundBox = false;
    let roomId = null;
    
    for (const room of saveData.rooms) {
      if (room.placedCubes && Array.isArray(room.placedCubes)) {
        for (const cube of room.placedCubes) {
          if (cube.isAIBox && cube.aiBoxLabel === 'AI Box #9271') {
            console.log(`Found AI Box #9271 in room ${room.id}`);
            console.log('Current aiContent:', cube.aiContent);
            console.log('Current aiContentData:', cube.aiContentData);
            
            // Add spaceship data to BOTH properties for compatibility
            cube.aiContent = spaceshipData;
            cube.aiContentData = spaceshipData;
            
            console.log('✓ Added spaceship content to AI Box #9271');
            foundBox = true;
            roomId = room.id;
            break;
          }
        }
      }
      if (foundBox) break;
    }
    
    if (!foundBox) {
      console.error('ERROR: AI Box #9271 not found in any saved room');
      process.exit(1);
    }
    
    // Create backup
    const backupFile = SAVE_FILE + '.backup';
    fs.copyFileSync(SAVE_FILE, backupFile);
    console.log('✓ Created backup at:', backupFile);
    
    // Write updated data
    fs.writeFileSync(SAVE_FILE, JSON.stringify(saveData));
    console.log('✓ Saved updated game data');
    
    console.log('\n✅ SUCCESS! Spaceship added to AI Box #9271 in room', roomId);
    console.log('\nNext steps:');
    console.log('1. Restart the Connect Four server if it\'s running');
    console.log('2. Load the saved game (room', roomId + ')');
    console.log('3. The spaceship should appear inside AI Box #9271');
    
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
