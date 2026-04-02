import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// ── Costanti ──
const SERVER_NAME    = 'newsradar-mcp';
const SERVER_VERSION = '1.0.0';

// ── Il tuo prompt fisso di elaborazione notizie ──
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
//  MCP PROTOCOL — Streamable HTTP (spec 2025-03-26)
// ══════════════════════════════════════════════

// In-memory session store
const sessions = new Map();

function makeSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Tool definitions ──
const TOOLS = [
  {
    name: 'invia_notizie_a_cowork',
    description: 'Riceve una lista di articoli selezionati da NewsRadar e costruisce il task completo per Claude Cowork, combinando le notizie con il prompt di elaborazione. Restituisce il prompt pronto da eseguire.',
    inputSchema: {
      type: 'object',
      properties: {
        articoli: {
          type: 'array',
          description: 'Lista degli articoli selezionati da NewsRadar',
          items: {
            type: 'object',
            properties: {
              titolo:      { type: 'string', description: 'Titolo dell\'articolo' },
              descrizione: { type: 'string', description: 'Descrizione / sommario' },
              url:         { type: 'string', description: 'URL dell\'articolo originale' },
              fonte:       { type: 'string', description: 'Nome della fonte/testata' },
              data:        { type: 'string', description: 'Data di pubblicazione (ISO)' }
            },
            required: ['titolo', 'url']
          }
        },
        cartella_output: {
          type: 'string',
          description: 'Cartella dove salvare i file .md generati (es. ~/Desktop/articoli). Se omessa usa ~/Desktop/newsradar-output'
        }
      },
      required: ['articoli']
    }
  },
  {
    name: 'get_prompt_newsradar',
    description: 'Restituisce il prompt completo di elaborazione notizie di NewsRadar, utile per ispezionarlo o modificarlo.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// ── Tool execution ──
function executeTool(name, args) {
  if (name === 'get_prompt_newsradar') {
    return {
      content: [{
        type: 'text',
        text: NEWSRADAR_PROMPT
      }]
    };
  }

  if (name === 'invia_notizie_a_cowork') {
    const { articoli, cartella_output } = args;

    if (!articoli || articoli.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'Errore: nessun articolo ricevuto. Seleziona almeno un articolo su NewsRadar.'
        }],
        isError: true
      };
    }

    const outputDir = cartella_output || '~/Desktop/newsradar-output';
    const dataOggi  = new Date().toLocaleDateString('it-IT', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    // Costruisci il file notizie
    const notizieTesto = articoli.map((a, i) => {
      const num   = String(i + 1).padStart(2, '0');
      const fonte = a.fonte ? `\n   Fonte: ${a.fonte}` : '';
      const data  = a.data  ? `\n   Data: ${new Date(a.data).toLocaleDateString('it-IT')}` : '';
      const desc  = a.descrizione ? `\n   Descrizione: ${a.descrizione}` : '';
      return `ARTICOLO ${num}\n   Titolo: ${a.titolo}${fonte}${data}${desc}\n   URL: ${a.url}`;
    }).join('\n\n' + '─'.repeat(50) + '\n\n');

    const taskCompleto = `${NEWSRADAR_PROMPT}

═══════════════════════════════════════════════════════
NOTIZIE DA ELABORARE — ${dataOggi} (${articoli.length} articol${articoli.length === 1 ? 'o' : 'i'})
═══════════════════════════════════════════════════════

${notizieTesto}

═══════════════════════════════════════════════════════
ISTRUZIONI OPERATIVE
═══════════════════════════════════════════════════════
- Salva ogni file .md nella cartella: ${outputDir}
- Crea la cartella se non esiste
- Nomina i file: 01_parola-chiave.md, 02_parola-chiave.md, ecc.
- Dopo aver salvato tutti i file, dammi un riepilogo con i nomi dei file creati`;

    return {
      content: [{
        type: 'text',
        text: `✅ Task NewsRadar pronto! ${articoli.length} articol${articoli.length === 1 ? 'o' : 'i'} da elaborare.\n\nCartella output: ${outputDir}\n\n---\n\n${taskCompleto}`
      }]
    };
  }

  return {
    content: [{ type: 'text', text: `Tool "${name}" non trovato.` }],
    isError: true
  };
}

// ── Build MCP response envelope ──
function mcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Handle a single JSON-RPC message ──
function handleMessage(msg) {
  const { method, params, id } = msg;

  if (method === 'initialize') {
    return mcpResponse(id, {
      protocolVersion: '2025-03-26',
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} }
    });
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return mcpResponse(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = executeTool(name, args || {});
      return mcpResponse(id, result);
    } catch (e) {
      return mcpError(id, -32603, e.message);
    }
  }

  if (method === 'ping') {
    return mcpResponse(id, {});
  }

  return mcpError(id, -32601, `Method not found: ${method}`);
}

// ══════════════════════════════════════════════
//  HTTP ROUTES
// ══════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    server:  SERVER_NAME,
    version: SERVER_VERSION,
    status:  'ok',
    tools:   TOOLS.map(t => t.name),
    mcp_endpoint: '/mcp'
  });
});

// MCP Streamable HTTP endpoint (POST + GET on same path)
app.post('/mcp', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const body = req.body;

  // Batch or single
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const msg of messages) {
    const r = handleMessage(msg);
    if (r !== null) responses.push(r);
  }

  if (responses.length === 0) {
    return res.status(204).end();
  }
  if (responses.length === 1 && !Array.isArray(body)) {
    return res.json(responses[0]);
  }
  return res.json(responses);
});

// SSE endpoint (per compatibilità con vecchi client)
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sessionId = makeSessionId();
  sessions.set(sessionId, res);

  res.write(`data: ${JSON.stringify({ type: 'connection', sessionId })}\n\n`);

  req.on('close', () => {
    sessions.delete(sessionId);
  });
});

// ══════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 NewsRadar MCP Server avviato su porta ${PORT}`);
  console.log(`   Endpoint MCP: http://localhost:${PORT}/mcp`);
  console.log(`   Health check: http://localhost:${PORT}/\n`);
});
