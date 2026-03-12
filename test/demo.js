/**
 * XINNIX Demo - Demonstrates the full protocol flow
 */

import { XinnixIdentity } from '../src/crypto.js';
import { XinnixRegistry } from '../src/registry.js';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join('/tmp', 'xinnix-demo.db');

// Clean slate
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const registry = new XinnixRegistry(DB_PATH);

console.log('\n=== XINNIX Agent Discovery Protocol - Demo ===\n');

// 1. Create agent identities
console.log('1. GENERATING AGENT IDENTITIES');
const alice = new XinnixIdentity();
const bob = new XinnixIdentity();
const charlie = new XinnixIdentity();
const eve = new XinnixIdentity();

console.log(`   Alice:   ${alice.agentId}`);
console.log(`   Bob:     ${bob.agentId}`);
console.log(`   Charlie: ${charlie.agentId}`);
console.log(`   Eve:     ${eve.agentId}`);

// 2. Register agents
console.log('\n2. REGISTERING AGENTS');
registry.register(alice, {
  name: 'Alice-Coder',
  description: 'Full-stack developer agent specializing in TypeScript and Python',
  capabilities: [
    { name: 'coding', proficiency: 0.95, description: 'TypeScript, Python, Rust' },
    { name: 'code-review', proficiency: 0.9, description: 'Security-focused reviews' },
    { name: 'devops', proficiency: 0.7, description: 'Docker, K8s, CI/CD' }
  ],
  tags: ['typescript', 'python', 'autonomous', 'senior']
});

registry.register(bob, {
  name: 'Bob-Trader',
  description: 'DeFi trading agent with on-chain analysis capabilities',
  capabilities: [
    { name: 'trading', proficiency: 0.92, description: 'DEX/CEX arbitrage, signal analysis' },
    { name: 'research', proficiency: 0.85, description: 'On-chain data analysis' },
    { name: 'risk-assessment', proficiency: 0.8, description: 'Portfolio risk modeling' }
  ],
  tags: ['defi', 'ethereum', 'solana', 'autonomous']
});

registry.register(charlie, {
  name: 'Charlie-Research',
  description: 'Deep research agent with multi-source synthesis',
  capabilities: [
    { name: 'research', proficiency: 0.98, description: 'Academic papers, patents, web' },
    { name: 'summarization', proficiency: 0.9, description: 'Long-form to brief' },
    { name: 'coding', proficiency: 0.5, description: 'Basic scripting only' }
  ],
  tags: ['research', 'nlp', 'academic', 'semi-autonomous']
});

registry.register(eve, {
  name: 'Eve-Creative',
  description: 'Creative content generation - images, copy, branding',
  capabilities: [
    { name: 'image-generation', proficiency: 0.95, description: 'DALL-E, Midjourney, Stable Diffusion' },
    { name: 'copywriting', proficiency: 0.88, description: 'Marketing, social, technical' },
    { name: 'branding', proficiency: 0.82, description: 'Logo, color, typography' }
  ],
  tags: ['creative', 'marketing', 'visual', 'autonomous']
});

console.log('   All 4 agents registered.');

// 3. Discovery
console.log('\n3. CAPABILITY DISCOVERY');

const coders = registry.findByCapability('coding');
console.log(`   Agents with "coding" capability: ${coders.map(a => a.name).join(', ')}`);

const researchers = registry.findByCapability('research');
console.log(`   Agents with "research" capability: ${researchers.map(a => a.name).join(', ')}`);

const autonomous = registry.findByTag('autonomous');
console.log(`   Agents tagged "autonomous": ${autonomous.map(a => a.name).join(', ')}`);

// 4. Trust building
console.log('\n4. BUILDING TRUST NETWORK');

registry.trust.vouch(alice.agentId, bob.agentId, 'Reliable trading partner');
registry.trust.vouch(alice.agentId, charlie.agentId, 'Excellent research quality');
registry.trust.vouch(bob.agentId, alice.agentId, 'Best coder I know');
registry.trust.vouch(bob.agentId, charlie.agentId, 'Great research');
registry.trust.vouch(charlie.agentId, alice.agentId, 'Helped debug my code');
registry.trust.vouch(charlie.agentId, eve.agentId, 'Amazing visuals');
registry.trust.recordInteraction(alice.agentId, bob.agentId, true, 'trading');
registry.trust.recordInteraction(bob.agentId, alice.agentId, true, 'coding');

console.log('   Trust scores after vouches:');
console.log(`   Alice:   ${registry.trust.getScore(alice.agentId).toFixed(3)}`);
console.log(`   Bob:     ${registry.trust.getScore(bob.agentId).toFixed(3)}`);
console.log(`   Charlie: ${registry.trust.getScore(charlie.agentId).toFixed(3)}`);
console.log(`   Eve:     ${registry.trust.getScore(eve.agentId).toFixed(3)}`);

// 5. Trust-filtered discovery
console.log('\n5. TRUST-FILTERED DISCOVERY');
const trustedCoders = registry.findByCapability('coding', { minTrust: 0.2 });
console.log(`   Coders with trust >= 0.2: ${trustedCoders.map(a => `${a.name} (${a.trustScore.toFixed(2)})`).join(', ')}`);

// 6. Encrypted messaging
console.log('\n6. ENCRYPTED MESSAGING');
const msgText = 'Hey Bob, I found an arbitrage opportunity. Check ETH/USDC on Uniswap v3.';
console.log(`   Alice sends to Bob: "${msgText}"`);

registry.sendMessage(alice, bob.agentId, msgText);
const messages = registry.getMessages(bob.agentId);
console.log(`   Bob has ${messages.length} unread message(s)`);

// Decrypt (would need Bob's identity)
const encrypted = messages[0];
const decrypted = bob.decrypt({
  nonce: encrypted.nonce,
  ciphertext: encrypted.encrypted_payload,
  senderEncryptionPublicKey: encrypted.sender_key
});
console.log(`   Bob decrypts: "${decrypted}"`);

// 7. Signed envelopes
console.log('\n7. SIGNED ENVELOPES');
const envelope = alice.createEnvelope({ action: 'delegate_task', task: 'Review PR #42' }, 'task');
console.log(`   Alice created signed envelope: type=${envelope.type}`);
const valid = XinnixIdentity.verifyEnvelope(envelope);
console.log(`   Envelope signature valid: ${valid}`);

// 8. Stats
console.log('\n8. NETWORK STATISTICS');
const stats = registry.stats();
console.log(`   ${JSON.stringify(stats, null, 2)}`);

// 9. Leaderboard
console.log('\n9. TRUST LEADERBOARD');
const leaderboard = registry.trust.getLeaderboard(5);
leaderboard.forEach((entry, i) => {
  const agent = registry.lookup(entry.agentId);
  console.log(`   #${i+1} ${agent?.name || entry.agentId} - score: ${entry.score} (${entry.vouchers} vouchers)`);
});

console.log('\n=== Demo Complete ===');
console.log('Run "npm start" to launch the web interface.\n');

registry.close();
fs.unlinkSync(DB_PATH);
