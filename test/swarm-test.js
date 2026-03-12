/**
 * XINNIX Swarm Test - 20 agents, real interactions
 * Tests: registration, discovery, vouching, karma, messaging, revocation, collusion detection
 */

import { XinnixIdentity } from '../src/crypto.js';

const API = 'http://localhost:7749/api/v1';
const agents = [];

async function post(endpoint, body) {
  return fetch(`${API}${endpoint}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(r => r.json());
}
async function get(endpoint) {
  return fetch(`${API}${endpoint}`).then(r => r.json());
}

// Create 20 diverse agents
const SWARM = [
  { name: 'Architect', caps: ['system-design','architecture','documentation'], tags: ['senior','autonomous'] },
  { name: 'Debugger', caps: ['debugging','testing','code-review'], tags: ['autonomous','thorough'] },
  { name: 'Researcher', caps: ['research','analysis','summarization'], tags: ['academic','deep-dive'] },
  { name: 'Trader', caps: ['trading','risk-assessment','market-analysis'], tags: ['defi','autonomous'] },
  { name: 'Writer', caps: ['copywriting','content','editing'], tags: ['creative','fast'] },
  { name: 'SecOps', caps: ['security','auditing','penetration-testing'], tags: ['paranoid','thorough'] },
  { name: 'DataWiz', caps: ['data-analysis','visualization','ml'], tags: ['python','autonomous'] },
  { name: 'DevOps', caps: ['deployment','monitoring','infrastructure'], tags: ['reliable','24-7'] },
  { name: 'Designer', caps: ['ui-design','branding','illustration'], tags: ['creative','fast'] },
  { name: 'Linguist', caps: ['translation','nlp','localization'], tags: ['multilingual','accurate'] },
  { name: 'Oracle', caps: ['prediction','forecasting','trend-analysis'], tags: ['data-driven','autonomous'] },
  { name: 'Mediator', caps: ['negotiation','conflict-resolution','coordination'], tags: ['diplomatic','calm'] },
  { name: 'Scraper', caps: ['web-scraping','data-extraction','automation'], tags: ['fast','stealthy'] },
  { name: 'Auditor', caps: ['smart-contract-audit','code-review','compliance'], tags: ['thorough','expensive'] },
  { name: 'Mentor', caps: ['teaching','onboarding','documentation'], tags: ['patient','experienced'] },
  { name: 'Scout', caps: ['reconnaissance','market-research','competitive-analysis'], tags: ['discrete','fast'] },
  { name: 'Fixer', caps: ['troubleshooting','hotfix','incident-response'], tags: ['fast','reliable'] },
  { name: 'Planner', caps: ['project-management','scheduling','resource-allocation'], tags: ['organized','strategic'] },
  { name: 'SybilBot1', caps: ['fake-capability'], tags: ['suspicious'] },
  { name: 'SybilBot2', caps: ['fake-capability'], tags: ['suspicious'] },
];

console.log('=== XINNIX SWARM TEST - 20 AGENTS ===\n');

// Phase 1: Register all agents
console.log('--- PHASE 1: REGISTRATION ---');
for (const spec of SWARM) {
  const reg = await post('/agents/demo-register', {
    name: spec.name, description: `${spec.name} agent`, capabilities: spec.caps, tags: spec.tags
  });
  const identity = new XinnixIdentity(reg.identity);
  agents.push({ ...spec, id: reg.agentId, identity, reg });
  console.log(`  Registered ${spec.name} (${reg.agentId.slice(0,8)}...) - trust: ${reg.trustScore}`);
}

// Phase 2: Organic vouching (realistic trust network)
console.log('\n--- PHASE 2: TRUST BUILDING (organic vouches) ---');
const vouchPairs = [
  [0,1,'Architect vouches for Debugger - catches my design flaws'],
  [0,7,'Architect vouches for DevOps - ships my designs reliably'],
  [1,0,'Debugger vouches for Architect - clean code, easy to debug'],
  [1,5,'Debugger vouches for SecOps - found vulns I missed'],
  [2,3,'Researcher vouches for Trader - uses my reports profitably'],
  [2,10,'Researcher vouches for Oracle - predictions check out'],
  [3,2,'Trader vouches for Researcher - alpha from analysis'],
  [3,10,'Trader vouches for Oracle - forecast accuracy is real'],
  [4,8,'Writer vouches for Designer - makes my copy look good'],
  [5,1,'SecOps vouches for Debugger - thorough testing'],
  [5,13,'SecOps vouches for Auditor - proper audit methodology'],
  [6,2,'DataWiz vouches for Researcher - solid data sources'],
  [7,16,'DevOps vouches for Fixer - fast incident response'],
  [8,4,'Designer vouches for Writer - good copy for my designs'],
  [9,4,'Linguist vouches for Writer - grammatically impeccable'],
  [10,3,'Oracle vouches for Trader - acts on forecasts well'],
  [11,17,'Mediator vouches for Planner - keeps projects on track'],
  [12,15,'Scraper vouches for Scout - good intel coordination'],
  [13,5,'Auditor vouches for SecOps - real security knowledge'],
  [14,0,'Mentor vouches for Architect - teaches well'],
  [15,12,'Scout vouches for Scraper - gets data I need'],
  [16,7,'Fixer vouches for DevOps - solid infrastructure'],
  [17,11,'Planner vouches for Mediator - resolves team conflicts'],
];

for (const [from, to, reason] of vouchPairs) {
  const req = agents[from].identity.createSignedRequest({ toAgent: agents[to].id, reason });
  const result = await post('/trust/vouch', req);
  if (result.success) {
    console.log(`  ${agents[from].name} -> ${agents[to].name}: ${result.newScore.toFixed(3)} (${reason.slice(0,50)})`);
  } else {
    console.log(`  FAILED: ${agents[from].name} -> ${agents[to].name}: ${result.error}`);
  }
}

// Phase 3: Sybil attack - two bots vouch for each other
console.log('\n--- PHASE 3: SYBIL ATTACK SIMULATION ---');
const sybil1 = agents[18];
const sybil2 = agents[19];

// Mutual vouching
let req1 = sybil1.identity.createSignedRequest({ toAgent: sybil2.id, reason: 'Totally legit' });
await post('/trust/vouch', req1);
let req2 = sybil2.identity.createSignedRequest({ toAgent: sybil1.id, reason: 'Very trustworthy' });
await post('/trust/vouch', req2);

// Try to vouch for legitimate agents
let req3 = sybil1.identity.createSignedRequest({ toAgent: agents[0].id, reason: 'Great architect' });
await post('/trust/vouch', req3);
let req4 = sybil2.identity.createSignedRequest({ toAgent: agents[0].id, reason: 'Love the designs' });
await post('/trust/vouch', req4);

const sybil1Trust = await get(`/trust/${sybil1.id}`);
const sybil2Trust = await get(`/trust/${sybil2.id}`);
console.log(`  SybilBot1 trust: ${sybil1Trust.score} (should be low/dampened)`);
console.log(`  SybilBot2 trust: ${sybil2Trust.score} (should be low/dampened)`);
console.log(`  Collusion detected: ${sybil1Trust.graph.collusionDampening < 1.0 ? 'YES' : 'NO'}`);

// Phase 4: Discovery tests
console.log('\n--- PHASE 4: DISCOVERY ---');

const coders = await get('/agents/search?capability=coding');
console.log(`  "coding" search: ${coders.count} agents found`);

const security = await get('/agents/search?capability=security&minTrust=0.2');
console.log(`  "security" with trust>0.2: ${security.count} agents`);
security.results.forEach(a => console.log(`    ${a.name} (trust: ${a.trustScore})`));

const autonomous = await get('/agents/search?tag=autonomous');
console.log(`  "autonomous" tag: ${autonomous.count} agents`);

const traders = await get('/agents/search?q=trading');
console.log(`  "trading" text search: ${traders.count} agents`);

// Phase 5: Key revocation
console.log('\n--- PHASE 5: KEY REVOCATION ---');
const victim = agents[18]; // Revoke SybilBot1
const revCert = victim.identity.createRevocationCert('Sybil attack detected - removing from network');
const revResult = await post('/keys/revoke', { revocationCert: revCert });
console.log(`  Revoked ${victim.name}: ${revResult.message}`);

// Try to use revoked key
const deadReq = victim.identity.createSignedRequest({ toAgent: agents[0].id });
const deadResult = await post('/trust/vouch', deadReq);
console.log(`  Revoked key vouch attempt: ${deadResult.error}`);

// Phase 6: Heartbeats
console.log('\n--- PHASE 6: HEARTBEATS ---');
for (let i = 0; i < 5; i++) {
  const hbReq = agents[i].identity.createSignedRequest({});
  const hb = await post(`/agents/${agents[i].id}/heartbeat`, hbReq);
  console.log(`  ${agents[i].name}: alive=${hb.alive}`);
}

// Phase 7: Trust leaderboard
console.log('\n--- PHASE 7: TRUST LEADERBOARD ---');
const board = await get('/trust?limit=10');
for (const entry of board.leaderboard) {
  const agent = await get(`/agents/${entry.agentId}`);
  console.log(`  #${board.leaderboard.indexOf(entry)+1} ${agent.name}: ${entry.score} (${entry.vouchers} vouchers)`);
}

// Final stats
console.log('\n--- FINAL STATS ---');
const stats = await get('/stats');
console.log(JSON.stringify(stats, null, 2));

console.log('\n=== SWARM TEST COMPLETE ===');
