import React, { useMemo, useRef, useLayoutEffect, Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { OrbitControls, TransformControls, useGLTF, useFBX, useAnimations, Text, Billboard, useTexture, RoundedBox, PositionalAudio, Html } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';

// Extend Three.js to make postprocessing classes available in JSX
extend({ EffectComposer, RenderPass, UnrealBloomPass });

const COLS = 7;
const ROWS = 6;
const CELL = 1;
const GAP = 0.1;
const BOARD_THICK = 0.22;
// Terrain visual size (separate from movement boundary)
const TERRAIN_RADIUS = 450; // Size of the lunar surface terrain
// Global play area radius (controls how far avatars can roam - set very large for free exploration)
const PLAY_AREA_RADIUS = 99999; // Effectively unlimited movement
// Simple staircase parameters (world coordinates)
const STAIR_POS_X = 28;      // center X of the staircase
const STAIR_POS_Z = 0;       // bottom starts at zMin and goes toward +Z
const STAIR_WIDTH = 10;      // total width on X
const STAIR_RUN = 2.0;       // depth per step (Z)
const STAIR_RISE = 1.8;      // height per step (Y)
const STAIR_STEPS = 10;      // number of steps
const STEP_CLIMB_MAX = 6.0;  // SUPER generous auto step-up for placed stairs (was STAIR_RISE + 1.2)

// Second staircase (25% larger) on the opposite side
const STAIR2_POS_X = -28;                                        // mirrored on X
const STAIR2_POS_Z = 0;                                          // same Z origin
const STAIR2_WIDTH = STAIR_WIDTH * 1.25;                         // 25% wider
const STAIR2_RUN = STAIR_RUN * 1.25;                             // 25% deeper treads
const STAIR2_RISE = STAIR_RISE * 1.25;                           // 25% taller risers
const STAIR2_STEPS = STAIR_STEPS;                                // same number of steps
const STAIR2_PLATFORM_DEPTH = 140;                                // flat platform depth beyond the top (10x larger)
const STAIR2_PLATFORM_WIDTH = (STAIR2_WIDTH * 15);                // make the platform 15x wider than the stairs
const STAIR2_PLATFORM_THICKNESS = 1.5;                            // shared thickness so physics can reason about under/over

// Third staircase - same size as STAIR2, rotated 90° clockwise, positioned on left side of STAIR2 platform
const STAIR3_POS_X = STAIR2_POS_X - (STAIR2_PLATFORM_WIDTH / 2) + 20; // left edge of STAIR2 platform
const STAIR3_POS_Z = STAIR2_POS_Z + (STAIR2_RUN * STAIR2_STEPS) + (STAIR2_PLATFORM_DEPTH / 2); // center of platform
const STAIR3_BASE_Y = STAIR2_RISE * STAIR2_STEPS;                // start on top of STAIR2 platform
const STAIR3_WIDTH = STAIR2_WIDTH;                               // same width as STAIR2
const STAIR3_RUN = STAIR2_RUN;                                   // same run as STAIR2
const STAIR3_RISE = STAIR2_RISE;                                 // same rise as STAIR2
const STAIR3_STEPS = STAIR2_STEPS;                               // same number of steps
const STAIR3_YAW = -Math.PI / 2;                                 // rotated 90° clockwise (facing -X direction)
const STAIR3_PLATFORM_DEPTH = 140;                               // extends along -X after rotation
const STAIR3_PLATFORM_WIDTH = (STAIR3_WIDTH * 15);               // extends along Z after rotation
const STAIR3_PLATFORM_THICKNESS = 1.5;                           // same thickness

// Runtime-configurable extra-stairs collision mask (for FBX decorative stairs)
// These module-scope vars are updated by the UI/child component so our physics samplers can read them.
let EXTRA_STAIRS_DEF = null; // { posX, posZ, posY, yaw, width, depth, height, steps, run, rise, reverse }
let EXTRA_STAIRS_WALKABLE = false;
function setExtraStairsWalkable(flag){ EXTRA_STAIRS_WALKABLE = !!flag; }
function setExtraStairsDef(def){ EXTRA_STAIRS_DEF = def; }

// Runtime-configurable placed cubes/spheres (for multiplayer sync and collision)
let CURRENT_PLACED_CUBES = [];
function updatePlacedCubesCache(cubes) { 
  CURRENT_PLACED_CUBES = cubes || [];
}

// Shared terrain height calculation (matches the LunarTerrain geometry)
function getTerrainHeightXZ(x, z, flatRadius = 50, maxRadius = TERRAIN_RADIUS) {
  // SQUARE boundary check - fall off if outside square terrain
  if (Math.abs(x) > maxRadius || Math.abs(z) > maxRadius) {
    return -9999; // Far below - player will fall
  }
  
  const distFromCenter = Math.sqrt(x * x + z * z);
  
  // Keep center area flat for Connect Four table
  if (distFromCenter < flatRadius) {
    return 0;
  }
  
  // Hills get taller as we move away from center
  const hillFactor = Math.min(1, (distFromCenter - flatRadius) / (maxRadius * 0.5));
  
  // Noise functions (same as in LunarTerrain)
  const hash21 = (x, y) => {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    
    const a = hash21(ix, iy);
    const b = hash21(ix + 1, iy);
    const c = hash21(ix, iy + 1);
    const d = hash21(ix + 1, iy + 1);
    
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    return a * (1 - ux) * (1 - uy) +
           b * ux * (1 - uy) +
           c * (1 - ux) * uy +
           d * ux * uy;
  };
  
  const fbm = (x, y, octaves = 5) => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise(x * frequency, y * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  };
  
  // Generate hills using fractal noise - same exact formula as geometry
  const scale = 0.015;
  const height = fbm(x * scale, z * scale, 4) * 12 * hillFactor; // Increased from 5 to 12
  
  // Add some larger mounds
  const moundScale = 0.008;
  const mounds = fbm(x * moundScale, z * moundScale, 3) * 20 * hillFactor; // Increased from 8 to 20
  
  // Blend edge smoothly
  const edgeFactor = 1 - Math.max(0, Math.min(1, (distFromCenter - maxRadius * 0.9) / (maxRadius * 0.3)));
  
  // Sample multiple nearby points and take the maximum to avoid clipping through peaks
  const result = (height + mounds) * edgeFactor;
  const offset = 0.5; // small offset for nearby sampling
  const h1 = result;
  
  // Sample 4 nearby points and take max to catch peaks
  const hashOffset = (dx, dz) => {
    const nx = x + dx;
    const nz = z + dz;
    const nDist = Math.sqrt(nx * nx + nz * nz);
    if (nDist < flatRadius) return 0;
    const nHillFactor = Math.min(1, (nDist - flatRadius) / (maxRadius * 0.5));
    const nHeight = fbm(nx * scale, nz * scale, 4) * 12 * nHillFactor; // Increased from 5 to 12
    const nMounds = fbm(nx * moundScale, nz * moundScale, 3) * 20 * nHillFactor; // Increased from 8 to 20
    const nEdgeFactor = 1 - Math.max(0, Math.min(1, (nDist - maxRadius * 0.9) / (maxRadius * 0.3)));
    return (nHeight + nMounds) * nEdgeFactor;
  };
  
  const h2 = hashOffset(offset, 0);
  const h3 = hashOffset(-offset, 0);
  const h4 = hashOffset(0, offset);
  const h5 = hashOffset(0, -offset);
  
  // Return max to avoid going through peaks
  return Math.max(h1, h2, h3, h4, h5);
}

// Get terrain height for a generated terrain cube at position (x, z)
// EXACTLY like main terrain - no edge blending, multi-point sampling
function getGeneratedTerrainHeight(x, z, terrainCube) {
  // Check if position is within the terrain cube bounds (with small overlap for corners)
  const halfX = terrainCube.scale.x / 2;
  const halfZ = terrainCube.scale.z / 2;
  const overlap = 0.5; // Small overlap to ensure corners are always covered
  const minX = terrainCube.position.x - halfX - overlap;
  const maxX = terrainCube.position.x + halfX + overlap;
  const minZ = terrainCube.position.z - halfZ - overlap;
  const maxZ = terrainCube.position.z + halfZ + overlap;
  
  // Slightly expanded bounds prevent gaps at corners
  if (x < minX || x > maxX || z < minZ || z > maxZ) {
    return null; // Outside this terrain cube
  }
  
  // If terrain generation is not enabled, return flat top of box
  if (!terrainCube.hasTerrainNoise) {
    return terrainCube.position.y + (terrainCube.scale.y / 2);
  }
  
  // Calculate local position relative to terrain center
  const localX = x - terrainCube.position.x;
  const localZ = z - terrainCube.position.z;
  
  // Get terrain parameters
  const terrainScale = terrainCube.terrainScale || 0.015;
  const terrainHeightMultiplier = terrainCube.terrainHeightMultiplier || 8;
  const terrainMoundScale = terrainCube.terrainMoundScale || 0.008;
  const terrainMoundMultiplier = terrainCube.terrainMoundMultiplier || 15;
  const terrainOctaves = terrainCube.terrainOctaves || 4;
  
  // Noise functions (same as main terrain)
  const hash21 = (x, y) => {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    
    const a = hash21(ix, iy);
    const b = hash21(ix + 1, iy);
    const c = hash21(ix, iy + 1);
    const d = hash21(ix + 1, iy + 1);
    
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    return a * (1 - ux) * (1 - uy) +
           b * ux * (1 - uy) +
           c * (1 - ux) * uy +
           d * ux * uy;
  };
  
  const fbm = (x, y, octaves) => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * noise(x * frequency, y * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    
    return value;
  };
  
  // Generate BASE terrain height (before edge blending)
  const height = fbm(localX * terrainScale, localZ * terrainScale, terrainOctaves) * terrainHeightMultiplier;
  const mounds = fbm(localX * terrainMoundScale, localZ * terrainMoundScale, 3) * terrainMoundMultiplier;
  
  const result = height + mounds;
  const offset = 0.5; // small offset for nearby sampling
  const h1 = result;
  
  // Multi-point sampling - Sample 4 nearby points and take max to catch peaks
  const hashOffset = (dx, dz) => {
    const nx = x + dx;
    const nz = z + dz;
    // Check bounds
    if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) return result;
    
    const nLocalX = nx - terrainCube.position.x;
    const nLocalZ = nz - terrainCube.position.z;
    const nHeight = fbm(nLocalX * terrainScale, nLocalZ * terrainScale, terrainOctaves) * terrainHeightMultiplier;
    const nMounds = fbm(nLocalX * terrainMoundScale, nLocalZ * terrainMoundScale, 3) * terrainMoundMultiplier;
    return nHeight + nMounds;
  };
  
  const h2 = hashOffset(offset, 0);
  const h3 = hashOffset(-offset, 0);
  const h4 = hashOffset(0, offset);
  const h5 = hashOffset(0, -offset);
  
  // Take max to avoid going through peaks
  let finalHeight = Math.max(h1, h2, h3, h4, h5);
  
  // EDGE BLENDING - Match visual mesh behavior (critical for corners!)
  if (terrainCube.snappedEdges && typeof CURRENT_PLACED_CUBES !== 'undefined') {
    const maxDistX = halfX;
    const maxDistZ = halfZ;
    const normalizedX = Math.abs(localX) / maxDistX;
    const normalizedZ = Math.abs(localZ) / maxDistZ;
    const blendZone = 0.20; // 20% edge blend zone (MUST match visual mesh)
    
    const edgeBlends = [];
    
    // Helper to get neighbor's edge height at this position
    const getNeighborEdgeHeight = (edge) => {
      const neighborId = terrainCube.snappedEdges[edge];
      if (!neighborId) return null;
      
      const neighbor = CURRENT_PLACED_CUBES.find(c => c.id === neighborId);
      if (!neighbor || !neighbor.savedEdgeHeights) return null;
      
      const edgeMap = { 'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east' };
      const neighborEdge = edgeMap[edge];
      const neighborEdgeData = neighbor.savedEdgeHeights[neighborEdge];
      if (!neighborEdgeData || neighborEdgeData.length === 0) return null;
      
      // Transform to neighbor's local space
      const worldOffsetX = terrainCube.position.x - neighbor.position.x;
      const worldOffsetZ = terrainCube.position.z - neighbor.position.z;
      const searchX = localX - worldOffsetX;
      const searchZ = localZ - worldOffsetZ;
      
      // Find closest saved point
      let closestHeight = null;
      let minDist = Infinity;
      for (const saved of neighborEdgeData) {
        const dist = (edge === 'north' || edge === 'south') 
          ? Math.abs(saved.localX - searchX)
          : Math.abs(saved.localZ - searchZ);
        if (dist < minDist) {
          minDist = dist;
          closestHeight = saved.height;
        }
      }
      return closestHeight;
    };
    
    // Check each edge for blending
    if (terrainCube.snappedEdges.north && localZ > 0 && normalizedZ > (1 - blendZone)) {
      const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('north');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.south && localZ < 0 && normalizedZ > (1 - blendZone)) {
      const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('south');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.east && localX > 0 && normalizedX > (1 - blendZone)) {
      const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('east');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    if (terrainCube.snappedEdges.west && localX < 0 && normalizedX > (1 - blendZone)) {
      const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
      const neighborHeight = getNeighborEdgeHeight('west');
      if (neighborHeight !== null) edgeBlends.push({ blendFactor, neighborHeight });
    }
    
    // Apply blending (at corners, average neighbor heights for smooth transition)
    if (edgeBlends.length > 0) {
      let targetHeight, blendFactor;
      
      if (edgeBlends.length === 1) {
        // Single edge: blend to that neighbor
        targetHeight = edgeBlends[0].neighborHeight;
        blendFactor = edgeBlends[0].blendFactor;
      } else {
        // Corner (multiple edges): average the neighbor heights and use max blend factor
        // This ensures both edges converge to the same averaged height at the corner
        const avgHeight = edgeBlends.reduce((sum, e) => sum + e.neighborHeight, 0) / edgeBlends.length;
        const maxBlend = Math.max(...edgeBlends.map(e => e.blendFactor));
        targetHeight = avgHeight;
        blendFactor = maxBlend;
      }
      
      const smoothBlend = blendFactor * blendFactor * (3 - 2 * blendFactor);
      finalHeight = finalHeight * (1 - smoothBlend) + targetHeight * smoothBlend;
    }
  }
  
  // Apply sculpting modifications
  if (terrainCube.heightModifications && terrainCube.heightModifications.length > 0) {
    for (const mod of terrainCube.heightModifications) {
      const dx = localX - mod.x;
      const dz = localZ - mod.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < mod.radius) {
        const falloff = 1 - (distance / mod.radius);
        const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
        const heightChange = mod.delta * smoothFalloff;
        finalHeight += heightChange;
      }
    }
  }
  
  // Return floor top + terrain height
  return terrainCube.position.y + (terrainCube.scale.y / 2) + finalHeight;
}

function getGroundHeightXZ(wx, wz) {
  // Compute the top surface height beneath (wx,wz) for both staircases and the large top platform
  const sampleStair = (posX, posZ, width, run, rise, steps, platformDepth = 0, platformWidth = null) => {
    const totalLen = steps * run;
    const halfW = width / 2;
    const zMin = posZ;
    const zMax = zMin + totalLen;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    // On steps
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      const dz = wz - zMin;
      const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(dz / run)));
      return (stepIndex + 1) * rise;
    }
    // On platform beyond the top (flat)
    if (platformDepth > 0) {
      const platZMin = zMax;
      const platZMax = zMax + platformDepth;
      const halfPlatW = (platformWidth != null ? platformWidth : width) / 2;
      const pxMin = posX - halfPlatW;
      const pxMax = posX + halfPlatW;
      if (wx >= pxMin && wx <= pxMax && wz >= platZMin && wz <= platZMax) {
        return steps * rise;
      }
    }
    return 0;
  };
  // Only stair2 - stair1 completely removed
  const h2 = sampleStair(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS, STAIR2_PLATFORM_DEPTH, STAIR2_PLATFORM_WIDTH);
  
  // Check if we're within the main terrain bounds (SQUARE boundary)
  const onMainTerrain = Math.abs(wx) <= TERRAIN_RADIUS && Math.abs(wz) <= TERRAIN_RADIUS;
  
  if (onMainTerrain) {
    // On main terrain - use main terrain height, ignore generated terrain below
    const terrainHeight = getTerrainHeightXZ(wx, wz);
    
    // If on stairs, use stair height, otherwise use terrain
    if (h2 > 0) {
      return h2;
    }
    
    return terrainHeight;
  } else {
    // OFF main terrain - check for generated terrain cubes to land on
    if (typeof CURRENT_PLACED_CUBES !== 'undefined' && CURRENT_PLACED_CUBES.length > 0) {
      for (const cube of CURRENT_PLACED_CUBES) {
        if (cube.isTerrain && cube.hasTerrainNoise) {
          const generatedHeight = getGeneratedTerrainHeight(wx, wz, cube);
          if (generatedHeight !== null) {
            // Found generated terrain at this position
            return generatedHeight;
          }
        }
      }
    }
    
    // No terrain found - return very low value so player falls
    return -9999;
  }
}

function getGroundHeightXZAtY(wx, wz, worldY) {
  // Base ground Y used by the scene
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;

  // Stairs-only sampler (no platform)
  const sampleStairOnly = (posX, posZ, width, run, rise, steps) => {
    const totalLen = steps * run;
    const halfW = width / 2;
    const zMin = posZ;
    const zMax = zMin + totalLen;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      const dz = wz - zMin;
      const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(dz / run)));
      return (stepIndex + 1) * rise;
    }
    return 0;
  };

  // Flat platform beyond Stair 2
  const samplePlatform = (posX, posZ, width, depth, rise, steps) => {
    const stairsLen = steps * STAIR2_RUN; // use Stair 2 run for its platform extent
    const zMin = posZ + stairsLen;
    const zMax = zMin + depth;
    const halfW = width / 2;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      return steps * rise;
    }
    return 0;
  };

  // Built-in stairs - only stair2 (stair1 removed)
  const h2 = sampleStairOnly(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS);
  let maxH = Math.max(h2, 0);

  // Optional extra (decorative) stairs if configured as walkable
  if (EXTRA_STAIRS_WALKABLE && EXTRA_STAIRS_DEF) {
    try {
      const { posX, posZ, posY = 0, yaw = 0, width, depth, steps, run, rise, reverse } = EXTRA_STAIRS_DEF;
      const halfW = width / 2;
      const halfD = depth / 2;
      // Transform world to stairs-local
      const dx = wx - posX;
      const dz = wz - posZ;
      const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (lx >= -halfW && lx <= halfW && lz >= -halfD && lz <= halfD) {
        let lz01 = lz + halfD; // [0, depth]
        if (reverse) lz01 = depth - lz01;
        const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(lz01 / run)));
        const hExtra = (stepIndex + 1) * rise;
        maxH = Math.max(maxH, posY + hExtra);
      }
    } catch {}
  }

  // Third staircase - rotated 90° clockwise (goes in -X direction from origin)
  const sampleStair3Rotated = () => {
    const halfW = STAIR3_WIDTH / 2;
    const zMin = STAIR3_POS_Z - halfW;
    const zMax = STAIR3_POS_Z + halfW;
    const xMax = STAIR3_POS_X;
    const xMin = xMax - (STAIR3_STEPS * STAIR3_RUN);
    if (wz >= zMin && wz <= zMax && wx >= xMin && wx <= xMax) {
      const dx = xMax - wx; // distance from start going in -X direction
      const stepIndex = Math.max(0, Math.min(STAIR3_STEPS - 1, Math.floor(dx / STAIR3_RUN)));
      return (stepIndex + 1) * STAIR3_RISE;
    }
    return 0;
  };
  const h3 = sampleStair3Rotated();
  if (h3 > 0) {
    maxH = Math.max(maxH, STAIR3_BASE_Y + h3);
  }

  // Third platform - rotated 90°, extends in -X direction beyond stairs
  const samplePlatform3Rotated = () => {
    const stairsLen = STAIR3_STEPS * STAIR3_RUN;
    const xMax = STAIR3_POS_X - stairsLen;
    const xMin = xMax - STAIR3_PLATFORM_DEPTH;
    const halfW = STAIR3_PLATFORM_WIDTH / 2;
    const zMin = STAIR3_POS_Z - halfW;
    const zMax = STAIR3_POS_Z + halfW;
    if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) {
      return STAIR3_STEPS * STAIR3_RISE;
    }
    return 0;
  };
  
  // Sample placed stairs2 - EXACT same ground sampling as STAIR3
  const samplePlacedStairs2 = () => {
    const cubes = CURRENT_PLACED_CUBES || [];
    let maxStairH = 0;
    for (const cube of cubes) {
      if (cube.modelType !== 'stairs2' || !cube.hasCollision) continue;
      
      const width = STAIR2_WIDTH * (cube.scale.x || 1);
      const run = STAIR2_RUN * (cube.scale.z || 1);
      const rise = STAIR2_RISE * (cube.scale.y || 1);
      const steps = STAIR2_STEPS;
      const posX = cube.position.x || 0;
      const posY = cube.position.y || 0;
      const posZ = cube.position.z || 0;
      const rotY = cube.rotation.y || 0;
      
      // Calculate baseY (same as makeForPlacedStairs2)
      const fh = ROWS * (CELL + GAP) - GAP + 0.6;
      const groundY = -fh / 2 - GROUND_CLEAR;
      const baseY = posY - groundY;
      
      const cos = Math.cos(-rotY);
      const sin = Math.sin(-rotY);
      
      // Transform world to local
      const dx = wx - posX;
      const dz = wz - posZ;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      
      // Check bounds (relaxed like STAIR2/STAIR3 with extra margin)
      const halfW = width / 2;
      const totalLen = steps * run;
      const margin = run * 0.75; // extra margin like STAIR2/STAIR3
      if (lx >= -halfW && lx <= halfW && lz >= -margin && lz <= totalLen + margin) {
        // Clamp to actual stair range for step calculation
        const clampedLz = Math.max(0, Math.min(totalLen, lz));
        const stepIndex = Math.max(0, Math.min(steps - 1, Math.floor(clampedLz / run)));
        const localHeight = (stepIndex + 1) * rise;
        // Return baseY + localHeight (same pattern as STAIR3_BASE_Y + h3)
        maxStairH = Math.max(maxStairH, baseY + localHeight);
      }
    }
    return maxStairH;
  };
  const placedStairsH = samplePlacedStairs2();
  if (placedStairsH > 0) {
    maxH = Math.max(maxH, placedStairsH);
  }
  
  // STAIR3 Platform and STAIR2 Platform
  const hp3 = samplePlatform3Rotated();
  const stair3Height = hp3 > 0 ? STAIR3_BASE_Y + hp3 : 0;
  
  const hp = samplePlatform(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_PLATFORM_WIDTH, STAIR2_PLATFORM_DEPTH, STAIR2_RISE, STAIR2_STEPS);
  const stair2Height = hp > 0 ? hp : 0;
  
  // Only use platform height if you're above it (not walking underneath)
  // This prevents snapping up when walking under platforms
  const PLATFORM_UNDERPASS_THRESHOLD = 5.0; // height clearance for walking under
  
  if (stair3Height > 0) {
    const platformTopWorldY = groundY + stair3Height;
    // Only use this platform if we're close to or above its top surface
    if (worldY >= platformTopWorldY - PLATFORM_UNDERPASS_THRESHOLD) {
      maxH = Math.max(maxH, stair3Height);
    }
  }
  if (stair2Height > 0) {
    const platformTopWorldY = groundY + stair2Height;
    // Only use this platform if we're close to or above its top surface
    if (worldY >= platformTopWorldY - PLATFORM_UNDERPASS_THRESHOLD) {
      maxH = Math.max(maxH, stair2Height);
    }
  }

  // Check if on Connect Four table top platform
  try {
    const tableData = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
    const tableTopY = (typeof window !== 'undefined' && Number.isFinite(window.__CF_TABLE_TOP_Y__))
      ? Number(window.__CF_TABLE_TOP_Y__)
      : groundY + 37.0;
    
    if (tableData && Number.isFinite(tableData.minX) && Number.isFinite(tableData.maxX) && 
        Number.isFinite(tableData.minZ) && Number.isFinite(tableData.maxZ)) {
      const minX = tableData.minX;
      const maxX = tableData.maxX;
      const minZ = tableData.minZ;
      const maxZ = tableData.maxZ;
      
      // Check if position is on the table
      if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
        const tableHeight = tableTopY - groundY;
        // Only use table height if we're close to or above its top surface
        if (worldY >= tableTopY - PLATFORM_UNDERPASS_THRESHOLD) {
          maxH = Math.max(maxH, tableHeight);
        }
      }
    }
  } catch {}

  // Check if on placed sphere/cylinder/cube with walkableTop enabled
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    for (const cube of cubes) {
      if (cube.hasCollision && cube.walkableTop) {
        if (cube.shape === 'sphere') {
          // Sphere: calculate curved surface height based on distance from center
          const visualRadius = (((cube.scale.x || 5) + (cube.scale.y || 5) + (cube.scale.z || 5)) / 3 * 0.5);
          const centerX = cube.position.x || 0;
          const centerY = cube.position.y || 0;
          const centerZ = cube.position.z || 0;
          
          const dx = wx - centerX;
          const dz = wz - centerZ;
          const distFromCenterXZ = Math.sqrt(dx * dx + dz * dz);
          
          // Only walk on sphere if within horizontal radius
          if (distFromCenterXZ <= visualRadius) {
            // Calculate Y height on sphere surface using Pythagorean theorem
            // For a sphere: x² + y² + z² = r²
            // So: y = sqrt(r² - x² - z²)
            const distSqXZ = dx * dx + dz * dz;
            const radiusSq = visualRadius * visualRadius;
            const yOnSphere = Math.sqrt(Math.max(0, radiusSq - distSqXZ));
            const surfaceY = centerY + yOnSphere; // Y position on top of sphere
            
            const sphereHeight = surfaceY - groundY;
            // Only use this height if we're close to or above the surface
            if (worldY >= surfaceY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, sphereHeight);
            }
          }
        } else if (cube.shape === 'cylinder') {
          // Cylinder: flat top (not curved)
          const visualRadius = ((cube.scale.x || 5) * 0.5);
          const centerX = cube.position.x || 0;
          const centerZ = cube.position.z || 0;
          const topY = (cube.position.y || 0) + (cube.scale.y || 5) * 0.5;
          
          const dx = wx - centerX;
          const dz = wz - centerZ;
          const distSq = dx * dx + dz * dz;
          
          if (distSq <= (visualRadius * visualRadius)) {
            const cylinderHeight = topY - groundY;
            if (worldY >= topY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, cylinderHeight);
            }
          }
        } else {
          // Cube: rectangular bounds check
          const halfX = (cube.scale.x || 5) / 2;
          const halfY = (cube.scale.y || 5) / 2;
          const halfZ = (cube.scale.z || 5) / 2;
          const centerX = cube.position.x || 0;
          const centerZ = cube.position.z || 0;
          const topY = (cube.position.y || 0) + halfY;
          
          // Check if position is within horizontal bounds (rectangular check)
          if (wx >= centerX - halfX && wx <= centerX + halfX &&
              wz >= centerZ - halfZ && wz <= centerZ + halfZ) {
            const cubeHeight = topY - groundY;
            // Only use this height if we're close to or above its top surface
            if (worldY >= topY - PLATFORM_UNDERPASS_THRESHOLD) {
              maxH = Math.max(maxH, cubeHeight);
            }
          }
        }
      }
    }
  } catch {}
  
  // Check for generated terrain cubes with terrain noise (ALWAYS check, not just walkableTop)
  let foundGeneratedTerrain = false;
  let generatedTerrainHeight = null;
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    
    // Check ALL terrain cubes and take the MAXIMUM height (handles overlapping corners)
    for (const cube of cubes) {
      if (cube.isTerrain && cube.hasTerrainNoise) {
        const genHeight = getGeneratedTerrainHeight(wx, wz, cube);
        if (genHeight !== null) {
          const terrainHeightFromGround = genHeight - groundY;
          // At corners where multiple terrains overlap, use the HIGHEST terrain
          if (!foundGeneratedTerrain || terrainHeightFromGround > generatedTerrainHeight) {
            generatedTerrainHeight = terrainHeightFromGround;
            foundGeneratedTerrain = true;
          }
        }
      }
    }
  } catch {}

  // Always sample main terrain height
  const terrainHeight = getTerrainHeightXZ(wx, wz);
  
  // If off main terrain, use generated terrain if found
  if (terrainHeight === -9999) {
    if (foundGeneratedTerrain) {
      return generatedTerrainHeight;
    }
    // No surfaces found - fall
    return -9999;
  }
  
  // On main terrain - use highest surface
  if (foundGeneratedTerrain) {
    return Math.max(maxH, terrainHeight, generatedTerrainHeight);
  }
  
  return Math.max(maxH, terrainHeight);
}

// Debug toggle for showing collision boxes - moved to component state (showCollisionMeshes)

function buildStairAABBsWorld() {
  // Returns an array of {min:{x,y,z}, max:{x,y,z}} in world coordinates for both staircases
  const makeFor = (posX, posZ, width, run, rise, steps, baseY = 0) => {
    const aabbs = [];
    const halfW = width / 2;
    const xMin = posX - halfW;
    const xMax = posX + halfW;
    // World ground Y
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    for (let i = 0; i < steps; i++) {
      const zStart = posZ + i * run;
      const zEnd = zStart + run;
      const y0 = baseY + i * rise;
      const y1 = y0 + rise;
      aabbs.push({
        min: { x: xMin, y: groundY + y0, z: zStart },
        max: { x: xMax, y: groundY + y1, z: zEnd },
        idx: i,
      });
    }
    return aabbs;
  };
  
  // Rotated version for STAIR3 (goes in -X direction)
  const makeForRotated90 = (posX, posZ, width, run, rise, steps, baseY = 0) => {
    const aabbs = [];
    const halfW = width / 2;
    const zMin = posZ - halfW;
    const zMax = posZ + halfW;
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    for (let i = 0; i < steps; i++) {
      const xStart = posX - i * run;      // going in -X direction
      const xEnd = xStart - run;          // end is further in -X
      const y0 = baseY + i * rise;
      const y1 = y0 + rise;
      aabbs.push({
        min: { x: Math.min(xStart, xEnd), y: groundY + y0, z: zMin },
        max: { x: Math.max(xStart, xEnd), y: groundY + y1, z: zMax },
        idx: i,
        stair3: true, // mark for debugging
      });
    }
    return aabbs;
  };
  
  // Helper for placed stairs2 models - EXACT same as makeFor + rails (with groundY calculation like STAIR3)
  const makeForPlacedStairs2 = (cube) => {
    const aabbs = [];
    const width = STAIR2_WIDTH * (cube.scale.x || 1);
    const run = STAIR2_RUN * (cube.scale.z || 1);
    const rise = STAIR2_RISE * (cube.scale.y || 1);
    const steps = STAIR2_STEPS;
    const posX = cube.position.x || 0;
    const posY = cube.position.y || 0; // This is world space, will convert to baseY
    const posZ = cube.position.z || 0;
    const rotY = cube.rotation.y || 0;
    const halfW = width / 2;
    const railWidth = 0.8; // same as STAIR2/STAIR3
    const railHeight = 16.0; // 2x taller for better containment (was 8.0)
    const railInset = -1.5; // Negative = inset from edge (was 0.45 outside)
    
    // Calculate groundY same as makeFor/makeForRotated90
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY = -fh / 2 - GROUND_CLEAR;
    
    // Convert world posY to baseY (offset from ground)
    const baseY = posY - groundY;
    
    // No rotation - use simple boxes like makeFor
    if (Math.abs(rotY) < 0.01) {
      const xMin = posX - halfW;
      const xMax = posX + halfW;
      // Step boxes (EXACT same formula as makeFor/STAIR2)
      for (let i = 0; i < steps; i++) {
        const zStart = posZ + i * run;
        const zEnd = zStart + run;
        const y0 = baseY + i * rise;
        const y1 = y0 + rise;
        aabbs.push({
          min: { x: xMin, y: groundY + y0, z: zStart },
          max: { x: xMax, y: groundY + y1, z: zEnd },
          idx: i,
        });
      }
      // Rail boxes (OUTSIDE the stairs like STAIR2/STAIR3) - use platform edge collision for smooth sliding
      const leftX = posX - halfW - railInset;
      const rightX = posX + halfW + railInset;
      for (let i = 0; i < steps; i++) {
        const zStart = posZ + i * run;
        const zEnd = zStart + run;
        const yBase = groundY + baseY + i * rise;
        
        aabbs.push({
          min: { x: leftX - railWidth/2, y: yBase, z: zStart },
          max: { x: leftX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        aabbs.push({
          min: { x: rightX - railWidth/2, y: yBase, z: zStart },
          max: { x: rightX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2 + 1,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    } else {
      // With rotation - transform corners (EXACT same formula as STAIR3)
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      // Step boxes
      for (let i = 0; i < steps; i++) {
        const zStart = i * run;
        const zEnd = zStart + run;
        const y0 = baseY + i * rise;
        const y1 = y0 + rise;
        
        const corners = [
          [-halfW, zStart], [halfW, zStart],
          [halfW, zEnd], [-halfW, zEnd],
        ];
        
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [lx, lz] of corners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minX = Math.min(minX, wx);
          maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz);
          maxZ = Math.max(maxZ, wz);
        }
        
        aabbs.push({
          min: { x: minX, y: groundY + y0, z: minZ },
          max: { x: maxX, y: groundY + y1, z: maxZ },
          idx: i,
        });
      }
      // Rail boxes (OUTSIDE the stairs, with rotation - EXACT same as STAIR3)
      const leftXLocal = -halfW - railInset;
      const rightXLocal = halfW + railInset;
      for (let i = 0; i < steps; i++) {
        const zStart = i * run;
        const zEnd = zStart + run;
        const yBase = groundY + baseY + i * rise;
        
        // Left rail
        const leftCorners = [
          [leftXLocal - railWidth/2, zStart], [leftXLocal + railWidth/2, zStart],
          [leftXLocal + railWidth/2, zEnd], [leftXLocal - railWidth/2, zEnd],
        ];
        
        let minXL = Infinity, minZL = Infinity, maxXL = -Infinity, maxZL = -Infinity;
        for (const [lx, lz] of leftCorners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minXL = Math.min(minXL, wx);
          maxXL = Math.max(maxXL, wx);
          minZL = Math.min(minZL, wz);
          maxZL = Math.max(maxZL, wz);
        }
        
        aabbs.push({
          min: { x: minXL, y: yBase, z: minZL },
          max: { x: maxXL, y: yBase + railHeight, z: maxZL },
          idx: 9100 + i * 2,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        // Right rail
        const rightCorners = [
          [rightXLocal - railWidth/2, zStart], [rightXLocal + railWidth/2, zStart],
          [rightXLocal + railWidth/2, zEnd], [rightXLocal - railWidth/2, zEnd],
        ];
        
        let minXR = Infinity, minZR = Infinity, maxXR = -Infinity, maxZR = -Infinity;
        for (const [lx, lz] of rightCorners) {
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          minXR = Math.min(minXR, wx);
          maxXR = Math.max(maxXR, wx);
          minZR = Math.min(minZR, wz);
          maxZR = Math.max(maxZR, wz);
        }
        
        aabbs.push({
          min: { x: minXR, y: yBase, z: minZR },
          max: { x: maxXR, y: yBase + railHeight, z: maxZR },
          idx: 9100 + i * 2 + 1,
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    }
    return aabbs;
  };
  
  const boxes = [
    // Stairs1 completely removed
    // Stairs2 (active)
    ...makeFor(STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS),
    // Stairs3 (rotated 90°, starts on top of STAIR2 platform)
    ...makeForRotated90(STAIR3_POS_X, STAIR3_POS_Z, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS, STAIR3_BASE_Y),
  ];

  // Optionally add AABBs for the extra FBX stairs by bounding the rotated step prisms
  if (EXTRA_STAIRS_WALKABLE && EXTRA_STAIRS_DEF) {
    try {
      const { posX, posZ, posY = 0, yaw, width, depth, steps, run, rise, reverse } = EXTRA_STAIRS_DEF;
      const halfW = width / 2;
      const halfD = depth / 2;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      // World ground Y
      const fh = ROWS * (CELL + GAP) - GAP + 0.6;
      const groundY = -fh / 2 - GROUND_CLEAR;
      for (let i = 0; i < steps; i++) {
        const zStartLocal = reverse ? (halfD - (i + 1) * run) : (-halfD + i * run);
        const zEndLocal   = zStartLocal + run;
        const y0 = i * rise;
        const y1 = y0 + rise;
        // 4 local XY corners for bottom/top faces
        const localCorners = [
          [-halfW, zStartLocal],
          [ halfW, zStartLocal],
          [ halfW, zEndLocal],
          [-halfW, zEndLocal],
        ];
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [lx, lz] of localCorners) {
          // rotate and translate into world XZ
          const wx = posX + lx * cos - lz * sin;
          const wz = posZ + lx * sin + lz * cos;
          if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
          if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
        }
        boxes.push({
          min: { x: minX, y: groundY + posY + y0, z: minZ },
          max: { x: maxX, y: groundY + posY + y1, z: maxZ },
          idx: i,
          extra: true,
        });
      }
    } catch {}
  }
  
  // Add rail collision boxes (not walls) alongside stairs
  try {
    const fh2 = ROWS * (CELL + GAP) - GAP + 0.6;
    const groundY2 = -fh2 / 2 - GROUND_CLEAR;
    
    // Rail box dimensions
    const railWidth = 0.8;  // width of the rail post/box
    const railHeight = 16.0; // 2x taller for better containment (was 8.0)
    
    // Stair 1 rails removed - only keeping Stair 2 rails
    
    // Stair 2 rails (long stairs)
    {
      const railInset = -1.5; // Negative = inset from edge (was 0.45 outside)
      const leftX = STAIR2_POS_X - STAIR2_WIDTH/2 - railInset;
      const rightX = STAIR2_POS_X + STAIR2_WIDTH/2 + railInset;
      
      // Create rail boxes along the stairs
      for (let i = 0; i < STAIR2_STEPS; i++) {
        const zStart = STAIR2_POS_Z + i * STAIR2_RUN;
        const zEnd = zStart + STAIR2_RUN;
        const yBase = groundY2 + i * STAIR2_RISE;
        
        // Left rail box
        boxes.push({
          min: { x: leftX - railWidth/2, y: yBase, z: zStart },
          max: { x: leftX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2, // unique index for left rail
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
        
        // Right rail box
        boxes.push({
          min: { x: rightX - railWidth/2, y: yBase, z: zStart },
          max: { x: rightX + railWidth/2, y: yBase + railHeight, z: zEnd },
          idx: 9100 + i * 2 + 1, // unique index for right rail
          isRailBox: true,
          isPlatformEdge: true // Use platform edge collision (post-movement clamping)
        });
      }
    }
    
    // Stair 3 rails (rotated 90° - goes in -X direction)
    {
      const railInset = -1.5; // Negative = inset from edge (2x taller rails)
      const leftZ = STAIR3_POS_Z - STAIR3_WIDTH/2 - railInset;
      const rightZ = STAIR3_POS_Z + STAIR3_WIDTH/2 + railInset;
      
      // Create rail boxes along the stairs (going in -X direction)
      for (let i = 0; i < STAIR3_STEPS; i++) {
        const xStart = STAIR3_POS_X - i * STAIR3_RUN;
        const xEnd = xStart - STAIR3_RUN;
        const yBase = groundY2 + STAIR3_BASE_Y + i * STAIR3_RISE;
        
        // Left rail box (along leftZ)
        boxes.push({
          min: { x: Math.min(xStart, xEnd), y: yBase, z: leftZ - railWidth/2 },
          max: { x: Math.max(xStart, xEnd), y: yBase + railHeight, z: leftZ + railWidth/2 },
          idx: 9200 + i * 2, // unique index for left rail
          isRailBox: true,
          isPlatformEdge: true, // Use platform edge collision (post-movement clamping)
          stair3: true
        });
        
        // Right rail box (along rightZ)
        boxes.push({
          min: { x: Math.min(xStart, xEnd), y: yBase, z: rightZ - railWidth/2 },
          max: { x: Math.max(xStart, xEnd), y: yBase + railHeight, z: rightZ + railWidth/2 },
          idx: 9200 + i * 2 + 1, // unique index for right rail
          isRailBox: true,
          isPlatformEdge: true, // Use platform edge collision (post-movement clamping)
          stair3: true
        });
      }
    }
    
    // Add platform collision boxes for visualization and edge detection
    
    // STAIR2 Platform
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platWidth = STAIR2_PLATFORM_WIDTH;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      
      boxes.push({
        min: { 
          x: STAIR2_POS_X - platWidth/2, 
          y: stair2TopY - platThickness, 
          z: stair2TopZ 
        },
        max: { 
          x: STAIR2_POS_X + platWidth/2, 
          y: stair2TopY, 
          z: stair2TopZ + platDepth 
        },
        idx: 9300,
        isPlatform: true
      });
    }
    
    // STAIR3 Platform (rotated - extends in -X direction)
    {
      const stair3TopY = groundY2 + STAIR3_BASE_Y + STAIR3_STEPS * STAIR3_RISE;
      const stair3TopX = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN;
      const plat3Depth = STAIR3_PLATFORM_DEPTH;
      const plat3Width = STAIR3_PLATFORM_WIDTH;
      const plat3Thickness = STAIR3_PLATFORM_THICKNESS;
      
      boxes.push({
        min: { 
          x: stair3TopX - plat3Depth, 
          y: stair3TopY - plat3Thickness, 
          z: STAIR3_POS_Z - plat3Width/2 
        },
        max: { 
          x: stair3TopX, 
          y: stair3TopY, 
          z: STAIR3_POS_Z + plat3Width/2 
        },
        idx: 9301,
        isPlatform: true,
        stair3: true
      });
    }
    
    // Platform edge walls - match railing height, start at platform bottom
    const edgeThickness = 1.0; // wall thickness
    const railingHeight = 7.0; // match the railing post height
    
    // STAIR2 Platform Edges
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      const platformBottomY = stair2TopY - platThickness; // start walls at platform bottom
      const wallTopY = stair2TopY + railingHeight; // extend up to match railing height
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platWidth = STAIR2_PLATFORM_WIDTH;
      const xMin = STAIR2_POS_X - platWidth/2;
      const xMax = STAIR2_POS_X + platWidth/2;
      const zMin = stair2TopZ;
      const zMax = stair2TopZ + platDepth;
      // NO FRONT EDGE - stairs enter here
      
      // Back edge (far from stairs)
      boxes.push({
        min: { x: xMin - edgeThickness, y: platformBottomY, z: zMax },
        max: { x: xMax + edgeThickness, y: wallTopY, z: zMax + edgeThickness },
        idx: 9311,
        isPlatformEdge: true
      });
      
      // Left edge - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platformBottomY, z: zMin },
        max: { x: xMin, y: wallTopY, z: zMax + edgeThickness },
        idx: 9312,
        isPlatformEdge: true
      });
      
      // Right edge - extend to overlap with back wall
      boxes.push({
        min: { x: xMax, y: platformBottomY, z: zMin },
        max: { x: xMax + edgeThickness, y: wallTopY, z: zMax + edgeThickness },
        idx: 9313,
        isPlatformEdge: true
      });
    }
    
    // STAIR3 Platform Edges (rotated)
    {
      const stair3TopY = groundY2 + STAIR3_BASE_Y + STAIR3_STEPS * STAIR3_RISE;
      const plat3Thickness = STAIR3_PLATFORM_THICKNESS;
      const platform3BottomY = stair3TopY - plat3Thickness; // start walls at platform bottom
      const wall3TopY = stair3TopY + railingHeight; // extend up to match railing height
      const stair3TopX = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN;
      const plat3Depth = STAIR3_PLATFORM_DEPTH;
      const plat3Width = STAIR3_PLATFORM_WIDTH;
      const xMin = stair3TopX - plat3Depth;
      const xMax = stair3TopX;
      const zMin = STAIR3_POS_Z - plat3Width/2;
      const zMax = STAIR3_POS_Z + plat3Width/2;
      // NO FRONT EDGE (+X side) - stairs enter here
      
      // Back edge (far from stairs, -X side) - extend to overlap with side walls
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMin - edgeThickness },
        max: { x: xMin, y: wall3TopY, z: zMax + edgeThickness },
        idx: 9321,
        isPlatformEdge: true,
        stair3: true
      });
      
      // Left edge (-Z side) - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMin - edgeThickness },
        max: { x: xMax, y: wall3TopY, z: zMin },
        idx: 9322,
        isPlatformEdge: true,
        stair3: true
      });
      
      // Right edge (+Z side) - extend to overlap with back wall
      boxes.push({
        min: { x: xMin - edgeThickness, y: platform3BottomY, z: zMax },
        max: { x: xMax, y: wall3TopY, z: zMax + edgeThickness },
        idx: 9323,
        isPlatformEdge: true,
        stair3: true
      });
    }
    
    // Rocket pedestal circular collision wall
    {
      const stair2TopY = groundY2 + STAIR2_STEPS * STAIR2_RISE;
      const platThickness = STAIR2_PLATFORM_THICKNESS;
      const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
      const platDepth = STAIR2_PLATFORM_DEPTH;
      const platCenterZ = stair2TopZ + platDepth / 2;
      // Rocket collision removed - now moves with rocket as child
    }
    
    // Connect Four Table Collision Box (one thick solid cube)
    {
      // Get table dimensions from window global (set by WoodenTable loader)
      const tableData = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
      const tableTopY = (typeof window !== 'undefined' && Number.isFinite(window.__CF_TABLE_TOP_Y__))
        ? Number(window.__CF_TABLE_TOP_Y__)
        : groundY2 + 37.0;
      
      if (tableData && Number.isFinite(tableData.minX) && Number.isFinite(tableData.maxX) && 
          Number.isFinite(tableData.minZ) && Number.isFinite(tableData.maxZ)) {
        const minX = tableData.minX;
        const maxX = tableData.maxX;
        const minZ = tableData.minZ;
        const maxZ = tableData.maxZ;
        const tableBottomY = groundY2;
        const wallTopY = tableTopY;
        
        // One thick solid collision box
        boxes.push({
          min: { x: minX, y: tableBottomY, z: minZ },
          max: { x: maxX, y: wallTopY, z: maxZ },
          idx: 9501,
          isPlatformEdge: true,
          isTableBox: true,
          walkableTop: true // Always allow standing on the Connect Four table
        });
      }
    }
  } catch {}
  
  // Add placed cubes and spheres with collision enabled (use runtime cache for real-time updates)
  try {
    const cubes = CURRENT_PLACED_CUBES || [];
    cubes.forEach((cube, idx) => {
      // For child collision objects, get live position/scale from parent transform
      let livePosition = cube.position;
      let liveScale = cube.scale;
      
      if (cube.parentId && window.__CF_PARENT_TRANSFORMS__) {
        const parentTransform = window.__CF_PARENT_TRANSFORMS__[cube.parentId];
        if (parentTransform && cube.followParentScale) {
          // Get live position from parent
          livePosition = {
            x: parentTransform.position.x,
            y: parentTransform.position.y,
            z: parentTransform.position.z
          };
          
          // Get live scale from parent bounds
          const parentCube = cubes.find(c => c.id === cube.parentId);
          if (parentCube && parentCube.modelBounds) {
            const bounds = parentCube.modelBounds;
            liveScale = {
              x: bounds.width * parentTransform.scale.x,
              y: bounds.height * parentTransform.scale.y,
              z: bounds.depth * parentTransform.scale.z
            };
          }
        }
      }
      
      if (cube.hasCollision) {
        // stairs2 uses makeForPlacedStairs2 - EXACT same as makeFor
        if (cube.modelType === 'stairs2') {
          boxes.push(...makeForPlacedStairs2(cube));
        } else if (cube.shape === 'sphere' || cube.shape === 'cylinder') {
          // Sphere and Cylinder collision - use circular collision logic (like rocket base)
          const avgScale = ((liveScale.x || 5) + (liveScale.y || 5) + (liveScale.z || 5)) / 3;
          const radius = avgScale * 0.5; // sphere/cylinder geometry has radius 0.5
          
          // For cylinders with walkableTop, create TWO boxes: top platform + side walls (ORIGINAL BEHAVIOR)
          if (cube.shape === 'cylinder' && cube.walkableTop) {
            const radiusXZ = (liveScale.x || 5) * 0.5; // horizontal radius
            const height = (liveScale.y || 5);
            const centerX = livePosition.x || 0;
            const centerY = livePosition.y || 0;
            const centerZ = livePosition.z || 0;
            const topY = centerY + height * 0.5;
            const bottomY = centerY - height * 0.5;
            
            // 1. Top platform box (thin disk) - treated as isPlatform like Connect Four table
            const platformThickness = 2.0; // thin platform at top
            boxes.push({
              min: { x: centerX - radiusXZ, y: topY - platformThickness, z: centerZ - radiusXZ },
              max: { x: centerX + radiusXZ, y: topY, z: centerZ + radiusXZ },
              idx: 10000 + idx,
              isPlatform: true, // Platform collision - blocks side movement when feet are inside
              centerX: centerX,
              centerZ: centerZ,
              radius: radiusXZ,
              walkableTop: true
            });
            
            // 2. Side wall collision (full height cylinder, no top platform behavior)
            boxes.push({
              min: { x: centerX - radiusXZ, y: bottomY, z: centerZ - radiusXZ },
              max: { x: centerX + radiusXZ, y: topY - platformThickness, z: centerZ + radiusXZ },
              idx: 10000 + idx + 0.1, // slightly different idx
              isRocketBase: true, // Circular side collision only
              centerX: centerX,
              centerZ: centerZ,
              radius: radiusXZ,
              walkableTop: false // No walkable top on side walls
            });
          } else if (cube.shape === 'sphere') {
            // Sphere: same collision structure as cylinder for walkable top
            const centerX = livePosition.x || 0;
            const centerY = livePosition.y || 0;
            const centerZ = livePosition.z || 0;
            const sphereRadius = radius;
            
            if (cube.walkableTop) {
              // Walkable sphere: Only side collision (bottom half acts as wall)
              // The top surface is handled entirely by ground height sampling
              const bottomY = centerY - sphereRadius;
              const sideWallHeight = centerY; // Up to the center/equator
              
              boxes.push({
                min: { x: centerX - sphereRadius, y: bottomY, z: centerZ - sphereRadius },
                max: { x: centerX + sphereRadius, y: sideWallHeight, z: centerZ + sphereRadius },
                idx: 10000 + idx + 0.1,
                isRocketBase: true, // Circular collision for sides
                centerX: centerX,
                centerZ: centerZ,
                radius: sphereRadius,
                walkableTop: false // Not walkable, just a wall
              });
            } else {
              // Non-walkable sphere: single full collision box
              boxes.push({
                min: { x: centerX - sphereRadius, y: centerY - sphereRadius, z: centerZ - sphereRadius },
                max: { x: centerX + sphereRadius, y: centerY + sphereRadius, z: centerZ + sphereRadius },
                idx: 10000 + idx,
                isRocketBase: true,
                centerX: centerX,
                centerZ: centerZ,
                radius: sphereRadius,
                isPlacedSphere: true,
                walkableTop: false
              });
            }
          } else {
            // Non-walkable cylinder: single collision box
            boxes.push({
              min: {
                x: (livePosition.x || 0) - radius,
                y: (livePosition.y || 0) - radius,
                z: (livePosition.z || 0) - radius
              },
              max: {
                x: (livePosition.x || 0) + radius,
                y: (livePosition.y || 0) + radius,
                z: (livePosition.z || 0) + radius
              },
              idx: 10000 + idx,
              isRocketBase: true, // Use circular collision logic
              centerX: livePosition.x || 0,
              centerZ: livePosition.z || 0,
              radius: radius,
              isPlacedSphere: true,
              walkableTop: false
            });
          }
        } else {
          // Box collision - exactly like Connect Four table
          const halfX = (liveScale.x || 5) / 2;
          const halfY = (liveScale.y || 5) / 2;
          const halfZ = (liveScale.z || 5) / 2;
          const centerX = livePosition.x || 0;
          const centerY = livePosition.y || 0;
          const centerZ = livePosition.z || 0;
          
          // Single box with exact same attributes as Connect Four table
          boxes.push({
            min: { x: centerX - halfX, y: centerY - halfY, z: centerZ - halfZ },
            max: { x: centerX + halfX, y: centerY + halfY, z: centerZ + halfZ },
            idx: 10000 + idx,
            isPlatformEdge: true, // Same as Connect Four table
            isTableBox: true, // Same as Connect Four table
            walkableTop: cube.walkableTop || false // Same as Connect Four table (always true for table)
          });
        }
      }
    });
  } catch (e) {
    console.warn('Failed to load cube collisions:', e);
  }
  
  return boxes;
}
// Vertical clearance between the board's bottom and the floor plane
const GROUND_CLEAR = 2.8; // enough room for table top + some air
// Avatar sizing: normalize model to this base height, then multiply to reach final height
const AVATAR_BASE_HEIGHT = 2.2;  // normalized seated/standing baseline in scene units
const AVATAR_FINAL_HEIGHT = 14.0; // absolute final height (bigger presence, fixed)
// Model-specific extra scale boosts (multiplied after normalization -> final size)
const SHARK_SCALE_BOOST = 2.2;      // increase shark noticeably
const CAPUCCINO_SCALE_BOOST = 2.0;  // increase capuccino noticeably
// Small adjustment to keep apparent size consistent on phones (compensate for camera/FOV)
// Note: unified scale for mobile and PC; no separate multiplier currently used
// Subtle idle animation tuning
// Standing idle, breathing — slower and subtle
const AVATAR_IDLE_AMP_Y = 0.14;    // vertical bob amplitude (upper body) — more pronounced
const AVATAR_IDLE_SWAY_Z = 0.03;   // sway around Z (radians) — a bit less side-to-side
const AVATAR_IDLE_SPEED_Y = 0.36;  // slower bob/breath
const AVATAR_IDLE_SPEED_Z = 0.30;  // slower sway
// Final baked X offsets provided by you (updated defaults)
const AVATAR_X_FRONT = 0.22;   // Player 1 side (front)
const AVATAR_X_BACK  = -3.44;  // Player 2 side (back)
// const AVATAR_TWEAK_LS = 'c4_avatar_tweaks_v3'; // no longer used

// Baked avatar transform (apply to both GLTF and fallback avatars)
// const AVATAR_BAKED_ROT = [0, 3.09, 0]; // unused: we compute yaw dynamically
const AVATAR_BAKED_POS = [1.9, 0.0, -12.0]; // moved even further back on Z
const AVATAR_BAKED_SCALE_MUL = 1; // no extra custom scaling; use baseline only
// No per-model tweaks: robot and alien share identical placement pipeline

// Animation speed controls (can be tweaked live via window.__CF_ANIM_SPEEDS__)
const DEFAULT_WALK_ANIM_TIMESCALE = 0.6;
const DEFAULT_RUN_ANIM_TIMESCALE  = 0.9;

// Optional runtime override helper (non-reactive; read at render/effect time)
function getAnimSpeed(which, fallback) {
  try {
    const o = (typeof window !== 'undefined' && window.__CF_ANIM_SPEEDS__) || {};
    const v = o && o[which];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Shared defaults; components call getAnimSpeed to allow quick tuning without rebuild
const WALK_ANIM_TIMESCALE = DEFAULT_WALK_ANIM_TIMESCALE;
const RUN_ANIM_TIMESCALE  = DEFAULT_RUN_ANIM_TIMESCALE;
// Astronaut-specific default walk (faster)
const ASTRONAUT_WALK_DEFAULT = 0.55;
// Astronaut-specific default run (faster)
const ASTRONAUT_RUN_DEFAULT = 0.45;
// Astronaut-specific placement tweak to avoid initial floating
const ASTRONAUT_Y_OFFSET = -0.5;

// Guy1-specific defaults (same as astronaut)
const GUY1_WALK_DEFAULT = 0.55;
const GUY1_RUN_DEFAULT = 0.45;
const GUY1_Y_OFFSET = -0.5;

// Simple ErrorBoundary to catch GLTF loading errors and show fallback
class ModelErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(){ return { hasError: true }; }
  componentDidCatch(err, info){ /* no-op; could log */ }
  render(){
    return this.props.children;
  }
}

function RoundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  const cr = Math.min(r, hw, hh);
  shape.moveTo(-hw + cr, -hh);
  shape.lineTo(hw - cr, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  shape.lineTo(hw, hh - cr);
  shape.quadraticCurveTo(hw, hh, hw - cr, hh);
  shape.lineTo(-hw + cr, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  shape.lineTo(-hw, -hh + cr);
  shape.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  return shape;
}

function FrontPlate() {
  // Classic Connect Four front plate with circular holes (extruded shape with holes)
  const w = COLS * (CELL + GAP) - GAP + 0.6;
  const h = ROWS * (CELL + GAP) - GAP + 0.6;
  const holeR = 0.46; // hole radius
  const depth = BOARD_THICK;
  const geom = useMemo(() => {
    // Base rounded rectangle frame
    const outer = RoundedRectShape(w, h, 0.28);
    // Carve the circular holes for each cell position
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cx = (c - (COLS - 1) / 2) * (CELL + GAP);
        const cy = (r - (ROWS - 1) / 2) * (CELL + GAP);
        const path = new THREE.Path();
        path.absarc(cx, cy, holeR, 0, Math.PI * 2, false);
        outer.holes.push(path);
      }
    }
    const eg = new THREE.ExtrudeGeometry(outer, {
      depth: depth,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
      curveSegments: 32,
      steps: 1,
    });
    eg.center();
    return eg;
  }, [w, h, depth, holeR]);
  return (
    <mesh geometry={geom} position={[0, 0, -BOARD_THICK * 0.6]} castShadow receiveShadow raycast={() => null}>
      {/* Classic blue board */}
      <meshStandardMaterial color={'#1e3a8a'} metalness={0.1} roughness={0.6} />
    </mesh>
  );
}

// Draggable wrapper component for free-drag movement with terrain following
function DraggableObject({ children, cube, editMode, dragMode, isSelected, onDragEnd }) {
  const { camera, gl, raycaster, mouse, scene } = useThree();
  const [isDragging, setIsDragging] = React.useState(false);
  const groupRef = React.useRef();
  const dragPlaneRef = React.useRef();
  const dragOffsetRef = React.useRef({ x: 0, y: 0, z: 0 }); // Store 3D offset between click point and object center
  
  React.useEffect(() => {
    if (!dragMode || !editMode) return;
    
    // Create invisible plane for raycasting - positioned at object height for better control
    if (!dragPlaneRef.current) {
      const planeGeometry = new THREE.PlaneGeometry(10000, 10000);
      planeGeometry.rotateX(-Math.PI / 2);
      const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
      dragPlaneRef.current = new THREE.Mesh(planeGeometry, planeMaterial);
      scene.add(dragPlaneRef.current);
    }
    
    return () => {
      if (dragPlaneRef.current) {
        scene.remove(dragPlaneRef.current);
        dragPlaneRef.current = null;
      }
    };
  }, [dragMode, editMode, scene]);
  
  const handlePointerDown = (e) => {
    if (!dragMode || !editMode || !groupRef.current || !dragPlaneRef.current) return;
    e.stopPropagation();
    
    // Position drag plane at object's current height for more accurate movement
    const objPos = groupRef.current.position;
    dragPlaneRef.current.position.y = objPos.y;
    
    // Calculate initial click offset so object doesn't teleport
    const rect = gl.domElement.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera({ x: mouseX, y: mouseY }, camera);
    const intersects = raycaster.intersectObject(dragPlaneRef.current);
    
    if (intersects.length > 0) {
      const clickPoint = intersects[0].point;
      
      // Scale down the click point to match movement scale
      const movementScale = 0.1;
      const scaledClickX = clickPoint.x * movementScale;
      const scaledClickZ = clickPoint.z * movementScale;
      
      // Store the offset between where we clicked and where the object is
      dragOffsetRef.current = {
        x: objPos.x - scaledClickX,
        y: objPos.y - clickPoint.y,
        z: objPos.z - scaledClickZ
      };
    }
    
    setIsDragging(true);
    gl.domElement.style.cursor = 'grabbing';
  };
  
  const handlePointerMove = (e) => {
    if (!isDragging || !dragMode || !editMode || !groupRef.current || !dragPlaneRef.current) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    // Update mouse coordinates
    const rect = gl.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Raycast to find intersection with drag plane (at object's height)
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(dragPlaneRef.current);
    
    if (intersects.length > 0) {
      const point = intersects[0].point;
      
      // Scale down the raycast point to reduce movement speed (10% of actual distance from center)
      const movementScale = 0.1;
      const scaledX = point.x * movementScale;
      const scaledZ = point.z * movementScale;
      
      // Apply the offset so object stays where you grabbed it
      const targetX = scaledX + dragOffsetRef.current.x;
      const targetZ = scaledZ + dragOffsetRef.current.z;
      
      const terrainHeight = getTerrainHeightXZ(targetX, targetZ);
      
      // Calculate object's height offset from terrain at its original position
      const heightOffset = cube.position.y - getTerrainHeightXZ(cube.position.x, cube.position.z);
      
      // Update position while maintaining terrain height + object's original height offset
      const newY = terrainHeight + heightOffset;
      groupRef.current.position.set(targetX, newY, targetZ);
      
      // Update drag plane Y position to follow the object for smooth dragging
      dragPlaneRef.current.position.y = newY;
    }
  };
  
  const handlePointerUp = (e) => {
    if (!isDragging) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    setIsDragging(false);
    gl.domElement.style.cursor = dragMode ? 'grab' : 'default';
    
    if (groupRef.current && onDragEnd) {
      const pos = groupRef.current.position;
      onDragEnd({
        position: { x: pos.x, y: pos.y, z: pos.z }
      });
    }
  };
  
  React.useEffect(() => {
    if (!dragMode || !editMode) return;
    
    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, dragMode, editMode, gl.domElement]);
  
  return (
    <group
      ref={groupRef}
      position={[cube.position.x, cube.position.y, cube.position.z]}
      onPointerDown={handlePointerDown}
      onPointerOver={() => dragMode && editMode && (gl.domElement.style.cursor = 'grab')}
      onPointerOut={() => !isDragging && (gl.domElement.style.cursor = 'default')}
    >
      {children}
      
      {/* Visual indicator for drag mode - green sphere above object */}
      {dragMode && editMode && isSelected && (
        <mesh position={[0, 1, 0]}>
          <sphereGeometry args={[0.4, 16, 16]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
}

// Placed Cube/Sphere Component with TransformControls
// Component for rendering Stairs2 model with collision boxes
function Stairs2PlacedModel({ cube, isSelected, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd, showCollisionBoxes }) {
  const groupRef = React.useRef();
  const transformRef = React.useRef();
  
  // Interpolation targets for smooth opponent view
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  // Load textures (same as main Staircase component)
  const stairsTex = useTexture('/textures/metal_stairs.png');
  useEffect(() => {
    if (stairsTex) {
      stairsTex.wrapS = stairsTex.wrapT = THREE.ClampToEdgeWrapping;
      stairsTex.anisotropy = 8;
      stairsTex.repeat.set(1, 1);
      stairsTex.needsUpdate = true;
    }
  }, [stairsTex]);
  
  const stairMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#dfe4ea',
    metalness: 0.35,
    roughness: 0.6,
    map: stairsTex || null,
  }), [stairsTex]);
  
  const railMat = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: '#9ca3af', 
    metalness: 0.7, 
    roughness: 0.35 
  }), []);
  
  // Stairs2 parameters (from constants)
  const width = STAIR2_WIDTH;
  const run = STAIR2_RUN;
  const rise = STAIR2_RISE;
  const steps = STAIR2_STEPS;
  const POST_EVERY = 2;
  const postW = 0.32, postD = 0.32;
  const postH = 6.5;
  const topRailThick = 0.28;
  const midRailThick = 0.22;
  const railInset = 0.45;
  
  // Build stairs geometry (centered at origin for the model)
  const stairsGroup = useMemo(() => {
    const group = new THREE.Group();
    
    // Create each step
    for (let i = 0; i < steps; i++) {
      const y = i * rise;
      const zStart = i * run;
      const zCenter = zStart + run / 2;
      
      // Main step block (using BoxGeometry for simplicity)
      const stepGeo = new THREE.BoxGeometry(width, rise, run);
      const stepMesh = new THREE.Mesh(stepGeo, stairMat);
      stepMesh.position.set(0, y + rise/2, zCenter);
      stepMesh.castShadow = true;
      stepMesh.receiveShadow = true;
      group.add(stepMesh);
      
      // Bullnose lip
      const lipGeo = new THREE.BoxGeometry(width, 0.26, 0.22);
      const lipMesh = new THREE.Mesh(lipGeo, stairMat);
      lipMesh.position.set(0, y + rise - 0.13, zStart + run - 0.11);
      lipMesh.castShadow = true;
      lipMesh.receiveShadow = true;
      group.add(lipMesh);
      
      // Anti-slip grooves
      for (let gi = 0; gi < 3; gi++) {
        const off = 0.22 + gi * 0.16;
        const grooveGeo = new THREE.BoxGeometry(width, 0.04, 0.02);
        const grooveMesh = new THREE.Mesh(grooveGeo, stairMat);
        grooveMesh.position.set(0, y + rise - 0.18, zStart + run - off);
        grooveMesh.castShadow = true;
        grooveMesh.receiveShadow = true;
        group.add(grooveMesh);
      }
    }
    
    // Side stringers
    const stringer1Geo = new THREE.BoxGeometry(0.5, 1.0, steps * run + 0.0001);
    const stringer1Mesh = new THREE.Mesh(stringer1Geo, stairMat);
    stringer1Mesh.position.set(-width/2 - 0.25, rise*steps/2, (steps * run)/2);
    stringer1Mesh.rotation.x = -Math.atan2(rise*steps, run*steps);
    stringer1Mesh.castShadow = true;
    stringer1Mesh.receiveShadow = true;
    group.add(stringer1Mesh);
    
    const stringer2Geo = new THREE.BoxGeometry(0.5, 1.0, steps * run + 0.0001);
    const stringer2Mesh = new THREE.Mesh(stringer2Geo, stairMat);
    stringer2Mesh.position.set(width/2 + 0.25, rise*steps/2, (steps * run)/2);
    stringer2Mesh.rotation.x = -Math.atan2(rise*steps, run*steps);
    stringer2Mesh.castShadow = true;
    stringer2Mesh.receiveShadow = true;
    group.add(stringer2Mesh);
    
    // Guard rails - posts
    const leftRailX = -width/2 + railInset;
    const rightRailX = width/2 - railInset;
    
    for (let i = 0; i < steps; i += POST_EVERY) {
      const y = (i+1) * rise;
      const zCenter = i * run + run * 0.5;
      
      // Left post
      const leftPostGeo = new THREE.BoxGeometry(postW, postH, postD);
      const leftPostMesh = new THREE.Mesh(leftPostGeo, railMat);
      leftPostMesh.position.set(leftRailX, y + postH/2, zCenter);
      leftPostMesh.castShadow = true;
      leftPostMesh.receiveShadow = true;
      group.add(leftPostMesh);
      
      // Right post
      const rightPostGeo = new THREE.BoxGeometry(postW, postH, postD);
      const rightPostMesh = new THREE.Mesh(rightPostGeo, railMat);
      rightPostMesh.position.set(rightRailX, y + postH/2, zCenter);
      rightPostMesh.castShadow = true;
      rightPostMesh.receiveShadow = true;
      group.add(rightPostMesh);
    }
    
    // Bottom and top posts
    const z0 = run*0.5;
    const z1 = steps * run - run*0.5;
    
    const bottomLeftPostGeo = new THREE.BoxGeometry(postW, postH, postD);
    const bottomLeftPost = new THREE.Mesh(bottomLeftPostGeo, railMat);
    bottomLeftPost.position.set(leftRailX, rise + postH/2, z0);
    bottomLeftPost.castShadow = true;
    bottomLeftPost.receiveShadow = true;
    group.add(bottomLeftPost);
    
    const bottomRightPostGeo = new THREE.BoxGeometry(postW, postH, postD);
    const bottomRightPost = new THREE.Mesh(bottomRightPostGeo, railMat);
    bottomRightPost.position.set(rightRailX, rise + postH/2, z0);
    bottomRightPost.castShadow = true;
    bottomRightPost.receiveShadow = true;
    group.add(bottomRightPost);
    
    const topLeftPostGeo = new THREE.BoxGeometry(postW, postH, postD);
    const topLeftPost = new THREE.Mesh(topLeftPostGeo, railMat);
    topLeftPost.position.set(leftRailX, steps*rise + postH/2, z1);
    topLeftPost.castShadow = true;
    topLeftPost.receiveShadow = true;
    group.add(topLeftPost);
    
    const topRightPostGeo = new THREE.BoxGeometry(postW, postH, postD);
    const topRightPost = new THREE.Mesh(topRightPostGeo, railMat);
    topRightPost.position.set(rightRailX, steps*rise + postH/2, z1);
    topRightPost.castShadow = true;
    topRightPost.receiveShadow = true;
    group.add(topRightPost);
    
    // Top and mid rail bars (sloped)
    const y0 = rise + postH;
    const y1 = steps*rise + postH;
    const dz = z1 - z0;
    const dy = y1 - y0;
    const railLen = Math.sqrt(dz*dz + dy*dy);
    const railPitch = -Math.atan2(dy, dz);
    const midZ = (z0 + z1) / 2;
    const midY = (y0 + y1) / 2;
    
    // Top rails
    const topRailGeoLeft = new THREE.BoxGeometry(topRailThick, topRailThick, railLen);
    const topRailMeshLeft = new THREE.Mesh(topRailGeoLeft, railMat);
    topRailMeshLeft.position.set(leftRailX, midY, midZ);
    topRailMeshLeft.rotation.x = railPitch;
    topRailMeshLeft.castShadow = true;
    topRailMeshLeft.receiveShadow = true;
    group.add(topRailMeshLeft);
    
    const topRailGeoRight = new THREE.BoxGeometry(topRailThick, topRailThick, railLen);
    const topRailMeshRight = new THREE.Mesh(topRailGeoRight, railMat);
    topRailMeshRight.position.set(rightRailX, midY, midZ);
    topRailMeshRight.rotation.x = railPitch;
    topRailMeshRight.castShadow = true;
    topRailMeshRight.receiveShadow = true;
    group.add(topRailMeshRight);
    
    // Mid rails
    const midRailY = midY - postH * 0.25;
    const midRailGeoLeft = new THREE.BoxGeometry(midRailThick, midRailThick, railLen);
    const midRailMeshLeft = new THREE.Mesh(midRailGeoLeft, railMat);
    midRailMeshLeft.position.set(leftRailX, midRailY, midZ);
    midRailMeshLeft.rotation.x = railPitch;
    midRailMeshLeft.castShadow = true;
    midRailMeshLeft.receiveShadow = true;
    group.add(midRailMeshLeft);
    
    const midRailGeoRight = new THREE.BoxGeometry(midRailThick, midRailThick, railLen);
    const midRailMeshRight = new THREE.Mesh(midRailGeoRight, railMat);
    midRailMeshRight.position.set(rightRailX, midRailY, midZ);
    midRailMeshRight.rotation.x = railPitch;
    midRailMeshRight.castShadow = true;
    midRailMeshRight.receiveShadow = true;
    group.add(midRailMeshRight);
    
    return group;
  }, [stairMat, railMat, width, run, rise, steps, postW, postH, postD, topRailThick, midRailThick, railInset, POST_EVERY]);
  
  // Clone the group for each instance to avoid circular references
  const stairsClone = useMemo(() => {
    if (!stairsGroup) return null;
    return stairsGroup.clone();
  }, [stairsGroup, cube.id]); // Re-clone when cube.id changes (new instance)
  
  // Collision boxes (same structure as buildStairAABBsWorld but local coordinates)
  const collisionBoxes = useMemo(() => {
    const boxes = [];
    const halfW = width / 2;
    
    // Step collision boxes
    for (let i = 0; i < steps; i++) {
      const zStart = i * run;
      const zEnd = zStart + run;
      const y0 = i * rise;
      const y1 = y0 + rise;
      const zCenter = (zStart + zEnd) / 2;
      const yCenter = (y0 + y1) / 2;
      
      boxes.push({
        position: [0, yCenter, zCenter],
        size: [width, rise, run],
        key: `step-${i}`
      });
    }
    
    // Rail collision boxes (OUTSIDE the stairs like STAIR2)
    const railWidth = 0.8;
    const railHeight = 8.0;
    const leftX = -width/2 - railInset; // OUTSIDE left (subtract)
    const rightX = width/2 + railInset; // OUTSIDE right (add)
    
    for (let i = 0; i < steps; i++) {
      const zStart = i * run;
      const zEnd = zStart + run;
      const zCenter = (zStart + zEnd) / 2;
      const yBase = i * rise;
      const yCenter = yBase + railHeight/2;
      
      // Left rail
      boxes.push({
        position: [leftX, yCenter, zCenter],
        size: [railWidth, railHeight, run],
        key: `rail-left-${i}`
      });
      
      // Right rail
      boxes.push({
        position: [rightX, yCenter, zCenter],
        size: [railWidth, railHeight, run],
        key: `rail-right-${i}`
      });
    }
    
    return boxes;
  }, [width, run, rise, steps, railInset]);
  
  // Transform controls handlers
  React.useEffect(() => {
    if (transformRef.current && groupRef.current) {
      const controls = transformRef.current;
      const handleMouseUp = () => {
        if (!groupRef.current) return;
        const { position, rotation, scale } = groupRef.current;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(position);
        targetRot.current.copy(rotation);
        targetScale.current.copy(scale);
        
        const updates = {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        };
        if (onTransformEnd) onTransformEnd(updates);
      };
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => controls.removeEventListener('mouseUp', handleMouseUp);
    }
  }, [onTransformEnd]);
  
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  if (!stairsClone) return null;
  
  return (
    <>
      {dragMode && editMode ? (
        <DraggableObject cube={cube} editMode={editMode} dragMode={dragMode} isSelected={isSelected} onDragEnd={onTransformEnd}>
          <group
            ref={groupRef}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
          >
            <group>
              <primitive object={stairsClone} />
            </group>
            {/* Collision boxes */}
            {showCollisionBoxes && collisionBoxes.map(box => (
              <mesh key={box.key} position={box.position}>
                <boxGeometry args={box.size} />
                <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
              </mesh>
            ))}
          </group>
        </DraggableObject>
      ) : (
        <>
          <group
            ref={groupRef}
            position={[cube.position.x, cube.position.y, cube.position.z]}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
          >
            <group>
              <primitive object={stairsClone} />
            </group>
            {/* Collision boxes */}
            {showCollisionBoxes && collisionBoxes.map(box => (
              <mesh key={box.key} position={box.position}>
                <boxGeometry args={box.size} />
                <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
              </mesh>
            ))}
          </group>
          {editMode && isSelected && !dragMode && (
            <TransformControls ref={transformRef} object={groupRef.current} />
          )}
        </>
      )}
    </>
  );
}

// Component for rendering asteroid models
function AsteroidPlacedModel({ cube, isSelected, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd }) {
  const groupRef = React.useRef();
  const transformRef = React.useRef();
  const asteroidModel = useFBX('/models/props/asteroid/asteroid.fbx');
  
  // Interpolation targets for smooth opponent view
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  const modelClone = React.useMemo(() => {
    if (!asteroidModel) return null;
    // Create a new group and only copy meshes (no bones/skeleton)
    const group = new THREE.Group();
    asteroidModel.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        // Convert SkinnedMesh to regular Mesh to avoid bone issues
        const geometry = o.geometry;
        const material = o.material;
        
        // Create a plain Mesh (not SkinnedMesh)
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Copy world transform
        mesh.position.copy(o.position);
        mesh.rotation.copy(o.rotation);
        mesh.scale.copy(o.scale);
        
        group.add(mesh);
      }
    });
    return group;
  }, [asteroidModel]);
  
  React.useEffect(() => {
    if (transformRef.current && groupRef.current) {
      const controls = transformRef.current;
      const handleMouseUp = () => {
        if (!groupRef.current) return;
        const { position, rotation, scale } = groupRef.current;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(position);
        targetRot.current.copy(rotation);
        targetScale.current.copy(scale);
        
        const updates = {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        };
        if (onTransformEnd) onTransformEnd(updates);
      };
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => controls.removeEventListener('mouseUp', handleMouseUp);
    }
  }, [onTransformEnd]);
  
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  if (!modelClone) return null;
  
  return (
    <>
      {dragMode && editMode ? (
        // Wrap in DraggableObject for free drag mode
        <DraggableObject cube={cube} editMode={editMode} dragMode={dragMode} isSelected={isSelected} onDragEnd={onTransformEnd}>
          <group
            ref={groupRef}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
          >
            <primitive object={modelClone} />
            {cube.hasCollision && (
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
              </mesh>
            )}
          </group>
        </DraggableObject>
      ) : (
        <group
          ref={groupRef}
          position={[cube.position.x, cube.position.y, cube.position.z]}
          rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
          scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
        >
          <primitive object={modelClone} />
          {cube.hasCollision && editMode && (
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
            </mesh>
          )}
        </group>
      )}
      {/* Always show TransformControls when selected, even in drag mode */}
      {isSelected && editMode && groupRef.current && (
        <TransformControls ref={transformRef} object={groupRef.current} mode={transformMode} enabled={!dragMode} />
      )}
    </>
  );
}

// Component for rendering rover models
function RoverPlacedModel({ cube, isSelected, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd }) {
  const groupRef = React.useRef();
  const transformRef = React.useRef();
  const roverModel = useFBX('/models/props/rover/dusty rover/Dusty_Explorer_1020195240_texture.fbx');
  
  // Interpolation targets for smooth opponent view
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  const modelClone = React.useMemo(() => {
    if (!roverModel) return null;
    // Create a new group and only copy meshes (no bones/skeleton)
    const group = new THREE.Group();
    roverModel.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        // Convert SkinnedMesh to regular Mesh to avoid bone issues
        const geometry = o.geometry;
        const material = o.material;
        
        // Create a plain Mesh (not SkinnedMesh)
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Copy world transform
        mesh.position.copy(o.position);
        mesh.rotation.copy(o.rotation);
        mesh.scale.copy(o.scale);
        
        group.add(mesh);
      }
    });
    return group;
  }, [roverModel]);
  
  React.useEffect(() => {
    if (transformRef.current && groupRef.current) {
      const controls = transformRef.current;
      const handleMouseUp = () => {
        if (!groupRef.current) return;
        const { position, rotation, scale } = groupRef.current;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(position);
        targetRot.current.copy(rotation);
        targetScale.current.copy(scale);
        
        const updates = {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        };
        if (onTransformEnd) onTransformEnd(updates);
      };
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => controls.removeEventListener('mouseUp', handleMouseUp);
    }
  }, [onTransformEnd]);
  
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  if (!modelClone) return null;
  
  return (
    <>
      {dragMode && editMode ? (
        // Wrap in DraggableObject for free drag mode
        <DraggableObject cube={cube} editMode={editMode} dragMode={dragMode} isSelected={isSelected} onDragEnd={onTransformEnd}>
          <group
            ref={groupRef}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
          >
            <primitive object={modelClone} />
            {cube.hasCollision && (
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
              </mesh>
            )}
          </group>
        </DraggableObject>
      ) : (
        <group
          ref={groupRef}
          position={[cube.position.x, cube.position.y, cube.position.z]}
          rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
          scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
        >
          <primitive object={modelClone} />
          {cube.hasCollision && editMode && (
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
            </mesh>
          )}
        </group>
      )}
      {/* Always show TransformControls when selected, even in drag mode */}
      {isSelected && editMode && groupRef.current && (
        <TransformControls ref={transformRef} object={groupRef.current} mode={transformMode} enabled={!dragMode} />
      )}
    </>
  );
}

// Component for rendering custom uploaded models (dynamic path)
function CustomPlacedModel({ cube, isSelected, onSelect, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd, showCollisionMeshes }) {
  const groupRef = React.useRef();
  const transformRef = React.useRef();
  const isDragging = React.useRef(false); // Track if this model is currently being dragged
  
  // Store parent transform reference globally so children can access it
  React.useEffect(() => {
    if (!window.__CF_PARENT_TRANSFORMS__) {
      window.__CF_PARENT_TRANSFORMS__ = {};
    }
    if (groupRef.current) {
      window.__CF_PARENT_TRANSFORMS__[cube.id] = groupRef.current;
    }
    return () => {
      if (window.__CF_PARENT_TRANSFORMS__) {
        delete window.__CF_PARENT_TRANSFORMS__[cube.id];
      }
    };
  }, [cube.id]);
  
  // Dynamically load model based on cube.customModelPath
  const modelPath = cube.customModelPath || '';
  const modelExtension = modelPath.toLowerCase().split('.').pop();
  
  // Load FBX models
  const fbxModel = useFBX(modelExtension === 'fbx' ? modelPath : null);
  // For other formats (GLB, GLTF, etc.), we'd use useGLTF or useLoader
  // For now, focusing on FBX support like the other models
  
  const modelClone = React.useMemo(() => {
    if (!fbxModel) return null;
    const group = new THREE.Group();
    fbxModel.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        const geometry = o.geometry;
        const material = o.material;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.copy(o.position);
        mesh.rotation.copy(o.rotation);
        mesh.scale.copy(o.scale);
        group.add(mesh);
      }
    });
    return group;
  }, [fbxModel]);
  
  // Calculate actual model bounding box dimensions
  const modelBounds = React.useMemo(() => {
    if (!modelClone) return { width: 1, height: 1, depth: 1 };
    const box = new THREE.Box3().setFromObject(modelClone);
    const size = new THREE.Vector3();
    box.getSize(size);
    // These are the raw model dimensions BEFORE scaling
    return { 
      width: size.x || 1, 
      height: size.y || 1, 
      depth: size.z || 1 
    };
  }, [modelClone]);
  
  // Store bounds on cube for UI to use (only once when model loads)
  React.useEffect(() => {
    if (modelBounds && cube && !cube.modelBounds) {
      // Update the cube with its bounds so UI can spawn proper collision
      if (onTransformEnd) {
        onTransformEnd({ modelBounds });
      }
    }
  }, [modelBounds, cube, onTransformEnd]);
  
  React.useEffect(() => {
    // Only set position directly from state when NOT dragging (prevents fighting with TransformControls)
    if (groupRef.current && cube && !isDragging.current) {
      // Set targets for interpolation instead of direct position
      targetPos.current.set(cube.position.x, cube.position.y, cube.position.z);
      targetRot.current.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      targetScale.current.set(cube.scale.x, cube.scale.y, cube.scale.z);
    }
  }, [cube]);
  
  // SMOOTH INTERPOLATION for opponent's view when they see live updates
  // Store target transform and lerp toward it each frame
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  // Initialize targets on first mount
  React.useEffect(() => {
    if (cube && groupRef.current) {
      targetPos.current.set(cube.position.x, cube.position.y, cube.position.z);
      targetRot.current.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      targetScale.current.set(cube.scale.x, cube.scale.y, cube.scale.z);
      // Set initial position directly
      groupRef.current.position.set(cube.position.x, cube.position.y, cube.position.z);
      groupRef.current.rotation.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      groupRef.current.scale.set(cube.scale.x, cube.scale.y, cube.scale.z);
    }
  }, [cube.id]); // Only on mount/cube change
  
  // Smooth interpolation for opponent viewing your transforms
  useFrame((_, delta) => {
    if (!groupRef.current || isDragging.current) return; // Skip if you're dragging it
    
    // Super smooth interpolation - high factor for responsive feel
    const lerpFactor = Math.min(1, delta * 50);
    
    // Lerp position
    groupRef.current.position.lerp(targetPos.current, lerpFactor);
    
    // Lerp rotation
    groupRef.current.rotation.x += (targetRot.current.x - groupRef.current.rotation.x) * lerpFactor;
    groupRef.current.rotation.y += (targetRot.current.y - groupRef.current.rotation.y) * lerpFactor;
    groupRef.current.rotation.z += (targetRot.current.z - groupRef.current.rotation.z) * lerpFactor;
    
    // Lerp scale
    groupRef.current.scale.lerp(targetScale.current, lerpFactor);
  });
  
  // Main model transform controls
  React.useEffect(() => {
    if (!transformRef.current) return;
    const controls = transformRef.current;
    
    const onDraggingChanged = (event) => {
      isDragging.current = event.value; // Track drag state
      
      // Notify parent component about drag state
      if (window.__CF_SET_DRAGGING_CUBE__) {
        window.__CF_SET_DRAGGING_CUBE__(event.value);
      }
      
      if (!event.value) {
        // Drag ended - send final transform
        if (!groupRef.current || !onTransformEnd) return;
        const pos = groupRef.current.position;
        const rot = groupRef.current.rotation;
        const scl = groupRef.current.scale;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(pos);
        targetRot.current.copy(rot);
        targetScale.current.copy(scl);
        
        onTransformEnd({
          position: { x: pos.x, y: pos.y, z: pos.z },
          rotation: { x: rot.x, y: rot.y, z: rot.z },
          scale: { x: scl.x, y: scl.y, z: scl.z }
        });
      }
    };
    
    controls.addEventListener('dragging-changed', onDraggingChanged);
    
    return () => {
      if (controls && controls.removeEventListener) {
        controls.removeEventListener('dragging-changed', onDraggingChanged);
      }
    };
  }, [onTransformEnd]);
  
  // LIVE TRANSFORM BROADCAST - Send position/rotation/scale to opponent in real-time while dragging
  const lastBroadcastRef = React.useRef(0);
  useFrame(() => {
    if (!isDragging.current || !groupRef.current) return;
    
    // Throttle broadcasts to ~30fps (every ~33ms) to avoid overwhelming the network
    const now = performance.now();
    if (now - lastBroadcastRef.current < 33) return;
    lastBroadcastRef.current = now;
    
    // Broadcast live transform to opponent
    if (onTransformEnd) {
      const pos = groupRef.current.position;
      const rot = groupRef.current.rotation;
      const scl = groupRef.current.scale;
      onTransformEnd({
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z },
        scale: { x: scl.x, y: scl.y, z: scl.z },
        isLive: true // Flag to indicate this is a live update, not final
      });
    }
  });
  
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setTranslationSnap(snap && translateSnap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap && rotateSnapDeg ? THREE.MathUtils.degToRad(rotateSnapDeg) : null);
      transformRef.current.setScaleSnap(snap && scaleSnap ? scaleSnap : null);
    }
  }, [snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  if (!modelClone) return null;
  
  return (
    <>
      {dragMode && !isSelected ? (
        <DraggableObject initialPosition={cube.position} onDragEnd={onTransformEnd}>
          <group ref={groupRef} onClick={(e) => { e.stopPropagation(); if (onSelect) onSelect(); }}>
            <primitive object={modelClone} />
          </group>
        </DraggableObject>
      ) : (
        <group ref={groupRef} onClick={(e) => { e.stopPropagation(); if (onSelect && editMode) onSelect(); }}>
          <primitive object={modelClone} />
          
          {isSelected && editMode && (
            <mesh visible={false}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
            </mesh>
          )}
        </group>
      )}
      
      {/* Main model transform controls */}
      {isSelected && editMode && groupRef.current && (
        <TransformControls ref={transformRef} object={groupRef.current} mode={transformMode} enabled={!dragMode} />
      )}
    </>
  );
}

// Component for rendering table models
function TablePlacedModel({ cube, isSelected, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd }) {
  const groupRef = React.useRef();
  const transformRef = React.useRef();
  const tableModel = useFBX('/models/props/table/table.fbx');
  
  // Interpolation targets for smooth opponent view
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  const modelClone = React.useMemo(() => {
    if (!tableModel) return null;
    const clone = skeletonClone(tableModel);
    clone.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [tableModel]);
  
  React.useEffect(() => {
    if (transformRef.current && groupRef.current) {
      const controls = transformRef.current;
      const handleMouseUp = () => {
        if (!groupRef.current) return;
        const { position, rotation, scale } = groupRef.current;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(position);
        targetRot.current.copy(rotation);
        targetScale.current.copy(scale);
        
        const updates = {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        };
        if (onTransformEnd) onTransformEnd(updates);
      };
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => controls.removeEventListener('mouseUp', handleMouseUp);
    }
  }, [onTransformEnd]);
  
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  if (!modelClone) return null;
  
  return (
    <>
      {dragMode && editMode ? (
        // Wrap in DraggableObject for free drag mode
        <DraggableObject cube={cube} editMode={editMode} dragMode={dragMode} isSelected={isSelected} onDragEnd={onTransformEnd}>
          <group
            ref={groupRef}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
          >
            <primitive object={modelClone} />
            {cube.hasCollision && (
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
              </mesh>
            )}
          </group>
        </DraggableObject>
      ) : (
        <group
          ref={groupRef}
          position={[cube.position.x, cube.position.y, cube.position.z]}
          rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
          scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
        >
          <primitive object={modelClone} />
          {cube.hasCollision && editMode && (
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color={isSelected ? '#10b981' : '#3b82f6'} wireframe opacity={0.3} transparent />
            </mesh>
          )}
        </group>
      )}
      {/* Always show TransformControls when selected, even in drag mode */}
      {isSelected && editMode && groupRef.current && (
        <TransformControls ref={transformRef} object={groupRef.current} mode={transformMode} enabled={!dragMode} />
      )}
    </>
  );
}

// Terrain Sculpting Tool - displays brush cursor and handles sculpting interactions
function TerrainSculptor({ enabled, brushSize, strength, placedCubes, onSculpt }) {
  const { camera, raycaster, scene, gl } = useThree();
  const [brushPosition, setBrushPosition] = useState(null);
  const [hoveredTerrainId, setHoveredTerrainId] = useState(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));

  // Track mouse movement
  useEffect(() => {
    if (!enabled) return;

    const canvas = gl.domElement;
    
    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      
      // Convert to normalized device coordinates (-1 to +1)
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
  }, [enabled, gl]);

  useFrame(() => {
    if (!enabled) {
      setBrushPosition(null);
      return;
    }

    raycaster.setFromCamera(mouseRef.current, camera);
    
    // Find terrain meshes
    const terrainObjects = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.userData.terrainId) {
        terrainObjects.push(obj);
      }
    });

    const intersects = raycaster.intersectObjects(terrainObjects, false);
    
    if (intersects.length > 0) {
      const hit = intersects[0];
      const newPos = hit.point.clone();
      
      // Only update if position changed significantly (prevent jitter from geometry updates)
      if (!brushPosition || brushPosition.distanceTo(newPos) > 0.1) {
        setBrushPosition(newPos);
      }
      setHoveredTerrainId(hit.object.userData.terrainId);
    } else {
      setBrushPosition(null);
      setHoveredTerrainId(null);
    }
  });

  // Handle arrow keys for sculpting
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      if (hoveredTerrainId && brushPosition) {
        if (e.key === ']') {
          e.preventDefault();
          onSculpt(hoveredTerrainId, brushPosition, brushSize, strength);
        } else if (e.key === '[') {
          e.preventDefault();
          onSculpt(hoveredTerrainId, brushPosition, brushSize, -strength);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, hoveredTerrainId, brushPosition, brushSize, strength, onSculpt]);

  if (!enabled || !brushPosition) return null;

  return (
    <mesh position={[brushPosition.x, brushPosition.y + 0.1, brushPosition.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[brushSize * 0.9, brushSize, 32]} />
      <meshBasicMaterial color="#00ff00" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Terrain geometry generator with procedural noise
// Floating labels for terrain identification
function TerrainLabels({ cube, terrainIndex }) {
  if (!cube.isTerrain) return null;
  
  const labelHeight = 150; // Float WAY above terrain noise
  const edgeDistance = (cube.scale.x / 2) * 0.8; // 80% of the way to edge
  
  return (
    <group position={[cube.position.x, cube.position.y, cube.position.z]}>
      {/* Center ID Label */}
      <Text
        position={[0, labelHeight, 0]}
        fontSize={80}
        color="#00ffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={3}
        outlineColor="#000000"
      >
        {terrainIndex}
      </Text>
      
      {/* North Label */}
      <Text
        position={[0, labelHeight, edgeDistance]}
        fontSize={50}
        color="#ff6b6b"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        NORTH
      </Text>
      
      {/* South Label */}
      <Text
        position={[0, labelHeight, -edgeDistance]}
        fontSize={50}
        color="#4ecdc4"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        SOUTH
      </Text>
      
      {/* East Label */}
      <Text
        position={[edgeDistance, labelHeight, 0]}
        fontSize={50}
        color="#ffe66d"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        EAST
      </Text>
      
      {/* West Label */}
      <Text
        position={[-edgeDistance, labelHeight, 0]}
        fontSize={50}
        color="#a8e6cf"
        anchorX="center"
        anchorY="middle"
        outlineWidth={2}
        outlineColor="#000000"
      >
        EAST
      </Text>
      
      {/* West Label */}
      <Text
        position={[-edgeDistance, labelHeight, 0]}
        fontSize={20}
        color="#a8e6cf"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.8}
        outlineColor="#000000"
      >
        WEST
      </Text>
    </group>
  );
}

function TerrainGeometry({ cube }) {
  const geometry = React.useMemo(() => {
    const segments = cube.terrainSegments || 100;
    const sizeX = cube.scale.x;
    const sizeZ = cube.scale.z;
    
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments);
    
    // Get position attribute
    const positions = geo.attributes.position;
    
    // Heightmap function using noise
    const hash21 = (x, y) => {
      let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return n - Math.floor(n);
    };
    
    const noise = (x, y) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      
      const a = hash21(ix, iy);
      const b = hash21(ix + 1, iy);
      const c = hash21(ix, iy + 1);
      const d = hash21(ix + 1, iy + 1);
      
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      
      return a * (1 - ux) * (1 - uy) +
             b * ux * (1 - uy) +
             c * (1 - ux) * uy +
             d * ux * uy;
    };
    
    const fbm = (x, y, octaves) => {
      let value = 0;
      let amplitude = 1;
      let frequency = 1;
      
      for (let i = 0; i < octaves; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
      }
      
      return value;
    };
    
    // Apply height to vertices
    const terrainScale = cube.terrainScale || 0.015;
    const terrainHeightMultiplier = cube.terrainHeightMultiplier || 8;
    const terrainMoundScale = cube.terrainMoundScale || 0.008;
    const terrainMoundMultiplier = cube.terrainMoundMultiplier || 15;
    const terrainOctaves = cube.terrainOctaves || 4;
    
    const maxDistX = sizeX / 2;
    const maxDistZ = sizeZ / 2;
    
    // Storage for edge heights - will be saved to cube after generation
    const edgeHeights = {
      north: [],
      south: [],
      east: [],
      west: []
    };
    
    // Helper to get height from neighbor's saved edge
    // Supports MULTIPLE snapped edges - check snappedEdges object
    const getSavedEdgeHeight = (edge, localX, localZ) => {
      // Check if this specific edge has a neighbor
      if (!cube.snappedEdges || !cube.snappedEdges[edge]) return null;
      
      const neighborCubeId = cube.snappedEdges[edge];
      
      // Find the neighbor cube
      let neighborCube = null;
      if (typeof CURRENT_PLACED_CUBES !== 'undefined') {
        neighborCube = CURRENT_PLACED_CUBES.find(c => c.id === neighborCubeId);
      }
      
      if (!neighborCube || !neighborCube.savedEdgeHeights) return null;
      
      // IMPORTANT: Verify the cubes are actually still close together
      // If they've been moved apart, don't blend (prevents stale snappedEdges from causing issues)
      const distX = Math.abs(cube.position.x - neighborCube.position.x);
      const distZ = Math.abs(cube.position.z - neighborCube.position.z);
      const maxExpectedDist = (Math.max(cube.scale.x, cube.scale.z) + Math.max(neighborCube.scale.x, neighborCube.scale.z)) / 2 + 5;
      
      if (distX > maxExpectedDist || distZ > maxExpectedDist) {
        // Cubes are too far apart - they're not actually snapped anymore
        return null;
      }
      
      // ONE-WAY INHERITANCE: This terrain (NEW) adopts the neighbor's (OLD) edge heights
      // The existing terrain is the authority - we don't need mutual verification
      // This allows chaining: A → B (adapts to A) → C (adapts to B) → etc.
      
      // Determine which edge of the neighbor we're matching
      const edgeMapping = {
        'north': 'south',
        'south': 'north',
        'east': 'west',
        'west': 'east'
      };
      const neighborEdge = edgeMapping[edge];
      const neighborEdgeData = neighborCube.savedEdgeHeights[neighborEdge];
      
      if (!neighborEdgeData || neighborEdgeData.length === 0) return null;
      
      // Transform local coordinates from this cube's space to neighbor's space
      // This is needed because each terrain has its own local coordinate system
      // IMPORTANT: Always transform BOTH X and Z coordinates relative to neighbor
      const worldOffsetX = cube.position.x - neighborCube.position.x;
      const worldOffsetZ = cube.position.z - neighborCube.position.z;
      let searchX = localX - worldOffsetX;
      let searchZ = localZ - worldOffsetZ;
      
      // Find closest saved point along the edge
      let closestHeight = null;
      let minDist = Infinity;
      
      for (const saved of neighborEdgeData) {
        let dist;
        if (edge === 'north' || edge === 'south') {
          // North/south edges vary in X, match by X coordinate
          dist = Math.abs(saved.localX - searchX);
        } else {
          // East/west edges vary in Z, match by Z coordinate
          dist = Math.abs(saved.localZ - searchZ);
        }
        
        if (dist < minDist) {
          minDist = dist;
          closestHeight = saved.height;
        }
      }
      
      // For corner blending: if we didn't find a close match, try to find ANY edge point
      // This helps when coordinate transformation is slightly off at corners
      if (minDist > 1.0 && neighborEdgeData.length > 0) {
        // Fall back to closest point overall (not just along one axis)
        for (const saved of neighborEdgeData) {
          const distX = Math.abs(saved.localX - searchX);
          const distZ = Math.abs(saved.localZ - searchZ);
          const totalDist = Math.sqrt(distX * distX + distZ * distZ);
          
          if (totalDist < minDist) {
            minDist = totalDist;
            closestHeight = saved.height;
          }
        }
      }
      
      return closestHeight;
    };
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = -positions.getY(i);
      
      const normalizedX = Math.abs(x) / maxDistX;
      const normalizedZ = Math.abs(z) / maxDistZ;
      
      // Generate base terrain - NO EDGE BLENDING
      const height = fbm(x * terrainScale, z * terrainScale, terrainOctaves) * terrainHeightMultiplier;
      const mounds = fbm(x * terrainMoundScale, z * terrainMoundScale, 3) * terrainMoundMultiplier;
      
      let finalHeight = height + mounds;
      
      // SAVE EDGE HEIGHTS FIRST - before any blending is applied
      // This ensures we save PURE terrain noise at edges, not blended values
      // When other terrains read these edges, they get the original heights
      const edgeTolerance = 0.02; // 2% tolerance for "exactly on edge"
      if (normalizedZ > (1 - edgeTolerance) && z > 0) {
        edgeHeights.north.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedZ > (1 - edgeTolerance) && z < 0) {
        edgeHeights.south.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedX > (1 - edgeTolerance) && x > 0) {
        edgeHeights.east.push({ localX: x, localZ: z, height: finalHeight });
      }
      if (normalizedX > (1 - edgeTolerance) && x < 0) {
        edgeHeights.west.push({ localX: x, localZ: z, height: finalHeight });
      }
      
      // Edge zone: 20% of terrain width for smooth blending
      const blendZone = 0.20;
      
      // Check ALL edges for snapping - collect blend data
      const edgeBlends = [];
      
      // North edge check (positive Z, far edge)
      if (cube.snappedEdges && cube.snappedEdges.north && z > 0) {
        if (normalizedZ > (1 - blendZone)) {
          const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('north', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'north', blendFactor, savedHeight });
          }
        }
      }
      
      // South edge check (negative Z, near edge)
      if (cube.snappedEdges && cube.snappedEdges.south && z < 0) {
        if (normalizedZ > (1 - blendZone)) {
          const blendFactor = (normalizedZ - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('south', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'south', blendFactor, savedHeight });
          }
        }
      }
      
      // East edge check (positive X, right edge)
      if (cube.snappedEdges && cube.snappedEdges.east && x > 0) {
        if (normalizedX > (1 - blendZone)) {
          const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('east', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'east', blendFactor, savedHeight });
          }
        }
      }
      
      // West edge check (negative X, left edge)
      if (cube.snappedEdges && cube.snappedEdges.west && x < 0) {
        if (normalizedX > (1 - blendZone)) {
          const blendFactor = (normalizedX - (1 - blendZone)) / blendZone;
          const savedHeight = getSavedEdgeHeight('west', x, z);
          if (savedHeight !== null) {
            edgeBlends.push({ edge: 'west', blendFactor, savedHeight });
          }
        }
      }
      
      // Apply edge blending
      if (edgeBlends.length > 0) {
        let targetEdgeHeight;
        let finalBlendFactor;
        
        if (edgeBlends.length === 1) {
          // Single edge: use that neighbor's height
          targetEdgeHeight = edgeBlends[0].savedHeight;
          finalBlendFactor = edgeBlends[0].blendFactor;
        } else {
          // Multiple edges (corner): Pick the edge with HIGHEST blend factor (closest to edge)
          // This avoids averaging - just use the most dominant neighbor
          const dominantEdge = edgeBlends.reduce((max, curr) => 
            curr.blendFactor > max.blendFactor ? curr : max
          );
          targetEdgeHeight = dominantEdge.savedHeight;
          finalBlendFactor = dominantEdge.blendFactor;
        }
        
        // Smoothstep for smooth transition from interior terrain to neighbor edge
        const smoothBlend = finalBlendFactor * finalBlendFactor * (3 - 2 * finalBlendFactor);
        
        // Blend from interior terrain (0) to neighbor edge (1)
        finalHeight = finalHeight * (1 - smoothBlend) + targetEdgeHeight * smoothBlend;
      }
      
      // Apply sculpting modifications (affects all vertices including edges)
      if (cube.heightModifications && cube.heightModifications.length > 0) {
        for (const mod of cube.heightModifications) {
          const dx = x - mod.x;
          const dz = z - mod.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          
          if (distance < mod.radius) {
            const falloff = 1 - (distance / mod.radius);
            const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
            const heightChange = mod.delta * smoothFalloff;
            finalHeight += heightChange;
          }
        }
      }
      
      // Set the height
      positions.setZ(i, finalHeight);
    }
    
    // Save edge heights to cube (will trigger re-render but that's OK)
    if (typeof CURRENT_PLACED_CUBES !== 'undefined') {
      const cubeToUpdate = CURRENT_PLACED_CUBES.find(c => c.id === cube.id);
      if (cubeToUpdate) {
        cubeToUpdate.savedEdgeHeights = edgeHeights;
      }
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [
    cube.id,
    cube.scale.x, 
    cube.scale.z, 
    cube.terrainSegments, 
    cube.terrainScale, 
    cube.terrainHeightMultiplier,
    cube.terrainMoundScale,
    cube.terrainMoundMultiplier,
    cube.terrainOctaves,
    JSON.stringify(cube.snappedEdges || {}), // Support multiple edge snaps
    JSON.stringify(cube.heightModifications || [])
  ]);
  
  return <primitive object={geometry} attach="geometry" />;
}

// Edge snapping helper for terrain floors
// Detects ALL edges that can snap to neighbors - supports multiple simultaneous snaps
function detectEdgeSnap(movingCube, allCubes, snapDistance = 2.0) {
  if (!movingCube.isTerrain) return null;
  
  const snapThreshold = snapDistance;
  const movingHalfX = movingCube.scale.x / 2;
  const movingHalfZ = movingCube.scale.z / 2;
  
  // Calculate moving cube's edge center positions and directions
  const cosY = Math.cos(movingCube.rotation.y);
  const sinY = Math.sin(movingCube.rotation.y);
  
  // Edge centers and their perpendicular direction vectors
  const movingEdges = {
    north: { 
      center: { x: movingCube.position.x + movingHalfZ * sinY, z: movingCube.position.z + movingHalfZ * cosY },
      perpDir: { x: sinY, z: cosY }, // Direction perpendicular to edge (outward normal)
      parallelDir: { x: cosY, z: -sinY } // Direction parallel to edge
    },
    south: { 
      center: { x: movingCube.position.x - movingHalfZ * sinY, z: movingCube.position.z - movingHalfZ * cosY },
      perpDir: { x: -sinY, z: -cosY },
      parallelDir: { x: cosY, z: -sinY }
    },
    east: { 
      center: { x: movingCube.position.x + movingHalfX * cosY, z: movingCube.position.z - movingHalfX * sinY },
      perpDir: { x: cosY, z: -sinY },
      parallelDir: { x: sinY, z: cosY }
    },
    west: { 
      center: { x: movingCube.position.x - movingHalfX * cosY, z: movingCube.position.z + movingHalfX * sinY },
      perpDir: { x: -cosY, z: sinY },
      parallelDir: { x: sinY, z: cosY }
    }
  };
  
  // Collect ALL snap connections (up to 4 edges can snap simultaneously)
  const snapConnections = {};
  let totalSnapOffsetX = 0;
  let totalSnapOffsetY = 0;
  let totalSnapOffsetZ = 0;
  let snapCount = 0;
  
  // Maximum center-to-center distance to even consider snapping (prevent far away terrains from snapping)
  // Use half the sum of both cubes' dimensions plus a small buffer
  const movingMaxDim = Math.max(movingCube.scale.x, movingCube.scale.z);
  
  // Check against all other terrain cubes
  for (const targetCube of allCubes) {
    if (!targetCube.isTerrain || targetCube.id === movingCube.id) continue;
    
    const targetMaxDim = Math.max(targetCube.scale.x, targetCube.scale.z);
    
    // Pre-filter: Skip if cubes are too far apart (center-to-center)
    // They should only snap if within reach of their combined edge distances + snap threshold
    const maxReasonableDistance = (movingMaxDim / 2) + (targetMaxDim / 2) + snapThreshold + 5;
    const centerDist = Math.sqrt(
      Math.pow(targetCube.position.x - movingCube.position.x, 2) +
      Math.pow(targetCube.position.z - movingCube.position.z, 2)
    );
    
    if (centerDist > maxReasonableDistance) {
      continue; // Too far away, skip this target
    }
    
    const targetHalfX = targetCube.scale.x / 2;
    const targetHalfZ = targetCube.scale.z / 2;
    const targetCosY = Math.cos(targetCube.rotation.y);
    const targetSinY = Math.sin(targetCube.rotation.y);
    
    const targetEdges = {
      north: { 
        center: { x: targetCube.position.x + targetHalfZ * targetSinY, z: targetCube.position.z + targetHalfZ * targetCosY },
        perpDir: { x: targetSinY, z: targetCosY },
        parallelDir: { x: targetCosY, z: -targetSinY }
      },
      south: { 
        center: { x: targetCube.position.x - targetHalfZ * targetSinY, z: targetCube.position.z - targetHalfZ * targetCosY },
        perpDir: { x: -targetSinY, z: -targetCosY },
        parallelDir: { x: targetCosY, z: -targetSinY }
      },
      east: { 
        center: { x: targetCube.position.x + targetHalfX * targetCosY, z: targetCube.position.z - targetHalfX * targetSinY },
        perpDir: { x: targetCosY, z: -targetSinY },
        parallelDir: { x: targetSinY, z: targetCosY }
      },
      west: { 
        center: { x: targetCube.position.x - targetHalfX * targetCosY, z: targetCube.position.z + targetHalfX * targetSinY },
        perpDir: { x: -targetCosY, z: targetSinY },
        parallelDir: { x: targetSinY, z: targetCosY }
      }
    };
    
    // Check all edge combinations for proximity
    const edgePairs = [
      ['north', 'south'], ['south', 'north'],
      ['east', 'west'], ['west', 'east']
    ];
    
    for (const [movingEdgeName, targetEdgeName] of edgePairs) {
      const movingEdge = movingEdges[movingEdgeName];
      const targetEdge = targetEdges[targetEdgeName];
      
      // Calculate perpendicular distance from moving edge to target edge
      // Vector from target edge to moving edge
      const dx = movingEdge.center.x - targetEdge.center.x;
      const dz = movingEdge.center.z - targetEdge.center.z;
      
      // Project onto target edge's perpendicular direction (distance perpendicular to edge)
      const perpDistance = Math.abs(dx * targetEdge.perpDir.x + dz * targetEdge.perpDir.z);
      
      if (perpDistance < snapThreshold) {
        // Only store if this is closer than any existing connection for this edge
        if (!snapConnections[movingEdgeName] || perpDistance < snapConnections[movingEdgeName].perpDistance) {
          // Calculate parallel offset (how far off-center the edges are along the edge direction)
          const parallelOffset = dx * targetEdge.parallelDir.x + dz * targetEdge.parallelDir.z;
          
          // Calculate snap offsets to align edges flush (no gap, no overlap)
          const signedPerpDist = dx * targetEdge.perpDir.x + dz * targetEdge.perpDir.z;
          
          // ONLY align perpendicular (make flush) - don't adjust parallel offset
          // Parallel offset correction can cause issues at corners
          const snapOffsetX = -signedPerpDist * targetEdge.perpDir.x;
          const snapOffsetZ = -signedPerpDist * targetEdge.perpDir.z;
          
          // Calculate Y position to align BOTTOM of terrains (base alignment)
          // Edge blending will handle the height matching at the edges
          // Don't use collision box top - that causes slight lift when blending adjusts heights
          const movingBottom = movingCube.position.y - (movingCube.scale.y / 2);
          const targetBottom = targetCube.position.y - (targetCube.scale.y / 2);
          const yOffset = targetBottom - movingBottom;
          
          // Store this snap connection (overwrite if this is closer)
          snapConnections[movingEdgeName] = {
            targetCubeId: targetCube.id,
            targetEdge: targetEdgeName,
            snapOffset: { x: snapOffsetX, y: yOffset, z: snapOffsetZ },
            perpDistance
          };
        }
      }
    }
  }
  
  // If we found any snaps, calculate the combined offset
  snapCount = Object.keys(snapConnections).length;
  
  if (snapCount > 0) {
    let combinedSnapOffset;
    
    if (snapCount === 1) {
      // Single edge - use the offset directly from the initial detection
      const connection = Object.values(snapConnections)[0];
      combinedSnapOffset = { ...connection.snapOffset };
    } else {
      // Multiple edges (corner snap)
      // At corners, we need BOTH edge corrections applied independently
      // Don't sum - use each edge's full correction for its respective axis
      const connections = Object.entries(snapConnections);
      let xOffset = 0, zOffset = 0, ySum = 0;
      
      for (const [edgeName, conn] of connections) {
        ySum += conn.snapOffset.y;
        
        // North/South edges correct Z position
        if (edgeName === 'north' || edgeName === 'south') {
          zOffset = conn.snapOffset.z;
        }
        // East/West edges correct X position  
        else if (edgeName === 'east' || edgeName === 'west') {
          xOffset = conn.snapOffset.x;
        }
      }
      
      combinedSnapOffset = {
        x: xOffset,
        y: ySum / snapCount,
        z: zOffset
      };
    }
    
    return {
      snapConnections, // Object: { edgeName: { targetCubeId, targetEdge, snapOffset, perpDistance } }
      averageSnapOffset: combinedSnapOffset, // Use this for position adjustment
      snapCount
    };
  }
  
  return null;
}

// AI Content Renderer - converts structured data to Three.js meshes
function AIContentRenderer({ contentData, boxScale, position, rotation }) {
  console.log('[AIContentRenderer] Called with:', { contentData, boxScale, position, rotation });
  
  if (!contentData || !contentData.type) {
    console.log('[AIContentRenderer] No content data or type');
    return null;
  }
  
  console.log('[AIContentRenderer] Rendering', contentData.parts?.length, 'parts');
  
  // contentData structure example:
  // {
  //   type: 'robot',
  //   parts: [
  //     { name: 'head', shape: 'sphere', position: [0, 0.3, 0], scale: [0.2, 0.2, 0.2], color: '#ffcc00' },
  //     { name: 'body', shape: 'box', position: [0, 0, 0], scale: [0.3, 0.4, 0.25], color: '#3366ff' },
  //     ...
  //   ]
  // }
  
  return (
    <group position={position} rotation={rotation}>
      {contentData.parts && contentData.parts.map((part, index) => {
        // Convert 0-1 normalized coordinates to centered positions
        // 0.5 = center, so we need to offset by -0.5 and then scale
        const scaledPos = [
          (part.position[0] - 0.5) * boxScale.x,
          (part.position[1] - 0.5) * boxScale.y,
          (part.position[2] - 0.5) * boxScale.z
        ];
        const scaledScale = [
          part.scale[0] * boxScale.x,
          part.scale[1] * boxScale.y,
          part.scale[2] * boxScale.z
        ];
        
        return (
          <mesh
            key={`${contentData.type}-${part.name}-${index}`}
            position={scaledPos}
            rotation={part.rotation || [0, 0, 0]}
            castShadow
            receiveShadow
          >
            {part.shape === 'sphere' && <sphereGeometry args={[scaledScale[0], 32, 32]} />}
            {part.shape === 'box' && <boxGeometry args={scaledScale} />}
            {part.shape === 'cylinder' && <cylinderGeometry args={[scaledScale[0], scaledScale[0], scaledScale[1], 32]} />}
            {part.shape === 'cone' && <coneGeometry args={[scaledScale[0], scaledScale[1], 32]} />}
            {part.shape === 'torus' && <torusGeometry args={[scaledScale[0], scaledScale[1], 16, 32]} />}
            
            <meshStandardMaterial
              color={part.color || '#ffffff'}
              metalness={part.metalness || 0.3}
              roughness={part.roughness || 0.7}
              emissive={part.emissive || '#000000'}
              emissiveIntensity={part.emissiveIntensity || 0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// Component to sync AI content position with mesh position
function AIContentSyncedWithMesh({ meshRef, contentData, cubePosition, cubeRotation, cubeScale, isSelected }) {
  const groupRef = React.useRef();
  
  // Sync position with mesh on every frame when selected
  useFrame(() => {
    if (meshRef.current && groupRef.current) {
      if (isSelected) {
        // Follow meshRef position when selected (being transformed)
        groupRef.current.position.copy(meshRef.current.position);
        groupRef.current.rotation.copy(meshRef.current.rotation);
        groupRef.current.scale.copy(meshRef.current.scale);
      }
    }
  });
  
  // Set initial position from cube state
  React.useEffect(() => {
    if (groupRef.current && !isSelected) {
      groupRef.current.position.set(cubePosition.x, cubePosition.y, cubePosition.z);
      groupRef.current.rotation.set(cubeRotation.x, cubeRotation.y, cubeRotation.z);
      groupRef.current.scale.set(cubeScale.x, cubeScale.y, cubeScale.z);
    }
  }, [cubePosition, cubeRotation, cubeScale, isSelected]);
  
  return (
    <group ref={groupRef}>
      <AIContentRenderer
        contentData={contentData}
        boxScale={{ x: 1, y: 1, z: 1 }}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
      />
    </group>
  );
}

function PlacedCube({ cube, isSelected, onSelect, editMode, dragMode, transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap, onTransformEnd, showCollisionMeshes, orbitControlsRef, snapConfirmDialog, setSnapConfirmDialog, pendingSnapCubeId, setPendingSnapCubeId, placedCubes }) {
  const meshRef = React.useRef();
  const transformRef = React.useRef();
  const [isSnapped, setIsSnapped] = React.useState(false);
  
  // If this cube is a child (has parentId), follow parent's transform in real-time
  useFrame(() => {
    if (cube.parentId && meshRef.current) {
      const parentTransform = window.__CF_PARENT_TRANSFORMS__?.[cube.parentId];
      if (parentTransform && cube.followParentScale) {
        // Get parent's current transform from the scene
        meshRef.current.position.copy(parentTransform.position);
        
        // Recalculate scale based on parent's bounds and current scale
        const parentCube = CURRENT_PLACED_CUBES.find(c => c.id === cube.parentId);
        if (parentCube && parentCube.modelBounds) {
          const bounds = parentCube.modelBounds;
          meshRef.current.scale.set(
            bounds.width * parentTransform.scale.x,
            bounds.height * parentTransform.scale.y,
            bounds.depth * parentTransform.scale.z
          );
        }
        
        // Force update of mesh matrix for all children (helpers, wireframes, etc.)
        meshRef.current.updateMatrix();
        meshRef.current.updateMatrixWorld(true); // true = force update children
        
        // Update TransformControls to follow the mesh
        if (transformRef.current) {
          transformRef.current.updateMatrixWorld();
        }
      }
    }
  });
  
  // Render primitive shapes (box/sphere) for collision objects
  // Send live transform updates while dragging + final on mouseUp
  const isDragging = React.useRef(false);
  const lastBroadcastRef = React.useRef(0);
  
  React.useEffect(() => {
    if (transformRef.current && meshRef.current) {
      const controls = transformRef.current;
      
      const handleDraggingChanged = (event) => {
        isDragging.current = event.value;
        
        // When starting to drag a terrain, clear its snappedEdges
        // because it's no longer in the snapped position
        if (event.value && cube.isTerrain && cube.snappedEdges && Object.keys(cube.snappedEdges).length > 0) {
          if (onTransformEnd) {
            onTransformEnd({ snappedEdges: {} });
          }
        }
      };
      
      const handleMouseUp = () => {
        if (!meshRef.current) return;
        const { position, rotation, scale } = meshRef.current;
        
        // Immediately set targets to current position to prevent snap-back
        targetPos.current.copy(position);
        targetRot.current.copy(rotation);
        targetScale.current.copy(scale);
        
        // Check for snap at the FINAL position (mouseUp), not during drag
        if (cube.isTerrain) {
          const mainFloorTerrain = {
            id: 'main-floor',
            isTerrain: true,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 100, y: 1, z: 100 },
            hasTerrainNoise: true
          };
          
          const snapInfo = detectEdgeSnap(
            {
              ...cube,
              position: { x: position.x, y: position.y, z: position.z },
              rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
              scale: { x: scale.x, y: scale.y, z: scale.z }
            },
            [...CURRENT_PLACED_CUBES, mainFloorTerrain],
            2.0
          );
          
          if (snapInfo) {
            // Build detailed message showing terrain IDs and edges
            const connections = Object.entries(snapInfo.snapConnections).map(([edgeName, conn]) => {
              const terrainCubes = placedCubes.filter(c => c.isTerrain);
              const terrainIndex = terrainCubes.findIndex(c => c.id === conn.targetCubeId) + 1;
              return `Terrain #${terrainIndex} (${edgeName} edge)`;
            }).join(', ');
            
            // Show confirmation dialog with CURRENT position (at mouseUp)
            setSnapConfirmDialog({
              cubeId: cube.id,
              snapInfo: snapInfo,
              position: { x: position.x, y: position.y, z: position.z }, // Use current position, not pre-snap
              message: `Edge snapping detected!\nSnapping to ${connections}\nDo you want to snap?`
            });
            setPendingSnapCubeId(cube.id);
            return; // Don't send transform update yet
          }
        }
        
        // Check if snap was detected during drag (old path, shouldn't happen now)
        if (meshRef.current.userData.pendingSnapInfo) {
          const snapInfo = meshRef.current.userData.pendingSnapInfo;
          
          // Build detailed message showing terrain IDs and edges
          const connections = Object.entries(snapInfo.snapConnections).map(([edgeName, conn]) => {
            const terrainCubes = placedCubes.filter(c => c.isTerrain);
            const terrainIndex = terrainCubes.findIndex(c => c.id === conn.targetCubeId) + 1;
            return `Terrain #${terrainIndex} (${edgeName} edge)`;
          }).join(', ');
          
          // Show confirmation dialog
          setSnapConfirmDialog({
            cubeId: cube.id,
            snapInfo: snapInfo,
            position: { ...meshRef.current.userData.preSnapPosition },
            message: `Edge snapping detected!\nSnapping to ${connections}\nDo you want to snap?`
          });
          setPendingSnapCubeId(cube.id);
          return; // Don't send transform update yet
        }
        
        const updates = {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        };
        
        // Include snap information if present (supports multiple edges)
        if (meshRef.current.userData.snapInfo && meshRef.current.userData.snapInfo.snapConnections) {
          // Convert snapConnections to snappedEdges format: { edgeName: neighborCubeId }
          const snappedEdges = {};
          for (const [edgeName, connection] of Object.entries(meshRef.current.userData.snapInfo.snapConnections)) {
            snappedEdges[edgeName] = connection.targetCubeId;
          }
          updates.snappedEdges = snappedEdges;
        } else {
          updates.snappedEdges = {};
        }
        
        // Send final snapped position to opponent
        if (onTransformEnd) onTransformEnd(updates);
      };
      
      controls.addEventListener('dragging-changed', handleDraggingChanged);
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChanged);
        controls.removeEventListener('mouseUp', handleMouseUp);
      };
    }
  }, [onTransformEnd, cube.isTerrain, cube.snappedEdges, placedCubes]);
  
  // LIVE TRANSFORM BROADCAST for primitives (box/sphere/cylinder)
  // Also applies edge snapping for terrain floors
  useFrame(() => {
    if (!isDragging.current || !meshRef.current) return;
    
    // Throttle to ~30fps
    const now = performance.now();
    if (now - lastBroadcastRef.current < 33) return;
    lastBroadcastRef.current = now;
    
    const { position, rotation, scale } = meshRef.current;
    
    // Apply edge snapping for terrain floors during translate mode
    if (cube.isTerrain && transformMode === 'translate') {
      // Skip snap detection if this cube is already pending confirmation
      if (pendingSnapCubeId === cube.id) return;
      
      // Create virtual main floor terrain for snapping
      const mainFloorTerrain = {
        id: 'main-floor',
        isTerrain: true,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 100, y: 1, z: 100 }, // Approximate size of main floor
        hasTerrainNoise: true
      };
      
      const snapInfo = detectEdgeSnap(
        {
          ...cube,
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
          scale: { x: scale.x, y: scale.y, z: scale.z }
        },
        [...CURRENT_PLACED_CUBES, mainFloorTerrain], // Include main floor in snap candidates
        2.0 // Snap distance threshold
      );
      
      if (snapInfo) {
        // Store snap info but DON'T apply yet - show confirmation dialog
        meshRef.current.userData.pendingSnapInfo = snapInfo;
        meshRef.current.userData.preSnapPosition = { x: position.x, y: position.y, z: position.z };
        setIsSnapped(true);
      } else {
        delete meshRef.current.userData.pendingSnapInfo;
        delete meshRef.current.userData.preSnapPosition;
        setIsSnapped(false);
      }
    }
    
    if (onTransformEnd) {
      // Convert snapConnections to snappedEdges for broadcast
      const snappedEdges = {};
      if (meshRef.current.userData.snapInfo && meshRef.current.userData.snapInfo.snapConnections) {
        for (const [edgeName, connection] of Object.entries(meshRef.current.userData.snapInfo.snapConnections)) {
          snappedEdges[edgeName] = connection.targetCubeId;
        }
      }
      
      onTransformEnd({
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
        scale: { x: scale.x, y: scale.y, z: scale.z },
        isLive: true,
        snappedEdges: snappedEdges
      });
    }
  });
  
  // Update transform controls mode and snap
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  // SMOOTH INTERPOLATION for primitives (box/sphere/cylinder) when opponent sees live updates
  const targetPos = React.useRef(new THREE.Vector3());
  const targetRot = React.useRef(new THREE.Euler());
  const targetScale = React.useRef(new THREE.Vector3(1, 1, 1));
  
  // When FIRST selected, initialize position from cube state
  // (Only when transitioning from unselected -> selected, not the reverse)
  const wasSelected = React.useRef(false);
  React.useEffect(() => {
    if (isSelected && !wasSelected.current && meshRef.current && cube) {
      // Transitioning to selected state - set initial position
      meshRef.current.position.set(cube.position.x, cube.position.y, cube.position.z);
      meshRef.current.rotation.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      meshRef.current.scale.set(cube.scale.x, cube.scale.y, cube.scale.z);
      // Also set targets to prevent lerping
      targetPos.current.set(cube.position.x, cube.position.y, cube.position.z);
      targetRot.current.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      targetScale.current.set(cube.scale.x, cube.scale.y, cube.scale.z);
    }
    wasSelected.current = isSelected;
  }, [isSelected, cube]);
  
  React.useEffect(() => {
    if (cube && !cube.parentId && !isDragging.current) {
      targetPos.current.set(cube.position.x, cube.position.y, cube.position.z);
      targetRot.current.set(cube.rotation.x, cube.rotation.y, cube.rotation.z);
      targetScale.current.set(cube.scale.x, cube.scale.y, cube.scale.z);
    }
  }, [cube]);
  
  // Ultra-smooth interpolation for opponent watching the transform
  useFrame((_, delta) => {
    if (!meshRef.current || isDragging.current || cube.parentId) return;
    
    const lerpFactor = Math.min(1, delta * 50); // Super smooth for opponent
    
    meshRef.current.position.lerp(targetPos.current, lerpFactor);
    meshRef.current.rotation.x += (targetRot.current.x - meshRef.current.rotation.x) * lerpFactor;
    meshRef.current.rotation.y += (targetRot.current.y - meshRef.current.rotation.y) * lerpFactor;
    meshRef.current.rotation.z += (targetRot.current.z - meshRef.current.rotation.z) * lerpFactor;
    meshRef.current.scale.lerp(targetScale.current, lerpFactor);
  });
  
  // Load texture if cube has one (for terrain) - MUST be before any conditional returns
  const [texture, setTexture] = React.useState(null);
  
  React.useEffect(() => {
    if (cube.texture && cube.texture !== '') {
      console.log('[TEXTURE LOAD] 📥 Loading texture:', cube.texture, 'for cube:', cube.id);
      const loader = new THREE.TextureLoader();
      loader.load(
        cube.texture,
        (loadedTexture) => {
          console.log('[TEXTURE LOAD] ✅ Successfully loaded:', cube.texture, 'for cube:', cube.id);
          if (cube.isTerrain) {
            loadedTexture.wrapS = loadedTexture.wrapT = THREE.RepeatWrapping;
            const repeatScale = cube.textureRepeat || 10;
            loadedTexture.repeat.set(repeatScale, repeatScale);
          }
          setTexture(loadedTexture);
        },
        undefined,
        (err) => {
          console.error('[TEXTURE LOAD] ❌ Failed to load:', cube.texture, err);
          setTexture(null);
        }
      );
    } else {
      console.log('[TEXTURE LOAD] ⭕ No texture for cube:', cube.id, '(isTerrain:', cube.isTerrain, 'texture:', cube.texture, ')');
      setTexture(null);
    }
  }, [cube.texture, cube.isTerrain, cube.textureRepeat, cube.id]);
  
  // Update texture repeat to maintain square tiles even with non-uniform scaling
  React.useEffect(() => {
    if (texture && cube.isTerrain) {
      const repeatValue = cube.textureRepeat || 10;
      const scaleX = cube.scale?.x || 1;
      const scaleZ = cube.scale?.z || 1;
      
      // Calculate aspect ratio and adjust repeat to keep tiles square
      // If floor is wider in X, use more repeat in X direction
      const aspectRatio = scaleX / scaleZ;
      
      if (aspectRatio > 1) {
        // Wider in X direction
        texture.repeat.set(repeatValue * aspectRatio, repeatValue);
      } else {
        // Wider in Z direction (or square)
        texture.repeat.set(repeatValue, repeatValue / aspectRatio);
      }
      
      texture.needsUpdate = true;
    }
  }, [texture, cube.textureRepeat, cube.scale?.x, cube.scale?.z, cube.isTerrain]);
  
  // Debug: Log material properties for terrain - MUST be before any conditional returns
  React.useEffect(() => {
    if (cube.isTerrain) {
      console.log('[MATERIAL DEBUG] Cube:', cube.id, {
        hasTextureProp: !!cube.texture,
        textureValue: cube.texture,
        textureState: texture ? 'loaded' : 'null',
        willShowColor: texture ? '#ffffff' : '#22c55e'
      });
    }
  }, [cube.isTerrain, cube.texture, texture, cube.id]);
  
  // Define shape variables - MUST be before any conditional returns
  const isSphere = cube.shape === 'sphere';
  const isCylinder = cube.shape === 'cylinder';
  
  // Route to specialized components for 3D models (after all hooks)
  // Check for customModelPath first (handles all models from props folder)
  if (cube.customModelPath) {
    return <CustomPlacedModel cube={cube} isSelected={isSelected} onSelect={onSelect} editMode={editMode} dragMode={dragMode} transformMode={transformMode} snap={snap} translateSnap={translateSnap} rotateSnapDeg={rotateSnapDeg} scaleSnap={scaleSnap} onTransformEnd={onTransformEnd} showCollisionMeshes={showCollisionMeshes} />;
  }
  
  // Legacy hardcoded model types (for backward compatibility)
  if (cube.modelType === 'asteroid') {
    return <AsteroidPlacedModel cube={cube} isSelected={isSelected} onSelect={onSelect} editMode={editMode} dragMode={dragMode} transformMode={transformMode} snap={snap} translateSnap={translateSnap} rotateSnapDeg={rotateSnapDeg} scaleSnap={scaleSnap} onTransformEnd={onTransformEnd} />;
  }
  
  if (cube.modelType === 'rover') {
    return <RoverPlacedModel cube={cube} isSelected={isSelected} onSelect={onSelect} editMode={editMode} dragMode={dragMode} transformMode={transformMode} snap={snap} translateSnap={translateSnap} rotateSnapDeg={rotateSnapDeg} scaleSnap={scaleSnap} onTransformEnd={onTransformEnd} />;
  }
  
  if (cube.modelType === 'table') {
    return <TablePlacedModel cube={cube} isSelected={isSelected} onSelect={onSelect} editMode={editMode} dragMode={dragMode} transformMode={transformMode} snap={snap} translateSnap={translateSnap} rotateSnapDeg={rotateSnapDeg} scaleSnap={scaleSnap} onTransformEnd={onTransformEnd} />;
  }
  
  if (cube.modelType === 'stairs2') {
    return <Stairs2PlacedModel cube={cube} isSelected={isSelected} editMode={editMode} dragMode={dragMode} transformMode={transformMode} snap={snap} translateSnap={translateSnap} rotateSnapDeg={rotateSnapDeg} scaleSnap={scaleSnap} onTransformEnd={onTransformEnd} showCollisionBoxes={showCollisionMeshes} />;
  }
  
  // Don't render anything if collision meshes are hidden (except terrain - always show terrain)
  if (!showCollisionMeshes && !cube.isTerrain && !cube.isAIBox) return null;
  
  // Render primitive shapes (box/sphere/cylinder) for collision objects
  return (
    <>
      {dragMode && editMode ? (
        // Wrap in DraggableObject for free drag mode
        <DraggableObject cube={cube} editMode={editMode} dragMode={dragMode} isSelected={isSelected} onDragEnd={onTransformEnd}>
          <mesh
            ref={meshRef}
            rotation={[cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={[cube.scale.x, cube.scale.y, cube.scale.z]}
            castShadow
            receiveShadow
          >
            {isSphere ? (
              <sphereGeometry args={[0.5, 32, 32]} />
            ) : isCylinder ? (
              <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
            ) : (
              <boxGeometry args={[1, 1, 1]} />
            )}
            <meshStandardMaterial 
              key={`material-${cube.id}-${texture ? 'textured' : 'notextured'}-${cube.isAIBox ? 'aibox' : 'normal'}`}
              color={isSelected && !cube.isTerrain ? '#10b981' : (cube.isTerrain ? (texture ? '#ffffff' : '#22c55e') : cube.color)}
              metalness={0.3}
              roughness={0.7}
              transparent={cube.isTerrain ? !texture : true}
              opacity={cube.isAIBox ? 0.15 : (cube.isTerrain ? (texture ? 1 : 0.6) : (texture ? 1 : 0.7))}
              wireframe={cube.isAIBox || !cube.hasCollision}
              map={texture || undefined}
            />
          </mesh>
        </DraggableObject>
      ) : (
        <group>
          {/* Main collision box - always render but make invisible when terrain noise is on and collision boxes hidden */}
          <mesh
            ref={meshRef}
            position={cube.parentId || isSelected ? undefined : [cube.position.x, cube.position.y, cube.position.z]}
            rotation={isSelected ? undefined : [cube.rotation.x, cube.rotation.y, cube.rotation.z]}
            scale={cube.parentId || isSelected ? undefined : [cube.scale.x, cube.scale.y, cube.scale.z]}
            castShadow={!(cube.isTerrain && cube.hasTerrainNoise && !showCollisionMeshes)}
            receiveShadow={!(cube.isTerrain && cube.hasTerrainNoise && !showCollisionMeshes)}
            onClick={(e) => {
              if (editMode) {
                e.stopPropagation();
                onSelect();
              }
            }}
            visible={
              cube.isAIBox 
                ? (showCollisionMeshes || isSelected) // AI Box visible when collision meshes shown OR when selected
                : !(cube.isTerrain && cube.hasTerrainNoise && !showCollisionMeshes)
            }
          >
            {isSphere ? (
              <sphereGeometry args={[0.5, 32, 32]} />
            ) : isCylinder ? (
              <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
            ) : (
              <boxGeometry args={[1, 1, 1]} />
            )}
            <meshStandardMaterial 
              key={`material-${cube.id}-${texture ? 'textured' : 'notextured'}-${cube.hasTerrainNoise ? 'terrain' : 'flat'}-${isSnapped ? 'snapped' : 'unsnapped'}-${cube.isAIBox ? 'aibox' : 'normal'}`}
              color={isSelected && !cube.isTerrain ? '#10b981' : (isSnapped && cube.isTerrain ? '#0ea5e9' : (cube.isTerrain ? (cube.hasTerrainNoise ? '#22c55e' : (texture ? '#ffffff' : '#22c55e')) : cube.color))}
              metalness={0.3}
              roughness={0.7}
              transparent={cube.isTerrain ? true : true}
              opacity={cube.isAIBox ? 0.15 : (cube.isTerrain ? (cube.hasTerrainNoise ? 0.6 : (texture ? 1 : 0.6)) : (editMode ? (texture ? 1 : 0.7) : (texture ? 1 : 0.5)))}
              wireframe={cube.isAIBox || !cube.hasCollision}
              map={cube.isTerrain && cube.hasTerrainNoise ? undefined : (texture || undefined)}
              emissive={isSnapped && cube.isTerrain ? '#0ea5e9' : (cube.isAIBox ? '#22d3ee' : '#000000')}
              emissiveIntensity={isSnapped && cube.isTerrain ? 0.5 : (cube.isAIBox ? 0.5 : 0)}
            />
          </mesh>
          
          {/* AI-Generated Content - synced with mesh position via useFrame */}
          {cube.isAIBox && (cube.aiContentData || cube.aiContent) && (
            <AIContentSyncedWithMesh
              meshRef={meshRef}
              contentData={cube.aiContentData || cube.aiContent}
              cubePosition={cube.position}
              cubeRotation={cube.rotation}
              cubeScale={cube.scale}
              isSelected={isSelected}
            />
          )}
          
          {/* Terrain surface mesh on top - only if terrain noise enabled */}
          {cube.isTerrain && cube.hasTerrainNoise && (
            <mesh
              ref={(el) => {
                if (el) el.userData.terrainId = cube.id;
              }}
              position={[
                cube.position.x,
                cube.position.y + (cube.scale.y / 2), // Position on top of the box
                cube.position.z
              ]}
              rotation={[
                cube.rotation.x + (-Math.PI / 2), // Horizontal rotation + cube's X rotation
                cube.rotation.y, // Cube's Y rotation
                cube.rotation.z  // Cube's Z rotation
              ]}
              castShadow
              receiveShadow
            >
              <TerrainGeometry cube={cube} />
              <meshStandardMaterial 
                key={`terrain-surface-${cube.id}-${texture ? 'textured' : 'notextured'}`}
                color={texture ? '#ffffff' : '#22c55e'}
                metalness={0.3}
                roughness={0.7}
                map={texture || undefined}
              />
            </mesh>
          )}
          
          {/* Debug AI Box data */}
          {cube.isAIBox && console.log('[DEBUG] AI Box found:', {
            id: cube.id,
            label: cube.aiBoxLabel,
            hasAiContent: !!cube.aiContent,
            hasAiContentData: !!cube.aiContentData,
            aiContent: cube.aiContent,
            aiContentData: cube.aiContentData
          })}
          
          {/* AI Box Label - floating text above the box */}
          {cube.isAIBox && cube.aiBoxLabel && (
            <Billboard
              follow={true}
              position={[
                cube.position.x,
                cube.position.y + (cube.scale.y / 2) + 3,
                cube.position.z
              ]}
            >
              <Text
                fontSize={1.5}
                color={'#22d3ee'}
                anchorX="center"
                anchorY="bottom"
                outlineWidth={0.1}
                outlineColor={'#000'}
                font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}
              >
                {`🤖 ${cube.aiBoxLabel}`}
              </Text>
              <Text
                fontSize={0.8}
                color={'#cbd5e1'}
                anchorX="center"
                anchorY="top"
                position={[0, -0.5, 0]}
                outlineWidth={0.05}
                outlineColor={'#000'}
                font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}
              >
                {(cube.aiContentData || cube.aiContent) ? 'Content Generated ✓' : 'Awaiting AI Content...'}
              </Text>
            </Billboard>
          )}
          
          {/* Always show TransformControls when selected, even in drag mode */}
          {isSelected && editMode && meshRef.current && (
            <TransformControls
              ref={transformRef}
              object={meshRef.current}
              mode={transformMode}
              enabled={!dragMode}
            />
          )}
        </group>
      )}
    </>
  );
}

function SideSupports() {
  // Inner grid width
  const w  = COLS * (CELL + GAP) - GAP;
  // Frame outer dims (must match FrontPlate)
  const fw = COLS * (CELL + GAP) - GAP + 0.6; // frame width
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // frame height

  // Table-mounted: triangular brackets at frame base + shallow tray beam
  const legWidth  = 1.05;                                      // bracket base width (x)
  const legHeight = Math.min(1.6, Math.max(1.1, fh * 0.55));   // bracket rise (y)
  const legDepth  = 1.6;                                       // bracket depth (z)

  const trayW = Math.max(fw - 0.2, w + 0.6);  // tray spans nearly the frame
  const trayH = 0.16;                          // tray height
  const trayD = 1.2;                           // tray depth

  // Y positions relative to board center (board bottom is ~ -fh/2)
  const baseY = -fh / 2;                      // frame base
  const trayY = baseY + trayH / 2 + 0.02;     // just above base

  const color = '#1e3a8a';

  // Right-triangle prism with bevels; centered in Z afterward
  const triGeom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(legWidth, 0);
    shape.lineTo(0, legHeight);
    shape.lineTo(0, 0);
    const eg = new THREE.ExtrudeGeometry(shape, {
      depth: legDepth,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      curveSegments: 16,
      steps: 1,
    });
    // center on Z so zAttach places it correctly
    eg.translate(0, 0, -legDepth / 2);
    return eg;
  }, [legWidth, legHeight, legDepth]);

  const zAttach = -BOARD_THICK * 0.6; // align with FrontPlate plane

  return (
    <group>
      {/* Bottom tray beam connecting both sides (table-mounted) */}
      <mesh position={[0, trayY, zAttach]} castShadow receiveShadow>
        <boxGeometry args={[trayW, trayH, trayD]} />
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
      {/* Triangular side brackets flushed to frame sides */}
      <mesh geometry={triGeom} position={[ fw / 2, baseY, zAttach]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
      <mesh geometry={triGeom} position={[-fw / 2, baseY, zAttach]} rotation={[0, Math.PI, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
    </group>
  );
}

// Shadow catcher behind the frame so board-hole shadows have a surface
function BackShadowCatcher({ opacity = 0.14 }){
  const innerW = COLS * (CELL + GAP) - GAP + 0.2;
  const innerH = ROWS * (CELL + GAP) - GAP + 0.2;
  const z = -BOARD_THICK - 0.35;
  return (
    <mesh position={[0, 0, z]} receiveShadow>
      <planeGeometry args={[innerW, innerH]} />
      <shadowMaterial transparent opacity={opacity * 0.8} />
    </mesh>
  );
}

// New: Load an asteroid prop (FBX) and place it somewhere on the ground
function AsteroidFBXProp({ position = [18, 0, -22], scale = 0.06, rotation = [0, 0.4, 0] }){
  const src = useFBX('/models/props/asteroid/asteroid.fbx');
  // Clone so multiple instances can be rendered safely
  const model = useMemo(() => (src ? skeletonClone(src) : null), [src]);
  // Drop to ground and enable shadows on this clone
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      const minY = box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (isFinite(minY)) model.position.y += -minY;
    } catch {}
  }, [model]);
  if (!model) return null;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

// Scatter a handful of asteroid FBXs across the ground with varied sizes (one large)
function AsteroidScatter({ count = 9, seed = 1337, radius = TERRAIN_RADIUS - 20, minScale = 0.045, maxScale = 0.12, bigScale = 0.28 }){
  const src = useFBX('/models/props/asteroid/asteroid.fbx');
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  // Seeded RNG for stable layout across renders
  const rng = useMemo(() => {
    let s = (seed >>> 0) || 1;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  }, [seed]);
  const placements = useMemo(() => {
    const list = [];
    const rMin = Math.max(20, radius * 0.25);
    const rMax = Math.max(rMin + 10, radius * 0.95);
    for (let i = 0; i < count; i++) {
      const a = (rng() * Math.PI * 2);
      // Slight Poisson-like spacing by nudging angle/radius
      const r = rMin + (rMax - rMin) * Math.pow(rng(), 0.65);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Avoid placing right under the Connect Four table area (keep a small central donut)
      if (Math.hypot(x, z) < 22) {
        const rr = 22 + rng() * 12; // push outward a bit
        const aa = a + (rng() - 0.5) * 0.4;
        list.push({ x: Math.cos(aa) * rr, z: Math.sin(aa) * rr });
      } else {
        list.push({ x, z });
      }
    }
    // Assign scales/rotations with one big one
    const bigIdx = Math.floor(rng() * count);
    return list.map((p, i) => ({
      ...p,
      scale: i === bigIdx ? bigScale : (minScale + (maxScale - minScale) * rng()),
      rot: [0, rng() * Math.PI * 2, 0], // Only random yaw (Y rotation), keep X and Z at 0
      // Calculate terrain height for this position
      terrainY: getTerrainHeightXZ(p.x, p.z)
    }));
  }, [count, radius, rng, minScale, maxScale, bigScale]);

  // Create per-instance clones and ground them to y=0 (local)
  const clones = useMemo(() => {
    if (!src) return [];
    return placements.map(() => skeletonClone(src));
  }, [src, placements]);
  useLayoutEffect(() => {
    clones.forEach(cl => {
      try {
        const box = new THREE.Box3().setFromObject(cl);
        const minY = box.min.y;
        cl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        if (isFinite(minY)) cl.position.y += -minY;
      } catch {}
    });
  }, [clones]);

  if (!src) return null;
  return (
    <group>
      {placements.map((p, i) => (
        <group key={i} position={[p.x, groundY + p.terrainY, p.z]} rotation={p.rot} scale={p.scale}>
          {clones[i] ? <primitive object={clones[i]} /> : null}
        </group>
      ))}
    </group>
  );
}

// Rocket Pedestal component for the platform
function RocketPedestal({ position = [0, 0, 0], scale = 0.15, onLaunchClick = null, rocketPositionRef = null, onFollowRocket = null, showCollisionMeshes = false }) {
  const src = useFBX('/models/props/rocket/rocket_pedestal.fbx');
  const [mountKey, setMountKey] = useState(0);
  const model = useMemo(() => {
    if (!src) return null;
    const cloned = skeletonClone(src);
    // Reset scale on clone to prevent accumulation
    if (cloned) {
      cloned.scale.set(1, 1, 1);
      cloned.position.set(0, 0, 0);
      cloned.rotation.set(0, 0, 0);
    }
    return cloned;
  }, [src, mountKey]);
  
  const [yOffset, setYOffset] = useState(0);
  
  // Rocket flight physics
  const rocketPosRef = useRef(new THREE.Vector3(...position));
  const rocketVelRef = useRef(new THREE.Vector3(0, 0, 0));
  const launchTimeRef = useRef(null); // Will be set when button is clicked
  const [hasLaunched, setHasLaunched] = useState(false);
  const [launchRequested, setLaunchRequested] = useState(false);
  const groupRef = useRef();
  
  // Handle launch button click
  const handleLaunch = useCallback(() => {
    if (!launchRequested && !hasLaunched) {
      setLaunchRequested(true);
      launchTimeRef.current = Date.now() + 1000; // Launch 1 second after button press
      if (onLaunchClick) onLaunchClick();
      if (onFollowRocket) onFollowRocket(true); // Start following rocket
    }
  }, [launchRequested, hasLaunched, onLaunchClick, onFollowRocket]);
  
  // Earth target position - 10x further away with scaled up size
  const EARTH_POS = new THREE.Vector3(-4000, 2000, 3000);
  
  // Smoke particles for rocket exhaust
  const smokeParticlesRef = useRef([]);
  const smokeGeometryRef = useRef();
  const smokeMaterialRef = useRef();
  
  // Initialize smoke particles
  useEffect(() => {
    const particleCount = 50;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: 0,
        y: 0,
        z: 0,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 8 + 4,
        vz: (Math.random() - 0.5) * 2,
        life: Math.random(),
        maxLife: 1.0 + Math.random() * 0.5,
        size: 2 + Math.random() * 3
      });
    }
    smokeParticlesRef.current = particles;
  }, []);
  
  // Animate smoke particles and rocket flight
  useFrame((_, delta) => {
    const now = Date.now();
    
    // Rocket launch physics
    if (groupRef.current && launchTimeRef.current && now > launchTimeRef.current) {
      if (!hasLaunched) {
        setHasLaunched(true);
      }
      
      // Calculate time since launch
      const timeSinceLaunch = (now - launchTimeRef.current) / 1000; // in seconds
      
      // Phase 1: Fly straight up for first 3 seconds
      // Phase 2: Gradually turn towards Earth over next 4 seconds
      // Phase 3: Full thrust towards Earth after 7 seconds
      
      const VERTICAL_PHASE_DURATION = 3.0; // Fly straight up for 3 seconds
      const TURN_PHASE_DURATION = 4.0; // Turn over 4 seconds
      const TURN_START_TIME = VERTICAL_PHASE_DURATION;
      const TURN_END_TIME = TURN_START_TIME + TURN_PHASE_DURATION;
      
      let targetDirection;
      
      if (timeSinceLaunch < VERTICAL_PHASE_DURATION) {
        // Phase 1: Straight up
        targetDirection = new THREE.Vector3(0, 1, 0);
      } else if (timeSinceLaunch < TURN_END_TIME) {
        // Phase 2: Smooth turn from vertical to Earth direction
        const turnProgress = (timeSinceLaunch - TURN_START_TIME) / TURN_PHASE_DURATION;
        const easedProgress = turnProgress * turnProgress * (3 - 2 * turnProgress); // Smoothstep easing
        
        const upDirection = new THREE.Vector3(0, 1, 0);
        const earthDirection = new THREE.Vector3().subVectors(EARTH_POS, rocketPosRef.current).normalize();
        
        // Interpolate between up and Earth direction
        targetDirection = new THREE.Vector3().lerpVectors(upDirection, earthDirection, easedProgress).normalize();
      } else {
        // Phase 3: Full thrust towards Earth
        targetDirection = new THREE.Vector3().subVectors(EARTH_POS, rocketPosRef.current).normalize();
      }
      
      // Apply acceleration in target direction
      const THRUST = 25.0; // Strong thrust acceleration
      rocketVelRef.current.add(targetDirection.multiplyScalar(THRUST * delta));
      
      // Limit max speed
      const MAX_SPEED = 120;
      if (rocketVelRef.current.length() > MAX_SPEED) {
        rocketVelRef.current.normalize().multiplyScalar(MAX_SPEED);
      }
      
      // Update position
      rocketPosRef.current.add(rocketVelRef.current.clone().multiplyScalar(delta));
      
      // Apply to group
      groupRef.current.position.copy(rocketPosRef.current);
      
      // Point rocket top/nose towards current velocity direction (smooth rotation)
      const flyDirection = rocketVelRef.current.clone().normalize();
      
      // Calculate rotation to point the rocket's top (+Y axis) towards the flight direction
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();
      
      // Create rotation that aligns rocket's Y-axis (top) with the flight direction
      const axis = new THREE.Vector3().crossVectors(up, flyDirection).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(flyDirection))));
      
      if (axis.length() > 0.001) {
        quaternion.setFromAxisAngle(axis, angle);
        groupRef.current.quaternion.copy(quaternion);
      }
      
      // Update rocket position ref for camera tracking
      if (rocketPositionRef) {
        rocketPositionRef.current = rocketPosRef.current.clone();
      }
      
      // Check if rocket is close to Earth (within 500 units)
      const distanceToEarth = rocketPosRef.current.distanceTo(EARTH_POS);
      if (distanceToEarth < 500 && onFollowRocket) {
        onFollowRocket(false); // Stop following, return to character
      }
    }
    
    // Smoke particles
    const particles = smokeParticlesRef.current;
    if (!particles.length || !smokeGeometryRef.current) return;
    
    const positions = smokeGeometryRef.current.attributes.position.array;
    const sizes = smokeGeometryRef.current.attributes.size.array;
    const opacities = smokeGeometryRef.current.attributes.opacity.array;
    
    particles.forEach((p, i) => {
      // Update particle physics
      p.life += delta;
      if (p.life > p.maxLife) {
        // Reset particle at rocket base
        p.x = (Math.random() - 0.5) * 3;
        p.y = 0;
        p.z = (Math.random() - 0.5) * 3;
        p.vx = (Math.random() - 0.5) * 2;
        p.vy = Math.random() * 8 + 4;
        p.vz = (Math.random() - 0.5) * 2;
        p.life = 0;
        p.maxLife = 1.0 + Math.random() * 0.5;
        p.size = 2 + Math.random() * 3;
      }
      
      // Move particle
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      
      // Expand as it rises
      p.vx *= 1.01;
      p.vz *= 1.01;
      
      // Update geometry
      const i3 = i * 3;
      positions[i3] = p.x;
      positions[i3 + 1] = p.y;
      positions[i3 + 2] = p.z;
      
      // Fade out over lifetime
      const lifeRatio = p.life / p.maxLife;
      sizes[i] = p.size * (1 + lifeRatio * 2); // Grow as it rises
      opacities[i] = Math.max(0, 1 - lifeRatio); // Fade out
    });
    
    smokeGeometryRef.current.attributes.position.needsUpdate = true;
    smokeGeometryRef.current.attributes.size.needsUpdate = true;
    smokeGeometryRef.current.attributes.opacity.needsUpdate = true;
  });
  
  useLayoutEffect(() => {
    if (!model) return;
    try {
      // Reset any previous transforms
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.set(1, 1, 1);
      
      // Apply scale
      model.scale.set(scale, scale, scale);
      
      // Force update matrix before computing bounding box
      model.updateMatrixWorld(true);
      
      // Calculate bounding box after scaling
      const box = new THREE.Box3().setFromObject(model);
      const minY = box.min.y;
      
      // Enable shadows
      model.traverse(o => { 
        if (o.isMesh) { 
          o.castShadow = true; 
          o.receiveShadow = true; 
        } 
      });
      
      // Calculate offset needed to place bottom at Y=0
      if (isFinite(minY)) {
        console.log('[RocketPedestal] Setting yOffset:', -minY, 'from minY:', minY);
        setYOffset(-minY);
      } else {
        console.warn('[RocketPedestal] Invalid minY:', minY);
      }
    } catch (e) {
      console.error('[RocketPedestal] Error in useLayoutEffect:', e);
    }
  }, [model, scale]);
  
  // Remount on hot reload detection
  useEffect(() => {
    const reloadCount = window.__CF_HOT_RELOAD_COUNT__ || 0;
    if (reloadCount > 0) {
      console.log('[RocketPedestal] Hot reload detected, remounting model');
      setMountKey(reloadCount);
    }
  }, []);

  if (!model) return null;
  
  const particleCount = 50;
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const opacities = new Float32Array(particleCount);
  
  // Initialize arrays
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
    sizes[i] = 2;
    opacities[i] = 1;
  }
  
  // Place model at the group position without any offset
  // The parent controls the Y position
  return (
    <group ref={groupRef} position={position}>
      <primitive object={model} />
      
      {/* Smoke/exhaust particles at rocket base */}
      <points position={[0, -5, 0]}>
        <bufferGeometry ref={smokeGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            count={particleCount}
            array={positions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-size"
            count={particleCount}
            array={sizes}
            itemSize={1}
          />
          <bufferAttribute
            attach="attributes-opacity"
            count={particleCount}
            array={opacities}
            itemSize={1}
          />
        </bufferGeometry>
        <pointsMaterial
          ref={smokeMaterialRef}
          size={3}
          color="#e0e0e0"
          transparent={true}
          opacity={0.6}
          sizeAttenuation={true}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexColors={false}
        />
      </points>
      
      {/* Launch button on platform floor - only show before launch */}
      {!hasLaunched && !launchRequested && (
        <group position={[35, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh 
            onClick={handleLaunch}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'default'; }}
          >
            <planeGeometry args={[12, 5]} />
            <meshStandardMaterial 
              color="#ef4444"
              emissive="#dc2626"
              emissiveIntensity={0.8}
              metalness={0.2}
              roughness={0.3}
            />
          </mesh>
          <Text
            position={[0, 0, 0.1]}
            fontSize={2.2}
            color="white"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            LAUNCH
          </Text>
        </group>
      )}
    </group>
  );
}

// New: Load a stairs prop (FBX) and place it next to the larger stairs
const ExtraStairsFBX = React.forwardRef(function ExtraStairsFBX({ offset = [10, 0, 0], yaw = 0, alignToStair2 = false, side = 'right', gap = 1.2, scaleMul = 0.08, scaleMulX = null, scaleMulY = null, scaleMulZ = null, posX = null, posZ = null, posY = 0, onDefChange = null }, ref){
  const src = useFBX('/models/props/stairs/stairs.fbx');
  const model = useMemo(() => (src ? skeletonClone(src) : null), [src]);
  // Compute ground Y
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  const [worldWidth, setWorldWidth] = useState(null);
  const [worldDepth, setWorldDepth] = useState(null);
  const [worldHeight, setWorldHeight] = useState(null);
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      const minY = box.min.y;
      const widthModel = Math.max(0.001, (box.max.x - box.min.x));
      const depthModel = Math.max(0.001, (box.max.z - box.min.z));
      const heightModel = Math.max(0.001, (box.max.y - box.min.y));
      // enable shadows
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // ground to local y=0
      if (isFinite(minY)) model.position.y += -minY;
      // effective per-axis scales (fallback to uniform if not provided)
      const sx = Number.isFinite(scaleMulX) ? scaleMulX : scaleMul;
      const sy = Number.isFinite(scaleMulY) ? scaleMulY : scaleMul;
      const sz = Number.isFinite(scaleMulZ) ? scaleMulZ : scaleMul;
      // publish scaled world dims
      setWorldWidth(widthModel * sx);
      setWorldDepth(depthModel * sz);
      setWorldHeight(heightModel * sy);
    } catch {}
  }, [model, scaleMul, scaleMulX, scaleMulY, scaleMulZ]);

  // Default position: relative offset from Stair2
  let x = STAIR2_POS_X + offset[0];
  let z = STAIR2_POS_Z + offset[2];
  if (alignToStair2) {
    const sign = side === 'left' ? -1 : 1;
    const propHalfW = (worldWidth != null ? worldWidth / 2 : 2);
    x = STAIR2_POS_X + sign * (STAIR2_WIDTH / 2 + gap + propHalfW);
    z = STAIR2_POS_Z; // align bases at same Z origin as big stairs
  }
  // Manual overrides when not aligning
  if (!alignToStair2) {
    if (posX != null) x = posX;
    if (posZ != null) z = posZ;
  }

  // Publish dynamic stair def (for collision/ground sampling) whenever bounds/placement change
  useEffect(() => {
    if (!onDefChange) return;
    if (worldWidth == null || worldDepth == null || worldHeight == null) return;
    // Guess steps by height and compute run/rise accordingly
    const stepsGuess = Math.max(6, Math.min(22, Math.round(worldHeight / 1.6))); // fewer, broader steps
    const rise = worldHeight / stepsGuess;
    const run = worldDepth / stepsGuess;
    onDefChange({ posX: x, posZ: z, posY, yaw, width: worldWidth, depth: worldDepth, height: worldHeight, steps: stepsGuess, run, rise });
  }, [onDefChange, worldWidth, worldDepth, worldHeight, x, z, yaw, posY]);

  if (!model) return null;
  const rsx = Number.isFinite(scaleMulX) ? scaleMulX : scaleMul;
  const rsy = Number.isFinite(scaleMulY) ? scaleMulY : scaleMul;
  const rsz = Number.isFinite(scaleMulZ) ? scaleMulZ : scaleMul;
  return (
    <group ref={ref} position={[x, groundY + posY, z]} rotation={[0, yaw, 0]} scale={[rsx, rsy, rsz]}>
      <primitive object={model} />
    </group>
  );
});

// Neon LED rings around each hole with slow pulsing and darker neon colors
function NeonRings({ innerR = 0.44, outerR = 0.49, speed = 0.12, amp = 0.08, base = 0.12, overlay = false }){
  const refsFront = useRef([]);
  const refsBack = useRef([]);
  const palette = useMemo(() => [
    '#22d3ee', // cyan
    '#7c3aed', // purple
    '#14b8a6', // teal
    '#60a5fa', // blue
    '#f472b6', // pink
  ], []);

  // Build positions for all holes
  const holes = useMemo(() => {
    const arr = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = (c - (COLS - 1) / 2) * (CELL + GAP);
        const y = (r - (ROWS - 1) / 2) * (CELL + GAP);
        const idx = r * COLS + c;
        const col = palette[c % palette.length];
        arr.push({ x, y, idx, col });
      }
    }
    return arr;
  }, [palette]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const TWOPI = Math.PI * 2;
    for (let i = 0; i < holes.length; i++) {
      const ph = (i / holes.length) * TWOPI; // phase spread
      const osc = base + amp * (0.5 + 0.5 * Math.sin(t * speed + ph));
      const mF = refsFront.current[i];
      const mB = refsBack.current[i];
      if (mF) mF.opacity = osc;
      if (mB) mB.opacity = osc;
    }
  });

  // Place LEDs just outside the board faces so they always sit in front of the board, but respect other geometry in front
  const zAttach = -BOARD_THICK * 0.6;
  const halfT = BOARD_THICK * 0.5;
  const eps = 0.01;
  const zFront = zAttach + halfT + eps;
  const zBack  = zAttach - halfT - eps;

  const depthTest = !overlay; // when overlay=true (board view), draw on top; otherwise respect depth so avatar occludes
  return (
    <>
      {holes.map((h, i) => (
        <mesh key={`rf-${i}`} position={[h.x, h.y, zFront]} frustumCulled={false} renderOrder={10}>
          <ringGeometry args={[innerR, outerR, 48]} />
          <meshBasicMaterial ref={(m)=>{ if(m) refsFront.current[i] = m; }} color={h.col} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
      {holes.map((h, i) => (
        <mesh key={`rb-${i}`} position={[h.x, h.y, zBack]} frustumCulled={false} renderOrder={10}>
          <ringGeometry args={[innerR, outerR, 48]} />
          <meshBasicMaterial ref={(m)=>{ if(m) refsBack.current[i] = m; }} color={h.col} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
    </>
  );
}

// Bright LED border around the frame with sweeping colors
function NeonBorder({ thickness = 0.07, inset = 0.02, speed = 0.36, amp = 0.34, base = 0.22, colorRate = 0.04, overlay = false }){
  const matsFront = useRef([]);
  const matsBack = useRef([]);
  // Use a continuous HSL hue gradient for smoother blending
  const palette = useMemo(() => [
    '#22d3ee', '#60a5fa', '#7c3aed', '#f472b6', '#14b8a6'
  ], []);

  const fw = COLS * (CELL + GAP) - GAP + 0.6;
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const COUNT_H = 56; // higher density for smoother sweep
  const COUNT_V = 40; // higher density for smoother sweep
  const segW = (fw - inset * 2) / COUNT_H;
  const segH = (fh - inset * 2) / COUNT_V;

  const segments = useMemo(() => {
    const segs = [];
    // top edge (y = +fh/2 - inset)
    for (let i = 0; i < COUNT_H; i++) {
      const x = -fw / 2 + inset + segW * (i + 0.5);
      const y = fh / 2 - inset;
      segs.push({ x, y, w: segW, h: thickness, rot: 0 });
    }
    // bottom edge (y = -fh/2 + inset)
    for (let i = 0; i < COUNT_H; i++) {
      const x = -fw / 2 + inset + segW * (i + 0.5);
      const y = -fh / 2 + inset;
      segs.push({ x, y, w: segW, h: thickness, rot: 0 });
    }
    // left edge (x = -fw/2 + inset)
    for (let i = 0; i < COUNT_V; i++) {
      const x = -fw / 2 + inset;
      const y = -fh / 2 + inset + segH * (i + 0.5);
      segs.push({ x, y, w: thickness, h: segH, rot: 0 });
    }
    // right edge (x = +fw/2 - inset)
    for (let i = 0; i < COUNT_V; i++) {
      const x = fw / 2 - inset;
      const y = -fh / 2 + inset + segH * (i + 0.5);
      segs.push({ x, y, w: thickness, h: segH, rot: 0 });
    }
    return segs;
  }, [fw, fh, COUNT_H, COUNT_V, segW, segH, thickness, inset]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const K = segments.length;
    const TWOPI = Math.PI * 2;
    // Advance hue smoothly across the entire strip using a time-shifted gradient
    const hueBase = (t * colorRate) % 1; // 0..1
    for (let i = 0; i < K; i++) {
      const ph = (i / K) * TWOPI;
      // Ease opacity oscillation for smoother in/out
      const s = Math.sin(t * speed - ph);
      const eased = 0.5 - 0.5 * Math.cos((s * 0.5 + 0.5) * Math.PI);
      const osc = base + amp * eased;
      // Compute hue smoothly over segments
      const hue = (hueBase + i / K) % 1;
      const c = new THREE.Color().setHSL(0.58 + 0.6 * hue, 0.85, 0.55);
      const mF = matsFront.current[i];
      const mB = matsBack.current[i];
      if (mF) {
        mF.opacity = osc;
        mF.color && mF.color.set(c);
      }
      if (mB) {
        mB.opacity = osc;
        mB.color && mB.color.set(c);
      }
    }
  });

  const zAttach = -BOARD_THICK * 0.6;
  const halfT = BOARD_THICK * 0.5;
  const eps = 0.01;
  const zFront = zAttach + halfT + eps;
  const zBack  = zAttach - halfT - eps;

  const depthTest = !overlay; // when overlay=true (board view), draw on top; otherwise respect depth so avatar occludes
  return (
    <>
      {segments.map((s, i) => (
        <mesh key={`bf-${i}`} position={[s.x, s.y, zFront]} frustumCulled={false} renderOrder={9}>
          <boxGeometry args={[s.w, s.h, 0.02]} />
          <meshBasicMaterial ref={(m)=>{ if(m) matsFront.current[i] = m; }} color={'#22d3ee'} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
      {segments.map((s, i) => (
        <mesh key={`bb-${i}`} position={[s.x, s.y, zBack]} frustumCulled={false} renderOrder={9}>
          <boxGeometry args={[s.w, s.h, 0.02]} />
          <meshBasicMaterial ref={(m)=>{ if(m) matsBack.current[i] = m; }} color={'#22d3ee'} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
    </>
  );
}

// Plain FBX table below the board (new table model)
function TableFBX() {
  // Frame sizes and floor reference
  const fw = COLS * (CELL + GAP) - GAP + 0.6;
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  // Static scale (no dynamic footprint scaling) — locked value
  const TABLE_STATIC_SCALE = 0.0825;

  // Simple table asset (no external texture mapping)
  const model = useFBX('/models/props/table/table.fbx');
  const lastFixRef = useRef(0);
  // Fixed Y tweak to raise/lower table (locked so it persists across reloads)
  const TABLE_Y_OFFSET = 0.00;
  useLayoutEffect(() => {
    try {
      if (!model) return;
      // Preserve FBX's original materials; enable shadows and set defaults
      model.traverse((o) => {
        if (o && o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          let m = o.material;
          if (!m) {
            m = o.material = new THREE.MeshStandardMaterial({ color: '#6a523a', metalness: 0.15, roughness: 0.8 });
          }
          // Reasonable PBR defaults
          if (typeof m.metalness !== 'number') m.metalness = 0.15;
          if (typeof m.roughness !== 'number') m.roughness = 0.8;
          m.needsUpdate = true;
        }
      });
  // Normalize placement: center on XZ, apply static scale, place on ground
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3(); box.getCenter(center);
      // center horizontally
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.updateMatrixWorld(true);
  // set table rotation to exactly 90° around Y
  model.rotation.y = Math.PI / 2;
  // apply static scale
      model.scale.setScalar(TABLE_STATIC_SCALE);
      model.updateMatrixWorld(true);
      // Place so the legs sit on the floor plane (table stands above the floor)
      const box2 = new THREE.Box3().setFromObject(model);
      const bottomWorld = box2.min.y;
      // Parent world Y (the table lives under a parent group with a Y offset)
      let parentWorldY = 0;
      try {
        if (model.parent) {
          const v = new THREE.Vector3();
          model.parent.getWorldPosition(v);
          parentWorldY = v.y || 0;
        }
      } catch {}
      const targetBottomWorld = parentWorldY + groundY + TABLE_Y_OFFSET;
      model.position.y += (targetBottomWorld - bottomWorld);
      model.updateMatrixWorld(true);
      // Publish the XZ footprint for collision/landing alignment
      const box3 = new THREE.Box3().setFromObject(model);
      try {
        window.__CF_TABLE_RECT__ = { minX: box3.min.x, maxX: box3.max.x, minZ: box3.min.z, maxZ: box3.max.z };
        window.__CF_TABLE_TOP_Y__ = box3.max.y; // publish tabletop height for aligning board
        // Also emit an event so other parts of the scene can react immediately on first load
        try {
          const detail = { topY: box3.max.y, rect: window.__CF_TABLE_RECT__ };
          window.dispatchEvent(new CustomEvent('cf:table-ready', { detail }));
        } catch {}
      } catch {}
    } catch {}
  }, [model, groundY, TABLE_STATIC_SCALE, TABLE_Y_OFFSET]);

  // Guard: if anything nudges the table after initial placement, re-clamp to floor
  useFrame((state) => {
    if (!model) return;
    const t = state.clock.getElapsedTime();
    if (t - (lastFixRef.current || 0) < 0.5) return; // throttle checks
    lastFixRef.current = t;
    try {
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const bottomWorld = box.min.y;
      let parentWorldY = 0;
      try {
        if (model.parent) {
          const v = new THREE.Vector3();
          model.parent.getWorldPosition(v);
          parentWorldY = v.y || 0;
        }
      } catch {}
      const targetBottomWorld = parentWorldY + groundY + TABLE_Y_OFFSET;
      const dyWorld = (targetBottomWorld - bottomWorld);
      if (Math.abs(dyWorld) > 0.001) {
        model.position.y += dyWorld;
        model.updateMatrixWorld(true);
      }
    } catch {}
  });

  return model ? <primitive object={model} dispose={null} /> : null;
}

// Classic textured table (original look) below the board
function ClassicTableFBX(){
  // Frame sizes and floor reference
  const fw = COLS * (CELL + GAP) - GAP + 0.6;
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  // Target tabletop span so the board fits comfortably with margin
  // Fixed scale: smaller for "normal" size
  const FIXED_TABLE_SCALE = 0.75;
  const TARGET_TOP_W = (Math.max(fw + 4.0, 12.0)) * FIXED_TABLE_SCALE;

  // Load the classic asset + textures
  const model = useFBX('/models/props/table/i_need_a_fancy_lookin_1016113959_texture.fbx');
  const texBase = useTexture('/models/props/table/i_need_a_fancy_lookin_1016113959_texture.png');
  const texNormal = useTexture('/models/props/table/i_need_a_fancy_lookin_1016113959_texture_normal.png');
  const texMetal = useTexture('/models/props/table/i_need_a_fancy_lookin_1016113959_texture_metallic.png');
  const texMetalRough = useTexture('/models/props/table/i_need_a_fancy_lookin_1016113959_texture_metallic_roughness.png');
  const texRough = useTexture('/models/props/table/i_need_a_fancy_lookin_1016113959_texture_roughness.png');

  const lastFixRef = useRef(0);
  useLayoutEffect(()=>{
    try{
      if(!model) return;
      // Check if this specific model instance has already been scaled
      // Use userData to persist across hot reloads and reconnects
      if(model.userData.__tableScaled__) return;
      model.traverse((o)=>{
        if(o && o.isMesh){
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          const m = (o.material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            map: texBase || null,
            normalMap: texNormal || null,
            metalnessMap: texMetal || null,
            roughnessMap: texRough || texMetalRough || null,
            metalness: 0.2,
            roughness: 0.8,
          }));
          if (m.map) { m.map.anisotropy = 8; m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; }
          if (m.normalMap) { m.normalMap.anisotropy = 4; }
          if (m.roughnessMap) { m.roughnessMap.anisotropy = 2; }
          if (m.metalnessMap) { m.metalnessMap.anisotropy = 2; }
          m.needsUpdate = true;
        }
      });
      // Center horizontally before scaling/rotation
      model.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(model);
      const center0 = new THREE.Vector3(); box0.getCenter(center0);
      model.position.x -= center0.x; model.position.z -= center0.z;
      // Uniform rotation (classic asset forward to match scene)
      model.rotation.y = Math.PI / 2;
      model.updateMatrixWorld(true);
      // Compute scale so the tabletop span roughly matches target width
      const box1 = new THREE.Box3().setFromObject(model);
      const baseW = Math.max(0.001, box1.max.x - box1.min.x);
  const s = TARGET_TOP_W / baseW;
      model.scale.setScalar(s);
      model.updateMatrixWorld(true);
      // Sit on ground
      const box2 = new THREE.Box3().setFromObject(model);
      const bottomWorld = box2.min.y;
      let parentWorldY = 0;
      try{ if(model.parent){ const v=new THREE.Vector3(); model.parent.getWorldPosition(v); parentWorldY = v.y || 0; } }catch{}
      const targetBottomWorld = parentWorldY + groundY;
      model.position.y += (targetBottomWorld - bottomWorld);
      model.updateMatrixWorld(true);
      // Publish table rect + top Y
      const box3 = new THREE.Box3().setFromObject(model);
      try{
        window.__CF_TABLE_RECT__ = { minX: box3.min.x, maxX: box3.max.x, minZ: box3.min.z, maxZ: box3.max.z };
        window.__CF_TABLE_TOP_Y__ = box3.max.y;
        const detail = { topY: box3.max.y, rect: window.__CF_TABLE_RECT__ };
        window.dispatchEvent(new CustomEvent('cf:table-ready', { detail }));
      }catch{}
      // Mark model as scaled to prevent rescaling on hot reload/reconnect
      model.userData.__tableScaled__ = true;
    }catch{}
  }, [model, texBase, texNormal, texMetal, texMetalRough, texRough, groundY, TARGET_TOP_W]);

  // Keep clamped to floor if anything moves
  useFrame((state)=>{
    if(!model) return;
    const t = state.clock.getElapsedTime();
    if(t - (lastFixRef.current||0) < 0.5) return;
    lastFixRef.current = t;
    try{
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const bottomWorld = box.min.y;
      let parentWorldY = 0;
      try{ if(model.parent){ const v=new THREE.Vector3(); model.parent.getWorldPosition(v); parentWorldY = v.y || 0; } }catch{}
      const targetBottomWorld = parentWorldY + groundY;
      const dy = targetBottomWorld - bottomWorld;
      if(Math.abs(dy) > 0.001){ model.position.y += dy; model.updateMatrixWorld(true); }
    }catch{}
  });

  return model ? <primitive object={model} dispose={null} /> : null;
}

// Asteroid surface floor with craters and scrolling motion to feel like flying over an asteroid
function AsteroidFloor({ opacity = 1.0, radius = TERRAIN_RADIUS, speed = 0.35, dir = [1.0, 0.25], scale = 0.8 }) {
  // Same ground reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // height of the floor
  const groundY = -fh / 2 - GROUND_CLEAR; // position of the ground
  const matRef = useRef();
  const shader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uRadius: { value: radius },
      uSpeed: { value: speed },
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
      uScale: { value: scale },
  // Greyer rock palette
  uRockA: { value: new THREE.Color('#5e5f63') },
  uRockB: { value: new THREE.Color('#8a8b90') },
  uRockC: { value: new THREE.Color('#3a3b3f') },
      uLightDir: { value: new THREE.Vector3(-0.25, 1.0, 0.15).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime, uOpacity, uRadius, uSpeed, uScale;
      uniform vec2 uDir;
      uniform vec3 uRockA, uRockB, uRockC;
      uniform vec3 uLightDir;

      // Hashes and noise
      float hash11(float n){ return fract(sin(n)*43758.5453123); }
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.,0.));
        float c = hash21(i + vec2(0.,1.));
        float d = hash21(i + vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c - a)*u.y*(1.-u.x) + (d - b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){
          v += a * noise(p); p *= 2.02; a *= 0.5;
        }
        return v;
      }

      // Crater field using nearest random point in a 3x3 cell neighborhood
      float craterField(vec2 p, out vec2 craterUV){
        vec2 ip = floor(p);
        vec2 fp = fract(p);
        float dmin = 1e9; vec2 closest = vec2(0.0);
        for(int j=-1;j<=1;j++){
          for(int i=-1;i<=1;i++){
            vec2 cell = ip + vec2(float(i), float(j));
            vec2 rnd = vec2(hash21(cell), hash21(cell+7.77));
            vec2 c = rnd*0.8 + 0.1; // random center inside cell
            vec2 diff = fp - (c + vec2(float(i), float(j)));
            float d = dot(diff, diff);
            if(d < dmin){ dmin = d; closest = diff; }
          }
        }
        float r = sqrt(dmin);
        craterUV = vec2(r, 0.0);
        // Profile: depression with a raised rim
        float rim = smoothstep(0.22, 0.18, r) - smoothstep(0.12, 0.10, r);
        float bowl = 0.35 * (1.0 - smoothstep(0.0, 0.22, r));
        return clamp(bowl - rim*0.45, -0.6, 0.6);
      }

      // Compute terrain height from fbm and craters
      float height(vec2 p){
        vec2 cuv; float cr = craterField(p*1.2, cuv);
        float base = fbm(p*1.8)*0.7 + fbm(p*4.3)*0.18;
        return base - cr; // lower in craters
      }

      // Approximate normal via central differences
      vec3 normalFromHeight(vec2 p){
        float e = 0.0025;
        float h = height(p);
        float hx = height(p + vec2(e,0.)) - h;
        float hy = height(p + vec2(0.,e)) - h;
        vec3 n = normalize(vec3(-hx, 1.0/e, -hy));
        return n;
      }

      void main(){
        // Irregular edge mask so the platform silhouette looks like an asteroid
        float distXZ = length(vWorldPos.xz);
        float rad = max(1.0, uRadius);
        // wobble the edge using low frequency fbm for jagged outline
        float edgeNoise = fbm(vWorldPos.xz * 0.12 + vec2(0.05*uTime, -0.04*uTime));
        float edged = distXZ / rad + (edgeNoise - 0.5) * 0.08; // +/- 4% wobble
        // 0..1, 1 inside, 0 outside with a narrow irregular falloff band
        float inside = 1.0 - smoothstep(0.94, 1.02, edged);
        if (inside <= 0.001) discard;
        // keep a secondary soft fade for the very outer rim
        float ring = smoothstep(0.0, 0.2, inside);

        // Scroll world to simulate flying forward
        vec2 dir = normalize(uDir);
        vec2 p = (vWorldPos.xz * uScale) + dir * (uTime * uSpeed * 12.0);

        // Terrain
        float h = height(p);
        vec3 n = normalFromHeight(p);

        // Rock albedo
        float c1 = smoothstep(0.0, 1.0, h);
        float c2 = smoothstep(0.2, 0.8, fbm(p*2.7));
        vec3 albedo = mix(uRockA, uRockB, c1);
        albedo = mix(albedo, uRockC, 0.25*(1.0-c2));

        // Lighting: single directional + ambient + subtle rim
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, vec3(0.0,1.0,0.0)), 0.0, 1.0), 1.6);
        vec3 ambient = albedo * 0.40;
        vec3 diffuse = albedo * (0.80 * ndl);
        vec3 rimCol = vec3(0.45,0.5,0.6) * rim * 0.18;
        vec3 col = ambient + diffuse + rimCol;

        // Alpha: fully opaque inside, fade only near irregular edge so stars never show over the floor
        float a = mix(uOpacity, 0.0, 1.0 - ring);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: true,
  }), [opacity, radius, speed, dir, scale]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  const planeSize = radius * 2.6;
  return (
    <group position={[0, groundY, 0]}>
      <mesh rotation={[-Math.PI/2, 0, 0]} renderOrder={-3} receiveShadow={false}>
        <planeGeometry args={[planeSize, planeSize, 1, 1]} />
        <shaderMaterial ref={matRef} args={[shader]} />
      </mesh>
      {/* Subtle texture overlay + shadow catcher slightly above to avoid perfectly flat look */}
      <TexturedShadowOverlay size={planeSize} />
    </group>
  );
}

function TexturedShadowOverlay({ size }){
  const tex = useTexture('/textures/metal_floor.png');
  useEffect(()=>{
    if(tex){ tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; tex.repeat.set(size/48, size/48); tex.needsUpdate = true; }
  }, [tex, size]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} receiveShadow renderOrder={-2}>
      <planeGeometry args={[size, size, 1, 1]} />
      <meshStandardMaterial transparent opacity={0.12} color={'#0b1220'} map={tex || null} />
    </mesh>
  );
}

// Lunar terrain with hills and mounds - characters can walk on the surface
function LunarTerrain({ radius = TERRAIN_RADIUS, flatRadius = 50, showCollisionBox = false }) {
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  const materialRef = useRef();
  
  // Load lunar surface texture
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/lunar_surface.png',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(8, 8); // Add tiling for sharper detail
        texture.anisotropy = 16; // Increase anisotropic filtering for better quality
        texture.needsUpdate = true;
        if (materialRef.current) {
          materialRef.current.map = texture;
          materialRef.current.needsUpdate = true;
        }
      },
      undefined,
      (error) => {
        console.log('Lunar texture not found, using procedural material');
      }
    );
  }, []);
  
  // Create terrain geometry with heightmap
  const terrainGeometry = useMemo(() => {
    const segments = 200; // high resolution for smooth hills
    const size = radius * 2.2;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    
    // Get position attribute
    const positions = geo.attributes.position;
    
    // Heightmap function using noise
    const hash21 = (x, y) => {
      let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return n - Math.floor(n);
    };
    
    const noise = (x, y) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      
      const a = hash21(ix, iy);
      const b = hash21(ix + 1, iy);
      const c = hash21(ix, iy + 1);
      const d = hash21(ix + 1, iy + 1);
      
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      
      return a * (1 - ux) * (1 - uy) +
             b * ux * (1 - uy) +
             c * (1 - ux) * uy +
             d * ux * uy;
    };
    
    const fbm = (x, y, octaves = 5) => {
      let value = 0;
      let amplitude = 1;
      let frequency = 1;
      
      for (let i = 0; i < octaves; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
      }
      
      return value;
    };
    
    // Apply height to vertices
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = -positions.getY(i); // Note: PlaneGeometry Y becomes -Z in world space when rotated -90° around X
      
      // Distance from center
      const distFromCenter = Math.sqrt(x * x + z * z);
      
      // Keep center area flat for Connect Four table
      if (distFromCenter < flatRadius) {
        positions.setZ(i, 0);
      } else {
        // Hills get taller as we move away from center
        const hillFactor = Math.min(1, (distFromCenter - flatRadius) / (radius * 0.5));
        
        // Generate hills using fractal noise - increased height for more dramatic terrain
        const scale = 0.015;
        const height = fbm(x * scale, z * scale, 4) * 12 * hillFactor; // Increased from 5 to 12
        
        // Add some larger mounds
        const moundScale = 0.008;
        const mounds = fbm(x * moundScale, z * moundScale, 3) * 20 * hillFactor; // Increased from 8 to 20
        
        // Blend edge smoothly
        const edgeFactor = 1 - Math.max(0, Math.min(1, (distFromCenter - radius * 0.9) / (radius * 0.3)));
        
        positions.setZ(i, (height + mounds) * edgeFactor);
      }
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [radius, flatRadius]);
  
  return (
    <group position={[0, groundY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={terrainGeometry} receiveShadow castShadow>
        <meshStandardMaterial 
          ref={materialRef}
          color="#b0b0b0"
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>
      
      {/* Collision box visualization */}
      {showCollisionBox && (
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[100, 1, 100]} />
          <meshBasicMaterial color="#10b981" wireframe opacity={0.3} transparent />
        </mesh>
      )}
    </group>
  );
}

// Star dome + drifting dust + a couple of procedural planets for deep space vibe
function SpaceBackdrop({ speed = 0.3, dir = [1.0, 0.25], starIntensity = 1.8, clusterStrength = 2.2 }) {
  const domeMatRef = useRef();
  const planet1Ref = useRef();
  const planet2Ref = useRef();
  const dustRef = useRef();
  const groupRef = useRef();

  const uDir = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Star dome shader (inward-facing sphere)
  const domeShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: 0.35 },
      uNebula: { value: 0.0 },
      uIntensity: { value: starIntensity },
      uCluster: { value: clusterStrength },
      uDir: { value: new THREE.Vector2(uDir.x, uDir.y) },
      uSpeed: { value: speed },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime, uTwinkle, uNebula, uIntensity, uCluster, uSpeed;
      uniform vec2 uDir;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i+vec2(1.,0.));
        float c = hash(i+vec2(0.,1.));
        float d = hash(i+vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }

      void main(){
        // Map world dir to a stable UV on the dome
        vec3 d = normalize(vWorldPos);
        float lon = atan(d.z, d.x); // -pi..pi
        float lat = asin(clamp(d.y, -1.0, 1.0)); // -pi/2..pi/2
        vec2 uv = vec2(lon/(6.28318530718)+0.5, lat/3.14159265359+0.5);

        // Scroll for subtle parallax in star pattern
        vec2 scroll = uDir * (uTime * uSpeed * 0.08);
  vec2 suv = uv * 220.0 + scroll; // much denser star field

        // Clustering mask (bigger, smoother regions of higher star density)
  float cl = fbm(uv*4.6 + scroll*0.12);
  float clusterMask = pow(smoothstep(0.45, 0.98, cl), 4.0) * (uCluster * 1.8); // stronger clusters

        // Multi-layer stars via noise thresholds
        float n1 = noise(suv);
        float n2 = noise(suv*1.7 + 5.17);
        float n3 = noise(suv*2.3 + 17.9);
  float starS = smoothstep(0.992, 1.0, n1);
  float starM = smoothstep(0.9965, 1.0, n2);
  float starL = smoothstep(0.9985, 1.0, n3);
        // Bright cores for the largest stars
  float core = pow(max(0.0, n3 - 0.9991)/0.0009, 3.0);

        // Twinkle modulation
        float tw1 = 0.5 + 0.5*sin(uTime*3.1 + 11.0*noise(suv*0.08));
        float tw2 = 0.5 + 0.5*sin(uTime*2.2 + 7.0*noise(suv*0.11 + 4.3));
        float twinkle = (0.6 + 0.4*mix(tw1, tw2, 0.5)) * (1.0 + 0.35*clusterMask) * uTwinkle;

        float stars = (starS*0.9 + starM*2.2 + starL*3.4 + core*4.0);
        stars *= (1.0 + clusterMask);
        stars *= (0.75 + twinkle);

        // Subtle nebula gradient (kept low to emphasize bright dots)
        float neb = fbm(uv*2.6 + scroll*0.12);
        vec3 nebCol = mix(vec3(0.03,0.02,0.05), vec3(0.08,0.05,0.12), neb) * uNebula;

        // Remove nebula tint to avoid dome “bubble” look; render only stars
        vec3 col = vec3(1.0)*stars*uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  }), [uDir, speed, starIntensity, clusterStrength]);

  // Simple procedural planet shader material factory
  const makePlanetShader = useCallback((baseA, baseB, banding, clouds) => ({
    uniforms: {
      uTime: { value: 0 },
      uBaseA: { value: new THREE.Color(baseA) },
      uBaseB: { value: new THREE.Color(baseB) },
      uBand: { value: banding },
      uClouds: { value: clouds },
      uLightDir: { value: new THREE.Vector3(-0.2, 0.9, 0.1).normalize() },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vN; varying vec3 vP;
      uniform vec3 uBaseA, uBaseB, uLightDir; uniform float uTime, uBand, uClouds;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5;} return v; }
      void main(){
        vec3 n = normalize(vN);
        // spherical uv from normal
        float lon = atan(n.z, n.x); float lat = asin(clamp(n.y,-1.0,1.0));
        vec2 uv = vec2(lon/6.2831853+0.5, lat/3.14159265+0.5);
        // gas bands or continents
        float bands = 0.5 + 0.5*sin((uv.y*6.28318)*uBand + 2.0*fbm(uv*4.0 + vec2(0.1*uTime)));
        vec3 base = mix(uBaseA, uBaseB, bands);
        // clouds
        float c = smoothstep(0.65, 0.9, fbm(uv*5.0 + vec2(0.05*uTime, 0.07*uTime)));
        vec3 col = base + vec3(1.0)*c*uClouds*0.25;
        // lighting
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        vec3 ambient = col*0.35; vec3 diffuse = col*0.85*ndl;
        float rim = pow(1.0 - clamp(dot(n, vec3(0,1,0)), 0.0, 1.0), 2.0)*0.25;
        col = ambient + diffuse + vec3(0.7,0.8,1.0)*rim*0.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }), []);

  // Create planet shader materials
  const planet1Shader = useMemo(() => makePlanetShader('#557799', '#88aacc', 18.0, 0.4), [makePlanetShader]);
  const planet2Shader = useMemo(() => makePlanetShader('#704a2a', '#c79a5f', 8.0, 0.15), [makePlanetShader]);

  // Dust points
  const dustCount = 350;
  const dustGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i*3+0] = (Math.random()-0.5) * 380;
      positions[i*3+1] = (Math.random()-0.2) * 250;
      positions[i*3+2] = (Math.random()-0.5) * 520;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  const dustMat = useMemo(() => new THREE.PointsMaterial({ size: 0.9, color: '#aab3ff', opacity: 0.6, transparent: true, depthWrite: false }), []);

  // Cleanup geometries/materials on unmount to avoid memory buildup in dev
  useEffect(() => {
    return () => {
      try { dustGeom?.dispose?.(); } catch {}
      try { dustMat?.dispose?.(); } catch {}
      try { if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.dispose(); } catch {}
      try { if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.dispose(); } catch {}
      try { domeMatRef.current?.dispose?.(); } catch {}
    };
  }, [dustGeom, dustMat]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    if (domeMatRef.current) domeMatRef.current.uniforms.uTime.value = t;
    if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.uniforms.uTime.value = t;
    if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.uniforms.uTime.value = t*0.8;
    // Drift dust opposite to travel dir
    if (dustRef.current) {
      const geom = dustRef.current.geometry; const pos = geom.getAttribute('position');
      const dx = -uDir.x * speed * 0.6 * delta * 60.0;
      const dz = -uDir.y * speed * 1.2 * delta * 60.0;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + dx; let z = pos.getZ(i) + dz;
        if (x > 200) x = -200; if (x < -200) x = 200;
        if (z > 280) z = -280; if (z < -280) z = 280;
        pos.setX(i, x); pos.setZ(i, z);
      }
      pos.needsUpdate = true;
    }
    // slow planet rotations
    if (planet1Ref.current) planet1Ref.current.rotation.y = t * 0.02;
    if (planet2Ref.current) planet2Ref.current.rotation.y = -t * 0.015;
  });

  const radius = 800; // bring within camera far plane
  return (
    <group ref={groupRef}>
      {/* Stars dome */}
      <mesh renderOrder={-20}>
        <sphereGeometry args={[radius, 48, 32]} />
        <shaderMaterial ref={domeMatRef} args={[domeShader]} />
      </mesh>
      {/* Drifting dust for speed cue */}
      <points ref={dustRef} geometry={dustGeom} material={dustMat} renderOrder={-9} frustumCulled={false} />
      {/* Planets: distributed around the play area - raised higher */}
      {/* Blue planet FBX model - replacing striped shader planet */}
      <BluePlanetFBX position={[-800, 250, -1500]} scale={4.5} />
      {/* Pink planets replacing brownish shader planets */}
      <PinkPlanetFBX position={[300, 150, -520]} scale={0.4} />
      <PinkPlanetFBX position={[450, 180, 200]} scale={0.5} />
      {/* Earth planet - new addition - 10x further away for rocket target */}
      <EarthPlanetFBX position={[-4000, 2000, 3000]} scale={4.5} />
    </group>
  );
}

// Load and display the blue planet FBX model
function BluePlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/blue_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Slow rotation
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}

// Load and display the pink planet FBX model
function PinkPlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/pink_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Slow rotation (slightly different speed for variety)
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * -0.015;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}

// Load and display the Earth planet FBX model
function EarthPlanetFBX({ position = [0, 0, 0], scale = 80, rotation = [0, 0, 0] }) {
  const planetFBX = useFBX('/models/props/planets/earth_planet.fbx');
  const planetRef = useRef();
  
  const clone = useMemo(() => {
    if (!planetFBX) return null;
    return skeletonClone(planetFBX);
  }, [planetFBX]);
  
  // Decent spin rate (faster than other planets for Earth)
  useFrame(({ clock }) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = clock.getElapsedTime() * 0.05;
    }
  });
  
  if (!clone) return null;
  
  return (
    <group ref={planetRef} position={position} rotation={rotation} scale={scale} renderOrder={-8}>
      <primitive object={clone} />
    </group>
  );
}

function Staircase({ rocketPositionRef = null, setFollowRocket = null, showCollisionMeshes = false }) {
  // Build visible, textured stepped structures for both staircases and a flat platform on Stair 2
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;

  // Load separate textures: stairs vs upper platform (floor)
  const stairsTex = useTexture('/textures/metal_stairs.png');
  const floorTex  = useTexture('/textures/metal_floor.png');
  useEffect(() => {
    if (stairsTex) {
      // No tiling: clamp edges and keep 1x1 mapping
      stairsTex.wrapS = stairsTex.wrapT = THREE.ClampToEdgeWrapping;
      stairsTex.anisotropy = 8;
      stairsTex.repeat.set(1, 1);
      stairsTex.needsUpdate = true;
    }
  }, [stairsTex]);
  useEffect(() => {
    if (floorTex) {
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.anisotropy = 8;
      // Tile less aggressively for broad platform surface
      floorTex.repeat.set(1.5, 1.5);
      floorTex.needsUpdate = true;
    }
  }, [floorTex]);

  const stairMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#dfe4ea',
    metalness: 0.35,
    roughness: 0.6,
    map: stairsTex || null,
  }), [stairsTex]);

  const platformMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    metalness: 0.25,
    roughness: 0.7,
    map: floorTex || null,
  }), [floorTex]);

  const makeStairs = (keyPrefix, posX, posZ, width, run, rise, steps) => {
    const list = [];
    for (let i = 0; i < steps; i++) {
      const y = i * rise;
      const zStart = posZ + i * run;
      const zCenter = zStart + run / 2;
      // Rounded step block
      list.push(
        <group key={`${keyPrefix}-${i}`}>
          <RoundedBox args={[width, rise, run]} radius={0.18} smoothness={4} position={[posX, groundY + y + rise/2, zCenter]} castShadow receiveShadow>
            <primitive attach="material" object={stairMat} />
          </RoundedBox>
          {/* Bullnose lip at the front edge of each step */}
          <RoundedBox args={[width, 0.26, 0.22]} radius={0.08} smoothness={4} position={[posX, groundY + y + rise - 0.13, zStart + run - 0.11]} castShadow receiveShadow>
            <primitive attach="material" object={stairMat} />
          </RoundedBox>
          {/* Anti-slip grooves: three thin strips near the front */}
          {Array.from({length:3}).map((_,gi)=>{
            const off = 0.22 + gi*0.16;
            return (
              <mesh key={`groove-${i}-${gi}`} position={[posX, groundY + y + rise - 0.18, zStart + run - off]} castShadow receiveShadow>
                <boxGeometry args={[width, 0.04, 0.02]} />
                <primitive attach="material" object={stairMat} />
              </mesh>
            );
          })}
        </group>
      );
    }
    return list;
  };

  // Render only stairs2 (stairs1 completely removed)
  const stairs2 = makeStairs('st2', STAIR2_POS_X, STAIR2_POS_Z, STAIR2_WIDTH, STAIR2_RUN, STAIR2_RISE, STAIR2_STEPS);
  
  // Third staircase - rotated 90° clockwise, positioned on top of STAIR2 platform
  const makeStairs3Rotated = (keyPrefix, posX, posZ, width, run, rise, steps, baseY) => {
    const list = [];
    for (let i = 0; i < steps; i++) {
      const y = baseY + i * rise;
      const xEnd = posX - i * run; // going in -X direction
      const xCenter = xEnd - run / 2;
      list.push(
        <group key={`${keyPrefix}-${i}`}>
          {/* Main step block - rotated: width becomes depth (Z), run becomes width (X) */}
          <RoundedBox args={[run, rise, width]} radius={0.18} smoothness={4} position={[xCenter, groundY + y + rise/2, posZ]} castShadow receiveShadow>
            <primitive attach="material" object={stairMat} />
          </RoundedBox>
          {/* Bullnose lip at the front edge - rotated 90° */}
          <RoundedBox args={[0.22, 0.26, width]} radius={0.08} smoothness={4} position={[xEnd - run + 0.11, groundY + y + rise - 0.13, posZ]} castShadow receiveShadow>
            <primitive attach="material" object={stairMat} />
          </RoundedBox>
          {/* Anti-slip grooves: three thin strips near the front */}
          {Array.from({length:3}).map((_,gi)=>{
            const off = 0.22 + gi*0.16;
            return (
              <mesh key={`groove-${i}-${gi}`} position={[xEnd - run + off, groundY + y + rise - 0.18, posZ]} castShadow receiveShadow>
                <boxGeometry args={[0.02, 0.04, width]} />
                <primitive attach="material" object={stairMat} />
              </mesh>
            );
          })}
        </group>
      );
    }
    return list;
  };
  const stairs3 = makeStairs3Rotated('st3', STAIR3_POS_X, STAIR3_POS_Z, STAIR3_WIDTH, STAIR3_RUN, STAIR3_RISE, STAIR3_STEPS, STAIR3_BASE_Y);

  // Visible top platform for Stair 2 (flat at top height, same width, depth = STAIR2_PLATFORM_DEPTH)
  const stair2TopY = groundY + STAIR2_STEPS * STAIR2_RISE;
  const stair2TopZ = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN;
  const platDepth = STAIR2_PLATFORM_DEPTH;
  const platCenterZ = stair2TopZ + platDepth / 2;
  const platWidth = STAIR2_PLATFORM_WIDTH;
  const platThickness = 1.5; // requested solid thickness
  const eps = 0.001; // slight offset to avoid z-fighting with step tops

  // Platform for Stair 3 (rotated 90° - goes in -X direction)
  const stair3TopY = groundY + STAIR3_BASE_Y + STAIR3_STEPS * STAIR3_RISE;
  const stair3TopX = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN; // ends in -X direction
  const plat3Depth = STAIR3_PLATFORM_DEPTH;
  const plat3CenterX = stair3TopX - plat3Depth / 2; // platform extends further in -X
  const plat3Width = STAIR3_PLATFORM_WIDTH;
  const plat3Thickness = 1.5;

  // Solid guard rails for the long stairs (stair 2): spaced vertical posts + sloped top/mid rails
  const POST_EVERY = 2;              // post on every Nth step
  const postW = 0.32, postD = 0.32;  // post thickness
  const postH = 6.5;                 // Visual rail height (collision boxes still 16.0)
  const topRailThick = 0.28;
  const midRailThick = 0.22;
  const midRailFrac = 0.5;           // mid-rail halfway up the posts
  const railInset = 1.5;             // Inset from edge (was 0.45)
  const leftRailX = STAIR2_POS_X - STAIR2_WIDTH/2 + railInset;
  const rightRailX = STAIR2_POS_X + STAIR2_WIDTH/2 - railInset;
  const z0 = STAIR2_POS_Z + STAIR2_RUN*0.5;               // near center of first step
  const z1 = stair2TopZ - STAIR2_RUN*0.5;                 // near center of last step
  const y0 = groundY + STAIR2_RISE + postH;               // top of first post (on step 1)
  const y1 = stair2TopY + postH;                          // top of last post
  const dz = z1 - z0; const dy = y1 - y0;
  const railLen = Math.sqrt(dz*dz + dy*dy);
  const railPitch = -Math.atan2(dy, dz); // rotate around X (negative to tilt up along +Z)
  const railMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.7, roughness: 0.35 }), []);

  // Build posts along stairs
  const buildPosts = (x) => {
    const items = [];
    for (let i = 0; i < STAIR2_STEPS; i += POST_EVERY) {
      const y = groundY + (i+1) * STAIR2_RISE; // top surface of step i
      const zStart = STAIR2_POS_Z + i * STAIR2_RUN;
      const zCenter = zStart + STAIR2_RUN * 0.5;
      items.push(
        <mesh key={`post-${x}-${i}`} position={[x, y + postH/2, zCenter]} castShadow receiveShadow>
          <boxGeometry args={[postW, postH, postD]} />
          <primitive attach="material" object={railMat} />
        </mesh>
      );
    }
    // Ensure posts also at very bottom and very top
    items.push(
      <mesh key={`post-${x}-bottom`} position={[x, groundY + STAIR2_RISE + postH/2, z0]} castShadow receiveShadow>
        <boxGeometry args={[postW, postH, postD]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
    items.push(
      <mesh key={`post-${x}-top`} position={[x, stair2TopY + postH/2, z1]} castShadow receiveShadow>
        <boxGeometry args={[postW, postH, postD]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
    return items;
  };

  // Rail bars helper (sloped along stairs)
  const RailBar = ({ x, yStart, zStart, yEnd, zEnd, thick }) => {
    const dzL = zEnd - zStart; const dyL = yEnd - yStart;
    const len = Math.sqrt(dzL*dzL + dyL*dyL);
    const pitch = -Math.atan2(dyL, dzL);
    const midZ = (zStart + zEnd) / 2;
    const midY = (yStart + yEnd) / 2;
    return (
      <mesh position={[x, midY, midZ]} rotation={[pitch, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[thick, thick, len]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
  };

  // STAIR3 guard rails (rotated - goes in -X direction)
  const leftRail3Z = STAIR3_POS_Z - STAIR3_WIDTH/2 + railInset;
  const rightRail3Z = STAIR3_POS_Z + STAIR3_WIDTH/2 - railInset;
  const x0_3 = STAIR3_POS_X - STAIR3_RUN*0.5;               // near center of first step
  const x1_3 = stair3TopX + STAIR3_RUN*0.5;                 // near center of last step
  const y0_3 = groundY + STAIR3_BASE_Y + STAIR3_RISE + postH;     // top of first post
  const y1_3 = stair3TopY + postH;                          // top of last post

  // Build posts for STAIR3 (rotated)
  const buildPosts3 = (z) => {
    const items = [];
    for (let i = 0; i < STAIR3_STEPS; i += POST_EVERY) {
      const y = groundY + STAIR3_BASE_Y + (i + 1) * STAIR3_RISE;
      const xCenter = STAIR3_POS_X - i * STAIR3_RUN - STAIR3_RUN * 0.5;
      items.push(
        <mesh key={`post3-${z}-${i}`} position={[xCenter, y + postH/2, z]} castShadow receiveShadow>
          <boxGeometry args={[postD, postH, postW]} />
          <primitive attach="material" object={railMat} />
        </mesh>
      );
    }
    // Bottom and top posts
    items.push(
      <mesh key={`post3-${z}-bottom`} position={[x0_3, groundY + STAIR3_BASE_Y + STAIR3_RISE + postH/2, z]} castShadow receiveShadow>
        <boxGeometry args={[postD, postH, postW]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
    items.push(
      <mesh key={`post3-${z}-top`} position={[x1_3, stair3TopY + postH/2, z]} castShadow receiveShadow>
        <boxGeometry args={[postD, postH, postW]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
    return items;
  };

  // Rail bars for STAIR3 (rotated - goes along X axis)
  const RailBar3 = ({ z, yStart, xStart, yEnd, xEnd, thick }) => {
    const dxL = xEnd - xStart; const dyL = yEnd - yStart;
    const len = Math.sqrt(dxL*dxL + dyL*dyL);
    const pitch = Math.atan2(dyL, -dxL); // negative because going in -X direction
    const midX = (xStart + xEnd) / 2;
    const midY = (yStart + yEnd) / 2;
    return (
      <mesh position={[midX, midY, z]} rotation={[0, pitch, 0]} castShadow receiveShadow>
        <boxGeometry args={[len, thick, thick]} />
        <primitive attach="material" object={railMat} />
      </mesh>
    );
  };

  return (
    <group>
      {/* stairs1 removed - keeping only stairs2 */}
      {stairs2}
      {/* Side stringers along stair 2 for a more engineered look */}
      <mesh position={[STAIR2_POS_X - STAIR2_WIDTH/2 - 0.25, groundY + STAIR2_RISE*STAIR2_STEPS/2, stair2TopZ - (STAIR2_STEPS * STAIR2_RUN)/2]} rotation={[ -Math.atan2(STAIR2_RISE*STAIR2_STEPS, STAIR2_RUN*STAIR2_STEPS), 0, 0 ]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 1.0, STAIR2_STEPS * STAIR2_RUN + 0.0001]} />
        <primitive attach="material" object={stairMat} />
      </mesh>
      <mesh position={[STAIR2_POS_X + STAIR2_WIDTH/2 + 0.25, groundY + STAIR2_RISE*STAIR2_STEPS/2, stair2TopZ - (STAIR2_STEPS * STAIR2_RUN)/2]} rotation={[ -Math.atan2(STAIR2_RISE*STAIR2_STEPS, STAIR2_RUN*STAIR2_STEPS), 0, 0 ]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 1.0, STAIR2_STEPS * STAIR2_RUN + 0.0001]} />
        <primitive attach="material" object={stairMat} />
      </mesh>
      {/* Guard rails: posts */}
      {buildPosts(leftRailX)}
      {buildPosts(rightRailX)}
      {/* Top rails (sloped) */}
      <RailBar x={leftRailX}  yStart={y0} zStart={z0} yEnd={y1} zEnd={z1} thick={topRailThick} />
      <RailBar x={rightRailX} yStart={y0} zStart={z0} yEnd={y1} zEnd={z1} thick={topRailThick} />
      {/* Mid rails (sloped halfway up posts) */}
      <RailBar x={leftRailX}  yStart={y0 - postH*(1.0-midRailFrac)} zStart={z0} yEnd={y1 - postH*(1.0-midRailFrac)} zEnd={z1} thick={midRailThick} />
      <RailBar x={rightRailX} yStart={y0 - postH*(1.0-midRailFrac)} zStart={z0} yEnd={y1 - postH*(1.0-midRailFrac)} zEnd={z1} thick={midRailThick} />
      {/* Platform floor as a box with metal texture */}
      {platDepth > 0 && (
        <mesh position={[STAIR2_POS_X, stair2TopY - platThickness/2 + eps, platCenterZ]} castShadow receiveShadow>
          <boxGeometry args={[platWidth, platThickness, platDepth]} />
          <primitive attach="material" object={platformMat} />
        </mesh>
      )}
      {/* Platform edge railings with posts and bars */}
      {(() => {
        const postW = 0.18, postH = 7.0, postD = 0.18; // Much taller posts (half character height)
        const topBarH = 0.12, topBarW = 0.12;
        const midBarH = 0.10, midBarW = 0.10;
        const midRailFrac = 0.5;
        const postSpacing = 1.5; // spacing between posts
        const xMin = STAIR2_POS_X - platWidth/2;
        const xMax = STAIR2_POS_X + platWidth/2;
        const zMin = stair2TopZ;
        const zMax = stair2TopZ + platDepth;
        const baseY = stair2TopY;
        
        const posts = [];
        const bars = [];
        
        // Back edge (along X axis)
        const backPostCount = Math.ceil(platWidth / postSpacing) + 1;
        for (let i = 0; i < backPostCount; i++) {
          const t = i / (backPostCount - 1);
          const px = xMin + t * platWidth;
          posts.push(
            <mesh key={`back-post-${i}`} position={[px, baseY + postH/2, zMax]} castShadow receiveShadow>
              <boxGeometry args={[postW, postH, postD]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
        }
        // Top bar back
        bars.push(
          <mesh key="back-top" position={[STAIR2_POS_X, baseY + postH, zMax]} castShadow receiveShadow>
            <boxGeometry args={[platWidth, topBarH, topBarW]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        // Mid bar back
        bars.push(
          <mesh key="back-mid" position={[STAIR2_POS_X, baseY + postH * midRailFrac, zMax]} castShadow receiveShadow>
            <boxGeometry args={[platWidth, midBarH, midBarW]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        
        // Left edge (along Z axis)
        const leftPostCount = Math.ceil(platDepth / postSpacing) + 1;
        for (let i = 0; i < leftPostCount; i++) {
          const t = i / (leftPostCount - 1);
          const pz = zMin + t * platDepth;
          posts.push(
            <mesh key={`left-post-${i}`} position={[xMin, baseY + postH/2, pz]} castShadow receiveShadow>
              <boxGeometry args={[postW, postH, postD]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
        }
        // Top bar left
        bars.push(
          <mesh key="left-top" position={[xMin, baseY + postH, (zMin + zMax)/2]} castShadow receiveShadow>
            <boxGeometry args={[topBarW, topBarH, platDepth]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        // Mid bar left
        bars.push(
          <mesh key="left-mid" position={[xMin, baseY + postH * midRailFrac, (zMin + zMax)/2]} castShadow receiveShadow>
            <boxGeometry args={[midBarW, midBarH, platDepth]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        
        // Right edge (along Z axis)
        const rightPostCount = Math.ceil(platDepth / postSpacing) + 1;
        for (let i = 0; i < rightPostCount; i++) {
          const t = i / (rightPostCount - 1);
          const pz = zMin + t * platDepth;
          posts.push(
            <mesh key={`right-post-${i}`} position={[xMax, baseY + postH/2, pz]} castShadow receiveShadow>
              <boxGeometry args={[postW, postH, postD]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
        }
        // Top bar right
        bars.push(
          <mesh key="right-top" position={[xMax, baseY + postH, (zMin + zMax)/2]} castShadow receiveShadow>
            <boxGeometry args={[topBarW, topBarH, platDepth]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        // Mid bar right
        bars.push(
          <mesh key="right-mid" position={[xMax, baseY + postH * midRailFrac, (zMin + zMax)/2]} castShadow receiveShadow>
            <boxGeometry args={[midBarW, midBarH, platDepth]} />
            <primitive attach="material" object={railMat} />
          </mesh>
        );
        
        return <>{posts}{bars}</>;
      })()}
      {/* Rocket Pedestal on the platform */}
      <RocketPedestal 
        position={[STAIR2_POS_X, stair2TopY + platThickness/2, platCenterZ]} 
        scale={0.6}
        onLaunchClick={() => console.log('Rocket launch initiated!')}
        rocketPositionRef={rocketPositionRef}
        onFollowRocket={setFollowRocket}
        showCollisionMeshes={showCollisionMeshes}
      />

      {/* Third staircase and platform - all wrapped in a rotated group */}
      <group position={[STAIR3_POS_X, 0, STAIR3_POS_Z]} rotation={[0, -Math.PI/2, 0]}>
        {/* Render stairs relative to groundY + STAIR3_BASE_Y */}
        {Array.from({length: STAIR3_STEPS}).map((_, i) => {
          const y = groundY + STAIR3_BASE_Y + i * STAIR3_RISE;
          const zStart = i * STAIR3_RUN;
          const zCenter = zStart + STAIR3_RUN / 2;
          return (
            <group key={`st3-${i}`}>
              <RoundedBox args={[STAIR3_WIDTH, STAIR3_RISE, STAIR3_RUN]} radius={0.18} smoothness={4} position={[0, y + STAIR3_RISE/2, zCenter]} castShadow receiveShadow>
                <primitive attach="material" object={stairMat} />
              </RoundedBox>
              <RoundedBox args={[STAIR3_WIDTH, 0.26, 0.22]} radius={0.08} smoothness={4} position={[0, y + STAIR3_RISE - 0.13, zStart + STAIR3_RUN - 0.11]} castShadow receiveShadow>
                <primitive attach="material" object={stairMat} />
              </RoundedBox>
              {Array.from({length:3}).map((_,gi)=>{
                const off = 0.22 + gi*0.16;
                return (
                  <mesh key={`groove-${i}-${gi}`} position={[0, y + STAIR3_RISE - 0.18, zStart + STAIR3_RUN - off]} castShadow receiveShadow>
                    <boxGeometry args={[STAIR3_WIDTH, 0.04, 0.02]} />
                    <primitive attach="material" object={stairMat} />
                  </mesh>
                );
              })}
            </group>
          );
        })}
        
        {/* Side stringers - same as stair2 structure */}
        <mesh position={[-STAIR3_WIDTH/2 - 0.25, groundY + STAIR3_BASE_Y + STAIR3_RISE*STAIR3_STEPS/2, (STAIR3_STEPS * STAIR3_RUN)/2]} rotation={[-Math.atan2(STAIR3_RISE*STAIR3_STEPS, STAIR3_RUN*STAIR3_STEPS), 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 1.0, STAIR3_STEPS * STAIR3_RUN + 0.0001]} />
          <primitive attach="material" object={stairMat} />
        </mesh>
        <mesh position={[STAIR3_WIDTH/2 + 0.25, groundY + STAIR3_BASE_Y + STAIR3_RISE*STAIR3_STEPS/2, (STAIR3_STEPS * STAIR3_RUN)/2]} rotation={[-Math.atan2(STAIR3_RISE*STAIR3_STEPS, STAIR3_RUN*STAIR3_STEPS), 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 1.0, STAIR3_STEPS * STAIR3_RUN + 0.0001]} />
          <primitive attach="material" object={stairMat} />
        </mesh>
        
        {/* Guard rails - same structure as stair2 */}
        {Array.from({length: Math.floor(STAIR3_STEPS/POST_EVERY)}).map((_,idx)=>{
          const i = idx * POST_EVERY;
          const y = groundY + STAIR3_BASE_Y + (i + 1) * STAIR3_RISE;
          const zCenter = i * STAIR3_RUN + STAIR3_RUN * 0.5;
          return (
            <React.Fragment key={`rails3-${i}`}>
              <mesh position={[-STAIR3_WIDTH/2 + railInset, y + postH/2, zCenter]} castShadow receiveShadow>
                <boxGeometry args={[postW, postH, postD]} />
                <primitive attach="material" object={railMat} />
              </mesh>
              <mesh position={[STAIR3_WIDTH/2 - railInset, y + postH/2, zCenter]} castShadow receiveShadow>
                <boxGeometry args={[postW, postH, postD]} />
                <primitive attach="material" object={railMat} />
              </mesh>
            </React.Fragment>
          );
        })}
        
        {/* Top/bottom posts */}
        <mesh position={[-STAIR3_WIDTH/2 + railInset, groundY + STAIR3_BASE_Y + STAIR3_RISE + postH/2, STAIR3_RUN*0.5]} castShadow receiveShadow>
          <boxGeometry args={[postW, postH, postD]} />
          <primitive attach="material" object={railMat} />
        </mesh>
        <mesh position={[STAIR3_WIDTH/2 - railInset, groundY + STAIR3_BASE_Y + STAIR3_RISE + postH/2, STAIR3_RUN*0.5]} castShadow receiveShadow>
          <boxGeometry args={[postW, postH, postD]} />
          <primitive attach="material" object={railMat} />
        </mesh>
        <mesh position={[-STAIR3_WIDTH/2 + railInset, groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH/2, (STAIR3_STEPS-0.5)*STAIR3_RUN]} castShadow receiveShadow>
          <boxGeometry args={[postW, postH, postD]} />
          <primitive attach="material" object={railMat} />
        </mesh>
        <mesh position={[STAIR3_WIDTH/2 - railInset, groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH/2, (STAIR3_STEPS-0.5)*STAIR3_RUN]} castShadow receiveShadow>
          <boxGeometry args={[postW, postH, postD]} />
          <primitive attach="material" object={railMat} />
        </mesh>
        
        {/* Rail bars */}
        <RailBar x={-STAIR3_WIDTH/2 + railInset} yStart={groundY + STAIR3_BASE_Y + STAIR3_RISE + postH} zStart={STAIR3_RUN*0.5} yEnd={groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH} zEnd={(STAIR3_STEPS-0.5)*STAIR3_RUN} thick={topRailThick} />
        <RailBar x={STAIR3_WIDTH/2 - railInset} yStart={groundY + STAIR3_BASE_Y + STAIR3_RISE + postH} zStart={STAIR3_RUN*0.5} yEnd={groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH} zEnd={(STAIR3_STEPS-0.5)*STAIR3_RUN} thick={topRailThick} />
        <RailBar x={-STAIR3_WIDTH/2 + railInset} yStart={groundY + STAIR3_BASE_Y + STAIR3_RISE + postH*(midRailFrac)} zStart={STAIR3_RUN*0.5} yEnd={groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH*(midRailFrac)} zEnd={(STAIR3_STEPS-0.5)*STAIR3_RUN} thick={midRailThick} />
        <RailBar x={STAIR3_WIDTH/2 - railInset} yStart={groundY + STAIR3_BASE_Y + STAIR3_RISE + postH*(midRailFrac)} zStart={STAIR3_RUN*0.5} yEnd={groundY + STAIR3_BASE_Y + STAIR3_STEPS*STAIR3_RISE + postH*(midRailFrac)} zEnd={(STAIR3_STEPS-0.5)*STAIR3_RUN} thick={midRailThick} />
        
        {/* Platform */}
        {plat3Depth > 0 && (
          <mesh position={[0, stair3TopY - plat3Thickness/2 + eps, STAIR3_STEPS * STAIR3_RUN + plat3Depth/2]} castShadow receiveShadow>
            <boxGeometry args={[plat3Width, plat3Thickness, plat3Depth]} />
            <primitive attach="material" object={platformMat} />
          </mesh>
        )}
        {/* Platform edge railings with posts and bars (rotated coordinates) */}
        {(() => {
          const postW = 0.18, postH = 7.0, postD = 0.18; // Much taller posts (half character height)
          const topBarH = 0.12, topBarW = 0.12;
          const midBarH = 0.10, midBarW = 0.10;
          const midRailFrac = 0.5;
          const postSpacing = 1.5;
          const xMin = -plat3Width/2;
          const xMax = plat3Width/2;
          const zMin = STAIR3_STEPS * STAIR3_RUN;
          const zMax = STAIR3_STEPS * STAIR3_RUN + plat3Depth;
          const baseY = stair3TopY;
          
          const posts = [];
          const bars = [];
          
          // Back edge (along X axis in rotated space)
          const backPostCount = Math.ceil(plat3Width / postSpacing) + 1;
          for (let i = 0; i < backPostCount; i++) {
            const t = i / (backPostCount - 1);
            const px = xMin + t * plat3Width;
            posts.push(
              <mesh key={`back3-post-${i}`} position={[px, baseY + postH/2, zMax]} castShadow receiveShadow>
                <boxGeometry args={[postW, postH, postD]} />
                <primitive attach="material" object={railMat} />
              </mesh>
            );
          }
          // Top bar back
          bars.push(
            <mesh key="back3-top" position={[0, baseY + postH, zMax]} castShadow receiveShadow>
              <boxGeometry args={[plat3Width, topBarH, topBarW]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          // Mid bar back
          bars.push(
            <mesh key="back3-mid" position={[0, baseY + postH * midRailFrac, zMax]} castShadow receiveShadow>
              <boxGeometry args={[plat3Width, midBarH, midBarW]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          
          // Left edge (along Z axis in rotated space)
          const leftPostCount = Math.ceil(plat3Depth / postSpacing) + 1;
          for (let i = 0; i < leftPostCount; i++) {
            const t = i / (leftPostCount - 1);
            const pz = zMin + t * plat3Depth;
            posts.push(
              <mesh key={`left3-post-${i}`} position={[xMin, baseY + postH/2, pz]} castShadow receiveShadow>
                <boxGeometry args={[postW, postH, postD]} />
                <primitive attach="material" object={railMat} />
              </mesh>
            );
          }
          // Top bar left
          bars.push(
            <mesh key="left3-top" position={[xMin, baseY + postH, (zMin + zMax)/2]} castShadow receiveShadow>
              <boxGeometry args={[topBarW, topBarH, plat3Depth]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          // Mid bar left
          bars.push(
            <mesh key="left3-mid" position={[xMin, baseY + postH * midRailFrac, (zMin + zMax)/2]} castShadow receiveShadow>
              <boxGeometry args={[midBarW, midBarH, plat3Depth]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          
          // Right edge (along Z axis in rotated space)
          const rightPostCount = Math.ceil(plat3Depth / postSpacing) + 1;
          for (let i = 0; i < rightPostCount; i++) {
            const t = i / (rightPostCount - 1);
            const pz = zMin + t * plat3Depth;
            posts.push(
              <mesh key={`right3-post-${i}`} position={[xMax, baseY + postH/2, pz]} castShadow receiveShadow>
                <boxGeometry args={[postW, postH, postD]} />
                <primitive attach="material" object={railMat} />
              </mesh>
            );
          }
          // Top bar right
          bars.push(
            <mesh key="right3-top" position={[xMax, baseY + postH, (zMin + zMax)/2]} castShadow receiveShadow>
              <boxGeometry args={[topBarW, topBarH, plat3Depth]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          // Mid bar right
          bars.push(
            <mesh key="right3-mid" position={[xMax, baseY + postH * midRailFrac, (zMin + zMax)/2]} castShadow receiveShadow>
              <boxGeometry args={[midBarW, midBarH, plat3Depth]} />
              <primitive attach="material" object={railMat} />
            </mesh>
          );
          
          return <>{posts}{bars}</>;
        })()}
      </group>
    </group>
  );
}

// A thin box with different materials on top and bottom (wood top, ceiling bottom)
function PlatformBlock({ position = [0,0,0], size = [10,0.2,10] }) {
  const [w, h, d] = size;
  // Top: use the provided metal floor texture and tile it so it reads well at large size
  const topTex = useTexture('/textures/metal_floor.png');
  useEffect(() => {
    if (topTex) {
      topTex.wrapS = topTex.wrapT = THREE.RepeatWrapping;
      topTex.anisotropy = 8;
  // Compute repeats and then reduce tiling density by ~95% (make tiles much larger)
      const baseRepX = Math.max(1, Math.round(w / 4));
      const baseRepY = Math.max(1, Math.round(d / 4));
  const repX = Math.max(1, Math.round(baseRepX * 0.05));
  const repY = Math.max(1, Math.round(baseRepY * 0.05));
      topTex.repeat.set(repX, repY);
      topTex.needsUpdate = true;
    }
  }, [topTex, w, d]);

  // Bottom: make a subtle ceiling tile grid procedurally
  const ceilingTex = useMemo(() => {
    const W = 512, H = 512; const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
    // base off-white
    ctx.fillStyle = '#f0f3f6'; ctx.fillRect(0,0,W,H);
    // grid lines
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2;
    const tiles = 8; const sx = W/tiles, sy = H/tiles;
    for (let i=1;i<tiles;i++){ ctx.beginPath(); ctx.moveTo(i*sx,0); ctx.lineTo(i*sx,H); ctx.stroke(); }
    for (let j=1;j<tiles;j++){ ctx.beginPath(); ctx.moveTo(0,j*sy); ctx.lineTo(W,j*sy); ctx.stroke(); }
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }, []);
  // Repeat bottom similarly
  const botRepeatX = Math.max(1, Math.floor(w / 6));
  const botRepeatY = Math.max(1, Math.floor(d / 6));
  useEffect(() => {
    if (ceilingTex) {
      ceilingTex.repeat.set(botRepeatX, botRepeatY);
      ceilingTex.needsUpdate = true;
    }
  }, [ceilingTex, botRepeatX, botRepeatY]);

  // Materials for box faces: order is +X, -X, +Y(top), -Y(bottom), +Z, -Z
  const sideMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.05, roughness: 0.9 }), []);
  const topMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', map: topTex, metalness: 0.35, roughness: 0.6 }), [topTex]);
  const botMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', map: ceilingTex, metalness: 0.02, roughness: 0.95 }), [ceilingTex]);
  const materials = useMemo(() => [sideMat, sideMat, topMat, botMat, sideMat, sideMat], [sideMat, topMat, botMat]);

  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      {materials.map((m, i) => (
        <primitive key={i} object={m} attach={`material-${i}`} />
      ))}
    </mesh>
  );
}

function StairCollisionDebug({ show = false }) {
  const [aabbs, setAabbs] = React.useState([]);
  const meshRefs = React.useRef([]);
  
  // Update AABBs every frame to read live transforms
  useFrame(() => {
    if (!show) return;
    const newAabbs = buildStairAABBsWorld();
    
    // Update mesh positions/scales based on new AABBs
    newAabbs.forEach((b, idx) => {
      const meshRef = meshRefs.current[idx];
      if (meshRef) {
        const sx = (b.max.x - b.min.x);
        const sy = (b.max.y - b.min.y);
        const sz = (b.max.z - b.min.z);
        const cx = (b.min.x + b.max.x) / 2;
        const cy = (b.min.y + b.max.y) / 2;
        const cz = (b.min.z + b.max.z) / 2;
        
        meshRef.position.set(cx, cy, cz);
        meshRef.scale.set(sx, sy, sz);
      }
    });
    
    // Update state if AABB count changed (cubes added/removed)
    if (newAabbs.length !== aabbs.length) {
      setAabbs(newAabbs);
    }
  });
  
  // Initialize AABBs on mount
  React.useEffect(() => {
    if (show) {
      setAabbs(buildStairAABBsWorld());
    }
  }, [show]);
  
  if (!show) return null;
  
  const meshes = aabbs.map((b, idx) => {
    const sx = (b.max.x - b.min.x);
    const sy = (b.max.y - b.min.y);
    const sz = (b.max.z - b.min.z);
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // Red for disabled stair1, cyan for stair2, green for stair3
    const color = b.disabled ? '#ef4444' : (b.stair3 ? '#22ff22' : '#22d3ee');
    return (
      <mesh 
        key={`scb-${idx}`} 
        ref={el => meshRefs.current[idx] = el}
        position={[cx, cy, cz]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.6} depthWrite={false} />
      </mesh>
    );
  });
  return <group>{meshes}</group>;
}

// Large 3D asteroids drifting by in the far background
function FlybyAsteroids({ count = 3, speed = 0.22, dir = [1, 0.25] }) {
  const groupRef = useRef();
  
  // Seeded random function so all players see the same asteroids
  const seededRandom = useMemo(() => {
    let seed = 12345; // Fixed seed for deterministic asteroids
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }, []);
  
  const rng = useMemo(() => seededRandom() * 1000, [seededRandom]);
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  
  // Load the asteroid_fly FBX model
  const asteroidFBX = useFBX('/models/props/asteroid/asteroid_fly.fbx');
  
  const asteroids = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      // Distribute asteroids all around the playing area
      const angle = (i / count) * Math.PI * 2 + seededRandom() * 0.5;  // Spread around 360°
      
      // Varied distances: keep asteroids outside walking area (PLAY_AREA_RADIUS=450)
      const distanceType = i % 3; // Cycle through 3 distance types
      let radius, scale;
      if (distanceType === 0) {
        // Close asteroids - smaller scale, stay outside play area
        radius = 550 + seededRandom() * 500;  // 550-1050 (clear of 450 play area)
        scale = 0.5 + seededRandom() * 1.0;   // 0.5-1.5
      } else if (distanceType === 1) {
        // Medium asteroids - medium scale
        radius = 1100 + seededRandom() * 1000;  // 1100-2100
        scale = 1.0 + seededRandom() * 1.5;     // 1.0-2.5
      } else {
        // Far asteroids - bigger scale for visibility
        radius = 2200 + seededRandom() * 2000;  // 2200-4200
        scale = 2.0 + seededRandom() * 3.0;     // 2.0-5.0
      }
      
      // Mix of asteroids: some start below, some start above
      const startBelow = seededRandom() > 0.5;
      const heightVariation = startBelow 
        ? -1500 + seededRandom() * 1000  // Start below: -1500 to -500
        : 500 + seededRandom() * 2000;   // Start above: +500 to +2500
      
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = heightVariation;
      
      arr.push({
        pos: new THREE.Vector3(x, y, z),
        rot: new THREE.Euler(seededRandom()*Math.PI, seededRandom()*Math.PI, seededRandom()*Math.PI),
        rps: new THREE.Vector3((seededRandom()*0.2-0.1), (seededRandom()*0.2-0.1), (seededRandom()*0.2-0.1)),
        scale: scale,
        risingSpeed: 0.05 + seededRandom() * 0.1,  // Slow rising speed: 0.05 to 0.15
        opacity: 1.0,  // Track opacity for fading
        radius: radius  // Store radius for reference
      });
    }
    return arr;
  }, [count, seededRandom]);

  // Create clones of the FBX model for each asteroid
  const clones = useMemo(() => {
    if (!asteroidFBX) return [];
    const arr = [];
    for (let i = 0; i < count; i++) {
      const clone = skeletonClone(asteroidFBX);
      if (clone) arr.push(clone);
    }
    return arr;
  }, [asteroidFBX, count]);

  useFrame(() => {
    // Use time relative to a fixed reference point (Jan 1, 2025 UTC) 
    // so asteroids loop consistently when rejoining games
    const REFERENCE_TIME = 1735689600; // Unix timestamp for 2025-01-01T00:00:00Z in seconds
    const t = (Date.now() / 1000) - REFERENCE_TIME; // Keep decimal precision for smooth animation
    if (!groupRef.current) return;
    groupRef.current.children.forEach((m, i) => {
      const base = asteroids[i]; if (!base) return;
      
      // Time-based animation (deterministic, not accumulative)
      // Each asteroid gets a time offset based on its index for variety
      const asteroidTime = t + (i * 50); // Offset by index
      
      // Orbital rotation - deterministic based on time
      const orbitSpeed = speed * 0.025; // Increased from 0.018 for faster orbiting
      const baseAngle = Math.atan2(base.pos.z, base.pos.x);
      const angle = baseAngle + (asteroidTime * orbitSpeed);
      
      m.position.x = Math.cos(angle) * base.radius;
      m.position.z = Math.sin(angle) * base.radius;
      
      // Vertical movement - cycle through full range deterministically
      const verticalRange = 6500; // Total range: -2000 to +4500
      const verticalMin = -2000;
      const cycleSpeed = base.risingSpeed * 80; // Increased from 60 for faster rising
      const rawPosition = asteroidTime * cycleSpeed;
      const progress = (rawPosition % verticalRange) / verticalRange;
      m.position.y = verticalMin + (progress * verticalRange);
      
      // Fade out when approaching top (far in the distance), fade in when approaching bottom
      if (m.position.y > 3500) {
        // Fade out over the last 1000 units (3500 to 4500) - very far away
        base.opacity = Math.max(0, 1 - (m.position.y - 3500) / 1000);
      } else if (m.position.y < -1000) {
        // Fade in over first 1000 units (-2000 to -1000) - very far below
        base.opacity = Math.min(1, (m.position.y + 2000) / 1000);
      } else {
        // Fully visible in the middle range (-1000 to 3500)
        base.opacity = 1;
      }
      
      // Apply opacity to all materials
      m.traverse((child) => {
        if (child.isMesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              mat.transparent = true;
              mat.opacity = base.opacity;
            });
          } else {
            child.material.transparent = true;
            child.material.opacity = base.opacity;
          }
        }
      });
      
      // Spinning rotation - time-based for synchronization (faster spin)
      m.rotation.x = base.rot.x + (asteroidTime * base.rps.x * 0.9);
      m.rotation.y = base.rot.y + (asteroidTime * base.rps.y * 0.9);
      m.rotation.z = base.rot.z + (asteroidTime * base.rps.z * 0.9);
    });
  });

  if (!asteroidFBX || clones.length === 0) return null;

  return (
    <group ref={groupRef} renderOrder={-7}>
      {asteroids.map((a, idx) => {
        const clone = clones[idx];
        if (!clone) return null;
        return (
          <primitive 
            key={idx} 
            object={clone} 
            position={a.pos} 
            rotation={a.rot} 
            scale={a.scale}
          />
        );
      })}
    </group>
  );
}

// Dense, small galaxy-like star clusters (hundreds of tight points per cluster)
function GalaxyClusters({ clusterCount = 7, pointsPerCluster = 600, radius = 720, spread = 0.035, speed = 0.08, dir = [1, 0.25] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const childRefs = useRef([]);
  const axesRef = useRef([]);
  const spinRef = useRef([]);

  const clusters = useMemo(() => {
    const list = [];
    const randOnSphere = () => {
      // Bias to be mostly in the far background (z negative)
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v1 - 1);
        v = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
      } while (v.z > -0.1); // ensure it’s generally behind
      return v.normalize();
    };
    for (let i = 0; i < clusterCount; i++) {
      const dirV = randOnSphere();
      // Build tangent frame (u,v) for sampling on the sphere around dirV
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      // Generate local points around origin; we'll place a group at `center`
      const positions = new Float32Array(pointsPerCluster * 3);
      const colors = new Float32Array(pointsPerCluster * 3);
      // random tilt of cluster disc within its own local frame (rotate u/v basis)
      const tilt = new THREE.Euler(Math.random()*0.6 - 0.3, Math.random()*Math.PI*2.0, Math.random()*0.6 - 0.3);
      const rotM = new THREE.Matrix4().makeRotationFromEuler(tilt);
      const uu = u.clone().applyMatrix4(rotM);
      const vv = v.clone().applyMatrix4(rotM);
      for (let p = 0; p < pointsPerCluster; p++) {
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const gx = r1 * Math.cos(th) * spread * radius;
        const gy = r1 * Math.sin(th) * spread * radius;
        const pos = uu.clone().multiplyScalar(gx).add(vv.clone().multiplyScalar(gy));
        positions[p*3+0] = pos.x; positions[p*3+1] = pos.y; positions[p*3+2] = pos.z;
        const c = 0.92 + Math.random()*0.08;
        colors[p*3+0] = c; colors[p*3+1] = c; colors[p*3+2] = 1.0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // random spin axis and speed per cluster
      const axis = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
      const spin = 0.0003 + Math.random()*0.0007; // slow spin
      list.push({ geometry: g, center, axis, spin });
    }
    return list;
  }, [clusterCount, pointsPerCluster, radius, spread]);

  const mat = useMemo(() => new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  // Dispose generated cluster geometries/material on unmount
  useEffect(() => {
    return () => {
      try { mat?.dispose?.(); } catch {}
      try { clusters?.forEach?.(c => c.geometry?.dispose?.()); } catch {}
    };
  }, [mat, clusters]);

  useFrame(() => {
    // Subtle drift and slow rotation to suggest movement
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.0006; // slow yaw
    groupRef.current.position.x += -d.x * speed * 0.5;
    groupRef.current.position.z += -d.y * speed * 0.9;
    // wrap position slightly to prevent drift far from origin
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 200) groupRef.current.position.x = -200;
    if (gx < -200) groupRef.current.position.x = 200;
    if (gz > 200) groupRef.current.position.z = -200;
    if (gz < -200) groupRef.current.position.z = 200;
    // Per-cluster gentle spin
    if (childRefs.current) {
      for (let i = 0; i < childRefs.current.length; i++) {
        const child = childRefs.current[i];
        const axis = axesRef.current[i];
        const s = spinRef.current[i];
        if (child && axis && s) {
          child.rotateOnAxis(axis, s);
        }
      }
    }
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      {clusters.map((c, i) => (
        <group
          key={i}
          position={c.center}
          ref={el => { childRefs.current[i] = el; axesRef.current[i] = c.axis; spinRef.current[i] = c.spin; }}
        >
          <points geometry={c.geometry} material={mat} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Foreground "star swarms": occasional tight clusters of various sizes flying by
function StarSwarms({ maxSwarms = 5, basePoints = 500, dir = [1.0, 0.25], speed = 0.18, spawnMin = 4, spawnMax = 9 }) {
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const groupRef = useRef();
  const timerRef = useRef(0);
  const nextSpawnRef = useRef((spawnMin + Math.random() * (spawnMax - spawnMin)));

  // Build N reusable swarm groups, each made of 3 point sets (small/med/large)
  const swarms = useMemo(() => {
    const makeGeom = (count, spread) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        // gaussian cluster around origin
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const rx = r1 * Math.cos(th) * spread;
        const ry = r1 * Math.sin(th) * spread * 0.6; // slightly flattened
        pos[i*3+0] = rx;
        pos[i*3+1] = (Math.random()-0.5) * spread * 0.4; // a little thickness
        pos[i*3+2] = ry;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return g;
    };
    const list = [];
    for (let i = 0; i < maxSwarms; i++) {
      // Less clustery, larger spread so it reads as a background galaxy patch
      const small = makeGeom(Math.floor(basePoints * 0.65), 30.0);
      const medium = makeGeom(Math.floor(basePoints * 0.28), 22.0);
      const large = makeGeom(Math.floor(basePoints * 0.12), 14.0);
      list.push({
        small, medium, large,
        state: { active: false, ttl: 0, spd: 0.5 + Math.random()*0.6 },
        ref: React.createRef()
      });
    }
    return list;
  }, [maxSwarms, basePoints]);

  const matSmall = useMemo(() => new THREE.PointsMaterial({ size: 1.2, color: '#e6ecff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matMedium = useMemo(() => new THREE.PointsMaterial({ size: 2.0, color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matLarge = useMemo(() => new THREE.PointsMaterial({ size: 3.2, color: '#fff7df', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  useEffect(() => {
    return () => { try { matSmall?.dispose?.(); matMedium?.dispose?.(); matLarge?.dispose?.(); } catch {} };
  }, [matSmall, matMedium, matLarge]);

  // Spawn a swarm from ahead in travel direction
  const spawnSwarm = useCallback((item) => {
    const g = item.ref.current;
    if (!g) return;
    // Place "waaaay" in the background but within far plane
  const zStart = -650 + Math.random()*200; // [-650, -450]
  const startX = (Math.random()-0.5) * 300; // centered horizontally
  const updown = (Math.random()-0.2) * 110; // slight vertical variance
  g.position.set(startX, updown, zStart);
    item.state.active = true;
    item.state.ttl = 15.0 + Math.random() * 7.0; // seconds
    item.state.spd = 0.6 + Math.random()*0.6;
    g.visible = true;
  }, [d]);

  useFrame((_, delta) => {
    timerRef.current += delta;
    if (timerRef.current >= nextSpawnRef.current) {
      // find an inactive swarm and spawn
      const target = swarms.find(s => !s.state.active);
      if (target) spawnSwarm(target);
      timerRef.current = 0;
      nextSpawnRef.current = (spawnMin + Math.random() * (spawnMax - spawnMin));
    }
    // update active swarms
    swarms.forEach((s) => {
      if (!s.state.active || !s.ref.current) return;
      s.state.ttl -= delta;
      // Drift mostly sideways across the background with minimal depth change
      const perp = new THREE.Vector2(-d.y, d.x);
      const vx = perp.x * speed * s.state.spd * 40.0 * delta;
      const vz = perp.y * speed * s.state.spd * 40.0 * delta + (-d.y * speed * 8.0 * delta);
      s.ref.current.position.x += vx;
      s.ref.current.position.z += vz;
      // Keep within a background band and screen-ish X range
      if (s.state.ttl <= 0 || Math.abs(s.ref.current.position.x) > 480 || s.ref.current.position.z < -900 || s.ref.current.position.z > -380) {
        s.state.active = false;
        s.ref.current.visible = false;
      }
    });
  });

  return (
    <group ref={groupRef} renderOrder={-6}>
      {swarms.map((s, i) => (
        <group key={i} ref={s.ref} visible={false}>
          <points geometry={s.small} material={matSmall} frustumCulled={false} />
          <points geometry={s.medium} material={matMedium} frustumCulled={false} />
          <points geometry={s.large} material={matLarge} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Very dense galaxy field (~200k points) with tight clusters and mixed sizes
function DenseGalaxyField({ totalPoints = 220000, clusters = 12, radius = 750, clusterSpread = 0.02, speed = 0.05, dir = [1.0, 0.25], sizeRange = [1.4, 3.6] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Generate cluster centers on far sphere (behind camera mostly)
  const centers = useMemo(() => {
    const arr = [];
    const pickDir = () => {
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2*Math.PI*u;
        const phi = Math.acos(2*v1-1);
        v = new THREE.Vector3(
          Math.sin(phi)*Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi)*Math.sin(theta)
        );
      } while (v.z > -0.05);
      return v.normalize();
    };
    for (let i=0;i<clusters;i++) {
      const dirV = pickDir();
      // build tangent basis
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      arr.push({ dirV, u, v, center, weight: 0.8 + Math.random()*0.6 });
    }
    return arr;
  }, [clusters, radius]);

  // Allocate attributes once with defensive fallback to avoid huge/NaN allocations
  const { geometry } = useMemo(() => {
    // Sanitize and clamp total points
    const maxPts = 350000;
    const minPts = 8000;
    let target = Number(totalPoints);
    if (!Number.isFinite(target) || target <= 0) target = 220000;
    if (process.env.NODE_ENV !== 'production') target = Math.min(target, 180000);
    target = Math.max(minPts, Math.min(maxPts, Math.floor(target)));

    let g = null;
    let attempts = 0;
    while (!g && target >= minPts && attempts < 6) {
      try {
        const positions = new Float32Array(target * 3);
        const colors = new Float32Array(target * 3);
        const sizes = new Float32Array(target);
        // Weighted cluster selection
        const weights = centers.map(c => c.weight);
        const sumW = weights.reduce((a,b)=>a+b,0) || 1;
        for (let i=0;i<target;i++){
          // pick a center
          let r = Math.random()*sumW; let k=0; for(;k<centers.length;k++){ r-=weights[k]; if (r<=0) break; }
          const C = centers[k] || centers[0];
          // 2D gaussian offset in tangent plane
          const r1 = Math.sqrt(-2.0*Math.log(Math.max(1e-6, Math.random())));
          const th = 2.0*Math.PI*Math.random();
          const gx = r1*Math.cos(th)*clusterSpread*radius;
          const gy = r1*Math.sin(th)*clusterSpread*radius*0.75;
          const pos = C.center.clone().add(C.u.clone().multiplyScalar(gx)).add(C.v.clone().multiplyScalar(gy));
          const npos = pos.normalize().multiplyScalar(radius);
          const idx = i*3;
          positions[idx+0]=npos.x; positions[idx+1]=npos.y; positions[idx+2]=npos.z;
          // color with slight blue-white variance
          const c = 0.9 + Math.random()*0.1;
          colors[idx+0]=c; colors[idx+1]=c; colors[idx+2]=1.0;
          // size: more small than large
          const tsize = Math.pow(Math.random(), 2.2); // bias small
          sizes[i] = sizeRange[0] + (sizeRange[1]-sizeRange[0]) * tsize;
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(positions,3));
        gg.setAttribute('color', new THREE.BufferAttribute(colors,3));
        gg.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));
        g = gg;
      } catch (e) {
        try { console.warn('[DenseGalaxyField] allocation failed for', target, 'points; reducing.', e?.message || e); } catch {}
        target = Math.floor(target * 0.6);
        attempts++;
      }
    }
    if (!g) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(minPts),1));
      return { geometry: gg };
    }
    return { geometry: g };
  }, [totalPoints, centers, clusterSpread, radius, sizeRange]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1.0 },
    },
    vertexShader: `
      attribute float aSize; varying vec3 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float size = aSize * (300.0 / max(1.0, dist));
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vColor; uniform float uOpacity;
      void main(){
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float r = dot(uv, uv);
        float alpha = smoothstep(1.0, 0.0, r);
        vec3 col = vColor * 1.15;
        gl_FragColor = vec4(col, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  // Cleanup to reduce memory pressure during hot reloads
  useEffect(() => {
    return () => {
      try { geometry?.dispose?.(); } catch {}
      try { material?.dispose?.(); } catch {}
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.00035; // slow yaw
    groupRef.current.position.x += -d.x * speed * 30.0 * delta;
    groupRef.current.position.z += -d.y * speed * 60.0 * delta;
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 200) groupRef.current.position.x = -200;
    if (gx < -200) groupRef.current.position.x = 200;
    if (gz > 200) groupRef.current.position.z = -200;
    if (gz < -200) groupRef.current.position.z = 200;
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

function OpponentAvatar({ flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match key dims used by other parts so placement stays consistent
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // frame height
  const groundY = -fh / 2 - GROUND_CLEAR;

  // WoodenTable dims (keep in sync with WoodenTable)
  // (Not directly used here; avatar anchors to groundY)

  // Place avatar across the table relative to current camera: same distance, opposite side
  const posX = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const posY = AVATAR_BAKED_POS[1];
  const posZ = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const faceDir = posZ >= 0 ? -1 : 1; // look toward board center (z=0)

  // Scale avatar (mobile adjustment currently unified to 1)
  const scale = 5 * (Number.isFinite(scaleOverride) ? scaleOverride : 1);

  // Anchor the avatar feet on the ground, level with table leg bottoms
  // Stand on the same floor plane used by NeonFloor and table legs
  const anchorY = groundY;

  // Simple stylized figure
  const bodyH = 1.8;
  const bodyR = 0.4;
  const headR = 0.36;
  const neckH = 0.18;
  const shoulderW = 1.0;
  const armR = 0.16;
  const armL = 0.9;

  const fabric = '#1f2937';
  const fabricEm = '#0b1220';
  const skin = '#d1a68a';

  const groupRotation = rotationOverride ?? [0, posZ > 0 ? Math.PI : 0, 0];
  const groupRef = useRef();
  const upperRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const baseY = anchorY + posY; // keep root anchored
  const startRotZ = groupRotation?.[2] || 0;
  useFrame(({ clock }) => {
    const g = groupRef.current;
    const u = upperRef.current;
    if (!g || !u) return;
    const t = clock.getElapsedTime();
  g.position.x = posX;
  g.position.y = baseY;
  g.position.z = posZ;
  g.scale.set(scale, scale, scale);
    // Move only the upper body: root stays fixed at ground
    const bob = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * AVATAR_IDLE_AMP_Y;
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const breath = Math.sin(t * 0.45) * 0.02;         // slower chest/torso pitch
    g.rotation.z = startRotZ;      // no whole-body tilt
    u.position.y = 0.15 + bob;     // upper body bob
    u.rotation.z = sway;           // upper body sway
    u.rotation.x = breath;         // gentle forward/back rock
    // arm micro motion (adds a little life)
    if (leftArmRef.current)  leftArmRef.current.rotation.x =  0.03 * Math.sin(t * 1.1);
    if (rightArmRef.current) rightArmRef.current.rotation.x = -0.03 * Math.sin(t * 1.1);
  });
  return (
  <group ref={groupRef} position={[posX, baseY, posZ]} rotation={groupRotation} scale={[scale, scale, scale]} raycast={null} frustumCulled={false}>
      {/* Upper body wrapper so feet/root remain planted */}
      <group ref={upperRef} position={[0, 0.15, 0]}>
        {/* Torso */}
        <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[bodyR, Math.max(0.2, bodyH - bodyR * 2), 8, 16]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>
        {/* Head + neck */}
        <mesh position={[0, bodyH + neckH + headR, 0]} castShadow>
        <sphereGeometry args={[headR, 24, 24]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>
        <mesh position={[0, bodyH + neckH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR * 0.45, headR * 0.5, neckH, 12]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>

        {/* Simple shoulders */}
        <mesh position={[0, bodyH - 0.3, 0]} castShadow>
        <boxGeometry args={[shoulderW, 0.28, 0.5]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>

        {/* Arms resting on table edge */}
        <group position={[0, 0.05, faceDir * 0.25]}>
        <mesh ref={leftArmRef} position={[ shoulderW / 2 - 0.2, 0, 0]} rotation={[0, 0, Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
          <mesh ref={rightArmRef} position={[-shoulderW / 2 + 0.2, 0, 0]} rotation={[0, 0, -Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
        </group>

        {/* Minimal face hint: two eyes (always toward center) */}
        <group position={[0, bodyH + neckH + headR, faceDir * 0.28]}>
        <mesh position={[-0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
          <mesh position={[ 0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function resolveAvatarUrl({ flip180 } = {}) {
  try {
    const envUrl = (process.env.REACT_APP_OPPONENT_MODEL_URL || process.env.REACT_APP_AVATAR_URL || '').trim();
    if (envUrl) return envUrl;
  } catch {}
  try {
    const winUrl = (window.OPPONENT_MODEL_URL ? String(window.OPPONENT_MODEL_URL).trim() : (window.AVATAR_URL ? String(window.AVATAR_URL).trim() : ''));
    if (winUrl) return winUrl;
  } catch {}
  // Always use the robot model (two separate instances)
  return '/models/avatars/robot/scene.gltf';
}

// Preload avatars (Player1 robot, Player2 tire)
try { useGLTF.preload('/models/avatars/robot/scene.gltf'); } catch {}
try { useGLTF.preload('/models/avatars/tire/scene.gltf'); } catch {} // may still be used later
try { useGLTF.preload('/models/avatars/capuccino/scene.gltf'); } catch {} // kept for future
try { useGLTF.preload('/models/avatars/shark/scene.gltf'); } catch {}

// Preload Alien 2 FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Walking_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Running_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx'); } catch {}
// Preload Astronaut FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Walking.fbx'); } catch {}
// Preload Guy1 FBX clips
try { useFBX.preload('/models/avatars/guy1/Happy Idle (1).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Walking (5).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Walking Backwards.fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Running (3).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Left Turn (4).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Right Turn (2).fbx'); } catch {}
try { useFBX.preload('/models/avatars/guy1/Jumping.fbx'); } catch {}

// Fixed scale multiplier to reach final absolute height after normalization (inlined where needed)

function LoadedOpponent({ url, flip180, anchorY, z, faceDir, scaleMul, rotationOverride = null, positionOverride = null, xFront, xBack, zSign = -1 }) {
  const { scene, animations } = useGLTF(url);
  const isCapuccino = /capuccino/i.test(url);
  // Use SkeletonUtils.clone to preserve skinned mesh + skeleton hierarchy (fixes partial/missing geometry)
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const ref = useRef();
  const spineRef = useRef(null);
  const headRef = useRef(null);
  const shoulders = useRef({ left: null, right: null });
  // Attempt to keep decorative tube(s) anchored: collect all likely nodes by name
  const tubeRefs = useRef({ head: new Set(), body: new Set() });
  // Explicit bone map for the Neon Robot model (from provided GLTF node names)
  const boneMap = useRef({ spine0: null, spine1: null, spine2: null, lShoulder: null, rShoulder: null, lElbow: null, rElbow: null });
  // Base positions to allow gentle up/down bobbing without drifting
  const basePos = useRef({ spine: null, l: null, r: null, head: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store initial rotations so we animate relative to the bind pose
  const baseRot = useRef({ spine: null, head: null, l: null, r: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store the model root's normalized transform so animations can't drift it
  const baseRoot = useRef({ pos: new THREE.Vector3(0,0,0), rot: new THREE.Euler(0,0,0), scale: new THREE.Vector3(1,1,1) });
  // Built-in animation handling
  const groupRef = useRef();
  const { actions, names, clips } = useAnimations(animations || [], ref);
  const hasClips = !!(clips && clips.length);
  useLayoutEffect(() => {
  if (!ref.current || !cloned) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      // Center inner root around its visual center so group pivot acts as true center
      ref.current.position.x += -center.x;
      ref.current.position.z += -center.z;
      const isCap = /capuccino/i.test(url);
      const isShark = /shark/i.test(url);
      if (isCap) {
        // Heuristic: choose a child with a moderate vertical extent as the "body" (ignoring far separated props)
        let bodyNode = null;
        let bodyHeight = Infinity;
        let bodyMinY = 0;
        ref.current.children.forEach(ch => {
          if (!ch.isObject3D) return;
          const cb = new THREE.Box3().setFromObject(ch);
            if (cb.isEmpty()) return;
            const h = cb.max.y - cb.min.y;
            // Skip extremely tall groups (likely including floating weapons) and very tiny ones
            if (h <= 0) return;
            if (h > size.y * 0.95) return; // looks like full range including props
            if (h < size.y * 0.02) return; // too small (single part)
            // Prefer a height closest to 30% of global size or just the first reasonable one
            const targetFrac = 0.30 * size.y;
            const score = Math.abs(h - targetFrac);
            // Track best candidate by minimal score; fallback to smallest reasonable height if not set
            if (!bodyNode || score < bodyHeight) {
              bodyNode = ch;
              bodyHeight = score;
              bodyMinY = cb.min.y;
            }
        });
        // Fallback: if no candidate, use global but clamp to avoid huge compression
        let effectiveHeight;
        let effectiveMinY;
        if (bodyNode) {
          const bb = new THREE.Box3().setFromObject(bodyNode);
          effectiveHeight = Math.max(0.0001, bb.max.y - bb.min.y);
          effectiveMinY = bb.min.y;
        } else {
          effectiveHeight = Math.max(0.0001, size.y * 0.45); // assume body is ~45% of total span
          effectiveMinY = box.min.y + size.y * 0.25; // ignore bottom quarter (possible outliers)
        }
        // Ground by shifting so chosen minY lands at y=0
        ref.current.position.y += -effectiveMinY;
        const desired = AVATAR_BASE_HEIGHT;
        const s = desired / effectiveHeight;
        ref.current.scale.multiplyScalar(s);
      } else if (isShark) {
        // Shark path: treat like robot (full recenter) PLUS glue obvious accessories to closest large parent before scaling
        const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
        const meshes = [];
        ref.current.traverse(o => { if (o.isMesh) meshes.push(o); });
        // Determine primary body as largest volume mesh
        let bodyMesh = null; let maxVol = 0;
        meshes.forEach(m => { const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return; const s2 = new THREE.Vector3(); b.getSize(s2); const vol = s2.x*s2.y*s2.z; if (vol > maxVol) { maxVol = vol; bodyMesh = m; } });
        if (bodyMesh) {
          meshes.forEach(m => {
            if (m === bodyMesh) return;
            if (accessoryRegex.test(m.name || '')) {
              try { bodyMesh.attach(m); } catch {}
            }
          });
        }
        // Recompute box after attaching
        const box2 = new THREE.Box3().setFromObject(ref.current);
        const size2 = new THREE.Vector3(); const center2 = new THREE.Vector3();
        box2.getSize(size2); box2.getCenter(center2);
        ref.current.position.x += -center2.x;
        ref.current.position.z += -center2.z;
        ref.current.position.y += -box2.min.y;
        if (size2.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size2.y;
          ref.current.scale.setScalar(s);
        }
      } else {
        // Robot (default) path: full recenter
        ref.current.position.x += -center.x;
        ref.current.position.z += -center.z;
        ref.current.position.y += -box.min.y;
        if (size.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size.y;
          ref.current.scale.setScalar(s);
        }
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const dbgBox = new THREE.Box3().setFromObject(ref.current);
        const dbgSize = new THREE.Vector3(); dbgBox.getSize(dbgSize);
        // eslint-disable-next-line no-console
        console.log('[Capuccino Avatar] normalized root', {
          pos: ref.current.position.clone(),
          scale: ref.current.scale.clone(),
          size: dbgSize
        });
      } catch {}
    }
    // Record the normalized root transform as our baseline
    baseRoot.current.pos.copy(ref.current.position);
    baseRoot.current.rot.copy(ref.current.rotation);
    baseRoot.current.scale.copy(ref.current.scale);
    // Skip robot-specific bone/tube mapping for capuccino model to prevent scattering
  if (!/capuccino/i.test(url) && !/shark/i.test(url)) {
      ref.current.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
        if (o.isBone) {
          const name = (o.name || '').toLowerCase();
          if (!spineRef.current && (name.includes('spine') || name.includes('chest'))) spineRef.current = o;
          if (!headRef.current && name.includes('head')) headRef.current = o;
          if (!spineRef.current && name.includes('hips')) spineRef.current = o;
          if (!shoulders.current.left && (name.includes('shoulder') && (name.includes('l') || name.includes('left') || name.endsWith('.l')))) shoulders.current.left = o;
          if (!shoulders.current.right && (name.includes('shoulder') && (name.includes('r') || name.includes('right') || name.endsWith('.r')))) shoulders.current.right = o;
          switch (o.name) {
            case 'Bone_00': boneMap.current.spine0 = o; break;
            case 'Bone.001_01': boneMap.current.spine1 = o; break;
            case 'Bone.002_02': boneMap.current.spine2 = o; break;
            case 'Bone.003_03': boneMap.current.lShoulder = o; break;
            case 'Bone.004_04': boneMap.current.lElbow = o; break;
            case 'Bone.005_05': boneMap.current.rShoulder = o; break;
            case 'Bone.006_06': boneMap.current.rElbow = o; break;
            default: break;
          }
        }
      });
    } else {
      // Still enable shadows for meshes in capuccino hierarchy
      ref.current.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    }

    // If we detected tube nodes, attach them to the appropriate bones/groups so they follow animation
    const headBone = headRef.current || boneMap.current.spine2 || null;
    const bodyBone = boneMap.current.spine1 || boneMap.current.spine0 || spineRef.current || null;
    try {
      if (headBone && tubeRefs.current.head.size) {
        tubeRefs.current.head.forEach((node) => {
          if (node && node.parent !== headBone) headBone.attach(node);
        });
      }
    } catch {}
    try {
      if (bodyBone && tubeRefs.current.body.size) {
        tubeRefs.current.body.forEach((node) => {
          if (node && node.parent !== bodyBone) bodyBone.attach(node);
        });
      }
    } catch {}
    // Record base rotations once
    baseRot.current.spine  = spineRef.current?.rotation ? spineRef.current.rotation.clone() : null;
    baseRot.current.head   = headRef.current?.rotation ? headRef.current.rotation.clone() : null;
    baseRot.current.l      = shoulders.current.left?.rotation ? shoulders.current.left.rotation.clone() : null;
    baseRot.current.r      = shoulders.current.right?.rotation ? shoulders.current.right.rotation.clone() : null;
    baseRot.current.spine0 = boneMap.current.spine0?.rotation ? boneMap.current.spine0.rotation.clone() : null;
    baseRot.current.spine1 = boneMap.current.spine1?.rotation ? boneMap.current.spine1.rotation.clone() : null;
    baseRot.current.spine2 = boneMap.current.spine2?.rotation ? boneMap.current.spine2.rotation.clone() : null;
    baseRot.current.lSh    = boneMap.current.lShoulder?.rotation ? boneMap.current.lShoulder.rotation.clone() : null;
    baseRot.current.rSh    = boneMap.current.rShoulder?.rotation ? boneMap.current.rShoulder.rotation.clone() : null;
    baseRot.current.lEl    = boneMap.current.lElbow?.rotation ? boneMap.current.lElbow.rotation.clone() : null;
    baseRot.current.rEl    = boneMap.current.rElbow?.rotation ? boneMap.current.rElbow.rotation.clone() : null;
  // Record base positions once (for subtle vertical bobbing of upper body)
  basePos.current.spine  = spineRef.current?.position ? spineRef.current.position.clone() : null;
  basePos.current.l      = shoulders.current.left?.position ? shoulders.current.left.position.clone() : null;
  basePos.current.r      = shoulders.current.right?.position ? shoulders.current.right.position.clone() : null;
  basePos.current.head   = headRef.current?.position ? headRef.current.position.clone() : null;
  basePos.current.spine0 = boneMap.current.spine0?.position ? boneMap.current.spine0.position.clone() : null;
  basePos.current.spine1 = boneMap.current.spine1?.position ? boneMap.current.spine1.position.clone() : null;
  basePos.current.spine2 = boneMap.current.spine2?.position ? boneMap.current.spine2.position.clone() : null;
  basePos.current.lSh    = boneMap.current.lShoulder?.position ? boneMap.current.lShoulder.position.clone() : null;
  basePos.current.rSh    = boneMap.current.rShoulder?.position ? boneMap.current.rShoulder.position.clone() : null;
  basePos.current.lEl    = boneMap.current.lElbow?.position ? boneMap.current.lElbow.position.clone() : null;
  basePos.current.rEl    = boneMap.current.rElbow?.position ? boneMap.current.rElbow.position.clone() : null;
  }, [cloned, scaleMul]);
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const py = AVATAR_BAKED_POS[1];
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const groupRotation = rotationOverride ?? [0, pz > 0 ? Math.PI : 0, 0];
  const baseY = anchorY + py; // support Y anchor
  useFrame(({ clock }) => {
    const g = groupRef.current; if (!g) return;
    // Root stays put so feet contact remains constant (unless overridden)
    const useOverride = Array.isArray(positionOverride);
    const outX = useOverride ? (positionOverride[0] || 0) : px;
    const outZ = useOverride ? (positionOverride[2] || 0) : pz;
    g.position.x = outX;
    g.position.y = baseY;
    g.position.z = outZ;
    g.scale.set(scaleMul, scaleMul, scaleMul);
    // Apply full rotation override if provided, else preserve existing y (camera-facing) and set z from groupRotation
    if (Array.isArray(rotationOverride)) {
      g.rotation.set(rotationOverride[0] || 0, rotationOverride[1] || 0, rotationOverride[2] || 0);
    } else {
      g.rotation.z = groupRotation?.[2] || 0;
    }
    // If model has native animation clips, lock the model root to baseline so placement matches robot
    if (ref.current && baseRoot.current) {
      ref.current.position.copy(baseRoot.current.pos);
      ref.current.rotation.copy(baseRoot.current.rot);
      ref.current.scale.copy(baseRoot.current.scale);
    }
    // Skip custom robot bone sway logic for capuccino model (prevents malformed pose / missing parts)
    if (isCapuccino) return;
    // Apply tiny rotations to upper bones if we found them
  const t = clock.getElapsedTime();
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const nodFast  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.10);
    const nodSlow  = Math.sin(t * (AVATAR_IDLE_SPEED_Y * 0.65) * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.06);
    // Gentle vertical bob for breathing – apply as translation to upper body anchors
  const bob  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.30);
  // Occasional slow weight shift (very low frequency lean)
  // Much subtler occasional weight shift: slower and smaller
  const shift = Math.sin(t * 0.05 * 2 * Math.PI) * 0.02; // ~20s period, ~1.1°

    // Prefer explicit robot bones for more natural distribution
    const b = boneMap.current;
    if (b.spine0 && baseRot.current.spine0) {
      // hips/base: keep feet planted; very subtle slow lean
      b.spine0.rotation.z = baseRot.current.spine0.z + (-sway * 0.25) + (shift * 0.3);
      b.spine0.rotation.x = baseRot.current.spine0.x + (nodSlow * 0.3);
    }
    if (b.spine1 && baseRot.current.spine1) {
      b.spine1.rotation.z = baseRot.current.spine1.z + (sway * 0.6) + (shift * 0.25);
      b.spine1.rotation.x = baseRot.current.spine1.x + (nodSlow * 0.6);
    }
    if (b.spine2 && baseRot.current.spine2) {
      b.spine2.rotation.z = baseRot.current.spine2.z + (sway * 0.85) + (shift * 0.12);
      b.spine2.rotation.x = baseRot.current.spine2.x + (nodFast * 1.0);
      if (b.spine2.position && basePos.current.spine) b.spine2.position.y = basePos.current.spine.y + bob * 0.6;
    }
    if (b.lShoulder && baseRot.current.lSh) b.lShoulder.rotation.z = baseRot.current.lSh.z + (-sway * 0.9) + (-shift * 0.18);
    if (b.rShoulder && baseRot.current.rSh) b.rShoulder.rotation.z = baseRot.current.rSh.z + (sway * 0.9) + (shift * 0.18);
    if (b.lElbow && baseRot.current.lEl) b.lElbow.rotation.z = baseRot.current.lEl.z + (sway * 0.15);
    if (b.rElbow && baseRot.current.rEl) b.rElbow.rotation.z = baseRot.current.rEl.z + (-sway * 0.15);

    // Fallback to generic captures if explicit ones are missing
    if (!b.spine0 && spineRef.current && baseRot.current.spine) {
      spineRef.current.rotation.z = baseRot.current.spine.z + sway * 1.0;
      spineRef.current.rotation.x = baseRot.current.spine.x + nodFast * 0.28;
      if (basePos.current.spine) spineRef.current.position.y = basePos.current.spine.y + bob;
    }
    if (!b.lShoulder && shoulders.current.left && baseRot.current.l) {
      shoulders.current.left.rotation.z = baseRot.current.l.z + (-sway * 0.9);
      if (basePos.current.l) shoulders.current.left.position.y = basePos.current.l.y + bob;
    }
    if (!b.rShoulder && shoulders.current.right && baseRot.current.r) {
      shoulders.current.right.rotation.z = baseRot.current.r.z + (sway * 0.9);
      if (basePos.current.r) shoulders.current.right.position.y = basePos.current.r.y + bob;
    }
    // No camera-aware motion per request
  });
  // Play built-in idle (or first clip) if present
  useLayoutEffect(() => {
    if (!hasClips || !actions) return;
    const idleName = (names && names.find(n => /idle/i.test(n))) || Object.keys(actions)[0];
    const a = idleName ? actions[idleName] : null;
    if (a) {
      a.reset().fadeIn(0.25).play();
    }
    return () => { if (a) a.fadeOut(0.2); };
  }, [hasClips, actions, names]);
  return (
  <group ref={groupRef} position={[px, baseY, pz]} rotation={groupRotation} scale={[scaleMul, scaleMul, scaleMul]} raycast={null} frustumCulled={false}>
      <primitive ref={ref} object={cloned} dispose={null} />
      <group position={[0, 0, faceDir * 0.12]} />
    </group>
  );
}

// Minimal loader for inspection (no bone logic) – used for capuccino test
// Specialized component to properly normalize and display the capuccino model.
// Strategy:
// 1. Clone with SkeletonUtils to preserve any skinning.
// 2. Identify "core" meshes (body/limbs/head/shoes) by name patterns, ignoring accessories (katana, bandana, facial detail) for scaling.
// 3. Compute bounding box of core set; fallback to global if none.
// 4. Recentre X/Z on core center, ground on core minY, scale core height to AVATAR_BASE_HEIGHT.
// 5. Do not manipulate bones or apply robot idle sway; remain static for integrity.
function CapuccinoOpponent({ rotation=[0,Math.PI,0], xOffset=0, zSign=-1, xFront=AVATAR_X_FRONT, xBack=AVATAR_X_BACK }) {
  const url = '/models/avatars/capuccino/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const wrapRef = useRef(); // group we move/scale
  const modelRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !modelRef.current || !wrapRef.current) return;
    // Collect candidate core meshes
    const coreRegex = /(body_|legs_|arms_|hands_|shoes_|capuccinoassasino|spine_|root_01|head_)/i;
  const accessoryRegex = /(katana|bandana|cup|eyebrow|eyelid|eyes?)/i;
  const accessories = [];
    const coreMeshes = [];
    modelRef.current.traverse(o => {
      if (o.isMesh) {
        const n = (o.name||'');
        if (coreRegex.test(n) && !accessoryRegex.test(n)) coreMeshes.push(o); else if (accessoryRegex.test(n)) accessories.push(o);
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      }
    });
    let coreBox = new THREE.Box3();
    if (coreMeshes.length) {
      coreMeshes.forEach(m => coreBox.expandByObject(m));
    } else {
      coreBox.setFromObject(modelRef.current);
    }
    if (coreBox.isEmpty()) return;
    const coreSize = new THREE.Vector3(); coreBox.getSize(coreSize);
    const coreCenter = new THREE.Vector3(); coreBox.getCenter(coreCenter);
    const coreHeight = coreSize.y > 0 ? coreSize.y : 1;
    const scale = AVATAR_BASE_HEIGHT / coreHeight;
    // Apply transforms to modelRef (child of wrapRef) so we can still position wrapRef in world
    modelRef.current.position.x += -coreCenter.x;
    modelRef.current.position.z += -coreCenter.z;
    modelRef.current.position.y += -coreBox.min.y; // ground feet/base
    modelRef.current.scale.multiplyScalar(scale);

    // Process accessories: either hide distant ones or pull them toward the body root.
    const MAX_DIST = coreSize.length() * 1.2; // heuristic threshold
    accessories.forEach(a => {
      const apos = new THREE.Vector3(); a.getWorldPosition(apos);
      const rel = apos.clone().sub(coreCenter);
      if (rel.length() > MAX_DIST) {
        // Hide extreme outliers (likely duplicate props far away)
        a.visible = false;
      } else {
        // Recentre moderate-distance accessories so they cling to body (preserve vertical offset a bit)
        a.position.x += -coreCenter.x * 0.9;
        a.position.z += -coreCenter.z * 0.9;
      }
    });
  }, [cloned]);

  if (!cloned) return null;
  // Compute anchored world placement similar to other avatars
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? xFront : xBack) + xOffset;
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - 0.02; const py = AVATAR_BAKED_POS[1];
  const baseScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT * CAPUCCINO_SCALE_BOOST;
  return (
    <group ref={wrapRef} position={[px, groundY + py, pz]} rotation={rotation} scale={[baseScale, baseScale, baseScale]} frustumCulled={false}>
      <group ref={modelRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// (Removed custom SharkOpponent; shark now uses the same GLTFOpponent pipeline as robot.)

function GLTFOpponent({ url, flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match ground/table reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - 0.02;
  const scaleMul = (AVATAR_FINAL_HEIGHT / AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleOverride) ? scaleOverride : 1);
  // LoadedOpponent normalizes then applies scaleMul and idle animation
  return (
    <LoadedOpponent
      url={url}
      flip180={flip180}
      anchorY={groundY}
      z={0}
      faceDir={0}
      scaleMul={scaleMul}
      rotationOverride={rotationOverride}
      positionOverride={positionOverride}
      xFront={xFront}
      xBack={xBack}
      zSign={zSign}
    />
  );
}

// RawSharkOpponent: load shark exactly as authored (no recenter per child, no accessory re-parent),
// only ground and uniformly scale via inner pivot, then place via outer group.
function RawSharkOpponent({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef(); // we shift & scale this
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add cloned scene once under pivot
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute full scene bounds WITHOUT altering child transforms (preserve layout)
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Do NOT move or re-parent any skinned child; adjust only the pivot to keep authored hierarchy intact
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first animation clip (if any) similar to robot approach
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * SHARK_SCALE_BOOST; // boosted final presence
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? 0 : Math.PI), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// SharkFixed: "glue" scattered shark parts (teeth/eyes/fins) to the main body and apply only wrapper scaling.
// Strategy:
// 1. Clone scene untouched.
// 2. Identify main body mesh (largest volume or name match).
// 3. Categorize accessory meshes (teeth/eyes/mouth/jaw) and re-parent them to body root (preserves world transforms but keeps them together).
// 4. Compute body bounding box (body root only) to determine scale + ground offset.
// 5. Apply translation (ground) and uniform scale ONLY at an inner pivot group; outer group handles world placement & final size.
// 6. Optionally down-scale oversized accessories ( > 20% of body height ).
function SharkFixed({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    const bodyRegex = /(body|torso|main|mesh)/i;
    const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
    let bodyMesh = null;
    const accessories = [];
    const meshes = [];
    cloned.traverse(o => {
      if (o.isMesh) {
        meshes.push(o);
        // choose body by name first, else largest volume
        if (bodyRegex.test(o.name || '')) {
          if (!bodyMesh) bodyMesh = o;
        }
      }
    });
    if (!bodyMesh) {
      // fallback: largest volume
      let maxVol = 0;
      meshes.forEach(m => {
        const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return;
        const s = new THREE.Vector3(); b.getSize(s); const vol = s.x*s.y*s.z;
        if (vol > maxVol) { maxVol = vol; bodyMesh = m; }
      });
    }
    // collect accessories (exclude body)
    meshes.forEach(m => { if (m !== bodyMesh && accessoryRegex.test(m.name || '')) accessories.push(m); });
    // Re-parent accessories to body so scaling/placement remains cohesive
    if (bodyMesh) {
      accessories.forEach(a => { if (a.parent !== bodyMesh) try { bodyMesh.attach(a); } catch {} });
    }
    // Compute body bounding box AFTER re-parent
    const bodyBox = bodyMesh ? new THREE.Box3().setFromObject(bodyMesh) : new THREE.Box3().setFromObject(cloned);
    if (bodyBox.isEmpty()) return;
    const bodySize = new THREE.Vector3(); bodyBox.getSize(bodySize);
    const bodyHeight = bodySize.y || 1;
    const minY = bodyBox.min.y;
    // Ground offset: shift pivot so body minY -> 0
    pivotRef.current.position.y += -minY;
    // Normalize body to base height at pivot level
    const normScale = AVATAR_BASE_HEIGHT / bodyHeight;
    pivotRef.current.scale.set(normScale, normScale, normScale);
    // Clamp huge accessories relative to body height
    accessories.forEach(a => {
      try {
        const ab = new THREE.Box3().setFromObject(a); if (ab.isEmpty()) return;
        const as = new THREE.Vector3(); ab.getSize(as);
        const maxDim = Math.max(as.x, as.y, as.z);
        const desired = bodyHeight * 0.20;
        if (maxDim > desired && maxDim > 0) {
          const s = desired / maxDim;
            a.scale.multiplyScalar(s);
        }
      } catch {}
    });
    // Shadows & culling flags
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const finalScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT; // amplify normalized body
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[finalScale, finalScale, finalScale]} frustumCulled={false}>
      <group ref={pivotRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// Generic skinned GLTF opponent that preserves authored skeleton and node parenting.
// It centers on X/Z, grounds at minY, and normalizes height by moving/scaling a pivot above the cloned scene.
// No re-parenting or per-mesh transforms are applied to avoid breaking skinning.
function SkinnedGLTFOpponent({ url, xFront, xBack, zSign = -1, scaleBoost = 1 }) {
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add once
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute bounds of the authored hierarchy
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Shift only the pivot so minY -> 0 and model is centered in X/Z
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    // Enable shadows on meshes
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first clip if present
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleBoost) ? scaleBoost : 1);
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// Sandbox-style alien loader: no normalization of inner hierarchy; enforce skinning; filter tracks; lock root motion; clamp bone scale; zero non-bone transforms.
function AlienSandboxOpponent({ url = '/models/avatars/alien/scene.gltf', xFront, xBack, zSign = -1, centerInParent = false, positionOverride = null, isWalking = false }) {
  const { scene, animations } = useGLTF(url);
  const innerRef = useRef();
  const pivotRef = useRef();
  const outerRef = useRef();
  const anchorBoneRef = useRef(null);
  const anchorInitPos = useRef(new THREE.Vector3());
  const pivotBasePos = useRef(new THREE.Vector3());
  // Enforce skinning and basic render flags; optionally zero out non-bone transforms
  useLayoutEffect(() => {
  if (!scene) return;
  scene.traverse((o) => {
      if (o.isSkinnedMesh && o.material) {
        if (!o.material.skinning) { o.material.skinning = true; o.material.needsUpdate = true; }
      }
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      const isBone = o.isBone || o.type === 'Bone';
      if (!isBone) {
        if (o.position && (o.position.x !== 0 || o.position.y !== 0 || o.position.z !== 0)) o.position.set(0,0,0);
        if (o.scale && (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1)) o.scale.set(1,1,1);
        if (o.updateMatrix) o.updateMatrix();
      }
    });
    // Removed auto-grounding (minY -> 0) for Alien
  }, [scene]);
  // Optionally center the model in its parent so the pivot is at the visual center
  useLayoutEffect(() => {
  if (!centerInParent || !scene || !pivotRef.current) return;
    if (pivotRef.current.__centeredOnce) return;
    try {
      const box = new THREE.Box3();
  scene.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) { bb.applyMatrix4(o.matrixWorld); box.union(bb); }
        }
      });
      if (!box.isEmpty()) {
        const center = new THREE.Vector3(); box.getCenter(center);
        // move inner model so its center aligns with parent's origin (idempotent)
        const px = pivotRef.current.position.x;
        const pz = pivotRef.current.position.z;
        pivotRef.current.position.set(-center.x, pivotRef.current.position.y, -center.z);
        // Update base after first centering
        pivotBasePos.current.copy(pivotRef.current.position);
        pivotRef.current.__centeredOnce = true;
      }
    } catch {}
  }, [centerInParent, scene]);
  // Filter animations like sandbox: drop non-bone tracks, lock root bone position/scale, clamp bone scales
  const filteredClips = useMemo(() => {
  if (!animations || !scene) return animations || [];
    const nameToObj = new Map();
  scene.traverse((o) => { if (o.name) nameToObj.set(o.name, o); });
    const rootBoneNames = new Set();
  scene.traverse((o) => {
      if ((o.isBone || o.type === 'Bone') && (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone'))) {
        if (o.name) rootBoneNames.add(o.name);
      }
    });
  const filterNonBoneTransforms = true;
  const lockRootMotion = false; // allow authored root motion
  const clampBoneScale = true;
  const stripBoneXZTranslation = false; // keep authored bone translations
    return animations.map((clip) => {
      const dropped = [];
      const newTracks = [];
      for (const track of clip.tracks) {
        const firstDot = track.name.indexOf('.');
        const nodeName = firstDot === -1 ? track.name : track.name.slice(0, firstDot);
        const property = firstDot === -1 ? '' : track.name.slice(firstDot + 1);
        const obj = nameToObj.get(nodeName);
  // If the target node doesn't exist in the loaded scene, drop the track to avoid unexpected transforms.
  if (!obj) { dropped.push(track.name); continue; }
        const isBone = obj.isBone || obj.type === 'Bone';
  // Keep animation only on bones; drop transforms on meshes or groups
  if (filterNonBoneTransforms && !isBone) { dropped.push(track.name); continue; }
        if (lockRootMotion && isBone && (property.startsWith('position') || property.startsWith('scale')) && rootBoneNames.has(nodeName)) {
          dropped.push(track.name); continue;
        }
        // Remove forward locomotion baked into bone position tracks: keep vertical bob (Y), zero X/Z.
        if (
          stripBoneXZTranslation &&
          isBone &&
          property.startsWith('position')
        ) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              // Check if X/Z have meaningful movement to avoid touching non-moving tracks
              let sumXZ = 0;
              for (let i = 0; i < values.length; i += 3) {
                sumXZ += Math.abs(values[i]) + Math.abs(values[i+2]);
              }
              if (sumXZ > 1e-5) {
                for (let i = 0; i < values.length; i += 3) {
                  // x, y, z — keep y (vertical), zero x/z to eliminate drift
                  values[i] = 0;
                  // values[i+1] stays as is (breathe/bounce)
                  values[i+2] = 0;
                }
                newTracks.push(new ctor(track.name, times, values, track.interpolation));
                continue;
              }
            }
          } catch {}
        }
        if (clampBoneScale && isBone && property.startsWith('scale')) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              const minS = 0.01, maxS = 100;
              for (let i = 0; i < values.length; i += 3) {
                values[i]   = Math.min(maxS, Math.max(minS, values[i]));
                values[i+1] = Math.min(maxS, Math.max(minS, values[i+1]));
                values[i+2] = Math.min(maxS, Math.max(minS, values[i+2]));
              }
              newTracks.push(new ctor(track.name, times, values, track.interpolation));
              continue;
            }
          } catch {}
        }
        newTracks.push(track);
      }
      if (newTracks.length === clip.tracks.length) return clip;
      const clonedClip = clip.clone();
      clonedClip.tracks = newTracks;
      if (dropped.length) {
        try { console.info('[C4 Alien] Dropped tracks:', dropped); } catch {}
      }
      return clonedClip;
    });
  }, [animations, scene]);
  // Use one mixer for all clips and cross-fade between idle and walk
  const { actions: allActions, names: clipNames } = useAnimations(filteredClips || [], innerRef);
  const currentActionRef = useRef(null); // 'idle' | 'walk' | null
  const pickIdleName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    let idle = byName(/idle|stand|breath|breathe/i);
    if (!idle) idle = clips.reduce((a,b)=> (a && a.duration>=b.duration?a:b), null) || clips[0];
    return idle ? (idle.name || null) : null;
  }, [filteredClips]);
  const pickWalkName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    // Prefer explicit alien clip names if present
    let w = clips.find(c => (c.name||'').toLowerCase() === 'zbs_phobos.qc_skeleton|zbs_walk'.toLowerCase());
    if (!w) w = byName(/walk|run|move|stride|jog|locomotion|forward|pace|step/i);
    if (!w) {
      const idleLike = /idle|stand|breath|breathe|pose|look/i;
      w = clips.find(c => !idleLike.test(c.name||'') && (c.duration||0) > 0.5) || null;
    }
    return w ? (w.name || null) : null;
  }, [filteredClips]);
  useLayoutEffect(() => {
    if (!allActions) return;
    const idle = pickIdleName ? allActions[pickIdleName] : null;
    const walk = pickWalkName ? allActions[pickWalkName] : null;
    const want = isWalking ? 'walk' : 'idle';
    if (currentActionRef.current === want) return;
    // stop previous
    try {
      if (currentActionRef.current === 'walk' && walk) walk.stop();
      if (currentActionRef.current === 'idle' && idle) idle.stop();
    } catch {}
    // start next
    if (isWalking && walk) {
      try { walk.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
    } else if (!isWalking && idle) {
      try { idle.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
      // when going to idle, snap pivot back to base to clear any in-place offsets
      if (pivotRef.current && pivotBasePos.current) {
        pivotRef.current.position.x = pivotBasePos.current.x;
        pivotRef.current.position.z = pivotBasePos.current.z;
      }
    }
    currentActionRef.current = want;
    return () => { /* keep actions managed by drei mixer lifecycle */ };
  }, [allActions, isWalking, pickIdleName, pickWalkName]);

  // Find an anchor bone (prefer hips/pelvis, fallback to any root bone) and capture its initial parent-local XZ baseline
  useEffect(() => {
  if (!scene || !pivotRef.current) return;
    let hips = null;
    const roots = [];
  scene.traverse((o) => {
      if (o && (o.isBone || o.type === 'Bone')) {
        const nm = (o.name || '').toLowerCase();
        if (/hip|pelvis/.test(nm)) hips = o;
        if (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone')) roots.push(o);
      }
    });
    const anchor = hips || roots[0] || null;
    anchorBoneRef.current = anchor;
    if (anchor) {
      try {
        anchor.updateWorldMatrix && anchor.updateWorldMatrix(true, false);
        const world = new THREE.Vector3();
        anchor.getWorldPosition(world);
        const parent = outerRef.current;
        if (parent && parent.worldToLocal) {
          const local = world.clone();
          parent.worldToLocal(local);
          anchorInitPos.current.copy(local);
        } else {
          anchorInitPos.current.copy(world);
        }
      } catch {}
    }
    // record current pivot offset as base
    if (pivotRef.current) pivotBasePos.current.copy(pivotRef.current.position || new THREE.Vector3());
  }, [scene]);

  // (Removed re-baseline on state change to avoid any visual separation or snapping)

  // Runtime inverse-offset to keep animation in-place on X/Z (preserve vertical bob).
  // Compute anchor drift in the parent's local space so we don't fight parent rotation/translation.
  useFrame(() => { /* no in-place enforcement; play clips as-authored */ });
  // World placement using only parent-level transforms (no inner normalization)
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const baseY = groundY + py;
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;
  const outerScale = 0.09; // slightly reduced alien presence
  // Do not auto-flip by side; facing is controlled by parent mover/overrides
  const rotY = 0;
  // Note: removed auto floor calibration and per-frame height adjustments for Alien

  return (
  <group ref={outerRef} position={[outX, baseY, outZ]} rotation={[0, rotY, 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef}>
  {scene ? <primitive ref={innerRef} object={scene} dispose={null} /> : null}
      </group>
    </group>
  );
}

// FBX-based Alien 2 opponent: Idle when stopped, Walk when moving
function Alien2FBXOpponent({
  baseUrl = '/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx',
  walkUrl = '/models/avatars/alien 2/Animation_Walking_withSkin.fbx',
  runUrl = '/models/avatars/alien 2/Animation_Running_withSkin.fbx',
  turnLeftUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx',
  turnRightUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx',
  jumpUrl = '/models/avatars/alien 2/Animation_Regular_Jump_withSkin.fbx',
  xFront,
  xBack,
  zSign = -1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  yawOffset = 0,
  scaleMul = 0.09, // slightly reduced default size
  isJumping = false,
  extraLiftY = 0
}){
  // Load both FBXs unconditionally for stable hook order
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  // Clone the loaded FBX so multiple instances don't share the same skinned meshes
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();
  

  // Merge animations and namespace to pick deterministically
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  // Lock Y position but allow XZ root motion during idle animation
  const lockYPositionClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      const tracks = clip.tracks.map(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position') && tr.values && tr.values.length > 0) {
          const newValues = [...tr.values];
          // Zero out every Y component (indices 1, 4, 7, 10, ...)
          for (let i = 1; i < newValues.length; i += 3) {
            newValues[i] = 0;
          }
          const NewTrackClass = tr.constructor;
          return new NewTrackClass(tr.name, tr.times.slice(), newValues instanceof Float32Array ? new Float32Array(newValues) : newValues);
        }
        return tr;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);
  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockYPositionClip(c)), [baseAnimsRaw, lockYPositionClip]);
  // Preserve original locomotion tracks (allow root motion)
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(
    `walk:${c.name || 'clip'}`, c.duration, c.tracks
  )), [walkAnimsRaw]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(
    `run:${c.name || 'clip'}`, c.duration, c.tracks
  )), [runAnimsRaw]);
  // For turn clips, make them fully in-place: drop root translation AND hips/pelvis rotations.
  // The PlayerMover rotates the character yaw; the clip supplies upper-body turn motion only.
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // remove all position tracks (prevent any X/Z shift)
        if (n.endsWith('.position')) return false;
        // also remove hips/pelvis rotations to avoid root twist-induced drift
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove Y position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove Y position tracks to prevent animation from fighting physics
        if (n.endsWith('.position')) {
          // Check if this is specifically the Y component or a full position vector
          return false; // Remove all position tracks to be safe
        }
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(c.tracks)
  )), [jumpAnimsRaw, filterJumpTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);

  // Ground and enable shadows on the authored model directly
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      // Adjust idle stance: bring feet closer together by slightly adducting upper legs
      try {
        const normName = (s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
        const bones = [];
        model.traverse(o => { if (o && (o.isBone || o.type==='Bone')) bones.push(o); });
        const findUpper = (side)=>{
          const targetA = side==='L' ? ['leftupleg','leftthigh'] : ['rightupleg','rightthigh'];
          return bones.find(b=>{ const n=normName(b.name); return targetA.some(t=>n.includes(t)); });
        };
        const L = findUpper('L');
        const R = findUpper('R');
        const angle = 0.10; // ~5.7 degrees inward
        if (L) { L.rotation.z = (L.rotation?.z || 0) - angle; }
        if (R) { R.rotation.z = (R.rotation?.z || 0) + angle; }
      } catch {}
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE);
      else if (name.startsWith('run:')) v = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE);
  else if (name.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(happy|idle)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);
  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);
  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  // Start idle immediately to avoid bind-pose flash; then cross-fade based on state (including jump)
  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    } else if (isJumping && pickJumpName) {
      // Jump takes priority over movement, play once and clamp at the end
      // Only start the animation when first transitioning into jump state
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('alien.jump', 0.4); } catch {}
      } else {
        // Already jumping - ensure the jump animation stays active without resetting
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          // Animation got interrupted somehow - restore without reset
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      // Running has priority over walking
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE); } catch {}
    } else if (isWalking && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      // Walk faster than before
  try { actions[pickWalkName].timeScale = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30); } catch {}
    } else if (isWalking && pickRunName) { // fallback: no walk clip available
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
  if (nm.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30);
  else if (nm.startsWith('run:')) v = getAnimSpeed('alien.run', 0.42);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  // World placement: keep consistent with GLTF avatars using baked constants
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  // Use the provided instance yawOffset
  const effYawOffset = yawOffset;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  // World-space lift coming from stairs/table/jump so it matches the green feet marker exactly
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; if PlayerMover publishes its offset on window, read it, else fallback
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking} isWalkingBackward={isWalkingBackward} isRunning={isRunning} />
        </group>
      </group>
    </group>
  );
}

// FBX-based Astronaut (Player 1 replacement for robot): Idle/Walk/Run with cross-fades
function AstronautFBXOpponent({
  baseUrl = '/models/avatars/astronaut/Breathing Idle.fbx',
  walkUrl = '/models/avatars/astronaut/Walking.fbx',
  runUrl = '/models/avatars/astronaut/Running.fbx',
  turnLeftUrl = '/models/avatars/astronaut/Left Turn.fbx',
  turnRightUrl = '/models/avatars/astronaut/Right Turn.fbx',
  jumpUrl = '/models/avatars/astronaut/Jump.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  // Include run animation now that it's available
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Merge animations with namespaced clips for deterministic selection
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run && run.animations) ? run.animations : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations) ? tright.animations : []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  // Build a simple bone-name map for retargeting breathing tracks to the rig
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  // Lock Y position but allow XZ root motion during idle animation
  const sanitizeBreathingClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Zero out Y component of position tracks to lock vertical position
      const tracks = clip.tracks.map(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position') && tr.values && tr.values.length > 0) {
          const newValues = [...tr.values];
          // Position tracks are XYZ triplets: [x0, y0, z0, x1, y1, z1, ...]
          // Zero out every Y component (indices 1, 4, 7, 10, ...)
          for (let i = 1; i < newValues.length; i += 3) {
            newValues[i] = 0;
          }
          const NewTrackClass = tr.constructor;
          return new NewTrackClass(tr.name, tr.times.slice(), newValues instanceof Float32Array ? new Float32Array(newValues) : newValues);
        }
        return tr;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position'); // drop root translation
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => sanitizeBreathingClip(c)), [baseAnimsRaw, sanitizeBreathingClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
  if (name.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (name.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJumping && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('astronaut.jump', 0.65); } catch {}
      } else {
        // Already jumping - ensure the jump animation stays active without resetting
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          // Animation got interrupted somehow - restore without reset
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  // Placement consistent with GLTF avatars
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Alien)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking} isWalkingBackward={isWalkingBackward} isRunning={isRunning} />
        </group>
      </group>
    </group>
  );
}

// Footstep audio component - plays spatial audio when character is walking
function FootstepAudio({ isWalking = false, isWalkingBackward = false, isRunning = false }) {
  const audioRef = useRef();
  const isPlayingRef = useRef(false);
  const currentSpeedRef = useRef(1.35);
  
  // Setup omnidirectional audio on mount
  useEffect(() => {
    if (!audioRef.current) return;
    
    const timer = setTimeout(() => {
      try {
        const audio = audioRef.current;
        if (audio && audio.gain && audio.panner) {
          // Make footsteps truly omnidirectional by accessing the PannerNode directly
          audio.panner.coneInnerAngle = 360;
          audio.panner.coneOuterAngle = 360;
          audio.panner.coneOuterGain = 1.0;
          console.log('FootstepAudio: Set omnidirectional cone');
        }
      } catch (error) {
        console.warn('FootstepAudio: Error setting up audio:', error);
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);
  
  useEffect(() => {
    const isMoving = isWalking || isWalkingBackward || isRunning;
    
    if (!audioRef.current) return;
    
    try {
      const audio = audioRef.current;
      
      // Determine playback speed: 1.65x for running, 1.35x for walking
      const targetSpeed = isRunning ? 1.65 : 1.35;
      
      if (isMoving && !isPlayingRef.current) {
        // Start playing
        audio.play();
        audio.setPlaybackRate(targetSpeed);
        audio.setVolume(5.0); // 5x louder
        isPlayingRef.current = true;
        currentSpeedRef.current = targetSpeed;
      } else if (isMoving && isPlayingRef.current && currentSpeedRef.current !== targetSpeed) {
        // Update speed if state changed (e.g., from walking to running)
        audio.setPlaybackRate(targetSpeed);
        currentSpeedRef.current = targetSpeed;
      } else if (!isMoving && isPlayingRef.current) {
        // Stop playing
        audio.stop();
        isPlayingRef.current = false;
      }
    } catch (error) {
      console.warn('FootstepAudio: Error controlling audio:', error);
    }
  }, [isWalking, isWalkingBackward, isRunning]);
  
  return (
    <PositionalAudio 
      ref={audioRef}
      url="/sounds/moon_surface_walk.mp3"
      loop
      distance={20}
      autoplay={false}
    />
  );
}

// Rocket ambience spatial audio component
function RocketAmbience() {
  const audioRef = useRef();
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    if (!audioRef.current) return;
    
    // Wait a bit for the audio to load
    const timer = setTimeout(() => {
      try {
        const audio = audioRef.current;
        if (audio && audio.gain) {
          console.log('RocketAmbience: Starting audio playback');
          audio.setVolume(1.5); // Reduced volume
          audio.setRefDistance(50); // Full volume within 50 units (much larger area, less affected by turning)
          audio.setMaxDistance(65); // Can hear from up to 65 units away
          audio.setRolloffFactor(1); // Gentle rolloff for gradual volume decrease
          audio.setDistanceModel('linear'); // Linear distance model for more predictable falloff
          
          audio.play();
          setIsReady(true);
          
          // Make audio truly omnidirectional by accessing the PannerNode directly AFTER play
          setTimeout(() => {
            if (audio.panner) {
              audio.panner.coneInnerAngle = 360;
              audio.panner.coneOuterAngle = 360;
              audio.panner.coneOuterGain = 1.0; // Full volume even outside cone
              console.log('RocketAmbience: Panner cone set to:', {
                inner: audio.panner.coneInnerAngle,
                outer: audio.panner.coneOuterAngle,
                gain: audio.panner.coneOuterGain
              });
            } else {
              console.warn('RocketAmbience: No panner node found!');
            }
          }, 100);
          
          console.log('RocketAmbience: Audio playing, isPlaying:', audio.isPlaying);
        }
      } catch (error) {
        console.error('RocketAmbience: Error playing audio:', error);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, []);
  
  return (
    <PositionalAudio 
      ref={audioRef}
      url="/sounds/rocket_ambience.mp3"
      loop={true}
      distance={10}
      autoplay={false}
    />
  );
}

// Audio Range Visualizer - shows the audio zones for the rocket
function AudioRangeVisualizer({ position = [0, 30, 0], refDistance = 50, maxDistance = 65, showLabels = true, showMeshes = false }) {
  const { camera } = useThree();
  const [playerDistance, setPlayerDistance] = React.useState(0);
  
  // Calculate distance from player to sound source
  useFrame(() => {
    const soundPos = new THREE.Vector3(...position);
    const dist = camera.position.distanceTo(soundPos);
    setPlayerDistance(dist);
  });
  
  // Calculate current volume based on distance
  const calculateVolume = (distance) => {
    if (distance <= refDistance) return 1.0; // Full volume
    if (distance >= maxDistance) return 0.0; // Silent
    // Linear falloff between refDistance and maxDistance
    return 1.0 - ((distance - refDistance) / (maxDistance - refDistance));
  };
  
  const currentVolume = calculateVolume(playerDistance);
  
  return (
    <group position={position}>
      {showMeshes && (
        <>
          {/* Full Volume Zone (refDistance) - Green */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
            <ringGeometry args={[refDistance - 0.5, refDistance, 64]} />
            <meshBasicMaterial color="#00ff00" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          
          {/* Max Distance Zone (maxDistance) - Red */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
            <ringGeometry args={[maxDistance - 0.5, maxDistance, 64]} />
            <meshBasicMaterial color="#ff0000" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          
          {/* Fade Zone - Yellow gradient circles */}
          {[0.25, 0.5, 0.75].map((percent, i) => {
            const radius = refDistance + (maxDistance - refDistance) * percent;
            return (
              <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
                <ringGeometry args={[radius - 0.3, radius, 64]} />
                <meshBasicMaterial 
                  color="#ffff00" 
                  transparent 
                  opacity={0.2} 
                  side={THREE.DoubleSide} 
                  depthWrite={false} 
                />
              </mesh>
            );
          })}
          
          {/* Center marker */}
          <mesh position={[0, 0.2, 0]}>
            <sphereGeometry args={[2, 16, 16]} />
            <meshBasicMaterial color="#00ffff" transparent opacity={0.5} />
          </mesh>
        </>
      )}
      
      {/* Distance and volume text labels (always face camera) */}
      {showLabels && showMeshes && (
        <>
          <Text
            position={[0, 0.5, 0]}
            fontSize={3}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.2}
            outlineColor="#000000"
          >
            Audio Zones
          </Text>
          
          {/* Green ring label - Full volume zone */}
          <Text
            position={[refDistance + 5, 0.5, 0]}
            fontSize={2}
            color="#00ff00"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.15}
            outlineColor="#000000"
          >
            {`Green Ring: Full Volume Zone\nRadius: ${refDistance} units\nVolume: 100%`}
          </Text>
          
          {/* Red ring label - Silent zone */}
          <Text
            position={[maxDistance + 5, 0.5, 0]}
            fontSize={2}
            color="#ff0000"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.15}
            outlineColor="#000000"
          >
            {`Red Ring: Silent Zone\nRadius: ${maxDistance} units\nVolume: 0%`}
          </Text>
          
          {/* Yellow rings label - Fade zone */}
          <Text
            position={[(refDistance + maxDistance) / 2 + 5, 3, 0]}
            fontSize={2}
            color="#ffff00"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.15}
            outlineColor="#000000"
          >
            {`Yellow Rings: Volume Fade Zone\nLinear falloff between green & red`}
          </Text>
          
          {/* Player position info */}
          <Text
            position={[0, -5, 0]}
            fontSize={2.5}
            color="#00ffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.2}
            outlineColor="#000000"
          >
            {`Your Distance: ${playerDistance.toFixed(1)} units\nCurrent Volume: ${(currentVolume * 100).toFixed(0)}%`}
          </Text>
        </>
      )}
    </group>
  );
}

// Editable Audio Range Visualizer with TransformControls (like asteroids/cubes)
// Custom Positional Audio with manual volume control
function CustomPositionalAudio({ url, position, refDistance, maxDistance, baseVolume }) {
  const audioRef = useRef();
  const { camera } = useThree();
  const [sound, setSound] = React.useState(null);
  
  // Load and setup audio - re-run when settings change
  React.useEffect(() => {
    if (!audioRef.current) return;
    
    const audio = audioRef.current;
    
    // Wait for audio to load, then setup and play
    const timer = setTimeout(() => {
      try {
        // Setup audio
        audio.setLoop(true);
        audio.setVolume(baseVolume);
        
        // DISABLE the panner - we're using manual distance-based volume control
        // The panner uses camera position, but we want to use character position
        if (audio.panner) {
          audio.setRefDistance(9999999); // Effectively disable distance attenuation
          audio.setMaxDistance(9999999);
          audio.setRolloffFactor(0); // No automatic rolloff
        }
        
        // Start playing if not already playing
        if (!audio.isPlaying) {
          audio.play();
          console.log('Audio started:', url);
        }
        
        setSound(audio);
      } catch (err) {
        console.warn('Audio setup error:', err);
      }
    }, 300);
    
    return () => {
      clearTimeout(timer);
    };
  }, [url, baseVolume, refDistance, maxDistance]);
  
  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (audioRef.current && audioRef.current.isPlaying) {
        try {
          audioRef.current.stop();
        } catch (err) {
          console.warn('Audio stop error:', err);
        }
      }
    };
  }, []);
  
  // Update volume based on distance every frame
  useFrame(() => {
    if (!audioRef.current || !audioRef.current.isPlaying) return;
    
    try {
      const audio = audioRef.current;
      const soundPos = new THREE.Vector3(...position);
      
      // Use player/avatar position instead of camera position
      const avatar = window.__CF_LOCAL_AVATAR__ || {};
      const playerX = avatar.x || 0;
      const playerZ = avatar.z || 0;
      const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0); // Use lift for Y height
      const playerPos = new THREE.Vector3(playerX, playerY, playerZ);
      
      const distance = playerPos.distanceTo(soundPos);
      
      let volumeMultiplier = 1.0;
      
      if (distance <= refDistance) {
        // Inside green circle - full volume
        volumeMultiplier = 1.0;
      } else if (distance >= maxDistance) {
        // Outside red circle - silent
        volumeMultiplier = 0.0;
      } else {
        // Between green and red - linear falloff
        const range = maxDistance - refDistance;
        const distanceFromRef = distance - refDistance;
        volumeMultiplier = 1.0 - (distanceFromRef / range);
      }
      
      audio.setVolume(baseVolume * volumeMultiplier);
    } catch (err) {
      // Silently fail
    }
  });
  
  return (
    <group position={position}>
      <PositionalAudio ref={audioRef} url={url} />
    </group>
  );
}

function EditableAudioVisualizer({ 
  visualizer,
  isSelected,
  editMode,
  dragMode,
  transformMode,
  snap,
  translateSnap,
  rotateSnapDeg,
  scaleSnap,
  onTransformEnd,
  onSelect,
  showMeshes = false,
  availableSounds = [],
  setAvailableSounds = null
}) {
  const groupRef = useRef();
  const transformRef = useRef();
  const { camera } = useThree();
  const [playerDistance, setPlayerDistance] = React.useState(0);
  
  // Calculate distance from player to sound source (using player position, not camera)
  useFrame(() => {
    if (groupRef.current) {
      const soundPos = new THREE.Vector3();
      groupRef.current.getWorldPosition(soundPos);
      
      // Use player/avatar position instead of camera position
      const avatar = window.__CF_LOCAL_AVATAR__ || {};
      const playerX = avatar.x || 0;
      const playerZ = avatar.z || 0;
      const playerY = avatar.y || 0;
      const playerPos = new THREE.Vector3(playerX, playerY, playerZ);
      
      const dist = playerPos.distanceTo(soundPos);
      setPlayerDistance(dist);
    }
  });
  
  // Calculate current volume based on distance
  const calculateVolume = (distance) => {
    if (distance <= visualizer.refDistance) return 1.0; // Full volume
    if (distance >= visualizer.maxDistance) return 0.0; // Silent
    // Linear falloff between refDistance and maxDistance
    return 1.0 - ((distance - visualizer.refDistance) / (visualizer.maxDistance - visualizer.refDistance));
  };
  
  const currentVolume = calculateVolume(playerDistance);
  
  // Handle transform end (like asteroid/cube)
  React.useEffect(() => {
    if (transformRef.current && groupRef.current) {
      const controls = transformRef.current;
      
      const handleDraggingChanged = (event) => {
        // No special logic needed - just track dragging state if needed
      };
      
      const handleMouseUp = () => {
        if (!groupRef.current) return;
        const { position, rotation, scale } = groupRef.current;
        
        // Calculate new refDistance and maxDistance based on scale
        // Store the initial values to calculate relative change
        const initialRefDistance = visualizer.refDistance;
        const initialMaxDistance = visualizer.maxDistance;
        
        // Use the average scale factor to adjust the radii
        const scaleFactor = (scale.x + scale.y + scale.z) / 3;
        
        const newRefDistance = Math.max(5, Math.min(100, initialRefDistance * scaleFactor));
        const newMaxDistance = Math.max(newRefDistance + 5, Math.min(200, initialMaxDistance * scaleFactor));
        
        const updates = {
          position: [position.x, position.y, position.z],
          rotation: [rotation.x, rotation.y, rotation.z],
          refDistance: newRefDistance,
          maxDistance: newMaxDistance
        };
        
        // Reset scale to 1 after applying to distances
        groupRef.current.scale.set(1, 1, 1);
        
        if (onTransformEnd) onTransformEnd(updates);
      };
      
      controls.addEventListener('dragging-changed', handleDraggingChanged);
      controls.addEventListener('mouseUp', handleMouseUp);
      return () => {
        controls.removeEventListener('dragging-changed', handleDraggingChanged);
        controls.removeEventListener('mouseUp', handleMouseUp);
      };
    }
  }, [onTransformEnd, visualizer.refDistance, visualizer.maxDistance]);
  
  // Update transform mode and snap settings
  React.useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setTranslationSnap(snap ? translateSnap : null);
      transformRef.current.setRotationSnap(snap ? (rotateSnapDeg * Math.PI / 180) : null);
      transformRef.current.setScaleSnap(snap ? scaleSnap : null);
    }
  }, [transformMode, snap, translateSnap, rotateSnapDeg, scaleSnap]);
  
  const VisualizerRings = () => (
    <>
      {/* Full Volume Zone (refDistance) - Green - THICKER LINES */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[visualizer.refDistance - 1.0, visualizer.refDistance, 64]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      
      {/* Max Distance Zone (maxDistance) - Red - THICKER LINES */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[visualizer.maxDistance - 1.0, visualizer.maxDistance, 64]} />
        <meshBasicMaterial color="#ff0000" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      
      {/* Fade Zone - Yellow gradient circles - THICKER LINES */}
      {[0.25, 0.5, 0.75].map((percent, i) => {
        const radius = visualizer.refDistance + (visualizer.maxDistance - visualizer.refDistance) * percent;
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
            <ringGeometry args={[radius - 0.7, radius, 64]} />
            <meshBasicMaterial 
              color="#ffff00" 
              transparent 
              opacity={0.4} 
              side={THREE.DoubleSide} 
              depthWrite={false} 
            />
          </mesh>
        );
      })}
      
      {/* Center marker - clickable sphere */}
      <mesh position={[0, 0.2, 0]} onClick={(e) => {
        e.stopPropagation();
        onSelect && onSelect(visualizer.id);
      }}>
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshBasicMaterial color={isSelected ? "#ff00ff" : "#00ffff"} transparent opacity={0.7} />
      </mesh>
      
      {/* Billboard Labels - Always face camera */}
      <Billboard position={[0, 5, 0]}>
        <Text
          fontSize={3}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.3}
          outlineColor="#000000"
        >
          {visualizer.label}
        </Text>
      </Billboard>
      
      {/* Green ring label - Billboard */}
      <Billboard position={[visualizer.refDistance + 3, 1, 0]}>
        <Text
          fontSize={1.5}
          color="#00ff00"
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.15}
          outlineColor="#000000"
        >
          {`Green: Full Volume\n${visualizer.refDistance}u`}
        </Text>
      </Billboard>
      
      {/* Red ring label - Billboard */}
      <Billboard position={[visualizer.maxDistance + 3, 1, 0]}>
        <Text
          fontSize={1.5}
          color="#ff0000"
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.15}
          outlineColor="#000000"
        >
          {`Red: Silent\n${visualizer.maxDistance}u`}
        </Text>
      </Billboard>
      
      {/* Player distance info - Billboard */}
      <Billboard position={[0, -3, 0]}>
        <Text
          fontSize={2}
          color="#00ffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.2}
          outlineColor="#000000"
        >
          {`Distance: ${playerDistance.toFixed(1)}u\nVolume: ${(currentVolume * 100).toFixed(0)}%`}
        </Text>
      </Billboard>
    </>
  );
  
  // Convert visualizer format to cube format for DraggableObject
  const cubeFormat = {
    id: visualizer.id,
    position: { 
      x: visualizer.position[0], 
      y: visualizer.position[1], 
      z: visualizer.position[2] 
    },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  };
  
  return (
    <>
      {dragMode && editMode ? (
        // Wrap in DraggableObject for free drag mode (like asteroids)
        <DraggableObject 
          cube={cubeFormat} 
          editMode={editMode} 
          dragMode={dragMode} 
          isSelected={isSelected} 
          onDragEnd={(updates) => {
            // Convert back to array format
            if (updates.position) {
              onTransformEnd({ 
                position: [updates.position.x, updates.position.y, updates.position.z] 
              });
            }
          }}
        >
          <group ref={groupRef}>
            {/* Small collision box for faster dragging */}
            <mesh visible={false}>
              <boxGeometry args={[5, 5, 5]} />
            </mesh>
            {showMeshes && <VisualizerRings />}
          </group>
        </DraggableObject>
      ) : (
        <group
          ref={groupRef}
          position={[visualizer.position[0], visualizer.position[1], visualizer.position[2]]}
        >
          {showMeshes && <VisualizerRings />}
        </group>
      )}
      
      {/* Custom Controlled Audio - always play so you can hear it while positioning */}
      {visualizer.soundFile && (
        <CustomPositionalAudio
          url={`/sounds/Spacial Aduio Sounds/${visualizer.soundFile}`}
          position={[visualizer.position[0], visualizer.position[1], visualizer.position[2]]}
          refDistance={visualizer.refDistance}
          maxDistance={visualizer.maxDistance}
          baseVolume={visualizer.volume}
        />
      )}
      
      {/* TransformControls - Always show when selected, like asteroids */}
      {isSelected && editMode && groupRef.current && (
        <TransformControls 
          ref={transformRef} 
          object={groupRef.current} 
          mode={transformMode} 
          enabled={!dragMode}
        />
      )}
      
      {/* Label editing panel when selected */}
      {isSelected && editMode && (
        <Html 
          position={[
            visualizer.position[0], 
            visualizer.position[1] + 15, 
            visualizer.position[2]
          ]} 
          style={{ pointerEvents: 'none' }}
        >
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '0',
              left: '400px',
              background: 'rgba(15, 23, 42, 0.95)',
              padding: '10px',
              borderRadius: '8px',
              color: '#e2e8f0',
              fontSize: '12px',
              minWidth: '200px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              pointerEvents: 'auto',
              zIndex: 10000,
              border: '2px solid #f59e0b'
            }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: '#fbbf24', fontSize: '13px' }}>🔊 Audio Zone Settings</div>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>Name:</div>
              <input 
                type="text" 
                value={visualizer.label}
                onChange={(e) => {
                  const newLabel = e.target.value;
                  onTransformEnd({ label: newLabel });
                }}
                style={{ 
                  width: '100%', 
                  padding: '6px', 
                  borderRadius: '4px', 
                  border: '1px solid #334155', 
                  background: '#0f172a', 
                  color: '#e2e8f0', 
                  fontSize: '12px' 
                }}
              />
            </label>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>
                Green Circle (Full Volume) - {visualizer.refDistance}u
              </div>
              <input 
                type="range" 
                min="5" 
                max="100" 
                step="1"
                value={visualizer.refDistance}
                onChange={(e) => {
                  const newRef = parseFloat(e.target.value);
                  onTransformEnd({ refDistance: newRef });
                }}
                style={{ width: '100%' }}
              />
            </label>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>
                Red Circle (Silent) - {visualizer.maxDistance}u
              </div>
              <input 
                type="range" 
                min={visualizer.refDistance + 5}
                max="200" 
                step="1"
                value={visualizer.maxDistance}
                onChange={(e) => {
                  const newMax = parseFloat(e.target.value);
                  onTransformEnd({ maxDistance: newMax });
                }}
                style={{ width: '100%' }}
              />
            </label>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>
                Volume: {visualizer.volume.toFixed(1)}
              </div>
              <input 
                type="range" 
                min="0" 
                max="2" 
                step="0.1"
                value={visualizer.volume}
                onChange={(e) => {
                  const newVol = parseFloat(e.target.value);
                  onTransformEnd({ volume: newVol });
                }}
                style={{ width: '100%' }}
              />
            </label>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>
                🎵 Sound File
              </div>
              <select
                value={visualizer.soundFile || 'rocket_ambience.mp3'}
                onChange={(e) => {
                  onTransformEnd({ soundFile: e.target.value });
                }}
                style={{ 
                  width: '100%', 
                  padding: '6px', 
                  borderRadius: '4px', 
                  border: '1px solid #334155', 
                  background: '#0f172a', 
                  color: '#e2e8f0', 
                  fontSize: '12px' 
                }}
              >
                {availableSounds.map((sound) => (
                  <option key={sound} value={sound}>
                    {sound.replace('.mp3', '').replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <div style={{ 
                padding: '16px 12px', 
                borderRadius: '4px', 
                border: '2px dashed #334155', 
                background: '#1e293b', 
                color: '#94a3b8',
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: '11px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#f59e0b';
                e.currentTarget.style.background = '#292524';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#334155';
                e.currentTarget.style.background = '#1e293b';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = '#10b981';
                e.currentTarget.style.background = '#064e3b';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = '#334155';
                e.currentTarget.style.background = '#1e293b';
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.style.borderColor = '#334155';
                e.currentTarget.style.background = '#1e293b';
                
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('audio/')) {
                  // Create FormData to upload
                  const formData = new FormData();
                  formData.append('sound', file);
                  
                  // Upload to server
                  fetch('/api/upload-sound', {
                    method: 'POST',
                    body: formData
                  })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success && data.filename) {
                      // Add to available sounds if not already there
                      if (setAvailableSounds && !availableSounds.includes(data.filename)) {
                        setAvailableSounds(prev => [...prev, data.filename]);
                        // Notify other player about the new sound
                        if (window.__SEND_SOUND_UPLOAD__) {
                          window.__SEND_SOUND_UPLOAD__(data.filename);
                        }
                      }
                      // Set this file as the current sound
                      onTransformEnd({ soundFile: data.filename });
                    }
                  })
                  .catch(err => console.error('Upload failed:', err));
                } else {
                  alert('Please drop an audio file (.mp3, .wav, .ogg, etc.)');
                }
              }}
              >
                📁 Upload or Drag & Drop Audio File
                <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>
                  Click to browse or drag MP3/WAV here
                </div>
                <input
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      // Create FormData to upload
                      const formData = new FormData();
                      formData.append('sound', file);
                      
                      // Upload to server
                      fetch('/api/upload-sound', {
                        method: 'POST',
                        body: formData
                      })
                      .then(res => res.json())
                      .then(data => {
                        if (data.success && data.filename) {
                          // Add to available sounds if not already there
                          if (setAvailableSounds && !availableSounds.includes(data.filename)) {
                            setAvailableSounds(prev => [...prev, data.filename]);
                            // Notify other player about the new sound
                            if (window.__SEND_SOUND_UPLOAD__) {
                              window.__SEND_SOUND_UPLOAD__(data.filename);
                            }
                          }
                          // Set this file as the current sound
                          onTransformEnd({ soundFile: data.filename });
                        }
                      })
                      .catch(err => console.error('Upload failed:', err));
                    }
                  }}
                />
              </div>
            </label>
          </div>
        </Html>
      )}
    </>
  );
}

// FBX-based Guy1 (animated like Astronaut): Idle/Walk/Run/Turn/Jump with cross-fades
function Guy1FBXOpponent({
  baseUrl = '/models/avatars/guy1/Happy Idle (1).fbx',
  walkUrl = '/models/avatars/guy1/Walking (5).fbx',
  walkBackUrl = '/models/avatars/guy1/Walking Backwards.fbx',
  runUrl = '/models/avatars/guy1/Running (3).fbx',
  turnLeftUrl = '/models/avatars/guy1/Left Turn (4).fbx',
  turnRightUrl = '/models/avatars/guy1/Right Turn (2).fbx',
  jumpUrl = '/models/avatars/guy1/Jumping.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const walkBack = useFBX(walkBackUrl);
  // Include run animation now that it's available
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Merge animations with namespaced clips for deterministic selection
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const walkBackAnimsRaw = useMemo(() => ((walkBack && walkBack.animations) ? walkBack.animations : []), [walkBack]);
  const runAnimsRaw  = useMemo(() => ((run && run.animations) ? run.animations : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations) ? tright.animations : []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  // Build a simple bone-name map for retargeting breathing tracks to the rig
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  // Lock Y position but allow XZ root motion during idle animation
  const lockFeetIdleClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Zero out Y component of position tracks to lock vertical position
      const tracks = clip.tracks.map(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position') && tr.values && tr.values.length > 0) {
          const newValues = [...tr.values];
          // Position tracks are XYZ triplets: [x0, y0, z0, x1, y1, z1, ...]
          // Zero out every Y component (indices 1, 4, 7, 10, ...)
          for (let i = 1; i < newValues.length; i += 3) {
            newValues[i] = 0;
          }
          const NewTrackClass = tr.constructor;
          return new NewTrackClass(tr.name, tr.times.slice(), newValues instanceof Float32Array ? new Float32Array(newValues) : newValues);
        }
        return tr;
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position'); // drop root translation
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockFeetIdleClip(c)), [baseAnimsRaw, lockFeetIdleClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  const walkBackAnims = useMemo(() => walkBackAnimsRaw.map(c => new THREE.AnimationClip(`walkback:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkBackAnimsRaw, retargetTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...walkBackAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, walkBackAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT);
      else if (name.startsWith('walkback:')) v = 0.4; // Slower backwards walk animation
      else if (name.startsWith('run:')) v = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT);
      else if (name.startsWith('jump:')) v = getAnimSpeed('guy1.jump', 0.65);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickWalkBackName = useMemo(() => {
    if (!walkBackAnimsRaw || walkBackAnimsRaw.length === 0) return null;
    const byName = walkBackAnimsRaw.find(c => /walk|walking|back/i.test(c.name));
    const chosen = byName || walkBackAnimsRaw[0];
    return chosen ? `walkback:${chosen.name || 'clip'}` : null;
  }, [walkBackAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJumping && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('guy1.jump', 0.65); } catch {}
      } else {
        // Already jumping - ensure the jump animation stays active without resetting
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          // Animation got interrupted somehow - restore without reset
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT); } catch {}
    } else if (isWalkingBackward && pickWalkBackName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkBackName);
      try { actions[pickWalkBackName].timeScale = 0.4; } catch {} // Slower backwards walk animation
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickWalkBackName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('guy1.walk', GUY1_WALK_DEFAULT);
        else if (nm.startsWith('walkback:')) v = 0.4; // Slower backwards walk animation
        else if (nm.startsWith('run:')) v = getAnimSpeed('guy1.run', GUY1_RUN_DEFAULT);
        else if (nm.startsWith('jump:')) v = getAnimSpeed('guy1.jump', 0.65);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  // Placement consistent with GLTF avatars
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Astronaut)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking} isWalkingBackward={isWalkingBackward} isRunning={isRunning} />
        </group>
      </group>
    </group>
  );
}

// FBX-based Robot 4 (animated like Astronaut): Idle/Walk/Run/Turn/Jump with cross-fades
function Robot4FBXOpponent({
  baseUrl = '/models/avatars/robot 4/Breathing Idle (2).fbx',
  walkUrl = '/models/avatars/robot 4/Walking (2).fbx',
  runUrl = '/models/avatars/robot 4/Running (2).fbx',
  turnLeftUrl = '/models/avatars/robot 4/Left Turn (1).fbx',
  turnRightUrl = '/models/avatars/robot 4/Right Turn (1).fbx',
  jumpUrl = '/models/avatars/robot 4/Jump (1).fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isWalkingBackward = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Build bone map for retargeting
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);

  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);

  // Remove position tracks from idle animation to make it in-place like walk/run
  const lockFeetIdleClip = useCallback((clip) => {
    try {
      if (!clip || !clip.tracks) return clip;
      // Remove all position tracks so idle stays in place
      const tracks = clip.tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      });
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, clip.duration, tracks);
    } catch {
      return clip;
    }
  }, []);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => lockFeetIdleClip(c)), [baseAnimsRaw, lockFeetIdleClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // Filter jump tracks: remove position to make animation in-place (let physics handle vertical motion)
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // Remove all position tracks so physics controls movement
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(retargetTracks(c.tracks))
  )), [jumpAnimsRaw, retargetTracks, filterJumpTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);
  const wasJumpingRef = useRef(false);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
      else if (name.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
      else if (name.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = getAnimSpeed('robot.idle', 0.25);
        if (typeof idle.setEffectiveTimeScale === 'function') idle.setEffectiveTimeScale(getAnimSpeed('robot.idle', 0.25));
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJumping && pickJumpName) {
      if (!wasJumpingRef.current) {
        crossFadeTo(pickJumpName);
        try { actions[pickJumpName].timeScale = getAnimSpeed('robot.jump', 0.65); } catch {}
      } else {
        // Already jumping - ensure the jump animation stays active without resetting
        const jumpAction = actions[pickJumpName];
        if (jumpAction && currentActionRef.current !== jumpAction) {
          // Animation got interrupted somehow - restore without reset
          const prev = currentActionRef.current;
          if (prev && prev !== jumpAction) prev.fadeOut(0.12);
          jumpAction.enabled = true;
          jumpAction.fadeIn(0.12);
          if (!jumpAction.isRunning()) jumpAction.play();
          currentActionRef.current = jumpAction;
        }
      }
      wasJumpingRef.current = true;
    } else if (isRunning && pickRunName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      wasJumpingRef.current = false;
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
        else if (nm.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
        else if (nm.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Remove animation-only inner lift so feet remain flush with ground/stairs
  const liftY = 0;
  const extraLiftW = Number(extraLiftY) || 0;
  // Align feet directly over collision center; read the live collision forward offset (same as Astronaut)
  const FEET_DOT_Z_NUDGE = (typeof window !== 'undefined' && typeof window.__CF_COLLISION_FWD__ === 'number') ? Number(window.__CF_COLLISION_FWD__) : -1.05;
  return (
    <group ref={outerRef} position={[outX, groundY + py + extraLiftW, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY, 0]}>
        <group position={[0, 0, FEET_DOT_Z_NUDGE]}>
          <primitive object={model} dispose={null} />
          <FootstepAudio isWalking={isWalking} isWalkingBackward={isWalkingBackward} isRunning={isRunning} />
        </group>
      </group>
    </group>
  );
}

function Piece({ color = '#e63946', c, r, flip180 = false }) {
  const ref = useRef();
  const x = (c - (COLS - 1) / 2) * (CELL + GAP);
  // Map logical board row (0=top, ROWS-1=bottom) to visual row index (0=bottom)
  const rv = (ROWS - 1 - r);
  // Direction-aware positions so pieces always fall from the top of the screen
  const dirY = flip180 ? -1 : 1;
  const targetY = dirY * ((rv - (ROWS - 1) / 2) * (CELL + GAP));
  const startY = dirY * (ROWS * (CELL + GAP) + 2);
  const vy = useRef(0);
  // Set initial position once on mount; avoid controlling position via props so animation isn't reset every render
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (ref.current && !didInit.current) {
      ref.current.position.set(x, startY, -0.1);
      didInit.current = true;
    }
  }, [x, startY]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    // Move toward target from above, respecting orientation
    if ((dirY > 0 && ref.current.position.y > targetY) || (dirY < 0 && ref.current.position.y < targetY)) {
      vy.current = Math.min(vy.current + 20 * dt, 12);
      if (dirY > 0) {
        ref.current.position.y = Math.max(targetY, ref.current.position.y - vy.current * dt);
      } else {
        ref.current.position.y = Math.min(targetY, ref.current.position.y + vy.current * dt);
      }
    }
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.46, 0.46, 0.18, 40]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.45} emissive={color} emissiveIntensity={0.22} />
    </mesh>
  );
}

// Keyboard movement wrapper for the local player's avatar
function PlayerMover({ enabled = false, maxRadius = PLAY_AREA_RADIUS, speed = 16, baseOffset = [0,0], onPositionChange, moveTarget = null, onArrive, turnSpeed = 2.4, turnSensitivity = 1.5, initialYaw = 0, invertForward = false, clickYawOffset = 0, obstacles = [], collisionRadius = 2.2, collisionForwardOffset = -1.05, groundSamplePush = 2.3, backProbeMag = null, stairMagMul = 1.0, labelName = null, labelSide = null, characterId = null, showCollisionBoxes = false, settingsMenuOpen = false, setShowEditMenu = null, setShowChatUI = null, setFullCamera = null, setFollowCam = null, showEditMenu = false, activeEditorTab = 'objects', setActiveEditorTab = null, selectedSectionIndex = 0, setSelectedSectionIndex = null, isInSection = false, setIsInSection = null, selectedItemIndex = 0, setSelectedItemIndex = null, isInSubMenu = false, setIsInSubMenu = null, selectedSubItemIndex = 0, setSelectedSubItemIndex = null, cubeEditMode = false, placedCubes = [], children }) {
  // Physics constants for jump/fall
  const GRAVITY_FAST = -920.0;         // fast gravity for stairs and general falling
  const GRAVITY_SLOW_FALL = -84.0;     // slowest fall when stepping off the big top platform
  const GRAVITY_JUMP = -135.0;         // another 25% weaker for an even slower/smoother jump arc
  const GRAVITY_FALL = -94.5;          // keep non-platform falls ~30% weaker than jump
  const TARGET_JUMP_HEIGHT = 6.0;     // modest jump apex in world units
  const ref = useRef();
  const pressed = useRef({});
  const justPressed = useRef({});
  const lastSent = useRef({ x: Infinity, z: Infinity, yaw: 0, t: 0, lift: 0, isJumping: false });
  const targetRef = useRef(null);
  const yawRef = useRef(0);
  const velRef = useRef({ x: 0, z: 0 });
  const childRef = useRef();
  const dbgSize = useRef(new THREE.Vector3(0,0,0));
  const dbgCenter = useRef(new THREE.Vector3(0,0,0));
  const prevLocalPos = useRef(new THREE.Vector3(0,0,0));
  // Jump physics
  const [jumpY, setJumpY] = useState(0);
  const jumpVyRef = useRef(0);
  const [isJumping, setIsJumping] = useState(false);
  // Platform support: allow landing on the tabletop and staying there
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const localGroundY = -fhForGround / 2 - GROUND_CLEAR;
  // Tabletop: compute lift from the actual FBX tabletop world Y when available for exact alignment
  const [tableTopLift, setTableTopLift] = useState(() => {
    const top = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    if (Number.isFinite(top)) {
      // localGroundY is the scene's floor Y; lift is worldY - groundY
      return (top - localGroundY);
    }
    // Fallback to previous approximate offset
    return (-localGroundY + 37.0);
  });
  useEffect(() => {
    const onReady = (e) => {
      try {
        const ty = Number(e?.detail?.topY ?? window.__CF_TABLE_TOP_Y__);
        if (Number.isFinite(ty)) setTableTopLift(ty - localGroundY);
      } catch {}
    };
    try { window.addEventListener('cf:table-ready', onReady); } catch {}
    return () => { try { window.removeEventListener('cf:table-ready', onReady); } catch {} };
  }, [localGroundY]);
  const [platformLift, setPlatformLift] = useState(0); // 0=ground, tableTopLift=on table
  const [onTable, setOnTable] = useState(false);
  // Current gravity used while in jump/fall mode (can switch to slow when walking off top platform)
  const curGravityRef = useRef(GRAVITY_FAST);
  // Live HUD text above head (updated ~10Hz to avoid excessive re-renders)
  const [hudText, setHudText] = useState('');
  const [isWalking, setIsWalking] = useState(false);
  const [isWalkingBackward, setIsWalkingBackward] = useState(false);
  const hudTick = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  // Collision and marker: shift forward along facing (local -Z)
  const COLLISION_FWD_OFFSET = Number.isFinite(Number(collisionForwardOffset)) ? Number(collisionForwardOffset) : -1.05;
  const GROUND_SAMPLE_PUSH = Number.isFinite(Number(groundSamplePush)) ? Number(groundSamplePush) : 2.3;
  const FWD_PROBE_MAG_DEFAULT = Math.abs(GROUND_SAMPLE_PUSH);
  const BACK_PROBE_MAG = Number.isFinite(Number(backProbeMag)) ? Math.abs(Number(backProbeMag)) : null;
  const getForwardProbeMag = () => FWD_PROBE_MAG_DEFAULT;
  const getBehindProbeMag = () => (BACK_PROBE_MAG ?? FWD_PROBE_MAG_DEFAULT);
  const STAIR_MAG_MUL = Number.isFinite(Number(stairMagMul)) ? Number(stairMagMul) : 1.0;
  // Short-term latches to stabilize descend/ascend detection
  const lastDescendFwdTimeRef = React.useRef(0);
  const lastDescendBackTimeRef = React.useRef(0);
  const lastAscendBackTimeRef = React.useRef(0);
  // Smooth lift constants (controls how quickly platformLift eases to target)
  const LIFT_SMOOTH_UP_K = 50;   // Original value for responsive stair climbing
  const LIFT_SMOOTH_DOWN_K = 50; // Matched to upward for consistent movement
  useEffect(() => { targetRef.current = moveTarget; }, [moveTarget]);
  useLayoutEffect(() => { yawRef.current = Number(initialYaw)||0; if(ref.current){ ref.current.rotation.y = yawRef.current; } }, [initialYaw]);
  // One-time spawn nudge: move slightly backward along facing (~0.7)
  useLayoutEffect(() => {
    try {
      if (ref.current) {
        const yaw = yawRef.current || 0;
        const back = new THREE.Vector3(0,0,1); // local +Z is backward (forward is -Z)
        back.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
        const DIST = 0.7;
        ref.current.position.x += back.x * DIST;
        ref.current.position.z += back.z * DIST;
      }
    } catch {}
  }, []);
  // Compute debug bounds for child once (approx)
  useEffect(() => {
    if (!childRef.current || !ref.current) return;
    try {
      const box = new THREE.Box3();
      childRef.current.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) {
            bb.applyMatrix4(o.matrixWorld);
            box.union(bb);
          }
        }
      });
      if (!box.isEmpty()) {
        const size = new THREE.Vector3(); box.getSize(size);
        const centerW = new THREE.Vector3(); box.getCenter(centerW);
        const centerL = centerW.clone();
        ref.current.worldToLocal(centerL);
        dbgSize.current.copy(size);
        dbgCenter.current.copy(centerL);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!enabled) return; // no listeners if not enabled
    const down = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      
      // Don't intercept arrow keys when settings menu is open (let sliders work)
      if (settingsMenuOpen) return;
      
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
    if (keyToken === 'ArrowUp' || keyToken === 'ArrowDown' || keyToken === 'ArrowLeft' || keyToken === 'ArrowRight' ||
      keyToken === 'w' || keyToken === 'a' || keyToken === 's' || keyToken === 'd' ||
      keyToken === 'W' || keyToken === 'A' || keyToken === 'S' || keyToken === 'D' ||
      keyToken === 'r' || keyToken === 'R' || keyToken === 'Space') {
        if (!pressed.current[keyToken]) { justPressed.current[keyToken] = true; }
        pressed.current[keyToken] = true;
        try { e.preventDefault(); } catch {}
      }
    };
    const up = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      
      // Don't intercept arrow keys when settings menu is open
      if (settingsMenuOpen) return;
      
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
      if (pressed.current[keyToken]) delete pressed.current[keyToken];
      try { e.preventDefault(); } catch {}
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [enabled]);

  // Xbox controller state refs
  const gamepadState = useRef({
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    bButton: false,
    bButtonPressed: false,
    leftStickClick: false,
    lb: false,
    rb: false,
    dpadUp: false,
    dpadDown: false,
    aButton: false,
    bButtonForMenu: false
  });

  useFrame((_, dt) => {
    if (!enabled || !ref.current) return;
    
    // Poll gamepad input
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gamepad = gamepads[0]; // Use first connected gamepad
    
    if (gamepad) {
      // Debug: Log button 13 state
      if (gamepad.buttons[13]?.pressed) {
        console.log('Button 13 (D-pad Down) is pressed!', {
          showEditMenu,
          setSelectedSectionIndex: !!setSelectedSectionIndex,
          setSelectedItemIndex: !!setSelectedItemIndex,
          isInSection,
          selectedSectionIndex
        });
      }
      
      // Left stick for movement (axis 0 = left/right, axis 1 = up/down)
      const deadzone = 0.15; // Ignore small stick movements
      const leftX = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
      const leftY = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
      
      gamepadState.current.leftStickX = leftX;
      gamepadState.current.leftStickY = leftY;
      
      // Right stick for camera (axis 2 = left/right, axis 3 = up/down)
      const rightX = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
      const rightY = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
      
      gamepadState.current.rightStickX = rightX;
      gamepadState.current.rightStickY = rightY;
      
      // B button for jump (button 1 on Xbox controller)
      const bButtonNow = gamepad.buttons[1]?.pressed || false;
      gamepadState.current.bButtonPressed = bButtonNow && !gamepadState.current.bButton;
      gamepadState.current.bButton = bButtonNow;
      
      // Back/Select button (button 8) to toggle edit menu
      const backButtonNow = gamepad.buttons[8]?.pressed || false;
      const backButtonPressed = backButtonNow && !gamepadState.current.backButton;
      gamepadState.current.backButton = backButtonNow;
      
      if (backButtonPressed && setShowEditMenu) {
        setShowEditMenu(prev => !prev);
      }
      
      // D-pad Right button (button 15) - horizontal menu navigation when in section, or toggle chat UI
      const dpadRightNow = gamepad.buttons[15]?.pressed || false;
      const dpadRightPressed = dpadRightNow && !gamepadState.current.dpadRight;
      gamepadState.current.dpadRight = dpadRightNow;
      
      if (dpadRightPressed) {
        // Priority: Sub-menu horizontal navigation
        if (showEditMenu && isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Right pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups:
            // 0-1: Duplicate/Delete buttons
            // 2-3: Collision/Walkable checkboxes
            // 4-6: Box/Sphere/Cylinder collision shapes
            if (prev >= 0 && prev <= 1) {
              // Navigate between Duplicate (0) and Delete (1)
              return prev === 0 ? 1 : 0;
            } else if (prev >= 2 && prev <= 3) {
              // Navigate between Collision (2) and Walkable (3)
              return prev === 2 ? 3 : 2;
            } else if (prev >= 4 && prev <= 6) {
              // Navigate between Box (4), Sphere (5), Cylinder (6)
              const newIndex = prev >= 6 ? 6 : prev + 1; // Stop at 6, no wrap
              return newIndex;
            }
            return prev;
          });
        }
        // Priority: Horizontal navigation in Object Placer section when inside and on collision shapes
        else if (showEditMenu && isInSection && selectedSectionIndex === 0 && cubeEditMode && selectedItemIndex >= 1 && selectedItemIndex <= 3 && setSelectedItemIndex) {
          console.log('D-pad Right: navigating collision shapes');
          setSelectedItemIndex(prev => {
            const newIndex = prev >= 3 ? 3 : prev + 1; // Stop at 3, no wrap
            console.log('Navigating collision shapes right, prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Priority: Horizontal navigation in Collision Shapes section (2x2 grid)
        else if (showEditMenu && isInSection && selectedSectionIndex === 1 && setSelectedItemIndex) {
          console.log('D-pad Right: navigating Collision Shapes section 2x2 grid');
          setSelectedItemIndex(prev => {
            // Top row: 0 (Box) -> 1 (Sphere)
            if (prev === 0) return 1;
            // Bottom row: 2 (Cylinder) -> 3 (Capsule)
            if (prev === 2) return 3;
            // Already at right edge (1 or 3), stay there
            return prev;
          });
        }
        // Fallback: Toggle chat UI when not navigating menu
        else if (setShowChatUI) {
          console.log('D-pad right pressed, toggling chat UI');
          setShowChatUI(prev => {
            console.log('Chat UI toggled from', prev, 'to', !prev);
            return !prev;
          });
        }
      }
      
      // D-pad Up button (button 12) - menu navigation when edit menu open, camera toggle when closed
      const dpadUpNow = gamepad.buttons[12]?.pressed || false;
      const dpadUpPressed = dpadUpNow && !gamepadState.current.dpadUp;
      gamepadState.current.dpadUp = dpadUpNow;
      
      if (dpadUpPressed) {
        // Priority: Sub-menu navigation when in sub-menu
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Up pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups (skip entire groups, don't navigate within them):
            // Group 1: 0-1 (Duplicate/Delete)
            // Group 2: 2-3 (Collision/Walkable)  
            // Group 3: 4-6 (Box/Sphere/Cylinder)
            
            let newIndex;
            if (prev >= 4 && prev <= 6) {
              // From collision shapes group → jump to Collision checkbox group (start at 2)
              newIndex = 2;
            } else if (prev >= 2 && prev <= 3) {
              // From checkboxes group → jump to Duplicate/Delete group (start at 0)
              newIndex = 0;
            } else {
              // From Duplicate/Delete group → wrap to collision shapes (start at 4)
              newIndex = 4;
            }
            
            console.log('Navigating sub-items up (group jump), prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Priority: Menu navigation when edit menu is open
        else if (showEditMenu && setSelectedSectionIndex && setSelectedItemIndex) {
          console.log('D-pad Up pressed! isInSection:', isInSection, 'current selectedSectionIndex:', selectedSectionIndex);
          if (isInSection) {
            // Navigate items within section upward
            setSelectedItemIndex(prev => {
              // Determine max items for current section
              let maxItems = 0;
              if (selectedSectionIndex === 0) {
                // Object Placer: 0=checkbox, 1-3=collision shapes, 4+=placed objects (excluding terrain)
                if (cubeEditMode) {
                  const numPlacedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain).length;
                  maxItems = 3 + numPlacedObjects; // checkbox + 3 shapes + placed objects (no terrain)
                } else {
                  maxItems = 0;
                }
              } else if (selectedSectionIndex === 1) {
                // Collision Shapes section - 4 buttons in 2x2 grid
                maxItems = 3; // 0=Box, 1=Sphere, 2=Cylinder, 3=Capsule
              } else if (selectedSectionIndex === 2) {
                // Primitives section - removed
                maxItems = 0;
              }
              
              // D-pad Up: When in section 1 (Collision Shapes), navigate within 2x2 grid
              if (selectedSectionIndex === 1 && isInSection) {
                // From bottom row (2,3) to top row (0,1)
                if (prev === 2) return 0; // Bottom Left to Top Left
                if (prev === 3) return 1; // Bottom Right to Top Right
                // Already in top row (0,1), stay there (don't exit)
                return prev;
              }
              
              // D-pad Up: In section 0, handle navigation
              if (selectedSectionIndex === 0) {
                // From shapes (1-3), go to checkbox (0)
                if (prev >= 1 && prev <= 3) return 0;
                // From first placed object (4), go to middle shape (2 - Sphere)
                if (prev === 4) return 2;
              }
              
              const newIndex = prev <= 0 ? 0 : prev - 1; // Stop at top, no wrap
              console.log('Navigating items up, prev:', prev, 'max:', maxItems, 'new:', newIndex);
              return newIndex;
            });
          } else {
            // Navigate sections upward (stop at 0, no wrap)
            setSelectedSectionIndex(prev => {
              const newIndex = prev <= 0 ? 0 : prev - 1;
              console.log('Navigating sections up, prev:', prev, 'new:', newIndex);
              return newIndex;
            });
          }
        } 
        // Fallback: Camera toggle when menu is closed
        else if (setFullCamera && setFollowCam) {
          console.log('D-pad up pressed, toggling camera mode');
          setFullCamera(prev => {
            const newFullCamera = !prev;
            console.log('Camera mode toggled to:', newFullCamera ? 'full camera' : '3rd person');
            
            // If turning ON full camera, turn OFF 3rd person
            if (newFullCamera) {
              setFollowCam(false);
            } else {
              // If turning OFF full camera, turn ON 3rd person
              setFollowCam(true);
            }
          
            return newFullCamera;
          });
        }
      }
      
      // LB (Left Bumper - button 4) to cycle tabs left
      const lbNow = gamepad.buttons[4]?.pressed || false;
      const lbPressed = lbNow && !gamepadState.current.lb;
      gamepadState.current.lb = lbNow;
      
      if (lbPressed && setActiveEditorTab && showEditMenu) {
        const tabs = ['objects', 'models', 'transform', 'audio', 'settings'];
        const currentIndex = tabs.indexOf(activeEditorTab);
        const newIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        setActiveEditorTab(tabs[newIndex]);
      }
      
      // RB (Right Bumper - button 5) to cycle tabs right
      const rbNow = gamepad.buttons[5]?.pressed || false;
      const rbPressed = rbNow && !gamepadState.current.rb;
      gamepadState.current.rb = rbNow;
      
      if (rbPressed && setActiveEditorTab && showEditMenu) {
        const tabs = ['objects', 'models', 'transform', 'audio', 'settings'];
        const currentIndex = tabs.indexOf(activeEditorTab);
        const newIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
        setActiveEditorTab(tabs[newIndex]);
      }
      
      // D-pad Down (button 13) for menu section navigation when edit menu is open
      const dpadDownNow = gamepad.buttons[13]?.pressed || false;
      const dpadDownPressed = dpadDownNow && !gamepadState.current.dpadDown;
      gamepadState.current.dpadDown = dpadDownNow;
      
      if (dpadDownNow) {
        console.log('D-pad Down state:', { dpadDownNow, wasPressedBefore: !dpadDownPressed, dpadDownPressed });
      }
      
      if (dpadDownPressed) {
        // Priority: Sub-menu navigation when in sub-menu
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Down pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups (skip entire groups, don't navigate within them):
            // Group 1: 0-1 (Duplicate/Delete)
            // Group 2: 2-3 (Collision/Walkable)
            // Group 3: 4-6 (Box/Sphere/Cylinder)
            
            let newIndex;
            if (prev >= 0 && prev <= 1) {
              // From Duplicate/Delete group → jump to Collision/Walkable group (start at 2)
              newIndex = 2;
            } else if (prev >= 2 && prev <= 3) {
              // From checkboxes group → jump to collision shapes group (start at 4)
              newIndex = 4;
            } else {
              // From collision shapes group → wrap to Duplicate/Delete (start at 0)
              newIndex = 0;
            }
            
            console.log('Navigating sub-items down (group jump), prev:', prev, 'new:', newIndex);
            return newIndex;
          });
        }
        // Menu navigation when edit menu is open
        else if (showEditMenu && setSelectedSectionIndex && setSelectedItemIndex) {
          console.log('D-pad Down pressed! isInSection:', isInSection, 'current selectedSectionIndex:', selectedSectionIndex);
          if (isInSection) {
            // Navigate items within section
            setSelectedItemIndex(prev => {
              // Determine max items for current section
              let maxItems = 0;
              if (selectedSectionIndex === 0) {
                // Object Placer: 0=checkbox, 1-3=collision shapes, 4+=placed objects (excluding terrain)
                if (cubeEditMode) {
                  const numPlacedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain).length;
                  maxItems = 3 + numPlacedObjects; // checkbox + 3 shapes + placed objects (no terrain)
                } else {
                  maxItems = 0;
                }
              } else if (selectedSectionIndex === 1) {
                // Collision Shapes section - 3 buttons horizontal (Box, Sphere, Cylinder)
                maxItems = 2; // 0=Box, 1=Sphere, 2=Cylinder
              } else if (selectedSectionIndex === 2) {
                // Primitives section - removed
                maxItems = 0;
              }
              
              // D-pad Down: When in section 1 (Collision Shapes), navigate within 2x2 grid
              if (selectedSectionIndex === 1 && isInSection) {
                // From top row (0,1) to bottom row (2,3)
                if (prev === 0) return 2; // Top Left to Bottom Left
                if (prev === 1) return 3; // Top Right to Bottom Right
                // Already in bottom row (2,3), stay there (don't exit)
                return prev;
              }
              
              // D-pad Down: In section 0, handle navigation
              if (selectedSectionIndex === 0) {
                // From checkbox (0), go to first shape (1)
                if (prev === 0) return 1;
                // From any shape (1-3), go to first placed object (4) or stay on last shape
                if (prev >= 1 && prev <= 3) return 4;
              }
              
              const newIndex = prev >= maxItems ? maxItems : prev + 1; // Stop at bottom, no wrap
              console.log('Navigating items, prev:', prev, 'max:', maxItems, 'new:', newIndex);
              return newIndex;
            });
          } else {
            // Navigate sections (stop at 1, no wrap - only 2 sections now)
            setSelectedSectionIndex(prev => {
              const newIndex = prev >= 1 ? 1 : prev + 1;
              console.log('Navigating sections, prev:', prev, 'new:', newIndex);
              return newIndex;
            });
          }
        }
      }
      
      // A button (button 0) to enter/activate in menu
      const aButtonNow = gamepad.buttons[0]?.pressed || false;
      const aButtonPressed = aButtonNow && !gamepadState.current.aButton;
      gamepadState.current.aButton = aButtonNow;
      
      if (aButtonPressed && showEditMenu && setIsInSection) {
        console.log('A button pressed! isInSection:', isInSection, 'isInSubMenu:', isInSubMenu, 'selectedSectionIndex:', selectedSectionIndex, 'selectedItemIndex:', selectedItemIndex);
        if (!isInSection) {
          // Enter the selected section to navigate items inside
          setIsInSection(true);
          setSelectedItemIndex && setSelectedItemIndex(0);
          console.log('Entered section', selectedSectionIndex);
        } else if (isInSection && !isInSubMenu) {
          // Check if we're on a placed object (item >= 4 in section 0)
          if (selectedSectionIndex === 0 && selectedItemIndex >= 4) {
            // Enter sub-menu to navigate buttons/toggles inside the placed object
            console.log('🎮 Entering sub-menu for placed object', selectedItemIndex);
            setIsInSubMenu && setIsInSubMenu(true);
            setSelectedSubItemIndex && setSelectedSubItemIndex(0);
          } else {
            // Activate/click the selected item
            console.log('🎮 A BUTTON: Clicking item', selectedItemIndex, 'in section', selectedSectionIndex);
            
            // Section 0 = Object Placer
            if (selectedSectionIndex === 0) {
              console.log('🎮 Dispatching event for section 0, item', selectedItemIndex);
              const event = new CustomEvent('controllerMenuItemActivate', {
                detail: { section: 0, item: selectedItemIndex }
              });
              window.dispatchEvent(event);
              console.log('🎮 Event dispatched!');
            }
            // Section 1 = Collision Shapes
            else if (selectedSectionIndex === 1) {
              const event = new CustomEvent('controllerMenuItemActivate', {
                detail: { section: 1, item: selectedItemIndex }
              });
              window.dispatchEvent(event);
            }
          }
        } else if (isInSubMenu) {
          // Activate/click the selected sub-item
          console.log('🎮 A BUTTON: Clicking sub-item', selectedSubItemIndex, 'of placed object', selectedItemIndex);
          const event = new CustomEvent('controllerSubMenuItemActivate', {
            detail: { objectIndex: selectedItemIndex, subItem: selectedSubItemIndex }
          });
          window.dispatchEvent(event);
        }
      }
      
      // B button (button 1) to exit from sub-menu or section
      const bButtonForMenuNow = gamepad.buttons[1]?.pressed || false;
      const bButtonForMenuPressed = bButtonForMenuNow && !gamepadState.current.bButtonForMenu;
      gamepadState.current.bButtonForMenu = bButtonForMenuNow;
      
      if (bButtonForMenuPressed && showEditMenu) {
        if (isInSubMenu && setIsInSubMenu) {
          // Exit sub-menu back to placed object list
          console.log('B button pressed - exiting sub-menu');
          setIsInSubMenu(false);
          setSelectedSubItemIndex && setSelectedSubItemIndex(0);
        } else if (isInSection && setIsInSection) {
          // Exit section back to section navigation
          console.log('B button pressed - exiting section');
          setIsInSection(false);
          setSelectedItemIndex && setSelectedItemIndex(0);
        }
      }
      
      // D-pad Left (button 14) for horizontal item navigation
      const dpadLeftNow = gamepad.buttons[14]?.pressed || false;
      const dpadLeftPressed = dpadLeftNow && !gamepadState.current.dpadLeft;
      gamepadState.current.dpadLeft = dpadLeftNow;
      
      if (dpadLeftPressed && showEditMenu) {
        // Priority: Sub-menu horizontal navigation
        if (isInSubMenu && setSelectedSubItemIndex) {
          console.log('D-pad Left pressed in sub-menu! current:', selectedSubItemIndex);
          setSelectedSubItemIndex(prev => {
            // Sub-menu horizontal groups:
            // 0-1: Duplicate/Delete buttons
            // 2-3: Collision/Walkable checkboxes
            // 4-6: Box/Sphere/Cylinder collision shapes
            if (prev >= 0 && prev <= 1) {
              // Navigate between Duplicate (0) and Delete (1)
              return prev === 0 ? 1 : 0;
            } else if (prev >= 2 && prev <= 3) {
              // Navigate between Collision (2) and Walkable (3)
              return prev === 2 ? 3 : 2;
            } else if (prev >= 4 && prev <= 6) {
              // Navigate between Box (4), Sphere (5), Cylinder (6)
              const newIndex = prev <= 4 ? 4 : prev - 1; // Stop at 4, no wrap
              return newIndex;
            }
            return prev;
          });
        }
        // Section item navigation
        else if (setSelectedItemIndex && isInSection) {
          console.log('D-pad Left pressed! selectedSectionIndex:', selectedSectionIndex, 'selectedItemIndex:', selectedItemIndex);
          setSelectedItemIndex(prev => {
            // For Object Placer section 0: items 1, 2, 3 are the collision shape buttons (horizontal)
            if (selectedSectionIndex === 0 && cubeEditMode) {
              // If on items 1-3 (collision shapes), navigate left
              if (prev >= 1 && prev <= 3) {
                const newIndex = prev <= 1 ? 1 : prev - 1; // Stop at 1, no wrap
                console.log('Navigating collision shapes left, prev:', prev, 'new:', newIndex);
                return newIndex;
              }
            }
            // For Collision Shapes section 1: 2x2 grid
            else if (selectedSectionIndex === 1) {
              // Top row: 1 (Sphere) -> 0 (Box)
              if (prev === 1) return 0;
              // Bottom row: 3 (Capsule) -> 2 (Cylinder)
              if (prev === 3) return 2;
              // Already at left edge (0 or 2), stay there
              return prev;
            }
            return prev; // No horizontal navigation for other items/sections
          });
        }
      }
      
      // Left stick click for run (button 10 on Xbox controller - L3)
      gamepadState.current.leftStickClick = gamepad.buttons[10]?.pressed || false;
    }
    
    const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const p = pressed.current;
    const jp = justPressed.current;
  // Tank controls with incremental turns on key tap (disabled when menu open)
    let turning = 0, moving = 0;
  const leftHeld = !settingsMenuOpen && !!(p['ArrowLeft'] || p['a'] || p['A']);
  const rightHeld = !settingsMenuOpen && !!(p['ArrowRight'] || p['d'] || p['D']);
  if (leftHeld) turning += 1;   // hold = continuous
  if (rightHeld) turning -= 1;  // hold = continuous
    if (!settingsMenuOpen) {
      if (p['ArrowUp'] || p['w'] || p['W']) moving += 1;      // forward
      if (p['ArrowDown'] || p['s'] || p['S']) moving -= 1;    // backward
    }
    
    // Add gamepad input (only if menu is closed)
    const gp = gamepadState.current;
    if (!settingsMenuOpen) {
      if (gp.leftStickX !== 0) {
        turning -= gp.leftStickX * (turnSensitivity * 0.5); // Left stick turns at half the speed of right stick
      }
      // Right stick also turns character (with sensitivity setting)
      if (gp.rightStickX !== 0) {
        turning -= gp.rightStickX * turnSensitivity; // Right stick turns character with sensitivity
      }
      if (gp.leftStickY !== 0) {
        moving -= gp.leftStickY; // Left stick up/down for forward/backward (inverted)
      }
    }
    
    if (invertForward) moving = -moving; // flip forward/back mapping for near side if needed
  // Running: Up + 'R' key OR left stick click (independent of invertForward) - disabled when menu open
  const forwardKey = !!(p['ArrowUp'] || p['w'] || p['W']) || (!settingsMenuOpen && gp.leftStickY < -0.3);
  const rPressed = !!(p['r'] || p['R']) || (!settingsMenuOpen && gp.leftStickClick);
  const runningNow = forwardKey && rPressed; // requires forward key held
  if (runningNow !== isRunning) setIsRunning(runningNow);

  const keysActive = (turning !== 0) || (moving !== 0) || Object.keys(jp).length > 0;

  // Track backward movement for animation
  if (moving < 0 && !isWalkingBackward) {
    setIsWalkingBackward(true);
    setIsWalking(false); // Clear forward walk when going backward
  } else if (moving > 0 && isWalkingBackward) {
    setIsWalkingBackward(false);
  } else if (moving === 0 && (isWalkingBackward || isWalking) && !targetRef.current) {
    setIsWalkingBackward(false);
  }

    // Apply incremental turn on tap (discrete nudge), plus continuous when held
  const turnStep = 0.12; // ~6.9° per tap
    if (!settingsMenuOpen) {
      if (jp['ArrowLeft'] || jp['a'] || jp['A']) { yawRef.current += turnStep; }
      if (jp['ArrowRight'] || jp['d'] || jp['D']) { yawRef.current -= turnStep; }
    }
    // Clear justPressed after consuming
    justPressed.current = {};
    // Continuous turn while held
    if (turning !== 0) {
      yawRef.current += turning * (turnSpeed || 0) * dt;
    }
    // Update turning state flags for animations (includes gamepad stick input) - disabled when menu open
    const turningLeftNow = !settingsMenuOpen && ((leftHeld || gp.leftStickX < -0.3 || gp.rightStickX < -0.3) && moving === 0);
    const turningRightNow = !settingsMenuOpen && ((rightHeld || gp.leftStickX > 0.3 || gp.rightStickX > 0.3) && moving === 0);
    setIsTurningLeft(turningLeftNow);
    setIsTurningRight(turningRightNow);
    const effYaw = yawRef.current || 0;
    ref.current.rotation.y = effYaw;

    // Jump trigger on Space press OR B button (only if grounded / not already jumping)
    // B button only triggers jump when edit menu is closed
  const spaceTapped = !!(jp['Space']) || (gp.bButtonPressed && !showEditMenu);
    const grounded = (jumpY <= 0.0001);
    // Current world Y of the avatar's feet (local ground baseline + platform lift + jump offset)
    const feetWorldY = localGroundY + platformLift + jumpY;
    if (spaceTapped && grounded && !isJumping) {
      // Set initial upward velocity based on desired apex height: vy = sqrt(2 * |g| * H)
      // Jumps use gentler gravity for a slower-looking arc
      curGravityRef.current = GRAVITY_JUMP;
      const vy0 = Math.sqrt(2 * Math.abs(curGravityRef.current) * TARGET_JUMP_HEIGHT);
      jumpVyRef.current = vy0;
      setIsJumping(true);
    }

  // Apply forward/back movement using facing direction
    if (moving !== 0) {
      const dir = new THREE.Vector3(0,0,-1);
      dir.applyAxisAngle(new THREE.Vector3(0,1,0), effYaw);
      dir.y = 0; dir.normalize();
      // Dynamic forward collision offset: reduce when descending forward to avoid hanging at bottom
      let dynamicFwd = COLLISION_FWD_OFFSET;
      let descendingForward = false;
      let ascendingBackward = false;
  if (moving > 0) {
        const wxNowKeys = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
        const wzNowKeys = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
        const fwdKeys = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), effYaw);
        fwdKeys.y = 0; fwdKeys.normalize();
    const swxKeys = wxNowKeys + fwdKeys.x * GROUND_SAMPLE_PUSH;
    const swzKeys = wzNowKeys + fwdKeys.z * GROUND_SAMPLE_PUSH;
  const gyAhead = getGroundHeightXZAtY(swxKeys, swzKeys, feetWorldY);
        descendingForward = (gyAhead < (platformLift - 0.05));
        if (descendingForward) {
          lastDescendFwdTimeRef.current = nowT;
          // At the top of stairs (high drop), use SHORT offset to allow entering
          // At the bottom of stairs (small drop), use LONG offset to clear nosing
          const drop = platformLift - gyAhead;
          const atTop = drop > (STAIR_RISE * 2); // More than 2 steps drop = at top
          const baseMag = atTop ? 0.5 : 6.0; // Short at top, long at bottom
          const mag = baseMag * STAIR_MAG_MUL;
          dynamicFwd = (COLLISION_FWD_OFFSET >= 0) ? mag : -mag;
        }
      } else if (moving < 0) {
        // Backward motion: detect ascending backward using ground sample behind the avatar
        const wxNowKeys = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
        const wzNowKeys = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
        const fwdKeys = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), effYaw);
        fwdKeys.y = 0; fwdKeys.normalize();
  // Probe farther behind to detect upcoming riser early for backward ascent
  const backMagKeys = Math.max(getBehindProbeMag(), 4.6 * STAIR_MAG_MUL);
  const swxBack = wxNowKeys - fwdKeys.x * backMagKeys;
  const swzBack = wzNowKeys - fwdKeys.z * backMagKeys;
  const gyBehind = getGroundHeightXZAtY(swxBack, swzBack, feetWorldY);
  ascendingBackward = (gyBehind > (platformLift + 0.05));
        // Also detect descending while moving backward: if ground ahead of us (relative to movement) is lower
        const swxBackAhead = wxNowKeys + fwdKeys.x * GROUND_SAMPLE_PUSH; // "ahead" in world = toward facing, but we're moving back relative to it
        const swzBackAhead = wzNowKeys + fwdKeys.z * GROUND_SAMPLE_PUSH;
        const gyBackAhead = getGroundHeightXZAtY(swxBackAhead, swzBackAhead, feetWorldY);
        const descendingBackward = (gyBackAhead < (platformLift - 0.05));
        if (descendingBackward) {
          lastDescendBackTimeRef.current = nowT;
          // Place collision center behind while descending backward to keep the back end clear of nosing
          const baseMag = 8.0;
          const mag = baseMag * STAIR_MAG_MUL;
          dynamicFwd = -Math.abs(mag);
        }
        if (ascendingBackward) {
          lastAscendBackTimeRef.current = nowT;
          // Place collision center behind to match movement side, keep it out a bit to avoid early hang-ups
          const baseMag = 8.0;
          const mag = baseMag * STAIR_MAG_MUL;
          // Always place collision center behind relative to facing when moving backward
          dynamicFwd = -Math.abs(mag);
        }
      }
  const descendActive = descendingForward || ((nowT - lastDescendFwdTimeRef.current) < 900) || (((nowT - lastDescendBackTimeRef.current) < 900));
      const ascendBackActive = ascendingBackward || ((nowT - lastAscendBackTimeRef.current) < 900);
      const offX = dir.x * dynamicFwd;
      const offZ = dir.z * dynamicFwd;
  const speedMul = (runningNow ? 2.0 : 1.0);
      const step = speed * speedMul * dt * moving;
      let nx = ref.current.position.x + dir.x * step;
      let nz = ref.current.position.z + dir.z * step;
      // remember velocity for optional facing logic (disabled during keys)
      velRef.current.x = dir.x * moving;
      velRef.current.z = dir.z * moving;
      // Collision against rectangular obstacles (world coords) + stair AABBs (XZ walls)
      const wxTry = nx + (baseOffset?.[0] || 0);
      const wzTry = nz + (baseOffset?.[1] || 0);
  const intersectsAny = (xw, zw) => {
        let rectHit = false;
        let stairHit = false;
        // Apply forward offset to collision center in world space
        const xw2 = xw + offX;
        const zw2 = zw + offZ;
        // Compute stair XZ footprints once (stair2 and stair3)
        const stair2HalfW = STAIR2_WIDTH / 2;
        const stair2XMin = STAIR2_POS_X - stair2HalfW - collisionRadius;
        const stair2XMax = STAIR2_POS_X + stair2HalfW + collisionRadius;
        const stair2ZMin = STAIR2_POS_Z - 0.01;
        const stair2ZMax = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4);
        
        // STAIR3 - rotated 90° (goes in -X direction)
        const stair3HalfW = STAIR3_WIDTH / 2;
        const stair3ZMin = STAIR3_POS_Z - stair3HalfW - collisionRadius;
        const stair3ZMax = STAIR3_POS_Z + stair3HalfW + collisionRadius;
        const stair3XMax = STAIR3_POS_X + 0.01;
        const stair3XMin = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN - (STAIR3_RUN * 2.4);
        
        const inAnyStairXZ = (xx, zz) => (
          (xx >= stair2XMin && xx <= stair2XMax && zz >= stair2ZMin && zz <= stair2ZMax) ||
          (xx >= stair3XMin && xx <= stair3XMax && zz >= stair3ZMin && zz <= stair3ZMax)
        );
        // Wider corridor check that accounts for the forward-offset green dot and gives extra margin at edges
        const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
        const extraZ = Math.max(0.15, STAIR2_RUN * 1.2);
        const stair2XMinWide = STAIR2_POS_X - stair2HalfW - extraXM;
        const stair2XMaxWide = STAIR2_POS_X + stair2HalfW + extraXM;
        const stair2ZMinWide = STAIR2_POS_Z - extraZ;
        const stair2ZMaxWide = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4) + extraZ;
        
        // STAIR3 wide (rotated)
        const extraZ3 = Math.max(0.15, STAIR3_RUN * 1.2);
        const stair3ZMinWide = STAIR3_POS_Z - stair3HalfW - extraZ3;
        const stair3ZMaxWide = STAIR3_POS_Z + stair3HalfW + extraZ3;
        const stair3XMaxWide = STAIR3_POS_X + extraXM;
        const stair3XMinWide = STAIR3_POS_X - STAIR3_STEPS * STAIR3_RUN - (STAIR3_RUN * 2.4) - extraXM;
        
        const inAnyStairXZWide = (xx, zz) => {
          // Check built-in stairs
          if ((xx >= stair2XMinWide && xx <= stair2XMaxWide && zz >= stair2ZMinWide && zz <= stair2ZMaxWide) ||
              (xx >= stair3XMinWide && xx <= stair3XMaxWide && zz >= stair3ZMinWide && zz <= stair3ZMaxWide)) {
            return true;
          }
          // Check placed stairs2 models (EXACT same as STAIR3)
          const cubes = CURRENT_PLACED_CUBES || [];
          for (const cube of cubes) {
            if (cube.modelType !== 'stairs2' || !cube.hasCollision) continue;
            const width = STAIR2_WIDTH * (cube.scale.x || 1);
            const run = STAIR2_RUN * (cube.scale.z || 1);
            const steps = STAIR2_STEPS;
            const posX = cube.position.x || 0;
            const posZ = cube.position.z || 0;
            const halfW = width / 2;
            const totalLen = steps * run;
            const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
            const xMin = posX - halfW - extraXM;
            const xMax = posX + halfW + extraXM;
            const extraZM = run * 0.75;
            const zMin = posZ - extraZM;
            const zMax = posZ + totalLen + extraZM;
            if (xx >= xMin && xx <= xMax && zz >= zMin && zz <= zMax) {
              return true;
            }
          }
          return false;
        };
        // OLD TABLE COLLISION (obstacles array) - DISABLED, now using height-bounded AABB system
        // The table collision is now handled below in the aabbs loop with proper height checking
        /* for (const r of obstacles || []) {
          if (!r) continue;
          const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
          if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
            // Expand rect by radius
            if (xw2 >= (minX - collisionRadius) && xw2 <= (maxX + collisionRadius) &&
                zw2 >= (minZ - collisionRadius) && zw2 <= (maxZ + collisionRadius)) {
              // If we're inside the stair corridor, ignore rectangular obstacle to allow entering steps
              const inStairXZ = inAnyStairXZWide(xw, zw) || inAnyStairXZWide(xw2, zw2);
              if (!inStairXZ) rectHit = true;
            }
          }
        } */
        // Stair walls in XZ (block only if feet are below step top)
        const aabbs = buildStairAABBsWorld();
        const feetY = localGroundY + platformLift + jumpY;
        // If we're inside the stair corridor (with generous margin) and descending, don't block on stair AABBs
        const inStairXZHereWide = inAnyStairXZWide(xw, zw) || inAnyStairXZWide(xw2, zw2);
        for (const b of aabbs) {
          const idx = (typeof b.idx === 'number') ? b.idx : 99;
          const isRailBox = b.isRailBox === true; // rail boxes are treated as regular collision objects
          const isPlatform = b.isPlatform === true; // platform boxes are solid collision surfaces (includes table)
          const isPlatformEdge = b.isPlatformEdge === true; // platform edge walls - always solid
          
          // Skip ALL stair step boxes - only process rail boxes, platforms, and edges
          if (!isRailBox && !isPlatform && !isPlatformEdge) {
            continue; // Skip all stair steps - no collision
          }
          
          // Rail boxes use fixed expand for consistent behavior, stairs use reduced expand for smaller characters
          // Astronaut (3.7): railExpand = 1.0, Alien (3.75): railExpand = 3.0
          const railExpand = collisionRadius <= 3.7 ? 1.0 : collisionRadius <= 3.75 ? 3.0 : 3.0;
          const stairExpand = collisionRadius <= 1.0 ? 0.0 : collisionRadius;
          const platformExpand = 0.0; // no expansion for platform collision (exact bounds, includes table)
          const edgeExpand = collisionRadius * 1.5; // platform edges use 1.5x expansion to catch collision early
          const expand = isPlatformEdge ? edgeExpand : (isPlatform ? platformExpand : (isRailBox ? railExpand : ((idx <= 5) ? 0.0 : (idx <= 6 ? (stairExpand * 0.10) : stairExpand))));
          // Test probe points - three-point collision check for all characters (base, offset, midpoint)
          const pmx = (xw + xw2) * 0.5, pmz = (zw + zw2) * 0.5; // midpoint between base and offset
          const hitAt = (xx, zz, b, expand) => {
            // Use circular collision for rocket base / placed spheres
            if (b.isRocketBase && b.centerX !== undefined && b.centerZ !== undefined && b.radius !== undefined) {
              const dx = xx - b.centerX;
              const dz = zz - b.centerZ;
              const dist = Math.sqrt(dx * dx + dz * dz);
              return dist < (b.radius + expand);
            }
            // Regular box collision
            const minX = b.min.x - expand, maxX = b.max.x + expand;
            const minZ = b.min.z - expand, maxZ = b.max.z + expand;
            return (xx >= minX && xx <= maxX && zz >= minZ && zz <= maxZ);
          };
          // All characters use three-point check: offset point, base point, and midpoint probe
          const hit = hitAt(xw2, zw2, b, expand) || hitAt(xw, zw, b, expand) || hitAt(pmx, pmz, b, expand);
          if (hit) {
            // Platform edge walls use post-movement clamping (like world edge) - skip here
            if (isPlatformEdge) {
              continue;
            }
            
            // Platform boxes block horizontal movement when you're at their vertical level
            // BUT: Skip this check for circular platforms (isRocketBase) - they have custom handling below
            if (isPlatform && !b.isRocketBase) {
              const topY = b.max.y;
              const bottomY = b.min.y;
              const avatarHeight = 14.0; // typical avatar height
              // feetY already calculated above at line ~5211
              const headY = feetY + avatarHeight;
              
              // Only block if:
              // 1. Walking into side: feet are INSIDE the platform volume (with tolerance for stair transition)
              // 2. Walking under: head hits the bottom surface from below
              const tolerance = 2.0; // large tolerance - stairs are lower than platform bottom, allow smooth transition
              const walkingIntoSide = (feetY > (bottomY + tolerance) && feetY < topY);
              const headHitsCeiling = (headY > bottomY && headY < topY && feetY < bottomY);
              
              if (walkingIntoSide || headHitsCeiling) {
                stairHit = true;
                break;
              }
              continue;
            }
            
            // Rail boxes are treated as regular collision objects - no special handling
            // While descending, completely ignore more steps for small collision radius (astronaut)
            const descendIgnoreSteps = collisionRadius < 1.0 ? 6 : 3;
            if (!isRailBox && descendActive && idx <= descendIgnoreSteps) {
              continue;
            }
            if (!isRailBox && descendActive && inStairXZHereWide) {
              // Allow free descent within staircase corridor
              continue;
            }
            // If descending forward, ignore blocking from stair boxes that are behind us (tail area)
            if (!isRailBox && descendActive) {
              const bx = (b.min.x + b.max.x) * 0.5;
              const bz = (b.min.z + b.max.z) * 0.5;
              const toBoxX = bx - xw2;
              const toBoxZ = bz - zw2;
              const dot = toBoxX * dir.x + toBoxZ * dir.z;
              if (dot < 0) { continue; }
            }
            if (!isRailBox && ascendBackActive && inStairXZHereWide) {
              // Allow free ascent within staircase corridor when going up backwards
              continue;
            }
            // If ascending backward, ignore stair boxes ahead of facing (we're moving opposite)
            if (!isRailBox && ascendBackActive) {
              const bx = (b.min.x + b.max.x) * 0.5;
              const bz = (b.min.z + b.max.z) * 0.5;
              const toBoxX = bx - xw2;
              const toBoxZ = bz - zw2;
              const dot = toBoxX * dir.x + toBoxZ * dir.z;
              if (dot > 0) { continue; }
            }
            const topY = b.max.y;
            // Near the lower steps, require a much larger clearance before blocking (not for rail boxes)
            const blockThresh = isRailBox ? 0.02 : ((idx <= 5) ? 0.80 : (idx <= 7 ? 0.50 : 0.02));
            // When descending, allow passing OVER stair boxes if feet are above them
            // Use STAIR_RISE (1.8) as threshold since that's the height between steps
            if (descendActive && feetY > topY + (STAIR_RISE * 0.5)) {
              continue; // Feet are above this step - allow passing over to descend
            }
            if (feetY < topY - blockThresh) { stairHit = true; break; }
          }
        }
        return { rect: rectHit, stair: stairHit };
      };
      // Allow passing through table rect when sufficiently airborne or already on table
  const allowRectPass = onTable || ((platformLift + jumpY) >= (tableTopLift * 0.6));
      const shouldBlock = (xw, zw) => {
        const hit = intersectsAny(xw, zw);
        return hit.stair || (hit.rect && !allowRectPass);
      };
      if (shouldBlock(wxTry, wzTry)) {
        // Wall sliding like modern games: try to maintain movement along the wall
        let slid = false;
        
        // First, try pure axis sliding (zero out one component of movement)
        // Try sliding along Z only (lock X position) - best for rails that run along Z
        const nxZ = ref.current.position.x;
        const nzZ = ref.current.position.z + dir.z * step;
        const wxZ = nxZ + (baseOffset?.[0] || 0);
        const wzZ = nzZ + (baseOffset?.[1] || 0);
        if (!shouldBlock(wxZ, wzZ)) {
          nx = nxZ;
          nz = nzZ;
          slid = true;
        }
        
        // Try sliding along X only (lock Z position) if Z-slide failed
        if (!slid) {
          const nxX = ref.current.position.x + dir.x * step;
          const nzX = ref.current.position.z;
          const wxX = nxX + (baseOffset?.[0] || 0);
          const wzX = nzX + (baseOffset?.[1] || 0);
          if (!shouldBlock(wxX, wzX)) {
            nx = nxX;
            nz = nzX;
            slid = true;
          }
        }
        
        // Try partial Z-axis sliding at reduced speeds
        if (!slid) {
          for (let zFrac = 0.9; zFrac >= 0.4; zFrac -= 0.1) {
            const nxTest = ref.current.position.x;
            const nzTest = ref.current.position.z + dir.z * step * zFrac;
            const wxTest = nxTest + (baseOffset?.[0] || 0);
            const wzTest = nzTest + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxTest, wzTest)) {
              nx = nxTest;
              nz = nzTest;
              slid = true;
              break;
            }
          }
        }
        
        // Try partial X-axis sliding at reduced speeds
        if (!slid) {
          for (let xFrac = 0.9; xFrac >= 0.4; xFrac -= 0.1) {
            const nxTest = ref.current.position.x + dir.x * step * xFrac;
            const nzTest = ref.current.position.z;
            const wxTest = nxTest + (baseOffset?.[0] || 0);
            const wzTest = nzTest + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxTest, wzTest)) {
              nx = nxTest;
              nz = nzTest;
              slid = true;
              break;
            }
          }
        }
        
        // Try partial diagonal sliding as last resort
        if (!slid) {
          for (let frac = 0.7; frac >= 0.2; frac -= 0.1) {
            const nxPartial = ref.current.position.x + dir.x * step * frac;
            const nzPartial = ref.current.position.z + dir.z * step * frac;
            const wxPartial = nxPartial + (baseOffset?.[0] || 0);
            const wzPartial = nzPartial + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxPartial, wzPartial)) {
              nx = nxPartial;
              nz = nzPartial;
              slid = true;
              break;
            }
          }
        }
        
        // If sliding fails, attempt auto-step-up for stair climbing
        if (!slid) {
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const lastStepUp = (ref.current && ref.current.__lastStepUpTime) || 0;
          const STEP_UP_COOLDOWN_MS = 90;
          const aabbs = buildStairAABBsWorld();
          const feetY = localGroundY + platformLift + jumpY;
          const ASCEND_FWD_PROBE_BASE = 4.6;
          const probeMag = (moving > 0) ? (ASCEND_FWD_PROBE_BASE * STAIR_MAG_MUL) : (moving < 0 ? (-ASCEND_FWD_PROBE_BASE * STAIR_MAG_MUL) : 0);
          const wxTry2 = wxTry + dir.x * probeMag;
          const wzTry2 = wzTry + dir.z * probeMag;
          let stepped = false;
          for (const b of aabbs) {
            const minX = b.min.x - collisionRadius, maxX = b.max.x + collisionRadius;
            const minZ = b.min.z - collisionRadius, maxZ = b.max.z + collisionRadius;
            if (wxTry2 >= minX && wxTry2 <= maxX && wzTry2 >= minZ && wzTry2 <= maxZ) {
              const topY = b.max.y;
              const delta = topY - feetY;
              if (delta > 0 && delta <= STEP_CLIMB_MAX && (now - lastStepUp) > STEP_UP_COOLDOWN_MS) {
                const newLift = (topY - localGroundY);
                setPlatformLift(newLift);
                const idx = (typeof b.idx === 'number') ? b.idx : 99;
                const minNudge = (idx === 0) ? 1.1 : (idx <= 2 ? 0.8 : 0.2);
                nx = ref.current.position.x + dir.x * Math.max(minNudge, step * 1.3);
                nz = ref.current.position.z + dir.z * Math.max(minNudge, step * 1.3);
                if (ref.current) ref.current.__lastStepUpTime = now;
                stepped = true;
              }
              break;
            }
          }
          // Only block completely if step-up also failed
          if (!stepped) {
            nx = ref.current.position.x;
            nz = ref.current.position.z;
          }
        }
      }
      // Clamp based on world position = parent + baseOffset (SQUARE boundary)
      const wx = nx + (baseOffset?.[0] || 0);
      const wz = nz + (baseOffset?.[1] || 0);
      
      // Square boundary check instead of circular
      const maxX = maxRadius;
      const maxZ = maxRadius;
      
      if (Math.abs(wx) <= maxX && Math.abs(wz) <= maxZ) {
        // Inside square boundary - allow movement
        ref.current.position.x = nx;
        ref.current.position.z = nz;
      } else {
        // Outside square boundary - clamp to edges
        const clampedWx = Math.max(-maxX, Math.min(maxX, wx));
        const clampedWz = Math.max(-maxZ, Math.min(maxZ, wz));
        ref.current.position.x = clampedWx - (baseOffset?.[0] || 0);
        ref.current.position.z = clampedWz - (baseOffset?.[1] || 0);
      }
      
      // Clamp to platform edges and rocket base (like world edge - simple position clamping)
      const aabbs = buildStairAABBsWorld();
      for (const b of aabbs) {
        if (!b.isPlatformEdge && !b.isRocketBase) continue;
        const wx2 = ref.current.position.x + (baseOffset?.[0] || 0);
        const wz2 = ref.current.position.z + (baseOffset?.[1] || 0);
        const margin = collisionRadius * 1.5;
        
        // Only apply collision if player is within the wall's vertical bounds
        const feetY = localGroundY + platformLift + jumpY;
        const headY = feetY + AVATAR_FINAL_HEIGHT; // approximate head height
        if (feetY > b.max.y) continue; // Above the wall (feet above top), no collision
        if (headY < b.min.y) continue; // Below the wall (head below bottom), no collision
        
        // Handle circular rocket base collision
        if (b.isRocketBase) {
          const allowWalkOnTop = b.walkableTop === true;
          
          // Check if feet are near/on the top surface
          // For spheres (top hemisphere), use larger threshold so you can approach and climb on
          // For cylinders (flat top), use smaller threshold
          const isSphereTop = b.min.y > (b.max.y - b.radius); // Sphere top starts at center Y
          const topThreshold = isSphereTop ? 100.0 : 1.0; // 100 units for sphere, 1 unit for cylinder
          const onTopOfCylinder = feetY >= b.max.y - topThreshold;
          
          if (onTopOfCylinder && allowWalkOnTop) {
            // When on top, check if we're within the top disk radius
            const dx = wx2 - b.centerX;
            const dz = wz2 - b.centerZ;
            const distFromCenter = Math.sqrt(dx * dx + dz * dz);
            
            // If within the top disk, skip all collision (standing on flat top)
            // If outside the top disk but still near top height, skip collision (falling off edge)
            // This prevents the side walls from catching you as you walk off the flat top
            continue; // Always skip collision when at top height (whether inside or outside disk)
          }
          
          // Below the top: apply normal circular side collision
          const dx = wx2 - b.centerX;
          const dz = wz2 - b.centerZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const minDist = b.radius + margin;
          if (dist < minDist && dist > 0.001) {
            // Push player away from center (only applies when NOT on top)
            const pushX = b.centerX + (dx / dist) * minDist;
            const pushZ = b.centerZ + (dz / dist) * minDist;
            ref.current.position.x = pushX - (baseOffset?.[0] || 0);
            ref.current.position.z = pushZ - (baseOffset?.[1] || 0);
          }
          continue;
        }
        
        // Special handling for table box - block on 4 sides, but allow standing on top if walkableTop is enabled
        if (b.isTableBox) {
          // If walkableTop is enabled AND feet are at or above the top surface, don't apply side collision (standing on top)
          const onTopOfBox = feetY >= b.max.y - 1.0; // within 1 unit of top
          const allowWalkOnTop = b.walkableTop === true; // Check if this box allows walking on top
          
          if (onTopOfBox && allowWalkOnTop) {
            continue; // skip collision for this box when standing on top (only if walkableTop enabled)
          }
          
          const inXBounds = wx2 >= b.min.x && wx2 <= b.max.x;
          const inZBounds = wz2 >= b.min.z && wz2 <= b.max.z;
          
          // Check all 4 sides and push out from whichever is closest
          if (inXBounds && inZBounds) {
            // Inside the box - push out to nearest edge
            const distLeft = wx2 - b.min.x;
            const distRight = b.max.x - wx2;
            const distFront = wz2 - b.min.z;
            const distBack = b.max.z - wz2;
            const minDist = Math.min(distLeft, distRight, distFront, distBack);
            
            if (minDist === distLeft) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (minDist === distRight) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            } else if (minDist === distFront) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (minDist === distBack) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          } else if (inXBounds) {
            // In X bounds, check Z sides
            if (wz2 < b.min.z && wz2 > b.min.z - margin) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (wz2 > b.max.z && wz2 < b.max.z + margin) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          } else if (inZBounds) {
            // In Z bounds, check X sides
            if (wx2 < b.min.x && wx2 > b.min.x - margin) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (wx2 > b.max.x && wx2 < b.max.x + margin) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            }
          }
          continue;
        }
        
        // Only clamp if within the ACTUAL wall bounds (not at the ends)
        const inXBounds = wx2 >= b.min.x && wx2 <= b.max.x;
        const inZBounds = wz2 >= b.min.z && wz2 <= b.max.z;
        
        // Determine if this is an X-axis wall (long in X) or Z-axis wall (long in Z)
        const wallLengthX = b.max.x - b.min.x;
        const wallLengthZ = b.max.z - b.min.z;
        const isXWall = wallLengthX > wallLengthZ; // wall runs along X axis
        
        if (isXWall) {
          // X-axis wall: only clamp Z if within X bounds
          if (inXBounds) {
            const tooFront = wz2 < b.min.z;
            const tooBack = wz2 > b.max.z;
            if (tooFront && wz2 > b.min.z - margin) {
              ref.current.position.z = b.min.z - margin - (baseOffset?.[1] || 0);
            } else if (tooBack && wz2 < b.max.z + margin) {
              ref.current.position.z = b.max.z + margin - (baseOffset?.[1] || 0);
            }
          }
        } else {
          // Z-axis wall: only clamp X if within Z bounds
          if (inZBounds) {
            const tooLeft = wx2 < b.min.x;
            const tooRight = wx2 > b.max.x;
            if (tooLeft && wx2 > b.min.x - margin) {
              ref.current.position.x = b.min.x - margin - (baseOffset?.[0] || 0);
            } else if (tooRight && wx2 < b.max.x + margin) {
              ref.current.position.x = b.max.x + margin - (baseOffset?.[0] || 0);
            }
          }
        }
      }
    // mark walking when keys cause translation
    setIsWalking(true);
  } else if (targetRef.current) {
      // Click-to-move: ease toward target when no key input
      const tx = Number(targetRef.current.x);
      const tz = Number(targetRef.current.z);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
        const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
        let vx = tx - wx;
        let vz = tz - wz;
        let dist = Math.hypot(vx, vz);
        const arriveEps = 0.25;
        if (dist <= arriveEps) {
          // Snap to target and notify arrival
          const localX = tx - (baseOffset?.[0] || 0);
          const localZ = tz - (baseOffset?.[1] || 0);
          // Clamp by world radius
          const rr = Math.hypot(tx, tz);
          if (rr <= maxRadius) {
            ref.current.position.x = localX;
            ref.current.position.z = localZ;
          } else {
            const ang = Math.atan2(tz, tx);
            ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
          }
          // On arrival: face a canonical board-facing yaw (0 radians)
          yawRef.current = 0;
          try {
            const wxFinal = (baseOffset?.[0] || 0) + ref.current.position.x;
            const wzFinal = (baseOffset?.[1] || 0) + ref.current.position.z;
            if (typeof onPositionChange === 'function') onPositionChange(wxFinal, wzFinal, yawRef.current || 0);
          } catch {}
          if (typeof onArrive === 'function') { try { onArrive(); } catch {} }
          targetRef.current = null;
          setIsWalking(false);
        } else {
          // Move toward target with same speed as keys
          vx /= (dist || 1);
          vz /= (dist || 1);
          const step = speed * dt;
          let nx = ref.current.position.x + vx * step;
          let nz = ref.current.position.z + vz * step;
          // remember velocity for facing
          velRef.current.x = vx;
          velRef.current.z = vz;
          // Collision against rectangular obstacles (world coords) + stair AABBs (XZ walls)
          const wxTry = nx + (baseOffset?.[0] || 0);
          const wzTry = nz + (baseOffset?.[1] || 0);
          // Compute forward offset from current yaw to shift collision center
          const face = new THREE.Vector3(0,0,-1);
          face.applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
          face.y = 0; face.normalize();
          // Determine descending-forward / descending-backward / ascending-backward for click path
          let descendingForwardClickFlag = false;
          let descendingBackwardClickFlag = false;
          let ascendingBackwardClickFlag = false;
          {
            const fwdEval = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
            fwdEval.y = 0; fwdEval.normalize();
            const swxAhead = wxTry + fwdEval.x * GROUND_SAMPLE_PUSH;
            const swzAhead = wzTry + fwdEval.z * GROUND_SAMPLE_PUSH;
            const gyAheadEval = getGroundHeightXZAtY(swxAhead, swzAhead, feetWorldY);
            descendingForwardClickFlag = (gyAheadEval < (platformLift - 0.05));
            const backMagClick = getBehindProbeMag();
            const swxBehind = wxTry - fwdEval.x * backMagClick;
            const swzBehind = wzTry - fwdEval.z * backMagClick;
            const gyBehindEval = getGroundHeightXZAtY(swxBehind, swzBehind, feetWorldY);
            ascendingBackwardClickFlag = (gyBehindEval > (platformLift + 0.05));
            // If moving backward relative to facing and the ground toward facing is lower, treat as descending backward
            const moveDot = (vx * fwdEval.x + vz * fwdEval.z);
            if (moveDot < 0) {
              const gyBackAheadEval = gyAheadEval; // sample toward facing as the next stair when backing down
              if (gyBackAheadEval < (platformLift - 0.05)) {
                descendingBackwardClickFlag = true;
              }
            }
          }
          // Apply dynamic forward offset for click path (similar to keys)
          let dynamicFwdClick = COLLISION_FWD_OFFSET;
          if (descendingForwardClickFlag) {
            const baseMag = 6.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? mag : -mag;
          } else if (descendingBackwardClickFlag) {
            // While backing down, place collision center behind to keep tail clear
            const baseMag = 8.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? -mag : mag;
          } else if (ascendingBackwardClickFlag) {
            const baseMag = 8.0;
            const mag = baseMag * STAIR_MAG_MUL;
            dynamicFwdClick = (COLLISION_FWD_OFFSET >= 0) ? -mag : mag;
          }
          if (descendingBackwardClickFlag) { lastDescendBackTimeRef.current = nowT; }
          const descendActiveClick = descendingForwardClickFlag || descendingBackwardClickFlag || ((nowT - lastDescendFwdTimeRef.current) < 900) || (((nowT - lastDescendBackTimeRef.current) < 900));
          // Lengthen backward-ascend latch for click to match keyboard path
          const ascendBackActiveClick = ascendingBackwardClickFlag || ((nowT - lastAscendBackTimeRef.current) < 900);
          const offX = face.x * dynamicFwdClick;
          const offZ = face.z * dynamicFwdClick;
          const intersectsAny = (xw, zw) => {
            let rectHit = false;
            let stairHit = false;
            // Bypass rectangular obstacles inside stair corridor (only stair2 - stair1 removed)
            const stair2HalfW = STAIR2_WIDTH / 2;
            const stair2XMin = STAIR2_POS_X - stair2HalfW - collisionRadius;
            const stair2XMax = STAIR2_POS_X + stair2HalfW + collisionRadius;
            const stair2ZMin = STAIR2_POS_Z - 0.01;
            const stair2ZMax = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4);
            const xw2 = xw + offX; const zw2 = zw + offZ;
            // Wider corridor that accounts for offset and margins near edges
            const extraXM = Math.max(Math.abs(offX), collisionRadius) + 1.0;
            const extraZ = Math.max(0.15, STAIR2_RUN * 1.2);
            const stair2XMinWide = STAIR2_POS_X - stair2HalfW - extraXM;
            const stair2XMaxWide = STAIR2_POS_X + stair2HalfW + extraXM;
            const stair2ZMinWide = STAIR2_POS_Z - extraZ;
            const stair2ZMaxWide = STAIR2_POS_Z + STAIR2_STEPS * STAIR2_RUN + (STAIR2_RUN * 2.4) + extraZ;
            for (const r of obstacles || []) {
              if (!r) continue;
              const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
              if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
                if (xw2 >= (minX - collisionRadius) && xw2 <= (maxX + collisionRadius) &&
                    zw2 >= (minZ - collisionRadius) && zw2 <= (maxZ + collisionRadius)) {
                  const inStair1 = false; // stair1 disabled
                  const inStair2 = (xw2 >= stair2XMinWide && xw2 <= stair2XMaxWide && zw2 >= stair2ZMinWide && zw2 <= stair2ZMaxWide);
                  const inStairXZ = inStair1 || inStair2;
                  if (!inStairXZ) rectHit = true;
                }
              }
            }
            const aabbs = buildStairAABBsWorld();
            const feetY = localGroundY + platformLift + jumpY;
            for (const b of aabbs) {
              const idx = (typeof b.idx === 'number') ? b.idx : 99;
              const isRailBox = b.isRailBox === true;
              const isPlatform = b.isPlatform === true; // platform boxes are solid collision surfaces
              const isPlatformEdge = b.isPlatformEdge === true; // platform edge walls - always solid
              // Do not relax for rail boxes, platforms, or edges; otherwise never block on the bottom four steps
              if (!isRailBox && !isPlatform && !isPlatformEdge && idx <= 3) {
                continue;
              }
              // Rail boxes use fixed expand for consistent behavior, stairs use reduced expand for smaller characters
              // Astronaut (3.7): railExpand = 1.0, Alien (3.75): railExpand = 3.0
              const railExpand = collisionRadius <= 3.7 ? 1.0 : collisionRadius <= 3.75 ? 3.0 : 3.0;
              const stairExpand = collisionRadius <= 1.0 ? 0.0 : collisionRadius;
              const platformExpand = 0.0; // no expansion for platform collision (exact bounds)
              const edgeExpand = collisionRadius * 1.5; // platform edges use 1.5x expansion to catch collision early
              const expand = isPlatformEdge ? edgeExpand : (isPlatform ? platformExpand : (isRailBox ? railExpand : ((idx <= 5) ? 0.0 : (idx <= 6 ? (stairExpand * 0.10) : stairExpand))));
              // Test probe points - three-point collision check for all characters (base, offset, midpoint)
              const pmx = (xw + xw2) * 0.5, pmz = (zw + zw2) * 0.5;
              const hitAt = (xx, zz, b, expand) => {
                // Use circular collision for rocket base / placed spheres
                if (b.isRocketBase && b.centerX !== undefined && b.centerZ !== undefined && b.radius !== undefined) {
                  const dx = xx - b.centerX;
                  const dz = zz - b.centerZ;
                  const dist = Math.sqrt(dx * dx + dz * dz);
                  return dist < (b.radius + expand);
                }
                // Regular box collision
                const minX = b.min.x - expand, maxX = b.max.x + expand;
                const minZ = b.min.z - expand, maxZ = b.max.z + expand;
                return (xx >= minX && xx <= maxX && zz >= minZ && zz <= maxZ);
              };
              // All characters use three-point check: offset point, base point, and midpoint probe
              const hit = hitAt(xw2, zw2, b, expand) || hitAt(xw, zw, b, expand) || hitAt(pmx, pmz, b, expand);
              if (hit) {
                // Platform edge walls use post-movement clamping (like world edge) - skip here
                if (isPlatformEdge) {
                  continue;
                }
                
                // Platform boxes block horizontal movement when you're at their vertical level
                if (isPlatform) {
                  const topY = b.max.y;
                  const bottomY = b.min.y;
                  const avatarHeight = 14.0; // typical avatar height
                  // feetY already calculated above at line ~5550
                  const headY = feetY + avatarHeight;
                  
                  // Only block if:
                  // 1. Walking into side: feet are INSIDE the platform volume (with tolerance for stair transition)
                  // 2. Walking under: head hits the bottom surface from below
                  const tolerance = 2.0; // large tolerance - stairs are lower than platform bottom, allow smooth transition
                  const walkingIntoSide = (feetY > (bottomY + tolerance) && feetY < topY);
                  const headHitsCeiling = (headY > bottomY && headY < topY && feetY < bottomY);
                  
                  if (walkingIntoSide || headHitsCeiling) {
                    stairHit = true;
                    break;
                  }
                  continue;
                }
                
                const inStair1Here = false; // stair1 disabled
                const inStair2Here = (xw2 >= stair2XMinWide && xw2 <= stair2XMaxWide && zw2 >= stair2ZMinWide && zw2 <= stair2ZMaxWide);
                const inStairXZHere = inStair1Here || inStair2Here;
                // While descending, completely ignore more steps for small collision radius (astronaut)
                const descendIgnoreSteps = collisionRadius < 1.0 ? 6 : 3;
                if (!isRailBox && descendActiveClick && idx <= descendIgnoreSteps) {
                  continue;
                }
                if (!isRailBox && descendActiveClick && inStairXZHere) {
                  // Allow free descent within staircase corridor
                  continue;
                }
                if (!isRailBox && ascendBackActiveClick && inStairXZHere) {
                  // Allow free ascent within staircase corridor when going up backwards
                  continue;
                }
                // If descending forward (click path), ignore stair boxes behind us
                if (!isRailBox && descendActiveClick) {
                  const bx = (b.min.x + b.max.x) * 0.5;
                  const bz = (b.min.z + b.max.z) * 0.5;
                  const toBoxX = bx - xw2;
                  const toBoxZ = bz - zw2;
                  const dot = toBoxX * face.x + toBoxZ * face.z;
                  if (dot < 0) { continue; }
                }
                // If ascending backward (click path), ignore stair boxes ahead of facing
                if (!isRailBox && ascendBackActiveClick) {
                  const bx = (b.min.x + b.max.x) * 0.5;
                  const bz = (b.min.z + b.max.z) * 0.5;
                  const toBoxX = bx - xw2;
                  const toBoxZ = bz - zw2;
                  const dot = toBoxX * face.x + toBoxZ * face.z;
                  if (dot > 0) { continue; }
                }
                const topY = b.max.y;
                const blockThresh = isRailBox ? 0.02 : ((idx <= 5) ? 0.80 : (idx <= 7 ? 0.50 : 0.02));
                if (feetY < topY - blockThresh) { stairHit = true; break; }
              }
            }
            return { rect: rectHit, stair: stairHit };
          };
          const allowRectPass = onTable || ((platformLift + jumpY) >= (tableTopLift * 0.6));
          const shouldBlock = (xw, zw) => {
            const hit = intersectsAny(xw, zw);
            return hit.stair || (hit.rect && !allowRectPass);
          };
          if (shouldBlock(wxTry, wzTry)) {
            // Wall sliding like modern games: try to maintain movement along the wall
            let slid = false;
            
            // First, try pure axis sliding (zero out one component of movement)
            // Try sliding along Z only (lock X position) - best for rails that run along Z
            const nxZ = ref.current.position.x;
            const nzZ = ref.current.position.z + vz * step;
            const wxZ = nxZ + (baseOffset?.[0] || 0);
            const wzZ = nzZ + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxZ, wzZ)) {
              nx = nxZ;
              nz = nzZ;
              slid = true;
            }
            
            // Try sliding along X only (lock Z position) if Z-slide failed
            if (!slid) {
              const nxX = ref.current.position.x + vx * step;
              const nzX = ref.current.position.z;
              const wxX = nxX + (baseOffset?.[0] || 0);
              const wzX = nzX + (baseOffset?.[1] || 0);
              if (!shouldBlock(wxX, wzX)) {
                nx = nxX;
                nz = nzX;
                slid = true;
              }
            }
            
            // Try partial Z-axis sliding at reduced speeds
            if (!slid) {
              for (let zFrac = 0.9; zFrac >= 0.4; zFrac -= 0.1) {
                const nxTest = ref.current.position.x;
                const nzTest = ref.current.position.z + vz * step * zFrac;
                const wxTest = nxTest + (baseOffset?.[0] || 0);
                const wzTest = nzTest + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxTest, wzTest)) {
                  nx = nxTest;
                  nz = nzTest;
                  slid = true;
                  break;
                }
              }
            }
            
            // Try partial X-axis sliding at reduced speeds
            if (!slid) {
              for (let xFrac = 0.9; xFrac >= 0.4; xFrac -= 0.1) {
                const nxTest = ref.current.position.x + vx * step * xFrac;
                const nzTest = ref.current.position.z;
                const wxTest = nxTest + (baseOffset?.[0] || 0);
                const wzTest = nzTest + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxTest, wzTest)) {
                  nx = nxTest;
                  nz = nzTest;
                  slid = true;
                  break;
                }
              }
            }
            
            // Try partial diagonal sliding as last resort
            if (!slid) {
              for (let frac = 0.7; frac >= 0.2; frac -= 0.1) {
                const nxPartial = ref.current.position.x + vx * step * frac;
                const nzPartial = ref.current.position.z + vz * step * frac;
                const wxPartial = nxPartial + (baseOffset?.[0] || 0);
                const wzPartial = nzPartial + (baseOffset?.[1] || 0);
                if (!shouldBlock(wxPartial, wzPartial)) {
                  nx = nxPartial;
                  nz = nzPartial;
                  slid = true;
                  break;
                }
              }
            }
            
            // If sliding fails, attempt auto-step-up
            if (!slid) {
              let stepped = false;
              const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
              const lastStepUp = (ref.current && ref.current.__lastStepUpTime) || 0;
              const STEP_UP_COOLDOWN_MS = 90;
              const aabbs = buildStairAABBsWorld();
              const feetY = localGroundY + platformLift + jumpY;
              const tryX = ref.current.position.x + vx * step;
              const tryZ = ref.current.position.z + vz * step;
              if (Number.isFinite(tryX) && Number.isFinite(tryZ)) {
                const twx = tryX + (baseOffset?.[0] || 0);
                const twz = tryZ + (baseOffset?.[1] || 0);
                // Probe ahead for step-up detection
                const face2 = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yawRef.current || 0);
                face2.y = 0; face2.normalize();
                const ASCEND_FWD_PROBE_BASE = 4.6;
                const moveDot = (vx * face2.x + vz * face2.z);
                const probeMag2 = (moveDot >= 0 ? ASCEND_FWD_PROBE_BASE : -ASCEND_FWD_PROBE_BASE) * STAIR_MAG_MUL;
                const offX2 = face2.x * probeMag2;
                const offZ2 = face2.z * probeMag2;
                const twx2 = twx + offX2;
                const twz2 = twz + offZ2;
                for (const b of aabbs) {
                  const minX = b.min.x - collisionRadius, maxX = b.max.x + collisionRadius;
                  const minZ = b.min.z - collisionRadius, maxZ = b.max.z + collisionRadius;
                  if (twx2 >= minX && twx2 <= maxX && twz2 >= minZ && twz2 <= maxZ) {
                    const topY = b.max.y;
                    const delta = topY - feetY;
                    if (delta > 0 && delta <= STEP_CLIMB_MAX && (now - lastStepUp) > STEP_UP_COOLDOWN_MS) {
                      const newLift = (topY - localGroundY);
                      const cur = platformLift;
                      const k = LIFT_SMOOTH_UP_K;
                      const nextLift = cur + (newLift - cur) * Math.min(1, k * dt);
                      setPlatformLift(nextLift);
                      const idx = (typeof b.idx === 'number') ? b.idx : 99;
                      const minNudge = (idx === 0) ? 1.1 : (idx <= 2 ? 0.8 : 0.2);
                      nx = ref.current.position.x + vx * Math.max(minNudge, step * 1.3);
                      nz = ref.current.position.z + vz * Math.max(minNudge, step * 1.3);
                      if (ref.current) ref.current.__lastStepUpTime = now;
                      stepped = true;
                    }
                    break;
                  }
                }
              }
              // Only block completely if step-up also failed
              if (!stepped) {
                nx = ref.current.position.x;
                nz = ref.current.position.z;
              }
            }
          }
          // Clamp to radius from world origin considering baseOffset
          const nwx = nx + (baseOffset?.[0] || 0);
          const nwz = nz + (baseOffset?.[1] || 0);
          const r = Math.hypot(nwx, nwz);
          if (r <= maxRadius) {
            ref.current.position.x = nx;
            ref.current.position.z = nz;
          } else {
            const ang = Math.atan2(nwz, nwx);
            ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
          }
          setIsWalking(true);
        }
      }
    } else {
      // No keys and no click target: clear residual velocity so we don't auto-face old movement
      velRef.current.x = 0;
      velRef.current.z = 0;
      // defer isWalking decision to displacement check below
    }

    // Update jump physics and tabletop interactions
    // World position for tabletop checks
    const wxNow = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
    const wzNow = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
    // Consider tabletop "overlap" if the avatar's collision disk overlaps the tabletop rect
    const overlapsTable = (() => {
      for (const r of obstacles || []) {
        if (!r) continue;
        const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
        if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
          if (wxNow >= (minX - collisionRadius) && wxNow <= (maxX + collisionRadius) &&
              wzNow >= (minZ - collisionRadius) && wzNow <= (maxZ + collisionRadius)) {
            return true;
          }
        }
      }
      return false;
    })();

  if (isJumping || jumpY > 0.0001) {
  const g = curGravityRef.current; // use current gravity (jump/slow-fall/fast as set)
      let vy = jumpVyRef.current + g * dt;
      let y = jumpY + vy * dt;
      // Absolute height above ground plane
      let absY = platformLift + y;
      // Handle landing on tabletop if descending and near/below plane (with snap band to be forgiving)
  const TABLE_SNAP_BAND = 8.0; // allow fast descents to snap reliably
      if (!onTable && overlapsTable && vy < 0 && absY <= (tableTopLift + TABLE_SNAP_BAND)) {
        // Snap to tabletop
        y = 0; vy = 0; absY = tableTopLift; setPlatformLift(tableTopLift); setOnTable(true); setIsJumping(false);
      } else if (onTable) {
        if (!overlapsTable) {
          // Stepping/falling off the table: convert platform height into jump height to fall down
          const carry = platformLift + y;
          setPlatformLift(0); setOnTable(false);
          y = Math.max(0, carry); // start falling from current absolute height
          // keep vy as-is; if upward it's fine, if downward, continue falling
        } else if (vy < 0 && y <= 0) {
          // Land back on the tabletop
          y = 0; vy = 0; setIsJumping(false);
        }
  } else if (!onTable && vy < 0) {
        // Descending: snap to step top when close
        // Sample ground both in front and behind (using the same magnitude) to avoid sinking while turning on stairs
        const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), (yawRef.current || 0));
        fwd.y = 0; fwd.normalize();
  const magF = getForwardProbeMag();
  const magB = getBehindProbeMag();
  const swxF = wxNow + fwd.x * magF;
  const swzF = wzNow + fwd.z * magF;
  const swxB = wxNow - fwd.x * magB;
  const swzB = wzNow - fwd.z * magB;
  // Use current falling position (not old platformLift) to detect ground, prevents snapping back to old platform
  const currentFallingY = localGroundY + platformLift + y;
  const gyF = getGroundHeightXZAtY(swxF, swzF, currentFallingY);
  const gyB = getGroundHeightXZAtY(swxB, swzB, currentFallingY);
  const gyCenter = getGroundHeightXZAtY(wxNow, wzNow, currentFallingY);
        // When falling fast (negative velocity), prefer the LOWER ground to prevent snapping back to platform we jumped from
        // When rising or walking, prefer the HIGHER ground to prevent sinking into stairs
        // Sample three points (front, back, center) and pick based on velocity
        const gy = vy < -5 ? Math.min(gyF, gyB, gyCenter) : Math.max(gyF, gyB, gyCenter);
        let targetAbs = localGroundY + gy;
        const curAbs = localGroundY + platformLift + y;
        
        // During fast falls from high places, use tighter snap band to prevent false landings
        // When falling slowly (normal jumps/stairs), use normal snap band
        const isFallingFast = Math.abs(vy) > 20; // Fast fall from high edge
        const SNAP_BAND = isFallingFast ? 0.5 : Math.max(0.1, 0.25 * STAIR_RISE);
        
        if (curAbs <= targetAbs + SNAP_BAND) {
          // Simple landing: just snap to the ground height and stop jumping
          // This matches the smooth falling behavior when running off a ledge
          setPlatformLift(gy);
          y = 0; 
          vy = 0; 
          setIsJumping(false);
        }
      }
      // Commit
      jumpVyRef.current = vy;
      if (Math.abs(y - jumpY) > 0.00001) setJumpY(y);
    }
    // If grounded (not jumping) and not on table, snap to stair ground height
    if (!isJumping && !onTable) {
      // Grounded: sample ground both in front and behind using same magnitude to stabilize when turning on stairs
      const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), (yawRef.current || 0));
      fwd.y = 0; fwd.normalize();
      const magF2 = getForwardProbeMag();
      const magB2 = getBehindProbeMag();
      const swxF = wxNow + fwd.x * magF2;
      const swzF = wzNow + fwd.z * magF2;
      const swxB = wxNow - fwd.x * magB2;
      const swzB = wzNow - fwd.z * magB2;
      const gyF = getGroundHeightXZAtY(swxF, swzF, feetWorldY);
      const gyB = getGroundHeightXZAtY(swxB, swzB, feetWorldY);
      // Use average of front and back samples for ultra-smooth descent (no switching/oscillation)
      const cur = platformLift;
      let targetGy = (gyF + gyB) / 2; // Smooth average prevents oscillation
      
      // Limit descent rate near stairs to prevent stepping off into thin air
      if (targetGy < cur) {
        const stairHalfW2 = STAIR2_WIDTH / 2;
        const stairHalfW3 = STAIR3_WIDTH / 2;
        const totalLen2 = STAIR2_STEPS * STAIR2_RUN;
        const totalLen3 = STAIR3_STEPS * STAIR3_RUN;
        
        const stair2XMin = STAIR2_POS_X - stairHalfW2 - collisionRadius;
        const stair2XMax = STAIR2_POS_X + stairHalfW2 + collisionRadius;
        const stair2ZMin = STAIR2_POS_Z - (STAIR2_RUN * 0.75);
        const stair2ZMax = STAIR2_POS_Z + totalLen2 + (STAIR2_RUN * 0.75);
        
        const stair3ZMin = STAIR3_POS_Z - stairHalfW3 - collisionRadius;
        const stair3ZMax = STAIR3_POS_Z + stairHalfW3 + collisionRadius;
        const stair3XMax = STAIR3_POS_X + (STAIR3_RUN * 0.75);
        const stair3XMin = STAIR3_POS_X - totalLen3 - (STAIR3_RUN * 0.75);
        
        const nearStair2 = (wxNow >= stair2XMin && wxNow <= stair2XMax && wzNow >= stair2ZMin && wzNow <= stair2ZMax);
        const nearStair3 = (wxNow >= stair3XMin && wxNow <= stair3XMax && wzNow >= stair3ZMin && wzNow <= stair3ZMax);
        
        if (nearStair2 || nearStair3) {
          // On stairs: limit drop to prevent stepping through - but use generous limit for smooth ramps
          const MAX_RISE = Math.max(STAIR2_RISE, STAIR3_RISE);
          const maxStepDown = (MAX_RISE * 2.5); // 2.5 steps max drop (was 1.05 - much more generous now)
          targetGy = Math.max(targetGy, cur - maxStepDown);
        }
      }
      
      if (Math.abs(targetGy - cur) > 0.0001) {
  const goingUp = targetGy > cur;
        if (!goingUp) {
          // If the drop is large (e.g., walking off platform edge), enter fall instead of snapping down
          const drop = cur - targetGy;
          // Increased threshold to prevent false falls on slopes - only trigger on actual cliff edges
          const FALL_TRIGGER_DROP = Math.max(3.5 * STAIR_RISE, 6.0); // ~6.3 units minimum
          if (drop > FALL_TRIGGER_DROP) {
            // Begin a gentle fall: transfer current lift into jump height and let gravity handle descent
            // Determine if we're stepping off the big top platform area; use slow gravity there
            const isOverTopPlatform = (() => {
              const stairsLen = STAIR2_STEPS * STAIR2_RUN;
              const zMin = STAIR2_POS_Z + stairsLen;
              const zMax = zMin + STAIR2_PLATFORM_DEPTH;
              const halfW = STAIR2_PLATFORM_WIDTH / 2;
              const xMin = STAIR2_POS_X - halfW;
              const xMax = STAIR2_POS_X + halfW;
              return (wxNow >= xMin && wxNow <= xMax && wzNow >= zMin && wzNow <= zMax);
            })();
            // If we triggered a fall (not a jump), use slow fall on platform, else use softer fall
            curGravityRef.current = isOverTopPlatform ? GRAVITY_SLOW_FALL : GRAVITY_FALL;
            setPlatformLift(0);
            setIsJumping(true);
            jumpVyRef.current = 0;
            setJumpY(cur);
          } else {
            // Downward movement: use same smooth lerp as upward movement (no clamping for consistent smoothness)
            const k = LIFT_SMOOTH_DOWN_K;
            const nextLift = cur + (targetGy - cur) * Math.min(1, k * dt);
            setPlatformLift(nextLift);
          }
        } else {
          const k = LIFT_SMOOTH_UP_K;
          const nextLift = cur + (targetGy - cur) * Math.min(1, k * dt);
          setPlatformLift(nextLift);
        }
      }
    }
    // If standing on the table and walking off its core without jumping, start a fall
    if (onTable && !overlapsTable && !isJumping) {
      const carry = platformLift + 0;
  // Table falls use the softer fall gravity (25% slower than jump)
  curGravityRef.current = GRAVITY_FALL;
      setPlatformLift(0); setOnTable(false);
      // Begin falling from current absolute height
      setIsJumping(true);
      jumpVyRef.current = 0;
      if (carry > 0) setJumpY(carry);
    }
    // Smoothly rotate toward click-move direction only when keys are not active
    if (ref.current && !keysActive && !!targetRef.current) {
      const vx = velRef.current.x;
      const vz = velRef.current.z;
      const mag = Math.hypot(vx, vz);
      const movingVec = mag > 0.001;
      if (movingVec) {
        let cur = yawRef.current || 0;
        // Align with arrow-move mapping: dir = R_y(yaw) * (0,0,-1)
        // So yaw should be atan2(vx, vz) + PI for a world direction (vx,vz)
        const desired = Math.atan2(vx, vz) + Math.PI + (clickYawOffset || 0);
        let diff = ((desired - cur + Math.PI) % (2 * Math.PI)) - Math.PI;
        cur += Math.sign(diff) * Math.min(Math.abs(diff), ((turnSpeed || 0) * dt));
        yawRef.current = cur;
        ref.current.rotation.y = cur;
      }
    }
    // Publish world position and yaw (baseOffset + local). Also publish when yaw changes while standing still.
    if (ref.current) {
      // Displacement-based walking detection (covers all motion sources)
      const cx = ref.current.position.x;
      const cz = ref.current.position.z;
      const dxLoc = cx - prevLocalPos.current.x;
      const dzLoc = cz - prevLocalPos.current.z;
      const disp = Math.hypot(dxLoc, dzLoc);
      prevLocalPos.current.set(cx, 0, cz);
      // Toggle walk if moved more than a tiny epsilon this frame
      const movingNow = disp > 0.0002;
      if (!targetRef.current && moving === 0) {
        // when neither keys nor click-to-move is active, use displacement to decide
        if (movingNow !== isWalking) setIsWalking(movingNow);
      }
  const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
  const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
  const wyaw = yawRef.current || 0;
  // Publish local avatar pose globally for follow camera (mirrors remote pattern)
  try {
    window.__CF_LOCAL_AVATAR__ = { x: wx, z: wz, yaw: wyaw, isRunning: runningNow, isJumping: !!isJumping, lift: (platformLift + jumpY) };
    window.__CF_COLLISION_FWD__ = COLLISION_FWD_OFFSET;
  } catch {}
      const t = performance.now();
      const dxs = Math.abs(wx - lastSent.current.x);
      const dzs = Math.abs(wz - lastSent.current.z);
      // shortest angular difference in radians
      const yawDiff = (((wyaw - (lastSent.current.yaw||0)) + Math.PI) % (2*Math.PI)) - Math.PI;
      const yawChanged = Math.abs(yawDiff) > 0.02; // ~1.1°
      // Also send when turning-in-place so spectators see live yaw; align throttle with server (~35ms)
      const turningNow = !!(pressed.current['ArrowLeft'] || pressed.current['a'] || pressed.current['A'] || pressed.current['ArrowRight'] || pressed.current['d'] || pressed.current['D']);
      const liftNow = (platformLift + jumpY);
      const liftDiff = Math.abs(liftNow - (lastSent.current.lift || 0));
      const jumpChanged = (!!isJumping !== !!lastSent.current.isJumping);
      if (typeof onPositionChange === 'function' && (((dxs + dzs) > 0.1) || yawChanged || turningNow || liftDiff > 0.5 || jumpChanged) && (t - lastSent.current.t) > 35) {
        lastSent.current = { x: wx, z: wz, yaw: wyaw, t, lift: liftNow, isJumping: !!isJumping };
        onPositionChange(wx, wz, wyaw);
      }
      // Update HUD every ~100ms
      hudTick.current += dt;
      if (hudTick.current >= 0.1) {
        hudTick.current = 0;
        const yawDeg = ((yawRef.current * 180 / Math.PI) % 360 + 360) % 360;
        setHudText(`x: ${wx.toFixed(1)}  z: ${wz.toFixed(1)}  yaw: ${yawDeg.toFixed(0)}°`);
      }
    }
  });

  // Inject motion props into the first child (avatar), preserve other children
  const childWithMotion = useMemo(() => {
    const arr = React.Children.toArray(children);
    if (arr.length > 0 && React.isValidElement(arr[0])) {
      try { arr[0] = React.cloneElement(arr[0], { isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, extraLiftY: (platformLift + jumpY) }); } catch {}
    }
    return arr;
  }, [children, isWalking, isWalkingBackward, isRunning, isTurningLeft, isTurningRight, isJumping, jumpY, platformLift]);

  return (
    <group position={[ (baseOffset?.[0]||0), 0, (baseOffset?.[1]||0) ]}>
      <group ref={ref}>
        <group ref={childRef}>{childWithMotion}</group>
        {showCollisionBoxes && (
          <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, localGroundY + platformLift + jumpY + 0.02, COLLISION_FWD_OFFSET]}>
            <ringGeometry args={[Math.max(0.001, collisionRadius-0.05), collisionRadius, 24]} />
            <meshBasicMaterial color={'#f97316'} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        {showCollisionBoxes && (
          <mesh position={[0, localGroundY + platformLift + jumpY + 0.02, COLLISION_FWD_OFFSET]}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color={'#10b981'} transparent opacity={0.85} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// Settings Menu Component with Controller Navigation
function SettingsMenu({ isOpen, onClose, settings, onSave, onLiveUpdate }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [turnSensitivity, setTurnSensitivity] = useState(settings.turnSensitivity);
  const [cameraDistance, setCameraDistance] = useState(settings.cameraDistance);
  const [cameraHeight, setCameraHeight] = useState(settings.cameraHeight);
  const menuItems = ['turnSensitivity', 'cameraDistance', 'cameraHeight', 'save', 'close'];
  
  // Controller cursor state
  const [cursorPos, setCursorPos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cursorPosRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); // Ref for immediate access
  const cursorSpeed = 35; // pixels per frame - faster movement
  const lastHoveredElement = useRef(null);
  const [usingController, setUsingController] = useState(false); // Track if controller is being used
  
  // Update ref when cursorPos changes
  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);
  
  // Log when usingController changes
  useEffect(() => {
    console.log('[Settings Menu] usingController:', usingController);
  }, [usingController]);
  
  // Reset cursor to center when menu opens
  useEffect(() => {
    if (isOpen) {
      setCursorPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
  }, [isOpen]);
  
  // Gamepad polling for menu navigation
  const gamepadState = useRef({
    dpadUp: false,
    dpadDown: false,
    dpadLeft: false,
    dpadRight: false,
    aButton: false,
    yButton: false,
    leftStickX: 0,
    leftStickY: 0
  });
  
  useEffect(() => {
    if (!isOpen) return;
    
    // Reset to saved values when menu opens (only run once when menu opens)
    setTurnSensitivity(settings.turnSensitivity);
    setCameraDistance(settings.cameraDistance);
    setCameraHeight(settings.cameraHeight);
    setSelectedIndex(-1); // Start with nothing selected
    
    // Detect mouse movement to show real cursor
    const handleMouseMove = (e) => {
      // Only update when actually moving the mouse (not just passive events while controller is active)
      setUsingController(false); // Mouse is being used
      setCursorPos({ x: e.clientX, y: e.clientY }); // Update cursor position to match mouse
    };
    
    // Only Escape key support (removed arrow keys to avoid conflicts with game movement)
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    
    // Cleanup hover state when menu closes
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      if (lastHoveredElement.current) {
        const leaveEvent = new MouseEvent('mouseleave', { bubbles: true, cancelable: true });
        lastHoveredElement.current.dispatchEvent(leaveEvent);
        lastHoveredElement.current = null;
      }
    };
  }, [isOpen]); // Only depend on isOpen - don't reset when settings change!
  
  // Live update camera when distance or height changes
  useEffect(() => {
    if (isOpen && onLiveUpdate) {
      onLiveUpdate({ turnSensitivity, cameraDistance, cameraHeight });
    }
  }, [cameraDistance, cameraHeight, isOpen, onLiveUpdate, turnSensitivity]);
  
  // Gamepad polling for menu navigation
  useEffect(() => {
    if (!isOpen) return;
    
    const pollInterval = setInterval(() => {
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[0];
        
        if (!gamepad) return;
        
        const deadzone = 0.1; // Lower deadzone for more responsive cursor
        
        // Left stick for cursor movement - smooth and responsive
        const leftX = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
        const leftY = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
        
        // Update cursor position based on left stick with acceleration
        if (leftX !== 0 || leftY !== 0) {
          const magnitude = Math.sqrt(leftX * leftX + leftY * leftY);
          const speedMultiplier = 1 + magnitude; // Speed increases with stick distance
          
          setUsingController(true); // Controller is being used
          
          setCursorPos(prev => ({
            x: Math.max(0, Math.min(window.innerWidth, prev.x + leftX * cursorSpeed * speedMultiplier)),
            y: Math.max(0, Math.min(window.innerHeight, prev.y + leftY * cursorSpeed * speedMultiplier))
          }));
        }
        
        // D-pad buttons: 12=up, 13=down, 14=left, 15=right
        const dpadUpNow = gamepad.buttons[12]?.pressed || false;
        const dpadDownNow = gamepad.buttons[13]?.pressed || false;
        const dpadLeftNow = gamepad.buttons[14]?.pressed || false;
        const dpadRightNow = gamepad.buttons[15]?.pressed || false;
        const aButtonNow = gamepad.buttons[0]?.pressed || false;
        const yButtonNow = gamepad.buttons[3]?.pressed || false;
        
        // Detect button press (not hold)
        const dpadUpPressed = dpadUpNow && !gamepadState.current.dpadUp;
        const dpadDownPressed = dpadDownNow && !gamepadState.current.dpadDown;
        const dpadLeftPressed = dpadLeftNow && !gamepadState.current.dpadLeft;
        const dpadRightPressed = dpadRightNow && !gamepadState.current.dpadRight;
        const aButtonPressed = aButtonNow && !gamepadState.current.aButton;
        const yButtonPressed = yButtonNow && !gamepadState.current.yButton;
        
        // Update state
        gamepadState.current.dpadUp = dpadUpNow;
        gamepadState.current.dpadDown = dpadDownNow;
        gamepadState.current.dpadLeft = dpadLeftNow;
        gamepadState.current.dpadRight = dpadRightNow;
        gamepadState.current.aButton = aButtonNow;
        gamepadState.current.yButton = yButtonNow;
        
        // Y button closes menu
        if (yButtonPressed) {
          onClose();
          return;
        }
        
        // Navigate menu items with D-pad up/down
        if (dpadUpPressed) {
          setSelectedIndex(prev => Math.max(0, prev - 1));
        }
        if (dpadDownPressed) {
          setSelectedIndex(prev => Math.min(menuItems.length - 1, prev + 1));
        }
        
        // Adjust sliders with D-pad left/right
        if (selectedIndex === 0) { // Turn Sensitivity
          if (dpadLeftPressed) {
            setTurnSensitivity(prev => Math.max(0.5, prev - 0.1));
          }
          if (dpadRightPressed) {
            setTurnSensitivity(prev => Math.min(3.0, prev + 0.1));
          }
        } else if (selectedIndex === 1) { // Camera Distance
          if (dpadLeftPressed) {
            setCameraDistance(prev => Math.max(20, prev - 5));
          }
          if (dpadRightPressed) {
            setCameraDistance(prev => Math.min(100, prev + 5));
          }
        } else if (selectedIndex === 2) { // Camera Height
          if (dpadLeftPressed) {
            setCameraHeight(prev => Math.max(5, prev - 2));
          }
          if (dpadRightPressed) {
            setCameraHeight(prev => Math.min(30, prev + 2));
          }
        }
        
        // A button activates selected item OR simulates click at cursor position
        if (aButtonPressed) {
          console.log('A button pressed!');
          // Get current cursor position from ref
          const currentX = cursorPosRef.current.x;
          const currentY = cursorPosRef.current.y;
          console.log('Cursor position:', currentX, currentY);
          
          // Try to click element at cursor position first
          const elementsAtCursor = document.elementsFromPoint(currentX, currentY);
          // Filter out cursor elements
          const filteredElements = elementsAtCursor.filter(e => 
            !e.classList.contains('controller-cursor') && 
            !e.closest('.controller-cursor')
          );
          
          console.log('Elements for click:', filteredElements.map(e => e.tagName));
          let clickHandled = false;
          
          for (const elem of filteredElements) {
            if (elem.tagName === 'BUTTON' || elem.tagName === 'INPUT' || elem.onclick) {
              console.log('Clicking element:', elem.tagName, elem.textContent?.substring(0, 20));
              // Create and dispatch a proper click event
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: currentX,
                clientY: currentY
              });
              elem.dispatchEvent(clickEvent);
              clickHandled = true;
              
              // Also trigger mousedown and mouseup for better compatibility
              const downEvent = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: currentX,
                clientY: currentY
              });
              const upEvent = new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: currentX,
                clientY: currentY
              });
              elem.dispatchEvent(downEvent);
              elem.dispatchEvent(upEvent);
              break;
            }
          }
          
          console.log('Click handled:', clickHandled);
          
          // If no clickable element found, use D-pad navigation
          if (!clickHandled) {
            if (selectedIndex === 3) { // Save
              onSave({ turnSensitivity, cameraDistance, cameraHeight });
            } else if (selectedIndex === 4) { // Close
              onClose();
            }
          }
        }
      } catch {}
    }, 50); // Poll 20 times per second
    
    return () => clearInterval(pollInterval);
  }, [isOpen, selectedIndex, turnSensitivity, cameraDistance, cameraHeight, onClose, onSave, menuItems.length, cursorPos.x, cursorPos.y]);
  
  // Separate effect for hover detection - runs on cursor position change
  useEffect(() => {
    if (!isOpen) return;
    
    const updateHover = () => {
      try {
        const elementsAtCursor = document.elementsFromPoint(cursorPos.x, cursorPos.y);
        // Filter out cursor elements
        const filteredElements = elementsAtCursor.filter(e => 
          !e.classList.contains('controller-cursor') && 
          !e.closest('.controller-cursor')
        );
        
        console.log('Elements at cursor:', filteredElements.map(e => e.tagName + (e.className ? '.' + e.className : '')));
        
        let hoveredElement = null;
        let menuIndex = -1;
        
        for (const elem of filteredElements) {
          // Check for menu items with data-menu-index (on element or parent)
          let currentElem = elem;
          while (currentElem && currentElem !== document.body) {
            const dataIndex = currentElem.getAttribute('data-menu-index');
            if (dataIndex !== null) {
              hoveredElement = currentElem;
              menuIndex = parseInt(dataIndex);
              console.log('Found menu item with index:', menuIndex);
              break;
            }
            currentElem = currentElem.parentElement;
          }
          
          if (menuIndex !== -1) break;
          
          // Check for divs with padding (our slider containers), buttons, inputs, labels
          if (elem.tagName === 'BUTTON' || 
              elem.tagName === 'INPUT' || 
              elem.tagName === 'LABEL' || 
              elem.style.cursor === 'pointer' ||
              elem.onclick || 
              (elem.tagName === 'DIV' && elem.style.padding)) {
            hoveredElement = elem;
            console.log('Found hoverable element:', elem.tagName, elem.textContent?.substring(0, 20));
            break;
          }
        }
        
        // Update selectedIndex directly for both mouse and controller cursor
        // This ensures hover works for controller cursor since React synthetic events won't fire from dispatched events
        if (menuIndex !== -1) {
          console.log('[Hover] Setting selectedIndex to:', menuIndex);
          setSelectedIndex(menuIndex);
        } else if (!hoveredElement || hoveredElement.tagName !== 'INPUT') {
          // Don't reset if hovering over input (slider), only reset when truly not on any menu item
          console.log('[Hover] Resetting selectedIndex to -1');
          setSelectedIndex(-1);
        }
        
        // Trigger mouseenter/mouseleave events for hover animations
        if (hoveredElement !== lastHoveredElement.current) {
          // Always fire leave event first if there was a previous element
          if (lastHoveredElement.current) {
            console.log('Leaving element:', lastHoveredElement.current.tagName);
            
            // Fire mouseleave with all necessary event properties
            const leaveEvent = new MouseEvent('mouseleave', { 
              bubbles: false,  // mouseleave doesn't bubble
              cancelable: false,
              clientX: cursorPos.x,
              clientY: cursorPos.y,
              view: window
            });
            lastHoveredElement.current.dispatchEvent(leaveEvent);
            
            // Also fire mouseout for better compatibility (does bubble)
            const outEvent = new MouseEvent('mouseout', { 
              bubbles: true, 
              cancelable: true,
              clientX: cursorPos.x,
              clientY: cursorPos.y,
              view: window
            });
            lastHoveredElement.current.dispatchEvent(outEvent);
          }
          
          // Then fire enter event for new element
          if (hoveredElement) {
            console.log('Entering element:', hoveredElement.tagName);
            
            // Fire mouseenter with all necessary event properties
            const enterEvent = new MouseEvent('mouseenter', { 
              bubbles: false,  // mouseenter doesn't bubble
              cancelable: false,
              clientX: cursorPos.x,
              clientY: cursorPos.y,
              view: window
            });
            hoveredElement.dispatchEvent(enterEvent);
            
            // Also dispatch mouseover for additional compatibility (does bubble)
            const overEvent = new MouseEvent('mouseover', { 
              bubbles: true, 
              cancelable: true,
              clientX: cursorPos.x,
              clientY: cursorPos.y,
              view: window
            });
            hoveredElement.dispatchEvent(overEvent);
          }
          
          lastHoveredElement.current = hoveredElement;
        }
      } catch (err) {
        console.error('Hover update error:', err);
      }
    };
    
    updateHover();
  }, [isOpen, cursorPos.x, cursorPos.y]);
  
  if (!isOpen) return null;
  
  // Dim menu when adjusting camera settings (distance or height selected)
  const isAdjustingCamera = selectedIndex === 1 || selectedIndex === 2;
  console.log('[Settings Menu] selectedIndex:', selectedIndex, 'isAdjustingCamera:', isAdjustingCamera);
  
  return (
    <>
    {/* Full screen overlay to hide real cursor only when using controller */}
    {usingController && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        cursor: 'none', // Hide real cursor
        pointerEvents: 'none' // Don't block clicks
      }} />
    )}
    
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: isAdjustingCamera ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.75)', // Much more transparent when adjusting camera
      border: '3px solid #00ff88',
      borderRadius: '16px',
      padding: '30px',
      zIndex: 10000,
      minWidth: '400px',
      fontFamily: 'monospace',
      color: '#00ff88',
      boxShadow: '0 0 40px rgba(0, 255, 136, 0.5)',
      transition: 'background-color 0.2s ease' // Smooth transition
    }}>
      <h2 style={{ 
        textAlign: 'center', 
        marginBottom: '25px', 
        fontSize: '28px',
        textTransform: 'uppercase',
        letterSpacing: '2px'
      }}>Settings</h2>
      
      {/* Turn Sensitivity */}
      <div 
        data-menu-index="0"
        onMouseEnter={() => !usingController && setSelectedIndex(0)}
        onMouseLeave={() => !usingController && setSelectedIndex(-1)}
        style={{
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: selectedIndex === 0 ? 'rgba(0, 255, 136, 0.2)' : 'transparent',
        borderRadius: '8px',
        border: selectedIndex === 0 ? '2px solid #00ff88' : '2px solid transparent',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ marginBottom: '8px', fontSize: '18px' }}>Turn Sensitivity: {turnSensitivity.toFixed(1)}</div>
        <input
          type="range"
          min="0.5"
          max="3.0"
          step="0.1"
          value={turnSensitivity}
          onChange={(e) => setTurnSensitivity(parseFloat(e.target.value))}
          style={{
            width: '100%',
            cursor: 'pointer',
            accentColor: '#00ff88'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>0.5</span>
          <span>3.0</span>
        </div>
      </div>
      
      {/* Camera Distance */}
      <div 
        data-menu-index="1"
        onMouseEnter={() => !usingController && setSelectedIndex(1)}
        onMouseLeave={() => !usingController && setSelectedIndex(-1)}
        style={{
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: selectedIndex === 1 ? 'rgba(0, 255, 136, 0.2)' : 'transparent',
        borderRadius: '8px',
        border: selectedIndex === 1 ? '2px solid #00ff88' : '2px solid transparent',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ marginBottom: '8px', fontSize: '18px' }}>Camera Distance: {cameraDistance}</div>
        <input
          type="range"
          min="20"
          max="100"
          step="5"
          value={cameraDistance}
          onChange={(e) => setCameraDistance(parseInt(e.target.value))}
          style={{
            width: '100%',
            cursor: 'pointer',
            accentColor: '#00ff88'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>20</span>
          <span>100</span>
        </div>
      </div>
      
      {/* Camera Height */}
      <div 
        data-menu-index="2"
        onMouseEnter={() => !usingController && setSelectedIndex(2)}
        onMouseLeave={() => !usingController && setSelectedIndex(-1)}
        style={{
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: selectedIndex === 2 ? 'rgba(0, 255, 136, 0.2)' : 'transparent',
        borderRadius: '8px',
        border: selectedIndex === 2 ? '2px solid #00ff88' : '2px solid transparent',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ marginBottom: '8px', fontSize: '18px' }}>Camera Height: {cameraHeight}</div>
        <input
          type="range"
          min="5"
          max="30"
          step="2"
          value={cameraHeight}
          onChange={(e) => setCameraHeight(parseInt(e.target.value))}
          style={{
            width: '100%',
            cursor: 'pointer',
            accentColor: '#00ff88'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>5</span>
          <span>30</span>
        </div>
      </div>
      
      {/* Save Button */}
      <button
        onClick={() => onSave({ turnSensitivity, cameraDistance, cameraHeight })}
        onMouseEnter={(e) => {
          if (selectedIndex !== 3) {
            e.currentTarget.style.backgroundColor = 'rgba(0, 255, 136, 0.7)'; // Much brighter
            e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 255, 136, 1), inset 0 0 20px rgba(0, 255, 136, 0.5)'; // Stronger glow
            e.currentTarget.style.color = '#000'; // Black text on bright background
          }
        }}
        onMouseLeave={(e) => {
          if (selectedIndex !== 3) {
            e.currentTarget.style.backgroundColor = 'rgba(0, 255, 136, 0.2)';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.color = '#00ff88'; // Back to green text
          }
        }}
        style={{
          width: '100%',
          padding: '15px',
          marginBottom: '10px',
          backgroundColor: selectedIndex === 3 ? '#00ff88' : 'rgba(0, 255, 136, 0.2)',
          color: selectedIndex === 3 ? '#000' : '#00ff88',
          border: selectedIndex === 3 ? '2px solid #00ff88' : '2px solid #00ff88',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          transition: 'all 0.2s ease',
          boxShadow: selectedIndex === 3 ? '0 0 20px rgba(0, 255, 136, 0.8)' : 'none'
        }}
      >
        Save Settings
      </button>
      
      {/* Close Button */}
      <button
        onClick={onClose}
        onMouseEnter={(e) => {
          if (selectedIndex !== 4) {
            e.currentTarget.style.backgroundColor = 'rgba(255, 68, 68, 0.7)'; // Much brighter
            e.currentTarget.style.boxShadow = '0 0 30px rgba(255, 68, 68, 1), inset 0 0 20px rgba(255, 68, 68, 0.5)'; // Stronger glow
            e.currentTarget.style.color = '#fff'; // White text on bright background
          }
        }}
        onMouseLeave={(e) => {
          if (selectedIndex !== 4) {
            e.currentTarget.style.backgroundColor = 'rgba(255, 68, 68, 0.2)';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.color = '#ff4444'; // Back to red text
          }
        }}
        style={{
          width: '100%',
          padding: '15px',
          backgroundColor: selectedIndex === 4 ? '#ff4444' : 'rgba(255, 68, 68, 0.2)',
          color: selectedIndex === 4 ? '#fff' : '#ff4444',
          border: selectedIndex === 4 ? '2px solid #ff4444' : '2px solid #ff4444',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          transition: 'all 0.2s ease',
          boxShadow: selectedIndex === 4 ? '0 0 20px rgba(255, 68, 68, 0.8)' : 'none'
        }}
      >
        Close
      </button>
      
      {/* Controller Hint */}
      <div style={{
        marginTop: '20px',
        padding: '10px',
        textAlign: 'center',
        fontSize: '14px',
        color: '#888',
        borderTop: '1px solid #333'
      }}>
        <div style={{ marginTop: '10px' }}>Press <strong style={{ color: '#00ff88' }}>Y</strong> to close menu</div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}} />
    </div>
    
    {/* Controller Cursor - White glowing circle (only visible when using controller) */}
    {usingController && (
      <div className="controller-cursor" style={{
        position: 'fixed',
        left: cursorPos.x,
        top: cursorPos.y,
        width: '40px',
        height: '40px',
        pointerEvents: 'none',
        zIndex: 20001, // Above menu
        transform: 'translate(-50%, -50%)'
      }}>
        {/* Outer glow */}
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.4) 50%, transparent 70%)',
          boxShadow: '0 0 20px rgba(255,255,255,0.8), 0 0 40px rgba(255,255,255,0.4)',
          animation: 'pulse 1.5s ease-in-out infinite'
        }} />
        {/* White ring */}
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.9)',
          boxSizing: 'border-box'
        }} />
        {/* Center dot */}
        <div style={{
          position: 'absolute',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'white',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 4px rgba(255,255,255,0.8)'
        }} />
      </div>
    )}
    </>
  );
}

// CRITICAL: Define RemoteAvatarGroup OUTSIDE main component to prevent recreation on every render
// If defined inside, React sees it as a new component type and remounts avatars, resetting animation
function RemoteAvatarGroup({ side, base, children }){
  const gref = useRef();
  const pos = useRef({ x: base.x, z: base.z });
  const target = useRef({ x: base.x, z: base.z, has: false });
  const yawRef = useRef(0);
  const yawTargetRef = useRef(null);
  const lastTargetPos = useRef({ x: base.x, z: base.z });
  const lastMoveAtRef = useRef(0);
  const lastMsgAtRef = useRef(0);
  const lastRunRef = useRef(false);
  const lastJumpRef = useRef(false);
  const lastLiftRef = useRef(0);
  const [isWalking, setIsWalking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  const [isJumpingRemote, setIsJumpingRemote] = useState(false);
  const [liftRemote, setLiftRemote] = useState(0);
  const prevYawRef = useRef(0);
  const prevYawTsRef = useRef(0);
  const norm = (a)=>{ let v=(a+Math.PI)%(2*Math.PI); if(v<0) v+=2*Math.PI; return v-Math.PI; };
  const unwrapToNear = (wrapped, near)=>{ const w = norm(wrapped); const k = Math.round((near - w)/(2*Math.PI)); return w + k*2*Math.PI; };
  
  useLayoutEffect(() => {
    try {
      const msg = window.__CF_REMOTE_AVATAR__;
      if (msg && msg.side === side && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        pos.current = { x: Number(msg.x), z: Number(msg.z) };
        if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
          const yw = norm(Number(msg.yaw));
          yawRef.current = yw; yawTargetRef.current = yw;
          prevYawRef.current = yw; prevYawTsRef.current = performance.now();
        }
        if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) {
          lastLiftRef.current = Number(msg.lift);
          setLiftRemote(Number(msg.lift));
        }
      }
    } catch {}
  }, [side, base.x, base.z]);
  
  useFrame((_, delta) => {
    try {
      const msg = window.__CF_REMOTE_AVATAR__;
      if (msg && msg.side === side) {
        const tx = Number(msg.x); const tz = Number(msg.z);
        if (Number.isFinite(tx) && Number.isFinite(tz)) {
          target.current = { x: tx, z: tz, has: true };
          const dxT = tx - lastTargetPos.current.x;
          const dzT = tz - lastTargetPos.current.z;
          const moved2 = dxT*dxT + dzT*dzT;
          if (moved2 > 1e-6) {
            lastMoveAtRef.current = performance.now();
            lastTargetPos.current.x = tx; lastTargetPos.current.z = tz;
          }
          lastMsgAtRef.current = performance.now();
        }
        if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
          const prev = (typeof yawTargetRef.current === 'number') ? yawTargetRef.current : yawRef.current || 0;
          yawTargetRef.current = unwrapToNear(Number(msg.yaw), prev);
        }
        if (typeof msg.run === 'boolean') lastRunRef.current = !!msg.run;
        if (typeof msg.isJumping === 'boolean') lastJumpRef.current = !!msg.isJumping;
        if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) lastLiftRef.current = Number(msg.lift);
      }
      const alpha = Math.min(1, delta * 10.0);
      const tx = target.current.has ? target.current.x : pos.current.x;
      const tz = target.current.has ? target.current.z : pos.current.z;
      pos.current.x += (tx - pos.current.x) * alpha;
      pos.current.z += (tz - pos.current.z) * alpha;
      if (typeof yawTargetRef.current === 'number') {
        const cur = yawRef.current;
        const tgt = yawTargetRef.current;
        const rotAlpha = Math.min(1, delta * 10.0);
        yawRef.current = cur + (tgt - cur) * rotAlpha;
      }
      if (gref.current) {
        gref.current.position.set(pos.current.x, 0, pos.current.z);
        gref.current.rotation.y = norm(yawRef.current || 0);
      }
      const now = performance.now();
      const running = !!lastRunRef.current;
      const WALK_GRACE_MS = 85;
      const walking = running || ((now - lastMoveAtRef.current) < WALK_GRACE_MS);
      if (walking !== isWalking) setIsWalking(walking);
      if (running !== isRunning) setIsRunning(running);
      const newJump = !!lastJumpRef.current;
      const newLift = Number(lastLiftRef.current) || 0;
      if (newJump !== isJumpingRemote) setIsJumpingRemote(newJump);
      if (Math.abs(newLift - liftRemote) > 0.01) setLiftRemote(newLift);
      const prevTs = prevYawTsRef.current || now - Math.max(1, delta*1000);
      const dtMs = Math.max(1, now - prevTs);
      const dtSec = dtMs / 1000;
      const yawVel = (yawRef.current - prevYawRef.current) / dtSec;
      const TURN_THRESH = 0.5;
      const turningL = !walking && (yawVel > TURN_THRESH);
      const turningR = !walking && (yawVel < -TURN_THRESH);
      if (turningL !== isTurningLeft) setIsTurningLeft(turningL);
      if (turningR !== isTurningRight) setIsTurningRight(turningR);
      prevYawRef.current = yawRef.current;
      prevYawTsRef.current = now;
    } catch {}
  });
  
  const prevPropsRef = useRef({});
  const clonedChildrenRef = useRef(null);
  const currentProps = { isWalking, isRunning, isTurningLeft, isTurningRight, isJumpingRemote, liftRemote };
  const propsChanged = Object.keys(currentProps).some(key => prevPropsRef.current[key] !== currentProps[key]);
  
  if (propsChanged || !clonedChildrenRef.current) {
    prevPropsRef.current = currentProps;
    clonedChildrenRef.current = React.Children.map(children, (child, idx) => {
      if (idx === 0 && React.isValidElement(child)) {
        return React.cloneElement(child, { 
          isWalking, isRunning, isTurningLeft, isTurningRight, 
          isJumping: isJumpingRemote, extraLiftY: liftRemote
        });
      } else if (idx === 1 && React.isValidElement(child)) {
        if (child.props && child.props.position) {
          const [x, y, z] = child.props.position;
          return React.cloneElement(child, {
            ...child.props,
            position: [x, y + liftRemote, z]
          });
        }
      }
      return child;
    });
  }
  
  return <group ref={gref}>{clonedChildrenRef.current}</group>;
}

function ConnectFour3DView({ board, lastMove, colors, onSelectColumn, flip180 = false, myCharacterId = 'astronaut', oppCharacterId = 'alien', onAvatarMove, myName = 'You', oppName = 'Opponent' }) {
  // Clean up cached world state on mount to ensure stability across hot reloads
  useEffect(() => {
    try {
      // Clear table rect cache to force fresh recalculation (prevents stale invisible collision boxes)
      if (window.__CF_TABLE_RECT__) {
        delete window.__CF_TABLE_RECT__;
      }
      // DON'T reset lift values - let them persist so opponents stay at correct height on hot reload
    } catch {}
  }, []);
  
  // Function to actually leave the game
  const leaveGame = useCallback(() => {
    try {
      // Trigger the game:leaveRequested event that parent components can listen to
      window.dispatchEvent(new CustomEvent('game:leaveRequested'));
      
      // Try to programmatically click the Leave button in GameBoard if it exists
      setTimeout(() => {
        const leaveButton = document.querySelector('.btn-outline-secondary');
        if (leaveButton && leaveButton.textContent.includes('Leave')) {
          leaveButton.click();
        }
      }, 100);
    } catch (e) {
      console.error('Failed to leave game:', e);
    }
  }, []);
  
  // Use baked constants for avatar X offsets
  const xFront = AVATAR_X_FRONT;
  const xBack = AVATAR_X_BACK;

  // Define a simple rectangular obstacle for the wooden table top to prevent walking through it
  const tableRect = useMemo(() => {
    // Prefer the actual FBX footprint if available (published by WoodenTable loader)
    try {
      const r = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
      if (r && Number.isFinite(r.minX) && Number.isFinite(r.maxX) && Number.isFinite(r.minZ) && Number.isFinite(r.maxZ)) {
        return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      }
    } catch {}
    // Fallback to baked dimensions
    const fw = COLS * (CELL + GAP) - GAP + 0.6;
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const topW = Math.max(fw + 4.0, 12.0);
    const topD = Math.max(fh + 6.0, 16.0);
    return { minX: -topW / 2, maxX: topW / 2, minZ: -topD / 2, maxZ: topD / 2 };
  }, []);

  // Baked-in transform (scale override) + dynamic facing toward camera
  const effScaleMulOverride = AVATAR_BAKED_SCALE_MUL;
  // Screen size first (used for camera defaults)
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  // Camera side: Player 1 sees from +Z (front), Player 2 from -Z (back)
  // Start 75% farther back so it loads more zoomed out
  const camPosFront = isNarrow ? [0, 13.0, 31.5] : [0, 10.5, 25.4];
  const camPosBack  = isNarrow ? [0, 13.0,-31.5] : [0, 10.5,-25.4];
  const camPos  = flip180 ? camPosBack : camPosFront;
  const camFov  = isNarrow ? 54 : 40;
  // UI toggles
  const [showSelf, setShowSelf] = useState(false);
  const [moveEnabled, setMoveEnabled] = useState(true);
  const [isDraggingCube, setIsDraggingCube] = useState(false); // Track if user is dragging an object
  
  // Store drag state in window global so PlayerMover can check it
  React.useEffect(() => {
    window.__CF_IS_DRAGGING_CUBE__ = isDraggingCube;
    
    // Provide callback for CustomPlacedModel to set drag state
    window.__CF_SET_DRAGGING_CUBE__ = setIsDraggingCube;
    
    return () => {
      delete window.__CF_SET_DRAGGING_CUBE__;
    };
  }, [isDraggingCube]);
  
  const [clickMove, setClickMove] = useState(false);
  const [fullCamera, setFullCamera] = useState(false);
  const [followCam, setFollowCam] = useState(false);
  const [followSeed, setFollowSeed] = useState(0);
  
  // Settings menu state
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [saveNotification, setSaveNotification] = useState(false);
  const [gameSettings, setGameSettings] = useState({
    turnSensitivity: 1.5,
    cameraDistance: 50,
    cameraHeight: 15
  });
  const [liveSettings, setLiveSettings] = useState({
    turnSensitivity: 1.5,
    cameraDistance: 50,
    cameraHeight: 15
  });
  const startButtonRef = useRef({ pressed: false });
  
  // Rocket camera following
  const [followRocket, setFollowRocket] = useState(false);
  const rocketPositionRef = useRef(null);
  
  // Opponent disconnect detection
  const [opponentConnected, setOpponentConnected] = useState(true);
  const opponentConnectedRef = useRef(true); // Ref to track state without causing useEffect re-runs
  const [disconnectNotification, setDisconnectNotification] = useState(null);
  const [reconnectNotification, setReconnectNotification] = useState(null);
  const lastOpponentActivityRef = useRef(Date.now());
  const gameWasActiveRef = useRef(false); // Track if game was ever active (for fallback detection)
  
  // Refs to store latest position broadcast data (avoids dependency issues)
  const positionBroadcastRef = useRef({ onAvatarMove: null, flip180: false });
  
  // Listen for server disconnect events
  useEffect(() => {
    const handlePlayerLeft = (event) => {
      try {
        const data = event.detail;
        // When server notifies us the opponent left
        if (data && data.type === 'playerLeft') {
          gameWasActiveRef.current = true; // Mark that game events are active
          opponentConnectedRef.current = false;
          setOpponentConnected(false);
          setDisconnectNotification(`${oppName} has logged out`);
          setReconnectNotification(null); // Clear any reconnect message
          // Clear notification after 5 seconds
          setTimeout(() => setDisconnectNotification(null), 5000);
          
          // Clear remote avatar data to prevent fallback from seeing stale position
          try {
            if (window.__CF_REMOTE_AVATAR__) {
              delete window.__CF_REMOTE_AVATAR__.x;
              delete window.__CF_REMOTE_AVATAR__.z;
            }
          } catch {}
        }
      } catch {}
    };
    
    const handlePlayerBack = (event) => {
      try {
        const data = event.detail;
        // When opponent reconnects
        if (data && data.type === 'playerBack') {
          gameWasActiveRef.current = true; // Mark that game events are active
          opponentConnectedRef.current = true;
          setOpponentConnected(true);
          setDisconnectNotification(null); // Clear disconnect message
          setReconnectNotification(`${oppName} has reconnected`);
          // Clear notification after 4 seconds
          setTimeout(() => setReconnectNotification(null), 4000);
          
          // CRITICAL: Broadcast our current position to the reconnected opponent
          // This ensures they see us at our Connect Four spot immediately
          // Multiple broadcasts with delays to ensure delivery
          const broadcastPosition = () => {
            try {
              const { onAvatarMove, flip180 } = positionBroadcastRef.current;
              if (!onAvatarMove) return;
              
              const youAreP2 = !!flip180;
              const la = window.__CF_LOCAL_AVATAR__ || {};
              
              if (la.x !== undefined && la.z !== undefined) {
                const playerNum = youAreP2 ? 2 : 1;
                const run = !!la.isRunning;
                const isJumping = !!la.isJumping;
                const lift = typeof la.lift === 'number' ? la.lift : undefined;
                const yaw = typeof la.yaw === 'number' ? la.yaw : 0;
                
                // Send position update to reconnected opponent
                onAvatarMove({ player: playerNum, x: la.x, z: la.z, yaw, run, isJumping, lift });
              } else {
                // If no local avatar position is set, use base player position
                const dist = 75;
                const baseX = youAreP2 ? -dist : dist;
                const baseZ = youAreP2 ? dist : -dist;
                const playerNum = youAreP2 ? 2 : 1;
                onAvatarMove({ player: playerNum, x: baseX, z: baseZ, yaw: 0, run: false, isJumping: false, lift: 0 });
              }
            } catch (err) {
              console.warn('Failed to broadcast position on reconnect:', err);
            }
          };
          
          // Broadcast multiple times to ensure it gets through
          setTimeout(broadcastPosition, 100);
          setTimeout(broadcastPosition, 300);
          setTimeout(broadcastPosition, 600);
        }
      } catch {}
    };
    
    // Listen for websocket messages dispatched as custom events
    window.addEventListener('cf:playerLeft', handlePlayerLeft);
    window.addEventListener('cf:playerBack', handlePlayerBack);
    
    // Listen for initial opponent position ready event
    const handleOpponentPositionReady = () => {
      try {
        // Opponent is in the game - they'll send their position via broadcasts
        // No need to do anything here - just rely on avatarUpdate messages
      } catch {}
    };
    window.addEventListener('cf:opponentPositionReady', handleOpponentPositionReady);
    
    return () => {
      window.removeEventListener('cf:playerLeft', handlePlayerLeft);
      window.removeEventListener('cf:playerBack', handlePlayerBack);
      window.removeEventListener('cf:opponentPositionReady', handleOpponentPositionReady);
    };
  }, [oppName]);
  
  // Detect when game becomes active (board has pieces or lastMove exists)
  // This enables disconnect/reconnect tracking
  useEffect(() => {
    if (!gameWasActiveRef.current && board && board.length > 0) {
      // Check if board has any pieces (game has started)
      const hasPieces = board.some(row => row && row.some(cell => cell !== null && cell !== 0));
      if (hasPieces || lastMove) {
        gameWasActiveRef.current = true;
      }
    }
  }, [board, lastMove]);
  
  // Fallback: Also check for no activity timeout (in case events don't fire)
  // Only runs if game was previously active (prevents false positives during setup)
  useEffect(() => {
    const DISCONNECT_TIMEOUT = 15000; // 15 seconds of no activity = disconnected
    
    const checkInterval = setInterval(() => {
      // Skip fallback detection if game has never been active
      if (!gameWasActiveRef.current) return;
      
      try {
        const msg = window.__CF_REMOTE_AVATAR__;
        if (msg && (msg.x !== undefined || msg.z !== undefined)) {
          // If we received a message recently, update last activity
          lastOpponentActivityRef.current = Date.now();
          if (!opponentConnectedRef.current) {
            // Restore connection state silently (no notification)
            // This handles the case where cf:playerBack event didn't fire
            opponentConnectedRef.current = true;
            setOpponentConnected(true);
            setDisconnectNotification(null);
            // Note: Don't show reconnect notification here - only from cf:playerBack events
            // This prevents false "reconnected" when toggling character visibility
          }
        } else {
          // Check if timeout exceeded - detect disconnects only
          const now = Date.now();
          const timeSinceActivity = now - lastOpponentActivityRef.current;
          if (timeSinceActivity > DISCONNECT_TIMEOUT && opponentConnectedRef.current) {
            opponentConnectedRef.current = false;
            setOpponentConnected(false);
            setReconnectNotification(null);
            setDisconnectNotification(`${oppName} has logged out`);
            setTimeout(() => setDisconnectNotification(null), 5000);
            
            // Clear remote avatar data to prevent it from being reused
            try {
              if (window.__CF_REMOTE_AVATAR__) {
                delete window.__CF_REMOTE_AVATAR__.x;
                delete window.__CF_REMOTE_AVATAR__.z;
              }
            } catch {}
          }
        }
      } catch {}
    }, 2000);
    
    return () => clearInterval(checkInterval);
  }, [oppName]);
  
  // Poll gamepad for Start button (menu button with 3 lines)
  useEffect(() => {
    const pollInterval = setInterval(() => {
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[0];
        
        if (gamepad) {
          // Button 9 = Start button (3 lines/menu button)
          const startButtonNow = gamepad.buttons[9]?.pressed || false;
          
          // Detect button press (not hold)
          if (startButtonNow && !startButtonRef.current.pressed) {
            // Toggle settings menu
            setSettingsMenuOpen(prev => !prev);
          }
          
          startButtonRef.current.pressed = startButtonNow;
        }
      } catch {}
    }, 50); // Poll 20 times per second
    
    return () => clearInterval(pollInterval);
  }, []);
  
  // Handle settings save
  const handleSettingsSave = useCallback((newSettings) => {
    setGameSettings(newSettings);
    setLiveSettings(newSettings);
    // Don't close menu - let user close it manually
    // Show brief notification
    setSaveNotification(true);
    setTimeout(() => setSaveNotification(false), 2000); // Fade after 2 seconds
  }, []);
  
  // Handle live settings update (while adjusting sliders)
  const handleLiveSettingsUpdate = useCallback((newSettings) => {
    setLiveSettings(newSettings);
  }, []);
  
  // Hide footer when game board is active (has pieces)
  useEffect(() => {
    const gameHasStarted = board && board.some(row => row.some(cell => cell !== 0));
    if (gameHasStarted) {
      document.body.classList.add('hide-footer');
      // Also set --footer-h to 0 so UI elements that use it adjust
      document.documentElement.style.setProperty('--footer-h', '0px');
    } else {
      document.body.classList.remove('hide-footer');
      // Footer will restore its own height when visible
    }
    return () => {
      document.body.classList.remove('hide-footer');
    };
  }, [board]);
  
  // Decorative stairs UI state
  const [showEditMenu, setShowEditMenu] = useState(false); // Toggle for edit menu visibility
  const [showCollisionMeshes, setShowCollisionMeshes] = useState(false); // Toggle for collision box visibility
  const [showChatUI, setShowChatUI] = useState(true); // Toggle for chat UI visibility (D-pad right)
  
  // Audio Visualizer state
  const [audioVisualizers, setAudioVisualizers] = useState(() => {
    // Try to load from server first (if available from startGame message)
    try {
      if (window.__CF_REMOTE_VISUALIZERS__ && Array.isArray(window.__CF_REMOTE_VISUALIZERS__)) {
        return window.__CF_REMOTE_VISUALIZERS__;
      }
      // Fallback to localStorage
      const saved = localStorage.getItem('cf3d_audio_visualizers');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      console.warn('Failed to load visualizers:', err);
      return [];
    }
  });
  const [selectedVisualizer, setSelectedVisualizer] = useState(null);
  const [availableSounds, setAvailableSounds] = useState(['rocket_ambience.mp3']); // List of available sound files
  const [customModels, setCustomModels] = useState([]); // List of uploaded custom models
  const [availableModels, setAvailableModels] = useState([]); // List of all available models from props folder
  const [selectedModelToLoad, setSelectedModelToLoad] = useState(null); // Selected model from dropdown
  const [activeEditorTab, setActiveEditorTab] = useState('objects'); // Active tab in editor panel
  
  // Controller navigation state for editor menu
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0); // Which section is selected
  const [isInSection, setIsInSection] = useState(false); // Whether we're inside a section navigating items
  const [selectedItemIndex, setSelectedItemIndex] = useState(0); // Which item in the section is selected
  const [isInSubMenu, setIsInSubMenu] = useState(false); // Whether we're inside a placed object's sub-menu
  const [selectedSubItemIndex, setSelectedSubItemIndex] = useState(0); // Which button/toggle in the sub-menu is selected
  
  // Scroll selected placed object into view when navigating with controller
  useEffect(() => {
    if (isInSection && selectedSectionIndex === 0 && selectedItemIndex >= 4) {
      // This is a placed object (items 4+)
      const element = document.querySelector(`[data-placed-object-index="${selectedItemIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedItemIndex, isInSection, selectedSectionIndex]);
  
  // Scroll selected section into view when navigating main menu with controller
  useEffect(() => {
    if (!isInSection && showEditMenu) {
      // When not inside a section, scroll the section itself into view
      const element = document.querySelector(`[data-section-index="${selectedSectionIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedSectionIndex, isInSection, showEditMenu]);
  
  // Load available models from server on mount
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          console.log(`Loaded ${data.models.length} available models from props folder`);
        }
      })
      .catch(err => console.error('Failed to load models:', err));
  }, []);
  
  // Load available sound files on mount
  useEffect(() => {
    fetch('/api/sounds')
      .then(res => res.json())
      .then(data => {
        if (data.sounds && data.sounds.length > 0) {
          setAvailableSounds(data.sounds);
        }
      })
      .catch(err => console.error('Failed to load sounds:', err));
  }, []);
  
  // Load custom models on mount
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setCustomModels(data.models);
        }
      })
      .catch(err => console.error('Failed to load custom models:', err));
  }, []);
  
  // ===== CUBE PLACEMENT SYSTEM =====
  const [placedCubes, setPlacedCubes] = useState(() => {
    // Try to load from server first (if available from startGame message)
    try {
      if (window.__CF_REMOTE_CUBES__ && Array.isArray(window.__CF_REMOTE_CUBES__)) {
        return window.__CF_REMOTE_CUBES__.map(cube => ({
          ...cube,
          modelType: cube.modelType || 'none' // Add default modelType for backward compatibility
        }));
      }
    } catch {}
    // Fallback to localStorage for backwards compatibility
    try {
      const saved = localStorage.getItem('cf3d_placed_cubes');
      const cubes = saved ? JSON.parse(saved) : [];
      return cubes.map(cube => ({
        ...cube,
        modelType: cube.modelType || 'none' // Add default modelType for backward compatibility
      }));
    } catch {
      return [];
    }
  });
  const [cubeEditMode, setCubeEditMode] = useState(false); // Enable cube editing
  const [selectedCubeId, setSelectedCubeId] = useState(null); // Currently selected cube
  const [cubeTransformMode, setCubeTransformMode] = useState('translate'); // translate, rotate, scale
  const [cubeDragMode, setCubeDragMode] = useState(false); // Enable free-drag movement
  const [cubeSnap, setCubeSnap] = useState(true);
  const [cubeTranslateSnap, setCubeTranslateSnap] = useState(1.0);
  
  // Terrain sculpting state
  const [sculptMode, setSculptMode] = useState(false); // Enable terrain sculpting
  const [sculptBrushSize, setSculptBrushSize] = useState(5); // Brush radius
  const [sculptStrength, setSculptStrength] = useState(0.5); // How much to raise/lower per scroll
  const [sculptHistory, setSculptHistory] = useState([]); // History of sculpt operations for undo
  const [cubeRotateSnapDeg, setCubeRotateSnapDeg] = useState(15);
  const [cubeScaleSnap, setCubeScaleSnap] = useState(0.1);
  
  // Edge snap confirmation state
  const [snapConfirmDialog, setSnapConfirmDialog] = useState(null); // { cubeId, snapInfo, position }
  const [pendingSnapCubeId, setPendingSnapCubeId] = useState(null); // Track which cube is awaiting snap confirmation
  
  // AI Box editor state
  const [aiBoxEditorOpen, setAIBoxEditorOpen] = useState(false);
  const [aiBoxEditTitle, setAIBoxEditTitle] = useState('');
  const [aiBoxEditPrompt, setAIBoxEditPrompt] = useState('');
  
  // Server restart countdown state (compact - shows in status button)
  const [restartCountdown, setRestartCountdown] = useState(null); // null, 5, 4, 3, 2, 1, 'disconnected', 'reconnecting', 'reconnected'
  const countdownIntervalRef = useRef(null);
  
  // Server status state
  const [showServerStatus, setShowServerStatus] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking'); // 'online', 'offline', 'checking'
  
  // Check server status periodically
  useEffect(() => {
    const checkServer = () => {
      fetch('http://localhost:3002/api/models')
        .then(() => setServerStatus('online'))
        .catch(() => setServerStatus('offline'));
    };
    
    checkServer(); // Check immediately
    const interval = setInterval(checkServer, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  // Open AI Box editor when an AI Box is selected
  useEffect(() => {
    if (selectedCubeId) {
      const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
      if (selectedCube && selectedCube.isAIBox) {
        setAIBoxEditorOpen(true);
        // Auto-enable editing mode and collision boxes when opening editor
        setCubeEditMode(true);
        setShowCollisionMeshes(true);
        // Extract custom title (remove "AI Box #" prefix if exists)
        const label = selectedCube.aiBoxLabel || '';
        const match = label.match(/AI Box #(\d+)(?:\s*-\s*(.+))?/);
        if (match && match[2]) {
          setAIBoxEditTitle(match[2]); // Extract custom title after " - "
        } else {
          setAIBoxEditTitle(''); // No custom title yet
        }
        // Load AI prompt if it exists
        setAIBoxEditPrompt(selectedCube.aiPrompt || '');
      } else {
        setAIBoxEditorOpen(false);
      }
    } else {
      setAIBoxEditorOpen(false);
    }
  }, [selectedCubeId, placedCubes]);

  // Auto-toggle editing mode and collision boxes when edit menu opens/closes
  useEffect(() => {
    if (showEditMenu) {
      setCubeEditMode(true);
      setShowCollisionMeshes(true);
    } else {
      setCubeEditMode(false);
      setShowCollisionMeshes(false);
    }
  }, [showEditMenu]);
  
  // Listen for server restart countdown (broadcast from other player or received via WebSocket)
  useEffect(() => {
    console.log('🔄 [RESTART] Event listener registered for cf:server-restart-countdown');
    
    const handleRestartCountdown = (e) => {
      try {
        console.log('🔄 [RESTART] Event received:', e.detail);
        
        if (e.detail && typeof e.detail.countdown === 'number') {
          console.log('🔄 [RESTART] Starting countdown from:', e.detail.countdown);
          
          // Clear any existing countdown interval
          if (countdownIntervalRef.current) {
            console.log('🔄 [RESTART] Clearing existing interval');
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          
          setRestartCountdown(e.detail.countdown);
          console.log('🔄 [RESTART] Set restartCountdown state to:', e.detail.countdown);
          
          // Start countdown timer
          let count = e.detail.countdown - 1;
          countdownIntervalRef.current = setInterval(() => {
            if (count > 0) {
              setRestartCountdown(count);
              count--;
            } else {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
              setRestartCountdown('disconnected');
              
              // Clean up initiator flag if it exists
              if (window.__CF_RESTART_INITIATOR__) {
                delete window.__CF_RESTART_INITIATOR__;
              }
            }
          }, 1000);
        } else if (e.detail && e.detail.countdown === 'disconnected') {
          setRestartCountdown('disconnected');
        }
      } catch (err) {
        console.error('Failed to handle restart countdown:', err);
      }
    };
    
    window.addEventListener('cf:server-restart-countdown', handleRestartCountdown);
    return () => {
      window.removeEventListener('cf:server-restart-countdown', handleRestartCountdown);
      // Clean up interval on unmount
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);
  
  // Expose test function to window for manual testing
  useEffect(() => {
    window.__CF_TEST_RESTART_COUNTDOWN__ = (countdown = 5) => {
      console.log('🧪 [TEST] Manually triggering countdown:', countdown);
      console.log('🧪 [TEST] Current restartCountdown state:', restartCountdown);
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown } 
      }));
      console.log('🧪 [TEST] Event dispatched successfully');
    };
    
    // Also expose direct state setter for testing
    window.__CF_TEST_SET_COUNTDOWN_STATE__ = (value) => {
      console.log('🧪 [TEST] Directly setting restartCountdown state to:', value);
      setRestartCountdown(value);
    };
    
    return () => {
      delete window.__CF_TEST_RESTART_COUNTDOWN__;
      delete window.__CF_TEST_SET_COUNTDOWN_STATE__;
    };
  }, [restartCountdown]);
  
  // Handle WebSocket reconnection after server restart
  useEffect(() => {
    if (restartCountdown === 'disconnected') {
      // Start checking for reconnection immediately
      let checkInterval;
      const startChecking = () => {
        checkInterval = setInterval(() => {
          // Check if we're reconnected by looking for the global WebSocket ready state
          if (window.__CF_WS_READY__) {
            clearInterval(checkInterval);
            setRestartCountdown('reconnected');
            // Fade away after 2 seconds
            setTimeout(() => setRestartCountdown(null), 2000);
          }
          // If not reconnected, stay on 'disconnected' - keep checking
        }, 500);
      };
      
      // Start checking after a brief delay (server needs time to restart)
      const delayTimer = setTimeout(startChecking, 2000);
      
      return () => {
        clearTimeout(delayTimer);
        if (checkInterval) clearInterval(checkInterval);
      };
    }
  }, [restartCountdown]);
  
  // Listen for controller menu item activation
  useEffect(() => {
    const handleMenuItemActivate = (e) => {
      const { section, item } = e.detail;
      console.log('🎯 EVENT RECEIVED: Menu item activated:', { section, item });
      
      // Section 0 = Object Placer
      if (section === 0) {
        if (item === 0) {
          // Toggle "Enable editing" checkbox - trigger click on the checkbox
          console.log('🎯 Toggling cubeEditMode checkbox');
          const checkbox = document.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.click();
          }
        }
        else if (item === 1) {
          // Cube button - trigger click on the actual button
          console.log('🎯 Clicking Cube button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Cube') || btn.onclick?.toString().includes('box')) {
              btn.click();
              break;
            }
          }
        }
        else if (item === 2) {
          // Sphere button - trigger click on the actual button
          console.log('🎯 Clicking Sphere button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Sphere') || btn.onclick?.toString().includes('sphere')) {
              btn.click();
              break;
            }
          }
        }
        else if (item === 3) {
          // Cylinder button - trigger click on the actual button
          console.log('🎯 Clicking Cylinder button');
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Cylinder') || btn.onclick?.toString().includes('cylinder')) {
              btn.click();
              break;
            }
          }
        }
        else if (item >= 4) {
          // Placed objects - items 4+ select the object (excluding terrain)
          const objIndex = item - 4; // Convert to placed objects array index
          const placedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain);
          if (objIndex < placedObjects.length) {
            const cube = placedObjects[objIndex];
            console.log('🎯 Selecting placed object:', cube.id);
            setSelectedCubeId(cube.id);
          }
        }
      }
      // Section 1 = Collision Shapes - buttons at indices 0-4 (Box, Sphere, Cylinder, Capsule, AI Box)
      else if (section === 1) {
        const avatar = window.__CF_LOCAL_AVATAR__ || {};
        const playerX = avatar.x || 0;
        const playerZ = avatar.z || 0;
        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
        const playerYaw = avatar.yaw || 0;
        const spawnDistance = 15;
        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
        
        const shapes = ['box', 'sphere', 'cylinder', 'capsule', 'aibox'];
        const colors = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#22d3ee'];
        
        if (item >= 0 && item < shapes.length) {
          const isAIBox = shapes[item] === 'aibox';
          const newCollision = {
            id: Date.now() + Math.random(),
            shape: isAIBox ? 'box' : shapes[item], // AI Box uses box shape for rendering
            isAIBox: isAIBox, // Flag to identify AI boxes
            aiBoxLabel: isAIBox ? `AI Box #${Math.floor(Math.random() * 9999)}` : undefined,
            position: { x: spawnX, y: playerY, z: spawnZ },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 10, y: 10, z: 10 },
            hasCollision: false, // AI boxes don't need collision by default
            walkableTop: false,
            color: colors[item],
            opacity: isAIBox ? 0.15 : 0.3, // AI boxes are more transparent
            wireframe: isAIBox, // AI boxes show as wireframe
            aiContentData: null // Structured data describing the AI content (not JSX)
          };
          setPlacedCubes(prevCubes => [...prevCubes, newCollision]);
          setSelectedCubeId(newCollision.id);
          
          if (isAIBox) {
            console.log(`🤖 Created AI Box with ID: ${newCollision.id}, Label: ${newCollision.aiBoxLabel}`);
            console.log(`📋 To generate content, tell Copilot: "Create a [object] in AI Box #${newCollision.id}"`);
          }
        }
      }
    };
    
    console.log('🎯 Setting up controllerMenuItemActivate event listener');
    window.addEventListener('controllerMenuItemActivate', handleMenuItemActivate);
    return () => {
      console.log('🎯 Removing controllerMenuItemActivate event listener');
      window.removeEventListener('controllerMenuItemActivate', handleMenuItemActivate);
    };
  }, []);  // Empty dependencies - we only use setState functions which are stable
  
  // Hide chat UI when in edit mode or fullscreen mode, or when manually toggled off
  useEffect(() => {
    // Set global flag that chat component can read
    window.__CF_HIDE_CHAT__ = !showChatUI || cubeEditMode || fullCamera;
    console.log('Chat UI hide flag updated:', {
      showChatUI,
      cubeEditMode,
      fullCamera,
      hideFlag: window.__CF_HIDE_CHAT__
    });
  }, [showChatUI, cubeEditMode, fullCamera]);
  
  // Helper to send cube updates to opponent (called on discrete operations only)
  const sendCubeUpdate = useCallback((cubes) => {
    console.log('[SEND CUBES] 📤 Sending cubes_sync to server:', cubes.map(c => ({ 
      id: c.id, 
      isTerrain: c.isTerrain, 
      texture: c.texture,
      shape: c.shape 
    })));
    if (onAvatarMove) {
      // Mark that we sent this update so we don't apply our own echo
      window.__CF_LAST_CUBE_SEND_TIME__ = Date.now();
      
      onAvatarMove({
        type: 'cubes_sync',
        cubes: cubes,
        timestamp: Date.now()
      });
      console.log('[SEND CUBES] ✅ Called onAvatarMove with cubes_sync');
    } else {
      console.warn('[SEND CUBES] ❌ onAvatarMove is not defined!');
    }
  }, [onAvatarMove]);
  
  // Initialize collision cache on mount and whenever placedCubes changes
  React.useEffect(() => {
    updatePlacedCubesCache(placedCubes);
    console.log('[COLLISION] Cache initialized/updated with', placedCubes.length, 'cubes');
  }, [placedCubes]);
  
  // Debug: Log when placedCubes state changes (specifically for terrain textures)
  React.useEffect(() => {
    const terrainCubes = placedCubes.filter(c => c.isTerrain);
    if (terrainCubes.length > 0) {
      console.log('[STATE DEBUG] 🔄 placedCubes state updated. Terrain cubes:', terrainCubes.map(c => ({
        id: c.id,
        texture: c.texture
      })));
    }
  }, [placedCubes]);
  
  // Save cubes to localStorage whenever they change
  const lastCubesJSONRef = React.useRef(null);
  
  React.useEffect(() => {
    const cubesJSON = JSON.stringify(placedCubes);
    
    // Skip if cubes content hasn't actually changed (prevents unnecessary collision rebuilds on re-renders)
    if (lastCubesJSONRef.current === cubesJSON) {
      console.log('[COLLISION] Skipped cache update - no changes');
      return;
    }
    lastCubesJSONRef.current = cubesJSON;
    
    console.log('[COLLISION] Updating cache - cubes changed!');
    
    try {
      localStorage.setItem('cf3d_placed_cubes', cubesJSON);
      // Broadcast to other windows/tabs
      window.dispatchEvent(new CustomEvent('cf:cubes_update', { 
        detail: { cubes: placedCubes, sourceWindow: window } 
      }));
      
      // Update collision cache for physics
      updatePlacedCubesCache(placedCubes);
      
      // Note: Server sync is now handled immediately in add/delete/update functions
      // to provide real-time transform updates during dragging
    } catch (e) {
      console.error('Failed to save cubes:', e);
    }
  }, [placedCubes]);
  
  // Update child collision objects when their parent model moves/scales
  React.useEffect(() => {
    let hasChanges = false;
    const updatedCubes = placedCubes.map(cube => {
      if (cube.parentId) {
        const parent = placedCubes.find(p => p.id === cube.parentId);
        if (parent) {
          // Check if position or scale needs updating
          const positionChanged = 
            cube.position.x !== parent.position.x ||
            cube.position.y !== parent.position.y ||
            cube.position.z !== parent.position.z;
          
          let newScale = cube.scale;
          if (cube.followParentScale && parent.modelBounds) {
            // Recalculate scale based on parent's current scale and bounds
            const bounds = parent.modelBounds;
            const worldWidth = bounds.width * parent.scale.x;
            const worldHeight = bounds.height * parent.scale.y;
            const worldDepth = bounds.depth * parent.scale.z;
            
            newScale = {
              x: worldWidth,
              y: worldHeight,
              z: worldDepth
            };
          }
          
          const scaleChanged = 
            newScale.x !== cube.scale.x ||
            newScale.y !== cube.scale.y ||
            newScale.z !== cube.scale.z;
          
          if (positionChanged || scaleChanged) {
            hasChanges = true;
            
            const updated = {
              ...cube,
              position: { ...parent.position },
              scale: newScale
            };
            
            console.log('[Parent-Child useEffect] Updating child:', {
              childId: cube.id,
              preservedShape: updated.shape,
              preservedWalkableTop: updated.walkableTop,
              preservedHasCollision: updated.hasCollision
            });
            
            // Preserve ALL cube properties, only update position and scale
            return updated;
          }
        }
      }
      return cube;
    });
    
    if (hasChanges) {
      setPlacedCubes(updatedCubes);
    }
  }, [placedCubes]);
  
  // Listen for cube updates from opponent or other tabs
  React.useEffect(() => {
    const handleCubeUpdate = (e) => {
      try {
        // Ignore events from this same window to prevent loops
        if (e.detail.sourceWindow === window) return;
        
        if (e.detail && Array.isArray(e.detail.cubes)) {
          // Always accept all updates for real-time collaborative editing
          // Both players can edit the same cube and see each other's changes immediately
          setPlacedCubes(e.detail.cubes);
        }
      } catch (err) {
        console.warn('Failed to handle cube update:', err);
      }
    };
    
    const handleCubesLoaded = (e) => {
      try {
        // Load cubes from server on game start
        if (e.detail && Array.isArray(e.detail.cubes)) {
          setPlacedCubes(e.detail.cubes);
          updatePlacedCubesCache(e.detail.cubes);
          console.log('[c4-3d] Loaded', e.detail.cubes.length, 'cubes from server');
        }
      } catch (err) {
        console.warn('Failed to load cubes from server:', err);
      }
    };
    
    window.addEventListener('cf:cubes_update', handleCubeUpdate);
    window.addEventListener('cf:cubes_loaded', handleCubesLoaded);
    return () => {
      window.removeEventListener('cf:cubes_update', handleCubeUpdate);
      window.removeEventListener('cf:cubes_loaded', handleCubesLoaded);
    };
  }, [cubeEditMode, selectedCubeId]);
  
  // Listen for visualizer updates from opponent or other tabs
  React.useEffect(() => {
    const handleVisualizerUpdate = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          // Always accept all updates for real-time collaborative editing
          setAudioVisualizers(e.detail.visualizers);
        }
      } catch (err) {
        console.warn('Failed to handle visualizer update:', err);
      }
    };
    
    const handleVisualizersLoaded = (e) => {
      try {
        // Load visualizers from server on game start
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          setAudioVisualizers(e.detail.visualizers);
          console.log('[c4-3d] Loaded', e.detail.visualizers.length, 'audio visualizers from server');
        }
      } catch (err) {
        console.warn('Failed to load visualizers from server:', err);
      }
    };
    
    window.addEventListener('cf:visualizers_update', handleVisualizerUpdate);
    window.addEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    return () => {
      window.removeEventListener('cf:visualizers_update', handleVisualizerUpdate);
      window.removeEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    };
  }, [cubeEditMode]);
  
  // Track the last timestamp we applied remote cubes to prevent duplicate applications
  const lastAppliedRemoteCubesTimestamp = React.useRef(0);
  
  // Poll for remote cube updates from server (similar to remote avatar polling)
  React.useEffect(() => {
    const interval = setInterval(() => {
      try {
        // Check if opponent has sent cube data (would be set by parent component receiving server messages)
        if (window.__CF_REMOTE_CUBES__ && !cubeEditMode) {
          // Ignore echoes of our own updates for 1 second after sending
          const lastSendTime = window.__CF_LAST_CUBE_SEND_TIME__ || 0;
          const timeSinceSend = Date.now() - lastSendTime;
          
          if (timeSinceSend < 1000) {
            console.log('[REMOTE CUBES] ⏭️ Ignoring echo of our own update (sent', timeSinceSend, 'ms ago)');
            return;
          }
          
          const remoteCubes = window.__CF_REMOTE_CUBES__;
          const remoteCubesTimestamp = window.__CF_REMOTE_CUBES_TIMESTAMP__ || 0;
          
          // Only apply if this is new data (different timestamp than last applied)
          if (Array.isArray(remoteCubes) && remoteCubes.length >= 0 && remoteCubesTimestamp > lastAppliedRemoteCubesTimestamp.current) {
            console.log('[REMOTE CUBES] 📥 Received NEW data from window global (ts:', remoteCubesTimestamp, ')');
            setPlacedCubes(remoteCubes);
            lastAppliedRemoteCubesTimestamp.current = remoteCubesTimestamp;
            console.log('[REMOTE CUBES] ✅ Applied to local state');
            // Save to localStorage so it persists
            localStorage.setItem('cf3d_placed_cubes', JSON.stringify(remoteCubes));
            // Update module-level cache for real-time collision
            updatePlacedCubesCache(remoteCubes);
          }
        }
      } catch (e) {
        console.warn('Failed to sync remote cubes:', e);
      }
    }, 500); // Check every 500ms
    
    return () => clearInterval(interval);
  }, [cubeEditMode]);
  
  // Add a new cube or sphere in front of player at their position and height with immediate sync
  const addCube = React.useCallback((shape = 'box', modelType = 'none') => {
    // Get player's current position and facing direction from global state
    const avatar = window.__CF_LOCAL_AVATAR__ || {};
    const playerX = avatar.x || 0;
    const playerZ = avatar.z || 0;
    const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0); // Current height (includes jumps/stairs)
    const playerYaw = avatar.yaw || 0; // Facing direction in radians
    
    // Spawn distance in front of player (adjust as needed)
    const spawnDistance = 15;
    
    // Calculate spawn position in front of player using their yaw
    const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
    const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
    const spawnY = playerY; // Spawn at player's current height
    
    // Default scale based on type
    let defaultScale = { x: 5, y: 5, z: 5 };
    if (modelType === 'asteroid') {
      defaultScale = { x: 0.06, y: 0.06, z: 0.06 }; // Asteroid default scale
    } else if (modelType === 'rover') {
      defaultScale = { x: 0.08, y: 0.08, z: 0.08 }; // Rover default scale
    } else if (modelType === 'table') {
      defaultScale = { x: 0.15, y: 0.15, z: 0.15 }; // Table default scale
    } else if (modelType === 'stairs2') {
      defaultScale = { x: 1.0, y: 1.0, z: 1.0 }; // Stairs2 at natural scale
    }
    
    const newCube = {
      id: Date.now() + Math.random(), // unique ID
      shape: shape, // 'box', 'sphere', or 'cylinder'
      modelType: modelType, // 'none', 'asteroid', 'table', 'stairs2'
      position: { x: spawnX, y: spawnY, z: spawnZ },
      rotation: { x: 0, y: 0, z: 0 },
      scale: defaultScale,
      hasCollision: true,
      walkableTop: (modelType === 'stairs2' || shape === 'cylinder'), // Stairs and cylinders are walkable
      color: '#3b82f6' // default blue
    };
    const newCubes = [...placedCubes, newCube];
    setPlacedCubes(newCubes);
    setSelectedCubeId(newCube.id);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, sendCubeUpdate]);
  
  // Delete selected cube with immediate sync (also removes children like collision boxes)
  const deleteCube = React.useCallback((id) => {
    // Remove the cube AND any children (collision boxes, etc.) that have this cube as parent
    const newCubes = placedCubes.filter(c => c.id !== id && c.parentId !== id);
    setPlacedCubes(newCubes);
    if (selectedCubeId === id) setSelectedCubeId(null);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, selectedCubeId, sendCubeUpdate]);
  
  // Cleanup orphaned collision objects (children whose parents no longer exist)
  const cleanupOrphanedCollisions = React.useCallback(() => {
    const parentIds = new Set(placedCubes.map(c => c.id));
    const newCubes = placedCubes.filter(c => {
      // Keep if it has no parent, or if its parent still exists
      return !c.parentId || parentIds.has(c.parentId);
    });
    
    if (newCubes.length !== placedCubes.length) {
      setPlacedCubes(newCubes);
      sendCubeUpdate(newCubes);
      console.log(`[Cleanup] Removed ${placedCubes.length - newCubes.length} orphaned collision objects`);
    }
  }, [placedCubes, sendCubeUpdate]);
  
  // Update cube and send to network (used when transform is finished)
  const updateCubeAndSync = React.useCallback((id, updates) => {
    console.log('[updateCubeAndSync] 🔄 START - Updating cube:', id, 'with updates:', updates);
    
    setPlacedCubes(prevCubes => {
      const newCubes = prevCubes.map(c => {
        if (c.id === id) {
          const updated = { ...c, ...updates };
          console.log('[updateCubeAndSync] ✏️ Updated cube:', {
            id,
            oldTexture: c.texture,
            newTexture: updated.texture,
            isTerrain: updated.isTerrain,
            allUpdates: updates
          });
          return updated;
        }
        // If this cube is parented to the updated cube, update its position/scale too
        if (c.parentId === id && (updates.position || updates.scale)) {
          const parent = { ...prevCubes.find(p => p.id === id), ...updates };
          if (parent) {
            let newChildScale = c.scale;
            
            // Recalculate child collision scale based on new parent scale and bounds
            if (c.followParentScale && updates.scale && parent.modelBounds) {
              const bounds = parent.modelBounds;
              newChildScale = {
                x: bounds.width * updates.scale.x,
                y: bounds.height * updates.scale.y,
                z: bounds.depth * updates.scale.z
              };
            }
            
            const updated = {
              ...c,
              position: updates.position ? { ...updates.position } : c.position,
              scale: newChildScale
            };
            
            console.log('[updateCubeAndSync] Updating child collision:', {
              childId: c.id,
              preservedShape: updated.shape,
              preservedHasCollision: updated.hasCollision,
              preservedColor: updated.color
            });
            
            // Preserve ALL child properties (shape, hasCollision, color, etc.)
            return updated;
          }
        }
        return c;
      });
      
      console.log('[updateCubeAndSync] 💾 New state:', newCubes.length, 'cubes');
      console.log('[updateCubeAndSync] 🔍 Updated cube in new state:', newCubes.find(c => c.id === id));
      
      // Send update to opponent (transform completed - no throttle needed)
      console.log('[updateCubeAndSync] 📡 Calling sendCubeUpdate');
      sendCubeUpdate(newCubes);
      
      return newCubes;
    });
  }, [sendCubeUpdate]);
  
  // Helper: Add AI content to a specific AI Box by ID or label
  const addAIContent = React.useCallback((boxIdentifier, contentData) => {
    // Find box by ID or label
    const box = placedCubes.find(c => 
      c.isAIBox && (
        c.id.toString().includes(boxIdentifier) || 
        c.aiBoxLabel?.includes(boxIdentifier)
      )
    );
    
    if (!box) {
      console.error(`❌ AI Box not found: ${boxIdentifier}`);
      return false;
    }
    
    console.log(`🤖 Adding AI content to ${box.aiBoxLabel || `Box ${box.id}`}`);
    updateCubeAndSync(box.id, { aiContentData: contentData });
    return true;
  }, [placedCubes, updateCubeAndSync]);
  
  // Expose to window for easy testing/usage
  React.useEffect(() => {
    window.__CF_ADD_AI_CONTENT__ = addAIContent;
    return () => delete window.__CF_ADD_AI_CONTENT__;
  }, [addAIContent]);
  
  // Handler: Save AI Box title
  const handleSaveAIBoxTitle = React.useCallback(() => {
    if (!selectedCubeId) return;
    
    const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
    if (!selectedCube || !selectedCube.isAIBox) return;
    
    // Extract AI Box ID from current label
    const currentLabel = selectedCube.aiBoxLabel || '';
    const match = currentLabel.match(/AI Box #(\d+)/);
    const boxId = match ? match[1] : selectedCube.id;
    
    // Build new label: "AI Box #<id> - <customTitle>" or just "AI Box #<id>" if no title
    const newLabel = aiBoxEditTitle.trim() 
      ? `AI Box #${boxId} - ${aiBoxEditTitle.trim()}`
      : `AI Box #${boxId}`;
    
    console.log('💾 Saving AI Box title:', { oldLabel: currentLabel, newLabel });
    console.log('💾 Saving AI Box prompt:', aiBoxEditPrompt);
    
    // Update the cube with new label and prompt
    updateCubeAndSync(selectedCube.id, { 
      aiBoxLabel: newLabel,
      aiPrompt: aiBoxEditPrompt.trim()
    });
    
    // Close editor
    setAIBoxEditorOpen(false);
    setSelectedCubeId(null);
    
    // Broadcast restart countdown to all players via onAvatarMove callback
    // The server will broadcast this back to ALL players (including us) to keep everyone in sync
    if (onAvatarMove) {
      console.log('🔄 [RESTART] Broadcasting countdown to server...');
      // Mark this player as the initiator so they trigger the actual restart
      window.__CF_RESTART_INITIATOR__ = true;
      const message = {
        type: 'server-restart-countdown',
        countdown: 5
      };
      console.log('🔄 [RESTART] Calling onAvatarMove with:', message);
      onAvatarMove(message);
      console.log('🔄 [RESTART] onAvatarMove called successfully');
      
      // ALSO trigger locally immediately so the initiating player sees feedback
      // The broadcast will come back and sync both players
      console.log('🔄 [RESTART] Also triggering local countdown for immediate feedback');
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown: 5 } 
      }));
    } else {
      console.error('🔄 [RESTART] ERROR: onAvatarMove is not available!');
      // Fallback: trigger locally even if no network
      console.log('🔄 [RESTART] Fallback: triggering local countdown only');
      window.__CF_RESTART_INITIATOR__ = true;
      window.dispatchEvent(new CustomEvent('cf:server-restart-countdown', { 
        detail: { countdown: 5 } 
      }));
    }
    
    // NOTE: We don't start the countdown locally anymore
    // We wait for the server broadcast to come back to ensure both players are perfectly synchronized
  }, [selectedCubeId, placedCubes, aiBoxEditTitle, aiBoxEditPrompt, updateCubeAndSync, onAvatarMove]);
  
  // ===== TERRAIN SCULPTING =====
  const handleSculpt = useCallback((terrainId, worldPosition, brushSize, delta) => {
    console.log('[SCULPT] At X:', worldPosition.x.toFixed(2), 'Z:', worldPosition.z.toFixed(2), 'delta:', delta.toFixed(2));
    
    // Save current state to history before modifying
    setPlacedCubes(prevCubes => {
      const currentTerrain = prevCubes.find(c => c.id === terrainId);
      if (!currentTerrain || !currentTerrain.isTerrain) {
        return prevCubes;
      }
      
      // Save the current state to history
      setSculptHistory(prevHistory => [...prevHistory, {
        terrainId,
        previousModifications: currentTerrain.heightModifications ? [...currentTerrain.heightModifications] : []
      }]);
      
      // Apply the new modification
      return prevCubes.map(cube => {
        if (cube.id !== terrainId || !cube.isTerrain) return cube;
        
        // Initialize height modifications array if it doesn't exist
        const modifications = cube.heightModifications || [];
        
        // Convert world position to local position relative to terrain
        const cosY = Math.cos(cube.rotation.y);
        const sinY = Math.sin(cube.rotation.y);
        
        // Transform world position to local space
        const dx = worldPosition.x - cube.position.x;
        const dz = worldPosition.z - cube.position.z;
        const localX = dx * cosY + dz * sinY;
        const localZ = -dx * sinY + dz * cosY;
        
        // Add new modification in local coordinates
        modifications.push({
          x: localX,
          z: localZ,
          radius: brushSize,
          delta: delta
        });
        
        return { ...cube, heightModifications: modifications };
      });
    });
  }, []);
  
  // Undo last sculpt operation
  const undoSculpt = useCallback(() => {
    if (sculptHistory.length === 0) return;
    
    setSculptHistory(prevHistory => {
      const newHistory = [...prevHistory];
      const lastAction = newHistory.pop();
      
      // Restore previous state
      setPlacedCubes(prevCubes => {
        return prevCubes.map(cube => {
          if (cube.id === lastAction.terrainId) {
            return { ...cube, heightModifications: lastAction.previousModifications };
          }
          return cube;
        });
      });
      
      return newHistory;
    });
  }, [sculptHistory]);
  
  // Clear all sculpts from selected terrain
  const clearAllSculpts = useCallback(() => {
    if (!selectedCubeId) return;
    
    setPlacedCubes(prevCubes => {
      return prevCubes.map(cube => {
        if (cube.id === selectedCubeId && cube.isTerrain) {
          return { ...cube, heightModifications: [] };
        }
        return cube;
      });
    });
    
    // Clear history too
    setSculptHistory([]);
  }, [selectedCubeId]);
  
  // Listen for Ctrl+Z when in sculpt mode
  useEffect(() => {
    if (!sculptMode) return;
    
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoSculpt();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sculptMode, undoSculpt]);
  
  // Arrow key controls for moving selected terrain
  useEffect(() => {
    if (!cubeEditMode || !selectedCubeId) return;
    
    const handleKeyDown = (e) => {
      const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
      if (!selectedCube) return;
      
      // Check if arrow keys are pressed
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        
        // Movement step size (can be modified based on snap settings)
        const moveStep = cubeSnap ? cubeTranslateSnap : 1.0;
        
        // Calculate new position based on arrow key
        let newPosition = { ...selectedCube.position };
        
        switch (e.key) {
          case 'ArrowUp':
            newPosition.z -= moveStep; // Move forward (negative Z)
            break;
          case 'ArrowDown':
            newPosition.z += moveStep; // Move backward (positive Z)
            break;
          case 'ArrowLeft':
            newPosition.x -= moveStep; // Move left (negative X)
            break;
          case 'ArrowRight':
            newPosition.x += moveStep; // Move right (positive X)
            break;
        }
        
        // Update the cube position
        updateCubeAndSync(selectedCubeId, { position: newPosition });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cubeEditMode, selectedCubeId, placedCubes, cubeSnap, cubeTranslateSnap, updateCubeAndSync]);
  
  // ===== AUDIO VISUALIZER SYNC FUNCTIONS =====
  const sendVisualizerUpdate = useCallback((visualizers) => {
    if (onAvatarMove) {
      onAvatarMove({
        type: 'visualizers_sync',
        visualizers: visualizers,
        timestamp: Date.now()
      });
    }
  }, [onAvatarMove]);
  
  // Notify other player when a new sound is uploaded
  const sendSoundUploadNotification = useCallback((filename) => {
    if (onAvatarMove) {
      onAvatarMove({
        type: 'sound_uploaded',
        filename: filename,
        timestamp: Date.now()
      });
    }
  }, [onAvatarMove]);
  
  // Save visualizers to localStorage and sync
  React.useEffect(() => {
    try {
      localStorage.setItem('cf3d_audio_visualizers', JSON.stringify(audioVisualizers));
      // Broadcast to other windows/tabs
      window.dispatchEvent(new CustomEvent('cf:visualizers_update', { 
        detail: { visualizers: audioVisualizers } 
      }));
    } catch (err) {
      console.warn('Failed to save visualizers:', err);
    }
  }, [audioVisualizers]);
  
  // Listen for visualizer updates from other instances
  React.useEffect(() => {
    const handleVisualizerUpdate = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers) && !cubeEditMode) {
          setAudioVisualizers(e.detail.visualizers);
        }
      } catch (err) {
        console.warn('Failed to handle visualizer update:', err);
      }
    };
    
    const handleVisualizersLoaded = (e) => {
      try {
        if (e.detail && Array.isArray(e.detail.visualizers)) {
          setAudioVisualizers(e.detail.visualizers);
          console.log('[c4-3d] Loaded', e.detail.visualizers.length, 'audio visualizers from server');
        }
      } catch (err) {
        console.warn('Failed to load visualizers from server:', err);
      }
    };
    
    window.addEventListener('cf:visualizers_update', handleVisualizerUpdate);
    window.addEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    return () => {
      window.removeEventListener('cf:visualizers_update', handleVisualizerUpdate);
      window.removeEventListener('cf:visualizers_loaded', handleVisualizersLoaded);
    };
  }, [cubeEditMode]);
  
  // Expose sound upload notification function globally and listen for incoming notifications
  React.useEffect(() => {
    window.__SEND_SOUND_UPLOAD__ = sendSoundUploadNotification;
    
    const handleSoundUploaded = (e) => {
      try {
        if (e.detail && e.detail.filename && !availableSounds.includes(e.detail.filename)) {
          setAvailableSounds(prev => [...prev, e.detail.filename]);
          console.log('[c4-3d] Other player uploaded sound:', e.detail.filename);
        }
      } catch (err) {
        console.warn('Failed to handle sound upload notification:', err);
      }
    };
    
    window.addEventListener('cf:sound_uploaded', handleSoundUploaded);
    return () => {
      window.removeEventListener('cf:sound_uploaded', handleSoundUploaded);
      delete window.__SEND_SOUND_UPLOAD__;
    };
  }, [sendSoundUploadNotification, availableSounds]);
  
  // Poll for remote visualizer updates from server
  React.useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (window.__CF_REMOTE_VISUALIZERS__ && !cubeEditMode) {
          const remoteVisualizers = window.__CF_REMOTE_VISUALIZERS__;
          if (Array.isArray(remoteVisualizers) && remoteVisualizers.length > 0) {
            setAudioVisualizers(remoteVisualizers);
          }
        }
      } catch (err) {
        console.warn('Failed to poll remote visualizers:', err);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [cubeEditMode]);
  
  const updateVisualizerAndSync = React.useCallback((id, updates) => {
    const newVisualizers = audioVisualizers.map(v => v.id === id ? { ...v, ...updates } : v);
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  const addVisualizerAndSync = React.useCallback((visualizer) => {
    const newVisualizers = [...audioVisualizers, visualizer];
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  const deleteVisualizerAndSync = React.useCallback((id) => {
    const newVisualizers = audioVisualizers.filter(v => v.id !== id);
    setAudioVisualizers(newVisualizers);
    sendVisualizerUpdate(newVisualizers);
  }, [audioVisualizers, sendVisualizerUpdate]);
  
  // Duplicate selected cube with immediate sync
  const duplicateCube = React.useCallback((id) => {
    const cube = placedCubes.find(c => c.id === id);
    if (!cube) return;
    
    // For terrain floors, keep the same position; for other objects, offset slightly
    const positionOffset = cube.isTerrain ? { ...cube.position } : { ...cube.position, x: cube.position.x + 2 };
    
    const newCube = {
      ...cube,
      id: Date.now() + Math.random(),
      position: positionOffset,
      // Clear ALL snap-related data for duplicated terrain (it should not be pre-snapped)
      snappedEdges: {}, // Support multiple edge snaps
      savedEdgeHeights: undefined, // Clear old edge height data (prevents ghost blending)
      // Deep copy all terrain-specific properties
      scale: cube.scale ? { ...cube.scale } : undefined,
      rotation: cube.rotation ? { ...cube.rotation } : undefined,
      terrainScale: cube.terrainScale,
      terrainHeightMultiplier: cube.terrainHeightMultiplier,
      terrainMoundScale: cube.terrainMoundScale,
      terrainMoundMultiplier: cube.terrainMoundMultiplier,
      terrainOctaves: cube.terrainOctaves,
      terrainEdgeBlend: cube.terrainEdgeBlend,
      terrainSegments: cube.terrainSegments,
      hasTerrainNoise: cube.hasTerrainNoise,
      hasWireframe: cube.hasWireframe,
      textureType: cube.textureType,
      customTexturePath: cube.customTexturePath
    };
    const newCubes = [...placedCubes, newCube];
    setPlacedCubes(newCubes);
    setSelectedCubeId(newCube.id);
    
    // Send immediate update (no throttle for discrete operations)
    sendCubeUpdate(newCubes);
  }, [placedCubes, sendCubeUpdate]);
  
  // Event handler for controller sub-menu item activation (buttons/toggles inside placed objects)
  useEffect(() => {
    const handleSubMenuItemActivate = (e) => {
      const { objectIndex, subItem } = e.detail;
      console.log('🎮 Sub-menu item activated:', { objectIndex, subItem });
      
      // Get the placed object (items 4+ map to placedCubes array, excluding terrain)
      const objIndex = objectIndex - 4;
      const placedObjects = placedCubes.filter(c => !c.parentId && !c.isTerrain);
      if (objIndex < 0 || objIndex >= placedObjects.length) {
        console.error('Invalid object index:', objectIndex);
        return;
      }
      
      const cube = placedObjects[objIndex];
      console.log('🎮 Operating on cube:', cube.id);
      
      // Sub-item mapping:
      // 0 = Duplicate button
      // 1 = Delete button
      // 2 = Collision checkbox
      // 3 = Walkable checkbox
      // 4 = Box collision shape
      // 5 = Sphere collision shape
      // 6 = Cylinder collision shape
      
      if (subItem === 0) {
        // Duplicate
        console.log('🎮 Duplicating cube:', cube.id);
        duplicateCube(cube.id);
      } else if (subItem === 1) {
        // Delete
        console.log('🎮 Deleting cube:', cube.id);
        deleteCube(cube.id);
      } else if (subItem === 2) {
        // Toggle Collision checkbox
        console.log('🎮 Toggling collision for cube:', cube.id, 'current:', cube.hasCollision);
        updateCubeAndSync(cube.id, { hasCollision: !cube.hasCollision });
      } else if (subItem === 3) {
        // Toggle Walkable checkbox
        console.log('🎮 Toggling walkable for cube:', cube.id, 'current:', cube.walkableTop);
        updateCubeAndSync(cube.id, { walkableTop: !cube.walkableTop });
      } else if (subItem >= 4 && subItem <= 6) {
        // Collision shape buttons (Box, Sphere, Cylinder)
        const shapes = ['box', 'sphere', 'cylinder'];
        const shape = shapes[subItem - 4];
        console.log('🎮 Setting collision shape:', shape);
        
        // Find existing collision layer
        const existingCollision = placedCubes.find(c => c.parentId === cube.id);
        
        // Use actual model bounds if available, otherwise estimate
        const bounds = cube.modelBounds || { width: 100, height: 100, depth: 100 };
        const scaleX = cube.scale.x || 0.1;
        const scaleY = cube.scale.y || 0.1;
        const scaleZ = cube.scale.z || 0.1;
        
        const worldWidth = bounds.width * scaleX;
        const worldHeight = bounds.height * scaleY;
        const worldDepth = bounds.depth * scaleZ;
        
        if (existingCollision) {
          // Update existing collision
          updateCubeAndSync(existingCollision.id, { 
            shape,
            scale: { x: worldWidth, y: worldHeight, z: worldDepth }
          });
        } else {
          // Create new collision layer
          const newId = `collision-${cube.id}-${Date.now()}`;
          const newCube = {
            id: newId,
            shape,
            modelType: 'none',
            position: { ...cube.position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: worldWidth, y: worldHeight, z: worldDepth },
            color: '#a855f7',
            hasCollision: true,
            walkableTop: false,
            parentId: cube.id,
            followParentScale: true
          };
          
          const newCubes = [...placedCubes, newCube];
          setPlacedCubes(newCubes);
          sendCubeUpdate(newCubes);
        }
      }
    };
    
    console.log('🎯 Setting up controllerSubMenuItemActivate event listener');
    window.addEventListener('controllerSubMenuItemActivate', handleSubMenuItemActivate);
    return () => {
      console.log('🎯 Removing controllerSubMenuItemActivate event listener');
      window.removeEventListener('controllerSubMenuItemActivate', handleSubMenuItemActivate);
    };
  }, [placedCubes, duplicateCube, deleteCube, updateCubeAndSync, sendCubeUpdate]);
  
  const [extraAlign, setExtraAlign] = useState(true);
  const [extraSide, setExtraSide] = useState('left'); // matches current scene usage
  const [extraGap, setExtraGap] = useState(1.4);
  const [extraX, setExtraX] = useState(STAIR2_POS_X + 0);
  const [extraZ, setExtraZ] = useState(STAIR2_POS_Z + 0);
  const [extraYawDeg, setExtraYawDeg] = useState(0); // face forward by default
  const [extraScale, setExtraScale] = useState(0.16);
  // Per-axis scale states for stairs (edited via gizmo); keep uniform slider bound to X for legacy control
  const [extraScaleX, setExtraScaleX] = useState(0.16);
  const [extraScaleY, setExtraScaleY] = useState(0.16);
  const [extraScaleZ, setExtraScaleZ] = useState(0.16);
  const [extraWalkable, setExtraWalkable] = useState(false);
  // Table scale is fixed now; no user control
  const [extraReverse, setExtraReverse] = useState(false);
  const [extraY, setExtraY] = useState(0);
  const [lockYToGround, setLockYToGround] = useState(true);
  useEffect(() => { try { setExtraStairsWalkable(extraWalkable); } catch {} }, [extraWalkable]);

  // Walkable mask tuning (lets you adjust the collision mask independent of the visible model)
  const [maskEdit, setMaskEdit] = useState(false);
  const [maskScale, setMaskScale] = useState(1);       // multiplies width/depth/height/run/rise
  const [maskYawDeg, setMaskYawDeg] = useState(0);     // added to model yaw
  const [maskDX, setMaskDX] = useState(0);             // offset from model X
  const [maskDY, setMaskDY] = useState(0);             // offset from model Y (posY)
  const [maskDZ, setMaskDZ] = useState(0);             // offset from model Z
  const maskObjRef = useRef();                          // visible mask handle for click-to-edit

  // Transform (drag/move/rotate/scale) controls for decorative stairs
  const SHOW_DECOR_STAIRS = false; // hide FBX decorative stairs for now
  const extraRef = useRef();
  const [extraEdit, setExtraEdit] = useState(false);
  const [extraMode, setExtraMode] = useState('translate'); // 'translate' | 'rotate' | 'scale'
  const [extraSnap, setExtraSnap] = useState(true);
  const [extraTranslateSnap, setExtraTranslateSnap] = useState(0.5);
  const [extraRotateSnapDeg, setExtraRotateSnapDeg] = useState(15);
  const [extraScaleSnap, setExtraScaleSnap] = useState(0.01);
  const extraLastDefRef = useRef(null);
  const prevCamStateRef = useRef({ fullCamera: null, followCam: null });

  // When decorative stairs are hidden, ensure their walkable/collision state is cleared
  useEffect(() => {
    if (!SHOW_DECOR_STAIRS) {
      try { setExtraStairsWalkable(false); } catch {}
      try { setExtraStairsDef(null); } catch {}
    }
  }, [SHOW_DECOR_STAIRS]);

  // Ensure free camera while editing; restore when done
  useEffect(() => {
    try {
      if (extraEdit) {
        // save
        prevCamStateRef.current = { fullCamera, followCam };
        // force free camera; disable follower
        setFullCamera(true);
        setFollowCam(false);
        // also block any auto-resume timers
        try { window.__CF_USER_ORBIT__ = true; window.__CF_RESUME_FOLLOW_AT__ = 0; } catch {}
      } else {
        // restore prior camera state if available
        const prev = prevCamStateRef.current || {};
        if (typeof prev.fullCamera === 'boolean') setFullCamera(prev.fullCamera);
        if (typeof prev.followCam === 'boolean') setFollowCam(prev.followCam);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraEdit]);

  // Helpers to export/import current decorative stairs settings
  const buildExtraStairsJSX = useCallback(() => {
    const yawRad = (extraYawDeg * Math.PI) / 180;
    const y = extraY.toFixed(2);
    const lockY = lockYToGround;
    return `<ExtraStairsFBX alignToStair2={false} yaw={${yawRad.toFixed(4)}} scaleMul={${extraScale.toFixed(3)}} posX={${extraX.toFixed(2)}} posZ={${extraZ.toFixed(2)}} posY={${y}} /> // lockY=${lockY}`;
  }, [extraYawDeg, extraScale, extraX, extraZ, extraY, lockYToGround]);
  const buildExtraStairsJSON = useCallback(() => {
    return JSON.stringify({
      alignToStair2: extraAlign,
      side: extraSide,
      gap: extraGap,
      posX: extraX,
      posZ: extraZ,
      posY: extraY,
      yawDeg: extraYawDeg,
      scaleMul: extraScale,
      scaleMulX: extraScaleX,
      scaleMulY: extraScaleY,
      scaleMulZ: extraScaleZ,
      walkable: extraWalkable,
      reverse: extraReverse,
      lockYToGround,
      mask:{ scale: maskScale, yawDeg: maskYawDeg, dx: maskDX, dy: maskDY, dz: maskDZ }
    }, null, 2);
  }, [extraAlign, extraSide, extraGap, extraX, extraZ, extraY, extraYawDeg, extraScale, extraScaleX, extraScaleY, extraScaleZ, extraWalkable, extraReverse, lockYToGround, maskScale, maskYawDeg, maskDX, maskDY, maskDZ]);
  const copyText = useCallback(async (txt) => { try { await navigator.clipboard.writeText(txt); } catch {} }, []);
  const applyFromJSON = useCallback((txt) => {
    try {
      const o = typeof txt === 'string' ? JSON.parse(txt) : (txt||{});
      if (typeof o.posX === 'number') setExtraX(o.posX);
      if (typeof o.posZ === 'number') setExtraZ(o.posZ);
      if (typeof o.posY === 'number') setExtraY(o.posY);
      if (typeof o.yawDeg === 'number') setExtraYawDeg(((o.yawDeg % 360)+360)%360);
      if (typeof o.scaleMul === 'number') setExtraScale(o.scaleMul);
      if (typeof o.scaleMulX === 'number') setExtraScaleX(o.scaleMulX);
      if (typeof o.scaleMulY === 'number') setExtraScaleY(o.scaleMulY);
      if (typeof o.scaleMulZ === 'number') setExtraScaleZ(o.scaleMulZ);
      if (typeof o.alignToStair2 === 'boolean') setExtraAlign(o.alignToStair2);
      if (typeof o.side === 'string') setExtraSide(o.side);
      if (typeof o.gap === 'number') setExtraGap(o.gap);
      if (typeof o.walkable === 'boolean') setExtraWalkable(o.walkable);
      if (typeof o.reverse === 'boolean') setExtraReverse(o.reverse);
      if (typeof o.lockYToGround === 'boolean') setLockYToGround(o.lockYToGround);
  // tableScaleMul is no longer used; ignore if present
      if (o.mask && typeof o.mask === 'object'){
        if (typeof o.mask.scale === 'number') setMaskScale(o.mask.scale);
        if (typeof o.mask.yawDeg === 'number') setMaskYawDeg(((o.mask.yawDeg % 360)+360)%360);
        if (typeof o.mask.dx === 'number') setMaskDX(o.mask.dx);
        if (typeof o.mask.dy === 'number') setMaskDY(o.mask.dy);
        if (typeof o.mask.dz === 'number') setMaskDZ(o.mask.dz);
      }
    } catch {}
  }, []);
  const controlsRef = useRef();
  const lastLocalPosRef = useRef({ x: null, z: null });
  const smoothEnableTimerRef = useRef(null);
  // Gate: skip the very next smooth-enable after pressing Leave (user request)
  const suppressNextSmoothRef = useRef(false);

  // Clean up global state on mount/unmount to prevent stale values from hot reload
  const [hotReloadDetected, setHotReloadDetected] = React.useState(false);
  
  useEffect(() => {
    // Reset global flags on mount
    try {
      console.log('[ConnectFour3D] Component mounted, clearing global state');
      
      // Detect hot reload - if window has our marker, it's a hot reload
      if (window.__CF_COMPONENT_MOUNTED__) {
        console.warn('[ConnectFour3D] HOT RELOAD DETECTED - Incrementing reload counter');
        window.__CF_HOT_RELOAD_COUNT__ = (window.__CF_HOT_RELOAD_COUNT__ || 0) + 1;
        setHotReloadDetected(true);
        // Auto-dismiss after 3 seconds
        setTimeout(() => setHotReloadDetected(false), 3000);
      }
      window.__CF_COMPONENT_MOUNTED__ = true;
      
      window.__CF_USER_ORBIT__ = false;
      window.__CF_RESUME_FOLLOW_AT__ = 0;
      window.__CF_FORCE_SNAP__ = 0;
      window.__CF_POV_HEIGHT_OFFSET__ = undefined;
    } catch {}
    
    // Clean up on unmount
    return () => {
      try {
        console.log('[ConnectFour3D] Component unmounting, cleaning up');
        if (smoothEnableTimerRef.current) {
          clearTimeout(smoothEnableTimerRef.current);
          smoothEnableTimerRef.current = null;
        }
        window.__CF_USER_ORBIT__ = false;
        window.__CF_RESUME_FOLLOW_AT__ = 0;
        window.__CF_FORCE_SNAP__ = 0;
        window.__CF_LOCAL_AVATAR__ = undefined;
        window.__CF_POV_HEIGHT_OFFSET__ = undefined;
        // Don't clear __CF_COMPONENT_MOUNTED__ so we can detect hot reload
      } catch {}
    };
  }, []);

  // When Full Camera controls are enabled, turn OFF 3rd-person follow and clear any follow timers
  useEffect(() => {
    if (fullCamera) {
      try {
        setFollowCam(false);
        if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; }
        window.__CF_USER_ORBIT__ = false;
        window.__CF_RESUME_FOLLOW_AT__ = 0;
        window.__CF_FORCE_SNAP__ = 0;
        
        // Don't change the camera target - let it stay wherever it currently is
        // This preserves the current view when toggling to full camera mode
      } catch {}
    }
  }, [fullCamera]);
  // Helper: ensure 3rd-person follow is ON and centered behind the avatar
  const centerThirdPerson = useCallback(() => {
    try {
      const msg = window.__CF_LOCAL_AVATAR__;
      if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
      
      setFollowSeed((s) => s + 1);
      setFollowCam(true);
    } catch {}
  }, []);

  // Clear any pending smooth-enable timer on unmount
  useEffect(() => {
    return () => { try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {} };
  }, []);

  // Helper: after the user walks a bit, auto-enable smooth follow with a short delay
  const autoEnableSmoothIfWalking = useCallback((x, z) => {
    // Smooth follow is always on, nothing to do
    try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
    try { suppressNextSmoothRef.current = false; } catch {}
    return;
  }, [followCam]);

  // When followCam is turned on elsewhere, auto-center it once
  useEffect(() => {
    if (followCam && !fullCamera) {
      centerThirdPerson();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCam, fullCamera]);

  
  // Zoom ranges (more zoom out by default; very long when fullCamera)
  const minDist = fullCamera ? 0.0001 : (isNarrow ? 10 : 9);
  const maxDist = fullCamera ? 100000 : (isNarrow ? 60 : 40);
  // Position the HUD below the navbar
  const hudTop = isNarrow ? 76 : 64;

  // No on-screen animation speed sliders; values can still be overridden via window.__CF_ANIM_SPEEDS__ if needed.

  // Compute avatar facing toward current camera position using baked per-side X offsets
  // Opponent should always be on the far side of the table from the camera
  const zSign = camPos[2] >= 0 ? -1 : 1; // camera z>0 means near side is +Z; opponent goes to -Z (and vice versa)
  const pxFixed = AVATAR_BAKED_POS[0] + ((zSign < 0) ? AVATAR_X_FRONT : AVATAR_X_BACK);
  const pzFixed = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  // Face the camera: our models/groups default to looking toward -Z, so add π to align toward the camera direction
  const yaw = Math.atan2(camPos[0] - pxFixed, camPos[2] - pzFixed) + Math.PI;
  const rotationOverride = [0, yaw, 0];
  const positionOverride = null; // position is computed inside avatar components now

  const GRID_H = ROWS * (CELL + GAP) - GAP;
  const groupY = (GRID_H + 0.6) / 2 + 0.15;
  
  // Camera target - focus on selected object when editing, otherwise board center (or player in full camera mode)
  const cameraTarget = useMemo(() => {
    // When a cube/object is selected, center camera on that object (even in fullCamera mode)
    if (selectedCubeId) {
      // Use CURRENT_PLACED_CUBES cache instead of state to avoid unnecessary recalculations
      const selectedCube = CURRENT_PLACED_CUBES.find(c => c.id === selectedCubeId);
      if (selectedCube && selectedCube.position) {
        return [selectedCube.position.x, selectedCube.position.y, selectedCube.position.z];
      }
    }
    // When editing an audio visualizer, center camera on that visualizer
    if (selectedVisualizer && audioVisualizers.length > 0) {
      const selectedViz = audioVisualizers.find(v => v.id === selectedVisualizer);
      if (selectedViz && selectedViz.position) {
        return [selectedViz.position[0], selectedViz.position[1], selectedViz.position[2]];
      }
    }
    // In full camera mode, target the player
    if (fullCamera) {
      const avatar = window.__CF_LOCAL_AVATAR__;
      if (avatar && Number.isFinite(avatar.x) && Number.isFinite(avatar.z)) {
        const playerY = (typeof avatar.lift === 'number' && avatar.lift > 0) ? avatar.lift : 5;
        return [avatar.x, playerY, avatar.z];
      }
    }
    // Default to board center
    return [0, groupY, 0];
  }, [groupY, selectedCubeId, selectedVisualizer, audioVisualizers, fullCamera]);
  
  // Compute a local Y offset so the board (base at -fh/2) rests on the table top (published by WoodenTable)
  const fhBoard = GRID_H + 0.6; // same as fh in FrontPlate/SideSupports
  const [tableTopY, setTableTopY] = useState(() => {
    const top = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(top) ? top : null;
  });
  // Use a layout effect so the listener is attached before TableFBX dispatches in its own layout effect
  useLayoutEffect(() => {
    const onReady = (e) => {
      try {
        const ty = Number(e?.detail?.topY);
        if (Number.isFinite(ty)) setTableTopY(ty);
      } catch {}
    };
    try { window.addEventListener('cf:table-ready', onReady); } catch {}
    return () => { try { window.removeEventListener('cf:table-ready', onReady); } catch {} };
  }, []);
  const boardOnTableYOffset = (() => {
    try {
      const top = (tableTopY != null) ? tableTopY : (typeof window !== 'undefined' ? Number(window.__CF_TABLE_TOP_Y__) : NaN);
      if (!Number.isFinite(top)) return 0; // fallback: leave as-is
      const epsilon = 0.02; // tiny lift to avoid z-fighting
      // Parent group is at groupY (world Y). The board subgroup's origin is centered; base is at -fh/2.
      // Solve for childY so the board base rests exactly on the tabletop: groupY + childY - fh/2 = top + epsilon
      // => childY = top + epsilon + fh/2 - groupY
      return (top + epsilon + fhBoard / 2 - groupY);
    } catch { return 0; }
  })();
  // Ensure the board starts visibly above the floor even if tabletop detection lags slightly on first paint
  const BOARD_EXTRA_LIFT = -4.0;
  const tableTopKnown = useMemo(() => {
    if (tableTopY != null && Number.isFinite(tableTopY)) return true;
    const g = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(g);
  }, [tableTopY]);

  // Player-specific avatar URLs (Player 2 shark kept for now)
  const player2Url = '/models/avatars/shark/scene.gltf';
  
  // Constant array references to prevent unnecessary re-renders
  const ZERO_POSITION = useMemo(() => [0, 0, 0], []);

  // Precompute positions for both player avatars (consistent regardless of camera side)
  const avatarZ = Math.abs(AVATAR_BAKED_POS[2]);
  const player1Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_FRONT,
    y: AVATAR_BAKED_POS[1],
    z: avatarZ, // Player 1 on +Z side facing center
    zSign: 1
  }), [avatarZ]);
  const player2Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_BACK,
    y: AVATAR_BAKED_POS[1],
    z: -avatarZ, // Player 2 on -Z side facing center
    zSign: -1
  }), [avatarZ]);
  // Determine which player is "you" based on flip180 (if flipped, Player 2 viewpoint)
  const youArePlayer2 = !!flip180;
  
  // Update ref for position broadcast (used in reconnect handler)
  useEffect(() => {
    positionBroadcastRef.current = { onAvatarMove, flip180 };
  }, [onAvatarMove, flip180]);
  
  // Listen for game loaded event (when turn toast appears) and broadcast initial position
  useEffect(() => {
    const handleGameLoaded = () => {
      // Game has fully loaded - broadcast our position so opponent sees our character
      setTimeout(() => {
        try {
          const { onAvatarMove, flip180 } = positionBroadcastRef.current;
          if (!onAvatarMove) return;
          
          const youAreP2 = !!flip180;
          const playerNum = youAreP2 ? 2 : 1;
          
          // Check if we have an actual position already (from movement/reconnect)
          const la = window.__CF_LOCAL_AVATAR__ || {};
          
          const dist = 75;
          const baseX = youAreP2 ? -dist : dist;
          const baseZ = youAreP2 ? dist : -dist;
          const baseYaw = youAreP2 ? Math.PI : 0;
          
          // Use actual position if available, otherwise use base spawn position
          const x = (typeof la.x === 'number' && la.x !== 0) ? la.x : baseX;
          const z = (typeof la.z === 'number' && la.z !== 0) ? la.z : baseZ;
          const yaw = (typeof la.yaw === 'number') ? la.yaw : baseYaw;
          const run = !!la.isRunning;
          const isJumping = !!la.isJumping;
          const lift = (typeof la.lift === 'number') ? la.lift : 0;
          
          // Update local avatar cache
          window.__CF_LOCAL_AVATAR__ = {
            x, z, yaw,
            isRunning: run,
            isJumping: isJumping,
            lift: lift,
          };
          
          // Broadcast position multiple times for reliability
          const broadcast = () => {
            onAvatarMove({ 
              player: playerNum, 
              x, 
              z, 
              yaw, 
              run, 
              isJumping, 
              lift 
            });
          };
          
          broadcast(); // Immediate
          setTimeout(broadcast, 100);
          setTimeout(broadcast, 300);
          setTimeout(broadcast, 600);
          setTimeout(broadcast, 1000);
          setTimeout(broadcast, 1500);
        } catch (err) {
          console.warn('Failed to broadcast position on game load:', err);
        }
      }, 200); // Small delay to ensure everything is ready
    };
    
    window.addEventListener('cf:gameLoaded', handleGameLoaded);
    return () => window.removeEventListener('cf:gameLoaded', handleGameLoaded);
  }, []);
  
  // State for the local player's label position (XZ), so Billboards update via React props
  const [youLabelPos, setYouLabelPos] = useState({ x: youArePlayer2 ? player2Pos.x : player1Pos.x, z: youArePlayer2 ? player2Pos.z : player1Pos.z });
  // Remote avatar position (world XZ). Start at the base position of the opponent side.
  const remoteBase = youArePlayer2 ? player1Pos : player2Pos;
  const remoteSide = youArePlayer2 ? 'Player 1' : 'Player 2';
  const [remoteLabelPos, setRemoteLabelPos] = useState({ x: remoteBase.x, z: remoteBase.z });
  const remoteRef = useRef({ x: remoteBase.x, z: remoteBase.z });

  // When the user returns to third-person (showSelf=true), seed a local pose and re-center the camera
  useEffect(() => {
    if (!showSelf) return;
    // If user enabled Full Camera, do not auto-enable follow/centering
    if (fullCamera) return;
    // If user is in edit mode (placing/moving objects), don't auto-center camera
    if (cubeEditMode) return;
    // Seed a synthetic local pose so follower/camera has a target immediately
    try {
      const base = youArePlayer2 ? { x: player2Pos.x, z: player2Pos.z } : { x: player1Pos.x, z: player1Pos.z };
      window.__CF_LOCAL_AVATAR__ = {
        x: base.x,
        z: base.z,
        yaw: youArePlayer2 ? Math.PI : 0,
        isRunning: false,
        isJumping: false,
        lift: 0,
      };
    } catch {}
    // Defer a bit so PlayerMover mounts and publishes its live position, then center
    // Skip auto-centering in free camera mode to preserve user's view
    const id = setTimeout(() => { try { if (!fullCamera && !cubeEditMode) centerThirdPerson(); } catch {} }, 160);
    return () => { try { clearTimeout(id); } catch {} };
  }, [showSelf, fullCamera, centerThirdPerson, youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z]);

  // Click-to-move target for the local player (world XZ). Separate state for P1/P2 for clarity.
  const [p1Target, setP1Target] = useState(null);
  const [p2Target, setP2Target] = useState(null);

  // Floor Y for click-plane
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fhForGround / 2 - GROUND_CLEAR;

  // Handle floor click -> set target for the current local player
  const handleFloorClick = useCallback((e) => {
    // r3f pointer event gives world point
    const pt = e?.point;
    if (!pt) return;
    try { e.stopPropagation && e.stopPropagation(); } catch {}
    try { e.preventDefault && e.preventDefault(); } catch {}
    const tx = pt.x;
    const tz = pt.z;
    // Clamp to mover radius around origin (0,0) in world XZ — PlayerMover enforces too, but we pre-clamp target
  const maxR = PLAY_AREA_RADIUS;
    const rr = Math.hypot(tx, tz);
    let cx = tx, cz = tz;
    if (rr > maxR) {
      const ang = Math.atan2(tz, tx);
      cx = Math.cos(ang) * maxR;
      cz = Math.sin(ang) * maxR;
    }
    if (youArePlayer2) setP2Target({ x: cx, z: cz }); else setP1Target({ x: cx, z: cz });
  }, [youArePlayer2]);

  const resetCamera = useCallback(() => {
    // Don't reset camera when in full camera mode - user has full control
    if (fullCamera) return;
    try {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = ctrl.object;
      cam.position.set(camPos[0], camPos[1], camPos[2]);
      ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
      ctrl.update();
    } catch {}
  }, [camPos, fullCamera]);

  // Jump helper: move local avatar to a side's base position and reset camera
  const gotoTableSide = useCallback((sideKey) => {
    try {
      const dest = sideKey === 'Player 1' ? { x: player1Pos.x, z: player1Pos.z } : { x: player2Pos.x, z: player2Pos.z };
      if (youArePlayer2) setP2Target(dest); else setP1Target(dest);
      // Disable 3rd-person follow when switching to board view
      setFollowCam(false);
      // Ensure pending timers are cleared while in board view
      try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
      lastLocalPosRef.current = { x: null, z: null };
      // Reset camera to the chosen side's initial board view (skip if in full camera mode)
      if (!fullCamera) {
        const ctrl = controlsRef.current;
        if (ctrl) {
          const cam = ctrl.object;
          const useCam = (sideKey === 'Player 1') ? camPosFront : camPosBack;
          cam.position.set(useCam[0], useCam[1], useCam[2]);
          ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
          ctrl.update();
        }
      }
    } catch {}
  }, [youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z, fullCamera]);

  // Cinematic post-processing effects for space environment
  /*
  const SpaceEffects = React.memo(function SpaceEffects() {
    return (
      <EffectComposer>
        <Bloom
          intensity={1.2}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
          radius={0.9}
        />
        
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={[0.0015, 0.0015]}
        />
        
        <Vignette
          offset={0.3}
          darkness={0.6}
          eskil={false}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    );
  });
  */

  // Canvas-aware controls wrapper to avoid constructing OrbitControls before camera exists
  // Memoized to prevent unnecessary re-renders that could reset camera position
  const Controls = React.memo(function Controls({ target, isNarrow, flip180, fullCamera, minDist, maxDist, selectedCubeId, selectedVisualizer }){
    const { camera } = useThree();
    
    useEffect(() => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const onStart = () => { try{ window.__CF_USER_ORBIT__ = true; }catch{} };
      const onEnd = () => { 
        try{ 
          // Keep __CF_USER_ORBIT__ true for a bit longer to allow final target updates
          setTimeout(() => {
            window.__CF_USER_ORBIT__ = false;
          }, 100);
          window.__CF_RESUME_FOLLOW_AT__ = Infinity;
        }catch{} 
      };
      try { 
        ctrl.addEventListener('start', onStart);
        ctrl.addEventListener('end', onEnd);
      } catch {}
      return () => { 
        try { 
          ctrl.removeEventListener('start', onStart);
          ctrl.removeEventListener('end', onEnd);
        } catch {} 
      };
    }, [fullCamera, camera]);
    
    // Prevent target AND camera orientation from being reset when in fullCamera mode
    useEffect(() => {
      if (!fullCamera || !controlsRef.current || !camera) return;
      
      const ctrl = controlsRef.current;
      // DON'T save initial state - let user freely move camera first
      let savedTarget = null;
      let savedQuaternion = null;
      let savedPosition = null;
      let hasUserMovedCamera = false;
      
      // Update saved state whenever user moves camera
      const saveState = () => {
        hasUserMovedCamera = true;
        savedTarget = ctrl.target.clone();
        savedQuaternion = camera.quaternion.clone();
        savedPosition = camera.position.clone();
      };
      
      // Override the target setter to prevent external changes
      const originalSet = ctrl.target.set.bind(ctrl.target);
      const originalCopy = ctrl.target.copy.bind(ctrl.target);
      const originalUpdate = ctrl.update.bind(ctrl);
      
      ctrl.target.set = function(...args) {
        // During sculpting, only allow user-initiated orbit changes, block automatic target changes
        if (sculptMode && !window.__CF_USER_ORBIT__) {
          return this;
        }
        // Allow changes during user interaction, when explicitly allowed, or when editing an object/visualizer
        if (window.__CF_USER_ORBIT__ || window.__CF_ALLOW_TARGET_CHANGE__ || selectedCubeId || selectedVisualizer) {
          const result = originalSet(...args);
          if (window.__CF_USER_ORBIT__) saveState();
          return result;
        }
        // Block external attempts to set the target
        return this;
      };
      
      ctrl.target.copy = function(v) {
        // During sculpting, only allow user-initiated orbit changes, block automatic target changes
        if (sculptMode && !window.__CF_USER_ORBIT__) {
          return this;
        }
        // Allow changes during user interaction, when explicitly allowed, or when editing an object/visualizer
        if (window.__CF_USER_ORBIT__ || window.__CF_ALLOW_TARGET_CHANGE__ || selectedCubeId || selectedVisualizer) {
          const result = originalCopy(v);
          if (window.__CF_USER_ORBIT__) saveState();
          return result;
        }
        // Block external attempts to copy to the target
        return this;
      };
      
      // Intercept update to save/restore camera state
      ctrl.update = function(...args) {
        if (window.__CF_USER_ORBIT__ || sculptMode) {
          const result = originalUpdate(...args);
          if (window.__CF_USER_ORBIT__) saveState();
          return result;
        }
        // Allow internal updates but restore camera orientation ONLY if user has moved camera and NOT in sculpt mode
        const result = originalUpdate(...args);
        if (!sculptMode && hasUserMovedCamera && savedTarget && savedQuaternion && savedPosition) {
          // Restore camera angle if it changed
          camera.quaternion.copy(savedQuaternion);
          camera.position.copy(savedPosition);
          originalCopy.call(ctrl.target, savedTarget); // Use original method to bypass our intercept
        }
        return result;
      };
      
      return () => {
        // Restore original methods
        ctrl.target.set = originalSet;
        ctrl.target.copy = originalCopy;
        ctrl.update = originalUpdate;
      };
    }, [fullCamera, camera, sculptMode, selectedCubeId, selectedVisualizer]);
    
    if (!camera) return null;
    
    // Build props conditionally to avoid passing target when in fullCamera mode
    const controlsProps = {
      ref: controlsRef,
      makeDefault: true,
      enablePan: fullCamera,
      panSpeed: fullCamera ? 2.0 : 1.0,
      enableKeys: false,
      enableDamping: true,
      dampingFactor: 0.12,
      minDistance: minDist,
      maxDistance: maxDist,
      enableRotate: true,
      enableZoom: true,
      zoomToCursor: fullCamera,
      zoomSpeed: fullCamera ? 0.5 : 1.0,
      // Remove ALL limits in full camera mode
      ...(fullCamera ? {
        minPolarAngle: 0,
        maxPolarAngle: Math.PI,
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: Infinity
      } : {}),
      // Add target when in edit mode (cube or visualizer) OR not in fullCamera mode
      ...((fullCamera && !selectedCubeId && !selectedVisualizer) ? {} : { target }),
      // Only add angle constraints when NOT in fullCamera or followCam mode (non-fullCamera modes)
      ...(!fullCamera && !followCam ? { 
        minPolarAngle: (isNarrow ? 0.06 : 0.08), 
        maxPolarAngle: Math.PI * 0.5,
        minAzimuthAngle: (flip180 ? Math.PI - Math.PI*0.25 : -Math.PI*0.25), 
        maxAzimuthAngle: (flip180 ? Math.PI + Math.PI*0.25 : Math.PI*0.25)
      } : {})
    };
    
    return (
      <OrbitControls key="orbit-controls-singleton" {...controlsProps} />
    );
  }, (prevProps, nextProps) => {
    // Custom comparison: when in fullCamera mode, ignore target changes to prevent re-renders
    // UNLESS selectedCubeId or selectedVisualizer changed (need to re-render to update camera target)
    if (nextProps.fullCamera) {
      return (
        prevProps.isNarrow === nextProps.isNarrow &&
        prevProps.flip180 === nextProps.flip180 &&
        prevProps.fullCamera === nextProps.fullCamera &&
        prevProps.minDist === nextProps.minDist &&
        prevProps.maxDist === nextProps.maxDist &&
        prevProps.selectedCubeId === nextProps.selectedCubeId &&
        prevProps.selectedVisualizer === nextProps.selectedVisualizer
        // Intentionally skip target comparison in fullCamera mode (unless selectedCubeId/selectedVisualizer changed)
      );
    }
    // In normal mode, compare all props including target
    return (
      prevProps.target === nextProps.target &&
      prevProps.isNarrow === nextProps.isNarrow &&
      prevProps.flip180 === nextProps.flip180 &&
      prevProps.fullCamera === nextProps.fullCamera &&
      prevProps.minDist === nextProps.minDist &&
      prevProps.maxDist === nextProps.maxDist &&
      prevProps.selectedCubeId === nextProps.selectedCubeId &&
      prevProps.selectedVisualizer === nextProps.selectedVisualizer
    );
  });

  // Simple smooth camera follower - stays behind the character
  function CameraFollower({ seedToken = 0, isPlayer2 = false, followRocket = false, rocketPositionRef = null, cameraDistance = 50, cameraHeight = 15 }){
    const { camera, gl } = useThree();
    const controlsRef = useRef();
    const smoothPos = useRef(new THREE.Vector3());
    const verticalAngle = useRef(0); // Vertical look angle (-0.3 to 0.8 radians)
    const horizontalAngle = useRef(0); // Horizontal orbit angle (full 360°)
    const isDragging = useRef(false);
    const lastMouseX = useRef(0);
    const lastMouseY = useRef(0);
    const lastPosition = useRef({ x: 0, z: 0 }); // Track last position to detect movement
    const isMoving = useRef(false);
    const wasFollowingRocket = useRef(false); // Track if we just started following rocket
    const lastCameraDistance = useRef(cameraDistance);
    const lastCameraHeight = useRef(cameraHeight);
    const isFirstFrame = useRef(true);
    const lastManualControlTime = useRef(0); // Track when user last manually controlled camera
    
    // Detect when camera settings change and skip lerp to avoid snap effect
    const settingsChanged = useRef(false);
    useEffect(() => {
      if (lastCameraDistance.current !== cameraDistance || lastCameraHeight.current !== cameraHeight) {
        settingsChanged.current = true;
        lastCameraDistance.current = cameraDistance;
        lastCameraHeight.current = cameraHeight;
      }
    }, [cameraDistance, cameraHeight]);
    
    // Find the OrbitControls
    useEffect(() => {
      const scene = camera.parent;
      if (scene) {
        scene.traverse((obj) => {
          if (obj.isOrbitControls || (obj.constructor && obj.constructor.name === 'OrbitControls')) {
            controlsRef.current = obj;
          }
        });
      }
    }, [camera]);
    
    // Mouse drag for full orbital controls
    useEffect(() => {
      const canvas = gl.domElement;
      
      const handleMouseDown = (e) => {
        if (e.button === 0) { // Left click
          isDragging.current = true;
          lastMouseX.current = e.clientX;
          lastMouseY.current = e.clientY;
        }
      };
      
      const handleMouseMove = (e) => {
        if (isDragging.current) {
          const deltaX = e.clientX - lastMouseX.current;
          const deltaY = e.clientY - lastMouseY.current;
          lastMouseX.current = e.clientX;
          lastMouseY.current = e.clientY;
          
          // Track that user is manually controlling camera
          lastManualControlTime.current = Date.now();
          
          // Horizontal: drag left/right to orbit around character (inverted for natural feel)
          horizontalAngle.current -= deltaX * 0.005;
          
          // Vertical: drag down = look up, drag up = look down
          // Full 360° control when following rocket, limited when following character
          if (followRocket) {
            verticalAngle.current -= deltaY * 0.003; // No restrictions
          } else {
            const newVertical = verticalAngle.current - deltaY * 0.003;
            // Limit look up to ~70 degrees (1.22 radians), look down to -0.5
            verticalAngle.current = Math.max(-0.5, Math.min(1.22, newVertical));
          }
        }
      };
      
      const handleMouseUp = () => {
        isDragging.current = false;
      };
      
      canvas.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, [gl]);
    
    // Initialize smooth position
    useEffect(() => {
      smoothPos.current.copy(camera.position);
    }, [camera, seedToken]);
    
    useFrame((_, dt) => {
      try {
        // Poll gamepad for camera control (right stick)
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = gamepads[0];
        
        if (gamepad) {
          const deadzone = 0.15;
          const rightX = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
          const rightY = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
          
          // Apply right stick to camera angles
          if (rightX !== 0 || rightY !== 0) {
            // Track that user is manually controlling camera
            lastManualControlTime.current = Date.now();
            
            // Horizontal: right stick left/right - DISABLED (character turning only)
            // horizontalAngle.current -= rightX * 0.3 * dt;
            
            // Vertical: right stick up/down
            if (followRocket) {
              verticalAngle.current -= rightY * 2.0 * dt; // No restrictions when following rocket
            } else {
              const newVertical = verticalAngle.current - rightY * 2.0 * dt;
              // Limit look up to ~70 degrees (1.22 radians), look down to -0.5
              verticalAngle.current = Math.max(-0.5, Math.min(1.22, newVertical));
            }
          }
        }
        
        // Rocket following mode - 3rd person free cam
        if (followRocket && rocketPositionRef && rocketPositionRef.current) {
          const rocketPos = rocketPositionRef.current;
          
          // If just started following rocket, set initial target angle
          if (!wasFollowingRocket.current) {
            horizontalAngle.current = Math.PI; // 180 degrees (opposite side)
            verticalAngle.current = 0; // Level view
            wasFollowingRocket.current = true;
          }
          
          // No angle snapping during flight - full free camera control
          
          // 3rd person camera settings
          const DISTANCE = 250; // Distance from rocket (increased for better view)
          const HEIGHT_OFFSET = 100; // Height above rocket (increased for overhead angle)
          
          // Use horizontal and vertical angles for free camera rotation
          const yaw = horizontalAngle.current;
          const pitch = verticalAngle.current;
          
          // Calculate camera position based on angles (spherical coordinates)
          const camX = rocketPos.x + Math.sin(yaw) * Math.cos(pitch) * DISTANCE;
          const camY = rocketPos.y + HEIGHT_OFFSET + Math.sin(pitch) * DISTANCE;
          const camZ = rocketPos.z + Math.cos(yaw) * Math.cos(pitch) * DISTANCE;
          
          const desiredPos = new THREE.Vector3(camX, camY, camZ);
          
          // Very slow smooth lerp for camera movement (reduced from 3.0 to 0.5)
          const alpha = Math.min(1, dt * 0.5);
          smoothPos.current.lerp(desiredPos, alpha);
          camera.position.copy(smoothPos.current);
          camera.lookAt(rocketPos);
          
          // Update orbit controls target
          const ctrl = controlsRef.current;
          if (ctrl && ctrl.target) {
            ctrl.target.copy(rocketPos);
            ctrl.update();
          }
          return;
        }
        
        // Reset flag when not following rocket
        if (wasFollowingRocket.current) {
          wasFollowingRocket.current = false;
        }
        
        // Normal character following mode
        const msg = window.__CF_LOCAL_AVATAR__;
        if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
        
        // Detect if character is moving
        const distanceMoved = Math.sqrt(
          Math.pow(msg.x - lastPosition.current.x, 2) + 
          Math.pow(msg.z - lastPosition.current.z, 2)
        );
        isMoving.current = distanceMoved > 0.1; // Higher threshold to avoid false positives from tiny jitters
        lastPosition.current = { x: msg.x, z: msg.z };
        
        // If moving and not dragging, slowly drift camera angles back to default
        // BUT only if the user hasn't manually controlled the camera in the last 5 seconds
        const timeSinceManualControl = Date.now() - lastManualControlTime.current;
        const allowAutoReset = timeSinceManualControl > 5000; // 5 second cooldown
        
        if (isMoving.current && !isDragging.current && allowAutoReset) {
          // Smoothly return vertical angle to 0 (neutral)
          verticalAngle.current = THREE.MathUtils.lerp(verticalAngle.current, 0, dt * 0.8);
          // Smoothly return horizontal angle to 0 (behind character)
          horizontalAngle.current = THREE.MathUtils.lerp(horizontalAngle.current, 0, dt * 0.8);
        }
        
        // Camera settings
        const lookUpAmount = Math.max(0, verticalAngle.current);
        
        // Moderate zoom when looking up - like other 3rd person games
        // Use settings-based camera distance
        let CAMERA_DISTANCE = cameraDistance; // Base distance from settings
        CAMERA_DISTANCE -= lookUpAmount * 25; // Zoom from base to (base-25) units when fully looking up
        
        const CAMERA_HEIGHT = cameraHeight;     // Base height above character from settings
        
        // Calculate target position (character's position)
        const feetLift = Number(msg.lift || 0);
        const baseY = ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 - GROUND_CLEAR;
        const lookAtY = baseY + feetLift + 1.5; // Look at character's upper body
        
        // Gradually tilt look target upward as we look up (slow angle tilt)
        const tiltUpAmount = lookUpAmount * 15; // Tilt up 15 units when fully looking up
        const targetPos = new THREE.Vector3(msg.x, lookAtY + tiltUpAmount, msg.z);
        
        // Get character's facing direction and add horizontal orbit angle
        const yaw = (typeof msg.yaw === 'number') ? msg.yaw : 0;
        const behindYaw = isPlayer2 ? (yaw + Math.PI) : yaw;
        const totalYaw = behindYaw + horizontalAngle.current; // Combined yaw with orbit
        
        // Calculate camera position with orbital controls
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);
        
        // When looking up, camera drops moderately - standard 3rd person behavior
        const heightAdjustment = CAMERA_HEIGHT - (lookUpAmount * 10); // Drop camera 10 units when fully looking up
        const desiredCameraPos = new THREE.Vector3(msg.x, lookAtY + heightAdjustment, msg.z)
          .addScaledVector(forward, -CAMERA_DISTANCE * Math.cos(verticalAngle.current));
        
        // NO floor clamp - allow camera to follow player down when falling off edges
        
        // Smooth lerp to desired position (instant update if settings just changed or first frame)
        let alpha = Math.min(1, dt * 3.0);
        if (settingsChanged.current || isFirstFrame.current) {
          // Instantly snap to new position when settings change or on first frame
          smoothPos.current.copy(desiredCameraPos);
          settingsChanged.current = false;
          isFirstFrame.current = false;
          alpha = 1; // Full update for orbit controls too
        } else {
          // Normal smooth lerp
          smoothPos.current.lerp(desiredCameraPos, alpha);
        }
        camera.position.copy(smoothPos.current);
        camera.lookAt(targetPos);
        
        // Update orbit controls target
        const ctrl = controlsRef.current;
        if (ctrl) {
          ctrl.target.lerp(targetPos, alpha);
          ctrl.update();
        }
      } catch (e) {
        console.error('CameraFollower error:', e);
      }
    });
    
    return null;
  }

  // Glowing clickable portal pad for local side
  function PortalPad({ position = [0,0,0], color = '#7dd3fc', onClick }) {
    const groupRef = useRef();
    const ringRef = useRef();
    const coreRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state, dt) => {
      const t = state.clock.getElapsedTime();
      // gentle rotation and pulse
      if (ringRef.current) {
        ringRef.current.rotation.z = t * 0.6;
        const s = 1.0 + Math.sin(t * 2.2) * 0.06;
        ringRef.current.scale.setScalar(s);
      }
      if (coreRef.current) {
        const o = 0.35 + (hover ? 0.25 : 0.0) + Math.max(0, Math.sin(t * 3.0)) * 0.18;
        coreRef.current.material.opacity = Math.min(0.95, o);
        const s2 = 1.0 + Math.sin(t * 2.0 + 0.7) * 0.04;
        coreRef.current.scale.setScalar(s2);
      }
    });
    return (
      <group ref={groupRef} position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Outer neon ring */}
        <mesh ref={ringRef} rotation={[-Math.PI/2, 0, 0]}
          castShadow receiveShadow>
          <ringGeometry args={[1.8, 2.2, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 1.2 : 0.85} metalness={0.35} roughness={0.4} transparent opacity={0.9} />
        </mesh>
        {/* Soft inner glow (additive) */}
        <mesh ref={coreRef} rotation={[-Math.PI/2, 0, 0]} renderOrder={1}>
          <circleGeometry args={[1.55, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Subtle vertical shimmer */}
        <mesh position={[0, 0.02, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.6, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 2.0 : 1.3} metalness={0.0} roughness={0.2} transparent opacity={0.85} />
        </mesh>
      </group>
    );
  }

  // Leave Game button (on-table, user side only when in board view)
  function LeaveButton({ position = [0,0,0], color = '#f43f5e', label = 'Leave Game', onClick }) {
    const baseRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state) => {
      const t = state.clock.getElapsedTime();
      if (baseRef.current) {
        const pulse = 0.04 + Math.max(0, Math.sin(t * 2.3)) * 0.06 + (hover ? 0.08 : 0);
        baseRef.current.material.emissiveIntensity = 0.6 + pulse;
      }
    });
    return (
      <group position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Thin pill button */}
        <mesh ref={baseRef} rotation={[-Math.PI/2, 0, 0]} castShadow receiveShadow>
          <ringGeometry args={[0.0, 1.35, 48]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} metalness={0.1} roughness={0.35} transparent opacity={0.95} />
        </mesh>
        {/* Text label above */}
        <Billboard follow={true} position={[0, 0.9, 0]}>
          <Text fontSize={1.6} color={'#fee2e2'} anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
            {label}
          </Text>
        </Billboard>
      </group>
    );
  }

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', minHeight: 520, zIndex: 1 }}>
      {/* Hot reload notification banner */}
      {hotReloadDetected && (
        <div style={{
          position: 'fixed',
          top: 'var(--nav-height, 56px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(90deg, #0891b2, #06b6d4)',
          color: '#fff',
          padding: '8px 20px',
          borderRadius: '0 0 8px 8px',
          fontWeight: 600,
          fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          animation: 'slideDown 0.3s ease-out'
        }}>
          ✓ Code updated - Models reloaded
        </div>
      )}
      
      {/* Disconnect notification */}
      {disconnectNotification && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--nav-height, 56px) + 60px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #f43f5e, #dc2626)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontWeight: 600,
          fontSize: 15,
          boxShadow: '0 6px 20px rgba(244, 63, 94, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'slideDown 0.3s ease-out'
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          {disconnectNotification}
        </div>
      )}

      {/* Reconnect notification banner */}
      {reconnectNotification && (
        <div style={{
          position: 'fixed',
          top: 'calc(var(--nav-height, 56px) + 60px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #10b981, #059669)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontWeight: 600,
          fontSize: 15,
          boxShadow: '0 6px 20px rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          animation: 'slideDown 0.3s ease-out'
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          {reconnectNotification}
        </div>
      )}
      
      
      {/* No tweak panel; avatars share identical placement */}
      <div style={{ position:'absolute', inset:0, zIndex: 1000 }}>
        {/* View button icon for Tools - centered above button */}
        <img 
          src="/controller icons/Buttons Solid/White/SVG/View.svg" 
          alt="View Button"
          style={{ 
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 56px)',
            left: 'calc(50% - 177px + 55px - 16px)', // Button left + half button width - half icon width
            width: '32px', 
            height: '32px',
            zIndex: 2147483648,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
          }}
        />
        
        {/* D-Pad Right icon for Chat - centered above button */}
        <img 
          src="/controller icons/Buttons Solid/White/SVG/D-Pad Right.svg" 
          alt="D-Pad Right"
          style={{ 
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 56px)',
            left: 'calc(50% - 59px + 55px - 16px)', // Button left + half button width - half icon width
            width: '32px', 
            height: '32px',
            zIndex: 2147483648,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
          }}
        />
        
        {/* D-Pad Up icon for Camera - centered above button */}
        <img 
          src="/controller icons/Buttons Solid/White/SVG/D-Pad Up.svg" 
          alt="D-Pad Up"
          style={{ 
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 56px)',
            left: 'calc(50% + 59px + 55px - 16px)', // Button left + half button width - half icon width
            width: '32px', 
            height: '32px',
            zIndex: 2147483648,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
          }}
        />
        
        {/* Toggle button for edit menu - centered at bottom */}
        <button 
          onClick={() => setShowEditMenu(!showEditMenu)}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% - 177px)', // Centered: 50% minus half of total width (110+8+110+8+110)/2
            zIndex: 2147483648,
            background: showEditMenu ? 'rgba(59,130,246,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (showEditMenu ? '#3b82f6' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {showEditMenu ? '⚙️ Tools On' : '⚙️ Tools Off'}
        </button>
        
        {/* Server Status Toggle - top center */}
        <button 
          onClick={() => setShowServerStatus(!showServerStatus)}
          style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            background: restartCountdown !== null && restartCountdown !== 'reconnected' 
              ? 'rgba(251,191,36,0.9)' 
              : serverStatus === 'online' ? 'rgba(34,197,94,0.9)' : serverStatus === 'offline' ? 'rgba(239,68,68,0.9)' : 'rgba(251,191,36,0.9)',
            padding: '4px 10px',
            borderRadius: 5,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span style={{ fontSize: 12 }}>
            {restartCountdown !== null && restartCountdown !== 'reconnected' 
              ? (typeof restartCountdown === 'number' ? '🔄' : restartCountdown === 'disconnected' ? '⚠️' : '🔌')
              : serverStatus === 'online' ? '🟢' : serverStatus === 'offline' ? '🔴' : '🟡'}
          </span>
          {restartCountdown !== null && restartCountdown !== 'reconnected'
            ? (typeof restartCountdown === 'number' ? `Restarting ${restartCountdown}` : restartCountdown === 'disconnected' ? 'Disconnected' : 'Reconnecting')
            : serverStatus === 'online' ? 'Online' : serverStatus === 'offline' ? 'Offline' : 'Checking'}
        </button>
        
        {/* Server Status Details Panel */}
        {showServerStatus && (
          <div style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 42px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483646,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid rgba(100, 116, 139, 0.5)',
            borderRadius: '8px',
            padding: '16px',
            minWidth: '280px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)',
            fontFamily: 'monospace',
            fontSize: 13,
            color: '#e2e8f0'
          }}>
            <div style={{ marginBottom: '12px', fontSize: 16, fontWeight: 'bold', borderBottom: '1px solid rgba(100,116,139,0.3)', paddingBottom: '8px' }}>
              🖥️ Server Status
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Status:</span>
                <span style={{ 
                  color: serverStatus === 'online' ? '#22c55e' : serverStatus === 'offline' ? '#ef4444' : '#fbbf24',
                  fontWeight: 'bold' 
                }}>
                  {serverStatus === 'online' ? '● ONLINE' : serverStatus === 'offline' ? '● OFFLINE' : '● CHECKING'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Endpoint:</span>
                <span style={{ color: '#94a3b8' }}>:3002</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Type:</span>
                <span style={{ color: '#94a3b8' }}>API + WebSocket</span>
              </div>
            </div>
            {serverStatus === 'offline' && (
              <div style={{
                marginTop: 12,
                padding: 8,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 4,
                fontSize: 11,
                color: '#fca5a5'
              }}>
                ⚠️ Server is offline. Run: npm run serve:api
              </div>
            )}
          </div>
        )}
        
        {/* Toggle button for chat UI - centered at bottom */}
        <button 
          onClick={() => setShowChatUI(!showChatUI)}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% - 59px)', // Centered
            zIndex: 2147483648,
            background: showChatUI ? 'rgba(34,197,94,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (showChatUI ? '#22c55e' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {showChatUI ? '💬 Chat On' : '💬 Chat Off'}
        </button>
        
        {/* Toggle button for camera mode - centered at bottom */}
        <button 
          onClick={() => {
            setFullCamera(prev => {
              const newFullCamera = !prev;
              // If turning ON full camera, turn OFF 3rd person
              if (newFullCamera) {
                setFollowCam(false);
              } else {
                // If turning OFF full camera, turn ON 3rd person
                setFollowCam(true);
              }
              return newFullCamera;
            });
          }}
          style={{
            position: 'fixed',
            bottom: 'calc(var(--footer-h, 52px) + 8px)',
            left: 'calc(50% + 59px)', // Centered
            zIndex: 2147483648,
            background: fullCamera ? 'rgba(168,85,247,0.9)' : 'rgba(15,23,42,0.75)',
            padding: '10px 14px',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid ' + (fullCamera ? '#a855f7' : '#334155'),
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s ease'
          }}
        >
          {fullCamera ? '📷 Full Cam' : '👤 3rd Person'}
        </button>
        
        {/* Professional Tabbed Editor Panel */}
        {showEditMenu && (
  <div style={{
            position:'fixed',
            top:'calc(var(--nav-height, 56px) + 16px)',
            left:16,
            zIndex: 2147483647,
            background:'rgba(15,23,42,0.98)',
            borderRadius:16,
            color:'#e2e8f0',
            boxShadow:'0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(148, 163, 184, 0.15)',
            backdropFilter:'blur(12px)',
            border:'1px solid rgba(148, 163, 184, 0.2)',
            width:380,
            bottom: 0,
            maxHeight: 'calc(100dvh - var(--nav-height, 56px))',
            display:'flex',
            flexDirection:'column',
            overflow:'hidden'
          }}>
          {/* Header with Tab Navigation */}
          <div style={{ 
            padding:'16px 20px 0 20px', 
            background:'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(147, 51, 234, 0.12))',
            borderBottom:'1px solid rgba(148, 163, 184, 0.15)'
          }}>
            <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', marginBottom:12 }}>
              <button 
                onClick={() => setShowEditMenu(false)}
                style={{
                  padding:'6px 10px',
                  borderRadius:6,
                  border:'1px solid rgba(148, 163, 184, 0.2)',
                  background:'rgba(30, 41, 59, 0.6)',
                  color:'#cbd5e1',
                  cursor:'pointer',
                  fontSize:11,
                  fontWeight:600
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Tab navigation - LB and RB */}
            <div style={{ 
              display:'flex', 
              justifyContent:'space-between', 
              alignItems:'center',
              marginBottom:8
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <img 
                  src="/controller icons/Buttons Solid/White/SVG/Left Bumper.svg" 
                  alt="LB"
                  style={{ 
                    width: '24px', 
                    height: '24px',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                  }}
                />
                <span style={{ fontSize:10, color:'#94a3b8', fontWeight:500 }}>Previous Tab</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:10, color:'#94a3b8', fontWeight:500 }}>Next Tab</span>
                <img 
                  src="/controller icons/Buttons Solid/White/SVG/Right Bumper.svg" 
                  alt="RB"
                  style={{ 
                    width: '24px', 
                    height: '24px',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                  }}
                />
              </div>
            </div>
            
            {/* Tab Navigation */}
            <div style={{ display:'flex', gap:4, marginBottom:-1 }}>
              {[
                { id: 'objects', label: '📦 Objects', icon: '📦' },
                { id: 'models', label: '🎨 Models', icon: '🎨' },
                { id: 'transform', label: '🔧 Transform', icon: '🔧' },
                { id: 'audio', label: '🔊 Audio', icon: '🔊' },
                { id: 'settings', label: '⚙️ Settings', icon: '⚙️' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveEditorTab(tab.id)}
                  style={{
                    flex:1,
                    padding:'12px 8px',
                    borderRadius:'8px 8px 0 0',
                    border:'none',
                    borderBottom: activeEditorTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
                    background: activeEditorTab === tab.id ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: activeEditorTab === tab.id ? '#60a5fa' : '#94a3b8',
                    cursor:'pointer',
                    fontSize:20,
                    fontWeight:600,
                    transition:'all 0.2s',
                    textAlign:'center'
                  }}
                  onMouseEnter={e => {
                    if (activeEditorTab !== tab.id) {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                      e.currentTarget.style.color = '#cbd5e1';
                    }
                  }}
                  onMouseLeave={e => {
                    if (activeEditorTab !== tab.id) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#94a3b8';
                    }
                  }}
                >
                  {tab.icon}
                </button>
              ))}
            </div>
          </div>
          
          {/* Scrollable Tab Content */}
          <div style={{ 
            flex:1,
            overflowY:'auto',
            overscrollBehavior:'contain',
            padding:'16px 20px',
            display:'flex',
            flexDirection:'column',
            gap:14,
            direction: 'rtl' // Right-to-left to put scrollbar on left
          }}>
            <div style={{ direction: 'ltr' }}> {/* Reset direction for content */}
            
            {/* OBJECTS TAB */}
            {activeEditorTab === 'objects' && (
              <>
                {/* Object Placer Section - ALWAYS AT TOP */}
                <div 
                  data-section-index="0"
                  style={{ 
                    background: selectedSectionIndex === 0
                      ? (isInSection ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)')
                      : 'rgba(5, 150, 105, 0.08)', 
                    padding:'10px', 
                    borderRadius:8,
                    border: selectedSectionIndex === 0
                      ? (isInSection ? '2px solid #22c55e' : '2px solid #3b82f6')
                      : '1px solid rgba(16, 185, 129, 0.2)',
                    boxShadow: selectedSectionIndex === 0
                      ? (isInSection ? '0 0 20px rgba(34, 197, 94, 0.5)' : '0 0 20px rgba(59, 130, 246, 0.4)')
                      : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
            <div style={{ fontWeight:600, fontSize:11, color:'#6ee7b7', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>📦 Object Placer</div>
            <label 
              style={{ 
                display:'flex', 
                alignItems:'center', 
                gap:8, 
                fontSize:11, 
                cursor:'pointer', 
                marginBottom:8,
                padding: '6px 8px',
                borderRadius: 6,
                background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 0) 
                  ? 'rgba(34, 197, 94, 0.3)' 
                  : 'transparent',
                border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 0)
                  ? '2px solid #22c55e'
                  : '2px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              <input type="checkbox" checked={cubeEditMode} onChange={e=>setCubeEditMode(e.target.checked)} style={{ cursor:'pointer' }} /> 
              <span style={{ fontWeight:500 }}>Enable editing</span>
            </label>
            
            {/* Terrain Sculpting Toggle */}
            <label
              style={{ 
                display:'flex', 
                alignItems:'center', 
                gap:8, 
                fontSize:11, 
                cursor:'pointer', 
                marginBottom:8,
                padding: '6px 8px',
                borderRadius: 6,
                background: sculptMode ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                border: sculptMode ? '2px solid #3b82f6' : '2px solid transparent',
                transition: 'all 0.2s ease'
              }}
            >
              <input type="checkbox" checked={sculptMode} onChange={e=>{ setSculptMode(e.target.checked); if(e.target.checked) setSelectedCubeId(null); }} style={{ cursor:'pointer' }} /> 
              <span style={{ fontWeight:500 }}>🎨 Terrain Sculpting</span>
            </label>
            
            {/* Sculpting Controls */}
            {sculptMode && (
              <div style={{ marginBottom:12, padding:'10px', borderRadius:8, background:'rgba(59, 130, 246, 0.1)', border:'1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ marginBottom:8 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4, fontWeight:600 }}>BRUSH SIZE: {sculptBrushSize.toFixed(1)}</div>
                  <input 
                    type="range" 
                    min="1" 
                    max="200" 
                    step="0.5" 
                    value={sculptBrushSize} 
                    onChange={e=>setSculptBrushSize(parseFloat(e.target.value))}
                    style={{ width:'100%', cursor:'pointer' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4, fontWeight:600 }}>STRENGTH: {sculptStrength.toFixed(2)}</div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="2" 
                    step="0.1" 
                    value={sculptStrength} 
                    onChange={e=>setSculptStrength(parseFloat(e.target.value))}
                    style={{ width:'100%', cursor:'pointer' }}
                  />
                </div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:8, fontStyle:'italic' }}>
                  Hover over terrain • ] Raise • [ Lower
                </div>
                <div style={{ 
                  marginTop:10, 
                  paddingTop:10, 
                  borderTop:'1px solid rgba(148, 163, 184, 0.2)',
                  display:'flex',
                  justifyContent:'space-between',
                  alignItems:'center'
                }}>
                  <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>
                    UNDO AVAILABLE: {sculptHistory.length}
                  </div>
                  <button
                    onClick={undoSculpt}
                    disabled={sculptHistory.length === 0}
                    style={{
                      padding:'4px 10px',
                      borderRadius:4,
                      border:'1px solid rgba(59, 130, 246, 0.5)',
                      background: sculptHistory.length > 0 ? 'rgba(59, 130, 246, 0.3)' : 'rgba(100, 100, 100, 0.2)',
                      color: sculptHistory.length > 0 ? '#ffffff' : '#64748b',
                      fontSize:10,
                      fontWeight:600,
                      cursor: sculptHistory.length > 0 ? 'pointer' : 'not-allowed',
                      transition:'all 0.2s'
                    }}
                  >
                    ↶ UNDO (Ctrl+Z)
                  </button>
                </div>
                <button
                  onClick={clearAllSculpts}
                  disabled={!selectedCubeId || !placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)}
                  style={{
                    marginTop:8,
                    width:'100%',
                    padding:'6px 10px',
                    borderRadius:4,
                    border:'1px solid rgba(239, 68, 68, 0.5)',
                    background: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0) 
                      ? 'rgba(239, 68, 68, 0.3)' 
                      : 'rgba(100, 100, 100, 0.2)',
                    color: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)
                      ? '#ffffff' 
                      : '#64748b',
                    fontSize:10,
                    fontWeight:600,
                    cursor: selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain && c.heightModifications && c.heightModifications.length > 0)
                      ? 'pointer' 
                      : 'not-allowed',
                    transition:'all 0.2s'
                  }}
                >
                  🗑️ CLEAR ALL SCULPTS ON SELECTED
                </button>
              </div>
            )}
            
            {cubeEditMode && (
              <>
                {/* Collision Shapes */}
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6, fontWeight:600 }}>COLLISION SHAPES</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4 }}>
                    <button 
                      onClick={() => addCube('box', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      📦 Cube
                    </button>
                    <button 
                      onClick={() => addCube('sphere', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      🔮 Sphere
                    </button>
                    <button 
                      onClick={() => addCube('cylinder', 'none')}
                      style={{ 
                        padding:'8px 6px', 
                        borderRadius:6, 
                        border: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? '2px solid #22c55e'
                          : '1px solid rgba(16, 185, 129, 0.3)',
                        background: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? 'rgba(34, 197, 94, 0.3)'
                          : 'rgba(6, 78, 59, 0.5)',
                        color:'#ffffff', 
                        cursor:'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)
                          ? '0 0 10px rgba(34, 197, 94, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.8)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 0 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(6, 78, 59, 0.5)';
                        }
                      }}
                    >
                      🛢️ Cylinder
                    </button>
                  </div>
                  
                  {/* AI Box Button - Separate row for emphasis */}
                  <div style={{ marginTop:8 }}>
                    <button 
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        
                        const newAIBox = {
                          id: Date.now() + Math.random(),
                          shape: 'box',
                          isAIBox: true,
                          aiBoxLabel: `AI Box #${Math.floor(Math.random() * 9999)}`,
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: false,
                          walkableTop: false,
                          color: '#22d3ee',
                          opacity: 0.15,
                          wireframe: true,
                          aiContent: null
                        };
                        setPlacedCubes(prevCubes => [...prevCubes, newAIBox]);
                        setSelectedCubeId(newAIBox.id);
                        console.log(`🤖 Created AI Box with ID: ${newAIBox.id}, Label: ${newAIBox.aiBoxLabel}`);
                      }}
                      style={{ 
                        width: '100%',
                        padding:'10px 8px', 
                        borderRadius:6, 
                        border: '2px solid rgba(34, 211, 238, 0.5)',
                        background: 'rgba(6, 182, 212, 0.2)',
                        color:'#22d3ee', 
                        cursor:'pointer',
                        fontSize: 11,
                        fontWeight: 700,
                        transition:'all 0.2s',
                        boxShadow: '0 0 15px rgba(34, 211, 238, 0.3)'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(6, 182, 212, 0.4)';
                        e.currentTarget.style.boxShadow = '0 0 20px rgba(34, 211, 238, 0.5)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)';
                        e.currentTarget.style.boxShadow = '0 0 15px rgba(34, 211, 238, 0.3)';
                      }}
                    >
                      🤖 AI Box (Copilot)
                    </button>
                  </div>
                </div>

                {/* Placed Objects List */}
                <div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>PLACED OBJECTS ({placedCubes.filter(c => !c.isTerrain).length})</div>
                    <button
                      onClick={cleanupOrphanedCollisions}
                      style={{
                        padding:'3px 6px',
                        background:'rgba(239, 68, 68, 0.2)',
                        border:'1px solid rgba(239, 68, 68, 0.4)',
                        borderRadius:4,
                        color:'#fca5a5',
                        cursor:'pointer',
                        fontSize:8,
                        fontWeight:600,
                        transition:'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                      title="Remove orphaned collision objects whose parents were deleted"
                    >
                      🧹 Cleanup
                    </button>
                  </div>
                  <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid rgba(148, 163, 184, 0.1)', borderRadius:6, padding:4, background:'rgba(15, 23, 42, 0.3)' }}>
                    {placedCubes.filter(c => !c.isTerrain).length === 0 ? (
                      <div style={{ padding:12, color:'#64748b', fontSize:10, textAlign:'center' }}>No objects placed</div>
                    ) : (
                      placedCubes.filter(cube => !cube.parentId && !cube.isTerrain).map((cube, idx) => {
                        const childCollision = placedCubes.find(c => c.parentId === cube.id);
                        const itemIndex = 4 + idx; // Items 4+ are placed objects
                        const isSelected = selectedSectionIndex === 0 && isInSection && selectedItemIndex === itemIndex;
                        const isInThisSubMenu = isInSubMenu && isSelected; // Are we navigating inside THIS object's sub-menu?
                        
                        return (
                          <div key={cube.id} style={{ marginBottom:4 }} data-placed-object-index={itemIndex}>
                            <div 
                              onClick={() => setSelectedCubeId(cube.id)}
                              style={{
                                padding:'8px',
                                borderRadius:6,
                                border: isSelected 
                                  ? '2px solid #22c55e'
                                  : selectedCubeId === cube.id ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.15)',
                                background: isSelected
                                  ? 'rgba(34, 197, 94, 0.3)'
                                  : selectedCubeId === cube.id ? 'rgba(6, 78, 59, 0.4)' : 'rgba(15, 23, 42, 0.4)',
                                boxShadow: isSelected ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none',
                                cursor:'pointer',
                                fontSize:10,
                                transition:'all 0.2s'
                              }}
                            >
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                            <span style={{ fontWeight:600, color: cube.isAIBox ? '#22d3ee' : '#e2e8f0' }}>
                              {cube.isAIBox ? `🤖 ${cube.aiBoxLabel || 'AI Box'}` :
                               cube.modelType === 'custom' ? `📦 ${cube.customModelName || 'Custom Model'}` :
                               cube.modelType === 'asteroid' ? '🪨 Asteroid' : 
                               cube.modelType === 'table' ? '🪑 Table' :
                               cube.modelType === 'rover' ? '🚗 Rover' :
                               cube.modelType === 'stairs2' ? '🪜 Stairs2' :
                               cube.shape === 'sphere' ? '🔮 Sphere' :
                               cube.shape === 'cylinder' ? '🛢️ Cylinder' : '📦 Cube'} #{idx + 1}
                            </span>
                            <div style={{ display:'flex', gap:4 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); duplicateCube(cube.id); }}
                                style={{ 
                                  padding:'2px 6px', 
                                  borderRadius:4, 
                                  border: (isInThisSubMenu && selectedSubItemIndex === 0) ? '2px solid #22c55e' : '1px solid rgba(148, 163, 184, 0.2)', 
                                  background: (isInThisSubMenu && selectedSubItemIndex === 0) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(30, 41, 59, 0.6)', 
                                  color:'#cbd5e1', 
                                  fontSize:9,
                                  boxShadow: (isInThisSubMenu && selectedSubItemIndex === 0) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                  transition:'all 0.2s'
                                }}
                                title="Duplicate"
                              >
                                📋
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteCube(cube.id); }}
                                style={{ 
                                  padding:'2px 6px', 
                                  borderRadius:4, 
                                  border: (isInThisSubMenu && selectedSubItemIndex === 1) ? '2px solid #22c55e' : '1px solid rgba(220, 38, 38, 0.3)', 
                                  background: (isInThisSubMenu && selectedSubItemIndex === 1) ? 'rgba(34, 197, 94, 0.4)' : 'rgba(127, 29, 29, 0.6)', 
                                  color:'#fecaca', 
                                  fontSize:9,
                                  boxShadow: (isInThisSubMenu && selectedSubItemIndex === 1) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                  transition:'all 0.2s'
                                }}
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize:9, color:'#94a3b8', marginBottom:4 }}>
                            {cube.modelType && cube.modelType !== 'none' ? `Model: ${cube.modelType}` : 
                             cube.shape === 'sphere' ? 'Spherical' :
                             cube.shape === 'cylinder' ? 'Cylindrical' : 'Box'} • Pos: ({cube.position.x.toFixed(1)}, {cube.position.y.toFixed(1)}, {cube.position.z.toFixed(1)})
                          </div>
                          <div style={{ display:'flex', gap:8 }}>
                            <label 
                              style={{ 
                                display:'flex', 
                                alignItems:'center', 
                                gap:4, 
                                fontSize:9,
                                padding:'2px 4px',
                                borderRadius:3,
                                border: (isInThisSubMenu && selectedSubItemIndex === 2) ? '2px solid #22c55e' : 'none',
                                background: (isInThisSubMenu && selectedSubItemIndex === 2) ? 'rgba(34, 197, 94, 0.3)' : 'transparent',
                                boxShadow: (isInThisSubMenu && selectedSubItemIndex === 2) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                transition:'all 0.2s'
                              }} 
                              onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox" 
                                checked={cube.hasCollision} 
                                onChange={(e) => { e.stopPropagation(); updateCubeAndSync(cube.id, { hasCollision: e.target.checked }); }} 
                                style={{ cursor:'pointer' }}
                              /> 
                              Collision
                            </label>
                            <label 
                              style={{ 
                                display:'flex', 
                                alignItems:'center', 
                                gap:4, 
                                fontSize:9, 
                                opacity:!cube.hasCollision?0.5:1,
                                padding:'2px 4px',
                                borderRadius:3,
                                border: (isInThisSubMenu && selectedSubItemIndex === 3) ? '2px solid #22c55e' : 'none',
                                background: (isInThisSubMenu && selectedSubItemIndex === 3) ? 'rgba(34, 197, 94, 0.3)' : 'transparent',
                                boxShadow: (isInThisSubMenu && selectedSubItemIndex === 3) ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                                transition:'all 0.2s'
                              }} 
                              onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox" 
                                checked={cube.walkableTop || false} 
                                onChange={(e) => { e.stopPropagation(); updateCubeAndSync(cube.id, { walkableTop: e.target.checked }); }} 
                                disabled={!cube.hasCollision}
                                style={{ cursor:'pointer' }}
                              /> 
                              Walkable
                            </label>
                          </div>
                          
                          {/* Collision Layer - for custom models */}
                          {cube.modelType === 'custom' && (() => {
                            // Find existing collision layer for this model
                            const existingCollision = placedCubes.find(c => c.parentId === cube.id);
                            
                            // Debug: log collision properties
                            if (existingCollision) {
                              console.log('[Collision Debug]', {
                                parentId: cube.id,
                                shape: existingCollision.shape,
                                hasCollision: existingCollision.hasCollision,
                                walkableTop: existingCollision.walkableTop
                              });
                            }
                            
                            return (
                              <div style={{ marginTop:6, padding:4, background:'rgba(147, 51, 234, 0.08)', borderRadius:4, borderLeft:'2px solid rgba(147, 51, 234, 0.4)' }} onClick={(e) => e.stopPropagation()}>
                                <div style={{ fontSize:8, color:'#c084fc', fontWeight:600, marginBottom:3 }}>
                                  {existingCollision ? '🛡️ Collision' : '➕ Add Collision'}
                                </div>
                                
                                {/* Shape Toggle Buttons */}
                                <div style={{ display:'flex', gap:2, marginBottom: existingCollision ? 3 : 0 }}>
                                  {[
                                    { shape: 'box', icon: '📦', subIndex: 4 },
                                    { shape: 'sphere', icon: '⚽', subIndex: 5 },
                                    { shape: 'cylinder', icon: '🥫', subIndex: 6 }
                                  ].map(({ shape, icon, subIndex }) => {
                                    const isSubItemSelected = isInThisSubMenu && selectedSubItemIndex === subIndex;
                                    return (
                                      <button
                                        key={shape}
                                        onClick={(e) => { 
                                          e.stopPropagation(); 
                                          
                                          // Use actual model bounds if available, otherwise estimate
                                          const bounds = cube.modelBounds || { width: 100, height: 100, depth: 100 };
                                          const scaleX = cube.scale.x || 0.1;
                                          const scaleY = cube.scale.y || 0.1;
                                          const scaleZ = cube.scale.z || 0.1;
                                          
                                          // Actual world size = modelBounds * scale
                                          const worldWidth = bounds.width * scaleX;
                                          const worldHeight = bounds.height * scaleY;
                                          const worldDepth = bounds.depth * scaleZ;
                                          
                                          if (existingCollision) {
                                            // Update existing collision to new shape
                                            updateCubeAndSync(existingCollision.id, { 
                                              shape,
                                              scale: { 
                                                x: worldWidth, 
                                                y: worldHeight, 
                                                z: worldDepth 
                                              }
                                            });
                                            // Keep parent selected, don't switch to collision
                                          } else {
                                            // Create new collision layer
                                            const newId = `collision-${cube.id}-${Date.now()}`;
                                            const newCube = {
                                              id: newId,
                                              shape,
                                              modelType: 'none',
                                              position: { ...cube.position },
                                              rotation: { x: 0, y: 0, z: 0 },
                                              scale: { 
                                                x: worldWidth, 
                                                y: worldHeight, 
                                                z: worldDepth 
                                              },
                                              color: '#a855f7',
                                              hasCollision: true,
                                              walkableTop: false,
                                              parentId: cube.id,
                                              followParentScale: true
                                            };
                                            
                                            const newCubes = [...placedCubes, newCube];
                                            setPlacedCubes(newCubes);
                                            // Keep parent selected, don't switch to collision
                                            sendCubeUpdate(newCubes);
                                          }
                                        }}
                                      style={{
                                        flex:1,
                                        padding:'4px 2px',
                                        borderRadius:3,
                                        border: isSubItemSelected ? '2px solid #22c55e' : existingCollision?.shape === shape ? '1px solid #a855f7' : '1px solid rgba(147, 51, 234, 0.3)',
                                        background: isSubItemSelected ? 'rgba(34, 197, 94, 0.4)' : existingCollision?.shape === shape ? 'rgba(147, 51, 234, 0.4)' : 'rgba(147, 51, 234, 0.15)',
                                        color: '#e9d5ff',
                                        fontSize:8,
                                        fontWeight:600,
                                        cursor:'pointer',
                                        transition:'all 0.2s',
                                        boxShadow: isSubItemSelected ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none'
                                      }}
                                      onMouseEnter={e => {
                                        if (!isSubItemSelected) {
                                          e.currentTarget.style.background = 'rgba(147, 51, 234, 0.5)';
                                        }
                                      }}
                                      onMouseLeave={e => {
                                        if (!isSubItemSelected) {
                                          e.currentTarget.style.background = existingCollision?.shape === shape ? 'rgba(147, 51, 234, 0.4)' : 'rgba(147, 51, 234, 0.15)';
                                        }
                                      }}
                                    >
                                      {icon}
                                    </button>
                                  );
                                })}
                                {existingCollision && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteCube(existingCollision.id);
                                    }}
                                    style={{
                                      flex:0.5,
                                      padding:'4px 2px',
                                      borderRadius:3,
                                      border: '1px solid rgba(220, 38, 38, 0.3)',
                                      background: 'rgba(127, 29, 29, 0.5)',
                                      color: '#fca5a5',
                                      fontSize:8,
                                      cursor:'pointer',
                                      transition:'all 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)'}
                                    title="Remove Collision"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                              
                              {existingCollision && (
                                <div 
                                  onClick={(e) => { e.stopPropagation(); setSelectedCubeId(existingCollision.id); }}
                                  style={{
                                    marginTop:2,
                                    marginLeft:8,
                                    padding:'4px 6px',
                                    borderRadius:4,
                                    border: selectedCubeId === existingCollision.id ? '1px solid #a855f7' : '1px solid rgba(147, 51, 234, 0.2)',
                                    background: selectedCubeId === existingCollision.id ? 'rgba(147, 51, 234, 0.2)' : 'rgba(147, 51, 234, 0.08)',
                                    cursor:'pointer',
                                    fontSize:8,
                                    color:'#c084fc',
                                    transition:'all 0.2s'
                                  }}
                                >
                                  ↳ {existingCollision.shape === 'box' ? '📦 Box' : existingCollision.shape === 'sphere' ? '⚽ Sphere' : '🥫 Cylinder'} Collision
                                  <label style={{ display:'inline', marginLeft:6 }} onClick={(e) => e.stopPropagation()}>
                                    <input 
                                      type="checkbox" 
                                      checked={existingCollision.walkableTop || false} 
                                      onChange={(e) => { e.stopPropagation(); updateCubeAndSync(existingCollision.id, { walkableTop: e.target.checked }); }} 
                                      style={{ cursor:'pointer' }}
                                    /> 
                                    <span style={{ fontSize:7 }}>Walkable</span>
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                          })()}
                        </div>
                      </div>
                    );
                  })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          
                {/* Collision Shapes Section */}
                <div 
                  data-section-index="1"
                  style={{ 
                    background: selectedSectionIndex === 1
                      ? (isInSection ? 'rgba(34, 197, 94, 0.15)' : 'rgba(59, 130, 246, 0.15)')
                      : 'rgba(239, 68, 68, 0.08)', 
                    padding:'14px', 
                    borderRadius:10,
                    border: selectedSectionIndex === 1
                      ? (isInSection ? '2px solid #22c55e' : '2px solid #3b82f6')
                      : '1px solid rgba(239, 68, 68, 0.2)',
                    boxShadow: selectedSectionIndex === 1
                      ? (isInSection ? '0 0 20px rgba(34, 197, 94, 0.5)' : '0 0 20px rgba(59, 130, 246, 0.4)')
                      : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:12, color:'#fca5a5', marginBottom:10 }}>🛡️ Collision Shapes</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'box',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#ef4444',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(239, 68, 68, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(127, 29, 29, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)) {
                          e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 0)) {
                          e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)';
                        }
                      }}
                    >
                      📦 Box
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'sphere',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#f59e0b',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(245, 158, 11, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(120, 53, 15, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(120, 53, 15, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 1)) {
                          e.currentTarget.style.background = 'rgba(120, 53, 15, 0.5)';
                        }
                      }}
                    >
                      ⚫ Sphere
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'cylinder',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#8b5cf6',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(139, 92, 246, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(76, 29, 149, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(76, 29, 149, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 2)) {
                          e.currentTarget.style.background = 'rgba(76, 29, 149, 0.5)';
                        }
                      }}
                    >
                      🔵 Cylinder
                    </button>
                    <button
                      onClick={() => {
                        const avatar = window.__CF_LOCAL_AVATAR__ || {};
                        const playerX = avatar.x || 0;
                        const playerZ = avatar.z || 0;
                        const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                        const playerYaw = avatar.yaw || 0;
                        const spawnDistance = 15;
                        const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                        const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                        const newCollision = {
                          id: Date.now() + Math.random(),
                          shape: 'capsule',
                          position: { x: spawnX, y: playerY, z: spawnZ },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 10, y: 10, z: 10 },
                          hasCollision: true,
                          walkableTop: false,
                          color: '#06b6d4',
                          opacity: 0.3
                        };
                        const newCubes = [...placedCubes, newCollision];
                        setPlacedCubes(newCubes);
                        setSelectedCubeId(newCollision.id);
                        sendCubeUpdate(newCubes);
                      }}
                      style={{
                        padding:'10px',
                        borderRadius:8,
                        border: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(6, 182, 212, 0.3)',
                        background: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? 'rgba(59, 130, 246, 0.3)'
                          : 'rgba(8, 51, 68, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:10,
                        fontWeight:600,
                        transition:'all 0.2s',
                        boxShadow: (selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)
                          ? '0 0 15px rgba(59, 130, 246, 0.5)'
                          : 'none'
                      }}
                      onMouseEnter={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(8, 51, 68, 0.7)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedSectionIndex === 1 && isInSection && selectedItemIndex === 3)) {
                          e.currentTarget.style.background = 'rgba(8, 51, 68, 0.5)';
                        }
                      }}
                    >
                      💊 Capsule
                    </button>
                  </div>
                </div>

                {/* Terrain Builder Section */}
                <div 
                  style={{ 
                    background: 'rgba(34, 197, 94, 0.08)', 
                    padding:'14px', 
                    borderRadius:10,
                    border:'1px solid rgba(34, 197, 94, 0.2)',
                    marginTop: 8
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:12, color:'#6ee7b7', marginBottom:10 }}>🏔️ Terrain Builder</div>
                  
                  {/* Create New Terrain Button */}
                  <button
                    onClick={() => {
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                      
                      // Create terrain 10 units below player's feet
                      const terrainY = playerY - 10;
                      
                      const newTerrain = {
                        id: Date.now() + Math.random(),
                        shape: 'box',
                        isTerrain: true,
                        position: { x: playerX, y: terrainY, z: playerZ },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 50, y: 2.0, z: 50 }, // 2.0 height like platforms
                        hasCollision: true,
                        walkableTop: true,
                        color: '#22c55e',
                        opacity: 1,
                        texture: null, // Start with no texture (green) - user can select one
                        terrainHeight: 2.0,
                        textureRepeat: 10, // Texture tiling ratio (higher = more tiles)
                        // Terrain generation settings
                        hasTerrainNoise: false, // Start flat, user can enable
                        terrainSegments: 100, // Resolution of terrain mesh
                        terrainScale: 0.015, // Noise scale for hills
                        terrainHeightMultiplier: 8, // Height of small hills
                        terrainMoundScale: 0.008, // Scale for larger mounds
                        terrainMoundMultiplier: 15, // Height of large mounds
                        terrainOctaves: 4, // Fractal noise octaves
                        terrainEdgeBlend: 0.25 // How much of the edge to blend (0.1 = 10%, 0.5 = 50%)
                      };
                      const newCubes = [...placedCubes, newTerrain];
                      setPlacedCubes(newCubes);
                      setSelectedCubeId(newTerrain.id);
                      sendCubeUpdate(newCubes);
                    }}
                    style={{
                      width: '100%',
                      padding:'12px',
                      borderRadius:8,
                      border:'1px solid rgba(34, 197, 94, 0.3)',
                      background:'rgba(22, 163, 74, 0.3)',
                      color:'#ffffff',
                      cursor:'pointer',
                      fontSize:11,
                      fontWeight:600,
                      transition:'all 0.2s',
                      marginBottom: 10
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(22, 163, 74, 0.5)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(22, 163, 74, 0.3)'}
                  >
                    ➕ Create New Terrain
                  </button>

                  {/* Terrain Editor - Only show if a terrain is selected */}
                  {selectedCubeId && placedCubes.find(c => c.id === selectedCubeId && c.isTerrain) && (() => {
                    const selectedTerrain = placedCubes.find(c => c.id === selectedCubeId);
                    return (
                      <div style={{ 
                        padding: '10px', 
                        background: 'rgba(22, 163, 74, 0.15)', 
                        borderRadius: 8,
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        marginBottom: 10
                      }}>
                        <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 8, fontWeight: 600 }}>
                          🎨 Editing: Terrain #{selectedCubeId.toString().slice(-4)}
                        </div>

                        {/* Height Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Height: {selectedTerrain.scale?.y || 1}
                          </label>
                          <input 
                            type="range"
                            min="0.1"
                            max="20"
                            step="0.1"
                            value={selectedTerrain.scale?.y || 1}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newHeight = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  y: newHeight 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Width Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Width: {selectedTerrain.scale?.x || 50}
                          </label>
                          <input 
                            type="range"
                            min="5"
                            max="200"
                            step="5"
                            value={selectedTerrain.scale?.x || 50}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newWidth = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  x: newWidth 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Depth Slider */}
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Depth: {selectedTerrain.scale?.z || 50}
                          </label>
                          <input 
                            type="range"
                            min="5"
                            max="200"
                            step="5"
                            value={selectedTerrain.scale?.z || 50}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newDepth = parseFloat(e.target.value);
                              updateCubeAndSync(selectedCubeId, { 
                                scale: { 
                                  ...(selectedTerrain.scale || { x: 50, y: 1, z: 50 }),
                                  z: newDepth 
                                }
                              });
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            style={{
                              width: '100%',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'rgba(148, 163, 184, 0.2)',
                              cursor: 'pointer'
                            }}
                          />
                        </div>

                        {/* Texture Selector */}
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                            Terrain Texture
                          </label>
                          <select
                            value={selectedTerrain.texture || ''}
                            onChange={(e) => {
                              const newTexture = e.target.value === '' ? null : e.target.value;
                              console.log('[TEXTURE SELECTOR] 🎨 User changed texture to:', newTexture, 'for cube:', selectedCubeId);
                              console.log('[TEXTURE SELECTOR] 🔍 Current cube before update:', placedCubes.find(c => c.id === selectedCubeId));
                              updateCubeAndSync(selectedCubeId, { texture: newTexture });
                              // Check state after a tick
                              setTimeout(() => {
                                const updated = placedCubes.find(c => c.id === selectedCubeId);
                                console.log('[TEXTURE SELECTOR] 🔍 Cube after update (1 tick):', updated);
                                console.log('[TEXTURE SELECTOR] 🔍 Texture in state:', updated?.texture);
                              }, 100);
                            }}
                            style={{
                              width: '100%',
                              padding: '6px',
                              borderRadius: 6,
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              background: '#1e293b',
                              color: '#ffffff',
                              fontSize: 10,
                              cursor: 'pointer'
                            }}
                          >
                            <option value="">🟢 No Texture (Green)</option>
                            <option value="/textures/lunar_surface.png">🌙 Lunar Surface</option>
                            <option value="/textures/metal_floor.png">🔩 Metal Floor</option>
                            <option value="/textures/metal_stairs.png">🪜 Metal Stairs</option>
                          </select>
                        </div>

                        {/* Texture Tiling Control */}
                        {selectedTerrain.texture && (
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                              Texture Tiling: {selectedTerrain.textureRepeat || 10}x
                            </label>
                            <input
                              type="range"
                              min="1"
                              max="50"
                              step="1"
                              value={selectedTerrain.textureRepeat || 10}
                              onChange={(e) => {
                                updateCubeAndSync(selectedCubeId, { textureRepeat: parseInt(e.target.value) });
                              }}
                              style={{
                                width: '100%',
                                height: '6px',
                                borderRadius: '3px',
                                background: 'rgba(148, 163, 184, 0.2)',
                                cursor: 'pointer'
                              }}
                            />
                          </div>
                        )}

                        {/* Terrain Generation Toggle */}
                        <div style={{ marginBottom: 8, padding: 8, background: 'rgba(34, 197, 94, 0.1)', borderRadius: 6 }}>
                          <label style={{ fontSize: 10, color: '#22c55e', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selectedTerrain.hasTerrainNoise || false}
                              onChange={(e) => {
                                // When enabling terrain generation, also enable collision and walkability
                                updateCubeAndSync(selectedCubeId, { 
                                  hasTerrainNoise: e.target.checked,
                                  hasCollision: e.target.checked ? true : selectedTerrain.hasCollision,
                                  walkableTop: e.target.checked ? true : selectedTerrain.walkableTop
                                });
                              }}
                              style={{ marginRight: 6, cursor: 'pointer' }}
                            />
                            🏔️ Enable Terrain Generation
                          </label>
                        </div>

                        {/* Terrain Generation Controls - Only show if enabled */}
                        {selectedTerrain.hasTerrainNoise && (
                          <div style={{ padding: 8, background: 'rgba(34, 197, 94, 0.05)', borderRadius: 6, marginBottom: 8 }}>
                            <div style={{ fontSize: 9, color: '#22c55e', marginBottom: 8, fontWeight: 'bold' }}>
                              Terrain Generation
                            </div>

                            {/* Terrain Resolution */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Resolution: {selectedTerrain.terrainSegments || 100}
                              </label>
                              <input
                                type="range"
                                min="50"
                                max="200"
                                step="10"
                                value={selectedTerrain.terrainSegments || 100}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainSegments: parseInt(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Hill Height */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Hill Height: {selectedTerrain.terrainHeightMultiplier || 8}
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="20"
                                step="1"
                                value={selectedTerrain.terrainHeightMultiplier || 8}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainHeightMultiplier: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Hill Scale (Frequency) */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Hill Frequency: {(selectedTerrain.terrainScale || 0.015).toFixed(3)}
                              </label>
                              <input
                                type="range"
                                min="0.005"
                                max="0.05"
                                step="0.001"
                                value={selectedTerrain.terrainScale || 0.015}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainScale: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Mound Height */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Mound Height: {selectedTerrain.terrainMoundMultiplier || 15}
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="30"
                                step="1"
                                value={selectedTerrain.terrainMoundMultiplier || 15}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainMoundMultiplier: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Mound Scale */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Mound Frequency: {(selectedTerrain.terrainMoundScale || 0.008).toFixed(3)}
                              </label>
                              <input
                                type="range"
                                min="0.002"
                                max="0.02"
                                step="0.001"
                                value={selectedTerrain.terrainMoundScale || 0.008}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainMoundScale: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Octaves (Detail) */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Detail (Octaves): {selectedTerrain.terrainOctaves || 4}
                              </label>
                              <input
                                type="range"
                                min="1"
                                max="8"
                                step="1"
                                value={selectedTerrain.terrainOctaves || 4}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainOctaves: parseInt(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>

                            {/* Edge Blend */}
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>
                                Edge Smoothness: {((selectedTerrain.terrainEdgeBlend || 0.25) * 100).toFixed(0)}%
                              </label>
                              <input
                                type="range"
                                min="0.05"
                                max="0.5"
                                step="0.05"
                                value={selectedTerrain.terrainEdgeBlend || 0.25}
                                onChange={(e) => {
                                  updateCubeAndSync(selectedCubeId, { terrainEdgeBlend: parseFloat(e.target.value) });
                                }}
                                style={{ width: '100%' }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Walkable Checkbox */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#cbd5e1', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={selectedTerrain.walkableTop || false} 
                            onChange={(e) => updateCubeAndSync(selectedCubeId, { walkableTop: e.target.checked })}
                            style={{ cursor: 'pointer' }}
                          /> 
                          <span>Walkable Surface</span>
                        </label>
                      </div>
                    );
                  })()}

                  {/* Terrain List */}
                  <div style={{ 
                    padding: '8px', 
                    background: 'rgba(22, 163, 74, 0.08)', 
                    borderRadius: 8,
                    border: '1px solid rgba(34, 197, 94, 0.2)'
                  }}>
                    <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 6, fontWeight: 600 }}>
                      🗺️ Terrain Pieces ({placedCubes.filter(c => c.isTerrain).length})
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                      {placedCubes.filter(c => c.isTerrain).length === 0 ? (
                        <div style={{ padding: 8, color: '#64748b', fontSize: 9, textAlign: 'center' }}>
                          No terrain created yet
                        </div>
                      ) : (
                        placedCubes.filter(c => c.isTerrain).map((terrain, idx) => (
                          <div
                            key={terrain.id}
                            onClick={() => setSelectedCubeId(terrain.id)}
                            style={{
                              padding: '6px 8px',
                              marginBottom: 4,
                              borderRadius: 6,
                              border: selectedCubeId === terrain.id ? '2px solid #22c55e' : '1px solid rgba(34, 197, 94, 0.2)',
                              background: selectedCubeId === terrain.id ? 'rgba(34, 197, 94, 0.25)' : 'rgba(22, 163, 74, 0.1)',
                              cursor: 'pointer',
                              fontSize: 9,
                              color: '#e2e8f0',
                              transition: 'all 0.2s',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <span>
                              🏔️ Terrain #{idx + 1}
                              <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 8 }}>
                                {terrain.scale?.x || 50}×{terrain.scale?.z || 50}
                              </span>
                            </span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); duplicateCube(terrain.id); }}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(148, 163, 184, 0.2)',
                                  background: 'rgba(30, 41, 59, 0.6)',
                                  color: '#cbd5e1',
                                  fontSize: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)'}
                                title="Duplicate Terrain"
                              >
                                📋
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteCube(terrain.id); }}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  background: 'rgba(127, 29, 29, 0.5)',
                                  color: '#fca5a5',
                                  fontSize: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.7)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(127, 29, 29, 0.5)'}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
          
              </>
            )}
            
            {/* MODELS TAB */}
            {activeEditorTab === 'models' && (
              <>
                <div style={{ 
                  background:'rgba(168, 85, 247, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(168, 85, 247, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#c084fc', marginBottom:10 }}>🎨 Model Library</div>
                  
                  {/* Model Selector Dropdown */}
                  <select 
                    value={selectedModelToLoad || ''} 
                    onChange={(e) => setSelectedModelToLoad(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      background: '#1e293b',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginBottom: 10,
                      appearance: 'none',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 12px center',
                      paddingRight: '32px'
                    }}
                  >
                    <option value="" disabled>Select a model...</option>
                    {availableModels.map((model, idx) => {
                      const displayName = model.name.split(/[-_]/).map(w => 
                        w.charAt(0).toUpperCase() + w.slice(1)
                      ).join(' ');
                      const label = model.path ? displayName : `${displayName} (no model file)`;
                      return (
                        <option 
                          key={idx} 
                          value={idx}
                          style={{ 
                            background: '#1e293b', 
                            color: '#ffffff',
                            padding: '8px'
                          }}
                        >
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  
                  {/* Load Model Button */}
                  <button
                    onClick={() => {
                      if (selectedModelToLoad === null || selectedModelToLoad === '') {
                        console.log('Please select a model first');
                        return;
                      }
                      
                      const model = availableModels[parseInt(selectedModelToLoad)];
                      if (!model || !model.path) {
                        console.log('Selected model has no file');
                        return;
                      }
                      
                      // Create a cube with this custom model
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' ? avatar.lift : 0);
                      const playerYaw = avatar.yaw || 0;
                      const spawnDistance = 15;
                      const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                      const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                      
                      const newCube = {
                        id: Date.now() + Math.random(),
                        shape: 'box',
                        modelType: 'custom',
                        customModelPath: model.path,
                        customModelName: model.name,
                        position: { x: spawnX, y: playerY, z: spawnZ },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 0.1, y: 0.1, z: 0.1 },
                        hasCollision: false,
                        walkableTop: false,
                        color: '#3b82f6'
                      };
                      
                      const newCubes = [...placedCubes, newCube];
                      setPlacedCubes(newCubes);
                      setSelectedCubeId(newCube.id);
                      sendCubeUpdate(newCubes);
                      
                      console.log(`✅ Loaded model: ${model.name}`);
                    }}
                    style={{ 
                      width: '100%',
                      padding:'12px', 
                      borderRadius:8, 
                      border:'1px solid rgba(168, 85, 247, 0.3)', 
                      background:'rgba(88, 28, 135, 0.5)', 
                      color:'#ffffff', 
                      cursor:'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.8)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.5)'}
                  >
                    📦 Load Model
                  </button>
                </div>
                
                {/* Upload New Model Section */}
                <div style={{ 
                  background:'rgba(168, 85, 247, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(168, 85, 247, 0.2)',
                  marginTop: 10
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#c084fc', marginBottom:10 }}>📁 Upload Model</div>
                  
                  <label style={{ cursor: 'pointer' }}>
                    <div
                      style={{
                        padding:'12px',
                        borderRadius:8,
                        border:'1px solid rgba(168, 85, 247, 0.3)',
                        background:'rgba(88, 28, 135, 0.5)',
                        color:'#ffffff',
                        cursor:'pointer',
                        fontSize:11,
                        fontWeight:600,
                        textAlign:'center',
                        transition:'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.8)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(88, 28, 135, 0.5)'}
                    >
                      📁 Click to Select Model Folder
                      <div style={{ fontSize: '9px', marginTop: '6px', opacity: 0.8, lineHeight: '1.4' }}>
                        Select a folder containing your model (.fbx, .glb, etc)<br/>
                        and its textures
                      </div>
                      <input
                        type="file"
                        webkitdirectory=""
                        directory=""
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files);
                          if (files.length === 0) {
                            alert('No files selected. Please select a folder.');
                            return;
                          }
                          
                          // Check if there's a model file
                          const modelExtensions = ['.fbx', '.glb', '.gltf', '.obj', '.dae', '.stl'];
                          const hasModel = files.some(f => {
                            const fileName = f.name.toLowerCase();
                            return modelExtensions.some(ext => fileName.endsWith(ext));
                          });
                          
                          if (!hasModel) {
                            const fileList = files.map(f => f.name).slice(0, 10).join(', ');
                            alert(`No model file found.\\n\\nFiles found (first 10): ${fileList}\\n\\nPlease select a folder containing a .fbx, .glb, .gltf, .obj, .dae, or .stl file.`);
                            return;
                          }
                          
                          // Prompt user for model name
                          const modelName = prompt('Enter a name for this model:');
                          if (!modelName || modelName.trim() === '') {
                            alert('Model name is required. Upload cancelled.');
                            return;
                          }
                          
                          const formData = new FormData();
                          files.forEach(file => {
                            formData.append('models', file);
                          });
                          formData.append('modelName', modelName);
                          
                          fetch('/api/upload-model', {
                            method: 'POST',
                            body: formData
                          })
                          .then(res => res.json())
                          .then(data => {
                            if (data.success && data.path) {
                              // Refresh the available models list
                              fetch('/api/models')
                                .then(res => res.json())
                                .then(data => {
                                  if (data.models) {
                                    setAvailableModels(data.models);
                                    alert(`✅ Model uploaded successfully! (${data.filesUploaded || 'multiple'} files)\\n\\nYou can now find it in the Model Library dropdown above.`);
                                  }
                                })
                                .catch(() => {
                                  alert(`✅ Model uploaded! Refresh the page to see it in the library.`);
                                });
                              
                              // Reset file input
                              e.target.value = '';
                            } else {
                              console.error('Upload failed:', data);
                              alert('Upload failed. Check console for details.');
                            }
                          })
                          .catch(err => {
                            console.error('Upload failed:', err);
                            alert('Upload failed. Check console for details.');
                            // Reset file input
                            e.target.value = '';
                          });
                        }}
                      />
                    </div>
                  </label>
                </div>
              </>
            )}
            
            {/* TRANSFORM TAB */}
            {activeEditorTab === 'transform' && (
              <>
                {((selectedCubeId && placedCubes.find(c => c.id === selectedCubeId)) || (selectedVisualizer && audioVisualizers.find(v => v.id === selectedVisualizer))) ? (
                  <div style={{ 
                    background:'rgba(16, 185, 129, 0.12)', 
                    padding:'14px', 
                    borderRadius:10,
                    border:'2px solid rgba(16, 185, 129, 0.3)'
                  }}>
                    <div style={{ fontWeight:600, fontSize:13, color:'#6ee7b7', marginBottom:10 }}>
                      ✨ {selectedCubeId ? 
                        `Editing Object #${placedCubes.findIndex(c => c.id === selectedCubeId) + 1}` :
                        `Editing ${audioVisualizers.find(v => v.id === selectedVisualizer)?.label || 'Audio Zone'}`
                      }
                    </div>
                    
                    {/* Drag mode toggle - only for cubes */}
                    {selectedCubeId && (
                      <label style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, fontSize:11, cursor:'pointer', background:'rgba(15, 23, 42, 0.3)', padding:'10px', borderRadius:8 }}>
                        <input type="checkbox" checked={cubeDragMode} onChange={e=>setCubeDragMode(e.target.checked)} style={{ cursor:'pointer' }} />
                        <span style={{ fontWeight:500 }}>�️ Free Drag (follows terrain)</span>
                      </label>
                    )}
                    
                    {/* Transform mode buttons */}
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6, fontWeight:600 }}>TRANSFORM MODE</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                        <button 
                          onClick={()=>setCubeTransformMode('translate')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='translate' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='translate' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Move
                        </button>
                        <button 
                          onClick={()=>setCubeTransformMode('rotate')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='rotate' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='rotate' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Rotate
                        </button>
                        <button 
                          onClick={()=>setCubeTransformMode('scale')} 
                          style={{ 
                            padding:'10px', 
                            borderRadius:8, 
                            border: cubeTransformMode==='scale' ? '2px solid #10b981' : '1px solid rgba(148, 163, 184, 0.2)', 
                            background: cubeTransformMode==='scale' ? 'rgba(6, 78, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)', 
                            color:'#ffffff', 
                            fontSize:11,
                            fontWeight:600,
                            cursor:'pointer',
                            transition:'all 0.2s'
                          }}
                        >
                          Scale
                        </button>
                      </div>
                    </div>
                    
                    {/* Snap controls */}
                    <div style={{ background:'rgba(15, 23, 42, 0.3)', padding:'10px', borderRadius:8, marginBottom:10 }}>
                      <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', marginBottom:cubeSnap?8:0 }}>
                        <input type="checkbox" checked={cubeSnap} onChange={e=>setCubeSnap(e.target.checked)} style={{ cursor:'pointer' }} /> 
                        <span style={{ fontWeight:600 }}>Enable Snapping</span>
                      </label>
                      
                      {cubeSnap && (
                        <div>
                          {cubeTransformMode==='translate' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Position Snap: {cubeTranslateSnap.toFixed(2)}u</div>
                              <input 
                                type="range" 
                                min={0.1} 
                                max={5} 
                                step={0.1} 
                                value={cubeTranslateSnap} 
                                onChange={e=>setCubeTranslateSnap(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                          {cubeTransformMode==='rotate' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Rotation Snap: {cubeRotateSnapDeg.toFixed(0)}°</div>
                              <input 
                                type="range" 
                                min={1} 
                                max={45} 
                                step={1} 
                                value={cubeRotateSnapDeg} 
                                onChange={e=>setCubeRotateSnapDeg(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                          {cubeTransformMode==='scale' && (
                            <>
                              <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Scale Snap: {cubeScaleSnap.toFixed(2)}</div>
                              <input 
                                type="range" 
                                min={0.1} 
                                max={1} 
                                step={0.1} 
                                value={cubeScaleSnap} 
                                onChange={e=>setCubeScaleSnap(parseFloat(e.target.value))} 
                                style={{ width:'100%' }}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Action buttons */}
                    <button 
                      onClick={() => {
                        setSelectedCubeId(null);
                        setSelectedVisualizer(null);
                      }}
                      style={{ 
                        padding:'10px 14px', 
                        borderRadius:8, 
                        border:'1px solid rgba(148, 163, 184, 0.2)', 
                        background:'rgba(15, 23, 42, 0.6)', 
                        color:'#cbd5e1', 
                        cursor:'pointer',
                        fontSize: 11,
                        width: '100%',
                        fontWeight:600,
                        marginBottom:6,
                        transition:'all 0.2s'
                      }}
                    >
                      Deselect
                    </button>
                    
                    {/* Delete button - only for visualizers */}
                    {selectedVisualizer && (
                      <button 
                        onClick={() => {
                          if (window.confirm('Delete this audio visualizer?')) {
                            deleteVisualizerAndSync(selectedVisualizer);
                            setSelectedVisualizer(null);
                          }
                        }}
                        style={{ 
                          padding:'10px 14px', 
                          borderRadius:8, 
                          border:'1px solid rgba(220, 38, 38, 0.3)', 
                          background:'rgba(127, 29, 29, 0.6)', 
                          color:'#fca5a5', 
                          cursor:'pointer',
                          fontSize: 11,
                          width: '100%',
                          fontWeight:600,
                          transition:'all 0.2s'
                        }}
                      >
                        🗑️ Delete Audio Zone
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ 
                    background:'rgba(59, 130, 246, 0.08)', 
                    padding:'20px', 
                    borderRadius:10,
                    border:'1px solid rgba(59, 130, 246, 0.2)',
                    textAlign:'center'
                  }}>
                    <div style={{ fontSize:40, marginBottom:10 }}>🔧</div>
                    <div style={{ fontWeight:600, fontSize:12, color:'#60a5fa', marginBottom:6 }}>No Object Selected</div>
                    <p style={{ fontSize:10, color:'#94a3b8', lineHeight:1.5 }}>
                      Select an object from the Objects tab to transform it
                    </p>
                  </div>
                )}
              </>
            )}
            
            {/* AUDIO TAB */}
            {activeEditorTab === 'audio' && (
              <>
                <div style={{ 
                  background:'rgba(245, 158, 11, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(245, 158, 11, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#fbbf24', marginBottom:10 }}>🔊 Audio Visualizers</div>
                  <button 
                    onClick={() => {
                      const avatar = window.__CF_LOCAL_AVATAR__ || {};
                      const playerX = avatar.x || 0;
                      const playerZ = avatar.z || 0;
                      const playerY = (typeof avatar.lift === 'number' && avatar.lift > 0) ? avatar.lift : 5;
                      const playerYaw = avatar.yaw || 0;
                      const spawnDistance = 15;
                      const spawnX = playerX + Math.sin(playerYaw) * spawnDistance;
                      const spawnZ = playerZ + Math.cos(playerYaw) * spawnDistance;
                      const spawnY = Math.max(5, playerY);
                      const newId = Date.now();
                      const newVisualizer = {
                        id: newId,
                        position: [spawnX, spawnY, spawnZ],
                        refDistance: 10,
                        maxDistance: 25,
                        volume: 1.5,
                        label: `Audio Zone ${audioVisualizers.length + 1}`,
                        soundFile: 'rocket_ambience.mp3'
                      };
                      addVisualizerAndSync(newVisualizer);
                      setSelectedVisualizer(newId);
                    }}
                    style={{ 
                      padding:'12px', 
                      borderRadius:8, 
                      border:'1px solid rgba(245, 158, 11, 0.3)', 
                      background:'rgba(146, 64, 14, 0.5)', 
                      color:'#ffffff', 
                      cursor:'pointer',
                      fontSize: 12,
                      width: '100%',
                      fontWeight: 600,
                      marginBottom:12,
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(146, 64, 14, 0.8)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(146, 64, 14, 0.5)'}
                  >
                    + Add Audio Visualizer
                  </button>
                  
                  {/* List of audio visualizers */}
                  <div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginBottom:8, fontWeight:600 }}>PLACED ZONES ({audioVisualizers.length})</div>
                    <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid rgba(148, 163, 184, 0.1)', borderRadius:8, padding:6, background:'rgba(15, 23, 42, 0.3)' }}>
                      {audioVisualizers.length === 0 ? (
                        <div style={{ padding:16, color:'#64748b', fontSize:11, textAlign:'center' }}>No visualizers placed</div>
                      ) : (
                        audioVisualizers.map((viz, idx) => (
                          <div 
                            key={viz.id}
                            onClick={() => setSelectedVisualizer(viz.id)}
                            style={{
                              padding:'10px',
                              marginBottom:6,
                              borderRadius:8,
                              border: selectedVisualizer === viz.id ? '2px solid #f59e0b' : '1px solid rgba(148, 163, 184, 0.15)',
                              background: selectedVisualizer === viz.id ? 'rgba(120, 53, 15, 0.4)' : 'rgba(15, 23, 42, 0.4)',
                              cursor:'pointer',
                              fontSize:11,
                              transition:'all 0.2s'
                            }}
                          >
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                              <span style={{ fontWeight:600, color:'#fbbf24' }}>{viz.label}</span>
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setAudioVisualizers(prev => prev.filter(v => v.id !== viz.id));
                                  if (selectedVisualizer === viz.id) setSelectedVisualizer(null);
                                }}
                                style={{ padding:'4px 8px', borderRadius:6, border:'1px solid rgba(220, 38, 38, 0.3)', background:'rgba(127, 29, 29, 0.6)', color:'#fecaca', fontSize:10 }}
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                            <div style={{ fontSize:10, color:'#94a3b8' }}>
                              Full: {viz.refDistance}u • Max: {viz.maxDistance}u • Vol: {viz.volume.toFixed(1)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            
            {/* SETTINGS TAB */}
            {activeEditorTab === 'settings' && (
              <>
                <div style={{ 
                  background:'rgba(100, 116, 139, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(100, 116, 139, 0.2)'
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#cbd5e1', marginBottom:10 }}>⚙️ Camera & Controls</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={showSelf} onChange={e=>setShowSelf(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Show my character</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6, opacity:!showSelf?0.5:1 }}>
                      <input type="checkbox" checked={moveEnabled} onChange={e=>setMoveEnabled(e.target.checked)} disabled={!showSelf} style={{ cursor:'pointer' }} />
                      <span>Movement (arrows)</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6, opacity:(!showSelf || !moveEnabled)?0.5:1 }}>
                      <input type="checkbox" checked={clickMove} onChange={e=>setClickMove(e.target.checked)} disabled={!showSelf || !moveEnabled} style={{ cursor:'pointer' }} />
                      <span>Click-to-move</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={fullCamera} onChange={e=>setFullCamera(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Full camera controls</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={followCam} onChange={e=>setFollowCam(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>3rd-person follow</span>
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, cursor:'pointer', padding:'8px', background:'rgba(30, 41, 59, 0.3)', borderRadius:6 }}>
                      <input type="checkbox" checked={showCollisionMeshes} onChange={e=>setShowCollisionMeshes(e.target.checked)} style={{ cursor:'pointer' }} />
                      <span>Show collision boxes</span>
                    </label>
                    <button onClick={resetCamera} style={{ 
                      marginTop:8, 
                      padding:'10px 14px', 
                      borderRadius:8, 
                      border:'1px solid rgba(148, 163, 184, 0.3)', 
                      background:'rgba(30, 41, 59, 0.6)', 
                      color:'#e2e8f0', 
                      cursor:'pointer',
                      fontSize:11,
                      fontWeight:600,
                      transition:'all 0.2s'
                    }}>
                      🔄 Reset Camera
                    </button>
                  </div>
                </div>
                
                {/* Danger Zone */}
                <div style={{ 
                  background:'rgba(220, 38, 38, 0.08)', 
                  padding:'14px', 
                  borderRadius:10,
                  border:'1px solid rgba(220, 38, 38, 0.2)',
                  marginTop:14
                }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'#ef4444', marginBottom:10 }}>⚠️ Danger Zone</div>
                  <button 
                    onClick={leaveGame}
                    style={{ 
                      padding:'10px 14px', 
                      borderRadius:8, 
                      border:'1px solid rgba(220, 38, 38, 0.3)', 
                      background:'rgba(153, 27, 27, 0.6)', 
                      color:'#fff', 
                      cursor:'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      width: '100%',
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(153, 27, 27, 0.9)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(153, 27, 27, 0.6)'}
                  >
                    Leave Game & Disconnect
                  </button>
                </div>
              </>
            )}
          
          </div> {/* Close inner ltr div */}
          </div> {/* Close scrollable container */}
        </div>
        )}
        <Canvas
          key={`${flip180 ? 'cam-back' : 'cam-front'}-${window.__CF_HOT_RELOAD_COUNT__ || 0}`}
          frameloop={'always'}
          dpr={isNarrow ? 1 : 1}
          camera={{ position: camPos, fov: camFov, near:0.08, far: 10000 }}
          style={{ width: '100%', height: '100%' }}
          shadows
          gl={{ powerPreference:'high-performance', antialias: isNarrow ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
          onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); st.gl.shadowMap.enabled = true; st.gl.shadowMap.type = THREE.PCFSoftShadowMap; }catch{} }}
        >
          <hemisphereLight intensity={0.55} groundColor={'#1b1b1b'} />
          <ambientLight intensity={0.5} />
          {/* Main soft angled light: widen frustum to avoid cut-off; subtle + fuzzy */}
          <directionalLight
            position={[22, 24, -18]}
            intensity={0.7}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={1}
            shadow-camera-far={60}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-bias={-0.0004}
            shadow-normalBias={0.03}
            shadow-radius={6}
          />
          {/* Gentle fills without shadows so the scene stays readable */}
          <pointLight position={[0,10,0]} intensity={0.5} distance={60} decay={2} />
          <pointLight position={[10,8,6]} intensity={0.35} distance={60} decay={2} />
          <pointLight position={[-10,8,-6]} intensity={0.35} distance={60} decay={2} />

          <Controls target={cameraTarget} isNarrow={isNarrow} flip180={flip180} fullCamera={fullCamera} minDist={minDist} maxDist={maxDist} selectedCubeId={selectedCubeId} selectedVisualizer={selectedVisualizer} />
          {followCam && (
            <CameraFollower seedToken={followSeed} isPlayer2={youArePlayer2} followRocket={followRocket} rocketPositionRef={rocketPositionRef} cameraDistance={liveSettings.cameraDistance} cameraHeight={liveSettings.cameraHeight} />
          )}

          {/* Keep the board unrotated; use camera side for Player 2 */}
          <group position={[0, groupY, 0]} rotation={[0, 0, 0]}>
            {/* Space background: stars, dust, planets */}
            <SpaceBackdrop speed={0.22} dir={[1.0, 0.25]} starIntensity={3.2} clusterStrength={5.0} />
            <DenseGalaxyField totalPoints={600} clusters={6} radius={750} clusterSpread={0.02} speed={0.05} dir={[1.0, 0.25]} sizeRange={[1.4, 3.6]} />
            <GalaxyClusters clusterCount={5} pointsPerCluster={100} radius={720} spread={0.028} speed={0.06} dir={[1.0, 0.25]} />
            <FlybyAsteroids count={15} speed={0.18} dir={[1.0, 0.25]} />
            <StarSwarms maxSwarms={3} basePoints={120} speed={0.55} dir={[1.0, 0.25]} />
            {/* Lunar terrain with hills and mounds - characters walk on the surface */}
            <LunarTerrain radius={TERRAIN_RADIUS} flatRadius={50} showCollisionBox={showCollisionMeshes} />
            {/* Simple staircase you can walk up */}
            <Staircase rocketPositionRef={rocketPositionRef} setFollowRocket={setFollowRocket} showCollisionMeshes={showCollisionMeshes} />
            {/* Extra placed props */}
            {/* Decorative FBX stairs (hidden for now) */}
            {SHOW_DECOR_STAIRS && (
              extraEdit ? (
                <>
                  <ExtraStairsFBX
                    ref={extraRef}
                    alignToStair2={false}
                    yaw={(extraYawDeg * Math.PI) / 180}
                    scaleMul={extraScale}
                    scaleMulX={extraRef?.current?.scale?.x ?? extraScale}
                    scaleMulY={extraRef?.current?.scale?.y ?? extraScale}
                    scaleMulZ={extraRef?.current?.scale?.z ?? extraScale}
                    posX={extraX}
                    posZ={extraZ}
                    posY={extraY}
                    onDefChange={(def)=>{
                      try {
                        const yawAdj = ((maskYawDeg||0) * Math.PI/180);
                        setExtraStairsDef({
                          ...def,
                          posX: def.posX + (maskDX||0),
                          posZ: def.posZ + (maskDZ||0),
                          posY: (def.posY||0) + (maskDY||0),
                          yaw: (def.yaw||0) + yawAdj,
                          width: def.width * (maskScale||1),
                          depth: def.depth * (maskScale||1),
                          height: def.height * (maskScale||1),
                          run: def.run * (maskScale||1),
                          rise: def.rise * (maskScale||1),
                          reverse: !!extraReverse
                        });
                      } catch {}
                    }}
                  />
                  {extraRef?.current && (
                    <TransformControls
                      object={extraRef.current}
                      mode={extraMode}
                      enabled={true}
                      showX showY showZ
                      onMouseDown={()=>{ try { setFullCamera(true); setFollowCam(false); } catch {} }}
                      onDraggingChanged={(drag)=>{ try { if (controlsRef.current) controlsRef.current.enabled = !drag; if (drag) { setFullCamera(true); setFollowCam(false); } } catch {} }}
                      translationSnap={extraSnap && extraMode==='translate' ? extraTranslateSnap : undefined}
                      rotationSnap={extraSnap && extraMode==='rotate' ? (extraRotateSnapDeg * Math.PI/180) : undefined}
                      scaleSnap={extraSnap && extraMode==='scale' ? extraScaleSnap : undefined}
                      onObjectChange={()=>{
                        try {
                          const g = extraRef.current; if (!g) return;
                          const fh = ROWS * (CELL + GAP) - GAP + 0.6;
                          const groundY = -fh / 2 - GROUND_CLEAR;
                          const nextY = g.position.y;
                          if (lockYToGround && extraMode==='translate') {
                            g.position.y = groundY;
                            setExtraY(0);
                          } else {
                            setExtraY(nextY - groundY);
                          }
                          setExtraX(g.position.x);
                          setExtraZ(g.position.z);
                          setExtraYawDeg((g.rotation.y * 180/Math.PI + 360) % 360);
                          const sx = Math.max(0.01, Math.min(1.0, g.scale.x));
                          const sy = Math.max(0.01, Math.min(1.0, g.scale.y));
                          const sz = Math.max(0.01, Math.min(1.0, g.scale.z));
                          if (g.scale.x !== sx || g.scale.y !== sy || g.scale.z !== sz) g.scale.set(sx, sy, sz);
                          setExtraScale(sx);
                          setExtraScaleX(sx); setExtraScaleY(sy); setExtraScaleZ(sz);
                        } catch {}
                      }}
                    />
                  )}
                </>
              ) : (
                <ExtraStairsFBX
                  alignToStair2={extraAlign}
                  side={extraSide}
                  gap={extraGap}
                  yaw={(extraYawDeg * Math.PI) / 180}
                  scaleMul={extraScale}
                  scaleMulX={extraScaleX}
                  scaleMulY={extraScaleY}
                  scaleMulZ={extraScaleZ}
                  posX={extraX}
                  posZ={extraZ}
                  posY={extraY}
                  onDefChange={(def)=>{
                    try {
                      const yawAdj = ((maskYawDeg||0) * Math.PI/180);
                      setExtraStairsDef({
                        ...def,
                        posX: def.posX + (maskDX||0),
                        posZ: def.posZ + (maskDZ||0),
                        posY: (def.posY||0) + (maskDY||0),
                        yaw: (def.yaw||0) + yawAdj,
                        width: def.width * (maskScale||1),
                        depth: def.depth * (maskScale||1),
                        height: def.height * (maskScale||1),
                        run: def.run * (maskScale||1),
                        rise: def.rise * (maskScale||1),
                        reverse: !!extraReverse
                      });
                    } catch {}
                  }}
                />
              )
            )}
            {/* Visualize stair collision boxes */}
            <StairCollisionDebug show={showCollisionMeshes} />
            {/* Optional Transform gizmo for mask itself (edit center using current mask offsets) */}
            {extraWalkable && maskEdit && EXTRA_STAIRS_DEF && (()=>{
              const d = EXTRA_STAIRS_DEF;
              const fh = ROWS * (CELL + GAP) - GAP + 0.6;
              const gY = -fh / 2 - GROUND_CLEAR;
              const maskPos = [(d.posX||0) + maskDX, gY + (d.posY||0) + maskDY, (d.posZ||0) + maskDZ];
              const maskYaw = (d.yaw||0) + ((maskYawDeg||0) * Math.PI/180);
              const ms = (maskScale||1);
              // Render a visible, clickable mask handle (wireframe box of the unscaled dimensions; group carries uniform scale)
              return (
                <>
                  <group ref={maskObjRef} position={maskPos} rotation={[0, maskYaw, 0]} scale={[ms, ms, ms]}>
                    <mesh>
                      <boxGeometry args={[Math.max(0.001, d.width||1), Math.max(0.001, d.height||1), Math.max(0.001, d.depth||1)]} />
                      <meshBasicMaterial color={'#67e8f9'} wireframe transparent opacity={0.35} depthWrite={false} />
                    </mesh>
                  </group>
                  {maskObjRef?.current && (
                    <TransformControls
                      object={maskObjRef.current}
                      mode={extraMode}
                      enabled={true}
                      showX showY showZ
                      onMouseDown={()=>{ try { setFullCamera(true); setFollowCam(false); } catch {} }}
                      onDraggingChanged={(drag)=>{ try { if (controlsRef.current) controlsRef.current.enabled = !drag; if (drag) { setFullCamera(true); setFollowCam(false); } } catch {} }}
                      translationSnap={extraSnap && extraMode==='translate' ? extraTranslateSnap : undefined}
                      rotationSnap={extraSnap && extraMode==='rotate' ? (extraRotateSnapDeg * Math.PI/180) : undefined}
                      scaleSnap={extraSnap && extraMode==='scale' ? extraScaleSnap : undefined}
                      onObjectChange={()=>{
                        try {
                          const g = maskObjRef.current; if (!g) return;
                          const p = g.position; const r = g.rotation; const s = g.scale.x;
                          // enforce uniform scale on mask handle
                          g.scale.setScalar(Math.max(0.01, s));
                          setMaskDX(p.x - (d.posX||0));
                          setMaskDY((p.y - gY) - (d.posY||0));
                          setMaskDZ(p.z - (d.posZ||0));
                          setMaskYawDeg((((r.y - (d.yaw||0)) * 180/Math.PI) % 360 + 360) % 360);
                          setMaskScale(Math.max(0.01, s));
                        } catch {}
                      }}
                    />
                  )}
                </>
              );
            })()}
            {/* Floor click-to-move disabled: only side pads are clickable */}
            <mesh position={[0, groundY + 0.002, 0]} rotation={[-Math.PI/2, 0, 0]} renderOrder={-1} raycast={() => null}>
              <planeGeometry args={[TERRAIN_RADIUS*3, TERRAIN_RADIUS*3, 1, 1]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {/* Board assembly: render only after the table reports top Y (state or global) to avoid initial snap */}
            {tableTopKnown && (
              <group key="board-group-stable" position={[0, boardOnTableYOffset + BOARD_EXTRA_LIFT, 0]}>
                <FrontPlate />
                <SideSupports />
                {/* Classic board without neon accents */}
                {/* Disable shadow catcher on very small screens to avoid any perceived haze */}
                {(!isNarrow) && <BackShadowCatcher opacity={0.14} />}

                {/* Pieces from board state */}
                {Array.from({ length: ROWS }).map((_, r) => (
                  Array.from({ length: COLS }).map((_, c) => {
                    const v = board?.[r]?.[c];
                    if (!v) return null;
                    const col = colors?.[v] || (v === 1 ? '#ff3b5c' : '#ffd166');
                    // Always drop pieces top-down regardless of camera side
                    return <Piece key={`p-${r}-${c}`} color={col} c={c} r={r} flip180={false} />;
                  })
                ))}

                {/* Input hotspots */}
                {Array.from({ length: COLS }, (_, c) => {
                  const x = (c - (COLS - 1) / 2) * (CELL + GAP);
                  const H = ROWS * (CELL + GAP) - GAP;
                  return (
                    <mesh key={`hs-${c}`} position={[x, 0, 0]} onPointerDown={() => onSelectColumn && onSelectColumn(c)}>
                      <boxGeometry args={[CELL, H + 0.5, 1.2]} />
                      <meshBasicMaterial transparent opacity={0} />
                    </mesh>
                  );
                })}
              </group>
            )}
            <ClassicTableFBX />

            {/* Connect Four Table collision wireframe removed */}

              {/* Local-only clickable portal (require Click-to-move to be ON) */}
              {showSelf && moveEnabled && clickMove && (
                youArePlayer2 ? (
                  <PortalPad position={[player2Pos.x, groundY + 0.012, player2Pos.z]} color={'#a78bfa'} onClick={() => gotoTableSide('Player 2')} />
                ) : (
                  <PortalPad position={[player1Pos.x, groundY + 0.012, player1Pos.z]} color={'#22d3ee'} onClick={() => gotoTableSide('Player 1')} />
                )
              )}

              {/* Leave Game button: on the tabletop, centered in front of the board on your side when hidden */}
              {!showSelf && (
                (() => {
                  // Center X with tiny nudge toward your avatar's X offset; move Z further onto the table (away from the edge)
                  const forward = 5.3; // distance from board center toward the local side
                  const z = (youArePlayer2 ? -1 : 1) * forward;
                  const x = 0; // centered horizontally
                  return (
                    <LeaveButton
                      position={[x, -2.1, z]}
                      color={'#f43f5e'}
                      label={'Leave Game'}
                      onClick={() => {
                        try {
                          // Return to third-person and enable click-to-move when leaving
                          setShowSelf(true);
                          centerThirdPerson();
                          setClickMove(true);
                          setP1Target(null);
                          setP2Target(null);
                          // After leaving board view, keep smooth off even on the first walk
                          try { suppressNextSmoothRef.current = true; } catch {}
                        } catch {}
                      }}
                    />
                  );
                })()
              )}

            {/* Player 1 Avatar (Astronaut FBX) */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {youArePlayer2 ? (
                  // Remote P1 - only show if opponent is connected
                  opponentConnected && (
                    <RemoteAvatarGroup side={remoteSide} base={player1Pos}>
                      {/* Remote P1: show opponent's chosen character (default alien) */}
                      {oppCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key="opp-p1-astronaut" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : oppCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key="opp-p1-guy1" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : oppCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key="opp-p1-robot4" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      ) : (
                        <Alien2FBXOpponent key="opp-p1-alien" xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={Math.PI} />
                      )}
                      <Billboard follow={true} position={[0, oppCharacterId === 'astronaut' || oppCharacterId === 'guy1' || oppCharacterId === 'alien' || oppCharacterId === 'robot4' ? 11 : 7, 0]}>
                        <Text fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {oppName || 'Opponent'}
                        </Text>
                    </Billboard>
                    </RemoteAvatarGroup>
                  )
                ) : (
                  showSelf && (
                    <PlayerMover enabled={moveEnabled} settingsMenuOpen={settingsMenuOpen} setShowEditMenu={setShowEditMenu} setShowChatUI={setShowChatUI} setFullCamera={setFullCamera} setFollowCam={setFollowCam} showEditMenu={showEditMenu} activeEditorTab={activeEditorTab} setActiveEditorTab={setActiveEditorTab} selectedSectionIndex={selectedSectionIndex} setSelectedSectionIndex={setSelectedSectionIndex} isInSection={isInSection} setIsInSection={setIsInSection} selectedItemIndex={selectedItemIndex} setSelectedItemIndex={setSelectedItemIndex} isInSubMenu={isInSubMenu} setIsInSubMenu={setIsInSubMenu} selectedSubItemIndex={selectedSubItemIndex} setSelectedSubItemIndex={setSelectedSubItemIndex} cubeEditMode={cubeEditMode} placedCubes={placedCubes} maxRadius={PLAY_AREA_RADIUS} speed={22} turnSensitivity={liveSettings.turnSensitivity} invertForward={false} baseOffset={[player1Pos.x, player1Pos.z]} initialYaw={0} obstacles={[]} collisionRadius={myCharacterId === 'robot4' ? 4.2 : myCharacterId === 'astronaut' || myCharacterId === 'guy1' ? 3.7 : myCharacterId === 'alien' ? 3.75 : 1.8} collisionForwardOffset={myCharacterId === 'robot4' ? 0 : -1.35} groundSamplePush={(myCharacterId === 'robot4' || myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : 2.3} backProbeMag={(myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : undefined} stairMagMul={1.0} labelSide={'Player 1'} labelName={myName} characterId={myCharacterId} showCollisionBoxes={showCollisionMeshes} moveTarget={clickMove ? p1Target : null} onArrive={() => {
                      try {
                        // final resend after arrival to guarantee opponent sees yaw=0
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); onAvatarMove && onAvatarMove({ player: 1, x, z, yaw: 0, run, isJumping, lift }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP1Target(null); setFullCamera(false); setShowSelf(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ 
                      // Don't broadcast position if user is dragging an object
                      if (window.__CF_IS_DRAGGING_CUBE__) return;
                      const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); onAvatarMove && onAvatarMove({ player: 1, x, z, yaw, run, isJumping, lift }); }catch{} }}>
                      {/* Local P1: render selected character */}
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p1-astronaut-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : myCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key={`local-p1-guy1-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p1-robot4-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p1-alien-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      )}
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>
            {/* Player 2 Avatar */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {!youArePlayer2 ? (
                  // Remote P2 - only show if opponent is connected
                  opponentConnected && (
                    <RemoteAvatarGroup side={remoteSide} base={player2Pos}>
                      {/* Remote P2: show opponent's chosen character */}
                      {oppCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key="opp-p2-astronaut" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : oppCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key="opp-p2-guy1" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : oppCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key="opp-p2-robot4" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      ) : (
                        <Alien2FBXOpponent key="opp-p2-alien" xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={ZERO_POSITION} yawOffset={0} />
                      )}
                      <Billboard follow={true} position={[0, oppCharacterId === 'astronaut' || oppCharacterId === 'guy1' || oppCharacterId === 'alien' || oppCharacterId === 'robot4' ? 11 : 7, 0]}>
                          <Text fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                            {oppName || 'Opponent'}
                          </Text>
                      </Billboard>
                    </RemoteAvatarGroup>
                  )
                ) : (
                  showSelf && (
                    <PlayerMover enabled={moveEnabled} settingsMenuOpen={settingsMenuOpen} setShowEditMenu={setShowEditMenu} setShowChatUI={setShowChatUI} setFullCamera={setFullCamera} setFollowCam={setFollowCam} showEditMenu={showEditMenu} activeEditorTab={activeEditorTab} setActiveEditorTab={setActiveEditorTab} selectedSectionIndex={selectedSectionIndex} setSelectedSectionIndex={setSelectedSectionIndex} isInSection={isInSection} setIsInSection={setIsInSection} selectedItemIndex={selectedItemIndex} setSelectedItemIndex={setSelectedItemIndex} isInSubMenu={isInSubMenu} setIsInSubMenu={setIsInSubMenu} selectedSubItemIndex={selectedSubItemIndex} setSelectedSubItemIndex={setSelectedSubItemIndex} cubeEditMode={cubeEditMode} placedCubes={placedCubes} maxRadius={PLAY_AREA_RADIUS} speed={22} turnSensitivity={liveSettings.turnSensitivity} invertForward={true} baseOffset={[player2Pos.x, player2Pos.z]} initialYaw={0} clickYawOffset={Math.PI} obstacles={[]} collisionRadius={myCharacterId === 'robot4' ? 4.2 : myCharacterId === 'astronaut' || myCharacterId === 'guy1' ? 3.7 : myCharacterId === 'alien' ? 3.75 : 1.8} collisionForwardOffset={myCharacterId === 'robot4' ? 0 : -1.35} groundSamplePush={(myCharacterId === 'robot4' || myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : 2.3} backProbeMag={(myCharacterId === 'astronaut' || myCharacterId === 'guy1' || myCharacterId === 'alien') ? -2.3 : undefined} stairMagMul={1.0} labelSide={'Player 2'} labelName={myName} characterId={myCharacterId} showCollisionBoxes={showCollisionMeshes} moveTarget={clickMove ? p2Target : null} onArrive={() => {
                      try {
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); onAvatarMove && onAvatarMove({ player: 2, x, z, yaw: 0, run, isJumping, lift }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP2Target(null); setFullCamera(false); setShowSelf(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ 
                      // Don't broadcast position if user is dragging an object
                      if (window.__CF_IS_DRAGGING_CUBE__) return;
                      const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); onAvatarMove && onAvatarMove({ player: 2, x, z, yaw, run, isJumping, lift }); }catch{} }}>
                      {/* Local P2: render selected character */}
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p2-astronaut-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : myCharacterId === 'guy1' ? (
                        <Guy1FBXOpponent key={`local-p2-guy1-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p2-robot4-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p2-alien-${window.__CF_HOT_RELOAD_COUNT__ || 0}`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      )}
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>

            {/* Labels are now attached and follow avatars (Billboard faces camera) */}

            {/* Placed Collision Cubes */}
            {console.log('[DEBUG] Rendering', placedCubes.length, 'cubes. AI Boxes:', placedCubes.filter(c => c.isAIBox).map(c => ({ id: c.id, label: c.aiBoxLabel, hasContent: !!(c.aiContent || c.aiContentData) })))}
            {placedCubes.map((cube) => (
              <PlacedCube
                key={cube.id}
                cube={cube}
                isSelected={selectedCubeId === cube.id}
                onSelect={() => !sculptMode && setSelectedCubeId(cube.id)}
                editMode={cubeEditMode}
                dragMode={cubeDragMode}
                transformMode={cubeTransformMode}
                snap={cubeSnap}
                translateSnap={cubeTranslateSnap}
                rotateSnapDeg={cubeRotateSnapDeg}
                scaleSnap={cubeScaleSnap}
                onTransformEnd={(updates) => updateCubeAndSync(cube.id, updates)}
                showCollisionMeshes={showCollisionMeshes}
                snapConfirmDialog={snapConfirmDialog}
                setSnapConfirmDialog={setSnapConfirmDialog}
                pendingSnapCubeId={pendingSnapCubeId}
                setPendingSnapCubeId={setPendingSnapCubeId}
                placedCubes={placedCubes}
              />
            ))}
            
            {/* Terrain Labels - ID and Edge Names */}
            {placedCubes.filter(c => c.isTerrain).map((cube, index) => (
              <TerrainLabels key={`label-${cube.id}`} cube={cube} terrainIndex={index + 1} />
            ))}
            
            {/* Terrain Sculpting Tool */}
            <TerrainSculptor
              enabled={sculptMode}
              brushSize={sculptBrushSize}
              strength={sculptStrength}
              placedCubes={placedCubes}
              onSculpt={handleSculpt}
            />
            
            {/* Audio Visualizers - with transform controls like cubes */}
            {audioVisualizers.map((viz) => (
              <EditableAudioVisualizer
                key={viz.id}
                visualizer={viz}
                isSelected={selectedVisualizer === viz.id}
                onSelect={(id) => setSelectedVisualizer(id)}
                editMode={cubeEditMode}
                dragMode={cubeDragMode}
                transformMode={cubeTransformMode}
                snap={cubeSnap}
                translateSnap={cubeTranslateSnap}
                rotateSnapDeg={cubeRotateSnapDeg}
                scaleSnap={cubeScaleSnap}
                availableSounds={availableSounds}
                setAvailableSounds={setAvailableSounds}
                onTransformEnd={(updates) => updateVisualizerAndSync(viz.id, updates)}
                showMeshes={showCollisionMeshes}
              />
            ))}

          </group>

          {/* Cinematic post-processing for stunning space visuals */}
          {/* <SpaceEffects /> */}
        </Canvas>
      </div>
      
      {/* Settings Menu Overlay */}
      <SettingsMenu
        isOpen={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        settings={gameSettings}
        onSave={handleSettingsSave}
        onLiveUpdate={handleLiveSettingsUpdate}
      />
      
      {/* Edge Snap Confirmation Dialog */}
      {snapConfirmDialog && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.98)',
          border: '2px solid #0ea5e9',
          borderRadius: '16px',
          padding: '24px',
          zIndex: 10003,
          boxShadow: '0 20px 60px rgba(14, 165, 233, 0.4)',
          minWidth: '320px',
          maxWidth: '400px'
        }}>
          <div style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#0ea5e9',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            🔗 Edge Snapping Detected
          </div>
          
          <div style={{
            fontSize: '14px',
            color: '#cbd5e1',
            marginBottom: '20px',
            lineHeight: '1.6',
            whiteSpace: 'pre-line',
            textAlign: 'center'
          }}>
            {snapConfirmDialog.message}
          </div>
          
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={() => {
                // Apply the snap
                const cube = placedCubes.find(c => c.id === snapConfirmDialog.cubeId);
                if (cube) {
                  const snapInfo = snapConfirmDialog.snapInfo;
                  const newPosition = {
                    x: snapConfirmDialog.position.x + snapInfo.averageSnapOffset.x,
                    y: snapConfirmDialog.position.y + snapInfo.averageSnapOffset.y,
                    z: snapConfirmDialog.position.z + snapInfo.averageSnapOffset.z
                  };
                  
                  // Convert snapConnections to snappedEdges
                  const snappedEdges = {};
                  for (const [edgeName, connection] of Object.entries(snapInfo.snapConnections)) {
                    snappedEdges[edgeName] = connection.targetCubeId;
                  }
                  
                  // Update the snapping cube with new position AND clear old saved heights
                  // This forces geometry regeneration with new snap data
                  updateCubeAndSync(snapConfirmDialog.cubeId, {
                    position: newPosition,
                    snappedEdges: snappedEdges,
                    savedEdgeHeights: undefined // Clear old edge data, will regenerate with new snaps
                  });
                  
                  // Force re-render of neighbor terrains to ensure their edge heights are saved
                  // This ensures the snapped terrain can read the neighbor's edge data
                  for (const [edgeName, connection] of Object.entries(snapInfo.snapConnections)) {
                    const neighborCube = placedCubes.find(c => c.id === connection.targetCubeId);
                    if (neighborCube && neighborCube.isTerrain) {
                      // Trigger a tiny update to force geometry regeneration
                      updateCubeAndSync(connection.targetCubeId, {
                        terrainScale: neighborCube.terrainScale || 0.1
                      });
                    }
                  }
                }
                
                setSnapConfirmDialog(null);
                setPendingSnapCubeId(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: '#0ea5e9',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#0284c7'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#0ea5e9'}
            >
              ✓ Yes, Snap
            </button>
            
            <button
              onClick={() => {
                setSnapConfirmDialog(null);
                setPendingSnapCubeId(null);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(148, 163, 184, 0.2)',
                color: '#cbd5e1',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = 'rgba(148, 163, 184, 0.3)';
                e.target.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                e.target.style.color = '#cbd5e1';
              }}
            >
              ✗ No, Cancel
            </button>
          </div>
        </div>
      )}
      
      {/* AI Box Editor Panel */}
      {aiBoxEditorOpen && (() => {
        const selectedCube = placedCubes.find(c => c.id === selectedCubeId);
        if (!selectedCube || !selectedCube.isAIBox) return null;
        
        const currentLabel = selectedCube.aiBoxLabel || '';
        const match = currentLabel.match(/AI Box #(\d+)/);
        const boxId = match ? match[1] : selectedCube.id;
        const hasContent = !!(selectedCube.aiContent || selectedCube.aiContentData);
        
        return (
          <div style={{
            position: 'fixed',
            top: 'calc(var(--nav-height, 56px) + 20px)',
            right: '20px',
            backgroundColor: 'rgba(0, 20, 40, 0.95)',
            border: '2px solid rgba(0, 255, 255, 0.6)',
            borderRadius: '12px',
            padding: '16px',
            width: '320px',
            maxHeight: 'calc(100vh - var(--nav-height, 56px) - 40px)',
            overflowY: 'auto',
            zIndex: 10002,
            boxShadow: '0 8px 32px rgba(0, 255, 255, 0.3)',
            fontFamily: 'monospace',
            color: '#fff'
          }}>
            {/* Header */}
            <div style={{
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: '12px',
              color: '#00ffff',
              borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
              paddingBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>🤖 AI Box</span>
              <button
                onClick={() => {
                  setAIBoxEditorOpen(false);
                  setSelectedCubeId(null);
                }}
                style={{
                  background: 'rgba(255, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 0, 0, 0.5)',
                  color: '#ff6b6b',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Box ID (read-only) */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                AI Box ID
              </label>
              <div style={{
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#00ffff',
                fontWeight: 'bold'
              }}>
                #{boxId}
              </div>
            </div>
            
            {/* Content Status */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                Content Status
              </label>
              <div style={{
                backgroundColor: hasContent ? 'rgba(0, 255, 0, 0.1)' : 'rgba(255, 165, 0, 0.1)',
                border: hasContent ? '1px solid rgba(0, 255, 0, 0.4)' : '1px solid rgba(255, 165, 0, 0.4)',
                padding: '6px',
                borderRadius: '4px',
                fontSize: '12px',
                color: hasContent ? '#00ff88' : '#ffaa00'
              }}>
                {hasContent ? '✓ Generated' : '⚠ Empty'}
              </div>
            </div>
            
            {/* Custom Title Input */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                Title (optional)
              </label>
              <input
                type="text"
                value={aiBoxEditTitle}
                onChange={(e) => setAIBoxEditTitle(e.target.value)}
                placeholder="e.g., Spaceship..."
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(0, 255, 255, 0.4)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(0, 255, 255, 0.8)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(0, 255, 255, 0.4)'}
              />
              <div style={{
                fontSize: '10px',
                color: '#888',
                marginTop: '4px'
              }}>
                AI Box #{boxId}{aiBoxEditTitle.trim() ? ` - ${aiBoxEditTitle.trim()}` : ''}
              </div>
            </div>
            
            {/* AI Prompt Input */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#aaa',
                marginBottom: '4px'
              }}>
                AI Prompt
              </label>
              <textarea
                value={aiBoxEditPrompt}
                onChange={(e) => setAIBoxEditPrompt(e.target.value)}
                placeholder="Describe what to generate..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 136, 0, 0.4)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  outline: 'none',
                  resize: 'vertical'
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(255, 136, 0, 0.8)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255, 136, 0, 0.4)'}
              />
              <div style={{
                fontSize: '10px',
                color: '#888',
                marginTop: '4px'
              }}>
                Use /ai{boxId} to generate
              </div>
            </div>
            
            {/* Save Button */}
            <button
              onClick={handleSaveAIBoxTitle}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'rgba(0, 255, 136, 0.2)',
                border: '2px solid rgba(0, 255, 136, 0.6)',
                borderRadius: '6px',
                color: '#00ff88',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontFamily: 'monospace',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = 'rgba(0, 255, 136, 0.3)';
                e.target.style.borderColor = 'rgba(0, 255, 136, 0.9)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = 'rgba(0, 255, 136, 0.2)';
                e.target.style.borderColor = 'rgba(0, 255, 136, 0.6)';
              }}
            >
              💾 Save
            </button>
            
            {/* Note */}
            <div style={{
              marginTop: '12px',
              padding: '8px',
              backgroundColor: 'rgba(0, 255, 136, 0.1)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              borderRadius: '4px',
              fontSize: '10px',
              color: '#00ff88'
            }}>
              ℹ️ Server restarts after saving
            </div>
          </div>
        );
      })()}
      
      {/* Save Notification */}
      {saveNotification && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 255, 136, 0.95)',
          color: '#000',
          padding: '15px 30px',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          zIndex: 10001,
          boxShadow: '0 4px 20px rgba(0, 255, 136, 0.6)',
          animation: 'fadeInOut 2s ease-in-out',
          pointerEvents: 'none'
        }}>
          Settings Saved!
        </div>
      )}
      
      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes scaleIn {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders when parent updates
// This stops opponent avatars from resetting when unrelated UI elements (menus, chat, toggles) are clicked
export default React.memo(ConnectFour3DView);

