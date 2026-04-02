import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '2.0.0';
const NOTION_TOKEN   = process.env.NOTION_TOKEN || '';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '336a3e42e9f180e59794e22a4a7fb751';

// ID del database Notion — viene salvato in memoria dopo la prima creazione
// Su Render persiste finché il server non viene riavviato
let NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '';

// ══════════════════════════════════════════════
//  NOTION API HELPER
// ══════════════════════════════════════════════
async function notionRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, options);
  const data = await res.json();
  if (!res.ok || data.object === 'error') throw new Error(data.message || `Notion error ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════
//  CREA DATABASE (se non esiste)
// ══════════════════════════════════════════════
async function getOrCreateDatabase() {
  // Se abbiamo già l'ID, verifica che esista ancora
  if (NOTION_DATABASE_ID) {
    try {
      await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
      return NOTION_DATABASE_ID;
    } catch {
      NOTION_DATABASE_ID = ''; // database non trovato, lo ricreiamo
    }
  }

  console.log('[Notion] Creo il database NewsRadar...');

  const db = await notionRequest('/databases', 'POST', {
    parent: { page_id: NOTION_PAGE_ID },
    title: [{ type: 'text', text: { content: '📰 NewsRadar — Articoli' } }],
    icon: { emoji: '📰' },
    properties: {
      // Titolo principale (obbligatorio per ogni database Notion)
      'Titolo': { title: {} },

      // Status editoriale
      'Status': {
        select: {
          options: [
            { name: 'In attesa',  color: 'yellow' },
            { name: 'Elaborato',  color: 'green'  },
            { name: 'Pubblicato', color: 'blue'   }
          ]
        }
      },

      // URL dell'articolo originale
      'URL originale': { url: {} },

      // Fonte / testata
      'Fonte': { rich_text: {} },

      // Data pubblicazione originale
      'Data originale': { rich_text: {} },

      // Testo elaborato da Claude (l'articolo riscritto)
      'Testo elaborato': { rich_text: {} },

      // Data di invio dal sito
      'Inviato il': { date: {} },

      // ID univoco per collegare sito ↔ Notion
      'Article ID': { rich_text: {} }
    }
  });

  NOTION_DATABASE_ID = db.id;
  console.log(`[Notion] Database creato: ${db.id}`);
  return NOTION_DATABASE_ID;
}

// ══════════════════════════════════════════════
//  AGGIUNGE ARTICOLI AL DATABASE
// ══════════════════════════════════════════════
async function aggiungiArticoliAlDatabase(articoli) {
  const dbId = await getOrCreateDatabase();
  const risultati = [];

  for (const a of articoli) {
    const page = await notionRequest('/pages', 'POST', {
      parent: { database_id: dbId },
      properties: {
        'Titolo':          { title:     [{ text: { content: a.titolo || '' } }] },
        'Status':          { select:    { name: 'In attesa' } },
        'URL originale':   { url:       a.url || null },
        'Fonte':           { rich_text: [{ text: { content: a.fonte || '' } }] },
        'Data originale':  { rich_text: [{ text: { content: a.data  || '' } }] },
        'Testo elaborato': { rich_text: [{ text: { content: '' } }] },
        'Inviato il':      { date:      { start: new Date().toISOString() } },
        'Article ID':      { rich_text: [{ text: { content: a.articleId || '' } }] }
      }
    });

    risultati.push({
      notionPageId: page.id,
      notionUrl:    page.url,
      titolo:       a.titolo,
      articleId:    a.articleId
    });

    console.log(`[Notion] Aggiunto: ${a.titolo}`);
  }

  return { dbId, risultati };
}

// ══════════════════════════════════════════════
//  AGGIORNA STATUS E TESTO (chiamato da Cowork)
// ══════════════════════════════════════════════
async function aggiornaArticolo(notionPageId, { status, testoElaborato }) {
  const properties = {};

  if (status) {
    properties['Status'] = { select: { name: status } };
  }

  if (testoElaborato) {
    // Notion limita rich_text a 2000 caratteri per blocco — dividiamo se necessario
    const chunks = [];
    for (let i = 0; i < testoElaborato.length; i += 2000) {
      chunks.push({ text: { content: testoElaborato.slice(i, i + 2000) } });
    }
    properties['Testo elaborato'] = { rich_text: chunks.slice(0, 100) };
  }

  await notionRequest(`/pages/${notionPageId}`, 'PATCH', { properties });
  return { ok: true };
}

// ══════════════════════════════════════════════
//  LEGGI ARTICOLI DAL DATABASE (per Cowork)
// ══════════════════════════════════════════════
async function leggiArticoliInAttesa() {
  const dbId = await getOrCreateDatabase();

  const res = await notionRequest(`/databases/${dbId}/query`, 'POST', {
    filter: {
      property: 'Status',
      select: { equals: 'In attesa' }
    },
    sorts: [{ property: 'Inviato il', direction: 'descending' }]
  });

  return res.results.map(page => ({
    notionPageId: page.id,
    titolo:       page.properties['Titolo']?.title?.[0]?.text?.content || '',
    url:          page.properties['URL originale']?.url || '',
    fonte:        page.properties['Fonte']?.rich_text?.[0]?.text?.content || '',
    data:         page.properties['Data originale']?.rich_text?.[0]?.text?.content || '',
    articleId:    page.properties['Article ID']?.rich_text?.[0]?.text?.content || ''
  }));
}

// ══════════════════════════════════════════════
//  MCP TOOLS
// ══════════════════════════════════════════════
const TOOLS = [
  {
    name: 'invia_articoli',
    description: 'Aggiunge articoli selezionati da NewsRadar al database Notion con status "In attesa".',
    inputSchema: {
      type: 'object',
      properties: {
        articoli: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              articleId:   { type: 'string' },
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
  },
  {
    name: 'leggi_articoli_in_attesa',
    description: 'Restituisce tutti gli articoli con status "In attesa" dal database Notion, pronti per essere elaborati da Cowork.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'aggiorna_articolo',
    description: 'Aggiorna un articolo nel database Notion con il testo elaborato e cambia lo status a "Elaborato".',
    inputSchema: {
      type: 'object',
      properties: {
        notionPageId:    { type: 'string', description: 'ID della pagina Notion dell\'articolo' },
        testoElaborato:  { type: 'string', description: 'Testo dell\'articolo riscritto da Claude' },
        status:          { type: 'string', enum: ['In attesa', 'Elaborato', 'Pubblicato'], description: 'Nuovo status dell\'articolo' }
      },
      required: ['notionPageId']
    }
  }
];

async function executeTool(name, args) {
  if (name === 'invia_articoli') {
    const { articoli } = args;
    if (!articoli || articoli.length === 0)
      return { content: [{ type: 'text', text: 'Errore: nessun articolo.' }], isError: true };
    const risultato = await aggiungiArticoliAlDatabase(articoli);
    const lista = risultato.risultati.map(r => `- ${r.titolo}`).join('\n');
    return { content: [{ type: 'text', text: `✅ ${articoli.length} articoli aggiunti al database.\n\n${lista}` }] };
  }

  if (name === 'leggi_articoli_in_attesa') {
    const articoli = await leggiArticoliInAttesa();
    if (articoli.length === 0)
      return { content: [{ type: 'text', text: 'Nessun articolo in attesa di elaborazione.' }] };
    const lista = articoli.map((a, i) =>
      `${i + 1}. **${a.titolo}**\n   ID Notion: ${a.notionPageId}\n   URL: ${a.url}\n   Fonte: ${a.fonte}`
    ).join('\n\n');
    return { content: [{ type: 'text', text: `📋 ${articoli.length} articoli in attesa:\n\n${lista}` }] };
  }

  if (name === 'aggiorna_articolo') {
    const { notionPageId, testoElaborato, status } = args;
    if (!notionPageId)
      return { content: [{ type: 'text', text: 'Errore: notionPageId mancante.' }], isError: true };
    await aggiornaArticolo(notionPageId, { status: status || 'Elaborato', testoElaborato });
    return { content: [{ type: 'text', text: `✅ Articolo aggiornato — Status: ${status || 'Elaborato'}` }] };
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
app.get('/', (req, res) => res.json({
  server: SERVER_NAME, version: SERVER_VERSION, status: 'ok',
  notion: !!NOTION_TOKEN, database: NOTION_DATABASE_ID || 'verrà creato al primo invio'
}));

// Il sito invia articoli → li aggiunge al database
app.post('/notion', async (req, res) => {
  try {
    const { articoli } = req.body;
    if (!articoli || !Array.isArray(articoli) || articoli.length === 0)
      return res.status(400).json({ ok: false, error: 'Nessun articolo ricevuto.' });
    const risultato = await aggiungiArticoliAlDatabase(articoli);
    res.json({ ok: true, dbId: risultato.dbId, articoli: risultato.risultati });
  } catch (err) {
    console.error('[/notion]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Il sito aggiorna lo status di un articolo (es. "Pubblicato")
app.patch('/notion/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const { status, testoElaborato } = req.body;
    await aggiornaArticolo(pageId, { status, testoElaborato });
    res.json({ ok: true });
  } catch (err) {
    console.error('[/notion PATCH]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Leggi articoli per status (usato dal sito per aggiornare i badge)
app.get('/notion/status/:articleId', async (req, res) => {
  try {
    const dbId = await getOrCreateDatabase();
    const { articleId } = req.params;
    const result = await notionRequest(`/databases/${dbId}/query`, 'POST', {
      filter: { property: 'Article ID', rich_text: { equals: articleId } }
    });
    if (result.results.length === 0) return res.json({ ok: true, status: null });
    const page = result.results[0];
    res.json({
      ok: true,
      status:      page.properties['Status']?.select?.name || null,
      notionPageId: page.id,
      notionUrl:    page.url
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// MCP endpoint POST
app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];
  for (const msg of messages) { const r = await handleMessage(msg); if (r !== null) responses.push(r); }
  if (responses.length === 0) return res.status(204).end();
  if (responses.length === 1 && !Array.isArray(req.body)) return res.json(responses[0]);
  return res.json(responses);
});

// MCP SSE GET
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connection' })}\n\n`);
  req.on('close', () => {});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 NewsRadar MCP Server v${SERVER_VERSION} — porta ${PORT}`);
  console.log(`   Notion token:    ${NOTION_TOKEN    ? '✅' : '❌ MANCANTE'}`);
  console.log(`   Database ID:     ${NOTION_DATABASE_ID || 'verrà creato al primo invio'}\n`);
});
