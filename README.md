# Quest Apartment Hotels — MCP Server (POC)

A Model Context Protocol (MCP) server for Quest Apartment Hotels, enabling AI assistants (ChatGPT, Claude, Gemini) to search properties, check availability, compare rates, and make bookings across Quest's Australian portfolio.

> **POC Note:** Availability and rates are simulated with deterministic fake data. Bookings are stored in-memory and reset on each cold start.

---

## Tools Exposed

| Tool | Description |
|------|-------------|
| `quest_search_properties` | Find properties by city, state, or amenity |
| `quest_get_property_details` | Full details for a specific property |
| `quest_check_availability` | Availability for a property and date range |
| `quest_get_rates` | Rate plans for a property and stay |
| `quest_search_availability` | Combined search + availability in one call |
| `quest_get_booking_quote` | Price estimate without creating a booking |
| `quest_create_booking` | Make a reservation |
| `quest_get_booking` | Look up an existing booking by confirmation number |

---

## Project Structure

```
Quest-MCP/
├── api/
│   └── mcp.ts          # All server logic (single file)
├── package.json
├── tsconfig.json
├── vercel.json          # Routes /mcp → /api/mcp
└── .gitignore
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Vercel CLI (installed as a dev dependency)

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/Quest-MCP.git
cd Quest-MCP

# Install dependencies
npm install

# Type-check (no output = success)
npm run build

# Start local dev server
npm run dev
```

The server will be available at `http://localhost:3000/mcp`.

### Testing locally with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Set the URL to `http://localhost:3000/mcp` and transport to **Streamable HTTP**.

---

## Deployment (Vercel via GitHub)

The project is configured to auto-deploy to Vercel on every push to `main`.

### First-time setup

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your GitHub repo
3. Vercel will auto-detect the project — no extra config needed
4. Click **Deploy**

After the first deploy, every `git push` to `main` triggers a new deployment automatically.

Your MCP endpoint will be at:
```
https://YOUR-PROJECT.vercel.app/mcp
```

### Environment Variables

None required for this POC. All data is hardcoded.

---

## Testing in OpenAI ChatGPT

Per the [OpenAI MCP testing instructions](https://platform.openai.com/docs/guides/tools-mcp):

1. Open [chatgpt.com](https://chatgpt.com) and start a new conversation
2. Click the **Tools** (plug) icon → **Add a tool** → **MCP Server**
3. Enter your Vercel URL:
   ```
   https://YOUR-PROJECT.vercel.app/mcp
   ```
4. Set approval to **No approval required** (for testing)
5. Click **Connect**

ChatGPT will discover all 8 tools automatically. Try prompts like:

- *"Find me a Quest hotel in Melbourne for 3 nights from next Friday"*
- *"What Quest properties in Sydney have a gym?"*
- *"Check availability at Quest Docklands for 15–18 March 2025 and give me the best rate"*
- *"Book a studio at Quest on William for 2 nights from March 20, name John Smith"*

---

## Sample Data

The server includes 27 real Quest Australia properties across:

| State | Count |
|-------|-------|
| VIC   | 7     |
| NSW   | 6     |
| QLD   | 4     |
| ACT   | 2     |
| WA    | 3     |
| SA    | 1     |
| NT    | 1     |
| TAS   | 1     |
| Regional | 2  |

### Simulated Rate Plans

| Code   | Description            | Adjustment |
|--------|------------------------|-----------|
| FLEX   | Flexible rate          | +10%      |
| STD    | Standard rate          | base      |
| ADVP   | Advance purchase (7d+) | −10%      |
| CORP   | Corporate rate         | −15%      |
| LONG7  | Weekly rate (7+ nights)| −15%      |

Weekend surcharge: +20% on Fri/Sat/Sun nights.

---

## Architecture Notes

- **Transport**: Streamable HTTP (stateless — required for Vercel serverless)
- **Sessions**: Disabled (`sessionIdGenerator: undefined`) — each request is independent
- **CORS**: Open (`*`) — required for browser-based AI clients
- **Availability**: Deterministic hash on `propertyId|date|roomType` → 75% available
- **Bookings**: In-memory `Record<string, Booking>` — resets on cold start

For a production implementation, replace the in-memory store with a database and connect to Quest's RMS API.
