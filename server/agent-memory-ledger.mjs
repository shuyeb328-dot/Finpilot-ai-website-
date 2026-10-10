import {createHash, randomUUID} from 'node:crypto';

export const AGENT_MEMORY_LAYERS = Object.freeze(['EPISODIC','SEMANTIC','PROCEDURAL','OUTCOME']);
export const AGENT_MEMORY_LEDGER_VERSION = '1.0.0';
const MAX_IN_MEMORY = 500;
const MAX_RETURNED = 50;
const SOURCE_LAYERS = Object.freeze({
  SERVER_EXECUTED: ['EPISODIC'],
  CLIENT_REPORTED_UNVERIFIED: ['EPISODIC'],
  VERIFIED_EVIDENCE: ['SEMANTIC'],
  APPROVED_PROCEDURE: ['PROCEDURAL'],
  VERIFIED_OUTCOME: ['OUTCOME']
});
const VERIFICATION = Object.freeze({
  SERVER_EXECUTED: 'EXECUTION_RECORDED_NOT_OUTCOME_VERIFIED',
  CLIENT_REPORTED_UNVERIFIED: 'UNVERIFIED_CLIENT_TELEMETRY',
  VERIFIED_EVIDENCE: 'SOURCE_VERIFIED_BY_SERVER',
  APPROVED_PROCEDURE: 'HUMAN_APPROVED_PROCEDURE',
  VERIFIED_OUTCOME: 'OUTCOME_SETTLED_FROM_VERIFIED_SOURCE'
});
const RETENTION_MS = Object.freeze({
  EPISODIC: 180 * 24 * 60 * 60 * 1000,
  SEMANTIC: 365 * 24 * 60 * 60 * 1000,
  PROCEDURAL: 365 * 24 * 60 * 60 * 1000,
  OUTCOME: null
});
const state = {
  getPool: async () => null,
  databaseConfigured: () => false,
  pool: null,
  initPromise: null,
  schemaReady: false,
  persistence: 'PROCESS_MEMORY',
  persistent: false,
  detail: 'No DATABASE_URL is configured; agent memory is process-memory only and is lost when the server restarts.',
  records: [],
  duplicatesSuppressed: 0,
  rejected: 0,
  writeFailures: 0
};

const nowIso = () => new Date().toISOString();
const clean = (value, max = 1200) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function safeContent(value) {
  return clean(value, 1200)
    .replace(/\b(api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]');
}
function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href.slice(0, 2048);
  } catch { return null; }
}
function safeMetadata(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const key of ['domain','requestId','decisionId','evidenceId','outcome','horizon','provider','modelVersion','testCaseId']) {
    if (input[key] != null) out[key] = clean(input[key], 160);
  }
  for (const key of ['horizonMinutes','referencePrice','actualReturnPct','brierScore','logLoss','pUp','pDown','pHold']) {
    if (input[key] !== undefined && input[key] !== null && Number.isFinite(Number(input[key]))) out[key] = Number(input[key]);
  }
  for (const key of ['sourceAsOf','settledAt']) {
    if (input[key] != null && Number.isFinite(Date.parse(String(input[key])))) out[key] = new Date(String(input[key])).toISOString();
  }
  return out;
}
function dedupeFingerprint(row) {
  const day = String(row.observedAt).slice(0, 10);
  return createHash('sha256')
    .update([row.agent,row.layer,row.source,row.content,row.decision || '',row.sourceUrl || '',day].join('|'))
    .digest('hex');
}
function publicRecord(row) {
  return {
    id: row.id,
    agent: row.agent,
    layer: row.layer,
    source: row.source,
    content: row.content,
    decision: row.decision,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    verificationStatus: row.verificationStatus,
    metadata: {...(row.metadata || {})}
  };
}
function currentDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

export function configureAgentMemoryLedger(options = {}) {
  if (typeof options.getPool === 'function') state.getPool = options.getPool;
  if (typeof options.databaseConfigured === 'function') state.databaseConfigured = options.databaseConfigured;
  state.persistence = state.databaseConfigured() ? 'POSTGRES_NOT_YET_VERIFIED' : 'PROCESS_MEMORY';
  state.persistent = false;
  state.detail = state.databaseConfigured()
    ? 'A database URL is configured; memory persistence is verified lazily on first use.'
    : 'No DATABASE_URL is configured; agent memory is process-memory only and is lost when the server restarts.';
}

async function ensureStorage() {
  if (state.initPromise) return state.initPromise;
  state.initPromise = (async () => {
    if (!state.databaseConfigured()) {
      state.persistence = 'PROCESS_MEMORY';
      state.persistent = false;
      state.detail = 'No DATABASE_URL is configured; agent memory is process-memory only and is lost when the server restarts.';
      return null;
    }
    try {
      const pool = await state.getPool();
      if (!pool) throw new Error('DATABASE_POOL_UNAVAILABLE');
      await pool.query(`CREATE TABLE IF NOT EXISTS finpilot_agent_memory_ledger (
        id TEXT PRIMARY KEY,
        fingerprint TEXT UNIQUE NOT NULL,
        agent TEXT NOT NULL,
        layer TEXT NOT NULL CHECK (layer IN ('EPISODIC','SEMANTIC','PROCEDURAL','OUTCOME')),
        source TEXT NOT NULL CHECK (source IN ('SERVER_EXECUTED','CLIENT_REPORTED_UNVERIFIED','VERIFIED_EVIDENCE','APPROVED_PROCEDURE','VERIFIED_OUTCOME')),
        content TEXT NOT NULL,
        decision TEXT,
        source_url TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        verification_status TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS finpilot_agent_memory_agent_time_idx ON finpilot_agent_memory_ledger(agent,observed_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS finpilot_agent_memory_layer_time_idx ON finpilot_agent_memory_ledger(layer,observed_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS finpilot_agent_memory_source_time_idx ON finpilot_agent_memory_ledger(source,observed_at DESC)');
      state.pool = pool;
      state.schemaReady = true;
      state.persistence = 'POSTGRES';
      state.persistent = true;
      state.detail = 'Agent memory records are stored in PostgreSQL with layer, provenance, verification status and retention metadata.';
      return pool;
    } catch (error) {
      state.pool = null;
      state.schemaReady = false;
      state.persistence = 'DATABASE_ERROR';
      state.persistent = false;
      state.detail = 'A database URL is configured but persistent agent memory is unavailable (' + clean(error?.message || 'database unavailable', 120) + ').';
      return null;
    }
  })();
  return state.initPromise;
}

export async function recordAgentMemory(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    state.rejected++;
    return {ok:false,error:'MEMORY_RECORD_OBJECT_REQUIRED'};
  }
  const agent = clean(input.agent, 64);
  const layer = clean(input.layer, 24).toUpperCase();
  const source = clean(input.source, 40).toUpperCase();
  const content = safeContent(input.content);
  const decision = safeContent(input.decision || '').slice(0, 600) || null;
  const sourceUrl = safeUrl(input.sourceUrl);
  if (!agent || !content) {
    state.rejected++;
    return {ok:false,error:'MEMORY_AGENT_AND_CONTENT_REQUIRED'};
  }
  if (!AGENT_MEMORY_LAYERS.includes(layer) || !SOURCE_LAYERS[source]?.includes(layer)) {
    state.rejected++;
    return {ok:false,error:'MEMORY_LAYER_SOURCE_MISMATCH'};
  }
  if (source === 'VERIFIED_EVIDENCE' && !sourceUrl) {
    state.rejected++;
    return {ok:false,error:'VERIFIED_EVIDENCE_REQUIRES_SOURCE_URL'};
  }
  if (source === 'APPROVED_PROCEDURE' && input.metadata?.humanApproved !== true) {
    state.rejected++;
    return {ok:false,error:'APPROVED_PROCEDURE_REQUIRES_HUMAN_APPROVAL'};
  }
  const metadata = safeMetadata(input.metadata);
  if (source === 'VERIFIED_OUTCOME') {
    const validOutcome = Boolean(metadata.provider && metadata.sourceAsOf && metadata.decisionId &&
      Number(metadata.horizonMinutes) > 0 && Number(metadata.referencePrice) > 0 &&
      Number.isFinite(Number(metadata.actualReturnPct)) && Number.isFinite(Number(metadata.brierScore)) &&
      Number.isFinite(Number(metadata.logLoss)) &&
      ['UP','DOWN','HOLD'].includes(String(metadata.outcome).toUpperCase()));
    if (!validOutcome) {
      state.rejected++;
      return {ok:false,error:'VERIFIED_OUTCOME_REQUIRES_PROVIDER_TIMESTAMP_AND_SETTLED_METRICS'};
    }
  }
  const observedAt = currentDate(input.observedAt).toISOString();
  const defaultRetention = RETENTION_MS[layer];
  const expiresAt = input.expiresAt
    ? currentDate(input.expiresAt).toISOString()
    : defaultRetention == null ? null : new Date(Date.parse(observedAt) + defaultRetention).toISOString();
  const row = {
    id: 'mem_' + randomUUID(),
    agent,layer,source,content,decision,sourceUrl,observedAt,expiresAt,
    verificationStatus: VERIFICATION[source],
    metadata
  };
  row.fingerprint = dedupeFingerprint(row);
  const duplicate = state.records.find(item => item.fingerprint === row.fingerprint);
  if (duplicate) {
    state.duplicatesSuppressed++;
    return {ok:true,duplicate:true,record:publicRecord(duplicate),persistent:state.persistent,persistence:state.persistence};
  }
  state.records.unshift(row);
  state.records.splice(MAX_IN_MEMORY);
  const pool = await ensureStorage();
  if (pool && state.schemaReady) {
    try {
      const result = await pool.query(
        'INSERT INTO finpilot_agent_memory_ledger(id,fingerprint,agent,layer,source,content,decision,source_url,observed_at,expires_at,verification_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (fingerprint) DO NOTHING RETURNING id',
        [row.id,row.fingerprint,row.agent,row.layer,row.source,row.content,row.decision,row.sourceUrl,row.observedAt,row.expiresAt,row.verificationStatus,JSON.stringify(row.metadata)]
      );
      if (!result.rowCount) {
        state.duplicatesSuppressed++;
        return {ok:true,duplicate:true,record:publicRecord(row),persistent:true,persistence:'POSTGRES'};
      }
      return {ok:true,duplicate:false,record:publicRecord(row),persistent:true,persistence:'POSTGRES'};
    } catch (error) {
      state.writeFailures++;
      state.persistence = 'DATABASE_ERROR';
      state.persistent = false;
      state.detail = 'Agent memory database write failed; only in-process fallback is available (' + clean(error?.message || 'write failed', 120) + ').';
    }
  }
  return {ok:true,duplicate:false,record:publicRecord(row),persistent:false,persistence:state.persistence};
}

export async function getAgentMemorySnapshot(options = {}) {
  const limit = Math.max(1, Math.min(MAX_RETURNED, Math.floor(Number(options.limit) || 20)));
  const pool = await ensureStorage();
  if (pool && state.schemaReady) {
    try {
      const [counts, rows, totals] = await Promise.all([
        pool.query('SELECT layer,COUNT(*)::int AS count FROM finpilot_agent_memory_ledger WHERE expires_at IS NULL OR expires_at>NOW() GROUP BY layer'),
        pool.query('SELECT id,agent,layer,source,content,decision,source_url AS "sourceUrl",observed_at AS "observedAt",expires_at AS "expiresAt",verification_status AS "verificationStatus",metadata FROM finpilot_agent_memory_ledger WHERE expires_at IS NULL OR expires_at>NOW() ORDER BY observed_at DESC LIMIT $1',[limit]),
        pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE source='CLIENT_REPORTED_UNVERIFIED')::int AS unverified,
          COUNT(*) FILTER (WHERE source='SERVER_EXECUTED')::int AS server_executed,
          COUNT(*) FILTER (WHERE layer='OUTCOME')::int AS outcomes
          FROM finpilot_agent_memory_ledger WHERE expires_at IS NULL OR expires_at>NOW()`)
      ]);
      const layerCounts = Object.fromEntries(AGENT_MEMORY_LAYERS.map(x => [x,0]));
      for (const row of counts.rows) if (layerCounts[row.layer] !== undefined) layerCounts[row.layer] = Number(row.count || 0);
      return {
        ok:true,version:AGENT_MEMORY_LEDGER_VERSION,persistence:state.persistence,persistent:true,
        persistenceDetail:state.detail,layerCounts,records:rows.rows.map(row => publicRecord({
          ...row,sourceUrl:row.sourceUrl,
          metadata:typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata
        })),
        totalRecords:Number(totals.rows[0]?.total||0),
        unverifiedClientRecords:Number(totals.rows[0]?.unverified||0),
        serverExecutedRecords:Number(totals.rows[0]?.server_executed||0),
        verifiedOutcomeRecords:Number(totals.rows[0]?.outcomes||0),
        duplicatesSuppressed:state.duplicatesSuppressed,rejected:state.rejected,writeFailures:state.writeFailures,
        retentionPolicy:{EPISODIC_DAYS:180,SEMANTIC_DAYS:365,PROCEDURAL_DAYS:365,OUTCOME:'retain until explicit retention review'}
      };
    } catch (error) {
      state.persistence='DATABASE_ERROR';state.persistent=false;
      state.detail='Agent memory read failed; process-memory entries are shown instead ('+clean(error?.message||'read failed',120)+').';
    }
  }
  const active = state.records.filter(row => !row.expiresAt || Date.parse(row.expiresAt) > Date.now());
  const layerCounts = Object.fromEntries(AGENT_MEMORY_LAYERS.map(x => [x,active.filter(row => row.layer===x).length]));
  return {
    ok:true,version:AGENT_MEMORY_LEDGER_VERSION,persistence:state.persistence,persistent:false,
    persistenceDetail:state.detail,layerCounts,records:active.slice(0,limit).map(publicRecord),
    totalRecords:active.length,
    unverifiedClientRecords:active.filter(row=>row.source==='CLIENT_REPORTED_UNVERIFIED').length,
    serverExecutedRecords:active.filter(row=>row.source==='SERVER_EXECUTED').length,
    verifiedOutcomeRecords:active.filter(row=>row.layer==='OUTCOME'&&row.source==='VERIFIED_OUTCOME').length,
    duplicatesSuppressed:state.duplicatesSuppressed,rejected:state.rejected,writeFailures:state.writeFailures,
    retentionPolicy:{EPISODIC_DAYS:180,SEMANTIC_DAYS:365,PROCEDURAL_DAYS:365,OUTCOME:'retain until explicit retention review'}
  };
}

export async function resetAgentMemoryLedgerForTests(options = {}) {
  state.getPool = async () => null;
  state.databaseConfigured = () => false;
  state.pool = null;state.initPromise = null;state.schemaReady = false;
  state.persistence = 'PROCESS_MEMORY';state.persistent = false;
  state.detail = 'Test-only in-memory ledger.';
  state.records = [];state.duplicatesSuppressed = 0;state.rejected = 0;state.writeFailures = 0;
  if (options.getPool && typeof options.getPool === 'function') state.getPool = options.getPool;
  if (options.databaseConfigured === true) state.databaseConfigured = () => true;
}
