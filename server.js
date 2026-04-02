import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '1.0.0';

// ── Token Notion — letto dalla variabile d'ambiente su Render (mai nel codice!) ──
const NOTION_TOKEN   = process.env.NOTION_TOKEN || '';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID || '336a3e42e9f180e59794e22a4a7fb751';

// ── Il tuo prompt fisso ──
const NEWSRADAR_PROMPT = `Ti passo un file con una o più notizie. Ogni notizia ha un titolo, una descrizione e un URL.
Lavora su un articolo alla volta. Per ognuno segui queste fasi nell'ordine.
---
### FASE 1 — Apri e valuta la pagina
Apri l'URL con web_fetch e valuta subito:
- **Pagina inaccessibile** (paywall, login, errore, pagina vuota, meno di 150 parole utili) → comunicamelo chiaramente e passa al prossimo
- **Pagina accessibile** → procedi
---
### FASE 2 — Estrai tutto il contenuto utile
Leggi l'articolo completo e individua ogni informazione presente:
- Fatti principali (chi, cosa, quando, dove, perché, come)
- Numeri, statistiche, percentuali, date
- Dichiarazioni di persone o istituzioni (riportale come contenuto, non come citazioni attribuite)
- Cause, conseguenze, contesto storico o geografico
- Concetti tecnici o termini specifici che il lettore potrebbe non conoscere
- Eventuali sviluppi futuri menzionati
Nessuna di queste informazioni deve andare persa nell'output finale.
---
### FASE 3 — Scegli il tono giusto
In base all'argomento dell'articolo, scegli autonomamente il tono più adatto tra questi:
- **Narrativo / storytelling** — per storie umane, eventi con protagonisti, fatti con un arco narrativo
- **Tecnico / scientifico** — per scoperte, ricerche, tecnologia, salute, ambiente; spiega i concetti passo per passo
- **Urgente / allerta** — per crisi, emergenze, rischi imminenti; va dritto al punto senza allarmismo inutile
- **Leggero / curioso** — per notizie insolite, curiosità, cultura, animali, spazio; tono accessibile e coinvolgente
- **Economico / finanziario** — per mercati, aziende, politiche economiche; preciso e concreto, spiega gli impatti pratici
Il tono non è fisso: adattalo anche all'interno dello stesso articolo se il contenuto lo richiede.
---
### FASE 4 — Scrivi il titolo
Il titolo deve:
- Essere una **affermazione**, non una domanda
- Comunicare l'essenza della notizia in modo diretto
- Essere specifico (evita titoli generici come "Novità nel settore X")
- Non superare le 12 parole
---
### FASE 5 — Scrivi l'articolo
**Regole fondamentali:**
- Scrivi in **italiano**, con un linguaggio chiaro e comprensibile a chiunque
- Non citare mai la fonte, il sito, la testata o l'URL: l'articolo deve sembrare scritto da noi
- Non copiare frasi dall'originale: riscrivi sempre con parole tue
- Non aggiungere informazioni che non sono nell'articolo originale
- Se nell'articolo ci sono concetti tecnici o termini poco noti, spiegali nel testo in modo naturale
- La lunghezza dipende dal contenuto: scrivi quanto basta per trasmettere tutte le informazioni in modo chiaro, senza tagliare nulla di sostanziale e senza riempire con ripetizioni
**Struttura:**
\`\`\`
# [Titolo]
[Paragrafo di apertura: cattura subito l'attenzione e introduce il fatto principale]
[Sviluppo: espandi ogni informazione rilevante. Spiega i concetti difficili. Riporta
numeri e dati in modo comprensibile. Dai contesto quando serve.]
[Chiusura: conseguenze, sviluppi futuri, o perché questa notizia conta —
solo se presenti nell'articolo originale]
\`\`\`
Niente sezioni con titoli, niente elenchi puntati, niente grassetti a caso: testo fluido e ben strutturato in paragrafi.
---
### FASE 6 — Salva e vai avanti
- Salva l'articolo come file \`.md\` con nome: \`[numero]_[parola-chiave].md\`
  *(es. \`01_fusione-nucleare.md\`)*
- Confermami il salvataggio con una riga, poi chiedi se procedere con il prossimo articolo`;

// ══════════════════════════════════════════════
//  NOTION HELPER
// ══════════════════════════════════════════════
async function scriviSuNotion(articoli) {
  if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN non configurato nelle variabili d\'ambiente di Render.');

  const dataOggi = new Date().toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Costruisci i blocchi della pagina Notion
  const blocchi = [];

  // Banner intestazione
  blocchi.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `🚀 Task NewsRadar — ${dataOggi} — ${articoli.length} articol${articoli.length === 1 ? 'o' : 'i'}` } }],
      icon: { emoji: '📰' },
      color: 'purple_background'
    }
  });

  blocchi.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: 'ISTRUZIONE COWORK: Elabora ogni articolo elencato qui sotto seguendo il tuo prompt. Per ognuno: apri l\'URL con web_fetch, scrivi l\'articolo in italiano e salvalo come .md nella cartella ~/Desktop/newsradar-output' } }],
      icon: { emoji: '⚡' },
      color: 'yellow_background'
    }
  });

  blocchi.push({ object: 'block', type: 'divider', divider: {} });

  // Un blocco per ogni articolo
  for (let i = 0; i < articoli.length; i++) {
    const a   = articoli[i];
    const num = String(i + 1).padStart(2, '0');

    blocchi.push({
      object: 'block', type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `ARTICOLO ${num} — ${a.titolo}` } }],
        color: 'purple'
      }
    });

    const metaParti = [];
    if (a.fonte) metaParti.push(`Fonte: ${a.fonte}`);
    if (a.data)  metaParti.push(`Data: ${a.data}`);
    if (a.descrizione) metaParti.push(`Descrizione: ${a.descrizione}`);

    if (metaParti.length) {
      blocchi.push({
        object: 'block', type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: metaParti.join(' · ') }, annotations: { color: 'gray' } }]
        }
      });
    }

    blocchi.push({
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: '🔗 URL: ' }, annotations: { bold: true } },
          { type: 'text', text: { content: a.url, link: { url: a.url } }, annotations: { color: 'blue' } }
        ]
      }
    });

    blocchi.push({ object: 'block', type: 'divider', divider: {} });
  }

  // Chiama l'API Notion
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
        title: {
          title: [{ text: { content: `📰 NewsRadar Task — ${dataOggi}` } }]
        }
      },
      children: blocchi.slice(0, 100) // Notion max 100 blocchi per chiamata
    })
  });

  const data = await res.json();
  if (!res.ok || data.object === 'error') {
    throw new Error(data.message || `Notion API error ${res.status}`);
  }

  return {
    paginaId:  data.id,
    paginaUrl: data.url
  };
}

// ══════════════════════════════════════════════
//  MCP TOOLS
// ══════════════════════════════════════════════
const TOOLS = [
  {
    name: 'invia_notizie_a_cowork',
    description: 'Riceve articoli da NewsRadar, li scrive su Notion e restituisce l\'URL della pagina pronta per Cowork.',
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
  },
  {
    name: 'get_prompt_newsradar',
    description: 'Restituisce il prompt completo di elaborazione notizie.',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function executeTool(name, args) {
  if (name === 'get_prompt_newsradar') {
    return { content: [{ type: 'text', text: NEWSRADAR_PROMPT }] };
  }

  if (name === 'invia_notizie_a_cowork') {
    const { articoli } = args;
    if (!articoli || articoli.length === 0) {
      return { content: [{ type: 'text', text: 'Errore: nessun articolo ricevuto.' }], isError: true };
    }
    const risultato = await scriviSuNotion(articoli);
    return {
      content: [{
        type: 'text',
        text: `✅ ${articoli.length} articoli scritti su Notion!\nPagina: ${risultato.paginaUrl}\n\nOra vai su Cowork e scrivi: "elabora gli articoli da Notion"`
      }]
    };
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

  if (method === 'initialize') {
    return mcpResponse(id, {
      protocolVersion: '2025-03-26',
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} }
    });
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return mcpResponse(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params;
    try {
      const result = await executeTool(name, toolArgs || {});
      return mcpResponse(id, result);
    } catch (e) {
      return mcpError(id, -32603, e.message);
    }
  }
  if (method === 'ping') return mcpResponse(id, {});
  return mcpError(id, -32601, `Method not found: ${method}`);
}

// ══════════════════════════════════════════════
//  HTTP ROUTES
// ══════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    server: SERVER_NAME, version: SERVER_VERSION, status: 'ok',
    notion_configurato: !!NOTION_TOKEN,
    tools: TOOLS.map(t => t.name)
  });
});

// ── Endpoint principale: il sito chiama questo per inviare articoli a Notion ──
app.post('/notion', async (req, res) => {
  try {
    const { articoli } = req.body;
    if (!articoli || !Array.isArray(articoli) || articoli.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nessun articolo ricevuto.' });
    }
    const risultato = await scriviSuNotion(articoli);
    res.json({ ok: true, paginaUrl: risultato.paginaUrl, paginaId: risultato.paginaId });
  } catch (err) {
    console.error('[/notion]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// MCP endpoint (POST)
app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const body = req.body;
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const r = await handleMessage(msg);
    if (r !== null) responses.push(r);
  }
  if (responses.length === 0) return res.status(204).end();
  if (responses.length === 1 && !Array.isArray(body)) return res.json(responses[0]);
  return res.json(responses);
});

// MCP SSE (GET)
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connection' })}\n\n`);
  req.on('close', () => {});
});

// ══════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 NewsRadar MCP Server — porta ${PORT}`);
  console.log(`   /notion  → scrive articoli su Notion`);
  console.log(`   /mcp     → endpoint MCP per Claude`);
  console.log(`   Notion token: ${NOTION_TOKEN ? '✅ configurato' : '❌ MANCANTE — aggiungi NOTION_TOKEN su Render'}\n`);
});
