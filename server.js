import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '1.0.0';

const NOTION_TOKEN   = process.env.NOTION_TOKEN || '';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '336a3e42e9f180e59794e22a4a7fb751';

// ══════════════════════════════════════════════
//  NOTION HELPER — scrive solo gli articoli,
//  niente istruzioni (il prompt sta su Cowork)
// ══════════════════════════════════════════════
async function scriviSuNotion(articoli) {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN non configurato su Render.');

  const dataOggi = new Date().toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const blocchi = [];

  // Un blocco per ogni articolo — solo dati, niente istruzioni
  for (let i = 0; i < articoli.length; i++) {
    const a   = articoli[i];
    const num = String(i + 1).padStart(2, '0');

    // Titolo articolo
    blocchi.push({
      object: 'block', type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `${num}. ${a.titolo}` } }],
        color: 'default'
      }
    });

    // Meta info (fonte, data, descrizione)
    const metaParti = [];
    if (a.fonte)       metaParti.push(`Fonte: ${a.fonte}`);
    if (a.data)        metaParti.push(`Data: ${a.data}`);
    if (a.descrizione) metaParti.push(`${a.descrizione}`);

    if (metaParti.length) {
      blocchi.push({
        object: 'block', type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: metaParti.join(' · ') }, annotations: { color: 'gray' } }]
        }
      });
    }

    // URL
    blocchi.push({
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: 'URL: ' }, annotations: { bold: true } },
          { type: 'text', text: { content: a.url, link: { url: a.url } } }
        ]
      }
    });

    // Separatore tra articoli
    blocchi.push({ object: 'block', type: 'divider', divider: {} });
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      parent: { page_id: NOTION_PAGE_ID },
      properties: {
        title: { title: [{ text: { content: `NewsRadar — ${dataOggi} (${articoli.length} articoli)` } }] }
      },
      children: blocchi.slice(0, 100)
    })
  });

  const data = await res.json();
  if (!res.ok || data.object === 'error') throw new Error(data.message || `Notion API error ${res.status}`);
  return { paginaId: data.id, paginaUrl: data.url };
}

// ══════════════════════════════════════════════
//  MCP TOOLS
// ══════════════════════════════════════════════
const TOOLS = [
  {
    name: 'invia_notizie_a_cowork',
    description: 'Riceve articoli da NewsRadar e li scrive su Notion.',
    inputSchema: {
      type: 'object',
      properties: {
        articoli: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titolo:      { type: 'string' },
              descrizione: { type: 'string' },
              url:         { type: 'string' },
              fonte:       { type: 'string' },
              data:        { type: 'string' }
            },
            required: ['titolo', 'url']
          }
        }
      },
      required: ['articoli']
    }
  }
];

async function executeTool(name, args) {
  if (name === 'invia_notizie_a_cowork') {
    const { articoli } = args;
    if (!articoli || articoli.length === 0) {
      return { content: [{ type: 'text', text: 'Errore: nessun articolo ricevuto.' }], isError: true };
    }
    const risultato = await scriviSuNotion(articoli);
    return { content: [{ type: 'text', text: `✅ ${articoli.length} articoli su Notion: ${risultato.paginaUrl}` }] };
  }
  return { content: [{ type: 'text', text: `Tool "${name}" non trovato.` }], isError: true };
}

// ══════════════════════════════════════════════
//  MCP PROTOCOL
// ══════════════════════════════════════════════
function mcpResponse(id, result) { return { jsonrpc: '2.0', id, result }; }
function mcpError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function handleMessage(msg) {
  const { method, params, id } = msg;
  if (method === 'initialize') return mcpResponse(id, { protocolVersion: '2025-03-26', serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }, capabilities: { tools: {} } });
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return mcpResponse(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params;
    try { return mcpResponse(id, await executeTool(name, toolArgs || {})); }
    catch (e) { return mcpError(id, -32603, e.message); }
  }
  if (method === 'ping') return mcpResponse(id, {});
  return mcpError(id, -32601, `Method not found: ${method}`);
}

// ══════════════════════════════════════════════
//  HTTP ROUTES
// ══════════════════════════════════════════════
app.get('/', (req, res) => res.json({ server: SERVER_NAME, status: 'ok', notion: !!NOTION_TOKEN }));

app.post('/notion', async (req, res) => {
  try {
    const { articoli } = req.body;
    if (!articoli || !Array.isArray(articoli) || articoli.length === 0)
      return res.status(400).json({ ok: false, error: 'Nessun articolo ricevuto.' });
    const risultato = await scriviSuNotion(articoli);
    res.json({ ok: true, paginaUrl: risultato.paginaUrl, paginaId: risultato.paginaId });
  } catch (err) {
    console.error('[/notion]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];
  for (const msg of messages) { const r = await handleMessage(msg); if (r !== null) responses.push(r); }
  if (responses.length === 0) return res.status(204).end();
  if (responses.length === 1 && !Array.isArray(req.body)) return res.json(responses[0]);
  return res.json(responses);
});

app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connection' })}\n\n`);
  req.on('close', () => {});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 NewsRadar MCP Server — porta ${PORT}`);
  console.log(`   Notion token: ${NOTION_TOKEN ? '✅' : '❌ MANCANTE'}\n`);
});
