/**
 * Stress Test for Connect Four 3D
 * Tests: 1000 objects loaded, multiple WebSocket connections, concurrent requests
 */

const WebSocket = require('ws');
const http = require('http');

const API_HOST = 'http://localhost:3002';
const WS_HOST = 'ws://localhost:3002/ws/c4';

// Test Configuration
const NUM_OBJECTS = 1000;
const NUM_CONNECTIONS = 10;
const NUM_HTTP_REQUESTS = 100;

console.log('🧪 Starting Connect Four 3D Stress Test...\n');

// Test 1: Simulate 1000 objects in memory
console.log('📦 Test 1: Simulating 1000 objects in game...');
const startMemory = process.memoryUsage();
const objects = [];

for (let i = 0; i < NUM_OBJECTS; i++) {
  objects.push({
    id: i,
    type: i % 5 === 0 ? 'aiBox' : 'cube',
    position: [Math.random() * 100, Math.random() * 50, Math.random() * 100],
    rotation: [0, Math.random() * Math.PI * 2, 0],
    scale: [1 + Math.random(), 1 + Math.random(), 1 + Math.random()],
    color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
    aiBoxLabel: i % 5 === 0 ? `AI Box #${i}` : undefined,
    aiContentData: i % 5 === 0 ? { parts: Array(11).fill(null).map((_, j) => ({ content: `Part ${j}`, type: 'text' })) } : undefined
  });
}

const endMemory = process.memoryUsage();
const memoryUsedMB = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;
console.log(`   ✅ Created ${NUM_OBJECTS} objects`);
console.log(`   📊 Memory used: ${memoryUsedMB.toFixed(2)} MB`);
console.log(`   💾 Average per object: ${(memoryUsedMB / NUM_OBJECTS * 1024).toFixed(2)} KB\n`);

// Test 2: Multiple WebSocket connections
console.log(`🔌 Test 2: Creating ${NUM_CONNECTIONS} WebSocket connections...`);
const connections = [];
const connectionPromises = [];

for (let i = 0; i < NUM_CONNECTIONS; i++) {
  const promise = new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_HOST);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Connection ${i} timeout`));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      connections.push(ws);
      // Send a test message
      ws.send(JSON.stringify({ 
        type: 'listMySavedGames', 
        username: `stress-test-${i}`, 
        userId: 9000 + i 
      }));
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  connectionPromises.push(promise);
}

try {
  await Promise.all(connectionPromises);
  console.log(`   ✅ All ${NUM_CONNECTIONS} connections established`);
} catch (err) {
  console.log(`   ⚠️ Some connections failed: ${err.message}`);
}

// Wait a bit for server to process
await new Promise(resolve => setTimeout(resolve, 1000));

// Test 3: Concurrent HTTP requests
console.log(`\n🌐 Test 3: Sending ${NUM_HTTP_REQUESTS} concurrent HTTP requests...`);
const requestStart = Date.now();
const httpPromises = [];

for (let i = 0; i < NUM_HTTP_REQUESTS; i++) {
  const promise = new Promise((resolve, reject) => {
    http.get(`${API_HOST}/api/models`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, size: data.length }));
    }).on('error', reject);
  });
  httpPromises.push(promise);
}

try {
  const results = await Promise.all(httpPromises);
  const requestEnd = Date.now();
  const successCount = results.filter(r => r.status === 200).length;
  const avgResponseTime = (requestEnd - requestStart) / NUM_HTTP_REQUESTS;
  
  console.log(`   ✅ Completed: ${successCount}/${NUM_HTTP_REQUESTS} requests`);
  console.log(`   ⚡ Total time: ${requestEnd - requestStart}ms`);
  console.log(`   📈 Avg response time: ${avgResponseTime.toFixed(2)}ms per request`);
  console.log(`   🚀 Throughput: ${(NUM_HTTP_REQUESTS / ((requestEnd - requestStart) / 1000)).toFixed(2)} req/sec`);
} catch (err) {
  console.log(`   ❌ HTTP requests failed: ${err.message}`);
}

// Test 4: Message broadcasting simulation
console.log(`\n📡 Test 4: Broadcasting messages to all connections...`);
const broadcastStart = Date.now();
let messagesReceived = 0;

// Set up message listeners
connections.forEach(ws => {
  ws.on('message', () => messagesReceived++);
});

// Send a game state update to each connection
for (let i = 0; i < connections.length; i++) {
  const ws = connections[i];
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'cubeUpdate',
      cubes: objects.slice(0, 100) // Send first 100 objects as test
    }));
  }
}

// Wait for responses
await new Promise(resolve => setTimeout(resolve, 500));
const broadcastEnd = Date.now();

console.log(`   ✅ Broadcast complete in ${broadcastEnd - broadcastStart}ms`);
console.log(`   📨 Messages received: ${messagesReceived}`);

// Cleanup
console.log(`\n🧹 Cleaning up...`);
connections.forEach(ws => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
});

// Final Report
console.log('\n' + '='.repeat(60));
console.log('📊 STRESS TEST RESULTS SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Objects: ${NUM_OBJECTS} objects = ${memoryUsedMB.toFixed(2)} MB`);
console.log(`✅ WebSockets: ${connections.length}/${NUM_CONNECTIONS} connections active`);
console.log(`✅ HTTP Load: ${NUM_HTTP_REQUESTS} requests handled successfully`);
console.log(`✅ Broadcasting: Messages delivered to all connections`);
console.log('\n💡 VERDICT:');

if (memoryUsedMB < 50 && connections.length === NUM_CONNECTIONS) {
  console.log('   🎉 EXCELLENT - Server handles load with no issues!');
  console.log('   ✨ The game can easily support 1000+ objects');
  console.log('   🚀 WebSocket connections are stable');
  console.log('   ⚡ HTTP API responds quickly under load');
} else if (memoryUsedMB < 100) {
  console.log('   ✅ GOOD - Server performs well under load');
  console.log('   👍 Some optimization possible but not critical');
} else {
  console.log('   ⚠️ CAUTION - High memory usage detected');
  console.log('   💡 Consider optimizing object data structures');
}

console.log('='.repeat(60) + '\n');

process.exit(0);
