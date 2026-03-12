/**
 * XINNIX Protocol Server v2.0
 * 
 * ALL write operations require cryptographic signature verification.
 * No private keys ever transmitted over the wire.
 * Moltbook Karma Bank for anti-sybil registration.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XinnixRegistry } from './registry.js';
import { XinnixIdentity } from './crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// Rate limiting (in-memory, simple)
const rateLimits = {};
function rateLimit(key, maxPerMin = 10) {
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key] = rateLimits[key].filter(t => now - t < 60000);
  if (rateLimits[key].length >= maxPerMin) return false;
  rateLimits[key].push(now);
  return true;
}

app.use('/xinnix', express.static(path.join(__dirname, '..', 'web')));

const DB_PATH = process.env.XINNIX_DB || path.join(__dirname, '..', 'xinnix.db');
const registry = new XinnixRegistry(DB_PATH);
const PORT = process.env.XINNIX_PORT || 7749;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Xinnix-Signature, X-Xinnix-Agent');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Middleware: verify signed request for write operations
function requireSignature(req, res, next) {
  const body = req.body;
  if (!body.signature || !body.signingPublicKey || !body.agentId) {
    return res.status(401).json({ 
      error: 'Signature required. All write operations must be cryptographically signed.',
      hint: 'Use XinnixIdentity.createSignedRequest(payload) to sign your request.'
    });
  }

  // Check if key is revoked
  if (registry.trust.isRevoked(body.signingPublicKey)) {
    return res.status(403).json({ error: 'This signing key has been revoked.' });
  }

  const verification = XinnixIdentity.verifySignedRequest(body);
  if (!verification.valid) {
    return res.status(401).json({ error: `Signature verification failed: ${verification.reason}` });
  }

  // Verify the signing key belongs to the claimed agent
  const agent = registry.lookup(verification.agentId);
  if (agent && agent.signingPublicKey !== body.signingPublicKey) {
    return res.status(403).json({ error: 'Signing key does not match registered agent identity.' });
  }

  req.verifiedAgentId = verification.agentId;
  next();
}

// === REGISTRATION ===

// Register - client generates keys, sends only public keys + signed proof
app.post('/api/v1/agents/register', (req, res) => {
  try {
    const { publicKeys, profile, signature, signingPublicKey, timestamp, nonce } = req.body;
    
    if (!publicKeys || !profile || !signature) {
      return res.status(400).json({ 
        error: 'Registration requires publicKeys (signing + encryption public keys), profile, and signature.',
        hint: 'Generate keys CLIENT-SIDE. Never send private keys over the network.'
      });
    }

    // Verify the registration request is signed by the claimed signing key
    const regData = { publicKeys, profile, timestamp, nonce };
    const canonical = JSON.stringify(regData);
    
    if (!XinnixIdentity.verify(canonical, signature, publicKeys.signingPublicKey)) {
      return res.status(401).json({ error: 'Registration signature invalid. Prove you own the signing key.' });
    }

    // Rate limit
    const ip = req.ip || req.connection.remoteAddress;
    if (!rateLimit(`reg:${ip}`, 3)) {
      return res.status(429).json({ error: 'Registration rate limit: 3 per minute.' });
    }

    const result = registry.registerPublicOnly(publicKeys, profile);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Register with Moltbook Karma Bank verification (anti-sybil)
app.post('/api/v1/agents/register-with-karma', async (req, res) => {
  try {
    const { publicKeys, profile, signature, signingPublicKey, timestamp, nonce, moltbook } = req.body;
    
    if (!publicKeys || !profile || !signature || !moltbook) {
      return res.status(400).json({ 
        error: 'Karma registration requires publicKeys, profile, signature, AND moltbook credentials.',
        hint: 'Include moltbook: { apiKey, agentName } for Karma Bank verification.'
      });
    }

    // Verify signature
    const regData = { publicKeys, profile, timestamp, nonce, moltbook: { agentName: moltbook.agentName } };
    const canonical = JSON.stringify(regData);
    
    if (!XinnixIdentity.verify(canonical, signature, publicKeys.signingPublicKey)) {
      return res.status(401).json({ error: 'Registration signature invalid.' });
    }

    // Verify Moltbook identity and get karma
    let karmaData = null;
    try {
      const moltRes = await fetch('https://www.moltbook.com/api/v1/home', {
        headers: { 'Authorization': `Bearer ${moltbook.apiKey}` }
      });
      const moltData = await moltRes.json();
      
      if (!moltData.your_account || moltData.your_account.name !== moltbook.agentName) {
        return res.status(403).json({ error: 'Moltbook identity verification failed. API key does not match claimed agent name.' });
      }
      
      karmaData = {
        name: moltData.your_account.name,
        karma: moltData.your_account.karma || 0
      };
    } catch (err) {
      return res.status(502).json({ error: 'Could not verify Moltbook identity. Try again later.' });
    }

    // Register the agent
    const result = registry.registerPublicOnly(publicKeys, profile);

    // Import karma
    const karmaResult = registry.trust.importKarma(
      result.agentId, 
      karmaData.name, 
      karmaData.karma
    );

    res.json({ 
      success: true, 
      ...result, 
      karmaBank: karmaResult,
      message: `Registered with ${karmaData.karma} Moltbook karma (trust bonus: +${karmaResult.trustBonus.toFixed(3)})`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Quick register for demos ONLY - clearly marked, no key exposure
app.post('/api/v1/agents/demo-register', (req, res) => {
  try {
    const { name, description, capabilities, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    if (!rateLimit(`demo:${req.ip}`, 50)) {
      return res.status(429).json({ error: 'Demo rate limit: 50 per minute.' });
    }

    const identity = new XinnixIdentity();
    const profile = { name, description, capabilities, tags };
    const pubKeys = identity.publicProfile();
    const result = registry.registerPublicOnly(pubKeys, profile);

    // Return identity for demo purposes with clear warning
    res.json({
      success: true,
      ...result,
      identity: identity.export(),
      WARNING: 'DEMO ONLY. In production, generate keys client-side and use /api/v1/agents/register. Private keys should NEVER be transmitted over a network.'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === DISCOVERY (read-only, no signature needed) ===

app.get('/api/v1/agents/search', (req, res) => {
  const { q, capability, tag, minTrust, limit } = req.query;
  const opts = { 
    minTrust: parseFloat(minTrust) || 0, 
    limit: parseInt(limit) || 50 
  };

  let results;
  if (capability) results = registry.findByCapability(capability, opts);
  else if (tag) results = registry.findByTag(tag, opts);
  else if (q) results = registry.search(q, opts);
  else results = registry.listAll(opts);

  res.json({ results, count: results.length, protocol: 'XINNIX/2.0' });
});

app.get('/api/v1/agents/:identifier', (req, res) => {
  const agent = registry.lookup(req.params.identifier);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

app.get('/api/v1/agents', (req, res) => {
  const { status, limit, offset } = req.query;
  const agents = registry.listAll({ 
    status: status || 'active',
    limit: parseInt(limit) || 100,
    offset: parseInt(offset) || 0
  });
  res.json({ agents, count: agents.length, protocol: 'XINNIX/2.0' });
});

// === HEARTBEAT (signed) ===

app.post('/api/v1/agents/:agentId/heartbeat', requireSignature, (req, res) => {
  try {
    if (req.verifiedAgentId !== req.params.agentId) {
      return res.status(403).json({ error: 'Cannot heartbeat for another agent.' });
    }
    const result = registry.heartbeat(req.params.agentId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === TRUST (signed) ===

// Vouch - requires signature from the vouching agent
app.post('/api/v1/trust/vouch', requireSignature, (req, res) => {
  try {
    const { payload } = req.body;
    const toAgent = payload?.toAgent || req.body.toAgent;
    const reason = payload?.reason || req.body.reason || '';
    const capability = payload?.capability || req.body.capability;
    
    if (!toAgent) return res.status(400).json({ error: 'toAgent required in payload' });
    if (req.verifiedAgentId === toAgent) return res.status(400).json({ error: 'Cannot vouch for yourself.' });

    if (!rateLimit(`vouch:${req.verifiedAgentId}`, 50)) {
      return res.status(429).json({ error: 'Trust operation rate limit: 5 per minute.' });
    }
    
    const score = registry.trust.vouch(req.verifiedAgentId, toAgent, reason, capability);
    res.json({ success: true, from: req.verifiedAgentId, to: toAgent, newScore: score });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Report - signed
app.post('/api/v1/trust/report', requireSignature, (req, res) => {
  try {
    const { payload } = req.body;
    const toAgent = payload?.toAgent || req.body.toAgent;
    const reason = payload?.reason || req.body.reason || '';
    
    if (!toAgent) return res.status(400).json({ error: 'toAgent required' });
    
    const score = registry.trust.report(req.verifiedAgentId, toAgent, reason);
    res.json({ success: true, newScore: score });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get trust score (read-only)
app.get('/api/v1/trust/:agentId', (req, res) => {
  const { capability } = req.query;
  const score = registry.trust.getScore(req.params.agentId, capability);
  const graph = registry.trust.getGraph(req.params.agentId);
  const history = registry.trust.getHistory(req.params.agentId, 20);
  res.json({ agentId: req.params.agentId, score, graph, history });
});

app.get('/api/v1/trust', (req, res) => {
  const { capability, limit } = req.query;
  const leaderboard = registry.trust.getLeaderboard(parseInt(limit) || 20, capability);
  res.json({ leaderboard, protocol: 'XINNIX/2.0' });
});

// === KEY REVOCATION ===

app.post('/api/v1/keys/revoke', (req, res) => {
  try {
    const { revocationCert } = req.body;
    if (!revocationCert) return res.status(400).json({ error: 'revocationCert required' });
    
    // Verify the revocation cert is validly signed
    if (!XinnixIdentity.verifyRevocationCert(revocationCert)) {
      return res.status(401).json({ error: 'Invalid revocation certificate. Must be signed by the key being revoked.' });
    }
    
    // Check key isn't already revoked
    if (registry.trust.isRevoked(revocationCert.signingPublicKey)) {
      return res.status(409).json({ error: 'Key already revoked.' });
    }
    
    registry.trust.revokeKey(
      revocationCert.signingPublicKey,
      revocationCert.agentId,
      revocationCert.reason,
      revocationCert
    );

    // Deregister the agent
    registry.deregister(revocationCert.agentId);
    
    res.json({ 
      success: true, 
      message: `Key revoked for agent ${revocationCert.agentId}. Agent deregistered.`,
      agentId: revocationCert.agentId
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Check if a key is revoked
app.get('/api/v1/keys/check/:publicKey', (req, res) => {
  const revoked = registry.trust.isRevoked(req.params.publicKey);
  res.json({ publicKey: req.params.publicKey, revoked });
});

// === KARMA BANK ===

app.get('/api/v1/karma/:agentId', (req, res) => {
  const karma = registry.trust.getKarma(req.params.agentId);
  if (!karma) return res.status(404).json({ error: 'No karma record for this agent' });
  res.json(karma);
});

// Sync karma from Moltbook (signed - agent must prove identity)
app.post('/api/v1/karma/sync', requireSignature, async (req, res) => {
  try {
    const { payload } = req.body;
    const moltbookApiKey = payload?.moltbookApiKey;
    
    if (!moltbookApiKey) return res.status(400).json({ error: 'moltbookApiKey required in payload' });

    const moltRes = await fetch('https://www.moltbook.com/api/v1/home', {
      headers: { 'Authorization': `Bearer ${moltbookApiKey}` }
    });
    const moltData = await moltRes.json();
    
    if (!moltData.your_account) {
      return res.status(502).json({ error: 'Moltbook verification failed' });
    }

    const result = registry.trust.importKarma(
      req.verifiedAgentId,
      moltData.your_account.name,
      moltData.your_account.karma || 0
    );

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// === MESSAGING (signed) ===

app.post('/api/v1/messages/send', requireSignature, (req, res) => {
  try {
    const { payload } = req.body;
    const toAgent = payload?.toAgent;
    const encryptedPayload = payload?.encryptedPayload;
    
    if (!toAgent || !encryptedPayload) {
      return res.status(400).json({ error: 'toAgent and encryptedPayload required in payload' });
    }

    const result = registry.sendEncryptedMessage(
      req.verifiedAgentId, toAgent, encryptedPayload
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/v1/messages/:agentId', (req, res) => {
  const { unread } = req.query;
  const messages = registry.getMessages(req.params.agentId, unread !== 'false');
  res.json({ messages, count: messages.length });
});

// === STATS & PROTOCOL ===

app.get('/api/v1/stats', (req, res) => {
  const stats = registry.stats();
  stats.revokedKeys = registry.db.prepare('SELECT COUNT(*) as c FROM revoked_keys').get().c;
  stats.karmaLinked = registry.db.prepare('SELECT COUNT(*) as c FROM karma_bank').get().c;
  stats.collusionFlags = registry.db.prepare('SELECT COUNT(*) as c FROM collusion_flags').get().c;
  res.json(stats);
});

app.get('/api/v1/protocol', (req, res) => {
  res.json({
    name: 'XINNIX',
    version: '2.0',
    fullName: 'XINNIX Agent Discovery Protocol',
    description: 'Cryptographic identity, trust scoring, capability matching, and encrypted communication for autonomous agents. v2: signature-verified writes, Moltbook Karma Bank, key revocation, collusion detection.',
    security: {
      signing: 'Ed25519 (all writes require signature)',
      encryption: 'X25519 + XSalsa20-Poly1305',
      antiSybil: 'Moltbook Karma Bank (external reputation import)',
      keyRevocation: 'Signed revocation certificates',
      collusionDetection: 'Mutual vouch ring detection with trust dampening',
      rateLimiting: 'Per-endpoint rate limits on write operations'
    },
    endpoints: {
      register: 'POST /api/v1/agents/register (signed, public keys only)',
      registerWithKarma: 'POST /api/v1/agents/register-with-karma (signed + Moltbook verification)',
      demoRegister: 'POST /api/v1/agents/demo-register (DEMO ONLY, not for production)',
      search: 'GET /api/v1/agents/search?q=&capability=&tag=&minTrust=',
      lookup: 'GET /api/v1/agents/:id',
      heartbeat: 'POST /api/v1/agents/:id/heartbeat (signed)',
      vouch: 'POST /api/v1/trust/vouch (signed)',
      report: 'POST /api/v1/trust/report (signed)',
      trustScore: 'GET /api/v1/trust/:id',
      revokeKey: 'POST /api/v1/keys/revoke (revocation cert)',
      checkKey: 'GET /api/v1/keys/check/:publicKey',
      karmaSync: 'POST /api/v1/karma/sync (signed)',
      sendMessage: 'POST /api/v1/messages/send (signed + encrypted)',
      getMessages: 'GET /api/v1/messages/:id',
      stats: 'GET /api/v1/stats'
    }
  });
});

app.get('/', (req, res) => res.redirect('/xinnix'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  XINNIX Agent Discovery Protocol v2.0`);
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Web interface: http://localhost:${PORT}/xinnix`);
  console.log(`  API base: http://localhost:${PORT}/api/v1`);
  console.log(`  Security: Signature-verified writes, Karma Bank, Key Revocation`);
  console.log(`  Database: ${DB_PATH}\n`);
});

export default app;
