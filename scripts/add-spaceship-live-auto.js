// Script to add spaceship to AI Box #9271 and trigger live WebSocket update
// This updates the save file AND sends a live update to connected clients
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const SAVE_FILE = path.join(__dirname, '..', 'src', 'components', 'games', 'ConnectFour', 'rooms.save.json');
const WS_URL = 'ws://localhost:3002/ws/c4';

// Spaceship design
const spaceshipData = {
  type: 'spaceship',
  parts: [
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

async function main() {
  try {
    console.log('🚀 LIVE UPDATE: Adding spaceship to AI Box #9271');
    console.log('================================================\n');

    // Step 1: Update save file
    console.log('[1/3] 📝 Updating save file...');
    if (!fs.existsSync(SAVE_FILE)) {
      console.error('❌ Save file not found:', SAVE_FILE);
      process.exit(1);
    }

    const rawData = fs.readFileSync(SAVE_FILE, 'utf8');
    const saveData = JSON.parse(rawData);
    
    let foundBox = false;
    let roomId = null;
    let aiBoxCube = null;
    
    for (const room of saveData.rooms) {
      if (room.placedCubes && Array.isArray(room.placedCubes)) {
        for (const cube of room.placedCubes) {
          if (cube.isAIBox && cube.aiBoxLabel === 'AI Box #9271') {
            cube.aiContent = spaceshipData;
            cube.aiContentData = spaceshipData;
            foundBox = true;
            roomId = room.id;
            aiBoxCube = cube;
            break;
          }
        }
      }
      if (foundBox) break;
    }
    
    if (!foundBox) {
      console.error('❌ AI Box #9271 not found');
      process.exit(1);
    }

    // Create backup and save
    const backupFile = SAVE_FILE + '.backup';
    fs.copyFileSync(SAVE_FILE, backupFile);
    fs.writeFileSync(SAVE_FILE, JSON.stringify(saveData));
    console.log('✓ Save file updated (room', roomId + ')');
    console.log('✓ Backup created\n');

    // Step 2: Connect to WebSocket and send live update
    console.log('[2/3] 🔌 Connecting to WebSocket server...');
    
    const ws = new WebSocket(WS_URL);
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✓ Connected to', WS_URL + '\n');
        
        console.log('[3/3] 📡 Broadcasting cube update...');
        
        // Send cubes_sync message (same format as the client sends)
        const message = {
          type: 'cubes_sync',
          cubes: saveData.rooms.find(r => r.id === roomId).placedCubes,
          timestamp: Date.now()
        };
        
        ws.send(JSON.stringify(message));
        console.log('✓ Sent cubes_sync message to server');
        
        // Wait a bit for server to process
        setTimeout(() => {
          ws.close();
          resolve();
        }, 1000);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log('\n✅ SUCCESS!');
    console.log('================================================');
    console.log('Spaceship added to AI Box #9271 in room', roomId);
    console.log('✓ Save file updated');
    console.log('✓ Live update sent via WebSocket');
    console.log('✓ Connected clients should see it immediately');
    console.log('\nThe spaceship should now be visible in the game!');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  Could not connect to WebSocket server.');
      console.error('   The save file was updated, but live update failed.');
      console.error('   Please restart the Connect Four server to see changes.');
    }
    process.exit(1);
  }
}

main();
