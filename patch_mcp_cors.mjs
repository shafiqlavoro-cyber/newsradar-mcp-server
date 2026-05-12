import fs from 'fs';

let content = fs.readFileSync('newsradar-mcp-server/server.js', 'utf8');

// I also need to ensure we can handle CORS properly in Express, it's already there app.use(cors())
// So we should be good.

fs.writeFileSync('newsradar-mcp-server/server.js', content);
