# AI Box Feature - Usage Guide

## Overview
The AI Box feature allows you to place special wireframe boxes in your Connect Four 3D world. These boxes act as **containers/markers** where you can request AI-generated 3D content that will be automatically sized and positioned to fit within the box boundaries.

**All AI content is saved automatically** using your existing save/load system (localStorage + server sync).

## How It Works

### 1. **Place an AI Box**
- Open the Edit Menu (cube edit mode)
- Look for the **🤖 AI Box (Copilot)** button (cyan/turquoise colored)
- Click it to spawn an AI Box in front of your character
- The box appears as a **cyan wireframe** with a floating label

### 2. **Resize and Position the Box**
- Select the AI Box (click on it or select from the Placed Objects list)
- Use Transform Controls to:
  - **Move** it to the desired location
  - **Scale** it to the size you want for your AI content
  - **Rotate** it if needed
- The box defines the **boundaries** for the AI-generated content

### 3. **Request AI Content**
Once your box is positioned and scaled, tell me (Copilot) what you want:

**Example prompts:**
- "Create a robot in AI Box #1234"
- "Make a simple humanoid character in that AI box"
- "Generate a tree inside AI Box #5678"
- "Put a spaceship in the selected AI box"

### 4. **AI Content Generation**
When you request content, I will:
1. Find the AI Box by its ID or label
2. Get its dimensions (scale.x, scale.y, scale.z)
3. Generate **structured data** describing the 3D object (not JSX code)
4. Scale the content to fit perfectly within the box boundaries
5. Update the box's `aiContentData` property with the structured data
6. The data is **automatically saved** to localStorage and synced to server

## Data Structure (Saves Automatically!)

### AI Box Properties
```javascript
{
  id: unique_timestamp_id,
  shape: 'box',
  isAIBox: true,                    // Flag identifying this as an AI box
  aiBoxLabel: 'AI Box #1234',       // Display label
  position: { x, y, z },            // World position
  rotation: { x, y, z },            // Rotation
  scale: { x, y, z },               // Size (boundaries for AI content)
  hasCollision: false,              // No collision by default
  color: '#22d3ee',                 // Cyan color
  opacity: 0.15,                    // Very transparent
  wireframe: true,                  // Shows as wireframe
  aiContentData: {                  // ← Structured data (gets saved!)
    type: 'robot',
    parts: [
      {
        name: 'head',
        shape: 'sphere',
        position: [0, 0.3, 0],      // Relative to box center (0-1 scale)
        scale: [0.2, 0.2, 0.2],     // Relative to box size (0-1 scale)
        rotation: [0, 0, 0],
        color: '#ffcc00',
        metalness: 0.5,
        roughness: 0.3
      },
      {
        name: 'body',
        shape: 'box',
        position: [0, 0, 0],
        scale: [0.3, 0.4, 0.25],
        color: '#3366ff'
      }
      // ... more parts
    ]
  }
}
```

### Supported Shapes
- `sphere` - Spherical geometry
- `box` - Box/cube geometry
- `cylinder` - Cylindrical geometry
- `cone` - Cone geometry
- `torus` - Torus/donut geometry

### Content Data Format
```javascript
aiContentData: {
  type: 'objectName',          // Human-readable type (robot, tree, etc.)
  parts: [                     // Array of mesh parts
    {
      name: 'partName',        // Identifier for this part
      shape: 'box|sphere|cylinder|cone|torus',
      position: [x, y, z],     // Position relative to box center (0-1 scale)
      scale: [x, y, z],        // Size relative to box size (0-1 scale)
      rotation: [x, y, z],     // Rotation in radians
      color: '#rrggbb',        // Hex color
      metalness: 0.0-1.0,      // Material metalness (optional)
      roughness: 0.0-1.0,      // Material roughness (optional)
      emissive: '#rrggbb',     // Emissive color (optional)
      emissiveIntensity: 0-1   // Emissive intensity (optional)
    }
  ]
}
```

## How AI Content is Rendered

The `AIContentRenderer` component:
1. Reads the `aiContentData` from the placed cube
2. Multiplies relative positions/scales by the box dimensions
3. Creates Three.js meshes (`<mesh>` with geometries and materials)
4. Renders them inside the box

**Example**: If the box is 20x30x15 units and a part has `scale: [0.2, 0.3, 0.2]`:
- Actual rendered size = `[20*0.2, 30*0.3, 15*0.2]` = `[4, 9, 3]` units

## Persistence & Syncing

✅ **Automatically Saved To:**
- `localStorage.cf3d_placed_cubes` (local browser storage)
- Server database (multiplayer sync)
- Game save files

✅ **Automatically Loaded From:**
- Server on game start (`window.__CF_REMOTE_CUBES__`)
- localStorage on fallback

✅ **Automatically Synced:**
- Other players see the same AI boxes and content
- Changes propagate in real-time
- Survives page refresh and game restart

## Workflow Example

1. **User**: *Places AI Box, scales it to 20x30x15 units, labels it "AI Box #7392"*
2. **User**: "Create a simple robot in AI Box #7392"
3. **Copilot**: Generates structured data:
```javascript
{
  type: 'robot',
  parts: [
    { name: 'head', shape: 'sphere', position: [0, 0.3, 0], scale: [0.2, 0.2, 0.2], color: '#ffcc00' },
    { name: 'body', shape: 'box', position: [0, 0, 0], scale: [0.3, 0.4, 0.25], color: '#3366ff' },
    { name: 'leftArm', shape: 'cylinder', position: [-0.25, 0, 0], scale: [0.05, 0.3, 0.05], color: '#3366ff' }
    // ... more parts
  ]
}
```
4. **Copilot**: Updates the cube's `aiContentData` using `updateCubeAndSync()`
5. **System**: Saves to localStorage, syncs to server, broadcasts to other players
6. **Result**: Robot appears inside the wireframe box, automatically saved!
