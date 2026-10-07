import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function systemPrompt() {
  return `You are FinPilot AI, a cautious financial decision-support system. You are not a licensed financial adviser. Use the supplied user state only. Do not invent balances, market facts, laws, tax rates, or sources. Separate facts from assumptions. For high-impact actions recommend user approval. Return JSON only with: verdict (string), confidence (0-100 number), summary (string), views (array of {agent,view}), risks (array of strings), actions (array of strings). Debate the decision as CFO, Risk, Debt, Goals, Investment, Tax, Security, Markets, Business and Assets, then act as a Judge/CEO. If data is missing, say so.`;
}

async function callOpenAI(input) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the gateway');
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt() }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }
      ],
      text: { format: { type: 'json_object' } }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${r.status}`);
  const text = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text || '{}';
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/ai') return send(res, 404, { error: 'Not found' });
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      if (body.task === 'health') return send(res, 200, { ok: true, providerConfigured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL });
      if (body.task !== 'round_table') return send(res, 400, { error: 'Unsupported task' });
      const result = await callOpenAI(body.payload || {});
      return send(res, 200, result);
    } catch (e) {
      return send(res, 502, { error: e.message || 'AI gateway error' });
    }
  });
});

server.listen(PORT, () => console.log(`FinPilot AI gateway listening on :${PORT}`));
