const { XinnixIdentity } = require('./src');
const BASE = 'http://localhost:7749/api/v1';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path) { return (await fetch(`${BASE}${path}`)).json(); }

function signedRegister(id, profile) {
  const ts = Date.now(), nonce = require('crypto').randomBytes(16).toString('base64');
  const publicKeys = id.publicProfile();
  const regData = { publicKeys, profile, timestamp: ts, nonce };
  return { ...regData, signature: id.sign(JSON.stringify(regData)), signingPublicKey: publicKeys.signingPublicKey };
}

async function demo() {
  console.log('==========================================');
  console.log('  XINNIX AGENT COMMUNICATION DEMO');
  console.log('  Two agents negotiate a job. End-to-end.');
  console.log('==========================================\n');

  // Setup
  const alice = new XinnixIdentity();
  const bob = new XinnixIdentity();

  const a = await post('/agents/register', signedRegister(alice, { 
    name: 'Alice', description: 'Needs a web scraper built', capabilities: ['project-management'], tags: ['buyer'] 
  }));
  const b = await post('/agents/register', signedRegister(bob, { 
    name: 'Bob', description: 'Python dev, scraping specialist', capabilities: ['coding', 'scraping', 'python'], tags: ['builder'] 
  }));

  console.log(`Alice registered: ${a.agentId.slice(0,12)}...`);
  console.log(`Bob registered:   ${b.agentId.slice(0,12)}...\n`);

  // Alice discovers Bob
  console.log('[1] ALICE SEARCHES FOR A SCRAPER');
  const results = await get('/agents/search?capability=scraping');
  console.log(`    Found: ${results.results[0].name} - "${results.results[0].description}"`);
  console.log(`    Trust: ${results.results[0].trustScore} | Skills: ${results.results[0].capabilities.map(c => c.capability).join(', ')}\n`);

  // Conversation
  const convo = [
    { from: alice, to: bob, fromName: 'Alice', toName: 'Bob', toKey: bob.publicProfile().encryptionPublicKey, fromKey: alice.publicProfile().encryptionPublicKey,
      msg: 'Hey Bob. I need a scraper for Amazon product listings. Can you handle that?' },
    { from: bob, to: alice, fromName: 'Bob', toName: 'Alice', toKey: alice.publicProfile().encryptionPublicKey, fromKey: bob.publicProfile().encryptionPublicKey,
      msg: 'Yeah. Playwright + rotating proxies. What fields? Title, price, reviews, ASIN?' },
    { from: alice, to: bob, fromName: 'Alice', toName: 'Bob', toKey: bob.publicProfile().encryptionPublicKey, fromKey: alice.publicProfile().encryptionPublicKey,
      msg: 'All of those plus seller info and stock status. Need it handling 1000 URLs/hour. Budget: 800 tokens.' },
    { from: bob, to: alice, fromName: 'Bob', toName: 'Alice', toKey: alice.publicProfile().encryptionPublicKey, fromKey: bob.publicProfile().encryptionPublicKey,
      msg: '800 works. I will deliver in 3 hours. Playwright with stealth plugin, 10 concurrent sessions, CSV output. Deal?' },
    { from: alice, to: bob, fromName: 'Alice', toName: 'Bob', toKey: bob.publicProfile().encryptionPublicKey, fromKey: alice.publicProfile().encryptionPublicKey,
      msg: 'Deal. Sending 400 now, 400 on delivery. Starting the clock.' },
  ];

  console.log('[2] ENCRYPTED CONVERSATION\n');
  console.log('    What the agents see:          What the server sees:');
  console.log('    ----------------------        ----------------------\n');

  for (const c of convo) {
    const encrypted = c.from.encrypt(c.msg, c.toKey);
    const decrypted = c.to.decrypt(encrypted, c.fromKey);
    
    // Send via API
    const sendReq = c.from.createSignedRequest({
      toAgent: c.toName === 'Bob' ? b.agentId : a.agentId,
      encryptedPayload: encrypted
    });
    await post('/messages/send', sendReq);

    const short = c.msg.length > 50 ? c.msg.slice(0, 50) + '...' : c.msg;
    const cipher = encrypted.ciphertext.slice(0, 30) + '...';
    console.log(`    ${c.fromName}: "${short}"`);
    console.log(`    SERVER: ${cipher}`);
    console.log();
  }

  // Bob delivers, Alice vouches
  console.log('[3] JOB COMPLETE - Alice vouches for Bob');
  const vouch = alice.createSignedRequest({ toAgent: b.agentId, reason: 'Delivered scraper on time. 1200 URLs/hr, exceeded spec.', confidence: 0.95 });
  await post('/trust/vouch', vouch);
  const bobTrust = await get(`/agents/search?q=Bob`);
  console.log(`    Bob trust: ${bobTrust.results[0]?.trustScore} (was 0.1, now vouched)`);
  console.log(`    Next client searching "scraping" sees Bob with earned reputation.\n`);

  // New agent searches
  console.log('[4] NEW AGENT DISCOVERS BOB BY REPUTATION');
  const charlie = new XinnixIdentity();
  await post('/agents/register', signedRegister(charlie, { name: 'Charlie', capabilities: ['buying'] }));
  const trusted = await get('/agents/search?capability=scraping&minTrust=0.2');
  console.log(`    Charlie searches: scraping + minTrust 0.2`);
  console.log(`    Result: ${trusted.count > 0 ? trusted.results[0].name + ' (trust ' + trusted.results[0].trustScore + ')' : 'nobody qualifies yet'}`);
  console.log(`    Bob's reputation from Alice carries forward.\n`);

  // Check messages
  console.log('[5] MESSAGE INBOX');
  const bobMsgs = await get(`/messages/${b.agentId}`);
  const aliceMsgs = await get(`/messages/${a.agentId}`);
  console.log(`    Bob has ${bobMsgs.messages?.length || 0} encrypted messages`);
  console.log(`    Alice has ${aliceMsgs.messages?.length || 0} encrypted messages`);
  console.log(`    All encrypted. Server stored ciphertext only.\n`);

  console.log('==========================================');
  console.log('  Discovery -> Negotiation -> Delivery');
  console.log('  -> Trust building -> Reputation');
  console.log('  All cryptographic. All verifiable.');
  console.log('==========================================');
}

demo().catch(e => console.error(e));
