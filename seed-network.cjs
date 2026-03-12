const { XinnixIdentity } = require('./src');
const crypto = require('crypto');
const fs = require('fs');
const BASE = 'http://localhost:7749/api/v1';

async function post(p, b) {
  const r = await fetch(`${BASE}${p}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
  return r.json();
}

function signReg(id, profile) {
  const ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64');
  const pk = id.publicProfile();
  const d = { publicKeys: pk, profile, timestamp: ts, nonce };
  return { ...d, signature: id.sign(JSON.stringify(d)), signingPublicKey: pk.signingPublicKey };
}

// Agent templates - real capabilities across every domain
const AGENTS = [
  // === CODING & DEVELOPMENT (200) ===
  ...generateCategory('coding', 200, [
    { name: 'CodeForge-{n}', caps: ['python', 'coding', 'api-development'], tags: ['builder', 'autonomous'], desc: 'Python backend specialist. FastAPI, Django, async.' },
    { name: 'ReactMaster-{n}', caps: ['react', 'frontend', 'typescript'], tags: ['builder', 'ui'], desc: 'React + TypeScript. Component architecture, state management.' },
    { name: 'RustSmith-{n}', caps: ['rust', 'systems-programming', 'performance'], tags: ['builder', 'low-level'], desc: 'Rust systems dev. Zero-cost abstractions, memory safety.' },
    { name: 'GoRunner-{n}', caps: ['golang', 'microservices', 'concurrency'], tags: ['builder', 'scalable'], desc: 'Go microservices. gRPC, channels, cloud-native.' },
    { name: 'NodeWiz-{n}', caps: ['nodejs', 'javascript', 'backend'], tags: ['builder', 'fullstack'], desc: 'Node.js full-stack. Express, Next.js, serverless.' },
    { name: 'SwiftDev-{n}', caps: ['swift', 'ios', 'mobile'], tags: ['builder', 'mobile'], desc: 'iOS native development. SwiftUI, CoreData, ARKit.' },
    { name: 'KotlinPro-{n}', caps: ['kotlin', 'android', 'mobile'], tags: ['builder', 'mobile'], desc: 'Android native. Jetpack Compose, Room, Coroutines.' },
    { name: 'SQLMaster-{n}', caps: ['sql', 'database', 'optimization'], tags: ['specialist', 'data'], desc: 'Database architect. PostgreSQL, query optimization, sharding.' },
    { name: 'DevOpsBot-{n}', caps: ['devops', 'ci-cd', 'kubernetes'], tags: ['infra', 'automation'], desc: 'CI/CD pipelines. K8s, Terraform, GitOps workflows.' },
    { name: 'MLEngineer-{n}', caps: ['machine-learning', 'pytorch', 'training'], tags: ['ai', 'research'], desc: 'ML model training. PyTorch, distributed training, RLHF.' },
    { name: 'SolidityDev-{n}', caps: ['solidity', 'smart-contracts', 'evm'], tags: ['web3', 'builder'], desc: 'Smart contract development. Foundry, Hardhat, gas optimization.' },
    { name: 'FlutterPro-{n}', caps: ['flutter', 'dart', 'cross-platform'], tags: ['mobile', 'builder'], desc: 'Cross-platform mobile. Flutter, state management, animations.' },
    { name: 'CppEngine-{n}', caps: ['cpp', 'game-engine', 'graphics'], tags: ['builder', 'performance'], desc: 'C++ game/graphics engine dev. Vulkan, OpenGL, ECS.' },
    { name: 'WebAssembler-{n}', caps: ['wasm', 'webassembly', 'performance'], tags: ['builder', 'edge'], desc: 'WebAssembly specialist. Rust-to-WASM, edge compute.' },
    { name: 'ElixirNode-{n}', caps: ['elixir', 'distributed-systems', 'fault-tolerance'], tags: ['builder', 'resilient'], desc: 'Elixir/OTP distributed systems. Phoenix, GenServer, BEAM.' },
    { name: 'APIDesigner-{n}', caps: ['api-design', 'graphql', 'rest'], tags: ['architect', 'integration'], desc: 'API architecture. GraphQL, REST, gRPC, OpenAPI.' },
    { name: 'TestBot-{n}', caps: ['testing', 'qa', 'automation'], tags: ['quality', 'automation'], desc: 'Test automation. Playwright, Cypress, load testing.' },
    { name: 'SecurityDev-{n}', caps: ['security', 'penetration-testing', 'audit'], tags: ['security', 'specialist'], desc: 'Application security. Pen testing, code audit, OWASP.' },
    { name: 'DataPipe-{n}', caps: ['data-engineering', 'etl', 'streaming'], tags: ['data', 'infra'], desc: 'Data pipelines. Kafka, Spark, Airflow, real-time ETL.' },
    { name: 'DockerWiz-{n}', caps: ['docker', 'containerization', 'orchestration'], tags: ['infra', 'builder'], desc: 'Container specialist. Docker, Compose, Swarm, optimization.' },
  ]),

  // === RESEARCH & ANALYSIS (150) ===
  ...generateCategory('research', 150, [
    { name: 'DeepResearch-{n}', caps: ['research', 'analysis', 'citations'], tags: ['thorough', 'autonomous'], desc: 'Multi-source deep research. Academic papers, patents, data.' },
    { name: 'MarketAnalyst-{n}', caps: ['market-research', 'competitive-analysis', 'trends'], tags: ['business', 'strategic'], desc: 'Market intelligence. TAM/SAM, competitor mapping, SWOT.' },
    { name: 'DataScientist-{n}', caps: ['data-analysis', 'statistics', 'visualization'], tags: ['analytical', 'quantitative'], desc: 'Statistical analysis. R, pandas, hypothesis testing, dashboards.' },
    { name: 'PatentBot-{n}', caps: ['patent-research', 'prior-art', 'ip-analysis'], tags: ['legal', 'research'], desc: 'Patent landscape analysis. Prior art search, claim mapping.' },
    { name: 'AcademicBot-{n}', caps: ['academic-research', 'literature-review', 'summarization'], tags: ['scholarly', 'thorough'], desc: 'Academic literature review. PubMed, arXiv, systematic review.' },
    { name: 'SentimentBot-{n}', caps: ['sentiment-analysis', 'nlp', 'social-listening'], tags: ['ai', 'monitoring'], desc: 'Sentiment analysis. Social media monitoring, brand perception.' },
    { name: 'GeoAnalyst-{n}', caps: ['geospatial', 'mapping', 'location-intelligence'], tags: ['spatial', 'data'], desc: 'Geospatial analysis. GIS, satellite imagery, location data.' },
    { name: 'ThreatIntel-{n}', caps: ['threat-intelligence', 'osint', 'cybersecurity'], tags: ['security', 'intelligence'], desc: 'Cyber threat intelligence. OSINT, indicator analysis, APT tracking.' },
    { name: 'PolicyBot-{n}', caps: ['policy-analysis', 'regulatory', 'compliance'], tags: ['governance', 'research'], desc: 'Policy and regulatory analysis. Compliance mapping, impact assessment.' },
    { name: 'BioResearch-{n}', caps: ['bioinformatics', 'genomics', 'drug-discovery'], tags: ['biotech', 'research'], desc: 'Bioinformatics research. Sequence analysis, protein structure, drug targets.' },
  ]),

  // === TRADING & FINANCE (150) ===
  ...generateCategory('trading', 150, [
    { name: 'AlphaTrader-{n}', caps: ['trading', 'technical-analysis', 'signals'], tags: ['crypto', 'autonomous'], desc: 'Technical analysis trader. Chart patterns, indicators, signals.' },
    { name: 'DeFiYield-{n}', caps: ['defi', 'yield-farming', 'liquidity'], tags: ['crypto', 'finance'], desc: 'DeFi yield optimization. LP strategies, impermanent loss calc.' },
    { name: 'OnChainBot-{n}', caps: ['on-chain-analysis', 'whale-tracking', 'flow-analysis'], tags: ['crypto', 'data'], desc: 'On-chain analytics. Whale movements, smart money flows.' },
    { name: 'QuantBot-{n}', caps: ['quantitative-trading', 'backtesting', 'algorithms'], tags: ['quant', 'systematic'], desc: 'Quantitative strategies. Backtesting, alpha generation, risk models.' },
    { name: 'ArbitrageBot-{n}', caps: ['arbitrage', 'cross-exchange', 'market-making'], tags: ['trading', 'automated'], desc: 'Cross-exchange arbitrage. Latency optimization, order routing.' },
    { name: 'FundAnalyst-{n}', caps: ['fundamental-analysis', 'valuation', 'earnings'], tags: ['equities', 'value'], desc: 'Fundamental equity analysis. DCF, earnings models, sector analysis.' },
    { name: 'RiskManager-{n}', caps: ['risk-management', 'portfolio', 'hedging'], tags: ['finance', 'risk'], desc: 'Portfolio risk management. VaR, stress testing, hedging strategies.' },
    { name: 'MEVHunter-{n}', caps: ['mev', 'sandwich', 'flashbots'], tags: ['crypto', 'advanced'], desc: 'MEV extraction. Sandwich detection, Flashbots bundles, backrunning.' },
    { name: 'NFTAnalyst-{n}', caps: ['nft-analysis', 'rarity', 'floor-tracking'], tags: ['crypto', 'collectibles'], desc: 'NFT market analysis. Rarity scoring, wash trading detection.' },
    { name: 'MacroBot-{n}', caps: ['macro-economics', 'rates', 'forex'], tags: ['macro', 'global'], desc: 'Macro analysis. Central bank policy, yield curves, FX dynamics.' },
    { name: 'OptionsBot-{n}', caps: ['options-trading', 'greeks', 'volatility'], tags: ['derivatives', 'quant'], desc: 'Options strategies. Greeks, vol surface, spread construction.' },
    { name: 'AirdropScout-{n}', caps: ['airdrops', 'token-farming', 'eligibility'], tags: ['crypto', 'alpha'], desc: 'Airdrop farming. Eligibility tracking, protocol interaction.' },
    { name: 'TaxBot-{n}', caps: ['crypto-tax', 'cost-basis', 'reporting'], tags: ['finance', 'compliance'], desc: 'Crypto tax calculation. Cost basis, FIFO/LIFO, form 8949.' },
    { name: 'LiquidBot-{n}', caps: ['liquidation', 'monitoring', 'leverage'], tags: ['defi', 'risk'], desc: 'Liquidation monitoring. Health factor alerts, position unwinding.' },
    { name: 'BridgeBot-{n}', caps: ['cross-chain', 'bridging', 'multichain'], tags: ['crypto', 'infra'], desc: 'Cross-chain bridging. Route optimization, fee comparison, security check.' },
  ]),

  // === CONTENT & CREATIVE (100) ===
  ...generateCategory('content', 100, [
    { name: 'CopyWriter-{n}', caps: ['copywriting', 'marketing', 'persuasion'], tags: ['creative', 'marketing'], desc: 'Direct response copywriting. Headlines, landing pages, emails.' },
    { name: 'SEOBot-{n}', caps: ['seo', 'keyword-research', 'content-optimization'], tags: ['marketing', 'organic'], desc: 'SEO optimization. Keyword research, on-page, technical SEO.' },
    { name: 'VideoEditor-{n}', caps: ['video-editing', 'motion-graphics', 'ffmpeg'], tags: ['creative', 'media'], desc: 'Video production. Cutting, effects, motion graphics, encoding.' },
    { name: 'DesignBot-{n}', caps: ['ui-design', 'figma', 'prototyping'], tags: ['creative', 'ui'], desc: 'UI/UX design. Figma, prototyping, design systems.' },
    { name: 'SocialBot-{n}', caps: ['social-media', 'content-creation', 'engagement'], tags: ['marketing', 'growth'], desc: 'Social media management. Content calendar, engagement, analytics.' },
    { name: 'TranslateBot-{n}', caps: ['translation', 'localization', 'multilingual'], tags: ['language', 'global'], desc: 'Translation and localization. 50+ languages, cultural adaptation.' },
    { name: 'PodcastBot-{n}', caps: ['audio-editing', 'podcast', 'transcription'], tags: ['media', 'audio'], desc: 'Podcast production. Editing, show notes, transcription, distribution.' },
    { name: 'TechWriter-{n}', caps: ['technical-writing', 'documentation', 'api-docs'], tags: ['writing', 'developer'], desc: 'Technical documentation. API docs, tutorials, architecture guides.' },
    { name: 'BrandBot-{n}', caps: ['branding', 'identity', 'strategy'], tags: ['creative', 'strategic'], desc: 'Brand strategy. Positioning, voice, visual identity systems.' },
    { name: 'EmailBot-{n}', caps: ['email-marketing', 'automation', 'drip-campaigns'], tags: ['marketing', 'conversion'], desc: 'Email marketing automation. Sequences, segmentation, deliverability.' },
  ]),

  // === SCRAPING & DATA COLLECTION (100) ===
  ...generateCategory('scraping', 100, [
    { name: 'WebScraper-{n}', caps: ['scraping', 'playwright', 'data-extraction'], tags: ['builder', 'autonomous'], desc: 'Web scraping specialist. Playwright, anti-detection, rotating proxies.' },
    { name: 'PriceScraper-{n}', caps: ['price-monitoring', 'ecommerce', 'scraping'], tags: ['data', 'retail'], desc: 'E-commerce price monitoring. Amazon, eBay, dynamic pricing.' },
    { name: 'SocialScraper-{n}', caps: ['social-scraping', 'twitter', 'reddit'], tags: ['data', 'social'], desc: 'Social media data collection. Twitter, Reddit, sentiment extraction.' },
    { name: 'APICrawler-{n}', caps: ['api-integration', 'data-aggregation', 'etl'], tags: ['data', 'integration'], desc: 'API data aggregation. Rate limit management, normalization.' },
    { name: 'NewsBot-{n}', caps: ['news-scraping', 'rss', 'real-time'], tags: ['data', 'media'], desc: 'Real-time news aggregation. RSS, article extraction, deduplication.' },
    { name: 'LeadScraper-{n}', caps: ['lead-generation', 'b2b-data', 'enrichment'], tags: ['sales', 'data'], desc: 'B2B lead generation. Company data, contact enrichment, LinkedIn.' },
    { name: 'JobScraper-{n}', caps: ['job-scraping', 'recruitment', 'market-data'], tags: ['data', 'hr'], desc: 'Job market data. Salary trends, skill demand, opening tracking.' },
    { name: 'RealEstateScraper-{n}', caps: ['real-estate', 'property-data', 'valuation'], tags: ['data', 'property'], desc: 'Real estate data. Listings, pricing trends, neighborhood analysis.' },
    { name: 'ReviewScraper-{n}', caps: ['review-scraping', 'sentiment', 'product-analysis'], tags: ['data', 'consumer'], desc: 'Product review analysis. Multi-platform, sentiment scoring.' },
    { name: 'MapScraper-{n}', caps: ['location-data', 'google-maps', 'poi'], tags: ['data', 'geo'], desc: 'Location data extraction. Google Maps, POI, business info.' },
  ]),

  // === DEVOPS & INFRASTRUCTURE (80) ===
  ...generateCategory('infra', 80, [
    { name: 'CloudArch-{n}', caps: ['aws', 'cloud-architecture', 'cost-optimization'], tags: ['infra', 'architect'], desc: 'AWS cloud architecture. Well-Architected, cost optimization.' },
    { name: 'MonitorBot-{n}', caps: ['monitoring', 'alerting', 'observability'], tags: ['infra', 'ops'], desc: 'Infrastructure monitoring. Prometheus, Grafana, PagerDuty.' },
    { name: 'NetAdmin-{n}', caps: ['networking', 'dns', 'load-balancing'], tags: ['infra', 'network'], desc: 'Network administration. DNS, CDN, load balancing, firewall.' },
    { name: 'BackupBot-{n}', caps: ['backup', 'disaster-recovery', 'replication'], tags: ['infra', 'reliability'], desc: 'Backup and DR. Automated snapshots, geo-replication, RTO/RPO.' },
    { name: 'LogAnalyst-{n}', caps: ['log-analysis', 'elk-stack', 'troubleshooting'], tags: ['ops', 'debug'], desc: 'Log analysis. ELK stack, pattern detection, root cause analysis.' },
    { name: 'TerraformBot-{n}', caps: ['terraform', 'iac', 'provisioning'], tags: ['infra', 'automation'], desc: 'Infrastructure as Code. Terraform, Pulumi, GitOps.' },
    { name: 'DNSBot-{n}', caps: ['dns-management', 'domains', 'records'], tags: ['infra', 'web'], desc: 'DNS management. Record configuration, propagation, DNSSEC.' },
    { name: 'SSLBot-{n}', caps: ['ssl-tls', 'certificates', 'encryption'], tags: ['security', 'infra'], desc: 'SSL/TLS management. Certificate issuance, renewal, pinning.' },
  ]),

  // === AI & ML (100) ===
  ...generateCategory('ai', 100, [
    { name: 'PromptEng-{n}', caps: ['prompt-engineering', 'llm', 'optimization'], tags: ['ai', 'specialist'], desc: 'Prompt engineering. Chain-of-thought, few-shot, system prompts.' },
    { name: 'FineTuner-{n}', caps: ['fine-tuning', 'lora', 'model-training'], tags: ['ai', 'training'], desc: 'Model fine-tuning. LoRA, QLoRA, RLHF, dataset curation.' },
    { name: 'RAGBot-{n}', caps: ['rag', 'embeddings', 'vector-search'], tags: ['ai', 'retrieval'], desc: 'RAG systems. Embedding models, vector DBs, retrieval pipelines.' },
    { name: 'VisionBot-{n}', caps: ['computer-vision', 'image-analysis', 'ocr'], tags: ['ai', 'vision'], desc: 'Computer vision. Object detection, OCR, image classification.' },
    { name: 'NLPBot-{n}', caps: ['nlp', 'text-processing', 'entity-extraction'], tags: ['ai', 'language'], desc: 'NLP specialist. Named entity recognition, text classification.' },
    { name: 'AgentBuilder-{n}', caps: ['agent-development', 'orchestration', 'tool-use'], tags: ['ai', 'meta'], desc: 'AI agent development. Multi-agent systems, tool integration.' },
    { name: 'SpeechBot-{n}', caps: ['speech-to-text', 'tts', 'voice'], tags: ['ai', 'audio'], desc: 'Speech processing. Whisper, TTS, voice cloning, real-time.' },
    { name: 'DiffusionBot-{n}', caps: ['image-generation', 'stable-diffusion', 'controlnet'], tags: ['ai', 'creative'], desc: 'Image generation. Stable Diffusion, ControlNet, SDXL, ComfyUI.' },
    { name: 'EvalBot-{n}', caps: ['model-evaluation', 'benchmarking', 'quality'], tags: ['ai', 'testing'], desc: 'Model evaluation. Benchmarks, red-teaming, quality metrics.' },
    { name: 'AutoMLBot-{n}', caps: ['automl', 'hyperparameter', 'nas'], tags: ['ai', 'optimization'], desc: 'AutoML. Hyperparameter tuning, neural architecture search.' },
  ]),

  // === LEGAL & COMPLIANCE (50) ===
  ...generateCategory('legal', 50, [
    { name: 'ContractBot-{n}', caps: ['contract-review', 'legal-analysis', 'redlining'], tags: ['legal', 'automation'], desc: 'Contract analysis. Clause extraction, risk flagging, redlining.' },
    { name: 'PrivacyBot-{n}', caps: ['privacy', 'gdpr', 'data-protection'], tags: ['compliance', 'legal'], desc: 'Privacy compliance. GDPR, CCPA, data mapping, DPIA.' },
    { name: 'IPBot-{n}', caps: ['intellectual-property', 'trademark', 'copyright'], tags: ['legal', 'ip'], desc: 'IP management. Trademark search, copyright analysis, licensing.' },
    { name: 'ComplianceBot-{n}', caps: ['regulatory-compliance', 'kyc', 'aml'], tags: ['finance', 'compliance'], desc: 'Financial compliance. KYC/AML, sanctions screening, reporting.' },
    { name: 'LegalResearch-{n}', caps: ['legal-research', 'case-law', 'precedent'], tags: ['legal', 'research'], desc: 'Legal research. Case law analysis, precedent finding, citations.' },
  ]),

  // === EDUCATION & TRAINING (50) ===
  ...generateCategory('education', 50, [
    { name: 'TutorBot-{n}', caps: ['tutoring', 'explanation', 'learning'], tags: ['education', 'patient'], desc: 'AI tutor. Adaptive learning, concept explanation, practice problems.' },
    { name: 'CurriculumBot-{n}', caps: ['curriculum-design', 'assessment', 'pedagogy'], tags: ['education', 'design'], desc: 'Curriculum design. Learning objectives, assessment rubrics.' },
    { name: 'QuizMaster-{n}', caps: ['quiz-generation', 'testing', 'evaluation'], tags: ['education', 'assessment'], desc: 'Quiz and test generation. Multiple formats, difficulty scaling.' },
    { name: 'CodeCoach-{n}', caps: ['code-review', 'mentoring', 'best-practices'], tags: ['education', 'coding'], desc: 'Code mentorship. Review, refactoring guidance, best practices.' },
    { name: 'LanguageCoach-{n}', caps: ['language-learning', 'grammar', 'conversation'], tags: ['education', 'language'], desc: 'Language learning. Grammar, vocabulary, conversation practice.' },
  ]),

  // === AUTOMATION & INTEGRATION (70) ===
  ...generateCategory('automation', 70, [
    { name: 'ZapierBot-{n}', caps: ['workflow-automation', 'integration', 'triggers'], tags: ['automation', 'no-code'], desc: 'Workflow automation. Multi-app integration, trigger/action chains.' },
    { name: 'CRMBot-{n}', caps: ['crm', 'salesforce', 'hubspot'], tags: ['sales', 'automation'], desc: 'CRM automation. Salesforce, HubSpot, pipeline management.' },
    { name: 'SchedulerBot-{n}', caps: ['scheduling', 'calendar', 'booking'], tags: ['productivity', 'automation'], desc: 'Scheduling automation. Calendar management, booking, reminders.' },
    { name: 'InvoiceBot-{n}', caps: ['invoicing', 'payments', 'accounting'], tags: ['finance', 'automation'], desc: 'Invoice automation. Generation, tracking, payment reconciliation.' },
    { name: 'FormBot-{n}', caps: ['form-processing', 'data-entry', 'validation'], tags: ['automation', 'data'], desc: 'Form processing. OCR, data extraction, validation, submission.' },
    { name: 'NotifyBot-{n}', caps: ['notifications', 'alerting', 'messaging'], tags: ['communication', 'automation'], desc: 'Notification management. Multi-channel alerts, escalation.' },
    { name: 'ReportBot-{n}', caps: ['report-generation', 'dashboards', 'analytics'], tags: ['business', 'automation'], desc: 'Automated reporting. Dashboard generation, scheduled reports.' },
  ]),
];

function generateCategory(prefix, count, templates) {
  const agents = [];
  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length];
    const n = Math.floor(i / templates.length) + 1;
    agents.push({
      name: t.name.replace('{n}', `${prefix[0].toUpperCase()}${n}`),
      capabilities: t.caps,
      tags: t.tags,
      description: t.desc
    });
  }
  return agents;
}

async function seed() {
  const total = AGENTS.length;
  console.log(`Seeding ${total} agents...\n`);
  
  const registry = [];
  let registered = 0;
  let failed = 0;
  const BATCH = 10;

  for (let i = 0; i < AGENTS.length; i += BATCH) {
    const batch = AGENTS.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (agent) => {
      try {
        const identity = new XinnixIdentity();
        const reg = signReg(identity, {
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities,
          tags: agent.tags
        });
        const result = await post('/agents/register', reg);
        if (result.agentId) {
          registered++;
          registry.push({
            name: agent.name,
            agentId: result.agentId,
            capabilities: agent.capabilities,
            tags: agent.tags,
            description: agent.description,
            trust: result.trustScore,
            keys: identity.export()
          });
          return { ok: true, name: agent.name };
        } else {
          failed++;
          return { ok: false, name: agent.name, error: result.error };
        }
      } catch(e) {
        failed++;
        return { ok: false, name: agent.name, error: e.message };
      }
    }));
    
    if ((i + BATCH) % 100 === 0 || i + BATCH >= AGENTS.length) {
      console.log(`  ${Math.min(i + BATCH, AGENTS.length)}/${total} (${registered} ok, ${failed} failed)`);
    }
  }

  // Build organic trust (random vouches between agents in related categories)
  console.log(`\nBuilding trust network...`);
  let vouches = 0;
  const capMap = {};
  
  // Index agents by capability
  for (const agent of registry) {
    for (const cap of agent.capabilities) {
      if (!capMap[cap]) capMap[cap] = [];
      capMap[cap].push(agent);
    }
  }

  // Each agent vouches for 1-3 agents with overlapping capabilities
  for (const agent of registry) {
    const related = new Set();
    for (const cap of agent.capabilities) {
      const peers = capMap[cap] || [];
      for (const p of peers) {
        if (p.agentId !== agent.agentId) related.add(p);
      }
    }
    
    const peers = Array.from(related);
    const numVouches = Math.min(peers.length, 1 + Math.floor(Math.random() * 3));
    
    // Pick random peers to vouch for
    for (let v = 0; v < numVouches; v++) {
      const peer = peers[Math.floor(Math.random() * peers.length)];
      try {
        const id = new XinnixIdentity(agent.keys);
        const vouchReq = id.createSignedRequest({
          toAgent: peer.agentId,
          reason: `Verified ${peer.capabilities[0]} capability`,
          confidence: 0.5 + Math.random() * 0.5
        });
        await post('/trust/vouch', vouchReq);
        vouches++;
      } catch(e) {}
    }
    
    if (vouches % 100 === 0 && vouches > 0) console.log(`  ${vouches} vouches created...`);
  }

  console.log(`  Total vouches: ${vouches}`);

  // Save registry
  const output = {
    generated: new Date().toISOString(),
    totalAgents: registered,
    totalVouches: vouches,
    categories: {
      coding: registry.filter(a => a.capabilities.includes('coding') || a.capabilities.includes('python')).length,
      research: registry.filter(a => a.capabilities.includes('research') || a.capabilities.includes('analysis')).length,
      trading: registry.filter(a => a.capabilities.includes('trading') || a.capabilities.includes('defi')).length,
      content: registry.filter(a => a.capabilities.includes('copywriting') || a.capabilities.includes('seo')).length,
      scraping: registry.filter(a => a.capabilities.includes('scraping')).length,
      infra: registry.filter(a => a.capabilities.includes('devops') || a.capabilities.includes('aws')).length,
      ai: registry.filter(a => a.capabilities.includes('llm') || a.capabilities.includes('machine-learning')).length,
    },
    agents: registry.map(a => ({
      name: a.name,
      agentId: a.agentId,
      capabilities: a.capabilities,
      tags: a.tags,
      description: a.description
    }))
  };

  fs.writeFileSync('seed-registry.json', JSON.stringify(output, null, 2));
  console.log(`\nRegistry saved to seed-registry.json`);

  // Final stats
  const stats = await (await fetch(`${BASE}/stats`)).json();
  console.log(`\n=== SEED COMPLETE ===`);
  console.log(`Agents: ${stats.totalAgents}`);
  console.log(`Capabilities: ${stats.totalCapabilities}`);
  console.log(`Vouches: ${stats.totalVouches}`);
  console.log(`Messages: ${stats.totalMessages}`);
}

seed().catch(e => console.error(e));
