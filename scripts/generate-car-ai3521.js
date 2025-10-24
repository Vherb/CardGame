// Generate sports car for AI Box #3521
const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.join(__dirname, '..', 'src', 'components', 'games', 'ConnectFour', 'rooms.save.json');

// Generate a sleek sports car with glowing headlights and hazard brake lights
const sportsCarData = {
  type: "sports_car",
  parts: [
    // Main body (sleek, low profile)
    { name: "body_lower", shape: "box", position: [0.5, 0.2, 0.5], scale: [0.8, 0.12, 0.4], rotation: [0, 0, 0], color: "#dc2626", metalness: 0.9, roughness: 0.1 },
    { name: "body_mid", shape: "box", position: [0.5, 0.3, 0.5], scale: [0.75, 0.1, 0.38], rotation: [0, 0, 0], color: "#b91c1c", metalness: 0.9, roughness: 0.1 },
    
    // Rounded cabin/windshield area
    { name: "cabin", shape: "box", position: [0.45, 0.4, 0.5], scale: [0.35, 0.15, 0.32], rotation: [0, 0, 0], color: "#991b1b", metalness: 0.8, roughness: 0.15 },
    { name: "windshield", shape: "box", position: [0.6, 0.42, 0.5], scale: [0.2, 0.12, 0.28], rotation: [0.3, 0, 0], color: "#1e3a8a", metalness: 0.1, roughness: 0.05, emissive: "#1e40af", emissiveIntensity: 0.1 },
    
    // Hood (front tapered)
    { name: "hood_front", shape: "box", position: [0.75, 0.25, 0.5], scale: [0.25, 0.08, 0.36], rotation: [0, 0, 0], color: "#dc2626", metalness: 0.9, roughness: 0.1 },
    { name: "hood_nose", shape: "box", position: [0.88, 0.22, 0.5], scale: [0.1, 0.06, 0.32], rotation: [0, 0, 0], color: "#b91c1c", metalness: 0.9, roughness: 0.1 },
    
    // Rear spoiler
    { name: "spoiler_base", shape: "box", position: [0.15, 0.35, 0.5], scale: [0.05, 0.02, 0.34], rotation: [0, 0, 0], color: "#1f2937", metalness: 0.7, roughness: 0.3 },
    { name: "spoiler_wing", shape: "box", position: [0.12, 0.42, 0.5], scale: [0.08, 0.015, 0.38], rotation: [0, 0, 0], color: "#1f2937", metalness: 0.7, roughness: 0.3 },
    
    // Front bumper/grille
    { name: "bumper_front", shape: "box", position: [0.95, 0.15, 0.5], scale: [0.05, 0.04, 0.38], rotation: [0, 0, 0], color: "#374151", metalness: 0.6, roughness: 0.4 },
    { name: "grille", shape: "box", position: [0.93, 0.18, 0.5], scale: [0.02, 0.05, 0.3], rotation: [0, 0, 0], color: "#111827", metalness: 0.3, roughness: 0.7 },
    
    // Headlights (with bright glow)
    { name: "headlight_left", shape: "cylinder", position: [0.92, 0.22, 0.32], scale: [0.04, 0.02, 0.04], rotation: [0, 0, 1.5708], color: "#f0f9ff", metalness: 0.1, roughness: 0.1, emissive: "#e0f2fe", emissiveIntensity: 3 },
    { name: "headlight_right", shape: "cylinder", position: [0.92, 0.22, 0.68], scale: [0.04, 0.02, 0.04], rotation: [0, 0, 1.5708], color: "#f0f9ff", metalness: 0.1, roughness: 0.1, emissive: "#e0f2fe", emissiveIntensity: 3 },
    
    // Headlight glow cones
    { name: "headlight_glow_left", shape: "cone", position: [0.98, 0.22, 0.32], scale: [0.03, 0.08, 0.03], rotation: [0, 0, -1.5708], color: "#bae6fd", metalness: 0.0, roughness: 0.0, emissive: "#bae6fd", emissiveIntensity: 2.5 },
    { name: "headlight_glow_right", shape: "cone", position: [0.98, 0.22, 0.68], scale: [0.03, 0.08, 0.03], rotation: [0, 0, -1.5708], color: "#bae6fd", metalness: 0.0, roughness: 0.0, emissive: "#bae6fd", emissiveIntensity: 2.5 },
    
    // Rear brake/hazard lights (animated blinking effect via high emissive)
    { name: "brake_light_left", shape: "cylinder", position: [0.08, 0.25, 0.32], scale: [0.035, 0.02, 0.035], rotation: [0, 0, 1.5708], color: "#fee2e2", metalness: 0.1, roughness: 0.1, emissive: "#fca5a5", emissiveIntensity: 4 },
    { name: "brake_light_right", shape: "cylinder", position: [0.08, 0.25, 0.68], scale: [0.035, 0.02, 0.035], rotation: [0, 0, 1.5708], color: "#fee2e2", metalness: 0.1, roughness: 0.1, emissive: "#fca5a5", emissiveIntensity: 4 },
    
    // Wheels
    { name: "wheel_fl", shape: "cylinder", position: [0.75, 0.1, 0.22], scale: [0.08, 0.04, 0.08], rotation: [0, 0, 1.5708], color: "#1f2937", metalness: 0.5, roughness: 0.6 },
    { name: "wheel_fr", shape: "cylinder", position: [0.75, 0.1, 0.78], scale: [0.08, 0.04, 0.08], rotation: [0, 0, 1.5708], color: "#1f2937", metalness: 0.5, roughness: 0.6 },
    { name: "wheel_rl", shape: "cylinder", position: [0.25, 0.1, 0.22], scale: [0.08, 0.04, 0.08], rotation: [0, 0, 1.5708], color: "#1f2937", metalness: 0.5, roughness: 0.6 },
    { name: "wheel_rr", shape: "cylinder", position: [0.25, 0.1, 0.78], scale: [0.08, 0.04, 0.08], rotation: [0, 0, 1.5708], color: "#1f2937", metalness: 0.5, roughness: 0.6 },
    
    // Wheel rims
    { name: "rim_fl", shape: "cylinder", position: [0.75, 0.1, 0.20], scale: [0.05, 0.02, 0.05], rotation: [0, 0, 1.5708], color: "#d1d5db", metalness: 0.9, roughness: 0.2 },
    { name: "rim_fr", shape: "cylinder", position: [0.75, 0.1, 0.80], scale: [0.05, 0.02, 0.05], rotation: [0, 0, 1.5708], color: "#d1d5db", metalness: 0.9, roughness: 0.2 },
    { name: "rim_rl", shape: "cylinder", position: [0.25, 0.1, 0.20], scale: [0.05, 0.02, 0.05], rotation: [0, 0, 1.5708], color: "#d1d5db", metalness: 0.9, roughness: 0.2 },
    { name: "rim_rr", shape: "cylinder", position: [0.25, 0.1, 0.80], scale: [0.05, 0.02, 0.05], rotation: [0, 0, 1.5708], color: "#d1d5db", metalness: 0.9, roughness: 0.2 },
    
    // Side mirrors
    { name: "mirror_left", shape: "box", position: [0.55, 0.43, 0.28], scale: [0.03, 0.02, 0.04], rotation: [0, -0.3, 0], color: "#1f2937", metalness: 0.8, roughness: 0.2 },
    { name: "mirror_right", shape: "box", position: [0.55, 0.43, 0.72], scale: [0.03, 0.02, 0.04], rotation: [0, 0.3, 0], color: "#1f2937", metalness: 0.8, roughness: 0.2 },
    
    // Exhaust pipes
    { name: "exhaust_left", shape: "cylinder", position: [0.05, 0.13, 0.38], scale: [0.025, 0.05, 0.025], rotation: [0, 0, 1.5708], color: "#4b5563", metalness: 0.7, roughness: 0.4 },
    { name: "exhaust_right", shape: "cylinder", position: [0.05, 0.13, 0.62], scale: [0.025, 0.05, 0.025], rotation: [0, 0, 1.5708], color: "#4b5563", metalness: 0.7, roughness: 0.4 },
    
    // Air intakes (side vents)
    { name: "vent_left", shape: "box", position: [0.5, 0.22, 0.25], scale: [0.15, 0.02, 0.05], rotation: [0, 0, 0], color: "#111827", metalness: 0.3, roughness: 0.7 },
    { name: "vent_right", shape: "box", position: [0.5, 0.22, 0.75], scale: [0.15, 0.02, 0.05], rotation: [0, 0, 0], color: "#111827", metalness: 0.3, roughness: 0.7 },
    
    // Roof detail
    { name: "roof_line", shape: "box", position: [0.45, 0.48, 0.5], scale: [0.3, 0.01, 0.25], rotation: [0, 0, 0], color: "#1f2937", metalness: 0.8, roughness: 0.25 }
  ]
};

// Read the save file
let saveData;
try {
  const raw = fs.readFileSync(SAVE_FILE, 'utf-8');
  saveData = JSON.parse(raw);
} catch (err) {
  console.error('Error reading save file:', err);
  process.exit(1);
}

// Find the active room (room 66 based on the data)
const room = saveData.rooms.find(r => r.id === 66);
if (!room) {
  console.error('Room 66 not found');
  process.exit(1);
}

// Find AI Box #3521
const aiBox = room.placedCubes.find(c => c.id === 1761267563143.2407);
if (!aiBox) {
  console.error('AI Box #3521 (id: 1761267563143.2407) not found');
  process.exit(1);
}

// Update the AI Box with the generated sports car
aiBox.aiContentData = sportsCarData;
aiBox.aiContent = sportsCarData; // Keep both for compatibility

console.log('✅ Generated sports car for AI Box #3521');
console.log('📦 Parts:', sportsCarData.parts.length);
console.log('🎨 Features:');
console.log('   - Sleek red body with metallic finish');
console.log('   - Glowing white headlights with light cones');
console.log('   - Blinking red brake/hazard lights');
console.log('   - Chrome wheels with detailed rims');
console.log('   - Rear spoiler and exhaust pipes');
console.log('   - Side mirrors and air vents');

// Write back to save file
try {
  fs.writeFileSync(SAVE_FILE, JSON.stringify(saveData, null, 2));
  console.log('\n💾 Saved to:', SAVE_FILE);
  console.log('🔄 Reload the game to see the sports car!');
} catch (err) {
  console.error('Error writing save file:', err);
  process.exit(1);
}
