import assert from 'node:assert/strict';
import {
  AGENT_MEMORY_LAYERS,
  recordAgentMemory,
  getAgentMemorySnapshot,
  resetAgentMemoryLedgerForTests
} from '../server/agent-memory-ledger.mjs';

await resetAgentMemoryLedgerForTests();
let x=await recordAgentMemory({
  agent:'Risk Guardian',layer:'EPISODIC',source:'SERVER_EXECUTED',
  content:'Checked drawdown and liquidity before recommendation.',
  decision:'WAIT',metadata:{domain:'risk',requestId:'test-1'}
});
assert.equal(x.ok,true);
assert.equal(x.persistent,false);
assert.equal(x.record.verificationStatus,'EXECUTION_RECORDED_NOT_OUTCOME_VERIFIED');
assert.ok(x.record.expiresAt,'episodic memory should have a retention expiry');

const duplicate=await recordAgentMemory({
  agent:'Risk Guardian',layer:'EPISODIC',source:'SERVER_EXECUTED',
  content:'Checked drawdown and liquidity before recommendation.',
  decision:'WAIT',observedAt:x.record.observedAt
});
assert.equal(duplicate.duplicate,true,'same-day identical memories should be deduplicated');

const client=await recordAgentMemory({
  agent:'Research',layer:'EPISODIC',source:'CLIENT_REPORTED_UNVERIFIED',
  content:'Token=do-not-store and a user-reported claim.'
});
assert.equal(client.ok,true);
assert.match(client.record.content,/token=\[REDACTED\]/i);
assert.equal(client.record.verificationStatus,'UNVERIFIED_CLIENT_TELEMETRY');

const badLayer=await recordAgentMemory({
  agent:'Client',layer:'OUTCOME',source:'CLIENT_REPORTED_UNVERIFIED',content:'Claimed win'
});
assert.equal(badLayer.ok,false);
assert.equal(badLayer.error,'MEMORY_LAYER_SOURCE_MISMATCH');

const fakeEvidence=await recordAgentMemory({
  agent:'Research',layer:'SEMANTIC',source:'VERIFIED_EVIDENCE',content:'Filing says ...'
});
assert.equal(fakeEvidence.ok,false);
assert.equal(fakeEvidence.error,'VERIFIED_EVIDENCE_REQUIRES_SOURCE_URL');

let snap=await getAgentMemorySnapshot();
assert.deepEqual(Object.keys(snap.layerCounts),AGENT_MEMORY_LAYERS);
assert.equal(snap.layerCounts.EPISODIC,2);
assert.equal(snap.layerCounts.OUTCOME,0);
assert.equal(snap.unverifiedClientRecords,1);
assert.equal(snap.serverExecutedRecords,1);
assert.equal(snap.persistent,false);
assert.match(snap.persistenceDetail,/process-memory/i);

// Verify persistence via a bounded fake PostgreSQL adapter without external services.
const rows=[];
const fakePool={
  async query(sql,args=[]){
    if(sql.startsWith('CREATE TABLE')||sql.startsWith('CREATE INDEX'))return {rows:[],rowCount:0};
    if(sql.startsWith('INSERT INTO finpilot_agent_memory_ledger')){
      const [id,fingerprint,agent,layer,source,content,decision,sourceUrl,observedAt,expiresAt,verificationStatus,metadata]=args;
      if(rows.some(r=>r.fingerprint===fingerprint))return {rows:[],rowCount:0};
      rows.unshift({id,fingerprint,agent,layer,source,content,decision,source_url:sourceUrl,observed_at:observedAt,expires_at:expiresAt,verification_status:verificationStatus,metadata:JSON.parse(metadata)});
      return {rows:[{id}],rowCount:1};
    }
    if(sql.includes('SELECT layer,COUNT(*)')){
      const m={};for(const r of rows)m[r.layer]=(m[r.layer]||0)+1;
      return {rows:Object.entries(m).map(([layer,count])=>({layer,count})),rowCount:Object.keys(m).length};
    }
    if(sql.includes('SELECT COUNT(*)::int AS total')){
      return {rows:[{total:rows.length,unverified:rows.filter(r=>r.source==='CLIENT_REPORTED_UNVERIFIED').length,server_executed:rows.filter(r=>r.source==='SERVER_EXECUTED').length,outcomes:rows.filter(r=>r.layer==='OUTCOME').length}],rowCount:1};
    }
    if(sql.includes('ORDER BY observed_at DESC LIMIT')){
      return {rows:rows.slice(0,Number(args[0]||10)).map(r=>({
        id:r.id,agent:r.agent,layer:r.layer,source:r.source,content:r.content,decision:r.decision,
        sourceUrl:r.source_url,observedAt:r.observed_at,expiresAt:r.expires_at,
        verificationStatus:r.verification_status,metadata:r.metadata
      })),rowCount:rows.length};
    }
    throw new Error('Unexpected SQL in test adapter: '+sql);
  }
};
await resetAgentMemoryLedgerForTests({getPool:async()=>fakePool,databaseConfigured:true});
const persisted=await recordAgentMemory({
  agent:'Market Sentinel',layer:'EPISODIC',source:'SERVER_EXECUTED',
  content:'Two providers reported matching prices.',decision:'Continue analysis.'
});
assert.equal(persisted.persistent,true);
snap=await getAgentMemorySnapshot();
assert.equal(snap.persistent,true);
assert.equal(snap.persistence,'POSTGRES');
assert.equal(snap.totalRecords,1);
assert.equal(snap.records[0].agent,'Market Sentinel');

console.log('Agent memory ledger: layer/source allowlist, secret redaction, dedupe, retention and truthful persistence status passed.');
