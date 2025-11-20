# 🚀 Render Deployment Guide - SCB MCP Server

## ✅ No Authentication Required!

Denna MCP server kräver **ingen autentisering** - bara länken som slutar på `/mcp`!

## 📦 Snabb Deploy till Render

### Metod 1: Via Render Dashboard (Rekommenderat)

1. **Logga in på Render.com**
   - Gå till https://render.com

2. **Skapa ny Web Service**
   - Klicka "New +" → "Web Service"
   - Connect GitHub repository: `KSAklfszf921/scb-mcp`

3. **Konfigurera Service**
   ```
   Name: scb-mcp
   Region: Frankfurt (eller närmaste)
   Branch: main
   Build Command: npm install && npm run build
   Start Command: npm run start:http
   Instance Type: Free
   ```

4. **Miljövariabler** (valfritt)
   ```
   NODE_ENV=production
   ```

5. **Deploy!**
   - Klicka "Create Web Service"
   - Vänta 2-3 minuter på deployment

### Metod 2: Via render.yaml (Automatisk)

```bash
# render.yaml finns redan i repot
git add render.yaml
git commit -m "Add Render config"
git push
```

Render detekterar automatiskt `render.yaml` och deployas!

## 🔗 Använda Din MCP Server

När deploymenten är klar får du en URL:

```
https://scb-mcp-XXXXX.onrender.com
```

### MCP Endpoint
```
https://scb-mcp-XXXXX.onrender.com/mcp
```

### Test Health Check
```bash
curl https://scb-mcp-XXXXX.onrender.com/health
```

### Example Tool Call
```bash
curl -X POST https://scb-mcp-XXXXX.onrender.com/mcp/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "ehealth_get_medicine_data",
    "arguments": {
      "tableId": "LM1001",
      "selection": {
        "försäljningssätt": ["2"],
        "varugrupp": ["0"],
        "period": ["4"],
        "mätvärde": ["0", "1", "3"]
      }
    }
  }'
```

## 🤖 Anslut till Claude Desktop

Lägg till i din Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "scb-statistics": {
      "url": "https://scb-mcp-XXXXX.onrender.com/mcp",
      "description": "Swedish Statistics & Medicine Data",
      "authentication": "none"
    }
  }
}
```

**OBS:** Ingen token eller OAuth krävs! 🎉

## 🔧 Endpoints

| Endpoint | Method | Beskrivning | Auth Required |
|----------|--------|-------------|---------------|
| `/health` | GET | Health check | ❌ No |
| `/mcp` | GET | MCP info & available tools | ❌ No |
| `/mcp/call` | POST | Anropa MCP-verktyg | ❌ No |

## 📊 Tillgängliga Verktyg (14 st)

### SCB Statistics Sweden (11 verktyg)
- `scb_get_api_status`
- `scb_search_tables`
- `scb_get_table_info`
- `scb_get_table_data`
- `scb_check_usage`
- `scb_search_regions`
- `scb_get_table_variables`
- `scb_find_region_code`
- `scb_test_selection`
- `scb_preview_data`
- `scb_browse_folders`

### E-hälsomyndigheten Medicine Stats (3 verktyg)
- `ehealth_search_tables`
- `ehealth_get_table_info`
- `ehealth_get_medicine_data`

## 💡 Free Tier Begränsningar

Renders free tier:
- ✅ **750 timmar/månad** (mer än tillräckligt)
- ✅ **HTTPS automatiskt**
- ✅ **Auto-deploy vid push**
- ⚠️ **Spins down efter 15 min inaktivitet** (startar på ~30 sek vid nästa request)

### Håll Servern Vaken (Valfritt)

För att undvika cold starts, ping servern regelbundet:

```bash
# Cron job (varje 10 min)
*/10 * * * * curl https://scb-mcp-XXXXX.onrender.com/health
```

Eller använd en gratis uptime monitor:
- https://uptimerobot.com
- https://www.freshworks.com/website-monitoring/

## 🐛 Troubleshooting

### Servern svarar inte
```bash
# Kolla logs på Render dashboard
# Eller via CLI:
render logs -s scb-mcp --tail
```

### Cold Start Långsam
- Normal första gången efter 15 min inaktivitet
- ~30 sekunder startup tid på free tier
- Överväg paid tier för instant-on

### Port Error
- Render sätter automatiskt `PORT` environment variable
- Våran app lyssnar på `process.env.PORT || 3000`
- Ingen action behövs!

## 🔄 Uppdatera Deployment

```bash
git add .
git commit -m "Update feature"
git push
# Render auto-deployas!
```

## 🌍 Alternativa Regioner

I `render.yaml` kan du ändra region:
- `frankfurt` (EU)
- `oregon` (US West)
- `ohio` (US East)
- `singapore` (Asia)

## 📝 Environment Variables

**Inga secrets behövs!** Servern använder bara publika API:er:
- SCB Statistics Sweden API (öppen)
- E-hälsomyndigheten API (öppen)

## ✅ Säkerhet

- ✅ CORS aktiverat för alla origins
- ✅ Rate limiting via source APIs
- ✅ Ingen sensitiv data lagras
- ✅ Inga API-nycklar behövs
- ✅ HTTPS enforced av Render

---

**🎉 Lycka till med deploymenten!**

Support: https://github.com/KSAklfszf921/scb-mcp/issues
