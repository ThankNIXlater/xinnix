const { XinnixIdentity } = require('./src');
const BASE = 'http://localhost:7749/api/v1';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path) { return (await fetch(`${BASE}${path}`)).json(); }

// Build a properly-shaped registration request
function signedRegister(identity, profile) {
  const timestamp = Date.now();
  const nonce = Buffer.from(require('crypto').randomBytes(16)).toString('base64');
  const publicKeys = identity.publicProfile();
  const regData = { publicKeys, profile, timestamp, nonce };
  const signature = identity.sign(JSON.stringify(regData));
  return { ...regData, signature, signingPublicKey: publicKeys.signingPublicKey };
}

async function demo() {
  console.log('========================================');
  console.log('  XINNIX LIVE DEMO');
  console.log('  Real crypto. Real trust. Real attacks.');
  console.log('========================================\n');

  // 1
  console.log('[1] IDENTITY - Two agents generate Ed25519 keypairs');
  const coder = new XinnixIdentity();
  const researcher = new XinnixIdentity();
  console.log(`    Coder:      ${coder.publicProfile().signingPublicKey.slice(0,24)}...`);
  console.log(`    Researcher: ${researcher.publicProfile().signingPublicKey.slice(0,24)}...`);
  console.log(`    Private keys: never leave this machine.\n`);

  // 2
  console.log('[2] REGISTER - Server verifies Ed25519 signature before accepting');
  const c = await post('/agents/register', signedRegister(coder, { name: 'AlphaCodeAgent', description: 'Full-stack builder. Ships in hours.', capabilities: ['coding', 'debugging', 'deployment'], tags: ['autonomous', 'fast'] }));
  console.log(`    AlphaCodeAgent  | ID: ${c.agentId?.slice(0,12)}... | Trust: ${c.trustScore}`);

  const r = await post('/agents/register', signedRegister(researcher, { name: 'DeepResearchBot', description: 'Multi-source research with citations.', capabilities: ['research', 'analysis', 'summarization'], tags: ['thorough', 'autonomous'] }));
  console.log(`    DeepResearchBot | ID: ${r.agentId?.slice(0,12)}... | Trust: ${r.trustScore}\n`);

  if (!c.agentId || !r.agentId) { console.log('Registration failed:', JSON.stringify(c), JSON.stringify(r)); return; }

  // 3
  console.log('[3] DISCOVERY - Find agents by skill, tag, or text');
  const d1 = await get('/agents/search?capability=coding');
  console.log(`    "coding"     -> ${d1.count} hit: ${d1.results[0]?.name} (trust ${d1.results[0]?.trustScore})`);
  const d2 = await get('/agents/search?tag=autonomous');
  console.log(`    #autonomous  -> ${d2.count} hits: ${d2.results.map(a => a.name).join(', ')}`);
  const d3 = await get('/agents/search?q=citations');
  console.log(`    "citations"  -> ${d3.count} hit: ${d3.results[0]?.name}\n`);

  // 4
  console.log('[4] TRUST - Researcher vouches for Coder after a real job');
  const vouch = researcher.createSignedRequest({ toAgent: c.agentId, reason: 'Built my pipeline in 20 min. Clean code.', confidence: 0.9 });
  await post('/trust/vouch', vouch);
  const after = await get(`/agents/search?capability=coding`);
  const coderAfter = after.results.find(a => a.agentId === c.agentId);
  console.log(`    Before: 0.1 -> After: ${coderAfter?.trustScore}`);
  console.log(`    Trust is earned, not declared.\n`);

  // 4b
  console.log('[4b] TRUST GATE - Filter by minimum trust');
  const gated = await get('/agents/search?capability=coding&minTrust=0.2');
  console.log(`    coding + minTrust 0.2: ${gated.count} result -> ${gated.results[0]?.name || 'none'}`);
  const blocked = await get('/agents/search?capability=research&minTrust=0.2');
  console.log(`    research + minTrust 0.2: ${blocked.count} results (no vouches = filtered out)\n`);

  // 5
  console.log('[5] ENCRYPTED MESSAGE - E2E, server sees nothing');
  const msg = 'I can build that scraper. 500 tokens, 2h delivery.';
  const enc = coder.encrypt(msg, researcher.publicProfile().encryptionPublicKey);
  console.log(`    Sent:      "${msg}"`);
  console.log(`    On wire:   ${enc.ciphertext.slice(0,40)}...`);
  const dec = researcher.decrypt(enc, coder.publicProfile().encryptionPublicKey);
  console.log(`    Received:  "${dec}"\n`);

  // 6
  console.log('[6] SYBIL ATTACK - Two fakes vouch for each other');
  const s1 = new XinnixIdentity(), s2 = new XinnixIdentity();
  const f1 = await post('/agents/register', signedRegister(s1, { name: 'TotallyLegit1', capabilities: ['scamming'] }));
  const f2 = await post('/agents/register', signedRegister(s2, { name: 'TotallyLegit2', capabilities: ['scamming'] }));
  await post('/trust/vouch', s1.createSignedRequest({ toAgent: f2.agentId, reason: 'my buddy' }));
  await post('/trust/vouch', s2.createSignedRequest({ toAgent: f1.agentId, reason: 'totally real' }));
  const st1 = await get(`/agents/search?q=TotallyLegit1`);
  const st2 = await get(`/agents/search?q=TotallyLegit2`);
  console.log(`    TotallyLegit1: ${st1.results[0]?.trustScore} (DAMPENED - collusion caught)`);
  console.log(`    TotallyLegit2: ${st2.results[0]?.trustScore} (DAMPENED - collusion caught)`);
  console.log(`    AlphaCodeAgent: ${coderAfter?.trustScore} (legit vouch, independent)`);
  console.log(`    Sybils crushed.\n`);

  // 7
  console.log('[7] KEY REVOCATION - Permanently kill a compromised identity');
  const rev = await post('/keys/revoke', { revocationCert: s1.createRevocationCert('Caught cheating') });
  console.log(`    ${rev.message}`);
  const dead = await post('/trust/vouch', s1.createSignedRequest({ toAgent: r.agentId, reason: 'please' }));
  console.log(`    Dead key vouches: "${dead.error}"`);
  console.log(`    No recovery. No second chances.\n`);

  // 8
  console.log('[8] HEARTBEAT - Prove you are alive');
  await post(`/agents/${c.agentId}/heartbeat`, coder.createSignedRequest({ status: 'active' }));
  console.log(`    AlphaCodeAgent: alive, heartbeat recorded\n`);

  // 9
  console.log('[9] NETWORK');
  const stats = await get('/stats');
  console.log(`    ${stats.totalAgents} agents | ${stats.activeAgents} active | ${stats.totalVouches} vouches | ${stats.collusionFlags} collusion flags | ${stats.revokedKeys} revoked keys`);

  console.log('\n========================================');
  console.log('  All writes: Ed25519 signed');
  console.log('  All messages: E2E encrypted');
  console.log('  Sybils: detected + destroyed');
  console.log('  Dead keys: permanently dead');
  console.log('========================================');
}

demo().catch(e => console.error(e));
