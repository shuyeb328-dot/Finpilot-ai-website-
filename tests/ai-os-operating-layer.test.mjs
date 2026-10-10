import assert from 'node:assert/strict';
import {createManagedAgent, listManagedAgents, getManagedAgentRegistrySnapshot, resetManagedAgentsForTests} from '../server/ai-os-operating-layer.mjs';

await resetManagedAgentsForTests();
const made = await createManagedAgent({
  name: 'Market Research Scout',
  role: 'Global market research and evidence verification',
  objective: 'Compare timestamped market sources, identify contradictions and state uncertainty.',
  icon: '🔎',
  interval: 15,
  permissions: ['market_data_read','public_research','decision_memory_read','execute_order','api_key_read'],
  arbitraryCode: 'process.env.SECRET = "do-not-run"'
});
assert.equal(made.ok, true);
assert.equal(made.agent.name, 'Market Research Scout');
assert.equal(made.agent.domain, 'MARKETS');
assert.equal(made.agent.executionMode, 'USER_TRIGGERED_ONLY');
assert.equal(made.agent.automaticExecution, false);
assert.equal(made.agent.liveTrading, false);
assert.equal(made.agent.humanApprovalRequired, true);
assert.deepEqual(made.agent.permissions, ['market_data_read','public_research','decision_memory_read']);
assert.equal(made.persistence, 'PROCESS_MEMORY');
assert.match(made.note, /does not schedule background runs/);
assert.equal(Object.hasOwn(made.agent, 'arbitraryCode'), false);

const duplicate = await createManagedAgent({name:'Market Research Scout',role:'Research'});
assert.equal(duplicate.ok, false);
assert.equal(duplicate.status, 409);

const invalidInterval = await createManagedAgent({name:'Bad Interval',role:'Research',interval:1441});
assert.equal(invalidInterval.ok, false);
assert.equal(invalidInterval.error, 'AGENT_INTERVAL_OUT_OF_RANGE');

const malformed = await createManagedAgent([]);
assert.equal(malformed.ok, false);
assert.equal(malformed.error, 'AGENT_JSON_OBJECT_REQUIRED');

const list = await listManagedAgents();
assert.equal(list.count, 1);
assert.equal(list.agents[0].id, made.agent.id);
assert.equal(list.policy.automaticExecution, false);
assert.equal(list.policy.liveTrading, false);

const status = await getManagedAgentRegistrySnapshot();
assert.equal(status.count, 1);
assert.equal(status.persistent, false);
assert.equal(status.persistence, 'PROCESS_MEMORY');

console.log('PASS AI OS Agent Factory: bounded agent definitions, permission allowlist, duplicate guard, explicit non-execution and storage status');
