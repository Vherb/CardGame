const fs = require('fs');
const path = require('path');

const savePath = path.join(__dirname, '..', 'src', 'components', 'games', 'ConnectFour', 'rooms.save.json');

// Read the save file
const data = JSON.parse(fs.readFileSync(savePath, 'utf8'));

// Find room 66
const room = data.rooms.find(r => r.id === 66);
if (!room) {
  console.error('❌ Room 66 not found');
  process.exit(1);
}

// Find AI Box #16
const cube = room.placedCubes.find(c => c.id === 1761264239638.2341);
if (!cube) {
  console.error('❌ AI Box #16 not found');
  process.exit(1);
}

console.log('🔍 Found AI Box #16 with prompt:', cube.aiPrompt);

// Generate realistic tree content
const treeContent = {
  type: 'tree',
  parts: [
    // Trunk - 3 segments with slight organic variation
    {
      name: 'trunk_base',
      shape: 'cylinder',
      position: [0.5, 0.15, 0.5],
      scale: [0.08, 0.3, 0.08],
      rotation: [0, 0, 0],
      color: '#654321', // Dark brown bark
      metalness: 0.1,
      roughness: 0.9
    },
    {
      name: 'trunk_mid',
      shape: 'cylinder',
      position: [0.5, 0.35, 0.5],
      scale: [0.07, 0.25, 0.07],
      rotation: [0, 0, 0.05], // Slight tilt for organic feel
      color: '#5c3d1f', // Medium brown
      metalness: 0.1,
      roughness: 0.9
    },
    {
      name: 'trunk_top',
      shape: 'cylinder',
      position: [0.5, 0.52, 0.5],
      scale: [0.06, 0.15, 0.06],
      rotation: [0, 0, -0.03],
      color: '#4a2f18', // Lighter brown at top
      metalness: 0.1,
      roughness: 0.9
    },
    
    // Canopy - layered cones for realistic tree shape
    {
      name: 'canopy_bottom',
      shape: 'cone',
      position: [0.5, 0.55, 0.5],
      scale: [0.3, 0.2, 0.3],
      rotation: [3.14159, 0, 0], // Flip upside down
      color: '#228B22', // Forest green
      metalness: 0.2,
      roughness: 0.7
    },
    {
      name: 'canopy_mid_1',
      shape: 'cone',
      position: [0.5, 0.65, 0.5],
      scale: [0.28, 0.18, 0.28],
      rotation: [3.14159, 0, 0],
      color: '#2E8B57', // Sea green
      metalness: 0.2,
      roughness: 0.7
    },
    {
      name: 'canopy_mid_2',
      shape: 'cone',
      position: [0.5, 0.73, 0.5],
      scale: [0.24, 0.16, 0.24],
      rotation: [3.14159, 0, 0],
      color: '#32CD32', // Lime green
      metalness: 0.2,
      roughness: 0.7
    },
    {
      name: 'canopy_top',
      shape: 'cone',
      position: [0.5, 0.82, 0.5],
      scale: [0.18, 0.14, 0.18],
      rotation: [3.14159, 0, 0],
      color: '#3CB371', // Medium sea green
      metalness: 0.2,
      roughness: 0.7
    },
    
    // Branches extending from trunk
    {
      name: 'branch_left_1',
      shape: 'cylinder',
      position: [0.3, 0.5, 0.5],
      scale: [0.02, 0.12, 0.02],
      rotation: [0, 0, 0.8], // Angled out
      color: '#5c3d1f',
      metalness: 0.1,
      roughness: 0.9
    },
    {
      name: 'branch_right_1',
      shape: 'cylinder',
      position: [0.7, 0.5, 0.5],
      scale: [0.02, 0.12, 0.02],
      rotation: [0, 0, -0.8],
      color: '#5c3d1f',
      metalness: 0.1,
      roughness: 0.9
    },
    {
      name: 'branch_front',
      shape: 'cylinder',
      position: [0.5, 0.55, 0.35],
      scale: [0.02, 0.1, 0.02],
      rotation: [0.7, 0, 0],
      color: '#5c3d1f',
      metalness: 0.1,
      roughness: 0.9
    },
    {
      name: 'branch_back',
      shape: 'cylinder',
      position: [0.5, 0.55, 0.65],
      scale: [0.02, 0.1, 0.02],
      rotation: [-0.7, 0, 0],
      color: '#5c3d1f',
      metalness: 0.1,
      roughness: 0.9
    },
    
    // Foliage clusters for detail
    {
      name: 'foliage_cluster_1',
      shape: 'sphere',
      position: [0.3, 0.6, 0.5],
      scale: [0.12, 0.12, 0.12],
      rotation: [0, 0, 0],
      color: '#228B22',
      metalness: 0.2,
      roughness: 0.8
    },
    {
      name: 'foliage_cluster_2',
      shape: 'sphere',
      position: [0.7, 0.6, 0.5],
      scale: [0.12, 0.12, 0.12],
      rotation: [0, 0, 0],
      color: '#2E8B57',
      metalness: 0.2,
      roughness: 0.8
    },
    {
      name: 'foliage_cluster_3',
      shape: 'sphere',
      position: [0.5, 0.6, 0.35],
      scale: [0.1, 0.1, 0.1],
      rotation: [0, 0, 0],
      color: '#32CD32',
      metalness: 0.2,
      roughness: 0.8
    },
    {
      name: 'foliage_cluster_4',
      shape: 'sphere',
      position: [0.5, 0.6, 0.65],
      scale: [0.1, 0.1, 0.1],
      rotation: [0, 0, 0],
      color: '#3CB371',
      metalness: 0.2,
      roughness: 0.8
    }
  ]
};

// Update cube with generated content
cube.aiContentData = treeContent;
cube.aiContent = treeContent; // Sync both fields

// Write back to save file
fs.writeFileSync(savePath, JSON.stringify(data));

console.log('✅ Tree generated successfully for AI Box #16!');
console.log('🌳 Generated tree with:');
console.log('   - 3-segment brown bark trunk');
console.log('   - 4-layer green canopy (layered cones)');
console.log('   - 4 extending branches');
console.log('   - 4 foliage detail clusters');
console.log('   - Realistic texturing (high roughness, low metalness)');
console.log('\n💾 Saved to rooms.save.json');
console.log('🔄 Reload your game to see the tree!');
