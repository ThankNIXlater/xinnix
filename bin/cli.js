#!/usr/bin/env node

/**
 * XINNIX CLI - Command line interface for the Agent Discovery Protocol
 */

import { XinnixIdentity } from '../src/crypto.js';
import { XinnixRegistry } from '../src/registry.js';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.XINNIX_DB || path.join(process.cwd(), 'xinnix.db');
const IDENTITY_PATH = process.env.XINNIX_IDENTITY || path.join(process.env.HOME || '/root', '.xinnix-identity.json');

const args = process.argv.slice(2);
const cmd = args[0];

function getRegistry() {
  return new XinnixRegistry(DB_PATH);
}

function loadIdentity() {
  if (!fs.existsSync(IDENTITY_PATH)) return null;
  const data = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
  return new XinnixIdentity(data);
}

function saveIdentity(identity) {
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity.export(), null, 2));
  console.log(`Identity saved to ${IDENTITY_PATH}`);
}

function printHelp() {
  console.log(`
  XINNIX CLI - Agent Discovery Protocol

  Commands:
    init                        Generate a new agent identity
    register <name> [--cap X]   Register agent with the local registry
    search <query>              Search for agents
    lookup <id|name>            Look up a specific agent
    vouch <from> <to> [reason]  Vouch for an agent
    report <from> <to> [reason] Report an agent
    trust <agentId>             Check trust score
    stats                       Show registry statistics
    serve                       Start the XINNIX server
    
  Environment:
    XINNIX_DB        Database path (default: ./xinnix.db)
    XINNIX_IDENTITY  Identity file path (default: ~/.xinnix-identity.json)
    XINNIX_PORT      Server port (default: 7749)
  `);
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    printHelp();
    return;
  }

  if (cmd === 'init') {
    const identity = new XinnixIdentity();
    saveIdentity(identity);
    console.log(`Agent ID: ${identity.agentId}`);
    console.log(`Signing Public Key: ${identity.publicProfile().signingPublicKey}`);
    console.log(`Encryption Public Key: ${identity.publicProfile().encryptionPublicKey}`);
    return;
  }

  if (cmd === 'register') {
    const name = args[1];
    if (!name) { console.error('Usage: xinnix register <name> [--cap coding,trading] [--tag python,defi] [--desc "description"]'); return; }
    
    let identity = loadIdentity();
    if (!identity) {
      identity = new XinnixIdentity();
      saveIdentity(identity);
      console.log('Generated new identity.');
    }

    const caps = (args.find(a => a.startsWith('--cap'))?.split('=')[1] || '').split(',').filter(Boolean);
    const tags = (args.find(a => a.startsWith('--tag'))?.split('=')[1] || '').split(',').filter(Boolean);
    const desc = args.find(a => a.startsWith('--desc'))?.split('=')[1] || '';

    const registry = getRegistry();
    const result = registry.register(identity, { name, description: desc, capabilities: caps, tags });
    console.log('Registered:', JSON.stringify(result, null, 2));
    registry.close();
    return;
  }

  if (cmd === 'search') {
    const query = args[1];
    if (!query) { console.error('Usage: xinnix search <query>'); return; }
    const registry = getRegistry();
    const results = registry.search(query);
    console.log(`Found ${results.length} agents:`);
    results.forEach(a => {
      console.log(`  ${a.name} (${a.agentId}) - trust: ${a.trustScore.toFixed(2)} - caps: ${a.capabilities.map(c => c.capability).join(', ')}`);
    });
    registry.close();
    return;
  }

  if (cmd === 'lookup') {
    const id = args[1];
    if (!id) { console.error('Usage: xinnix lookup <id|name>'); return; }
    const registry = getRegistry();
    const agent = registry.lookup(id);
    if (agent) console.log(JSON.stringify(agent, null, 2));
    else console.log('Agent not found.');
    registry.close();
    return;
  }

  if (cmd === 'vouch') {
    const [, from, to, ...rest] = args;
    if (!from || !to) { console.error('Usage: xinnix vouch <fromId> <toId> [reason]'); return; }
    const registry = getRegistry();
    const score = registry.trust.vouch(from, to, rest.join(' '));
    console.log(`Vouched. New trust score: ${score}`);
    registry.close();
    return;
  }

  if (cmd === 'report') {
    const [, from, to, ...rest] = args;
    if (!from || !to) { console.error('Usage: xinnix report <fromId> <toId> [reason]'); return; }
    const registry = getRegistry();
    const score = registry.trust.report(from, to, rest.join(' '));
    console.log(`Reported. New trust score: ${score}`);
    registry.close();
    return;
  }

  if (cmd === 'trust') {
    const id = args[1];
    if (!id) { console.error('Usage: xinnix trust <agentId>'); return; }
    const registry = getRegistry();
    const score = registry.trust.getScore(id);
    const graph = registry.trust.getGraph(id);
    console.log(`Trust score: ${score.toFixed(3)}`);
    console.log(`Trusted by: ${graph.trustedBy.length} agents`);
    console.log(`Trusts: ${graph.trusts.length} agents`);
    registry.close();
    return;
  }

  if (cmd === 'stats') {
    const registry = getRegistry();
    console.log(JSON.stringify(registry.stats(), null, 2));
    registry.close();
    return;
  }

  if (cmd === 'serve') {
    await import('../src/server.js');
    return;
  }

  console.error(`Unknown command: ${cmd}. Run 'xinnix help' for usage.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
