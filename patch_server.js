const fs = require('fs');

let content = fs.readFileSync('newsradar-mcp-server/server.js', 'utf8');

const endpoints = `
// ═══════════════════════════════════════════════════════
//  ENDPOINT PER CONTENT HUB
// ═══════════════════════════════════════════════════════

app.get('/hub/articoli', async (req, res) => {
  if (!sheetsClient || !GOOGLE_SHEET_ID)
    return res.status(500).json({ ok: false, error: 'Sheets non configurato' });
  try {
    const { status } = req.query;
    const result = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:F'
    });

    let rows = result.data.values || [];
    // Salta la prima riga (intestazioni)
    const headers = rows[0];
    rows = rows.slice(1);

    let articoli = rows.map((row, index) => {
      return {
        riga: index + 2, // 1-indexed, +1 per via dell'intestazione
        dataInvio: row[0] || '',
        titolo: row[1] || '',
        url: row[2] || '',
        fonte: row[3] || '',
        status: row[4] || '',
        testoElaborato: row[5] || ''
      };
    });

    if (status) {
      articoli = articoli.filter(a => a.status === status);
    }

    res.json({ ok: true, articoli });
  } catch (err) {
    console.error('[/hub/articoli]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/hub/articoli/:riga', async (req, res) => {
  if (!sheetsClient || !GOOGLE_SHEET_ID)
    return res.status(500).json({ ok: false, error: 'Sheets non configurato' });

  const riga = req.params.riga;
  const { status, testo } = req.body;

  try {
    if (status !== undefined) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: \`E\${riga}\`,
        valueInputOption: 'RAW',
        requestBody: { values: [[status]] }
      });
    }

    if (testo !== undefined) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: \`F\${riga}\`,
        valueInputOption: 'RAW',
        requestBody: { values: [[testo]] }
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(\`[/hub/articoli/\${riga}]\`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/hub/estrai', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'URL mancante' });

  try {
    const scraped = await estraiTestoArticolo(url);
    if (!scraped.ok) {
      return res.status(400).json({ ok: false, error: scraped.motivo });
    }
    res.json({ ok: true, testo: scraped.testo });
  } catch (err) {
    console.error('[/hub/estrai]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
`;

content = content.replace('// ═══════════════════════════════════════════════════════\n//  ENDPOINT PER GEMINI — gestione coda articoli', endpoints + '\n// ═══════════════════════════════════════════════════════\n//  ENDPOINT PER GEMINI — gestione coda articoli');

fs.writeFileSync('newsradar-mcp-server/server.js', content);
