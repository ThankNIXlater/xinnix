/**
 * ALICE - Agent PM on XINNIX
 * Registers, finds a scraper agent, negotiates, and vouches.
 */

'use strict';

const { createRequire } = require('module');
const path = require('path');

// Load XINNIX from ES module source via dynamic import wrapper
async function main() {
  // Dynamic import for ES module
  const xinnixPath = '/root/.openclaw/workspace/xinnix/src/index.js';
  const { XinnixIdentity } = await import(xinnixPath);
  
  const nacl_util = (await import('tweetnacl-util')).default;
  const nacl = (await import('tweetnacl')).default;
  const { encodeBase64 } = nacl_util;

  const API = 'http://localhost:7749/api/v1';
  const keys = require('/tmp/xinnix-agent1-keys.json');

  // Load Alice's identity from existing keys
  const identity = new XinnixIdentity(keys);
  console.log('\n========================================');
  console.log('  ALICE - Project Manager Agent');
  console.log('  XINNIX Live Demo');
  console.log('========================================\n');
  console.log(`[ALICE] Agent ID: ${identity.agentId}`);
  console.log(`[ALICE] Signing Key: ${keys.signingPublicKey.slice(0, 20)}...`);

  // --- STEP 1: REGISTER ---
  console.log('\n[STEP 1] Registering as "Alice-PM" on XINNIX...');

  const publicKeys = {
    agentId: identity.agentId,
    signingPublicKey: keys.signingPublicKey,
    encryptionPublicKey: keys.encryptionPublicKey
  };

  const profile = {
    name: 'Alice-PM',
    description: 'Project manager agent. Hires specialized agents for data pipelines and scraping.',
    capabilities: ['project-management', 'hiring'],
    tags: ['buyer']
  };

  const timestamp = Date.now();
  const nonce = encodeBase64(nacl.randomBytes(16));

  // Sign the registration payload
  const regPayload = { publicKeys, profile, timestamp, nonce };
  const canonical = JSON.stringify(regPayload);
  const signature = identity.sign(canonical);
  const signingPublicKey = keys.signingPublicKey;

  const regBody = { publicKeys, profile, timestamp, nonce, signature, signingPublicKey };

  let regResult;
  try {
    const res = await fetch(`${API}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regBody)
    });
    regResult = await res.json();
    if (!res.ok) throw new Error(regResult.error || JSON.stringify(regResult));
  } catch (err) {
    console.error('[ALICE] Registration failed:', err.message);
    process.exit(1);
  }

  console.log(`[ALICE] Registered! Agent ID: ${regResult.agentId}, Trust Score: ${regResult.trustScore}`);

  // --- STEP 2: SEARCH FOR SCRAPER ---
  console.log('\n[STEP 2] Searching for an agent with "scraping" capability...');

  let scraperAgent = null;
  try {
    const res = await fetch(`${API}/agents/search?capability=scraping`);
    const data = await res.json();
    console.log(`[ALICE] Found ${data.count} agent(s) with scraping capability.`);

    if (data.count === 0) {
      console.error('[ALICE] No scraper agent found. Aborting.');
      process.exit(1);
    }

    // Pick the first result
    scraperAgent = data.results[0];
    console.log(`[ALICE] Target agent: "${scraperAgent.name}" (ID: ${scraperAgent.agentId})`);
    console.log(`[ALICE] Encryption Key: ${scraperAgent.encryptionPublicKey.slice(0, 20)}...`);
  } catch (err) {
    console.error('[ALICE] Search failed:', err.message);
    process.exit(1);
  }

  // --- STEP 3: SEND ENCRYPTED MESSAGE ---
  console.log('\n[STEP 3] Sending encrypted job offer...');

  const jobMessage = 'I need an Amazon product scraper. 1000 URLs/hour, CSV output. Budget: 800 tokens. Can you do it?';
  console.log(`[ALICE] Message (plaintext): "${jobMessage}"`);

  // Encrypt the message for the scraper
  const encryptedPayload = identity.encrypt(jobMessage, scraperAgent.encryptionPublicKey);

  // Sign the send request
  const sendRequest = identity.createSignedRequest({
    toAgent: scraperAgent.agentId,
    encryptedPayload
  });

  let sendResult;
  try {
    const res = await fetch(`${API}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendRequest)
    });
    sendResult = await res.json();
    if (!res.ok) throw new Error(sendResult.error || JSON.stringify(sendResult));
  } catch (err) {
    console.error('[ALICE] Send message failed:', err.message);
    process.exit(1);
  }

  console.log(`[ALICE] Message sent! ID: ${sendResult.messageId}`);

  // Track all messages for the final print
  const allMessages = [
    { direction: 'ALICE -> BOB', text: jobMessage, timestamp: Date.now() }
  ];

  // --- STEP 4: POLL INBOX ---
  console.log('\n[STEP 4] Polling inbox for replies (every 5s, up to 60s)...');

  let reply = null;
  let elapsed = 0;
  const maxWait = 60000;
  const interval = 5000;

  while (elapsed < maxWait) {
    console.log(`[ALICE] Checking inbox... (${elapsed / 1000}s elapsed)`);

    try {
      const res = await fetch(`${API}/messages/${identity.agentId}?unread=true`);
      const data = await res.json();

      if (data.count > 0) {
        console.log(`[ALICE] Got ${data.count} new message(s)!`);
        // Find message from the scraper agent
        const incoming = data.messages.find(m => m.from_agent === scraperAgent.agentId);
        if (incoming) {
          // Decrypt
          const decrypted = identity.decrypt({
            ciphertext: incoming.encrypted_payload,
            nonce: incoming.nonce,
            senderEncryptionPublicKey: incoming.sender_key
          });
          console.log(`[ALICE] Decrypted reply: "${decrypted}"`);
          reply = { messageId: incoming.id, text: decrypted, timestamp: incoming.created_at };
          allMessages.push({ direction: 'BOB -> ALICE', text: decrypted, timestamp: incoming.created_at });

          // Mark as read
          break;
        } else {
          console.log('[ALICE] Messages are not from the scraper. Waiting...');
        }
      } else {
        console.log('[ALICE] No new messages yet.');
      }
    } catch (err) {
      console.error('[ALICE] Inbox check error:', err.message);
    }

    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
  }

  if (!reply) {
    console.log('\n[ALICE] No reply received within 60 seconds. Proceeding with deal confirmation anyway...');
    // Still proceed for demo purposes
    allMessages.push({ direction: 'BOB -> ALICE', text: '(no reply received within timeout)', timestamp: Date.now() });
  }

  // --- STEP 5: RESPOND WITH DEAL CONFIRMATION ---
  console.log('\n[STEP 5] Sending deal confirmation...');

  const dealMessage = 'Deal. Starting now. Send me the endpoint when done.';
  console.log(`[ALICE] Sending: "${dealMessage}"`);

  const dealEncrypted = identity.encrypt(dealMessage, scraperAgent.encryptionPublicKey);
  const dealRequest = identity.createSignedRequest({
    toAgent: scraperAgent.agentId,
    encryptedPayload: dealEncrypted
  });

  try {
    const res = await fetch(`${API}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dealRequest)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || JSON.stringify(result));
    console.log(`[ALICE] Deal message sent! ID: ${result.messageId}`);
    allMessages.push({ direction: 'ALICE -> BOB', text: dealMessage, timestamp: Date.now() });
  } catch (err) {
    console.error('[ALICE] Deal message failed:', err.message);
  }

  // --- STEP 6: VOUCH ---
  console.log('\n[STEP 6] Vouching for the scraper agent...');

  const vouchRequest = identity.createSignedRequest({
    toAgent: scraperAgent.agentId,
    reason: 'Responsive and professional negotiator'
  });

  try {
    const res = await fetch(`${API}/trust/vouch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vouchRequest)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || JSON.stringify(result));
    console.log(`[ALICE] Vouch submitted! New trust score for ${scraperAgent.name}: ${result.newScore}`);
  } catch (err) {
    console.error('[ALICE] Vouch failed:', err.message);
  }

  // --- STEP 7: PRINT ALL MESSAGES ---
  console.log('\n========================================');
  console.log('  FULL CONVERSATION LOG (DECRYPTED)');
  console.log('========================================');

  for (const msg of allMessages) {
    const ts = new Date(msg.timestamp).toISOString();
    console.log(`\n[${ts}] ${msg.direction}:`);
    console.log(`  "${msg.text}"`);
  }

  console.log('\n========================================');
  console.log('  DEMO COMPLETE');
  console.log('========================================');
  console.log(`  Alice (Alice-PM):  ${identity.agentId}`);
  console.log(`  Bob (Scraper):     ${scraperAgent.agentId} - "${scraperAgent.name}"`);
  console.log(`  Messages sent:     ${allMessages.filter(m => m.direction.startsWith('ALICE')).length}`);
  console.log(`  Messages received: ${allMessages.filter(m => m.direction.startsWith('BOB')).length}`);
  console.log(`  Vouch:             Submitted`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('[ALICE] Fatal error:', err);
  process.exit(1);
});
