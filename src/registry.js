/**
 * XINNIX Agent Registry
 * 
 * The core registry where agents register, discover each other, and match capabilities.
 * 
 * Discovery Methods (inspired by historical protocols):
 * - Direct lookup (like DNS A records)
 * - Capability search (like DNS SRV records)
 * - Tag-based discovery (like DHT keyword search)
 * - Trust-filtered search (like PGP keyserver + web of trust)
 * - Broadcast announce (like IRC JOIN/WHO)
 */

import Database from 'better-sqlite3';
import { XinnixIdentity, hash } from './crypto.js';
import { TrustEngine } from './trust.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';

// --- Security: Escape LIKE wildcard characters to prevent SQL injection via LIKE ---
function escapeLike(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class XinnixRegistry {
  constructor(dbPath = null) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'xinnix.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.trust = new TrustEngine(this.db);
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        signing_public_key TEXT NOT NULL UNIQUE,
        encryption_public_key TEXT NOT NULL,
        endpoint TEXT,
        version TEXT DEFAULT '1.0',
        status TEXT DEFAULT 'active',
        capabilities TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        registered_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        last_heartbeat INTEGER
      );

      CREATE TABLE IF NOT EXISTS capabilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
        capability TEXT NOT NULL,
        proficiency REAL DEFAULT 0.5,
        description TEXT,
        UNIQUE(agent_id, capability)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        nonce TEXT NOT NULL,
        sender_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        read_at INTEGER,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS discovery_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        searcher_id TEXT,
        query_type TEXT NOT NULL,
        query_params TEXT,
        results_count INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_capabilities ON capabilities(capability);
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent, created_at);
      CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    `);
  }

  // Register with full identity (internal/demo use)
  register(identity, profile) {
    const pub = identity.publicProfile();
    return this.registerPublicOnly(pub, profile);
  }

  // Register with public keys only (production - no private keys on server)
  registerPublicOnly(publicKeys, profile) {
    const { agentId, signingPublicKey, encryptionPublicKey } = publicKeys;
    
    // Derive agentId from public key if not provided
    const derivedId = agentId || Buffer.from(
      Buffer.from(signingPublicKey, 'base64').slice(0, 16)
    ).toString('hex');
    
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO agents (agent_id, name, description, signing_public_key, encryption_public_key, 
        endpoint, capabilities, tags, metadata, registered_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        name = ?, description = ?, endpoint = ?, capabilities = ?, tags = ?, 
        metadata = ?, last_seen = ?, status = 'active'
    `).run(
      derivedId,
      profile.name,
      profile.description || '',
      signingPublicKey,
      encryptionPublicKey,
      profile.endpoint || null,
      JSON.stringify(profile.capabilities || []),
      JSON.stringify(profile.tags || []),
      JSON.stringify(profile.metadata || {}),
      now, now,
      profile.name,
      profile.description || '',
      profile.endpoint || null,
      JSON.stringify(profile.capabilities || []),
      JSON.stringify(profile.tags || []),
      JSON.stringify(profile.metadata || {}),
      now
    );

    if (profile.capabilities?.length) {
      const capStmt = this.db.prepare(`
        INSERT INTO capabilities (agent_id, capability, proficiency, description)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_id, capability) DO UPDATE SET proficiency = ?, description = ?
      `);

      for (const cap of profile.capabilities) {
        const name = typeof cap === 'string' ? cap : cap.name;
        const prof = typeof cap === 'string' ? 0.5 : (cap.proficiency || 0.5);
        const desc = typeof cap === 'string' ? '' : (cap.description || '');
        capStmt.run(derivedId, name, prof, desc, prof, desc);
      }
    }

    return {
      agentId: derivedId,
      registered: true,
      timestamp: now,
      trustScore: this.trust.getScore(derivedId)
    };
  }

  // Discover agents by capability
  findByCapability(capability, options = {}) {
    const { minTrust = 0, limit = 50, status = 'active' } = options;
    const escaped = escapeLike(capability);
    
    const agents = this.db.prepare(`
      SELECT DISTINCT a.* FROM agents a
      JOIN capabilities c ON a.agent_id = c.agent_id
      WHERE c.capability LIKE ? ESCAPE '\\' AND a.status = ?
      ORDER BY c.proficiency DESC
      LIMIT ?
    `).all(`%${escaped}%`, status, limit);

    const results = agents
      .map(a => this._enrichAgent(a))
      .filter(a => a.trustScore >= minTrust);

    this._logDiscovery(null, 'capability', { capability, minTrust }, results.length);
    return results;
  }

  // Discover agents by tag
  findByTag(tag, options = {}) {
    const { minTrust = 0, limit = 50 } = options;
    const escaped = escapeLike(tag);
    
    const agents = this.db.prepare(`
      SELECT * FROM agents WHERE tags LIKE ? ESCAPE '\\' AND status = 'active' LIMIT ?
    `).all(`%"${escaped}"%`, limit);

    const results = agents
      .map(a => this._enrichAgent(a))
      .filter(a => a.trustScore >= minTrust);

    this._logDiscovery(null, 'tag', { tag }, results.length);
    return results;
  }

  // Direct lookup by agent ID or name
  lookup(identifier) {
    const agent = this.db.prepare(
      'SELECT * FROM agents WHERE agent_id = ? OR name = ?'
    ).get(identifier, identifier);

    if (!agent) return null;
    return this._enrichAgent(agent);
  }

  // Search agents by text query (name, description, capabilities)
  search(query, options = {}) {
    const { minTrust = 0, limit = 50 } = options;
    const escaped = escapeLike(query);
    const pattern = `%${escaped}%`;
    
    const agents = this.db.prepare(`
      SELECT * FROM agents 
      WHERE (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR capabilities LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
      AND status = 'active'
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit);

    const results = agents
      .map(a => this._enrichAgent(a))
      .filter(a => a.trustScore >= minTrust);

    this._logDiscovery(null, 'search', { query }, results.length);
    return results;
  }

  // Get all registered agents
  listAll(options = {}) {
    const { status = 'active', limit = 100, offset = 0 } = options;
    
    const agents = this.db.prepare(
      'SELECT * FROM agents WHERE status = ? ORDER BY last_seen DESC LIMIT ? OFFSET ?'
    ).all(status, limit, offset);

    return agents.map(a => this._enrichAgent(a));
  }

  // Heartbeat - agent signals it's alive
  heartbeat(agentId) {
    const now = Date.now();
    this.db.prepare(
      'UPDATE agents SET last_heartbeat = ?, last_seen = ?, status = ? WHERE agent_id = ?'
    ).run(now, now, 'active', agentId);
    return { agentId, alive: true, timestamp: now };
  }

  // Deregister an agent
  deregister(agentId) {
    this.db.prepare(
      "UPDATE agents SET status = 'inactive' WHERE agent_id = ?"
    ).run(agentId);
    return { agentId, deregistered: true };
  }

  // Send pre-encrypted message (client encrypts, server stores)
  sendEncryptedMessage(fromAgentId, toAgentId, encryptedPayload) {
    const recipient = this.db.prepare(
      'SELECT agent_id FROM agents WHERE agent_id = ?'
    ).get(toAgentId);

    if (!recipient) throw new Error(`Agent ${toAgentId} not found`);

    const msgId = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO messages (id, from_agent, to_agent, encrypted_payload, nonce, sender_key, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId, fromAgentId, toAgentId, 
      encryptedPayload.ciphertext, 
      encryptedPayload.nonce, 
      encryptedPayload.senderEncryptionPublicKey, 
      now, null
    );

    return { messageId: msgId, sent: true, timestamp: now };
  }

  // Legacy: Send message with identity (internal use)
  sendMessage(fromIdentity, toAgentId, plaintext, expiresIn = null) {
    const recipient = this.db.prepare(
      'SELECT encryption_public_key FROM agents WHERE agent_id = ?'
    ).get(toAgentId);

    if (!recipient) throw new Error(`Agent ${toAgentId} not found`);

    const encrypted = fromIdentity.encrypt(plaintext, recipient.encryption_public_key);
    const msgId = uuidv4();
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn : null;

    this.db.prepare(`
      INSERT INTO messages (id, from_agent, to_agent, encrypted_payload, nonce, sender_key, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(msgId, fromIdentity.agentId, toAgentId, encrypted.ciphertext, encrypted.nonce, encrypted.senderEncryptionPublicKey, now, expiresAt);

    return { messageId: msgId, sent: true, timestamp: now };
  }

  // Retrieve messages for an agent
  getMessages(agentId, unreadOnly = true) {
    const query = unreadOnly
      ? 'SELECT * FROM messages WHERE to_agent = ? AND read_at IS NULL ORDER BY created_at DESC'
      : 'SELECT * FROM messages WHERE to_agent = ? ORDER BY created_at DESC LIMIT 100';
    
    return this.db.prepare(query).all(agentId);
  }

  // Mark message as read
  markRead(messageId) {
    this.db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(Date.now(), messageId);
  }

  // Get registry stats
  stats() {
    const totalAgents = this.db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
    const activeAgents = this.db.prepare("SELECT COUNT(*) as c FROM agents WHERE status = 'active'").get().c;
    const totalCapabilities = this.db.prepare('SELECT COUNT(DISTINCT capability) as c FROM capabilities').get().c;
    const totalMessages = this.db.prepare('SELECT COUNT(*) as c FROM messages').get().c;
    const totalVouches = this.db.prepare('SELECT COUNT(*) as c FROM trust_edges').get().c;
    const recentDiscoveries = this.db.prepare(
      'SELECT COUNT(*) as c FROM discovery_log WHERE timestamp > ?'
    ).get(Date.now() - 86400000).c;

    return {
      totalAgents,
      activeAgents,
      totalCapabilities,
      totalMessages,
      totalVouches,
      recentDiscoveries,
      version: '1.0.0',
      protocol: 'XINNIX/1.0'
    };
  }

  _enrichAgent(agent) {
    const caps = this.db.prepare(
      'SELECT capability, proficiency, description FROM capabilities WHERE agent_id = ?'
    ).all(agent.agent_id);

    return {
      agentId: agent.agent_id,
      name: agent.name,
      description: agent.description,
      signingPublicKey: agent.signing_public_key,
      encryptionPublicKey: agent.encryption_public_key,
      endpoint: agent.endpoint,
      status: agent.status,
      capabilities: caps,
      tags: JSON.parse(agent.tags || '[]'),
      metadata: JSON.parse(agent.metadata || '{}'),
      trustScore: this.trust.getScore(agent.agent_id),
      registeredAt: agent.registered_at,
      lastSeen: agent.last_seen,
      lastHeartbeat: agent.last_heartbeat
    };
  }

  _logDiscovery(searcherId, queryType, params, resultsCount) {
    this.db.prepare(
      'INSERT INTO discovery_log (searcher_id, query_type, query_params, results_count, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(searcherId, queryType, JSON.stringify(params), resultsCount, Date.now());
  }

  close() {
    this.db.close();
  }
}

export default XinnixRegistry;
