import express from 'express';
import cors from 'cors';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '2.3.0';
const NOTION_TOKEN   = process.env.NOTION_TOKEN   || '';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '336a3e42e9f180e59794e22a4a7fb751';
let   NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '';

// ══════════════════════════════════════════════
//  ESTRAZIONE TESTO ARTICOLO
// ══════════════════════════════════════════════
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
];

async function estraiTestoArticolo(url) {
  for (const ua of USER_AGENTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        signal:  controller.signal,
        headers: {
          'User-Agent':      ua,
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          'Cache-Control':   'no-cache'
        }
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const html = await res.text();
      if (!html || html.length < 500) continue;

      const dom     = new JSDOM(html, { url });
      const reader  = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article || !article.textContent || article.textContent.trim().length < 150) continue;

      const testo = article.textContent
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      const testoCropato = testo.length > 8000
        ? testo.slice(0, 8000) + '\n\n[testo troncato]'
        : testo;

      console.log(`[Scraper] ✅ ${url} → ${testoCropato.length} caratteri`);
      return { ok: true, titolo: article.title || '', testo: testoCropato };

    } catch (e) {
      console.warn(`[Scraper] ${e.message}`);
    }
  }
  return { ok: false, testo: '', motivo: 'Pagina non accessibile' };
}

// ══════════════════════════════════════════════
//  NOTION API HELPER
// ══════════════════════════════════════════════
async function notionRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization':  `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res  = await fetch(`https://api.notion.com/v1${endpoint}`, options);
  const data = await res.json();
  if (!res.ok || data.object === 'error') throw new Error(data.message || `Notion error ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════
//  AGGIORNA SCHEMA DATABASE
//  Aggiunge le proprietà mancanti a un database
//  già esistente — senza toccare i dati
// ══════════════════════════════════════════════
async function aggiornaSchemaDatabaseSeNecessario(dbId) {
  const db = await notionRequest(`/databases/${dbId}`);
  const props = db.properties || {};

  const proprieta_necessarie = {
    'Contenuto estratto': { rich_text: {} },
    'Testo elaborato':    { rich_text: {} },
    'Fonte':              { rich_text: {} },
    'Data originale':     { rich_text: {} },
    'Article ID':         { rich_text: {} },
    'URL originale':      { url: {} },
    'Inviato il':         { date: {} },
    'Status': {
      select: {
        options: [
          { name: 'In attesa',     color: 'yellow' },
          { name: 'Pronto',        color: 'green'  },
          { name: 'Inaccessibile', color: 'red'    },
          { name: 'Elaborato',     color: 'blue'   },
          { name: 'Pubblicato',    color: 'purple' }
        ]
      }
    }
  };

  // Costruisci solo le proprietà mancanti
  const da_aggiungere = {};
  for (const [nome, schema] of Object.entries(proprieta_necessarie)) {
    if (!props[nome]) {
      da_aggiungere[nome] = schema;
      console.log(`[Notion] Aggiungo proprietà mancante: "${nome}"`);
    }
  }

  if (Object.keys(da_aggiungere).length > 0) {
    await notionRequest(`/databases/${dbId}`, 'PATCH', {
      properties: da_aggiungere
    });
    console.log(`[Notion] Schema aggiornato con ${Object.keys(da_aggiungere).length} proprietà.`);
  } else {
    console.log(`[Notion] Schema già completo.`);
  }
}

// ══════════════════════════════════════════════
//  TROVA O CREA DATABASE
// ══════════════════════════════════════════════
async function getOrCreateDatabase() {
  // 1. Usa ID da env o memoria
  if (NOTION_DATABASE_ID) {
    try {
      await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
      // Verifica e aggiorna lo schema se necessario
      await aggiornaSchemaDatabaseSeNecessario(NOTION_DATABASE_ID);
      return NOTION_DATABASE_ID;
    } catch {
      console.warn('[Notion] Database ID non valido, cerco tra i figli...');
      NOTION_DATABASE_ID = '';
    }
  }

  // 2. Cerca tra i figli della pagina
  try {
    const children = await notionRequest(`/blocks/${NOTION_PAGE_ID}/children?page_size=100`);
    for (const block of children.results) {
      if (block.type === 'child_database') {
        try {
          const db    = await notionRequest(`/databases/${block.id}`);
          const title = db.title?.[0]?.text?.content || '';
          if (title.includes('NewsRadar')) {
            NOTION_DATABASE_ID = block.id;
            console.log(`[Notion] Database trovato: ${block.id}`);
            // Aggiorna schema se ha proprietà mancanti
            await aggiornaSchemaDatabaseSeNecessario(NOTION_DATABASE_ID);
            return NOTION_DATABASE_ID;
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.warn('[Notion] Errore ricerca figli:', e.message);
  }

  // 3. Crea nuovo con schema completo
  console.log('[Notion] Creo database con schema completo...');
  const db = await notionRequest('/databases', 'POST', {
    parent: { page_id: NOTION_PAGE_ID },
    title:  [{ type: 'text', text: { content: '📰 NewsRadar — Articoli' } }],
    icon:   { emoji: '📰' },
    properties: {
      'Titolo':               { title: {} },
      'Status': {
        select: {
          options: [
            { name: 'In attesa',     color: 'yellow' },
            { name: 'Pronto',        color: 'green'  },
            { name: 'Inaccessibile', color: 'red'    },
            { name: 'Elaborato',     color: 'blue'   },
            { name: 'Pubblicato',    color: 'purple' }
          ]
        }
      },
      'URL originale':        { url: {} },
      'Fonte':                { rich_text: {} },
      'Data originale':       { rich_text: {} },
      'Contenuto estratto':   { rich_text: {} },
      'Testo elaborato':      { rich_text: {} },
      'Inviato il':           { date: {} },
      'Article ID':           { rich_text: {} }
    }
  });

  NOTION_DATABASE_ID = db.id;
  console.log(`[Notion] Database creato: ${db.id}`);
  return NOTION_DATABASE_ID;
}

// ══════════════════════════════════════════════
//  AGGIUNGE ARTICOLI — con scraping automatico
// ══════════════════════════════════════════════
async function aggiungiArticoliAlDatabase(articoli) {
  const dbId      = await getOrCreateDatabase();
  const risultati = [];

  for (const a of articoli) {
    console.log(`[Scraper] Estraggo: ${a.titolo}`);
    const scraped = await estraiTestoArticolo(a.url);
    const status  = scraped.ok ? 'Pronto' : 'Inaccessibile';

    // Spezza il testo in chunk da 2000 caratteri (limite Notion)
    const testo   = scraped.testo || scraped.motivo || '';
    const chunks  = [];
    for (let i = 0; i < testo.length; i += 2000) {
      chunks.push({ text: { content: testo.slice(i, i + 2000) } });
    }
    const contenutoNotion = chunks.length > 0
      ? chunks.slice(0, 100)
      : [{ text: { content: '' } }];

    const page = await notionRequest('/pages', 'POST', {
      parent:     { database_id: dbId },
      properties: {
        'Titolo':             { title:     [{ text: { content: a.titolo || '' } }] },
        'Status':             { select:    { name: status } },
        'URL originale':      { url:       a.url  || null },
        'Fonte':              { rich_text: [{ text: { content: a.fonte || '' } }] },
        'Data originale':     { rich_text: [{ text: { content: a.data  || '' } }] },
        'Contenuto estratto': { rich_text: contenutoNotion },
        'Testo elaborato':    { rich_text: [{ text: { content: '' } }] },
        'Inviato il':         { date:      { start: new Date().toISOString() } },
        'Article ID':         { rich_text: [{ text: { content: a.articleId || '' } }] }
      }
    });

    risultati.push({
      notionPageId: page.id,
      notionUrl:    page.url,
      titolo:       a.titolo,
      articleId:    a.articleId,
      scraped:      scraped.ok,
      caratteri:    testo.length
    });

    console.log(`[Notion] ✅ "${a.titolo}" → ${status} (${testo.length} car.)`);
  }

  return { dbId, risultati };
}

// ══════════════════════════════════════════════
//  AGGIORNA ARTICOLO
// ══════════════════════════════════════════════
async function aggiornaArticolo(notionPageId, { status, testoElaborato }) {
  const properties = {};
  if (status) {
    properties['Status'] = { select: { name: status } };
  }
  if (testoElaborato) {
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
//  LEGGI ARTICOLI PRONTI
// ══════════════════════════════════════════════
async function leggiArticoliInAttesa() {
  const dbId = await getOrCreateDatabase();

  const res = await notionRequest(`/databases/${dbId}/query`, 'POST', {
    filter: {
      or: [
        { property: 'Status', select: { equals: 'Pronto' } },
        { property: 'Status', select: { equals: 'In attesa' } }
      ]
    },
    sorts: [{ property: 'Inviato il', direction: 'descending' }]
  });

  return res.results.map(page => {
    const chunks    = page.properties['Contenuto estratto']?.rich_text || [];
    const contenuto = chunks.map(c => c.text?.content || '').join('');
    return {
      notionPageId: page.id,
      titolo:       page.properties['Titolo']?.title?.[0]?.text?.content             || '',
      url:          page.properties['URL originale']?.url                             || '',
      fonte:        page.properties['Fonte']?.rich_text?.[0]?.text?.content          || '',
      data:         page.properties['Data originale']?.rich_text?.[0]?.text?.content || '',
      articleId:    page.properties['Article ID']?.rich_text?.[0]?.text?.content     || '',
      contenuto
    };
  });
}

// ══════════════════════════════════════════════
//  MCP TOOLS
// ══════════════════════════════════════════════
const TOOLS = [
  {
    name: 'invia_articoli',
    description: 'Aggiunge articoli da NewsRadar al database Notion estraendo automaticamente il testo completo.',
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
    name: 'leggi_articoli_pronti',
    description: 'Restituisce gli articoli pronti con il testo già estratto. Usa il campo "contenuto" invece di web_fetch.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'aggiorna_articolo',
    description: 'Aggiorna un articolo con il testo elaborato e lo status.',
    inputSchema: {
      type: 'object',
      properties: {
        notionPageId:   { type: 'string' },
        testoElaborato: { type: 'string' },
        status:         { type: 'string', enum: ['In attesa', 'Pronto', 'Inaccessibile', 'Elaborato', 'Pubblicato'] }
      },
      required: ['notionPageId']
    }
  }
];

async function executeTool(name, args) {
  // Retrocompatibilità
  if (name === 'leggi_articoli_in_attesa') name = 'leggi_articoli_pronti';

  if (name === 'invia_articoli') {
    const { articoli } = args;
    if (!articoli || articoli.length === 0)
      return { content: [{ type: 'text', text: 'Errore: nessun articolo.' }], isError: true };
    const r    = await aggiungiArticoliAlDatabase(articoli);
    const lista = r.risultati.map(x =>
      `- ${x.titolo} → ${x.scraped ? `✅ ${x.caratteri} car.` : '❌ non accessibile'}`
    ).join('\n');
    return { content: [{ type: 'text', text: `✅ ${articoli.length} articoli elaborati:\n${lista}` }] };
  }

  if (name === 'leggi_articoli_pronti') {
    const articoli = await leggiArticoliInAttesa();
    if (articoli.length === 0)
      return { content: [{ type: 'text', text: 'Nessun articolo pronto.' }] };
    const lista = articoli.map((a, i) => {
      const anteprima = a.contenuto
        ? `\n   📄 ${a.contenuto.length} caratteri disponibili`
        : '\n   ⚠️  Nessun contenuto estratto';
      return `${i + 1}. ${a.titolo}\n   ID: ${a.notionPageId}\n   URL: ${a.url}${anteprima}`;
    }).join('\n\n');
    return { content: [{ type: 'text', text: `📋 ${articoli.length} articoli:\n\n${lista}` }] };
  }

  if (name === 'aggiorna_articolo') {
    const { notionPageId, testoElaborato, status } = args;
    if (!notionPageId)
      return { content: [{ type: 'text', text: 'Errore: notionPageId mancante.' }], isError: true };
    await aggiornaArticolo(notionPageId, { status: status || 'Elaborato', testoElaborato });
    return { content: [{ type: 'text', text: `✅ Aggiornato — Status: ${status || 'Elaborato'}` }] };
  }

  return { content: [{ type: 'text', text: `Tool "${name}" non trovato.` }], isError: true };
}

// ══════════════════════════════════════════════
//  MCP PROTOCOL
// ══════════════════════════════════════════════
function mcpResponse(id, result)     { return { jsonrpc: '2.0', id, result }; }
function mcpError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function handleMessage(msg) {
  const { method, params, id } = msg;
  if (method === 'initialize')                return mcpResponse(id, { protocolVersion: '2025-03-26', serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }, capabilities: { tools: {} } });
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list')                return mcpResponse(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params;
    try   { return mcpResponse(id, await executeTool(name, toolArgs || {})); }
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
  notion: !!NOTION_TOKEN, database: NOTION_DATABASE_ID || 'cercato alla prima richiesta'
}));

app.post('/notion', async (req, res) => {
  try {
    const { articoli } = req.body;
    if (!articoli || !Array.isArray(articoli) || articoli.length === 0)
      return res.status(400).json({ ok: false, error: 'Nessun articolo.' });
    const risultato = await aggiungiArticoliAlDatabase(articoli);
    res.json({ ok: true, dbId: risultato.dbId, articoli: risultato.risultati });
  } catch (err) {
    console.error('[/notion]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/notion/:pageId', async (req, res) => {
  try {
    await aggiornaArticolo(req.params.pageId, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/notion/status/:articleId', async (req, res) => {
  try {
    const dbId   = await getOrCreateDatabase();
    const result = await notionRequest(`/databases/${dbId}/query`, 'POST', {
      filter: { property: 'Article ID', rich_text: { equals: req.params.articleId } }
    });
    if (result.results.length === 0) return res.json({ ok: true, status: null });
    const page = result.results[0];
    res.json({ ok: true, status: page.properties['Status']?.select?.name || null, notionPageId: page.id, notionUrl: page.url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const messages  = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];
  for (const msg of messages) { const r = await handleMessage(msg); if (r !== null) responses.push(r); }
  if (responses.length === 0)                             return res.status(204).end();
  if (responses.length === 1 && !Array.isArray(req.body)) return res.json(responses[0]);
  return res.json(responses);
});

app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connection' })}\n\n`);
  req.on('close', () => {});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 NewsRadar MCP Server v${SERVER_VERSION} — porta ${PORT}`);
  console.log(`   Notion token:  ${NOTION_TOKEN      ? '✅' : '❌ MANCANTE'}`);
  console.log(`   Database ID:   ${NOTION_DATABASE_ID || 'cercato automaticamente'}`);
  console.log(`   Scraping:      ✅ Readability attivo\n`);
});
