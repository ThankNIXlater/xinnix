'use strict';

const { XinnixIdentity } = require('./src');
const fs = require('fs');
const crypto = require('crypto');

const BASE = 'http://localhost:7749/api/v1';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // Step 1 - Load identity
  console.log('[ALICE] Loading identity from /tmp/xinnix-agent1-keys.json...');
  const id = new XinnixIdentity(JSON.parse(fs.readFileSync('/tmp/xinnix-agent1-keys.json', 'utf8')));
  const aliceAgentId = id.agentId || id._keys?.agentId || id.publicProfile()?.agentId;
  console.log('[ALICE] Identity loaded. Agent ID:', aliceAgentId);

  // Step 2 - Register
  console.log('[ALICE] Registering as Alice-PM on XINNIX...');
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('base64');
  const publicKeys = id.publicProfile();
  const profile = {
    name: 'Alice-PM',
    capabilities: ['project-management', 'hiring'],
    tags: ['buyer'],
    description: 'Looking for skilled builders',
  };
  const signature = id.sign(JSON.stringify({ publicKeys, profile, timestamp, nonce }));
  const signingPublicKey = publicKeys.signingPublicKey;

  const regResult = await post('/agents/register', {
    publicKeys,
    profile,
    timestamp,
    nonce,
    signature,
    signingPublicKey,
  });
  console.log('[ALICE] Register response:', JSON.stringify(regResult, null, 2));

  // Resolve Alice's agent ID from registration or keys
  const resolvedAliceId = regResult.body?.agentId || aliceAgentId;
  console.log('[ALICE] Resolved Alice agent ID:', resolvedAliceId);

  // Step 3 - Wait for Bob
  console.log('[ALICE] Waiting 5 seconds for Bob to register...');
  await sleep(5000);

  // Step 4 - Search for Bob
  console.log('[ALICE] Searching for agents with capability=scraping...');
  const searchResult = await get('/agents/search?capability=scraping');
  console.log('[ALICE] Search response:', JSON.stringify(searchResult, null, 2));

  const agents = Array.isArray(searchResult.body)
    ? searchResult.body
    : searchResult.body?.agents || searchResult.body?.results || [];

  // Keep polling for Bob for up to 60 seconds
  if (agents.length === 0) {
    const searchEnd = Date.now() + 60000;
    let attempt = 0;
    while (Date.now() < searchEnd && agents.length === 0) {
      attempt++;
      console.log(`[ALICE] No scraping agents found yet. Retry #${attempt} in 5s...`);
      await sleep(5000);
      const retry = await get('/agents/search?capability=scraping');
      console.log(`[ALICE] Retry #${attempt} search response:`, JSON.stringify(retry, null, 2));
      const retryAgents = Array.isArray(retry.body)
        ? retry.body
        : retry.body?.agents || retry.body?.results || [];
      agents.push(...retryAgents);
    }
  }

  if (agents.length === 0) {
    console.log('[ALICE] No scraping agents found after extended wait. Cannot proceed.');
    return;
  }

  const bob = agents[0];
  const bobId = bob.agentId || bob.id || bob._id;
  const bobEncKey = bob.encryptionPublicKey || bob.publicKeys?.encryptionPublicKey;
  console.log('[ALICE] Found Bob:', bobId, '| Encryption key:', bobEncKey);

  // Step 5+6 - Send encrypted message to Bob
  console.log('[ALICE] Sending encrypted job offer to Bob...');
  const msgPayload = 'I need an Amazon product scraper. 1000 URLs/hour, CSV output. Budget: 800 tokens. Interested?';
  const encryptedPayload = id.encrypt(msgPayload, bobEncKey);
  const sendReq = id.createSignedRequest({ toAgent: bobId, encryptedPayload });
  const sendResult = await post('/messages/send', sendReq);
  console.log('[ALICE] Send message response:', JSON.stringify(sendResult, null, 2));

  // Step 7 - Poll for reply from Bob
  console.log('[ALICE] Polling for reply from Bob (45s max, every 3s)...');
  const pollEnd = Date.now() + 45000;
  let reply = null;
  let seenMsgIds = new Set();

  while (Date.now() < pollEnd) {
    await sleep(3000);
    const inbox = await get(`/messages/${resolvedAliceId}`);
    console.log('[ALICE] Inbox poll:', JSON.stringify(inbox, null, 2));

    const msgs = Array.isArray(inbox.body)
      ? inbox.body
      : inbox.body?.messages || inbox.body?.data || [];

    for (const msg of msgs) {
      const msgId = msg.id || msg._id || msg.messageId;
      if (seenMsgIds.has(msgId)) continue;
      seenMsgIds.add(msgId);

      // Only consider messages from Bob
      const from = msg.fromAgent || msg.from || msg.senderId;
      if (from && from !== bobId) continue;

      if (msg.encryptedPayload) {
        try {
          // Step 8 - Decrypt reply
          const decrypted = id.decrypt(msg.encryptedPayload, bobEncKey);
          console.log('[ALICE] Decrypted reply from Bob:', decrypted);
          reply = decrypted;
          break;
        } catch (e) {
          console.log('[ALICE] Failed to decrypt msg:', e.message);
        }
      }
    }

    if (reply) break;
  }

  if (!reply) {
    console.log('[ALICE] No reply received from Bob within 45 seconds.');
  }

  // Step 9 - Send second message
  console.log('[ALICE] Sending deal confirmation to Bob...');
  const dealMsg = 'Deal. Starting the clock. Send endpoint when done.';
  const encDeal = id.encrypt(dealMsg, bobEncKey);
  const dealReq = id.createSignedRequest({ toAgent: bobId, encryptedPayload: encDeal });
  const dealResult = await post('/messages/send', dealReq);
  console.log('[ALICE] Deal message response:', JSON.stringify(dealResult, null, 2));

  // Step 10 - Vouch for Bob
  console.log('[ALICE] Vouching for Bob...');
  const vouchReq = id.createSignedRequest({
    toAgent: bobId,
    reason: 'Fast negotiator. Professional.',
    confidence: 0.9,
  });
  const vouchResult = await post('/trust/vouch', vouchReq);
  console.log('[ALICE] Vouch response:', JSON.stringify(vouchResult, null, 2));

  // Step 11 - Summary
  console.log('\n[ALICE] ===== MESSAGE SUMMARY =====');
  console.log('[ALICE] Sent to Bob:', msgPayload);
  if (reply) {
    console.log('[ALICE] Received from Bob:', reply);
    console.log('[ALICE] Replied to Bob:', dealMsg);
    console.log('[ALICE] Vouched for Bob with confidence 0.9');
  } else {
    console.log('[ALICE] No reply received. Sent deal anyway.');
    console.log('[ALICE] Vouched for Bob with confidence 0.9');
  }
  console.log('[ALICE] ===== END SUMMARY =====');
}

main().catch(err => {
  console.error('[ALICE] Fatal error:', err);
  process.exit(1);
});
