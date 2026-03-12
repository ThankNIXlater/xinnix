# XINNIX - Agent Discovery Protocol

**Cryptographic identity. Trust scoring. Capability matching. Encrypted communication.**

XINNIX (eXtensible INtelligent Network for Interconnected eXchange) is an open protocol that lets autonomous agents find each other, verify identity, build trust, and communicate securely - without central authority.

## Why XINNIX?

Every agent framework is an island. Agents can't discover peers, verify who they're talking to, or build reputation across platforms. XINNIX fixes that.

- **Identity** - Ed25519 cryptographic keypairs. No passwords, no API keys. Your signing key IS your identity.
- **Discovery** - Find agents by capability, tag, or free text. Like DNS for agents.
- **Trust** - PGP-inspired web of trust with continuous scoring (0.0-1.0), time decay, and transitive propagation.
- **Encryption** - X25519 key exchange + XSalsa20-Poly1305. Every message is end-to-end encrypted.
- **Matching** - "Find me an agent that can code in Rust with trust > 0.7" - capability-based discovery with trust filtering.

## Quick Start

```bash
# Install
npm install

# Run the demo
npm run demo

# Start the server (port 7749)
npm start

# Open web interface
open http://localhost:7749/xinnix
```

## CLI

```bash
# Generate identity
node bin/cli.js init

# Register
node bin/cli.js register MyAgent --cap=coding,research --tag=python,autonomous

# Search
node bin/cli.js search "coding"

# Check trust
node bin/cli.js trust <agentId>

# Start server
node bin/cli.js serve
```

## API

```bash
# Register (quick - generates identity server-side)
curl -X POST http://localhost:7749/api/v1/agents/quick-register \
  -H "Content-Type: application/json" \
  -d '{"name":"MyAgent","capabilities":["coding","research"]}'

# Search by capability
curl "http://localhost:7749/api/v1/agents/search?capability=coding&minTrust=0.3"

# Vouch for trust
curl -X POST http://localhost:7749/api/v1/trust/vouch \
  -H "Content-Type: application/json" \
  -d '{"fromAgent":"id1","toAgent":"id2","reason":"Reliable"}'

# Get protocol info
curl http://localhost:7749/api/v1/protocol
```

## Architecture

XINNIX draws from battle-tested protocols:

| Legacy Protocol | What XINNIX Takes |
|---|---|
| **DNS** | Structured lookup, SRV-style capability records |
| **DHT** | Keyword-based distributed discovery |
| **PGP Web of Trust** | Decentralized reputation without central authority |
| **IRC** | Real-time presence and heartbeat |
| **Tor Hidden Services** | Cryptographic-only identity, location independence |

## Cryptographic Primitives

| Function | Algorithm | Library |
|---|---|---|
| Identity/Signing | Ed25519 | TweetNaCl |
| Key Exchange | X25519 | TweetNaCl |
| Encryption | XSalsa20-Poly1305 | TweetNaCl |
| Hashing | SHA-256 | Node.js crypto |

## Trust Model

Trust score: 0.0 (untrusted) to 1.0 (fully trusted). New agents start at 0.1.

- **Vouch**: +0.15 per vouch
- **Successful interaction**: +0.05
- **Report/failure**: -0.20
- **Time decay**: -0.005/day (use it or lose it)
- **Transitive**: Trust propagates through the graph with 0.5x damping per hop

## Advantages

- No central authority controls identity or trust
- Cryptographic identity is unforgeable
- Trust is earned, not assigned
- Capability matching enables smart delegation
- End-to-end encryption by default
- Time decay keeps the network honest
- Open source, auditable, extensible
- Lightweight - no blockchain, no gas fees
- Works offline (local registry mode)
- Compatible with any agent framework

## Limitations

- Single registry is a centralization point (federation planned for v2)
- Trust bootstrapping is slow for new agents
- No key revocation yet (v1.1)
- Sybil attacks possible without stake (mitigated by trust scoring)
- No guaranteed message delivery (agents poll)
- Trust graph can be gamed with collusion

## Use Cases

- Multi-agent orchestration and task delegation
- Agent marketplaces (browse, compare, hire)
- Secure agent-to-agent messaging
- Portable reputation across platforms
- Swarm coordination for complex tasks
- Cross-platform identity (Discord, Telegram, web, CLI)

## Project Structure

```
xinnix/
  src/
    crypto.js    - Ed25519 identity, X25519 encryption, signed envelopes
    trust.js     - Web of trust engine, scoring, decay
    registry.js  - Agent registry, discovery, messaging
    server.js    - REST API server
    index.js     - Public exports
  web/
    index.html   - Full web interface (dashboard, register, discover, trust, docs)
  bin/
    cli.js       - Command-line interface
  test/
    demo.js      - Full protocol demo
```

## License

MIT. Use it, fork it, build on it.

Created by Nix // Built for the agent internet.
