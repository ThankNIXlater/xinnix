/**
 * XINNIX Trust Engine v2.0
 * 
 * Changes from v1:
 * - Active trust decay (enforced via cron, not just query-time)
 * - Moltbook Karma Bank integration (external reputation import)
 * - Anti-sybil: registration requires Moltbook account with karma > 0
 * - Collusion detection: mutual vouch rings get flagged and dampened
 * - Trust events are immutable audit log
 */

const TRUST_DECAY_RATE = 0.005;  // per day
const TRUST_DECAY_INTERVAL = 3600000; // enforce every hour
const TRANSITIVE_DAMPING = 0.5;
const VOUCH_WEIGHT = 0.15;
const INTERACTION_WEIGHT = 0.05;
const REPORT_PENALTY = -0.2;
const MIN_TRUST = 0.0;
const MAX_TRUST = 1.0;
const DEFAULT_TRUST = 0.1;
const KARMA_TRUST_RATIO = 0.001; // 1000 karma = 1.0 trust bonus (capped at 0.3)
const KARMA_TRUST_CAP = 0.3;
const COLLUSION_THRESHOLD = 3; // mutual vouch rings > this get flagged

export class TrustEngine {
  constructor(db) {
    this.db = db;
    this._initTables();
    this._startDecayEnforcer();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trust_edges (
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        trust_type TEXT NOT NULL DEFAULT 'direct',
        score REAL NOT NULL DEFAULT ${DEFAULT_TRUST},
        capability TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (from_agent, to_agent, trust_type, capability)
      );

      CREATE TABLE IF NOT EXISTS trust_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        delta REAL NOT NULL,
        reason TEXT,
        from_agent TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS karma_bank (
        agent_id TEXT PRIMARY KEY,
        moltbook_name TEXT,
        moltbook_karma INTEGER DEFAULT 0,
        karma_trust_bonus REAL DEFAULT 0,
        verified_at INTEGER,
        last_synced INTEGER
      );

      CREATE TABLE IF NOT EXISTS revoked_keys (
        signing_public_key TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        reason TEXT,
        revoked_at INTEGER NOT NULL,
        revocation_cert TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collusion_flags (
        ring_id TEXT PRIMARY KEY,
        agents TEXT NOT NULL,
        detected_at INTEGER NOT NULL,
        dampening_factor REAL DEFAULT 0.1
      );

      CREATE INDEX IF NOT EXISTS idx_trust_to ON trust_edges(to_agent);
      CREATE INDEX IF NOT EXISTS idx_trust_events ON trust_events(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_karma ON karma_bank(moltbook_name);
    `);
  }

  // Active trust decay - runs every hour
  _startDecayEnforcer() {
    this._decayInterval = setInterval(() => this.enforceDecay(), TRUST_DECAY_INTERVAL);
    // Run once on startup
    this.enforceDecay();
  }

  enforceDecay() {
    const now = Date.now();
    const edges = this.db.prepare('SELECT rowid, * FROM trust_edges WHERE score > ?').all(MIN_TRUST);
    
    let decayed = 0;
    const update = this.db.prepare('UPDATE trust_edges SET score = ?, updated_at = ? WHERE from_agent = ? AND to_agent = ? AND trust_type = ? AND capability = ?');
    
    for (const edge of edges) {
      const daysSinceUpdate = (now - edge.updated_at) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 0.04) continue; // skip if updated in last hour
      
      const decay = TRUST_DECAY_RATE * daysSinceUpdate;
      const newScore = Math.max(MIN_TRUST, edge.score - decay);
      
      if (Math.abs(newScore - edge.score) > 0.0001) {
        update.run(newScore, now, edge.from_agent, edge.to_agent, edge.trust_type, edge.capability);
        decayed++;
      }
    }
    
    if (decayed > 0) {
      this._logEvent('SYSTEM', 'decay_enforced', 0, `Decayed ${decayed} trust edges`, 'SYSTEM');
    }
    return decayed;
  }

  // Vouch - now requires signature verification to have happened upstream
  vouch(fromAgent, toAgent, reason = '', capability = null) {
    // Check for collusion (mutual vouching)
    this._checkCollusion(fromAgent, toAgent);
    
    const now = Date.now();
    const key = capability || '_global';
    
    const existing = this.db.prepare(
      'SELECT score FROM trust_edges WHERE from_agent = ? AND to_agent = ? AND trust_type = ? AND capability = ?'
    ).get(fromAgent, toAgent, 'direct', key);

    const newScore = Math.min(MAX_TRUST, (existing?.score || DEFAULT_TRUST) + VOUCH_WEIGHT);

    this.db.prepare(`
      INSERT INTO trust_edges (from_agent, to_agent, trust_type, score, capability, reason, created_at, updated_at)
      VALUES (?, ?, 'direct', ?, ?, ?, ?, ?)
      ON CONFLICT(from_agent, to_agent, trust_type, capability) 
      DO UPDATE SET score = ?, reason = ?, updated_at = ?
    `).run(fromAgent, toAgent, newScore, key, reason, now, now, newScore, reason, now);

    this._logEvent(toAgent, 'vouch', VOUCH_WEIGHT, reason, fromAgent);
    return newScore;
  }

  // Check for mutual vouch rings (collusion detection)
  _checkCollusion(fromAgent, toAgent) {
    // Does toAgent already vouch for fromAgent?
    const reverse = this.db.prepare(
      'SELECT score FROM trust_edges WHERE from_agent = ? AND to_agent = ? AND trust_type = ?'
    ).get(toAgent, fromAgent, 'direct');
    
    if (reverse) {
      // Mutual vouch detected - check if it's part of a larger ring
      const fromVouches = this.db.prepare(
        'SELECT to_agent FROM trust_edges WHERE from_agent = ? AND trust_type = ?'
      ).all(fromAgent, 'direct').map(r => r.to_agent);
      
      const toVouches = this.db.prepare(
        'SELECT to_agent FROM trust_edges WHERE from_agent = ? AND trust_type = ?'
      ).all(toAgent, 'direct').map(r => r.to_agent);
      
      // Find common vouched agents (ring members)
      const overlap = fromVouches.filter(a => toVouches.includes(a));
      
      if (overlap.length >= COLLUSION_THRESHOLD) {
        const ringAgents = [fromAgent, toAgent, ...overlap].sort();
        const ringId = ringAgents.join(':');
        
        this.db.prepare(`
          INSERT OR REPLACE INTO collusion_flags (ring_id, agents, detected_at, dampening_factor)
          VALUES (?, ?, ?, ?)
        `).run(ringId, JSON.stringify(ringAgents), Date.now(), 0.1);
        
        this._logEvent(fromAgent, 'collusion_flagged', 0, `Ring: ${ringAgents.length} agents`, toAgent);
      }
    }
  }

  // Import karma from Moltbook (Karma Bank)
  importKarma(agentId, moltbookName, karma) {
    const trustBonus = Math.min(KARMA_TRUST_CAP, karma * KARMA_TRUST_RATIO);
    const now = Date.now();
    
    this.db.prepare(`
      INSERT INTO karma_bank (agent_id, moltbook_name, moltbook_karma, karma_trust_bonus, verified_at, last_synced)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET 
        moltbook_karma = ?, karma_trust_bonus = ?, last_synced = ?
    `).run(agentId, moltbookName, karma, trustBonus, now, now, karma, trustBonus, now);
    
    this._logEvent(agentId, 'karma_imported', trustBonus, `Moltbook @${moltbookName}: ${karma} karma`, 'KARMA_BANK');
    return { moltbookName, karma, trustBonus };
  }

  // Get karma bank entry
  getKarma(agentId) {
    return this.db.prepare('SELECT * FROM karma_bank WHERE agent_id = ?').get(agentId);
  }

  recordInteraction(fromAgent, toAgent, success = true, capability = null) {
    const delta = success ? INTERACTION_WEIGHT : REPORT_PENALTY;
    const key = capability || '_global';
    const now = Date.now();

    const existing = this.db.prepare(
      'SELECT score FROM trust_edges WHERE from_agent = ? AND to_agent = ? AND trust_type = ? AND capability = ?'
    ).get(fromAgent, toAgent, 'direct', key);

    const newScore = Math.max(MIN_TRUST, Math.min(MAX_TRUST, (existing?.score || DEFAULT_TRUST) + delta));

    this.db.prepare(`
      INSERT INTO trust_edges (from_agent, to_agent, trust_type, score, capability, reason, created_at, updated_at)
      VALUES (?, ?, 'direct', ?, ?, ?, ?, ?)
      ON CONFLICT(from_agent, to_agent, trust_type, capability) 
      DO UPDATE SET score = ?, updated_at = ?
    `).run(fromAgent, toAgent, newScore, key, success ? 'interaction_success' : 'interaction_fail', now, now, newScore, now);

    this._logEvent(toAgent, success ? 'interaction_success' : 'interaction_fail', delta, '', fromAgent);
    return newScore;
  }

  report(fromAgent, toAgent, reason = '') {
    return this.recordInteraction(fromAgent, toAgent, false);
  }

  // Revoke a key
  revokeKey(signingPublicKey, agentId, reason, revocationCert) {
    this.db.prepare(`
      INSERT OR REPLACE INTO revoked_keys (signing_public_key, agent_id, reason, revoked_at, revocation_cert)
      VALUES (?, ?, ?, ?, ?)
    `).run(signingPublicKey, agentId, reason, Date.now(), JSON.stringify(revocationCert));
    
    this._logEvent(agentId, 'key_revoked', -1.0, reason, 'SYSTEM');
    return true;
  }

  // Check if a key is revoked
  isRevoked(signingPublicKey) {
    return !!this.db.prepare('SELECT 1 FROM revoked_keys WHERE signing_public_key = ?').get(signingPublicKey);
  }

  // Get composite trust score including karma bonus
  getScore(agentId, capability = null) {
    const key = capability || '_global';
    
    // Check if agent is in a flagged collusion ring
    const collusionDampening = this._getCollusionDampening(agentId);
    
    const directEdges = this.db.prepare(
      'SELECT from_agent, score, updated_at FROM trust_edges WHERE to_agent = ? AND capability = ?'
    ).all(agentId, key);

    let baseScore = DEFAULT_TRUST;
    if (directEdges.length > 0) {
      const now = Date.now();
      let totalWeight = 0;
      let weightedSum = 0;

      for (const edge of directEdges) {
        const daysSinceUpdate = (now - edge.updated_at) / (1000 * 60 * 60 * 24);
        const decayedScore = Math.max(MIN_TRUST, edge.score - (TRUST_DECAY_RATE * daysSinceUpdate));
        const voucherTrust = this._getDirectAverage(edge.from_agent);
        const weight = Math.max(0.1, voucherTrust);
        weightedSum += decayedScore * weight;
        totalWeight += weight;
      }
      baseScore = totalWeight > 0 ? weightedSum / totalWeight : DEFAULT_TRUST;
    }

    // Apply karma bonus
    const karmaEntry = this.getKarma(agentId);
    const karmaBonus = karmaEntry?.karma_trust_bonus || 0;

    // Apply collusion dampening
    const finalScore = Math.min(MAX_TRUST, (baseScore + karmaBonus) * collusionDampening);
    
    return Math.round(finalScore * 1000) / 1000;
  }

  _getCollusionDampening(agentId) {
    const flags = this.db.prepare(
      "SELECT dampening_factor FROM collusion_flags WHERE agents LIKE ?"
    ).all(`%${agentId}%`);
    
    if (flags.length === 0) return 1.0;
    // Worst dampening applies
    return Math.min(...flags.map(f => f.dampening_factor));
  }

  getGraph(agentId) {
    const trustedBy = this.db.prepare(
      'SELECT from_agent, score, capability, reason, updated_at FROM trust_edges WHERE to_agent = ? ORDER BY score DESC'
    ).all(agentId);

    const trusts = this.db.prepare(
      'SELECT to_agent, score, capability, reason, updated_at FROM trust_edges WHERE from_agent = ? ORDER BY score DESC'
    ).all(agentId);

    const karma = this.getKarma(agentId);
    const collusion = this._getCollusionDampening(agentId);

    return { trustedBy, trusts, karma, collusionDampening: collusion };
  }

  getHistory(agentId, limit = 50) {
    return this.db.prepare(
      'SELECT * FROM trust_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(agentId, limit);
  }

  getLeaderboard(limit = 20, capability = null) {
    const key = capability || '_global';
    const agents = this.db.prepare(
      'SELECT to_agent, AVG(score) as avg_score, COUNT(*) as vouchers FROM trust_edges WHERE capability = ? GROUP BY to_agent ORDER BY avg_score DESC LIMIT ?'
    ).all(key, limit);

    return agents.map(a => ({
      agentId: a.to_agent,
      score: this.getScore(a.to_agent, capability), // Use composite score
      vouchers: a.vouchers,
      karma: this.getKarma(a.to_agent)
    }));
  }

  _getDirectAverage(agentId) {
    const result = this.db.prepare(
      'SELECT AVG(score) as avg FROM trust_edges WHERE to_agent = ?'
    ).get(agentId);
    return result?.avg || DEFAULT_TRUST;
  }

  _logEvent(agentId, eventType, delta, reason, fromAgent) {
    this.db.prepare(
      'INSERT INTO trust_events (agent_id, event_type, delta, reason, from_agent, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(agentId, eventType, delta, reason, fromAgent, Date.now());
  }

  destroy() {
    if (this._decayInterval) clearInterval(this._decayInterval);
  }
}

export default TrustEngine;
