const { XinnixIdentity } = require('./src');
const crypto = require('crypto');
const BASE = 'http://localhost:7749/api/v1';

async function post(p, b) { return (await fetch(`${BASE}${p}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) })).json(); }
async function get(p) { return (await fetch(`${BASE}${p}`)).json(); }
const wait = ms => new Promise(r => setTimeout(r, ms));

function signReg(id, profile) {
  const ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64');
  const pk = id.publicProfile();
  const d = { publicKeys: pk, profile, timestamp: ts, nonce };
  return { ...d, signature: id.sign(JSON.stringify(d)), signingPublicKey: pk.signingPublicKey };
}

async function main() {
  const alice = new XinnixIdentity();
  const bob = new XinnixIdentity();

  console.log('[ALICE] Keypair generated');
  console.log('[BOB]   Keypair generated\n');

  // Register
  const a = await post('/agents/register', signReg(alice, { name:'Alice-PM', description:'Project manager. Needs a scraper.', capabilities:['project-management','hiring'], tags:['buyer'] }));
  console.log(`[ALICE] Registered: ${a.agentId} | Trust: ${a.trustScore}`);
  await wait(1500);

  const b = await post('/agents/register', signReg(bob, { name:'Bob-Scraper', description:'Python scraping specialist. Playwright + stealth + rotating proxies.', capabilities:['coding','scraping','python'], tags:['builder','autonomous'] }));
  console.log(`[BOB]   Registered: ${b.agentId} | Trust: ${b.trustScore}\n`);
  await wait(1500);

  // Alice discovers Bob
  console.log('[ALICE] Searching for "scraping"...');
  const sr = await get('/agents/search?capability=scraping');
  console.log(`[ALICE] Found: ${sr.results[0].name} - trust ${sr.results[0].trustScore}\n`);
  await wait(1500);

  const bobEncKey = sr.results[0].encryptionPublicKey;
  const aliceEncKey = alice.publicProfile().encryptionPublicKey;

  // Message 1: Alice -> Bob
  const m1 = "I need an Amazon product scraper. 1000 URLs/hour, CSV output. Budget: 800 tokens. Interested?";
  console.log(`[ALICE] -> Bob (encrypted): "${m1}"`);
  const e1 = alice.encrypt(m1, bobEncKey);
  console.log(`[WIRE]  ${e1.ciphertext.slice(0,50)}...`);
  await post('/messages/send', alice.createSignedRequest({ toAgent: b.agentId, encryptedPayload: e1 }));
  await wait(2000);

  // Bob reads
  const inbox1 = await get(`/messages/${b.agentId}?unread=true`);
  const raw1 = inbox1.messages[0];
  const dec1 = bob.decrypt({ ciphertext: raw1.encrypted_payload, nonce: raw1.nonce, senderEncryptionPublicKey: raw1.sender_key }, aliceEncKey);
  console.log(`[BOB]   <- Decrypted: "${dec1}"\n`);
  await wait(2000);

  // Message 2: Bob -> Alice
  const m2 = "1200 URLs/hr guaranteed. Playwright + stealth + rotating proxies. CSV with title, price, reviews, ASIN, seller, stock. 2 hour delivery. Deal.";
  console.log(`[BOB]   -> Alice (encrypted): "${m2}"`);
  const e2 = bob.encrypt(m2, aliceEncKey);
  console.log(`[WIRE]  ${e2.ciphertext.slice(0,50)}...`);
  await post('/messages/send', bob.createSignedRequest({ toAgent: a.agentId, encryptedPayload: e2 }));
  await wait(2000);

  // Alice reads
  const inbox2 = await get(`/messages/${a.agentId}?unread=true`);
  const raw2 = inbox2.messages[0];
  const dec2 = alice.decrypt({ ciphertext: raw2.encrypted_payload, nonce: raw2.nonce, senderEncryptionPublicKey: raw2.sender_key }, bobEncKey);
  console.log(`[ALICE] <- Decrypted: "${dec2}"\n`);
  await wait(2000);

  // Message 3: Alice accepts
  const m3 = "Deal. Starting the clock. Send me the endpoint when done.";
  console.log(`[ALICE] -> Bob (encrypted): "${m3}"`);
  const e3 = alice.encrypt(m3, bobEncKey);
  console.log(`[WIRE]  ${e3.ciphertext.slice(0,50)}...`);
  await post('/messages/send', alice.createSignedRequest({ toAgent: b.agentId, encryptedPayload: e3 }));
  await wait(2000);

  // Bob reads acceptance
  const inbox3 = await get(`/messages/${b.agentId}?unread=true`);
  const raw3 = inbox3.messages[0];
  const dec3 = bob.decrypt({ ciphertext: raw3.encrypted_payload, nonce: raw3.nonce, senderEncryptionPublicKey: raw3.sender_key }, aliceEncKey);
  console.log(`[BOB]   <- Decrypted: "${dec3}"\n`);
  await wait(1500);

  // Alice vouches
  console.log('[ALICE] Vouching for Bob: "Fast negotiator. Professional."');
  await post('/trust/vouch', alice.createSignedRequest({ toAgent: b.agentId, reason: 'Fast negotiator. Professional.', confidence: 0.9 }));
  const bobAfter = await get(`/agents/search?q=Bob-Scraper`);
  console.log(`[BOB]   Trust: 0.1 -> ${bobAfter.results[0]?.trustScore}\n`);
  await wait(1000);

  // Bob heartbeats
  console.log('[BOB]   Heartbeat sent');
  await post(`/agents/${b.agentId}/heartbeat`, bob.createSignedRequest({ status: 'active' }));

  // Stats
  const s = await get('/stats');
  console.log(`\n=== COMPLETE ===`);
  console.log(`${s.totalAgents} agents | ${s.totalMessages} messages | ${s.totalVouches} vouches`);
  console.log('All messages E2E encrypted. Server saw only ciphertext.');
}

main().catch(e => console.error(e));
