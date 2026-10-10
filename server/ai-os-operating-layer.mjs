/* FinPilot AI OS operating layer
   Central managed-agent registry. Agent definitions are declarative metadata only:
   no arbitrary code, secret access, brokerage actions, or autonomous execution.
*/
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const MAX_AGENTS = 100;
const MAX_SCOPES = new Set([
  'market_data_read',
  'public_research',
  'financial_brain_read',
  'risk_analysis',
  'paper_simulation',
  'decision_memory_read'
]);
const DOMAINS = new Set([
  'RESEARCH', 'MARKETS', 'RISK', 'PORTFOLIO', 'OPERATIONS',
  'COMPLIANCE', 'SECURITY', 'BUSINESS', 'ASSETS', 'CUSTOM'
]);

const state = {
  agents: [],
  persistence: 'UNINITIALIZED',
  persistent: false,
  detail: 'Agent registry has not initialized.',
  initPromise: null,
  pool: null,
  forcedMemoryForTests: false
};

const safeText = (value, max) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/[<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function publicRecord(record) {
  return {
    ...record,
    permissions: [...(record.permissions || [])],
    automaticExecution: false,
    liveTrading: false,
    humanApprovalRequired: true
  };
}

async function initialize() {
  if (state.initPromise) return state.initPromise;
  state.initPromise = (async () => {
    if (state.forcedMemoryForTests || !process.env.DATABASE_URL) {
      state.persistence = 'PROCESS_MEMORY';
      state.persistent = false;
      state.detail = state.forcedMemoryForTests
        ? 'Test-only memory registry.'
        : 'DATABASE_URL is unavailable; managed agent definitions can be lost on server restart.';
      return;
    }
    try {
      state.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 1800
      });
      await state.pool.query(`CREATE TABLE IF NOT EXISTS finpilot_ai_os_agents (
        id TEXT PRIMARY KEY,
        name_key TEXT UNIQUE NOT NULL,
        agent JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const result = await state.pool.query(
        'SELECT agent FROM finpilot_ai_os_agents ORDER BY created_at DESC LIMIT $1',
        [MAX_AGENTS]
      );
      state.agents = result.rows.map(row => row.agent).filter(x => x && typeof x === 'object');
      state.persistence = 'POSTGRES';
      state.persistent = true;
      state.detail = 'Managed agent definitions are stored in PostgreSQL and restored on startup.';
    } catch (error) {
      try { await state.pool?.end(); } catch {}
      state.pool = null;
      state.persistence = 'PROCESS_MEMORY';
      state.persistent = false;
      state.detail = 'PostgreSQL is unavailable; managed agent definitions are process-memory only (' +
        safeText(error?.message || 'database unavailable', 100) + ').';
    }
  })();
  return state.initPromise;
}

function inferDomain(role, requested) {
  const supplied = safeText(requested, 32).toUpperCase();
  if (DOMAINS.has(supplied)) return supplied;
  const text = String(role || '').toLowerCase();
  if (/(risk|drawdown|liquidity|exposure|stress)/.test(text)) return 'RISK';
  if (/(market|trading|technical|price|crypto|equity|stock)/.test(text)) return 'MARKETS';
  if (/(security|fraud|privacy|permission)/.test(text)) return 'SECURITY';
  if (/(tax|regulat|compliance)/.test(text)) return 'COMPLIANCE';
  if (/(portfolio|investment|valuation|asset allocation)/.test(text)) return 'PORTFOLIO';
  if (/(business|company|deal|real estate|property)/.test(text)) return 'BUSINESS';
  if (/(research|news|evidence|filing)/.test(text)) return 'RESEARCH';
  return 'CUSTOM';
}

export async function listManagedAgents() {
  await initialize();
  return {
    ok: true,
    version: 'AIOS-AGENT-1.0',
    agents: state.agents.map(publicRecord),
    count: state.agents.length,
    maxAgents: MAX_AGENTS,
    persistence: state.persistence,
    persistent: state.persistent,
    persistenceDetail: state.detail,
    policy: {
      execution: 'USER_TRIGGERED_ONLY',
      arbitraryCode: false,
      credentialAccess: false,
      liveTrading: false,
      automaticExecution: false,
      humanApprovalRequired: true
    }
  };
}

export async function createManagedAgent(input = {}) {
  await initialize();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'AGENT_JSON_OBJECT_REQUIRED' };
  }
  const name = safeText(input.name, 60);
  const role = safeText(input.role ?? input.mission, 120);
  const objective = safeText(input.objective, 600) ||
    'Analyze available evidence, state uncertainty, and identify risks before recommending next steps.';
  const icon = safeText(input.icon || '🤖', 8) || '🤖';
  const interval = Number(input.interval ?? input.scheduleMinutes ?? 15);
  if (name.length < 2 || !role) {
    return { ok: false, status: 400, error: 'AGENT_NAME_AND_ROLE_REQUIRED' };
  }
  if (!Number.isInteger(interval) || interval < 1 || interval > 1440) {
    return { ok: false, status: 400, error: 'AGENT_INTERVAL_OUT_OF_RANGE', allowedMinutes: [1, 1440] };
  }
  if (state.agents.length >= MAX_AGENTS) {
    return { ok: false, status: 429, error: 'AGENT_REGISTRY_LIMIT_REACHED', maxAgents: MAX_AGENTS };
  }
  const nameKey = name.toLocaleLowerCase('en-US');
  if (state.agents.some(agent => String(agent.name).toLocaleLowerCase('en-US') === nameKey)) {
    return { ok: false, status: 409, error: 'AGENT_NAME_ALREADY_REGISTERED' };
  }
  const requestedScopes = Array.isArray(input.permissions) ? input.permissions :
    Array.isArray(input.dataScopes) ? input.dataScopes : [
      'market_data_read', 'public_research', 'decision_memory_read'
    ];
  const permissions = [...new Set(requestedScopes.map(x => safeText(x, 40)).filter(x => MAX_SCOPES.has(x)))].slice(0, 6);
  const createdAt = new Date().toISOString();
  const agent = {
    id: 'aios-agent-' + randomUUID(),
    name,
    icon,
    role,
    domain: inferDomain(role, input.domain),
    objective,
    interval,
    enabled: true,
    status: 'REGISTERED',
    executionMode: 'USER_TRIGGERED_ONLY',
    permissions,
    automaticExecution: false,
    liveTrading: false,
    humanApprovalRequired: true,
    source: 'AI_OS_AGENT_FACTORY',
    createdAt,
    updatedAt: createdAt
  };
  if (state.persistence === 'POSTGRES' && state.pool) {
    try {
      await state.pool.query(
        'INSERT INTO finpilot_ai_os_agents(id,name_key,agent,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,$4)',
        [agent.id, nameKey, JSON.stringify(agent), createdAt]
      );
    } catch (error) {
      if (error?.code === '23505') return { ok: false, status: 409, error: 'AGENT_NAME_ALREADY_REGISTERED' };
      state.persistence = 'PROCESS_MEMORY';
      state.persistent = false;
      state.detail = 'Agent registry database write failed; new definitions are process-memory only.';
      try { await state.pool.end(); } catch {}
      state.pool = null;
    }
  }
  state.agents.unshift(agent);
  state.agents = state.agents.slice(0, MAX_AGENTS);
  return {
    ok: true,
    agent: publicRecord(agent),
    count: state.agents.length,
    persistence: state.persistence,
    persistent: state.persistent,
    persistenceDetail: state.detail,
    note: 'Registered as a user-triggered specialist definition. This does not schedule background runs or authorize transactions.'
  };
}

export async function getManagedAgentRegistrySnapshot() {
  const data = await listManagedAgents();
  return {
    ok: true,
    count: data.count,
    maxAgents: data.maxAgents,
    persistence: data.persistence,
    persistent: data.persistent,
    detail: data.persistenceDetail,
    policy: data.policy
  };
}

export async function resetManagedAgentsForTests() {
  try { await state.pool?.end(); } catch {}
  state.agents = [];
  state.pool = null;
  state.persistence = 'UNINITIALIZED';
  state.persistent = false;
  state.detail = 'Test registry reset.';
  state.initPromise = null;
  state.forcedMemoryForTests = true;
}
