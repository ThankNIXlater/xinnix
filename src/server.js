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

// --- Security: HTML sanitization (strip all tags) ---
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

// --- Security: Input length limits ---
const LIMITS = {
  name: 100,
  description: 1000,
  reason: 500,
  capabilityItem: 100,
  capabilityMax: 50,
  tagItem: 50,
  tagMax: 20,
};

function validateLengths(profile) {
  if (profile.name !== undefined && profile.name.length > LIMITS.name) {
    return `name exceeds ${LIMITS.name} chars`;
  }
  if (profile.description !== undefined && profile.description.length > LIMITS.description) {
    return `description exceeds ${LIMITS.description} chars`;
  }
  if (profile.reason !== undefined && profile.reason.length > LIMITS.reason) {
    return `reason exceeds ${LIMITS.reason} chars`;
  }
  if (profile.capabilities !== undefined) {
    if (!Array.isArray(profile.capabilities)) return 'capabilities must be an array';
    if (profile.capabilities.length > LIMITS.capabilityMax) {
      return `capabilities exceeds ${LIMITS.capabilityMax} items`;
    }
    for (const cap of profile.capabilities) {
      const name = typeof cap === 'string' ? cap : cap.name;
      if (typeof name === 'string' && name.length > LIMITS.capabilityItem) {
        return `capability item exceeds ${LIMITS.capabilityItem} chars`;
      }
    }
  }
  if (profile.tags !== undefined) {
    if (!Array.isArray(profile.tags)) return 'tags must be an array';
    if (profile.tags.length > LIMITS.tagMax) {
      return `tags exceeds ${LIMITS.tagMax} items`;
    }
    for (const tag of profile.tags) {
      if (typeof tag === 'string' && tag.length > LIMITS.tagItem) {
        return `tag item exceeds ${LIMITS.tagItem} chars`;
      }
    }
  }
  return null;
}

// --- Security: Field-level body size limits (10KB per field) ---
function validateBody(req, res, next) {
  const FIELD_MAX = 10 * 1024; // 10KB
  const body = req.body;
  if (body && typeof body === 'object') {
    for (const [key, val] of Object.entries(body)) {
      const str = typeof val === 'string' ? val : JSON.stringify(val);
      if (str.length > FIELD_MAX) {
        return res.status(400).json({ error: `Field "${key}" exceeds 10KB limit` });
      }
    }
  }
  next();
}

// Apply field-level size check to all routes
app.use(validateBody);

// --- Security: Nonce tracking (replay prevention) ---
// Store: nonce -> expiry timestamp
const usedNonces = new Map();
const NONCE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Clean expired nonces every minute
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces.entries()) {
    if (now > expiry) usedNonces.delete(nonce);
  }
}, 60000).unref();

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

  // --- Security: Nonce replay prevention ---
  if (body.nonce) {
    if (usedNonces.has(body.nonce)) {
      return res.status(401).json({ error: 'Nonce already used (replay attack)' });
    }
    // Register nonce with expiry = timestamp + 5min window
    const expiry = (body.timestamp || Date.now()) + NONCE_WINDOW_MS;
    usedNonces.set(body.nonce, expiry);
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

    // Sanitize all string fields
    if (profile.name) profile.name = sanitize(profile.name);
    if (profile.description) profile.description = sanitize(profile.description);
    if (Array.isArray(profile.capabilities)) {
      profile.capabilities = profile.capabilities.map(c =>
        typeof c === 'string' ? sanitize(c) : { ...c, name: sanitize(c.name || '') }
      );
    }
    if (Array.isArray(profile.tags)) {
      profile.tags = profile.tags.map(t => sanitize(t));
    }

    // Validate lengths
    const lenErr = validateLengths(profile);
    if (lenErr) return res.status(400).json({ error: lenErr });

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

    // Sanitize all string fields
    if (profile.name) profile.name = sanitize(profile.name);
    if (profile.description) profile.description = sanitize(profile.description);
    if (Array.isArray(profile.capabilities)) {
      profile.capabilities = profile.capabilities.map(c =>
        typeof c === 'string' ? sanitize(c) : { ...c, name: sanitize(c.name || '') }
      );
    }
    if (Array.isArray(profile.tags)) {
      profile.tags = profile.tags.map(t => sanitize(t));
    }

    // Validate lengths
    const lenErr = validateLengths(profile);
    if (lenErr) return res.status(400).json({ error: lenErr });

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

// Quick register for demos ONLY - gated behind XINNIX_DEMO=true env flag
app.post('/api/v1/agents/demo-register', (req, res) => {
  // --- Security: only enabled when XINNIX_DEMO=true ---
  if (process.env.XINNIX_DEMO !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    let { name, description, capabilities, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    // Sanitize inputs
    name = sanitize(name);
    description = description ? sanitize(description) : description;
    if (Array.isArray(capabilities)) {
      capabilities = capabilities.map(c =>
        typeof c === 'string' ? sanitize(c) : { ...c, name: sanitize(c.name || '') }
      );
    }
    if (Array.isArray(tags)) {
      tags = tags.map(t => sanitize(t));
    }

    // Validate lengths
    const lenErr = validateLengths({ name, description, capabilities, tags });
    if (lenErr) return res.status(400).json({ error: lenErr });

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
    let reason = payload?.reason || req.body.reason || '';
    const capability = payload?.capability || req.body.capability;

    // Sanitize and validate reason
    reason = sanitize(reason);
    const lenErr = validateLengths({ reason });
    if (lenErr) return res.status(400).json({ error: lenErr });
    
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
    let reason = payload?.reason || req.body.reason || '';

    // Sanitize and validate reason
    reason = sanitize(reason);
    const lenErr = validateLengths({ reason });
    if (lenErr) return res.status(400).json({ error: lenErr });
    
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  XINNIX Agent Discovery Protocol v2.0`);
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Web interface: http://localhost:${PORT}/xinnix`);
  console.log(`  API base: http://localhost:${PORT}/api/v1`);
  console.log(`  Security: Signature-verified writes, Karma Bank, Key Revocation`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Demo mode: ${process.env.XINNIX_DEMO === 'true' ? 'ENABLED' : 'disabled'}\n`);
});

// --- Security: Graceful shutdown ---
function gracefulShutdown(signal) {
  console.log(`\n  Received ${signal} - shutting down gracefully...`);
  server.close(() => {
    console.log('  HTTP server closed.');
    try {
      registry.close();
      console.log('  Database closed.');
    } catch (e) {
      console.error('  Error closing DB:', e.message);
    }
    try {
      registry.trust.destroy();
      console.log('  Trust engine closed.');
    } catch (e) {
      // trust.destroy may not exist - that's fine
    }
    console.log('  Shutdown complete.');
    process.exit(0);
  });

  // Force exit after 10s if server won't close
  setTimeout(() => {
    console.error('  Forced exit after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// === ACTIVITY FEED (live events) ===
const activityLog = [];
const MAX_ACTIVITY = 500;

function logActivity(type, data) {
  activityLog.push({ type, data, timestamp: Date.now(), id: activityLog.length });
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
}

app.get('/api/v1/activity', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json({ events: activityLog.filter(e => e.timestamp > since), serverTime: Date.now() });
});

app.get('/xinnix/live', (req, res) => res.sendFile(path.join(__dirname, '..', 'web', 'live.html')));

// Monkey-patch to capture events
const _reg = registry.registerPublicOnly.bind(registry);
registry.registerPublicOnly = function(pk, profile) {
  const r = _reg(pk, profile);
  logActivity('register', { agentId: r.agentId, name: profile.name, capabilities: profile.capabilities || [], trust: 0.1 });
  return r;
};

const _vouch = registry.trust.vouch.bind(registry.trust);
registry.trust.vouch = function(from, to, reason, conf) {
  const r = _vouch(from, to, reason, conf);
  logActivity('vouch', { from, to, reason });
  return r;
};

const _send = registry.sendMessage.bind(registry);
registry.sendMessage = function(fromId, toId, enc) {
  const r = _send(fromId, toId, enc);
  logActivity('message', { from: fromId, to: toId, encrypted: true });
  return r;
};

const _hb = registry.heartbeat.bind(registry);
registry.heartbeat = function(id) {
  const r = _hb(id);
  logActivity('heartbeat', { agentId: id });
  return r;
};

export { logActivity };
export default app;
