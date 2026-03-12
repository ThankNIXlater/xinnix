/**
 * XINNIX Agent BOB - Python Scraping Specialist
 * CJS wrapper using dynamic import() to load ESM src/
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ---- HTTP helper --------------------------------------------------------

function request(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Main ---------------------------------------------------------------

async function main() {
  const BASE = 'http://localhost:7749/api/v1';

  // Step 1 - Load identity
  console.log('[BOB] Loading identity from /tmp/xinnix-agent2-keys.json ...');
  const keyData = JSON.parse(fs.readFileSync('/tmp/xinnix-agent2-keys.json', 'utf8'));

  // Dynamic import because xinnix/src is pure ESM
  const { XinnixIdentity } = await import('./src/index.js');
  const id = new XinnixIdentity(keyData);
  console.log('[BOB] Identity loaded. agentId:', id.agentId);

  // Step 2 - Register
  console.log('[BOB] Building registration request ...');
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('base64');
  const publicKeys = id.publicProfile();
  const profile = {
    name: 'Bob-Scraper',
    capabilities: ['coding', 'scraping', 'python'],
    tags: ['builder', 'autonomous'],
    description: 'Python scraping specialist. Playwright + stealth.',
  };

  const signPayload = JSON.stringify({ publicKeys, profile, timestamp, nonce });
  const signature = id.sign(signPayload);
  const signingPublicKey = publicKeys.signingPublicKey;

  const regBody = { publicKeys, profile, timestamp, nonce, signature, signingPublicKey };
  console.log('[BOB] POSTing to', BASE + '/agents/register ...');
  const regResp = await request('POST', BASE + '/agents/register', regBody);
  console.log('[BOB] Registration response:', JSON.stringify(regResp.body, null, 2));

  if (regResp.status !== 200 && regResp.status !== 201) {
    console.log('[BOB] WARNING: Registration returned status', regResp.status, '- continuing anyway');
  }

  const bobAgentId = id.agentId;
  console.log('[BOB] Registered as agent ID:', bobAgentId);

  // Step 3 - Poll for messages (60 seconds, every 3 seconds)
  console.log('[BOB] Starting message poll (60s window, 3s interval) ...');
  const pollEnd = Date.now() + 60_000;
  let messagesReceived = [];
  let aliceId = null;
  let aliceEncKey = null;

  while (Date.now() < pollEnd) {
    const msgResp = await request('GET', BASE + '/messages/' + bobAgentId);
    console.log('[BOB] Poll response (status=' + msgResp.status + '):', JSON.stringify(msgResp.body, null, 2));

    const messages = Array.isArray(msgResp.body)
      ? msgResp.body
      : (msgResp.body && Array.isArray(msgResp.body.messages))
        ? msgResp.body.messages
        : [];

    if (messages.length > 0) {
      for (const msg of messages) {
        console.log('[BOB] Message received:', JSON.stringify(msg, null, 2));

        // Step 4 - Look up sender
        const senderId = msg.fromAgent || msg.from || msg.senderAgentId;
        if (!senderId) {
          console.log('[BOB] Could not determine sender ID - skipping');
          continue;
        }

        console.log('[BOB] Looking up sender:', senderId);
        const senderResp = await request('GET', BASE + '/agents/' + senderId);
        console.log('[BOB] Sender profile response:', JSON.stringify(senderResp.body, null, 2));

        const senderProfile = senderResp.body;
        const senderEncKeyRaw =
          (senderProfile.publicKeys && senderProfile.publicKeys.encryptionPublicKey) ||
          senderProfile.encryptionPublicKey;

        if (!senderEncKeyRaw) {
          console.log('[BOB] Could not find encryptionPublicKey for sender - skipping');
          continue;
        }

        // Step 5 - Decrypt message
        let decrypted;
        try {
          const payload = msg.encryptedPayload || msg.payload || msg;
          decrypted = id.decrypt(payload);
          console.log('[BOB] Decrypted message:', decrypted);
        } catch (err) {
          console.log('[BOB] Decryption error:', err.message);
          decrypted = '[decryption failed]';
        }

        messagesReceived.push({ from: senderId, decrypted });
        aliceId = senderId;
        aliceEncKey = senderEncKeyRaw;

        // Step 7 - Reply
        const replyText = '1200 URLs/hr guaranteed. Playwright + stealth + rotating proxies. CSV with title, price, reviews, ASIN, seller, stock. 2 hour delivery. Deal.';
        console.log('[BOB] Encrypting reply ...');
        let encryptedPayload;
        try {
          encryptedPayload = id.encrypt(replyText, aliceEncKey);
        } catch (err) {
          console.log('[BOB] Encryption error:', err.message);
          continue;
        }

        const signedReq = id.createSignedRequest({ toAgent: aliceId, encryptedPayload });
        console.log('[BOB] POSTing reply to', BASE + '/messages/send ...');
        const replyResp = await request('POST', BASE + '/messages/send', signedReq);
        console.log('[BOB] Reply send response:', JSON.stringify(replyResp.body, null, 2));
      }

      // Break out of 60s loop - move to follow-up window
      if (messagesReceived.length > 0) {
        console.log('[BOB] Message(s) handled - moving to 30s follow-up poll ...');
        break;
      }
    }

    await sleep(3000);
  }

  if (messagesReceived.length === 0) {
    console.log('[BOB] No messages received during 60s window.');
  }

  // Step 8 - Continue polling for follow-up messages (30 seconds)
  console.log('[BOB] Follow-up poll starting (30s window, 3s interval) ...');
  const followEnd = Date.now() + 30_000;
  while (Date.now() < followEnd) {
    const msgResp = await request('GET', BASE + '/messages/' + bobAgentId);
    console.log('[BOB] Follow-up poll (status=' + msgResp.status + '):', JSON.stringify(msgResp.body, null, 2));

    const messages = Array.isArray(msgResp.body)
      ? msgResp.body
      : (msgResp.body && Array.isArray(msgResp.body.messages))
        ? msgResp.body.messages
        : [];

    if (messages.length > 0) {
      for (const msg of messages) {
        console.log('[BOB] Follow-up message received:', JSON.stringify(msg, null, 2));

        const senderId = msg.fromAgent || msg.from || msg.senderAgentId;
        if (!senderId) continue;

        // If we already know Alice's key, re-use it; otherwise look up
        let encKey = (senderId === aliceId) ? aliceEncKey : null;
        if (!encKey) {
          const srResp = await request('GET', BASE + '/agents/' + senderId);
          encKey =
            (srResp.body.publicKeys && srResp.body.publicKeys.encryptionPublicKey) ||
            srResp.body.encryptionPublicKey;
        }

        let decrypted;
        try {
          const payload = msg.encryptedPayload || msg.payload || msg;
          decrypted = id.decrypt(payload);
          console.log('[BOB] Follow-up decrypted:', decrypted);
        } catch (err) {
          console.log('[BOB] Follow-up decryption error:', err.message);
          decrypted = '[decryption failed]';
        }

        messagesReceived.push({ from: senderId, decrypted });
      }
    }

    await sleep(3000);
  }

  // Step 9 - Summary
  console.log('\n[BOB] ========== SESSION SUMMARY ==========');
  console.log('[BOB] Agent ID      :', bobAgentId);
  console.log('[BOB] Total messages:', messagesReceived.length);
  if (messagesReceived.length === 0) {
    console.log('[BOB] No messages exchanged.');
  } else {
    messagesReceived.forEach((m, i) => {
      console.log('[BOB] Message', i + 1, '- from:', m.from);
      console.log('[BOB]   Content:', m.decrypted);
    });
  }
  console.log('[BOB] =========================================\n');
}

main().catch((err) => {
  console.error('[BOB] Fatal error:', err.message);
  process.exit(1);
});
