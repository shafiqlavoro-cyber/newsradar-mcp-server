# NewsRadar MCP Server

Server MCP remoto per NewsRadar. Riceve gli articoli selezionati dal sito e costruisce il task completo per Claude Cowork.

## Deploy su Render (gratuito)

### 1. Carica su GitHub
```bash
cd "C:\Users\Ragazzi Swoooooshhh\Documents\Nuova cartella (3)\newsradar-mcp-server"
git init
git add .
git commit -m "first commit"
# Crea repo su github.com, poi:
git remote add origin https://github.com/TUO_USERNAME/newsradar-mcp-server.git
git push -u origin main
```

### 2. Deploy su Render
1. Vai su **https://render.com** → Sign Up (gratis)
2. **New → Web Service**
3. Collega il tuo repo GitHub `newsradar-mcp-server`
4. Impostazioni:
   - **Name:** `newsradar-mcp`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Clicca **Create Web Service**
6. Aspetta il deploy (~2 min) → ottieni l'URL tipo `https://newsradar-mcp.onrender.com`

### 3. Aggiungi il connettore su Claude
1. Apri Claude Desktop
2. **Settings → Connectors → Add custom connector**
3. Inserisci: `https://newsradar-mcp.onrender.com/mcp`
4. Nome: `NewsRadar`
5. Clicca **Add**

### 4. Aggiorna l'URL nel sito
In `js/app.js`, cerca la riga:
```js
const MCP_SERVER_URL = 'https://newsradar-mcp.onrender.com';
```
Sostituisci con il tuo URL Render reale, poi rideploya su Firebase:
```bash
firebase deploy
```

## Test locale
```bash
npm install
npm start
# Server su http://localhost:3000
# Testa: curl http://localhost:3000/
```

## Struttura
```
newsradar-mcp-server/
├── server.js       ← Server MCP principale
├── package.json    ← Dipendenze
├── .gitignore      ← Ignora node_modules
└── README.md       ← Questa guida
```
