import express from 'express';
import cors from 'cors';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '2.2.0';
const NOTION_TOKEN   = process.env.NOTION_TOKEN   || '';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '336a3e42e9f180e59794e22a4a7fb751';
let   NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '';

// ══════════════════════════════════════════════
//  ESTRAZIONE TESTO ARTICOLO
//  Usa @mozilla/readability — stessa tecnologia
//  della modalità lettura di Firefox.
//  Risultato: solo testo pulito, zero HTML/ads/menu
// ══════════════════════════════════════════════

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
];

async function estraiTestoArticolo(url) {
  // Prova con diversi User-Agent in sequenza
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
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control':   'no-cache'
        }
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[Scraper] ${url} → HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      if (!html || html.length < 500) continue;

      // Estrai con Readability
      const dom     = new JSDOM(html, { url });
      const reader  = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article || !article.textContent || article.textContent.trim().length < 150) {
        console.warn(`[Scraper] ${url} → Readability non ha estratto testo sufficiente`);
        continue;
      }

      // Pulisci il testo: rimuovi spazi multipli e righe vuote eccessive
      const testo = article.textContent
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      // Tronca a 8000 caratteri — sufficiente per qualsiasi articolo
      // Claude non ha bisogno di più per scrivere un riassunto
      const testoCropato = testo.length > 8000
        ? testo.slice(0, 8000) + '\n\n[testo troncato — continua sull\'articolo originale]'
        : testo;

      console.log(`[Scraper] ✅ ${url} → ${testoCropato.length} caratteri estratti`);
      return {
        ok:      true,
        titolo:  article.title    || '',
        autore:  article.byline   || '',
        testo:   testoCropato,
        estratto: article.excerpt || ''
      };

    } catch (e) {
      console.warn(`[Scraper] ${url} con UA ${ua.slice(0, 30)}... → ${e.message}`);
    }
  }

  // Tutti i tentativi falliti
  return { ok: false, testo: '', motivo: 'Pagina non accessibile (paywall, errore, o blocco)' };
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
//  TROVA O CREA DATABASE
// ══════════════════════════════════════════════
async function getOrCreateDatabase() {
  if (NOTION_DATABASE_ID) {
    try {
      await notionRequest(`/databases/${NOTION_DATABASE_ID}`);
      return NOTION_DATABASE_ID;
    } catch {
      console.warn('[Notion] Database ID non valido, cerco...');
      NOTION_DATABASE_ID = '';
    }
  }

  // Cerca tra i figli della pagina padre
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
            return NOTION_DATABASE_ID;
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.warn('[Notion] Errore ricerca figli:', e.message);
  }

  // Crea nuovo
  console.log('[Notion] Creo database...');
  const db = await notionRequest('/databases', 'POST', {
    parent: { page_id: NOTION_PAGE_ID },
    title:  [{ type: 'text', text: { content: '📰 NewsRadar — Articoli' } }],
    icon:   { emoji: '📰' },
    properties: {
      'Titolo':           { title: {} },
      'Status': {
        select: {
          options: [
            { name: 'In attesa',    color: 'yellow' },
            { name: 'In scraping',  color: 'orange' },
            { name: 'Pronto',       color: 'green'  },
            { name: 'Inaccessibile',color: 'red'    },
            { name: 'Elaborato',    color: 'blue'   },
            { name: 'Pubblicato',   color: 'purple' }
          ]
        }
      },
      'URL originale':    { url: {} },
      'Fonte':            { rich_text: {} },
      'Data originale':   { rich_text: {} },
      // ← NUOVO: testo già estratto — Claude non deve più navigare l'URL
      'Contenuto estratto': { rich_text: {} },
      'Testo elaborato':  { rich_text: {} },
      'Inviato il':       { date: {} },
      'Article ID':       { rich_text: {} }
    }
  });

  NOTION_DATABASE_ID = db.id;
  console.log(`[Notion] Database creato: ${db.id}`);
  console.log(`[Notion] ⚠️  Aggiungi su Render: NOTION_DATABASE_ID=${db.id}`);
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

    // Estrai il testo dell'articolo prima di salvarlo su Notion
    const scraped = await estraiTestoArticolo(a.url);

    const status = scraped.ok ? 'Pronto' : 'Inaccessibile';

    // Notion limita rich_text a 2000 caratteri per blocco
    const contenutoChunks = [];
    const testo = scraped.testo || '';
    for (let i = 0; i < testo.length; i += 2000) {
      contenutoChunks.push({ text: { content: testo.slice(i, i + 2000) } });
    }
    // Max 100 blocchi = 200.000 caratteri — più che sufficiente
    const contenutoNotion = contenutoChunks.slice(0, 100);

    const page = await notionRequest('/pages', 'POST', {
      parent:     { database_id: dbId },
      properties: {
        'Titolo':             { title:     [{ text: { content: a.titolo || '' } }] },
        'Status':             { select:    { name: status } },
        'URL originale':      { url:       a.url  || null },
        'Fonte':              { rich_text: [{ text: { content: a.fonte || '' } }] },
        'Data originale':     { rich_text: [{ text: { content: a.data  || '' } }] },
        'Contenuto estratto': { rich_text: contenutoNotion.length > 0 ? contenutoNotion : [{ text: { content: scraped.motivo || '' } }] },
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

    console.log(`[Notion] Salvato: ${a.titolo} (${status}, ${testo.length} caratteri)`);
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
//  LEGGI ARTICOLI PRONTI (status = "Pronto")
//  Claude non deve più navigare URL — legge solo
//  il "Contenuto estratto" già pronto su Notion
// ══════════════════════════════════════════════
async function leggiArticoliInAttesa() {
  const dbId = await getOrCreateDatabase();

  // Leggi sia "Pronto" che "In attesa" (retrocompatibilità)
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
    // Ricostruisci il contenuto estratto dai chunk
    const chunks  = page.properties['Contenuto estratto']?.rich_text || [];
    const contenuto = chunks.map(c => c.text?.content || '').join('');

    return {
      notionPageId: page.id,
      titolo:       page.properties['Titolo']?.title?.[0]?.text?.content            || '',
      url:          page.properties['URL originale']?.url                            || '',
      fonte:        page.properties['Fonte']?.rich_text?.[0]?.text?.content         || '',
      data:         page.properties['Data originale']?.rich_text?.[0]?.text?.content || '',
      articleId:    page.properties['Article ID']?.rich_text?.[0]?.text?.content    || '',
      // ← IL TESTO GIÀ ESTRATTO — Claude usa questo, non web_fetch
      contenuto:    contenuto
    };
  });
}

// ══════════════════════════════════════════════
//  MCP TOOLS
// ══════════════════════════════════════════════
const TOOLS = [
  {
    name: 'invia_articoli',
    description: 'Aggiunge articoli da NewsRadar al database Notion. Il server estrae automaticamente il testo completo di ogni articolo prima di salvarlo — Claude non dovrà navigare gli URL.',
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
    name: 'leggi_articoli_pronti',
    description: 'Restituisce gli articoli pronti per l\'elaborazione dal database Notion. Ogni articolo include il testo completo già estratto — usa questo testo per scrivere l\'articolo senza chiamare web_fetch.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'aggiorna_articolo',
    description: 'Aggiorna un articolo nel database Notion con il testo elaborato e cambia lo status.',
    inputSchema: {
      type: 'object',
      properties: {
        notionPageId:   { type: 'string', description: 'ID della pagina Notion' },
        testoElaborato: { type: 'string', description: 'Testo dell\'articolo riscritto' },
        status:         { type: 'string', enum: ['In attesa', 'Pronto', 'Inaccessibile', 'Elaborato', 'Pubblicato'] }
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
    const lista = risultato.risultati.map(r =>
      `- ${r.titolo} → ${r.scraped ? `✅ ${r.caratteri} caratteri estratti` : '❌ non accessibile'}`
    ).join('\n');
    return { content: [{ type: 'text', text: `✅ ${articoli.length} articoli elaborati:\n\n${lista}` }] };
  }

  if (name === 'leggi_articoli_pronti') {
    const articoli = await leggiArticoliInAttesa();
    if (articoli.length === 0)
      return { content: [{ type: 'text', text: 'Nessun articolo pronto per l\'elaborazione.' }] };

    const lista = articoli.map((a, i) => {
      const anteprima = a.contenuto
        ? `\n   📄 Contenuto (${a.contenuto.length} caratteri): ${a.contenuto.slice(0, 200)}...`
        : '\n   ⚠️  Nessun contenuto estratto — usa web_fetch come fallback';
      return `${i + 1}. **${a.titolo}**\n   ID: ${a.notionPageId}\n   Fonte: ${a.fonte}\n   URL: ${a.url}${anteprima}`;
    }).join('\n\n');

    return { content: [{ type: 'text', text: `📋 ${articoli.length} articoli pronti:\n\n${lista}` }] };
  }

  if (name === 'aggiorna_articolo') {
    const { notionPageId, testoElaborato, status } = args;
    if (!notionPageId)
      return { content: [{ type: 'text', text: 'Errore: notionPageId mancante.' }], isError: true };
    await aggiornaArticolo(notionPageId, { status: status || 'Elaborato', testoElaborato });
    return { content: [{ type: 'text', text: `✅ Articolo aggiornato — Status: ${status || 'Elaborato'}` }] };
  }

  // Retrocompatibilità con vecchio nome tool
  if (name === 'leggi_articoli_in_attesa') {
    return executeTool('leggi_articoli_pronti', args);
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
  server:   SERVER_NAME,
  version:  SERVER_VERSION,
  status:   'ok',
  notion:   !!NOTION_TOKEN,
  database: NOTION_DATABASE_ID || 'cercato alla prima richiesta'
}));

// Sito → aggiunge articoli (con scraping automatico)
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

// Sito → aggiorna status
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

// Sito → status singolo articolo
app.get('/notion/status/:articleId', async (req, res) => {
  try {
    const dbId          = await getOrCreateDatabase();
    const { articleId } = req.params;
    const result        = await notionRequest(`/databases/${dbId}/query`, 'POST', {
      filter: { property: 'Article ID', rich_text: { equals: articleId } }
    });
    if (result.results.length === 0) return res.json({ ok: true, status: null });
    const page = result.results[0];
    res.json({
      ok:           true,
      status:       page.properties['Status']?.select?.name || null,
      notionPageId: page.id,
      notionUrl:    page.url
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// MCP POST
app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const messages  = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];
  for (const msg of messages) {
    const r = await handleMessage(msg);
    if (r !== null) responses.push(r);
  }
  if (responses.length === 0)                             return res.status(204).end();
  if (responses.length === 1 && !Array.isArray(req.body)) return res.json(responses[0]);
  return res.json(responses);
});

// MCP SSE
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
  console.log(`   Notion token:    ${NOTION_TOKEN      ? '✅' : '❌ MANCANTE'}`);
  console.log(`   Database ID:     ${NOTION_DATABASE_ID || 'cercato automaticamente'}`);
  console.log(`   Scraping:        ✅ Readability attivo\n`);
});
