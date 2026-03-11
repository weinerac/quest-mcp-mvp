/**
 * Quest Apartment Hotels — MCP Server (POC)
 * Deployed on Vercel, accessible at /mcp
 * Compatible with OpenAI ChatGPT MCP testing and Claude Desktop
 *
 * Tools (Phase 1):
 *   quest_search_properties     — find properties by location/amenities
 *   quest_get_property_details  — full details for one property
 *   quest_check_availability    — availability at a specific property for given dates
 *   quest_get_rates             — pricing and rate plans
 *   quest_search_availability   — combined search: location + dates + room type + budget
 *   quest_get_booking_quote     — price estimate without booking
 *   quest_create_booking        — make a reservation
 *   quest_get_booking           — look up a booking by confirmation number
 *
 * Data: ~27 real Australian Quest properties from the Quest Locations dataset.
 * Availability & rates are simulated deterministically.
 * Bookings are in-memory (reset on cold start — POC only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ============================================================
// TYPES
// ============================================================

interface RoomType {
  type: "Studio" | "1-Bedroom" | "2-Bedroom" | "3-Bedroom";
  count: number;
  baseRate: number; // AUD per night
}

interface Property {
  id: string;
  name: string;
  address: string;
  suburb: string;
  city: string;
  state: string;
  postcode: string;
  shortDescription: string;
  description: string;
  coordinates: { lat: number; lng: number };
  starRating: number;
  roomTypes: RoomType[];
  amenities: string[];
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  hasConferenceRoom: boolean;
  checkInTime: string;
  checkOutTime: string;
  url: string;
}

interface RatePlan {
  planCode: string;
  planName: string;
  nightlyRate: number;
  totalCost: number;
  inclusions: string[];
  cancellationPolicy: string;
  isCorporate: boolean;
  isPromotional: boolean;
}

interface Booking {
  [key: string]: unknown;
  confirmationNumber: string;
  propertyId: string;
  propertyName: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  ratePlan: string;
  nightlyRate: number;
  totalCost: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

const SEARCH_WIDGET_URI = "ui://quest/widgets/property-search-v1.html";

const SEARCH_WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quest Property Search</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f5f7fb;
        --surface: rgba(255, 255, 255, 0.96);
        --surface-strong: #ffffff;
        --text: #102033;
        --muted: #5e6b7a;
        --border: rgba(16, 32, 51, 0.12);
        --accent: #12715b;
        --accent-strong: #0d5a48;
        --pill: rgba(18, 113, 91, 0.12);
        --shadow: 0 10px 30px rgba(16, 32, 51, 0.08);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f1722;
          --surface: rgba(17, 24, 39, 0.94);
          --surface-strong: #111827;
          --text: #f3f7fb;
          --muted: #aeb8c4;
          --border: rgba(243, 247, 251, 0.12);
          --accent: #49c5a5;
          --accent-strong: #81dbc4;
          --pill: rgba(73, 197, 165, 0.14);
          --shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .app {
        width: 100%;
        max-width: 1080px;
        margin: 0 auto;
        padding: 20px;
      }
      .hero {
        background: linear-gradient(135deg, rgba(18,113,91,0.14), rgba(18,113,91,0.03));
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 20px;
        box-shadow: var(--shadow);
        margin-bottom: 16px;
      }
      .hero h1 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
      }
      .hero p {
        margin: 0;
        color: var(--muted);
      }
      .layout {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        gap: 16px;
      }
      @media (max-width: 860px) {
        .layout { grid-template-columns: 1fr; }
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
        box-shadow: var(--shadow);
      }
      .panel h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .metric {
        background: var(--surface-strong);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px;
      }
      .metric .label {
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .metric .value {
        font-size: 16px;
        font-weight: 700;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        border-radius: 999px;
        background: var(--pill);
        color: var(--accent-strong);
        font-size: 12px;
        font-weight: 600;
      }
      .results {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .empty {
        text-align: center;
        padding: 40px 20px;
        color: var(--muted);
      }
      .card {
        background: var(--surface-strong);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
      }
      .card-top {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: start;
      }
      .card h3 {
        margin: 0 0 6px;
        font-size: 18px;
      }
      .subtle {
        color: var(--muted);
        font-size: 14px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .tag {
        font-size: 12px;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
      }
      .room-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .room {
        min-width: 132px;
        border-radius: 14px;
        padding: 10px 12px;
        background: var(--bg);
        border: 1px solid var(--border);
      }
      .room strong {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      button, a.button {
        appearance: none;
        border: 0;
        cursor: pointer;
        text-decoration: none;
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
      }
      .primary {
        background: var(--accent);
        color: white;
      }
      .secondary {
        background: transparent;
        color: var(--text);
        border: 1px solid var(--border);
      }
      .details {
        margin-top: 12px;
        padding: 14px;
        border-radius: 14px;
        background: var(--bg);
        border: 1px solid var(--border);
      }
      .details h4 {
        margin: 0 0 8px;
        font-size: 15px;
      }
      .details p {
        margin: 0 0 10px;
        color: var(--muted);
        line-height: 1.5;
      }
      .status {
        margin-top: 10px;
        font-size: 12px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="hero">
        <h1>Quest property explorer</h1>
        <p>Browse Quest Apartment Hotels results in a richer UI and request more details without leaving the conversation.</p>
      </section>
      <section class="layout">
        <aside class="panel">
          <h2>Search summary</h2>
          <div class="summary">
            <div class="metric">
              <div class="label">Properties found</div>
              <div class="value" id="summary-total">0</div>
            </div>
            <div class="metric">
              <div class="label">Current location</div>
              <div class="value" id="summary-location">Any</div>
            </div>
          </div>
          <div class="filters" id="filters"></div>
          <div class="status" id="status">Waiting for tool results…</div>
        </aside>
        <main class="panel">
          <h2>Results</h2>
          <div class="results" id="results">
            <div class="empty">Run <strong>quest_search_properties</strong> in ChatGPT to populate this widget.</div>
          </div>
        </main>
      </section>
    </div>
    <script type="module">
      const state = {
        lastInput: null,
        lastResult: null,
        detailsById: new Map(),
      };

      const resultsEl = document.getElementById("results");
      const filtersEl = document.getElementById("filters");
      const summaryTotalEl = document.getElementById("summary-total");
      const summaryLocationEl = document.getElementById("summary-location");
      const statusEl = document.getElementById("status");

      function rpcRequest(method, params) {
        const id = "rpc_" + Math.random().toString(36).slice(2);
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("Timed out waiting for " + method));
          }, 15000);

          function onMessage(event) {
            if (event.source !== window.parent) return;
            const message = event.data;
            if (!message || message.jsonrpc !== "2.0" || message.id !== id) return;
            clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            if (message.error) {
              reject(new Error(message.error.message || "RPC request failed"));
              return;
            }
            resolve(message.result);
          }

          window.addEventListener("message", onMessage, { passive: true });
          window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
        });
      }

      function renderFilters() {
        const input = state.lastInput || {};
        const entries = [
          input.location ? "Location: " + input.location : null,
          input.state ? "State: " + input.state : null,
          input.has_gym ? "Gym" : null,
          input.has_pool ? "Pool" : null,
          input.has_parking ? "Parking" : null,
          input.has_conference_room ? "Conference" : null,
        ].filter(Boolean);

        summaryLocationEl.textContent = input.location || input.state || "Any";
        filtersEl.innerHTML = entries.length
          ? entries.map((entry) => '<span class="pill">' + entry + "</span>").join("")
          : '<span class="subtle">No filters applied.</span>';
      }

      function getAmenityTags(property) {
        const tags = [];
        if (property.hasGym) tags.push("Gym");
        if (property.hasPool) tags.push("Pool");
        if (property.hasParking) tags.push("Parking");
        if (property.hasConferenceRoom) tags.push("Conference");
        return tags;
      }

      function renderDetails(propertyId) {
        const details = state.detailsById.get(propertyId);
        if (!details) return "";
        const amenities = (details.amenities || []).map((item) => '<span class="tag">' + item + "</span>").join("");
        const roomTypes = (details.roomTypes || []).map((room) => (
          '<div class="room"><strong>' + room.type + '</strong><span>$' + room.baseRatePerNight + "/night · " + room.count + " rooms</span></div>"
        )).join("");

        return [
          '<div class="details">',
          "<h4>Property details</h4>",
          "<p>" + (details.description || "") + "</p>",
          '<div class="row">' + amenities + "</div>",
          '<div class="room-list">' + roomTypes + "</div>",
          "</div>",
        ].join("");
      }

      function renderResults() {
        const payload = state.lastResult;
        const propertyResults = Array.isArray(payload?.properties) ? payload.properties : null;
        const availabilityResults = Array.isArray(payload?.results) ? payload.results : null;

        if (!payload || (!propertyResults && !availabilityResults) || ((propertyResults?.length ?? 0) === 0 && (availabilityResults?.length ?? 0) === 0)) {
          summaryTotalEl.textContent = "0";
          resultsEl.innerHTML = '<div class="empty">No properties available for the current search.</div>';
          return;
        }

        const items = propertyResults ?? availabilityResults ?? [];
        summaryTotalEl.textContent = String(payload.total || items.length);
        resultsEl.innerHTML = items.map((property) => {
          const propertyId = property.id || property.propertyId;
          const propertyName = property.name || property.propertyName;
          const description = property.shortDescription || (property.bestRate ? (property.roomType + " available · " + property.roomsLeft + " room" + (property.roomsLeft !== 1 ? "s" : "") + " left") : "");
          const amenities = getAmenityTags(property).map((item) => '<span class="tag">' + item + "</span>").join("");
          const roomTypes = property.roomTypes
            ? property.roomTypes.map((room) => (
                '<div class="room"><strong>' + room.type + '</strong><span>' + room.fromRate + "</span></div>"
              )).join("")
            : property.bestRate
              ? [
                  '<div class="room"><strong>' + property.roomType + '</strong><span>$' + property.bestRate.nightlyRate + "/night</span></div>",
                  '<div class="room"><strong>' + property.bestRate.planName + '</strong><span>$' + property.bestRate.totalCost + " total</span></div>",
                ].join("")
              : "";

          return [
            '<article class="card" data-property-id="' + propertyId + '">',
            '<div class="card-top">',
            "<div>",
            "<h3>" + propertyName + "</h3>",
            '<div class="subtle">' + property.address + "</div>",
            '<div class="subtle">' + "⭐".repeat(Math.round(property.starRating || 0)) + " · " + description + "</div>",
            "</div>",
            "</div>",
            '<div class="row">' + amenities + "</div>",
            '<div class="room-list">' + roomTypes + "</div>",
            '<div class="actions">',
            '<button class="primary" data-action="details" data-property-id="' + propertyId + '">Load details</button>',
            '<button class="secondary" data-action="availability" data-property-id="' + propertyId + '" data-property-name="' + propertyName + '">Ask about availability</button>',
            "</div>",
            renderDetails(propertyId),
            "</article>",
          ].join("");
        }).join("");
      }

      async function loadDetails(propertyId, button) {
        if (state.detailsById.has(propertyId)) {
          renderResults();
          return;
        }

        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "Loading...";

        try {
          const result = await rpcRequest("tools/call", {
            name: "quest_get_property_details",
            arguments: {
              property_id: propertyId,
              response_format: "json",
            },
          });
          if (result && result.structuredContent) {
            state.detailsById.set(propertyId, result.structuredContent);
            renderResults();
          }
        } catch (error) {
          statusEl.textContent = error instanceof Error ? error.message : "Failed to load details.";
        } finally {
          button.disabled = false;
          button.textContent = originalLabel;
        }
      }

      async function sendAvailabilityPrompt(propertyId, propertyName) {
        const text = "Check availability for " + propertyName + " (" + propertyId + ") and help me choose the best dates and room type.";
        try {
          await rpcRequest("ui/message", {
            role: "user",
            content: [{ type: "text", text }],
          });
        } catch (error) {
          statusEl.textContent = error instanceof Error ? error.message : "Unable to send follow-up.";
        }
      }

      resultsEl.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const propertyId = target.dataset.propertyId;
        if (!action || !propertyId) return;

        if (action === "details") {
          await loadDetails(propertyId, target);
        }

        if (action === "availability") {
          await sendAvailabilityPrompt(propertyId, target.dataset.propertyName || propertyId);
        }
      });

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;

        if (message.method === "ui/notifications/tool-input") {
          state.lastInput = message.params || null;
          renderFilters();
          statusEl.textContent = "Search input received.";
        }

        if (message.method === "ui/notifications/tool-result") {
          const payload = message.params?.structuredContent || null;
          state.lastResult = payload;
          renderFilters();
          renderResults();
          statusEl.textContent = payload?.total
            ? "Showing " + payload.total + " matching properties."
            : "Tool result received.";
        }
      }, { passive: true });
    </script>
  </body>
</html>`;

// ============================================================
// SAMPLE PROPERTY DATA
// (Real Australian Quest properties from Quest Locations dataset)
// ============================================================

const PROPERTIES: Property[] = [
  // ── NEW SOUTH WALES ──────────────────────────────────────
  {
    id: "quest-sydney-olympic-park",
    name: "Quest at Sydney Olympic Park",
    address: "6 Edwin Flack Avenue",
    suburb: "Sydney Olympic Park",
    city: "Sydney",
    state: "NSW",
    postcode: "2127",
    shortDescription: "Modern apartments beside world-class sports venues and parklands, 30 mins from Sydney CBD.",
    description: "Sydney Olympic Park is home to the city's widest range of sports centres. With endless parkland, entertainment and events year-round, Quest at Sydney Olympic Park is perfect for groups and families. 140 serviced apartment-style rooms — Studios, 1-, 2- and 3-bedroom — with laundry and kitchen facilities, on-site gym, and conference facilities.",
    coordinates: { lat: -33.8476, lng: 151.0665 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 35, baseRate: 165 },
      { type: "1-Bedroom", count: 55, baseRate: 210 },
      { type: "2-Bedroom", count: 35, baseRate: 270 },
      { type: "3-Bedroom", count: 15, baseRate: 345 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/sydney-olympic-park/quest-at-sydney-olympic-park",
  },
  {
    id: "quest-bella-vista",
    name: "Quest Bella Vista",
    address: "24 Norbrik Drive",
    suburb: "Bella Vista",
    city: "Sydney",
    state: "NSW",
    postcode: "2153",
    shortDescription: "Leafy north-west Sydney oasis with on-site restaurant Coco Noir. 147 apartments, gym, 30 mins to CBD.",
    description: "Bella Vista is a hilly and leafy oasis north-west of the CBD, with countless parkland and an abundance of shopping and dining options. Quest Bella Vista has 147 serviced apartments with kitchen and laundry facilities, on-site restaurant Coco Noir, gym, and secure car parking. Close to Parramatta and Norwest business districts.",
    coordinates: { lat: -33.7380, lng: 150.9621 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 30, baseRate: 160 },
      { type: "1-Bedroom", count: 60, baseRate: 200 },
      { type: "2-Bedroom", count: 45, baseRate: 255 },
      { type: "3-Bedroom", count: 12, baseRate: 330 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Restaurant", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/bella-vista/quest-bella-vista",
  },
  {
    id: "quest-chatswood",
    name: "Quest Chatswood",
    address: "38A Albert Avenue",
    suburb: "Chatswood",
    city: "Sydney",
    state: "NSW",
    postcode: "2067",
    shortDescription: "Cosmopolitan Chatswood dining and shopping hub. 100 apartments, gym, 20 mins from Sydney CBD.",
    description: "A hub for delicious eats and a melting pot of cultures. Quest Chatswood has 100 spacious modern serviced apartments — Studios and 1- and 2-bedroom — minutes from Westfield Chatswood. On-site gym, pantry shopping service, and secure parking. Easy train access to Sydney CBD.",
    coordinates: { lat: -33.7962, lng: 151.1835 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 25, baseRate: 175 },
      { type: "1-Bedroom", count: 50, baseRate: 220 },
      { type: "2-Bedroom", count: 25, baseRate: 285 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/chatswood/quest-chatswood",
  },
  {
    id: "quest-cronulla-beach",
    name: "Quest Cronulla Beach",
    address: "1 Kingsway",
    suburb: "Cronulla",
    city: "Sydney",
    state: "NSW",
    postcode: "2230",
    shortDescription: "Beachside apartments with pool, spa and sauna. Steps from Cronulla Beach, 45 mins from Sydney CBD.",
    description: "Quest Cronulla Beach features 59 spacious serviced apartments — Studios and 1- and 2-bedroom — with outdoor swimming pool, spa, sauna, and gym. Perfect beachside location. Close to Cronulla's shops, cafes and restaurants. Ideal for singles, couples and groups.",
    coordinates: { lat: -34.0546, lng: 151.1529 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 15, baseRate: 170 },
      { type: "1-Bedroom", count: 30, baseRate: 215 },
      { type: "2-Bedroom", count: 14, baseRate: 278 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Spa", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/cronulla/quest-cronulla-beach",
  },
  {
    id: "quest-liverpool",
    name: "Quest Liverpool",
    address: "39 Scott Street",
    suburb: "Liverpool",
    city: "Sydney",
    state: "NSW",
    postcode: "2170",
    shortDescription: "Liverpool CBD apartments, 40 mins south-west of Sydney CBD. 88 rooms, gym.",
    description: "Located south-west of Sydney's CBD, Quest Liverpool has 88 spacious serviced apartments — Studios, 1- and 2-bedroom — with kitchen facilities and gym. In the heart of Liverpool's CBD, close to Whitlam Leisure Centre and Warwick Farm Racecourse.",
    coordinates: { lat: -33.9214, lng: 150.9214 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 140 },
      { type: "1-Bedroom", count: 45, baseRate: 178 },
      { type: "2-Bedroom", count: 23, baseRate: 230 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/liverpool/quest-liverpool",
  },
  {
    id: "quest-albury",
    name: "Quest Albury",
    address: "550 Kiewa Street",
    suburb: "Albury",
    city: "Albury",
    state: "NSW",
    postcode: "2640",
    shortDescription: "Murray River border town gateway. 108 apartments with gym, near ski fields and wineries.",
    description: "Perched on the Murray River border of NSW and Victoria, Quest Albury is close to ski fields, first-class wineries, and epic waterways. 108 serviced apartments with laundry and kitchen facilities, secure car parking, and on-site gym. Ideal for families and groups.",
    coordinates: { lat: -36.0737, lng: 146.9135 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 25, baseRate: 115 },
      { type: "1-Bedroom", count: 50, baseRate: 148 },
      { type: "2-Bedroom", count: 33, baseRate: 192 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/albury/quest-albury",
  },
  {
    id: "quest-albury-on-townsend",
    name: "Quest Albury on Townsend",
    address: "450 Townsend Streets",
    suburb: "Albury",
    city: "Albury",
    state: "NSW",
    postcode: "2640",
    shortDescription: "Border-city stay near the Murray River. Modern apartments with gym, ideal for regional getaways and business trips.",
    description: "On the border of NSW and Victoria, Quest Albury on Townsend helps guests make the most of the Murray River region, Lake Hume, and nearby ski destinations. Modern serviced apartments with kitchen and laundry facilities, on-site gym, and welcoming service make it suitable for short and long stays alike.",
    coordinates: { lat: -36.0790, lng: 146.9180 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 125 },
      { type: "1-Bedroom", count: 34, baseRate: 162 },
      { type: "2-Bedroom", count: 20, baseRate: 215 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/albury/quest-albury-on-townsend",
  },
  {
    id: "quest-newcastle",
    name: "Quest Newcastle",
    address: "575 Hunter Street",
    suburb: "Newcastle",
    city: "Newcastle",
    state: "NSW",
    postcode: "2300",
    shortDescription: "Central Newcastle apartments close to the harbour and dining precincts, with gym and business-friendly amenities.",
    description: "Quest Newcastle places guests close to the harbour city’s dining, entertainment, and business districts. Modern serviced apartments with kitchen and laundry facilities, secure parking, and an on-site gym make it a convenient base for both work trips and coastal getaways.",
    coordinates: { lat: -32.9267, lng: 151.7707 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 155 },
      { type: "1-Bedroom", count: 36, baseRate: 198 },
      { type: "2-Bedroom", count: 18, baseRate: 255 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/newcastle/quest-newcastle",
  },
  {
    id: "quest-penrith",
    name: "Quest Penrith",
    address: "83 Lord Sheffield Circuit",
    suburb: "Penrith",
    city: "Sydney",
    state: "NSW",
    postcode: "2750",
    shortDescription: "Western Sydney base near the Blue Mountains, with contemporary apartments, gym, and parking.",
    description: "Quest Penrith offers contemporary serviced apartment accommodation in Western Sydney, with easy access to Penrith’s dining and retail precincts plus the Blue Mountains gateway. Apartments include kitchen and laundry facilities, while on-site gym access supports both short and extended stays.",
    coordinates: { lat: -33.7513, lng: 150.6940 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 22, baseRate: 150 },
      { type: "1-Bedroom", count: 38, baseRate: 190 },
      { type: "2-Bedroom", count: 20, baseRate: 245 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/penrith/quest-penrith/",
  },
  {
    id: "quest-wollongong",
    name: "Quest Wollongong",
    address: "59-61 Kembla Street",
    suburb: "Wollongong",
    city: "Wollongong",
    state: "NSW",
    postcode: "2500",
    shortDescription: "Coastal Wollongong apartments close to beaches, dining, and the CBD, ideal for business or leisure stays.",
    description: "Quest Wollongong provides serviced apartment accommodation near the city centre, beaches, and local dining precincts. Spacious apartments with kitchen and laundry facilities suit both short stays and longer visits on the South Coast.",
    coordinates: { lat: -34.4278, lng: 150.8931 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 148 },
      { type: "1-Bedroom", count: 28, baseRate: 188 },
      { type: "2-Bedroom", count: 16, baseRate: 238 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/wollongong/quest-wollongong",
  },
  {
    id: "quest-goulburn",
    name: "Quest Goulburn",
    address: "27 Clinton Street",
    suburb: "Goulburn",
    city: "Goulburn",
    state: "NSW",
    postcode: "2580",
    shortDescription: "Regional NSW stay in the heart of Goulburn with gym, conference facilities, and apartment-style comfort.",
    description: "Quest Goulburn offers easy access to the town’s cafés, restaurants, bars, shopping, and rail connections. Spacious serviced apartments with kitchen and laundry facilities, plus gym, conference facilities, balcony rooms, and BBQ area, make it suitable for family escapes and business stays.",
    coordinates: { lat: -34.7545, lng: 149.7186 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 145 },
      { type: "1-Bedroom", count: 28, baseRate: 182 },
      { type: "2-Bedroom", count: 14, baseRate: 235 },
      { type: "3-Bedroom", count: 3, baseRate: 295 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Balcony", "BBQ Area", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/goulburn/quest-goulburn",
  },
  {
    id: "quest-griffith",
    name: "Quest Griffith",
    address: "53 Railway Street",
    suburb: "Griffith",
    city: "Griffith",
    state: "NSW",
    postcode: "2680",
    shortDescription: "Food and wine country apartments in Griffith with gym and flexible room options for regional stays.",
    description: "Quest Griffith is a convenient base for exploring the region’s wineries, restaurants, and nearby national parks. Modern serviced apartments with kitchen facilities, room options from Studio to 3-Bedroom, and an on-site gym make it a strong choice for leisure and business travel.",
    coordinates: { lat: -34.2895, lng: 146.0458 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 138 },
      { type: "1-Bedroom", count: 28, baseRate: 175 },
      { type: "2-Bedroom", count: 18, baseRate: 225 },
      { type: "3-Bedroom", count: 6, baseRate: 285 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/griffith/quest-griffith",
  },
  {
    id: "quest-macquarie-park",
    name: "Quest Macquarie Park",
    address: "71 Epping Road",
    suburb: "Macquarie Park",
    city: "Sydney",
    state: "NSW",
    postcode: "2113",
    shortDescription: "North-west Sydney apartment hotel near business parks and transport, with gym and larger apartment options.",
    description: "Quest Macquarie Park is close to transport links, lush parklands, and major business hubs in Sydney’s north-west. Spacious 1-, 2-, and 3-bedroom apartments with kitchen facilities and on-site gym access make it well suited to business trips, family stays, and longer visits.",
    coordinates: { lat: -33.7772, lng: 151.1181 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 28, baseRate: 205 },
      { type: "2-Bedroom", count: 22, baseRate: 258 },
      { type: "3-Bedroom", count: 10, baseRate: 330 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/macquarie-park/quest-macquarie-park",
  },
  {
    id: "quest-manly",
    name: "Quest Manly",
    address: "54A West Esplanade",
    suburb: "Manly",
    city: "Sydney",
    state: "NSW",
    postcode: "2095",
    shortDescription: "Beachside Sydney stay near Manly Wharf and the foreshore, with gym, sauna, and apartment-style rooms.",
    description: "Quest Manly combines easy coastal living with access to Sydney’s wider attractions. Close to beaches, North Head trails, and harbour transport, the property offers serviced apartments with full kitchen and laundry facilities, on-site gym, sauna, and 24-hour reception.",
    coordinates: { lat: -33.7987, lng: 151.2868 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 185 },
      { type: "1-Bedroom", count: 24, baseRate: 235 },
      { type: "2-Bedroom", count: 15, baseRate: 298 },
    ],
    amenities: ["WiFi", "Gym", "Sauna", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/manly/quest-manly/",
  },
  {
    id: "quest-mascot",
    name: "Quest Mascot",
    address: "108-114 Robey Street",
    suburb: "Mascot",
    city: "Sydney",
    state: "NSW",
    postcode: "2020",
    shortDescription: "Airport-adjacent Sydney apartments with easy access to beaches and the CBD, ideal for stopovers and business stays.",
    description: "Quest Mascot is just minutes from Sydney Airport and offers fast access to the city, eastern beaches, and southern coastal attractions. Spacious serviced apartments with kitchen and laundry facilities provide a comfortable base for transit, business, or leisure travel.",
    coordinates: { lat: -33.9276, lng: 151.1926 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 22, baseRate: 175 },
      { type: "1-Bedroom", count: 40, baseRate: 220 },
      { type: "2-Bedroom", count: 22, baseRate: 280 },
      { type: "3-Bedroom", count: 7, baseRate: 345 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/mascot/quest-mascot",
  },
  {
    id: "quest-maitland",
    name: "Quest Maitland",
    address: "1 Ken Tubman Drive",
    suburb: "Maitland",
    city: "Maitland",
    state: "NSW",
    postcode: "2320",
    shortDescription: "Hunter Valley gateway apartments in central Maitland, suited to regional escapes and longer stays.",
    description: "Quest Maitland is in the heart of town near the Hunter River, heritage streets, wineries, and local dining. Spacious light-filled serviced apartments with kitchen and laundry facilities, complimentary WiFi, and housekeeping make it a comfortable base for both leisure and business travel.",
    coordinates: { lat: -32.7347, lng: 151.5578 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 142 },
      { type: "1-Bedroom", count: 24, baseRate: 180 },
      { type: "2-Bedroom", count: 14, baseRate: 232 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Housekeeping", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/maitland/quest-maitland",
  },
  {
    id: "quest-newcastle-west",
    name: "Quest Newcastle West",
    address: "787 Hunter Street",
    suburb: "Newcastle West",
    city: "Newcastle",
    state: "NSW",
    postcode: "2302",
    shortDescription: "Heritage brewery conversion at the gateway to Newcastle, with gym, business lounge, and conference space.",
    description: "Housed in the refurbished 1876 Woods Castlemaine Brewery, Quest Newcastle West blends historic character with modern serviced apartments. Guests have access to a gym, business lounge, BBQ area, accessible rooms, and a large conference room close to cafes, dining, and the light rail.",
    coordinates: { lat: -32.9277, lng: 151.7582 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 158 },
      { type: "1-Bedroom", count: 28, baseRate: 198 },
      { type: "2-Bedroom", count: 16, baseRate: 255 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Business Lounge", "BBQ Area", "Accessible Rooms", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/newcastle/quest-newcastle-west",
  },
  {
    id: "quest-north-sydney",
    name: "Quest North Sydney",
    address: "223 Miller Street",
    suburb: "North Sydney",
    city: "Sydney",
    state: "NSW",
    postcode: "2060",
    shortDescription: "North Sydney apartments with gym and conference facilities, close to business districts and harbour access.",
    description: "Quest North Sydney offers modern serviced apartments with kitchen and laundry facilities, 24-hour on-site management, complimentary WiFi, gym, and conference facilities. It is well located for business travel while still being close to trails, dining, and the harbour-side attractions of Sydney.",
    coordinates: { lat: -33.8395, lng: 151.2075 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 24, baseRate: 188 },
      { type: "1-Bedroom", count: 42, baseRate: 235 },
      { type: "2-Bedroom", count: 24, baseRate: 295 },
      { type: "3-Bedroom", count: 10, baseRate: 365 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/north-sydney/quest-north-sydney/",
  },
  {
    id: "quest-nowra",
    name: "Quest Nowra",
    address: "130 Kinghorne Street",
    suburb: "Nowra",
    city: "Nowra",
    state: "NSW",
    postcode: "2541",
    shortDescription: "Shoalhaven gateway apartments with gym and conference facilities, ideal for coast and bushland trips.",
    description: "Quest Nowra is close to the town centre and provides easy access to Jervis Bay Marine Park, bushland, beaches, and regional attractions. Modern serviced apartments with kitchen facilities, on-site gym, conference facilities, BBQ area, and WiFi support both short and extended stays.",
    coordinates: { lat: -34.8768, lng: 150.6024 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 145 },
      { type: "1-Bedroom", count: 34, baseRate: 185 },
      { type: "2-Bedroom", count: 20, baseRate: 238 },
      { type: "3-Bedroom", count: 7, baseRate: 298 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "BBQ Area", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/nowra/quest-nowra",
  },
  {
    id: "quest-orange",
    name: "Quest Orange",
    address: "132 Kite Street",
    suburb: "Orange",
    city: "Orange",
    state: "NSW",
    postcode: "2800",
    shortDescription: "Central Orange apartments in wine country with gym and conference room for leisure or business stays.",
    description: "Quest Orange puts guests in the heart of one of regional NSW’s best food and wine destinations. Light-filled serviced apartments with full kitchen facilities, plus gym and conference room access, make it a convenient base for winery weekends, business trips, and longer stays.",
    coordinates: { lat: -33.2866, lng: 149.1038 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 148 },
      { type: "1-Bedroom", count: 30, baseRate: 188 },
      { type: "2-Bedroom", count: 20, baseRate: 242 },
      { type: "3-Bedroom", count: 9, baseRate: 305 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/orange/quest-orange",
  },
  {
    id: "quest-st-leonards",
    name: "Quest St Leonards",
    address: "10 Atchison Street",
    suburb: "St Leonards",
    city: "Sydney",
    state: "NSW",
    postcode: "2065",
    shortDescription: "North Shore apartments near the CBD with gym, pool, and café for business and longer stays.",
    description: "Quest St Leonards is located in Sydney’s North Shore, close to parks, cafés, transport, and only a short trip from the CBD. Spacious serviced apartments with kitchen facilities are supported by an on-site café, gym, pool, and complimentary WiFi.",
    coordinates: { lat: -33.8239, lng: 151.1947 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 190 },
      { type: "1-Bedroom", count: 36, baseRate: 235 },
      { type: "2-Bedroom", count: 20, baseRate: 295 },
      { type: "3-Bedroom", count: 5, baseRate: 360 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Cafe", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/st-leonards/quest-st-leonards",
  },
  {
    id: "quest-tamworth",
    name: "Quest Tamworth",
    address: "337 Armidale Road",
    suburb: "Tamworth",
    city: "Tamworth",
    state: "NSW",
    postcode: "2340",
    shortDescription: "Country music capital apartments with roomy layouts and balconies, ideal for regional getaways.",
    description: "Quest Tamworth provides a comfortable retreat close to the Golden Guitar Centre, galleries, gardens, and the city’s heritage attractions. Spacious 1-, 2-, and 3-Bedroom apartments feature air conditioning, dining and lounge areas, and private balconies.",
    coordinates: { lat: -31.1074, lng: 150.9301 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 16, baseRate: 145 },
      { type: "2-Bedroom", count: 16, baseRate: 188 },
      { type: "3-Bedroom", count: 8, baseRate: 245 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/tamworth/quest-tamworth",
  },
  {
    id: "quest-wagga-wagga",
    name: "Quest Wagga Wagga",
    address: "69 Gurwood Street",
    suburb: "Wagga Wagga",
    city: "Wagga Wagga",
    state: "NSW",
    postcode: "2650",
    shortDescription: "Central Riverina apartments with pool and BBQ courtyard, close to arts, dining, and river attractions.",
    description: "Quest Wagga Wagga is centrally located in the Riverina near galleries, theatres, breweries, and local dining. Serviced apartments with full kitchen and laundry facilities, an outdoor swimming pool, courtyard, and BBQ area provide a flexible base for family or regional business stays.",
    coordinates: { lat: -35.1082, lng: 147.3674 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 140 },
      { type: "1-Bedroom", count: 18, baseRate: 178 },
      { type: "2-Bedroom", count: 10, baseRate: 230 },
      { type: "3-Bedroom", count: 5, baseRate: 288 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Courtyard", "BBQ Area", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/wagga-wagga/quest-wagga-wagga",
  },
  {
    id: "quest-campbelltown",
    name: "Quest Campbelltown",
    address: "1 Rennie Road",
    suburb: "Woodbine",
    city: "Sydney",
    state: "NSW",
    postcode: "2560",
    shortDescription: "South-west Sydney apartments with gym, suited to family stays and business travel.",
    description: "Quest Campbelltown offers serviced apartment accommodation in Sydney’s south-west, close to heritage attractions, gardens, arts venues, and the broader Southern Highlands corridor. Apartments with full kitchen and laundry facilities are complemented by on-site gym access and convenient parking.",
    coordinates: { lat: -34.0427, lng: 150.8348 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 148 },
      { type: "1-Bedroom", count: 32, baseRate: 188 },
      { type: "2-Bedroom", count: 22, baseRate: 242 },
      { type: "3-Bedroom", count: 9, baseRate: 305 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/woodbine/quest-campbelltown",
  },
  {
    id: "quest-dubbo",
    name: "Quest Dubbo",
    address: "22 Bultje Street",
    suburb: "Dubbo",
    city: "Dubbo",
    state: "NSW",
    postcode: "2830",
    shortDescription: "Regional NSW apartments near zoo and family attractions, with gym, conference facilities, and BBQ terrace.",
    description: "Quest Dubbo is a practical base for exploring Taronga Western Plains Zoo, botanic gardens, observatory attractions, and the wider Dubbo region. Light-filled serviced apartments with laundry and kitchen facilities are supported by gym access, conference facilities, secure parking, and an outdoor BBQ terrace.",
    coordinates: { lat: -32.2439, lng: 148.6038 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 142 },
      { type: "1-Bedroom", count: 30, baseRate: 182 },
      { type: "2-Bedroom", count: 18, baseRate: 235 },
      { type: "3-Bedroom", count: 9, baseRate: 298 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "BBQ Terrace", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/dubbo/quest-dubbo",
  },
  {
    id: "quest-singleton",
    name: "Quest Singleton",
    address: "5-7 Civic Ave",
    suburb: "Singleton",
    city: "Singleton",
    state: "NSW",
    postcode: "2330",
    shortDescription: "Hunter Valley heritage-town apartments ideal for winery weekends and regional stays.",
    description: "Quest Singleton sits in the heart of a tranquil Hunter Valley town known for wineries, heritage walks, concerts, and local markets. Spacious 1-, 2-, and 3-Bedroom serviced apartments make it a flexible option for families, groups, and longer regional stays.",
    coordinates: { lat: -32.5624, lng: 151.1717 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 14, baseRate: 145 },
      { type: "2-Bedroom", count: 14, baseRate: 188 },
      { type: "3-Bedroom", count: 7, baseRate: 245 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nsw/singleton/quest-singleton/meeting-and-conferences",
  },

  // ── VICTORIA ─────────────────────────────────────────────
  {
    id: "quest-docklands",
    name: "Quest Docklands",
    address: "750 Bourke Street",
    suburb: "Docklands",
    city: "Melbourne",
    state: "VIC",
    postcode: "3008",
    shortDescription: "Overlooking Marvel Stadium, walking distance to Melbourne CBD. 133 apartments, gym.",
    description: "Quest Docklands offers 133 airy and spacious serviced apartments overlooking Marvel Stadium. Trams and trains at the doorstep, steps from Docklands promenade restaurants and bars, and a short walk to Melbourne CBD Southbank. On-site gym and Pantry Shopping Service.",
    coordinates: { lat: -37.8197, lng: 144.9415 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 30, baseRate: 190 },
      { type: "1-Bedroom", count: 60, baseRate: 240 },
      { type: "2-Bedroom", count: 35, baseRate: 305 },
      { type: "3-Bedroom", count: 8, baseRate: 390 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning", "Pantry Service"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/docklands/quest-docklands",
  },
  {
    id: "quest-collingwood",
    name: "Quest Collingwood",
    address: "79-89 Wellington Street",
    suburb: "Collingwood",
    city: "Melbourne",
    state: "VIC",
    postcode: "3066",
    shortDescription: "Trendy inner-city Melbourne. 83 apartments, gym, conference room. Walking distance to CBD.",
    description: "Quest Collingwood is in the heart of Melbourne's vibrant inner north, 30 minutes from Melbourne Airport. Explore laneways, bars, boutiques, cafés and galleries, all within walking distance of the CBD. 83 stunning serviced apartments (1-, 2- and 3-bedroom), on-site gym, convenience store, and 30-person conference facility.",
    coordinates: { lat: -37.8057, lng: 144.9941 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 40, baseRate: 230 },
      { type: "2-Bedroom", count: 30, baseRate: 290 },
      { type: "3-Bedroom", count: 13, baseRate: 380 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/collingwood/quest-collingwood",
  },
  {
    id: "quest-east-melbourne",
    name: "Quest East Melbourne",
    address: "48 Wellington Parade",
    suburb: "East Melbourne",
    city: "Melbourne",
    state: "VIC",
    postcode: "3002",
    shortDescription: "Art deco apartments opposite the MCG. Walk to Fed Square, Melbourne Park, Rod Laver Arena.",
    description: "Quest East Melbourne is opposite the MCG, within walking distance to Federation Square, Melbourne Park, and Rod Laver Arena. 39 art deco serviced apartments with kitchen facilities and rooftop terrace. Steps from Melbourne's best restaurants, bars, and theatre district.",
    coordinates: { lat: -37.8148, lng: 144.9834 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 195 },
      { type: "1-Bedroom", count: 20, baseRate: 248 },
      { type: "2-Bedroom", count: 9, baseRate: 318 },
    ],
    amenities: ["WiFi", "Kitchen", "Laundry", "Air Conditioning", "Rooftop Terrace"],
    hasGym: false, hasPool: false, hasParking: false, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/east-melbourne/quest-east-melbourne",
  },
  {
    id: "quest-flemington-central",
    name: "Quest Flemington Central",
    address: "1 Ascot Vale Road",
    suburb: "Flemington",
    city: "Melbourne",
    state: "VIC",
    postcode: "3031",
    shortDescription: "Heated rooftop pool with city views. 2 stops from CBD, near Flemington Racecourse.",
    description: "Two stops from the CBD by train, Quest Flemington Central features 66 sleek serviced apartments with incredible city views from the heated rooftop pool. On-site gym and kitchen facilities. Steps from Flemington Racecourse and the great cuisines of Footscray and Newmarket.",
    coordinates: { lat: -37.7894, lng: 144.9309 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 175 },
      { type: "1-Bedroom", count: 30, baseRate: 225 },
      { type: "2-Bedroom", count: 18, baseRate: 290 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning", "Rooftop Pool"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/flemington/quest-flemington-central",
  },
  {
    id: "quest-cheltenham",
    name: "Quest Cheltenham",
    address: "37-39 Station Road",
    suburb: "Cheltenham",
    city: "Melbourne",
    state: "VIC",
    postcode: "3192",
    shortDescription: "Bayside retreat in Melbourne's Sandbelt. 55 apts with balconies, gym, near golf courses.",
    description: "Quest Cheltenham is a serene Bayside retreat in the Victorian Sandbelt, adjacent to world-class golf courses. 55 serviced apartments — all with balconies (excluding Studios) and kitchen facilities. Close to Westfield Southland, Mentone Beach, and Rickett's Point. On-site gym.",
    coordinates: { lat: -37.9646, lng: 145.0530 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 155 },
      { type: "1-Bedroom", count: 25, baseRate: 195 },
      { type: "2-Bedroom", count: 18, baseRate: 255 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/cheltenham/quest-cheltenham",
  },
  {
    id: "quest-glen-waverley",
    name: "Quest Glen Waverley",
    address: "353-361 Springvale Road",
    suburb: "Glen Waverley",
    city: "Melbourne",
    state: "VIC",
    postcode: "3150",
    shortDescription: "Family-friendly east Melbourne. Studios to 5BR townhouses, gym, near Monash University.",
    description: "Quest Glen Waverley offers 77 modern serviced apartments — Studios, 1-, 2- and 3-bedroom, plus 4- and 5-bedroom townhouses for larger groups. Easy walk to Kingsway Restaurant Precinct, Glen Shopping Centre, and Century City Movies. On-site gym.",
    coordinates: { lat: -37.8793, lng: 145.1623 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 15, baseRate: 150 },
      { type: "1-Bedroom", count: 30, baseRate: 192 },
      { type: "2-Bedroom", count: 25, baseRate: 248 },
      { type: "3-Bedroom", count: 7, baseRate: 315 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/glen-waverley/quest-glen-waverley",
  },
  {
    id: "quest-ballarat",
    name: "Quest Ballarat",
    address: "7-11 Dawson Street North",
    suburb: "Ballarat",
    city: "Ballarat",
    state: "VIC",
    postcode: "3350",
    shortDescription: "Heritage Victorian city, 1hr from Melbourne. 53 apartments in former Loreto College, gym.",
    description: "Quest Ballarat is in the former Loreto College building, stylishly appointed for business and leisure. 53 modern serviced apartments, 2-minute walk to the CBD's major shopping and dining precinct. Close to Art Gallery, Her Majesty's Theatre, Sovereign Hill, and regional hospitals. On-site gym.",
    coordinates: { lat: -37.5622, lng: 143.8503 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 130 },
      { type: "1-Bedroom", count: 25, baseRate: 165 },
      { type: "2-Bedroom", count: 16, baseRate: 215 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/ballarat/quest-ballarat",
  },
  {
    id: "quest-ballarat-station",
    name: "Quest Ballarat Station",
    address: "11 Nolan Street",
    suburb: "Soldiers Hill",
    city: "Ballarat",
    state: "VIC",
    postcode: "3350",
    shortDescription: "Stylish inner-city Ballarat stay near the train hub, with gym and accessible apartment options.",
    description: "Just 250 metres from Ballarat’s train station, Quest Ballarat Station offers stylish serviced apartments with kitchen and laundry facilities, accessible room options, and an on-site gym. It is a convenient base for exploring Ballarat’s dining scene, heritage streets, and regional attractions.",
    coordinates: { lat: -37.5569, lng: 143.8585 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 138 },
      { type: "1-Bedroom", count: 34, baseRate: 175 },
      { type: "2-Bedroom", count: 18, baseRate: 225 },
      { type: "3-Bedroom", count: 5, baseRate: 285 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning", "Accessible Rooms"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/ballarat/quest-ballarat-station",
  },
  {
    id: "quest-bendigo-central",
    name: "Quest Bendigo Central",
    address: "228 McCrae Street",
    suburb: "Bendigo",
    city: "Bendigo",
    state: "VIC",
    postcode: "3550",
    shortDescription: "Central Bendigo. 60 apartments Studio to 3BR, pool. Walk to galleries, theatres, museums.",
    description: "Quest Bendigo Central puts you within walking distance of galleries, theatres, museums, pottery centres, and Victoria's best food and wine. 60 spacious serviced apartments — Studio to 3-bedroom — all with kitchen facilities. On-site pool and car parking.",
    coordinates: { lat: -36.7570, lng: 144.2794 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 15, baseRate: 120 },
      { type: "1-Bedroom", count: 25, baseRate: 155 },
      { type: "2-Bedroom", count: 15, baseRate: 200 },
      { type: "3-Bedroom", count: 5, baseRate: 255 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/bendigo/quest-bendigo-central",
  },
  {
    id: "quest-geelong",
    name: "Quest Geelong",
    address: "16-18 The Esplanade South",
    suburb: "Geelong",
    city: "Geelong",
    state: "VIC",
    postcode: "3220",
    shortDescription: "On the Geelong waterfront esplanade, 1hr from Melbourne. Gateway to Bellarine Peninsula.",
    description: "Right by Western Beach and The Pier Geelong, Quest Geelong offers Studios and 1-, 2- and 3-bedroom apartments. On-site gym, secure car parking, valet dry cleaning. 1 hour from Melbourne CBD, gateway to Bellarine Peninsula beaches and national parks.",
    coordinates: { lat: -38.1499, lng: 144.3617 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 125 },
      { type: "1-Bedroom", count: 20, baseRate: 160 },
      { type: "2-Bedroom", count: 15, baseRate: 210 },
      { type: "3-Bedroom", count: 5, baseRate: 265 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/geelong/quest-geelong",
  },
  {
    id: "quest-bundoora",
    name: "Quest Bundoora",
    address: "40 Janefield Drive",
    suburb: "Bundoora",
    city: "Melbourne",
    state: "VIC",
    postcode: "3083",
    shortDescription: "North Melbourne apartments near RMIT and University Hill, with gym and easy airport access.",
    description: "Quest Bundoora is ideal for business travellers, couples, and families seeking easy access to Melbourne’s north, the airport, and the Yarra Valley region. Choose from modern serviced apartments with kitchen facilities, supported by an on-site gym and friendly local service.",
    coordinates: { lat: -37.6785, lng: 145.0560 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 150 },
      { type: "1-Bedroom", count: 28, baseRate: 190 },
      { type: "2-Bedroom", count: 20, baseRate: 245 },
      { type: "3-Bedroom", count: 10, baseRate: 305 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/bundoora/quest-bundoora",
  },
  {
    id: "quest-southbank",
    name: "Quest Southbank",
    address: "12-16 Kavanagh Street",
    suburb: "Southbank",
    city: "Melbourne",
    state: "VIC",
    postcode: "3006",
    shortDescription: "Walkable Southbank location near arts, dining, and the CBD, with spacious apartment-style accommodation.",
    description: "Quest Southbank puts guests in one of Melbourne’s most walkable precincts, close to the arts centre, riverside dining, and the CBD. Spacious serviced apartments with kitchen and laundry facilities make it a strong choice for families, corporate travel, and longer city stays.",
    coordinates: { lat: -37.8252, lng: 144.9660 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 185 },
      { type: "1-Bedroom", count: 34, baseRate: 235 },
      { type: "2-Bedroom", count: 22, baseRate: 295 },
      { type: "3-Bedroom", count: 8, baseRate: 360 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/southbank/quest-southbank",
  },
  {
    id: "quest-epping",
    name: "Quest Epping",
    address: "Epping Plaza",
    suburb: "Epping",
    city: "Melbourne",
    state: "VIC",
    postcode: "3076",
    shortDescription: "North Melbourne apartments beside shopping and dining, with gym and meeting facilities for business or leisure.",
    description: "Quest Epping is located in the heart of Epping near Pacific Epping Shopping Centre, Urban Diner, transport, and the Northern Hospital precinct. Spacious serviced apartments with kitchen facilities, on-site gym, and meeting facilities create a flexible base in Melbourne’s north.",
    coordinates: { lat: -37.6535, lng: 145.0248 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 152 },
      { type: "1-Bedroom", count: 40, baseRate: 192 },
      { type: "2-Bedroom", count: 26, baseRate: 248 },
      { type: "3-Bedroom", count: 10, baseRate: 310 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/epping/quest-epping",
  },
  {
    id: "quest-frankston",
    name: "Quest Frankston",
    address: "377 Nepean Highway",
    suburb: "Frankston",
    city: "Melbourne",
    state: "VIC",
    postcode: "3199",
    shortDescription: "Bayside Frankston apartments close to the beach and Mornington Peninsula, with easy rail access to Melbourne.",
    description: "Quest Frankston offers spacious serviced apartments near the beach, Frankston Arts Centre, and Bayside Shopping Centre. It is well placed for exploring the Mornington Peninsula while still allowing easy train access into central Melbourne.",
    coordinates: { lat: -38.1452, lng: 145.1225 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 158 },
      { type: "1-Bedroom", count: 30, baseRate: 198 },
      { type: "2-Bedroom", count: 18, baseRate: 250 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/frankston/quest-frankston",
  },
  {
    id: "quest-frankston-on-the-bay",
    name: "Quest Frankston on the Bay",
    address: "435-437 Nepean Hwy",
    suburb: "Frankston",
    city: "Melbourne",
    state: "VIC",
    postcode: "3199",
    shortDescription: "Modern Frankston stay near the bay and Mornington Peninsula, with restaurant, gym, and conference facilities.",
    description: "Quest Frankston on the Bay places guests close to Frankston’s beachfront, shopping precinct, and the wider Mornington Peninsula region. Serviced apartments with kitchen and laundry facilities are complemented by an on-site restaurant, gym, and conference facilities.",
    coordinates: { lat: -38.1471, lng: 145.1238 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 165 },
      { type: "1-Bedroom", count: 34, baseRate: 205 },
      { type: "2-Bedroom", count: 20, baseRate: 262 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Restaurant", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/frankston/quest-frankston-on-the-bay",
  },
  {
    id: "quest-geelong-central",
    name: "Quest Geelong Central",
    address: "71-77 Gheringhap Street",
    suburb: "Geelong",
    city: "Geelong",
    state: "VIC",
    postcode: "3220",
    shortDescription: "Premium Geelong apartments near the waterfront with rooftop gym, conference facilities, and bay views.",
    description: "Quest Geelong Central is a premium self-contained apartment hotel located close to Geelong’s waterfront, botanic gardens, and CBD. Studio to 3-Bedroom options, conference facilities, a business lounge, and a rooftop gym with Corio Bay views support both leisure and corporate travel.",
    coordinates: { lat: -38.1484, lng: 144.3593 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 155 },
      { type: "1-Bedroom", count: 32, baseRate: 198 },
      { type: "2-Bedroom", count: 20, baseRate: 252 },
      { type: "3-Bedroom", count: 8, baseRate: 320 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Business Lounge", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/geelong/quest-geelong-central",
  },
  {
    id: "quest-maribyrnong",
    name: "Quest Maribyrnong",
    address: "2A Wests Road",
    suburb: "Maribyrnong",
    city: "Melbourne",
    state: "VIC",
    postcode: "3032",
    shortDescription: "West Melbourne riverside apartments near Highpoint, with gym and conference facilities.",
    description: "Quest Maribyrnong sits close to riverside walking trails, Highpoint Shopping Centre, and only a short trip from the CBD. Spacious serviced apartments with full kitchen and laundry facilities are supported by secure parking, meeting and conference facilities, and an on-site gym.",
    coordinates: { lat: -37.7743, lng: 144.8878 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 160 },
      { type: "1-Bedroom", count: 28, baseRate: 200 },
      { type: "2-Bedroom", count: 18, baseRate: 255 },
      { type: "3-Bedroom", count: 6, baseRate: 318 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/maribyrnong/quest-maribyrnong",
  },
  {
    id: "quest-melbourne-airport",
    name: "Quest Melbourne Airport",
    address: "20 Annandale Road",
    suburb: "Melbourne Airport",
    city: "Melbourne",
    state: "VIC",
    postcode: "3045",
    shortDescription: "Airport stay with larger apartment options, transfers, and conference facilities for stopovers and business travel.",
    description: "Quest Melbourne Airport is less than 10 minutes from the terminal precinct and offers spacious serviced apartments from Studios to 3-Bedroom layouts. Airport transfers, on-site parking, 24-hour check-in, and large meeting and conference facilities make it ideal for transit and corporate stays.",
    coordinates: { lat: -37.6866, lng: 144.8587 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 22, baseRate: 178 },
      { type: "1-Bedroom", count: 36, baseRate: 220 },
      { type: "2-Bedroom", count: 24, baseRate: 280 },
      { type: "3-Bedroom", count: 14, baseRate: 345 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Conference Room", "Airport Transfer", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/melbourne-airport/quest-melbourne-airport",
  },
  {
    id: "quest-moorabbin",
    name: "Quest Moorabbin",
    address: "3 Kingston Road",
    suburb: "Heatherton",
    city: "Melbourne",
    state: "VIC",
    postcode: "3202",
    shortDescription: "South-east Melbourne apartments near beaches and health precincts, with gym and apartment flexibility.",
    description: "Quest Moorabbin is close to Monash Health Kingston Centre, Moorabbin Airport, Southland, and bayside attractions. Spacious serviced apartments from Studios to 3-Bedroom options include kitchen facilities, while the property also offers gym access and business-friendly convenience.",
    coordinates: { lat: -37.9566, lng: 145.0975 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 158 },
      { type: "1-Bedroom", count: 24, baseRate: 198 },
      { type: "2-Bedroom", count: 14, baseRate: 252 },
      { type: "3-Bedroom", count: 6, baseRate: 315 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Pantry Service", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/heatherton/quest-moorabbin",
  },
  {
    id: "quest-newquay",
    name: "Quest NewQuay",
    address: "26 Caravel Lane",
    suburb: "Docklands",
    city: "Melbourne",
    state: "VIC",
    postcode: "3008",
    shortDescription: "Docklands apartment hotel near Southern Cross and the waterfront, with gym and easy airport access.",
    description: "Quest NewQuay offers serviced apartments in Docklands close to Melbourne CBD, waterfront dining, Costco, Woolworths, and Southern Cross Station. Guests benefit from kitchen facilities, on-site gym access, and convenient transport links to the airport and city attractions.",
    coordinates: { lat: -37.8147, lng: 144.9438 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 182 },
      { type: "1-Bedroom", count: 28, baseRate: 228 },
      { type: "2-Bedroom", count: 18, baseRate: 288 },
      { type: "3-Bedroom", count: 6, baseRate: 355 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/docklands/quest-newquay/",
  },
  {
    id: "quest-notting-hill",
    name: "Quest Notting Hill",
    address: "5 Acacia Place, Ferntree Business Park",
    suburb: "Notting Hill",
    city: "Melbourne",
    state: "VIC",
    postcode: "3168",
    shortDescription: "Monash corridor apartments with gym, BBQ, and business lounge, suited to families and corporate stays.",
    description: "Quest Notting Hill is ideally placed for Monash University, Chadstone, and the M1, while still offering a quieter suburban base. Spacious serviced apartments with full kitchen and laundry facilities are supported by gym, BBQ facilities, secure parking, and a business lounge.",
    coordinates: { lat: -37.9017, lng: 145.1461 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 160 },
      { type: "1-Bedroom", count: 42, baseRate: 202 },
      { type: "2-Bedroom", count: 28, baseRate: 258 },
      { type: "3-Bedroom", count: 10, baseRate: 322 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Business Lounge", "BBQ Area", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/notting-hill/quest-notting-hill/",
  },
  {
    id: "quest-st-kilda-bayside",
    name: "Quest St Kilda Bayside",
    address: "1 Eildon Road",
    suburb: "St Kilda",
    city: "Melbourne",
    state: "VIC",
    postcode: "3182",
    shortDescription: "Leafy St Kilda retreat near Acland Street and the beach, with gym and a seasonal outdoor pool.",
    description: "Quest St Kilda Bayside offers a quiet base close to the beach, Fitzroy Street, Acland Street dining, and Melbourne’s bayside attractions. Modern serviced apartments with kitchen and laundry amenities are supported by gym access and a solar-heated outdoor pool in summer.",
    coordinates: { lat: -37.8662, lng: 144.9793 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 172 },
      { type: "1-Bedroom", count: 24, baseRate: 218 },
      { type: "2-Bedroom", count: 12, baseRate: 275 },
      { type: "3-Bedroom", count: 4, baseRate: 340 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/st-kilda/quest-st-kilda-bayside",
  },
  {
    id: "quest-st-kilda-road",
    name: "Quest St Kilda Road",
    address: "478 St Kilda Road",
    suburb: "Melbourne",
    city: "Melbourne",
    state: "VIC",
    postcode: "3004",
    shortDescription: "City-edge Melbourne apartments on St Kilda Road with gym, parking, and easy tram access.",
    description: "Quest St Kilda Road offers peaceful city-fringe accommodation close to the Domain precinct, Albert Park Lake, and the Royal Botanic Gardens. Fully serviced apartments with kitchen and laundry facilities are paired with on-site gym access and secure parking.",
    coordinates: { lat: -37.8399, lng: 144.9771 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 180 },
      { type: "1-Bedroom", count: 30, baseRate: 225 },
      { type: "2-Bedroom", count: 18, baseRate: 285 },
      { type: "3-Bedroom", count: 6, baseRate: 350 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/melbourne/quest-st-kilda-rd",
  },
  {
    id: "quest-watergardens",
    name: "Quest Watergardens",
    address: "451 Kings Rd",
    suburb: "Taylors Lakes",
    city: "Melbourne",
    state: "VIC",
    postcode: "3038",
    shortDescription: "North-west Melbourne apartments with gym and pantry service, close to transport and shopping.",
    description: "Quest Watergardens provides stylish apartment-style accommodation in Taylors Lakes with quick transport access into Melbourne and convenient local shopping nearby. On-site gym, guest laundry, and pantry service support comfortable short and longer stays.",
    coordinates: { lat: -37.7006, lng: 144.7827 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 152 },
      { type: "1-Bedroom", count: 34, baseRate: 192 },
      { type: "2-Bedroom", count: 22, baseRate: 245 },
      { type: "3-Bedroom", count: 10, baseRate: 308 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Pantry Service", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/taylors-lakes/quest-watergardens",
  },
  {
    id: "quest-werribee",
    name: "Quest Werribee",
    address: "69 Synnot Street",
    suburb: "Werribee",
    city: "Melbourne",
    state: "VIC",
    postcode: "3030",
    shortDescription: "Bayside-west Melbourne apartments near Watton Street, with gym and family-friendly room options.",
    description: "Quest Werribee is close to Watton Street dining, Werribee Open Range Zoo, wineries, and bayside attractions. Serviced apartments from Studios to 3-Bedroom options include kitchen facilities, while the property also features on-site gym access.",
    coordinates: { lat: -37.8995, lng: 144.6622 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 155 },
      { type: "1-Bedroom", count: 18, baseRate: 195 },
      { type: "2-Bedroom", count: 12, baseRate: 248 },
      { type: "3-Bedroom", count: 7, baseRate: 312 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/werribee/quest-werribee",
  },
  {
    id: "quest-wodonga",
    name: "Quest Wodonga",
    address: "46 Reid Street",
    suburb: "Wodonga",
    city: "Wodonga",
    state: "VIC",
    postcode: "3690",
    shortDescription: "Border-region apartments with pool, gym, and conference facilities, ideal for alpine and Murray stays.",
    description: "Quest Wodonga is a strong regional base for snow trips, Murray River stays, and food and wine exploration across north-east Victoria. Modern 1-, 2-, and 3-Bedroom serviced apartments are complemented by an outdoor swimming pool, gym, and conference facilities.",
    coordinates: { lat: -36.1200, lng: 146.8851 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 32, baseRate: 168 },
      { type: "2-Bedroom", count: 28, baseRate: 215 },
      { type: "3-Bedroom", count: 19, baseRate: 275 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/wodonga/quest-wodonga",
  },
  {
    id: "quest-bendigo",
    name: "Quest Bendigo",
    address: "489 High Street",
    suburb: "Bendigo",
    city: "Bendigo",
    state: "VIC",
    postcode: "3550",
    shortDescription: "Family-friendly Bendigo stay with heated pool and spacious apartments close to the CBD.",
    description: "Quest Bendigo is a family-friendly apartment hotel just outside central Bendigo, with easy access to cafés, arts precincts, gold rush attractions, and local entertainment. Spacious apartments are complemented by a heated pool, secure grounds, BBQ-friendly outdoor areas, and a convenient regional location.",
    coordinates: { lat: -36.7809, lng: 144.2917 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 138 },
      { type: "1-Bedroom", count: 26, baseRate: 175 },
      { type: "2-Bedroom", count: 16, baseRate: 225 },
      { type: "3-Bedroom", count: 8, baseRate: 288 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "BBQ Area", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/bendigo/quest-bendigo",
  },
  {
    id: "quest-burwood-east",
    name: "Quest Burwood East",
    address: "315 Burwood Highway",
    suburb: "Burwood East",
    city: "Melbourne",
    state: "VIC",
    postcode: "3151",
    shortDescription: "East Melbourne apartment hotel with gym and secure parking, ideal for business and family stays.",
    description: "Quest Burwood East offers contemporary apartment-style accommodation in Melbourne’s leafy east, with good access to Tally Ho Business Park, shopping centres, and parklands. Spacious rooms with kitchen facilities, on-site gym, and secure parking support short and long stays.",
    coordinates: { lat: -37.8519, lng: 145.1518 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 160 },
      { type: "1-Bedroom", count: 34, baseRate: 200 },
      { type: "2-Bedroom", count: 20, baseRate: 255 },
      { type: "3-Bedroom", count: 8, baseRate: 318 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/burwood/quest-burwood-east",
  },
  {
    id: "quest-dandenong",
    name: "Quest Dandenong",
    address: "2-6 James Street",
    suburb: "Dandenong",
    city: "Melbourne",
    state: "VIC",
    postcode: "3175",
    shortDescription: "South-east Melbourne base near markets and regional gateways, with pool and kitchen-equipped apartments.",
    description: "Quest Dandenong offers convenient access to Melbourne, the Mornington Peninsula, Gippsland, and the Dandenong Ranges. Spacious serviced apartments with kitchen facilities are paired with an on-site pool and a location close to the area’s famous market and multicultural dining scene.",
    coordinates: { lat: -37.9866, lng: 145.2154 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 148 },
      { type: "1-Bedroom", count: 14, baseRate: 188 },
      { type: "2-Bedroom", count: 10, baseRate: 242 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/dandenong/quest-dandenong/",
  },
  {
    id: "quest-dandenong-central",
    name: "Quest Dandenong Central",
    address: "2-10 Walker Street",
    suburb: "Dandenong",
    city: "Melbourne",
    state: "VIC",
    postcode: "3175",
    shortDescription: "Newer Dandenong stay with gym and modern apartments, suited to business and longer visits.",
    description: "Quest Dandenong Central places guests near Dandenong Market and key transport links into Melbourne and regional Victoria. Spacious modern serviced apartments are complemented by an on-site gym and a practical location for both short and extended stays.",
    coordinates: { lat: -37.9878, lng: 145.2141 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 152 },
      { type: "1-Bedroom", count: 26, baseRate: 192 },
      { type: "2-Bedroom", count: 16, baseRate: 248 },
      { type: "3-Bedroom", count: 8, baseRate: 308 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/dandenong/quest-dandenong-central",
  },
  {
    id: "quest-preston",
    name: "Quest Preston",
    address: "520 High Street",
    suburb: "Preston",
    city: "Melbourne",
    state: "VIC",
    postcode: "3072",
    shortDescription: "Inner-north Melbourne apartments with gym and accessible options, close to local dining and shopping.",
    description: "Quest Preston is a modern apartment hotel in Melbourne’s inner north, close to local cafés, shopping strips, and transport into the city. Studio, 1-, and 2-Bedroom options, accessible apartments, gym access, and guest laundry make it a flexible city-fringe base.",
    coordinates: { lat: -37.7382, lng: 145.0004 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 24, baseRate: 158 },
      { type: "1-Bedroom", count: 34, baseRate: 198 },
      { type: "2-Bedroom", count: 21, baseRate: 252 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Accessible Rooms", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/preston/quest-preston",
  },
  {
    id: "quest-sale",
    name: "Quest Sale",
    address: "180-184 York Street",
    suburb: "Sale",
    city: "Sale",
    state: "VIC",
    postcode: "3850",
    shortDescription: "Gippsland regional apartments with pool and gym, centrally located near gardens and galleries.",
    description: "Quest Sale offers a central base in one of Gippsland’s key regional cities, close to gardens, art galleries, and local cafés. Spacious serviced apartments are supported by a solar-heated swimming pool, on-site car parking, complimentary WiFi, and gym access.",
    coordinates: { lat: -38.1116, lng: 147.0685 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 145 },
      { type: "1-Bedroom", count: 24, baseRate: 185 },
      { type: "2-Bedroom", count: 12, baseRate: 238 },
      { type: "3-Bedroom", count: 5, baseRate: 295 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/sale/quest-sale",
  },
  {
    id: "quest-brighton-on-the-bay",
    name: "Quest Brighton on the Bay",
    address: "250 Esplanade",
    suburb: "Brighton",
    city: "Melbourne",
    state: "VIC",
    postcode: "3186",
    shortDescription: "Bayside Melbourne stay near the beach and station, with apartment options from Studio to 3-Bedroom.",
    description: "Quest Brighton on the Bay offers a bayside Melbourne base close to beaches, Middle Brighton Station, boutique shopping, and local dining. Serviced apartments range from Studio to 3-Bedroom options and provide a relaxed coastal alternative to staying in the CBD.",
    coordinates: { lat: -37.9182, lng: 144.9869 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 175 },
      { type: "1-Bedroom", count: 24, baseRate: 218 },
      { type: "2-Bedroom", count: 14, baseRate: 275 },
      { type: "3-Bedroom", count: 5, baseRate: 338 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/brighton/quest-brighton-on-the-bay",
  },
  {
    id: "quest-caroline-springs",
    name: "Quest Caroline Springs",
    address: "234 Caroline Springs Boulevard",
    suburb: "Caroline Springs",
    city: "Melbourne",
    state: "VIC",
    postcode: "3023",
    shortDescription: "West Melbourne apartments near shops and creek-side parklands, suited to short and extended stays.",
    description: "Quest Caroline Springs is centrally located at CS Square with easy access to local shopping, entertainment, and parklands west of Melbourne. Light-filled serviced apartments with kitchen facilities make it a practical option for both business trips and longer residential-style stays.",
    coordinates: { lat: -37.7295, lng: 144.7415 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 150 },
      { type: "1-Bedroom", count: 34, baseRate: 188 },
      { type: "2-Bedroom", count: 20, baseRate: 242 },
      { type: "3-Bedroom", count: 8, baseRate: 305 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/caroline-springs/quest-caroline-springs",
  },
  {
    id: "quest-echuca",
    name: "Quest Echuca",
    address: "25-29 Heygarth Street",
    suburb: "Echuca",
    city: "Echuca",
    state: "VIC",
    postcode: "3564",
    shortDescription: "Murray River heritage-town apartments with pool, ideal for regional escapes and longer stays.",
    description: "Quest Echuca is centrally located in one of Victoria’s best-known river towns, close to heritage attractions, cafés, and scenic riverside trails. Modern serviced apartments with kitchen facilities are complemented by an on-site pool and a comfortable regional setting.",
    coordinates: { lat: -36.1277, lng: 144.7483 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 145 },
      { type: "1-Bedroom", count: 24, baseRate: 182 },
      { type: "2-Bedroom", count: 14, baseRate: 235 },
      { type: "3-Bedroom", count: 6, baseRate: 292 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/echuca/quest-echuca",
  },
  {
    id: "quest-ivanhoe",
    name: "Quest Ivanhoe",
    address: "72-84 Upper Heidelberg Road",
    suburb: "Ivanhoe",
    city: "Melbourne",
    state: "VIC",
    postcode: "3079",
    shortDescription: "North-east Melbourne apartments with separate living areas, close to hospitals, parks, and the CBD.",
    description: "Quest Ivanhoe sits in the heart of Ivanhoe’s shopping precinct with easy access to Melbourne’s north-east, Heide Museum, parklands, and hospital campuses. Spacious Studio, 1-, and 2-Bedroom serviced apartments include separate lounge and dining areas plus full kitchen and laundry facilities.",
    coordinates: { lat: -37.7683, lng: 145.0419 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 158 },
      { type: "1-Bedroom", count: 30, baseRate: 198 },
      { type: "2-Bedroom", count: 17, baseRate: 252 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/ivanhoe/quest-ivanhoe",
  },
  {
    id: "quest-jolimont",
    name: "Quest Jolimont",
    address: "153-155 Wellington Parade South",
    suburb: "East Melbourne",
    city: "Melbourne",
    state: "VIC",
    postcode: "3002",
    shortDescription: "Compact East Melbourne stay near the MCG and parklands, ideal for city breaks and event travel.",
    description: "Quest Jolimont is surrounded by Birrarung Marr, the MCG, Fitzroy Gardens, and the sporting precinct while remaining close to central Melbourne. Modern serviced apartments with kitchen facilities provide a quiet inner-city base in a heritage-rich part of town.",
    coordinates: { lat: -37.8162, lng: 144.9838 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 8, baseRate: 185 },
      { type: "1-Bedroom", count: 8, baseRate: 228 },
      { type: "2-Bedroom", count: 4, baseRate: 285 },
    ],
    amenities: ["WiFi", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: false, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/east-melbourne/quest-jolimont",
  },
  {
    id: "quest-mildura",
    name: "Quest Mildura",
    address: "115-119 Madden Ave",
    suburb: "Mildura",
    city: "Mildura",
    state: "VIC",
    postcode: "3500",
    shortDescription: "Mildura city-centre apartments near the Murray River, with pool and easy access to wine country.",
    description: "Quest Mildura offers a central base in one of regional Victoria’s key food and wine destinations, close to the Murray River, arts centre, brewery, and local gardens. Serviced apartments with kitchen facilities are complemented by an outdoor pool and practical parking access.",
    coordinates: { lat: -34.1847, lng: 142.1598 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 148 },
      { type: "1-Bedroom", count: 24, baseRate: 185 },
      { type: "2-Bedroom", count: 14, baseRate: 238 },
      { type: "3-Bedroom", count: 6, baseRate: 295 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/mildura/quest-mildura",
  },
  {
    id: "quest-mont-albert",
    name: "Quest Mont Albert",
    address: "741-745 Whitehorse Road",
    suburb: "Mont Albert",
    city: "Melbourne",
    state: "VIC",
    postcode: "3127",
    shortDescription: "East Melbourne apartments with gym, conference facilities, and pet-friendly options.",
    description: "Quest Mont Albert is a convenient eastern-suburbs base near Box Hill, parklands, shopping, and public transport into the city. Fully serviced apartments, including pet-friendly rooms, are supported by gym access, secure parking, conference facilities, and complimentary WiFi.",
    coordinates: { lat: -37.8176, lng: 145.1086 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 162 },
      { type: "1-Bedroom", count: 22, baseRate: 202 },
      { type: "2-Bedroom", count: 12, baseRate: 258 },
      { type: "3-Bedroom", count: 4, baseRate: 320 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Pet Friendly", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/mont-albert/quest-mont-albert",
  },
  {
    id: "quest-moonee-valley",
    name: "Quest Moonee Valley",
    address: "7 Feehan Avenue",
    suburb: "Moonee Ponds",
    city: "Melbourne",
    state: "VIC",
    postcode: "3039",
    shortDescription: "Racecourse-side apartments between Melbourne CBD and airport, with flexible room layouts and parking.",
    description: "Quest Moonee Valley offers stylish serviced apartment accommodation opposite the racecourse and within easy reach of Melbourne Airport and the CBD. Studio, 1-, 2-, and 3-Bedroom options with kitchen facilities provide a comfortable inner-west base for short or longer stays.",
    coordinates: { lat: -37.7655, lng: 144.9256 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 162 },
      { type: "1-Bedroom", count: 22, baseRate: 202 },
      { type: "2-Bedroom", count: 16, baseRate: 258 },
      { type: "3-Bedroom", count: 9, baseRate: 320 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/moonee-ponds/quest-moonee-valley/",
  },
  {
    id: "quest-narre-warren",
    name: "Quest Narre Warren",
    address: "Corner Princes Highway & Verdun Drive",
    suburb: "Narre Warren",
    city: "Melbourne",
    state: "VIC",
    postcode: "3805",
    shortDescription: "South-east Melbourne regional gateway apartments with kitchen facilities and easy access to Gippsland.",
    description: "Quest Narre Warren is well positioned for trips to the Dandenong Ranges, Gippsland, and Melbourne’s outer south-east. Modern serviced apartments with kitchen and laundry facilities are close to Fountain Gate, local dining, and key transport links.",
    coordinates: { lat: -38.0323, lng: 145.3040 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 14, baseRate: 155 },
      { type: "2-Bedroom", count: 14, baseRate: 198 },
      { type: "3-Bedroom", count: 7, baseRate: 255 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/narre-warren/quest-narre-warren",
  },
  {
    id: "quest-on-dorcas",
    name: "Quest on Dorcas",
    address: "8 Dorcas Street",
    suburb: "South Melbourne",
    city: "Melbourne",
    state: "VIC",
    postcode: "3205",
    shortDescription: "Inner-city South Melbourne apartments near the arts and sporting precincts, with gym access.",
    description: "Quest on Dorcas is close to Southbank, Albert Park, the Arts Precinct, and Melbourne’s major stadiums while still offering a quieter place to stay. Stylish serviced apartments with kitchen facilities are complemented by an on-site gym and easy tram access to the city.",
    coordinates: { lat: -37.8316, lng: 144.9691 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 182 },
      { type: "1-Bedroom", count: 20, baseRate: 228 },
      { type: "2-Bedroom", count: 12, baseRate: 285 },
      { type: "3-Bedroom", count: 5, baseRate: 348 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/south-melbourne/quest-on-dorcas",
  },
  {
    id: "quest-on-william",
    name: "Quest on William",
    address: "172 William Street",
    suburb: "Melbourne CBD",
    city: "Melbourne",
    state: "VIC",
    postcode: "3000",
    shortDescription: "Central Melbourne CBD apartments with gym and larger room options near markets and Southbank.",
    description: "Quest on William offers a highly central Melbourne CBD location within walking distance of Queen Victoria Market, Southbank, the Arts Precinct, and major shopping streets. Modern serviced apartments from Studio to 3-Bedroom layouts are supported by on-site gym access and parking.",
    coordinates: { lat: -37.8125, lng: 144.9603 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 190 },
      { type: "1-Bedroom", count: 28, baseRate: 235 },
      { type: "2-Bedroom", count: 18, baseRate: 295 },
      { type: "3-Bedroom", count: 8, baseRate: 362 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/melbourne/quest-on-william",
  },
  {
    id: "quest-prahran",
    name: "Quest Prahran",
    address: "9 Balmoral Street",
    suburb: "South Yarra",
    city: "Melbourne",
    state: "VIC",
    postcode: "3141",
    shortDescription: "Inner-south Melbourne apartments near Chapel Street, with gym and multi-bedroom options.",
    description: "Quest Prahran is within walking distance of Chapel Street, Prahran Market, and the St Kilda Road business district. Spacious serviced apartments with kitchen facilities, on-site gym access, and close proximity to Melbourne’s sporting and entertainment precincts make it a versatile base.",
    coordinates: { lat: -37.8495, lng: 144.9938 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 20, baseRate: 205 },
      { type: "2-Bedroom", count: 18, baseRate: 258 },
      { type: "3-Bedroom", count: 10, baseRate: 325 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/south-yarra/quest-prahran",
  },
  {
    id: "quest-sanctuary-lakes",
    name: "Quest Sanctuary Lakes",
    address: "9 Greg Norman Drive",
    suburb: "Sanctuary",
    city: "Melbourne",
    state: "VIC",
    postcode: "3030",
    shortDescription: "Bayside-west retreat with indoor pool, spa, tennis, and gym, ideal for relaxed Melbourne stays.",
    description: "Quest Sanctuary Lakes is a quiet bayside-west Melbourne base close to wetlands, coastal parklands, and the city’s western growth corridor. Stylish serviced apartments are complemented by an indoor swimming pool, spa, tennis courts, gym, and complimentary WiFi.",
    coordinates: { lat: -37.8721, lng: 144.7433 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 165 },
      { type: "1-Bedroom", count: 18, baseRate: 208 },
      { type: "2-Bedroom", count: 10, baseRate: 262 },
      { type: "3-Bedroom", count: 6, baseRate: 325 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Spa", "Tennis Court", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/sanctuary/quest-sanctuary-lakes/meeting-and-conferences",
  },
  {
    id: "quest-portland",
    name: "Quest Portland",
    address: "66 Julia Street",
    suburb: "Portland",
    city: "Portland",
    state: "VIC",
    postcode: "3305",
    shortDescription: "Seaside south-west Victoria apartments with pool, close to beaches, golf, and heritage streetscapes.",
    description: "Quest Portland is a comfortable base in one of Victoria’s oldest coastal towns, close to beaches, fishing, whale-watching, and the region’s striking blue-stone heritage architecture. Spacious serviced apartments with full kitchen and laundry facilities are complemented by an on-site pool and easy walkability to town.",
    coordinates: { lat: -38.3457, lng: 141.6030 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 145 },
      { type: "1-Bedroom", count: 20, baseRate: 182 },
      { type: "2-Bedroom", count: 12, baseRate: 235 },
      { type: "3-Bedroom", count: 5, baseRate: 292 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/portland/quest-portland",
  },
  {
    id: "quest-shepparton",
    name: "Quest Shepparton",
    address: "177-183 Welsford Street",
    suburb: "Shepparton",
    city: "Shepparton",
    state: "VIC",
    postcode: "3630",
    shortDescription: "North-east Victoria apartments with housekeeping and kitchen facilities, centrally located near river and dining.",
    description: "Quest Shepparton is centrally positioned in one of north-east Victoria’s key regional hubs, close to the Goulburn River, local food and wine experiences, and the city centre. Spacious serviced apartments with kitchen and laundry facilities, housekeeping, and complimentary WiFi support comfortable short and long stays.",
    coordinates: { lat: -36.3802, lng: 145.3985 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 145 },
      { type: "1-Bedroom", count: 28, baseRate: 185 },
      { type: "2-Bedroom", count: 16, baseRate: 238 },
      { type: "3-Bedroom", count: 9, baseRate: 298 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Housekeeping", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/shepparton/quest-shepparton",
  },
  {
    id: "quest-wangaratta",
    name: "Quest Wangaratta",
    address: "12 Docker St",
    suburb: "Wangaratta",
    city: "Wangaratta",
    state: "VIC",
    postcode: "3677",
    shortDescription: "Regional Victorian apartments with gym and BBQ area, ideal for snow, river, and wine-country escapes.",
    description: "Quest Wangaratta is located close to the station and Hume Freeway in one of north-east Victoria’s key regional centres. Airy serviced apartments, daily housekeeping, an on-site gym, and BBQ area make it a practical base for business travel, alpine trips, and food-and-wine weekends.",
    coordinates: { lat: -36.3556, lng: 146.3192 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 148 },
      { type: "1-Bedroom", count: 28, baseRate: 188 },
      { type: "2-Bedroom", count: 18, baseRate: 242 },
      { type: "3-Bedroom", count: 8, baseRate: 305 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Housekeeping", "BBQ Area", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/wangaratta/quest-wangaratta",
  },
  {
    id: "quest-warrnambool",
    name: "Quest Warrnambool",
    address: "15-19 Liebig Street",
    suburb: "Warrnambool",
    city: "Warrnambool",
    state: "VIC",
    postcode: "3280",
    shortDescription: "Great Ocean Road-region apartments near beaches and dining, suited to coastal getaways.",
    description: "Quest Warrnambool is a south-west Victoria base close to beaches, shops, parklands, and the wider Great Ocean Road region. Large serviced apartments with kitchen and laundry facilities provide comfortable accommodation for couples, families, and regional visitors.",
    coordinates: { lat: -38.3822, lng: 142.4824 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 150 },
      { type: "1-Bedroom", count: 18, baseRate: 188 },
      { type: "2-Bedroom", count: 10, baseRate: 242 },
      { type: "3-Bedroom", count: 4, baseRate: 300 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/warrnambool/quest-warrnambool",
  },
  {
    id: "quest-williamstown-north",
    name: "Quest Williamstown North",
    address: "115 Kororoit Creek Road",
    suburb: "Williamstown",
    city: "Melbourne",
    state: "VIC",
    postcode: "3016",
    shortDescription: "Waterside west Melbourne apartments with pool and spa, close to Williamstown and nature reserve walks.",
    description: "Quest Williamstown North offers a peaceful base beside Jawbone Nature Reserve and close to historic Williamstown, the foreshore, and western Melbourne attractions. Spacious apartments with full kitchen and laundry facilities are supported by a solar-heated pool, spa, BBQ area, and pantry shopping service.",
    coordinates: { lat: -37.8608, lng: 144.8844 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 22, baseRate: 175 },
      { type: "2-Bedroom", count: 24, baseRate: 222 },
      { type: "3-Bedroom", count: 16, baseRate: 282 },
    ],
    amenities: ["WiFi", "Pool", "Spa", "Parking", "Kitchen", "Laundry", "BBQ Area", "Pantry Service", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/vic/williamstown/quest-williamstown-north",
  },

  // ── QUEENSLAND ───────────────────────────────────────────
  {
    id: "quest-kelvin-grove",
    name: "Quest Kelvin Grove",
    address: "41 Ramsgate Street",
    suburb: "Kelvin Grove",
    city: "Brisbane",
    state: "QLD",
    postcode: "4059",
    shortDescription: "Central Brisbane near Suncorp Stadium, Victoria Park. 15 mins from Airport. Gym and pool.",
    description: "Quest Kelvin Grove is 15 minutes from Brisbane Airport. Access to the local restaurant precinct, Village Market, Suncorp Stadium, Victoria Park, La Boite Theatre, RNA Showgrounds, and Brisbane CBD. Refurbished rooms with gym, pool, and conference facilities.",
    coordinates: { lat: -27.4519, lng: 153.0149 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 160 },
      { type: "1-Bedroom", count: 35, baseRate: 200 },
      { type: "2-Bedroom", count: 20, baseRate: 260 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/kelvin-grove/quest-kelvin-grove",
  },
  {
    id: "quest-ascot",
    name: "Quest Ascot",
    address: "289 Lancaster Road",
    suburb: "Ascot",
    city: "Brisbane",
    state: "QLD",
    postcode: "4007",
    shortDescription: "Peaceful inner-Brisbane retreat near the airport and racecourse. 25 apartments, pool.",
    description: "Set back from the Brisbane River in one of Brisbane's oldest suburbs, Quest Ascot is a peaceful retreat. Only 10 minutes from the airport. 25 spacious serviced apartments with pool and kitchen facilities. Close to Ascot's alfresco restaurants, bars, and cafés. 15 minutes to Brisbane CBD.",
    coordinates: { lat: -27.4289, lng: 153.0714 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 8, baseRate: 150 },
      { type: "1-Bedroom", count: 12, baseRate: 190 },
      { type: "2-Bedroom", count: 5, baseRate: 245 },
    ],
    amenities: ["WiFi", "Pool", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: false, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/ascot/quest-ascot",
  },
  {
    id: "quest-eight-mile-plains",
    name: "Quest Eight Mile Plains",
    address: "1 Clunies Ross Court",
    suburb: "Eight Mile Plains",
    city: "Brisbane",
    state: "QLD",
    postcode: "4113",
    shortDescription: "Brand new apartments 20 mins from Brisbane CBD. Easy access to Gold Coast. Gym, 24/7 management.",
    description: "Just 20 minutes from Brisbane's CBD, Quest Eight Mile Plains has 90 brand new serviced apartments — kitchenettes to full kitchens and laundry. On-site gym and 24/7 management. Easy access to both Brisbane and the Gold Coast. Short walk to Westfield Mt Gravatt.",
    coordinates: { lat: -27.5750, lng: 153.0835 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 25, baseRate: 145 },
      { type: "1-Bedroom", count: 40, baseRate: 185 },
      { type: "2-Bedroom", count: 25, baseRate: 240 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/eight-mile-plains/quest-eight-mile-plains",
  },
  {
    id: "quest-chermside",
    name: "Quest Chermside",
    address: "9 Thomas Street",
    suburb: "Chermside",
    city: "Brisbane",
    state: "QLD",
    postcode: "4032",
    shortDescription: "Prime Brisbane north. 54 rooms opposite Westfield Chermside, 15 mins from airport.",
    description: "Quest Chermside offers a prime position just 15 minutes from Brisbane Airport, opposite Westfield Chermside — one of Brisbane's largest shopping centres. 54 light-filled rooms with kitchenettes to full kitchens and laundry. Sandgate-Brighton Foreshore 20 minutes away.",
    coordinates: { lat: -27.3871, lng: 153.0244 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 15, baseRate: 140 },
      { type: "1-Bedroom", count: 25, baseRate: 178 },
      { type: "2-Bedroom", count: 14, baseRate: 230 },
    ],
    amenities: ["WiFi", "Kitchen", "Laundry", "Air Conditioning", "Parking"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/chermside/quest-chermside",
  },
  {
    id: "quest-breakfast-creek",
    name: "Quest Breakfast Creek",
    address: "15 Amy Street",
    suburb: "Albion",
    city: "Brisbane",
    state: "QLD",
    postcode: "4010",
    shortDescription: "River-facing Brisbane stay opposite the iconic Breakfast Creek Hotel, with pool and gym.",
    description: "Quest Breakfast Creek offers light-filled serviced apartment accommodation with views across the water, close to Brisbane’s CBD, river walks, and local dining favourites. Guests can enjoy fully equipped kitchens, an on-site pool and gym, and easy access for short or longer stays.",
    coordinates: { lat: -27.4371, lng: 153.0456 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 24, baseRate: 158 },
      { type: "1-Bedroom", count: 46, baseRate: 198 },
      { type: "2-Bedroom", count: 28, baseRate: 255 },
      { type: "3-Bedroom", count: 7, baseRate: 320 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/albion/quest-breakfast-creek",
  },
  {
    id: "quest-cannon-hill",
    name: "Quest Cannon Hill",
    address: "930 Wynumm Road",
    suburb: "Cannon Hill",
    city: "Brisbane",
    state: "QLD",
    postcode: "4170",
    shortDescription: "Brisbane inner-east location near rail links and South Bank, with parking and gym access nearby.",
    description: "Quest Cannon Hill is positioned in Brisbane’s inner east with convenient access to train services, nearby dining, and easy connections to South Bank, Wynnum, and Manly. The property offers serviced apartment comfort with parking and convenient access to fitness and business travel needs.",
    coordinates: { lat: -27.4717, lng: 153.0940 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 150 },
      { type: "1-Bedroom", count: 34, baseRate: 188 },
      { type: "2-Bedroom", count: 18, baseRate: 242 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/cannon-hill/quest-cannon-hill/meeting-and-conferences",
  },
  {
    id: "quest-ipswich",
    name: "Quest Ipswich",
    address: "57-63 Warwick Rd",
    suburb: "Ipswich",
    city: "Ipswich",
    state: "QLD",
    postcode: "4305",
    shortDescription: "Heritage-city Ipswich apartments with pool and conference room, suited to short and extended stays.",
    description: "Quest Ipswich is close to parks, galleries, hospitals, and rail connections in one of Queensland’s oldest heritage centres. Serviced apartments range from kitchenette layouts to larger full-kitchen options, while the property also offers a pool and conference facilities.",
    coordinates: { lat: -27.6166, lng: 152.7569 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 145 },
      { type: "1-Bedroom", count: 28, baseRate: 185 },
      { type: "2-Bedroom", count: 14, baseRate: 238 },
      { type: "3-Bedroom", count: 4, baseRate: 298 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/ipswich/quest-ipswich",
  },
  {
    id: "quest-mackay-on-gordon",
    name: "Quest Mackay on Gordon",
    address: "27 Gordon Street",
    suburb: "Mackay",
    city: "Mackay",
    state: "QLD",
    postcode: "4740",
    shortDescription: "Tropical Mackay CBD stay with pool and gym, ideal for reef, business, and coastal travel.",
    description: "Quest Mackay on Gordon is in the heart of Mackay, close to shops, cafés, and restaurants, with easy access to the Great Barrier Reef and regional natural attractions. Stylish serviced apartment rooms with kitchen facilities, plus an on-site pool and gym, provide a comfortable base.",
    coordinates: { lat: -21.1410, lng: 149.1867 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 150 },
      { type: "1-Bedroom", count: 32, baseRate: 190 },
      { type: "2-Bedroom", count: 14, baseRate: 245 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/mackay/quest-mackay-on-gordon",
  },
  {
    id: "quest-river-park-central",
    name: "Quest River Park Central",
    address: "120 Mary Street",
    suburb: "Brisbane CBD",
    city: "Brisbane",
    state: "QLD",
    postcode: "4000",
    shortDescription: "Central Brisbane stay with heated pool, gym, and cinema room, close to dining and riverside attractions.",
    description: "Quest River Park Central places guests in the middle of Brisbane’s CBD, close to dining, museums, galleries, and riverside markets. Stylish serviced apartments with kitchen facilities are paired with a heated pool, gym, and an on-site cinema for both short city breaks and work trips.",
    coordinates: { lat: -27.4712, lng: 153.0275 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 165 },
      { type: "1-Bedroom", count: 24, baseRate: 205 },
      { type: "2-Bedroom", count: 12, baseRate: 262 },
      { type: "3-Bedroom", count: 5, baseRate: 325 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Cinema Room", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/brisbane/quest-river-park-central",
  },
  {
    id: "quest-robina",
    name: "Quest Robina",
    address: "3 Centreline Place",
    suburb: "Robina",
    city: "Gold Coast",
    state: "QLD",
    postcode: "4226",
    shortDescription: "Gold Coast hinterland-and-beach base with pool, gym, and conference facilities near Robina Town Centre.",
    description: "Quest Robina is a convenient Gold Coast base near shopping, dining, cinemas, beaches, and hinterland day trips. Pet-friendly serviced apartments with full kitchen facilities are supported by a heated outdoor pool, gym, and conference facilities for business and holiday travel alike.",
    coordinates: { lat: -28.0744, lng: 153.3825 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 168 },
      { type: "1-Bedroom", count: 34, baseRate: 210 },
      { type: "2-Bedroom", count: 20, baseRate: 268 },
      { type: "3-Bedroom", count: 8, baseRate: 335 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Pet Friendly", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/robina/quest-robina",
  },
  {
    id: "quest-rockhampton",
    name: "Quest Rockhampton",
    address: "48 Victoria Parade",
    suburb: "Rockhampton",
    city: "Rockhampton",
    state: "QLD",
    postcode: "4700",
    shortDescription: "Fitzroy River-facing Rockhampton apartments with gym and conference facilities for regional travel.",
    description: "Quest Rockhampton sits in a sought-after riverside position with views toward Mount Archer and easy access to the city’s restaurants and cafés. Spacious serviced apartments with kitchenettes to full kitchens, on-site parking, gym, and conference facilities support business and leisure stays.",
    coordinates: { lat: -23.3780, lng: 150.5118 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 145 },
      { type: "1-Bedroom", count: 32, baseRate: 185 },
      { type: "2-Bedroom", count: 16, baseRate: 238 },
      { type: "3-Bedroom", count: 5, baseRate: 298 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/rockhampton/quest-rockhampton",
  },
  {
    id: "quest-south-brisbane",
    name: "Quest South Brisbane",
    address: "46-50 Water Street",
    suburb: "South Brisbane",
    city: "Brisbane",
    state: "QLD",
    postcode: "4101",
    shortDescription: "Inner-Brisbane oasis near South Bank with pool, gym, and apartment-style rooms for city stays.",
    description: "Quest South Brisbane is a short walk from Streets Beach, museums, restaurants, riverfront attractions, and public transport. Spacious air-conditioned serviced apartments with kitchenettes to full kitchens are complemented by a 12-metre pool and on-site gym.",
    coordinates: { lat: -27.4821, lng: 153.0266 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 168 },
      { type: "1-Bedroom", count: 28, baseRate: 208 },
      { type: "2-Bedroom", count: 14, baseRate: 262 },
      { type: "3-Bedroom", count: 4, baseRate: 325 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/south-brisbane/quest-south-brisbane",
  },
  {
    id: "quest-springfield-central",
    name: "Quest Springfield Central",
    address: "4 Wellness Way",
    suburb: "Springfield Central",
    city: "Brisbane",
    state: "QLD",
    postcode: "4300",
    shortDescription: "South-west Brisbane growth-corridor apartments with gym, pantry service, and conference facilities.",
    description: "Quest Springfield Central sits within a fast-growing health and commercial precinct, with shops and natural escapes nearby. Spacious modern serviced apartments with kitchen facilities, pantry service, on-site gym, and conference facilities make it well suited to corporate and extended stays.",
    coordinates: { lat: -27.6814, lng: 152.9010 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 155 },
      { type: "1-Bedroom", count: 34, baseRate: 195 },
      { type: "2-Bedroom", count: 22, baseRate: 248 },
      { type: "3-Bedroom", count: 8, baseRate: 310 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Pantry Service", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/springfield/quest-springfield-central",
  },
  {
    id: "quest-toowoomba",
    name: "Quest Toowoomba",
    address: "133 Margaret Street",
    suburb: "Toowoomba",
    city: "Toowoomba",
    state: "QLD",
    postcode: "4350",
    shortDescription: "Garden city apartments in the heart of Toowoomba, with gym and conference facilities.",
    description: "Quest Toowoomba places guests close to parks, boutique cafés, shopping, and cultural attractions in Australia’s second-largest inland city. Modern serviced apartment rooms with kitchenettes through to kitchens are paired with an on-site gym and conference facilities.",
    coordinates: { lat: -27.5608, lng: 151.9536 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 148 },
      { type: "1-Bedroom", count: 30, baseRate: 188 },
      { type: "2-Bedroom", count: 18, baseRate: 238 },
      { type: "3-Bedroom", count: 6, baseRate: 298 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/toowoomba/quest-toowoomba",
  },
  {
    id: "quest-townsville-on-eyre",
    name: "Quest Townsville on Eyre",
    address: "19 Leichardt Street",
    suburb: "North Ward",
    city: "Townsville",
    state: "QLD",
    postcode: "4810",
    shortDescription: "Strand-side Townsville apartments with pool, gym, and conference centre near reef and island day trips.",
    description: "Quest Townsville on Eyre is close to The Strand, dining, beaches, and the transport links for Magnetic Island and reef experiences. Its serviced apartment-style rooms feature full-sized kitchen facilities, and guests also have access to a swimming pool, conference centre, and gym.",
    coordinates: { lat: -19.2488, lng: 146.8041 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 150 },
      { type: "1-Bedroom", count: 38, baseRate: 192 },
      { type: "2-Bedroom", count: 20, baseRate: 248 },
      { type: "3-Bedroom", count: 7, baseRate: 312 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/townsville/quest-townsville-on-eyre",
  },
  {
    id: "quest-woolloongabba",
    name: "Quest Woolloongabba",
    address: "130 Logan Road",
    suburb: "Woolloongabba",
    city: "Brisbane",
    state: "QLD",
    postcode: "4102",
    shortDescription: "Woolloongabba apartments with gym, rooftop terrace, and conference space near The Gabba and the CBD.",
    description: "Quest Woolloongabba is close to parklands, boutiques, cafés, and The Gabba, with easy access to Brisbane CBD by bus or train. Stylish serviced apartment-style rooms with kitchenettes through to full kitchens are supported by a gym, spacious conference facilities, and a rooftop terrace.",
    coordinates: { lat: -27.4910, lng: 153.0368 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 24, baseRate: 162 },
      { type: "1-Bedroom", count: 42, baseRate: 202 },
      { type: "2-Bedroom", count: 24, baseRate: 258 },
      { type: "3-Bedroom", count: 8, baseRate: 322 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Rooftop Terrace", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/woolloongabba/quest-woolloongabba",
  },
  {
    id: "quest-chermside-on-playfield",
    name: "Quest Chermside on Playfield",
    address: "38-40 Playfield Street",
    suburb: "Chermside",
    city: "Brisbane",
    state: "QLD",
    postcode: "4032",
    shortDescription: "North Brisbane apartments near Westfield and parks, with gym and conference facilities.",
    description: "Quest Chermside on Playfield provides stylish serviced-apartment accommodation close to Westfield Chermside, 7th Brigade Park, and Brisbane Airport. Full-sized kitchens, laundry facilities, on-site gym, and conference facilities make it suitable for families, business travellers, and longer stays.",
    coordinates: { lat: -27.3845, lng: 153.0281 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 152 },
      { type: "1-Bedroom", count: 32, baseRate: 192 },
      { type: "2-Bedroom", count: 20, baseRate: 248 },
      { type: "3-Bedroom", count: 6, baseRate: 310 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/qld/chermside/quest-chermside-on-playfield",
  },

  // ── AUSTRALIAN CAPITAL TERRITORY ─────────────────────────
  {
    id: "quest-canberra",
    name: "Quest Canberra",
    address: "28 West Row (Melbourne Building)",
    suburb: "Canberra City",
    city: "Canberra",
    state: "ACT",
    postcode: "2601",
    shortDescription: "Boutique heritage CBD apartments. Walk to National Gallery, Lake Burley Griffin, 2km to Parliament House.",
    description: "Quest Canberra is walking distance from Lake Burley Griffin, the Canberra Theatre, and The National Gallery of Australia. 37 light-filled modern serviced apartments with kitchenettes to full kitchens, private terraces, and balconies. On-site gym. 2km from Parliament House.",
    coordinates: { lat: -35.2809, lng: 149.1300 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 10, baseRate: 165 },
      { type: "1-Bedroom", count: 18, baseRate: 210 },
      { type: "2-Bedroom", count: 9, baseRate: 270 },
    ],
    amenities: ["WiFi", "Gym", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: false, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/act/canberra/quest-canberra",
  },
  {
    id: "quest-canberra-city-walk",
    name: "Quest Canberra City Walk",
    address: "240 City Walk",
    suburb: "Canberra City",
    city: "Canberra",
    state: "ACT",
    postcode: "2601",
    shortDescription: "On the CBD's City Walk boulevard. 84 apartments, gym. Walk to galleries and Lake Burley Griffin.",
    description: "Quest Canberra City Walk gives immediate access to the best of Australia's capital, nestled on the CBD's City Walk boulevard. 84 spacious serviced apartments with kitchenettes to full kitchens. On-site gym, perfect for both holiday stays and business trips.",
    coordinates: { lat: -35.2791, lng: 149.1282 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 170 },
      { type: "1-Bedroom", count: 40, baseRate: 218 },
      { type: "2-Bedroom", count: 24, baseRate: 278 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/act/canberra/quest-canberra-city-walk",
  },

  // ── WESTERN AUSTRALIA ─────────────────────────────────────
  {
    id: "quest-east-perth",
    name: "Quest East Perth",
    address: "176 Adelaide Terrace",
    suburb: "East Perth",
    city: "Perth",
    state: "WA",
    postcode: "6004",
    shortDescription: "Modern 1- and 2-bedroom apartments in East Perth with rooftop bar Folly. Steps from Perth CBD.",
    description: "Quest East Perth is premier apartment accommodation in vibrant East Perth. Close to Perth CBD, Optus Stadium, and Kings Park. 1- and 2-bedroom apartments with fully equipped kitchens, laundry, separate living areas, on-site gym, and rooftop bar Folly for sunset cocktails.",
    coordinates: { lat: -31.9497, lng: 115.8648 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 35, baseRate: 200 },
      { type: "2-Bedroom", count: 25, baseRate: 258 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Rooftop Bar", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/east-perth/quest-east-perth",
  },
  {
    id: "quest-fremantle",
    name: "Quest Fremantle",
    address: "8 Pakenham Street",
    suburb: "Fremantle",
    city: "Perth",
    state: "WA",
    postcode: "6160",
    shortDescription: "Historic port city. Studios to 2BR, gym. Near Fremantle Harbour, Prison, Arts Centre, Rottnest Island ferry.",
    description: "Fremantle has a rich maritime history. Quest Fremantle is in the heart of this eclectic hub with Studios, 1- and 2-bedroom apartments and gym. Close to Fremantle Harbour, Maritime Museum, Fremantle Prison, and easy ferry access to Rottnest Island.",
    coordinates: { lat: -32.0565, lng: 115.7449 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 160 },
      { type: "1-Bedroom", count: 20, baseRate: 200 },
      { type: "2-Bedroom", count: 15, baseRate: 260 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/fremantle/quest-fremantle",
  },
  {
    id: "quest-joondalup",
    name: "Quest Joondalup",
    address: "83 Boas Avenue",
    suburb: "Joondalup",
    city: "Perth",
    state: "WA",
    postcode: "6027",
    shortDescription: "North Perth. 90 apartments with gym, 20 mins to Perth CBD. Near Hillarys Boat Harbour and beaches.",
    description: "Quest Joondalup is just 20 minutes drive from Perth CBD. 90 serviced apartments — Studios, 1- and 2-bedroom. On-site gym. Close to Hillarys Boat Harbour, Lakeside Joondalup shopping centre, and AQWA. Live like a local in Perth's sunniest coastal suburb.",
    coordinates: { lat: -31.7492, lng: 115.7680 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 25, baseRate: 150 },
      { type: "1-Bedroom", count: 40, baseRate: 190 },
      { type: "2-Bedroom", count: 25, baseRate: 248 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/joondalup/quest-joondalup",
  },
  {
    id: "quest-midland",
    name: "Quest Midland",
    address: "3 The Crescent",
    suburb: "Midland",
    city: "Perth",
    state: "WA",
    postcode: "6056",
    shortDescription: "Perth eastern corridor stay near Swan Valley and the airport, with gym and apartment comforts.",
    description: "Quest Midland is a practical base for stays in Perth’s eastern corridor, close to Midland Gate, major transport links, Swan Valley day trips, and airport access. Serviced apartments with kitchen and laundry facilities are complemented by on-site gym access and secure parking.",
    coordinates: { lat: -31.8908, lng: 116.0100 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 148 },
      { type: "1-Bedroom", count: 30, baseRate: 188 },
      { type: "2-Bedroom", count: 16, baseRate: 242 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/midland/quest-midland",
  },
  {
    id: "quest-south-perth-foreshore",
    name: "Quest South Perth Foreshore",
    address: "22 Harper Terrace",
    suburb: "South Perth",
    city: "Perth",
    state: "WA",
    postcode: "6151",
    shortDescription: "Foreshore apartments with easy city access, close to the Swan River, zoo, and local dining.",
    description: "Quest South Perth Foreshore offers apartment-style accommodation near the Swan River, Mends Street dining, and direct access to central Perth. Modern rooms with kitchen and laundry facilities, on-site gym access, and a premium foreshore setting suit business and leisure stays.",
    coordinates: { lat: -31.9722, lng: 115.8578 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 22, baseRate: 165 },
      { type: "1-Bedroom", count: 34, baseRate: 205 },
      { type: "2-Bedroom", count: 20, baseRate: 262 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/south-perth/quest-south-perth-foreshore",
  },
  {
    id: "quest-innaloo",
    name: "Quest Innaloo",
    address: "1 Sunray Drive",
    suburb: "Innaloo",
    city: "Perth",
    state: "WA",
    postcode: "6018",
    shortDescription: "Coastal Perth stay near shopping and beaches, with gym and apartment-style options for short or long stays.",
    description: "Quest Innaloo offers easy access to transport, shopping, local eateries, and Perth’s northern beaches. Studios and larger apartments provide a relaxed base with kitchen facilities and on-site gym access for business trips, weekends away, or extended stays.",
    coordinates: { lat: -31.8928, lng: 115.7965 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 155 },
      { type: "1-Bedroom", count: 30, baseRate: 195 },
      { type: "2-Bedroom", count: 16, baseRate: 248 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/innaloo/quest-innaloo",
  },
  {
    id: "quest-kings-park",
    name: "Quest Kings Park",
    address: "54 Kings Park Road",
    suburb: "West Perth",
    city: "Perth",
    state: "WA",
    postcode: "6005",
    shortDescription: "West Perth apartments beside Kings Park with gym, kitchen facilities, and easy CBD access.",
    description: "Quest Kings Park offers a convenient base between bushland and city life, close to Kings Park Botanic Garden, the Perth CBD, and West Perth dining. Serviced apartments with kitchen and laundry facilities, complimentary WiFi, pantry service, and gym access suit leisure and business stays.",
    coordinates: { lat: -31.9554, lng: 115.8395 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 162 },
      { type: "1-Bedroom", count: 30, baseRate: 202 },
      { type: "2-Bedroom", count: 24, baseRate: 262 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Pantry Service", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/west-perth/quest-kings-park",
  },
  {
    id: "quest-mounts-bay-road",
    name: "Quest Mounts Bay Road",
    address: "130 Mounts Bay Road",
    suburb: "Perth",
    city: "Perth",
    state: "WA",
    postcode: "6000",
    shortDescription: "River-side Perth location with gym and café, close to the CBD and university precincts.",
    description: "Quest Mounts Bay Road stretches across one of Perth’s most connected inner-city corridors, close to the Swan River, UWA, and the CBD. Serviced apartments with full kitchen and laundry facilities are complemented by an on-site café, gym, and river-side convenience.",
    coordinates: { lat: -31.9578, lng: 115.8466 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 16, baseRate: 168 },
      { type: "1-Bedroom", count: 32, baseRate: 208 },
      { type: "2-Bedroom", count: 18, baseRate: 268 },
      { type: "3-Bedroom", count: 5, baseRate: 335 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Cafe", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/perth/quest-mounts-bay-road",
  },
  {
    id: "quest-perth-ascot",
    name: "Quest Perth Ascot",
    address: "266 Great Eastern Highway",
    suburb: "Ascot",
    city: "Perth",
    state: "WA",
    postcode: "6104",
    shortDescription: "Perth airport corridor apartments near the Swan River and racecourse, with gym and balconies.",
    description: "Quest Perth Ascot is a convenient base for exploring Perth, Swan Valley wineries, and the surrounding eastern corridor. Serviced apartments with kitchen and laundry facilities, plus gym access and balcony-equipped executive studios, make it suitable for short and extended stays.",
    coordinates: { lat: -31.9361, lng: 115.9333 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 28, baseRate: 158 },
      { type: "1-Bedroom", count: 44, baseRate: 198 },
      { type: "2-Bedroom", count: 28, baseRate: 252 },
      { type: "3-Bedroom", count: 12, baseRate: 320 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/ascot/quest-perth-ascot",
  },
  {
    id: "quest-rockingham",
    name: "Quest Rockingham",
    address: "22 Flinders Lane",
    suburb: "Rockingham",
    city: "Rockingham",
    state: "WA",
    postcode: "6168",
    shortDescription: "Coastal WA apartments with pool and gym, ideal for dolphin, beach, and family stays south of Perth.",
    description: "Quest Rockingham is a relaxed coastal base close to calm beaches, marine life, and waterside activities. Modern serviced apartments with complimentary WiFi are complemented by an on-site swimming pool and gym, making it a comfortable option for family breaks and business trips.",
    coordinates: { lat: -32.2812, lng: 115.7274 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 22, baseRate: 150 },
      { type: "1-Bedroom", count: 38, baseRate: 190 },
      { type: "2-Bedroom", count: 24, baseRate: 242 },
      { type: "3-Bedroom", count: 12, baseRate: 305 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/rockingham/quest-rockingham",
  },
  {
    id: "quest-west-end",
    name: "Quest West End",
    address: "451 Murray Street",
    suburb: "Perth CBD",
    city: "Perth",
    state: "WA",
    postcode: "6000",
    shortDescription: "CBD Perth apartments near RAC Arena and Northbridge, with full kitchens and select private balconies.",
    description: "Quest West End is located in the heart of Perth’s CBD within walking distance of RAC Arena, the convention centre, theatres, and Northbridge. One- and 2-Bedroom serviced apartments feature full kitchen and laundry facilities, with superior and executive apartments including private balconies.",
    coordinates: { lat: -31.9525, lng: 115.8505 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 20, baseRate: 188 },
      { type: "2-Bedroom", count: 15, baseRate: 245 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/perth/quest-west-end",
  },
  {
    id: "quest-yelverton-kalgoorlie",
    name: "Quest Yelverton Kalgoorlie",
    address: "210 Egan Street",
    suburb: "Kalgoorlie",
    city: "Kalgoorlie",
    state: "WA",
    postcode: "6430",
    shortDescription: "Goldfields apartments with pool and practical long-stay amenities in the heart of mining country.",
    description: "Quest Yelverton Kalgoorlie is conveniently placed near the rail station, coach terminal, arts centre, and local attractions in WA’s Goldfields. Serviced apartments with kitchen and laundry facilities, complimentary WiFi, and an on-site pool provide a comfortable regional base.",
    coordinates: { lat: -30.7492, lng: 121.4651 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 145 },
      { type: "1-Bedroom", count: 20, baseRate: 182 },
      { type: "2-Bedroom", count: 15, baseRate: 235 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/kalgoorlie/quest-yelverton-kalgoorlie",
  },
  {
    id: "quest-bunbury",
    name: "Quest Bunbury",
    address: "14 Lyons Cove",
    suburb: "Bunbury",
    city: "Bunbury",
    state: "WA",
    postcode: "6230",
    shortDescription: "South-west WA coastal base near the bay and local attractions, with apartment-style convenience.",
    description: "Quest Bunbury is a relaxed apartment-style stay in one of WA’s key coastal centres, close to Koombana Bay, galleries, wildlife attractions, and regional beaches. The property offers the comforts of home with kitchen facilities and a practical base for exploring the south-west.",
    coordinates: { lat: -33.3256, lng: 115.6396 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 145 },
      { type: "1-Bedroom", count: 22, baseRate: 182 },
      { type: "2-Bedroom", count: 12, baseRate: 235 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/bunbury/quest-bunbury",
  },
  {
    id: "quest-scarborough",
    name: "Quest Scarborough",
    address: "4 Brighton Road",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    postcode: "6019",
    shortDescription: "Beachside Scarborough apartments offering coastal living with easy access back to central Perth.",
    description: "Quest Scarborough places guests right by one of Perth’s most loved beach precincts, close to pubs, cafés, seafood spots, and the surf. Serviced apartments with full kitchen and laundry facilities make it an easy base for family holidays, business, or longer coastal stays.",
    coordinates: { lat: -31.8954, lng: 115.7578 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 168 },
      { type: "1-Bedroom", count: 24, baseRate: 208 },
      { type: "2-Bedroom", count: 14, baseRate: 262 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/scarborough/quest-scarborough/",
  },
  {
    id: "quest-on-rheola",
    name: "Quest on Rheola",
    address: "18 Rheola Street",
    suburb: "West Perth",
    city: "Perth",
    state: "WA",
    postcode: "6005",
    shortDescription: "West Perth apartment-style stay near Kings Park with private balconies and easy CBD access.",
    description: "Quest on Rheola offers a quieter West Perth base close to Kings Park, the CBD, universities, and nearby stadiums. Its 1- and 2-Bedroom serviced apartments provide full kitchen facilities and private balconies for short or extended stays.",
    coordinates: { lat: -31.9550, lng: 115.8368 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 12, baseRate: 188 },
      { type: "2-Bedroom", count: 8, baseRate: 245 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/wa/west-perth/quest-on-rheola",
  },

  // ── SOUTH AUSTRALIA ───────────────────────────────────────
  {
    id: "quest-king-william-south",
    name: "Quest King William South",
    address: "379 King William Street",
    suburb: "Adelaide CBD",
    city: "Adelaide",
    state: "SA",
    postcode: "5000",
    shortDescription: "Adelaide CBD. 104 rooms. 2 blocks from Central Market. Near Adelaide Oval, Adelaide Zoo, Rundle Mall.",
    description: "Quest King William South is centrally located in Adelaide CBD, 6.4km from Adelaide Airport. 104 rooms — Studio, 1- and 2-bedroom — with kitchen and laundry facilities. On-site gym. 2 blocks from Adelaide Central Market, close to Adelaide Oval, Adelaide Zoo, Convention Centre, and Rundle Mall.",
    coordinates: { lat: -34.9290, lng: 138.5987 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 25, baseRate: 165 },
      { type: "1-Bedroom", count: 50, baseRate: 208 },
      { type: "2-Bedroom", count: 29, baseRate: 268 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/sa/adelaide/quest-king-william-south",
  },
  {
    id: "quest-on-franklin",
    name: "Quest on Franklin",
    address: "74 Franklin Street",
    suburb: "Adelaide CBD",
    city: "Adelaide",
    state: "SA",
    postcode: "5000",
    shortDescription: "Apartment-style Adelaide CBD stay near Central Market, with gym and easy city access.",
    description: "Quest on Franklin delivers central Adelaide accommodation close to Adelaide Central Market, Gouger Street dining, and the broader CBD. Spacious serviced apartments with kitchen and laundry facilities are paired with on-site gym access for both business and leisure travellers.",
    coordinates: { lat: -34.9284, lng: 138.5929 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 160 },
      { type: "1-Bedroom", count: 40, baseRate: 205 },
      { type: "2-Bedroom", count: 24, baseRate: 262 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/sa/adelaide/quest-on-franklin",
  },
  {
    id: "quest-mawson-lakes",
    name: "Quest Mawson Lakes",
    address: "33-37 Main Street",
    suburb: "Mawson Lakes",
    city: "Adelaide",
    state: "SA",
    postcode: "5095",
    shortDescription: "North Adelaide apartment hotel with conference facilities and gym, ideal for business groups and extended stays.",
    description: "Quest Mawson Lakes is close to landscaped lakes, education precincts, parks, and business hubs north of Adelaide. Spacious 2- and 3-Bedroom-friendly accommodation, conference facilities, family-friendly equipment options, and gym access make it well suited to group, corporate, and longer stays.",
    coordinates: { lat: -34.8140, lng: 138.6102 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 150 },
      { type: "1-Bedroom", count: 28, baseRate: 190 },
      { type: "2-Bedroom", count: 26, baseRate: 245 },
      { type: "3-Bedroom", count: 10, baseRate: 310 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/sa/mawson-lakes/quest-mawson-lakes/",
  },
  {
    id: "quest-port-adelaide",
    name: "Quest Port Adelaide",
    address: "36 North Parade",
    suburb: "Port Adelaide",
    city: "Adelaide",
    state: "SA",
    postcode: "5015",
    shortDescription: "Waterfront-style apartment stay near museums and beaches, with gym and larger room options.",
    description: "Quest Port Adelaide is a stylish base for exploring the maritime precinct, nearby beaches, and Adelaide’s north-west business corridor. One-, 2-, and 3-Bedroom apartments with full kitchen and laundry facilities are supported by on-site gym access and a location close to museums and riverfront dining.",
    coordinates: { lat: -34.8449, lng: 138.5058 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 36, baseRate: 190 },
      { type: "2-Bedroom", count: 44, baseRate: 245 },
      { type: "3-Bedroom", count: 24, baseRate: 315 },
    ],
    amenities: ["WiFi", "Gym", "Parking", "Kitchen", "Laundry", "Balcony", "Air Conditioning"],
    hasGym: true, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/sa/port-adelaide/quest-port-adelaide",
  },
  {
    id: "quest-whyalla",
    name: "Quest Whyalla",
    address: "4 Moran Street",
    suburb: "Whyalla",
    city: "Whyalla",
    state: "SA",
    postcode: "5608",
    shortDescription: "Sunny SA coastal apartments with pool and BBQ, close to beaches, shopping, and local dining.",
    description: "Quest Whyalla offers a relaxed apartment-style stay close to the foreshore, shopping, cafés, and local attractions on the SA coast. One-, 2-, and 3-Bedroom apartments with full kitchen facilities are supported by an outdoor pool, alfresco BBQ area, and pantry shopping service.",
    coordinates: { lat: -33.0379, lng: 137.5850 },
    starRating: 4,
    roomTypes: [
      { type: "1-Bedroom", count: 18, baseRate: 148 },
      { type: "2-Bedroom", count: 20, baseRate: 195 },
      { type: "3-Bedroom", count: 8, baseRate: 252 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "BBQ Area", "Pantry Service", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/sa/whyalla/quest-whyalla",
  },

  // ── NORTHERN TERRITORY ────────────────────────────────────
  {
    id: "quest-alice-springs",
    name: "Quest Alice Springs",
    address: "9-10 South Terrace",
    suburb: "Alice Springs",
    city: "Alice Springs",
    state: "NT",
    postcode: "870",
    shortDescription: "Iconic outback location. 68 apartments, pool, conference centre. Walk to CBD and ANZAC Hill.",
    description: "Soak up the sun and cool off in the pool at Quest Alice Springs. Nestled amongst the eucalypts along South Terrace. The CBD is within walking distance — explore eclectic shops, cafés, and art galleries before a pink sunset at ANZAC Hill. 68 spacious apartments, pool, conference centre, and secure parking.",
    coordinates: { lat: -23.6980, lng: 133.8807 },
    starRating: 3.5,
    roomTypes: [
      { type: "Studio", count: 18, baseRate: 130 },
      { type: "1-Bedroom", count: 30, baseRate: 165 },
      { type: "2-Bedroom", count: 20, baseRate: 215 },
    ],
    amenities: ["WiFi", "Pool", "Parking", "Kitchen", "Laundry", "Conference Room", "Air Conditioning"],
    hasGym: false, hasPool: true, hasParking: true, hasConferenceRoom: true,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nt/alice-springs/quest-alice-springs",
  },
  {
    id: "quest-palmerston",
    name: "Quest Palmerston",
    address: "18 The Boulevard",
    suburb: "Palmerston City",
    city: "Palmerston",
    state: "NT",
    postcode: "830",
    shortDescription: "Top End apartment hotel with pool, gym, and secure parking, ideal for Darwin-region business and leisure stays.",
    description: "Quest Palmerston is a strong base for exploring the NT’s second-largest city, local markets, business parks, and day trips further into the Top End. Light-filled serviced apartments with kitchenettes to full kitchens are paired with an on-site pool, gym, and secure parking.",
    coordinates: { lat: -12.4802, lng: 130.9834 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 20, baseRate: 155 },
      { type: "1-Bedroom", count: 38, baseRate: 198 },
      { type: "2-Bedroom", count: 20, baseRate: 255 },
      { type: "3-Bedroom", count: 6, baseRate: 320 },
    ],
    amenities: ["WiFi", "Gym", "Pool", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: true, hasPool: true, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/nt/palmerston-city/quest-palmerston",
  },

  // ── TASMANIA ──────────────────────────────────────────────
  {
    id: "quest-savoy",
    name: "Quest Savoy",
    address: "38 Elizabeth Street",
    suburb: "Hobart CBD",
    city: "Hobart",
    state: "TAS",
    postcode: "7000",
    shortDescription: "Historic Hobart CBD stay near the harbour, with day spa access and walkable city attractions.",
    description: "Quest Savoy sits in the heart of Hobart’s CBD just a short walk from the harbour, markets, cafés, and waterfront dining. Serviced apartment-style rooms provide comfortable inner-city accommodation, and guests also benefit from nearby day spa access and offsite secure parking.",
    coordinates: { lat: -42.8820, lng: 147.3275 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 165 },
      { type: "1-Bedroom", count: 14, baseRate: 205 },
      { type: "2-Bedroom", count: 6, baseRate: 265 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Day Spa Access", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/tas/hobart/quest-savoy",
  },
  {
    id: "quest-trinity-house",
    name: "Quest Trinity House",
    address: "149 Brooker Avenue",
    suburb: "Hobart",
    city: "Hobart",
    state: "TAS",
    postcode: "7000",
    shortDescription: "Hobart retreat in a historic leafy setting, with spacious apartments up to 4-bedroom layouts.",
    description: "Quest Trinity House offers a quieter Hobart retreat close to the harbour, galleries, shops, and local dining. Light-filled serviced apartments ranging from Studios through to larger multi-bedroom options provide flexible accommodation for couples, families, and longer stays.",
    coordinates: { lat: -42.8672, lng: 147.3240 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 12, baseRate: 158 },
      { type: "1-Bedroom", count: 14, baseRate: 198 },
      { type: "2-Bedroom", count: 8, baseRate: 252 },
      { type: "3-Bedroom", count: 4, baseRate: 318 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/tas/hobart/quest-trinity-house",
  },
  {
    id: "quest-waterfront",
    name: "Quest Waterfront",
    address: "3 Brooke Street",
    suburb: "Hobart CBD",
    city: "Hobart",
    state: "TAS",
    postcode: "7000",
    shortDescription: "Harbour-side Hobart accommodation on Sullivan’s Cove, walkable to markets, ferry, and waterfront dining.",
    description: "Quest Waterfront sits on historic Sullivan’s Cove in the heart of Hobart near Franklin Wharf, Salamanca, the MONA ferry, and the city’s best harbour-side restaurants. Well-equipped rooms and apartments provide a practical base for short and longer stays.",
    coordinates: { lat: -42.8826, lng: 147.3314 },
    starRating: 4,
    roomTypes: [
      { type: "Studio", count: 14, baseRate: 168 },
      { type: "1-Bedroom", count: 14, baseRate: 208 },
      { type: "2-Bedroom", count: 6, baseRate: 270 },
    ],
    amenities: ["WiFi", "Parking", "Kitchen", "Laundry", "Air Conditioning"],
    hasGym: false, hasPool: false, hasParking: true, hasConferenceRoom: false,
    checkInTime: "14:00", checkOutTime: "10:00",
    url: "https://www.questapartments.com.au/properties/tas/hobart/quest-waterfront",
  },
];

// ============================================================
// AVAILABILITY SIMULATION
// Deterministic pseudo-random: same inputs always give same result.
// ~75% of date/room combinations are available.
// ============================================================

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getRoomsAvailable(propertyId: string, date: string, roomType: string, maxRooms: number): number {
  const hash = simpleHash(`${propertyId}|${date}|${roomType}`);
  if ((hash % 100) >= 75) return 0; // 25% unavailable
  return (hash % maxRooms) + 1;
}

function getDatesInRange(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const current = new Date(checkIn);
  const end = new Date(checkOut);
  while (current < end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function isStayAvailable(
  propertyId: string, checkIn: string, checkOut: string,
  roomType: string, maxRooms: number
): { available: boolean; roomsLeft: number } {
  const dates = getDatesInRange(checkIn, checkOut);
  let minRooms = Infinity;
  for (const date of dates) {
    const rooms = getRoomsAvailable(propertyId, date, roomType, maxRooms);
    if (rooms === 0) return { available: false, roomsLeft: 0 };
    minRooms = Math.min(minRooms, rooms);
  }
  return { available: true, roomsLeft: minRooms === Infinity ? 0 : minRooms };
}

// ============================================================
// RATE CALCULATION
// ============================================================

function calculateNights(checkIn: string, checkOut: string): number {
  return Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000);
}

function avgNightlyRate(checkIn: string, checkOut: string, baseRate: number): number {
  const dates = getDatesInRange(checkIn, checkOut);
  const total = dates.reduce((sum, d) => {
    const day = new Date(d).getDay(); // 0=Sun, 5=Fri, 6=Sat
    return sum + (day === 5 || day === 6 || day === 0 ? baseRate * 1.2 : baseRate);
  }, 0);
  return Math.round(total / dates.length);
}

function getRatePlans(property: Property, roomType: string, checkIn: string, checkOut: string): RatePlan[] {
  const room = property.roomTypes.find(r => r.type === roomType);
  if (!room) return [];

  const nights = calculateNights(checkIn, checkOut);
  const avg = avgNightlyRate(checkIn, checkOut, room.baseRate);
  const daysAhead = Math.round((new Date(checkIn).getTime() - Date.now()) / 86_400_000);

  const plans: RatePlan[] = [
    {
      planCode: "FLEX",
      planName: "Flexible Rate",
      nightlyRate: Math.round(avg * 1.1),
      totalCost: Math.round(avg * 1.1 * nights),
      inclusions: ["WiFi", "Kitchen & Laundry"],
      cancellationPolicy: "Free cancellation up to 24 hours before check-in",
      isCorporate: false, isPromotional: false,
    },
    {
      planCode: "STD",
      planName: "Standard Rate",
      nightlyRate: avg,
      totalCost: avg * nights,
      inclusions: ["WiFi", "Kitchen & Laundry"],
      cancellationPolicy: "Free cancellation up to 72 hours before check-in",
      isCorporate: false, isPromotional: false,
    },
  ];

  if (daysAhead >= 7) {
    plans.push({
      planCode: "ADVP",
      planName: "Advance Purchase — Save 10%",
      nightlyRate: Math.round(avg * 0.9),
      totalCost: Math.round(avg * 0.9 * nights),
      inclusions: ["WiFi", "Kitchen & Laundry"],
      cancellationPolicy: "Non-refundable",
      isCorporate: false, isPromotional: true,
    });
  }

  plans.push({
    planCode: "CORP",
    planName: "Corporate Rate",
    nightlyRate: Math.round(avg * 0.85),
    totalCost: Math.round(avg * 0.85 * nights),
    inclusions: ["WiFi", "Kitchen & Laundry", "Business amenities access"],
    cancellationPolicy: "Free cancellation up to 24 hours before check-in",
    isCorporate: true, isPromotional: false,
  });

  if (nights >= 7) {
    plans.push({
      planCode: "LONG7",
      planName: "Weekly Stay — Save 15%",
      nightlyRate: Math.round(avg * 0.85),
      totalCost: Math.round(avg * 0.85 * nights),
      inclusions: ["WiFi", "Kitchen & Laundry", "Weekly housekeeping"],
      cancellationPolicy: "Free cancellation up to 7 days before check-in",
      isCorporate: false, isPromotional: true,
    });
  }

  return plans;
}

// ============================================================
// IN-MEMORY BOOKING STORE  (POC — resets on cold start)
// ============================================================

const bookings: Record<string, Booking> = {};

function generateConfirmationNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "Q";
  for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// ============================================================
// PROPERTY SEARCH HELPER
// ============================================================

function findProperties(opts: {
  location?: string;
  state?: string;
  hasGym?: boolean;
  hasPool?: boolean;
  hasParking?: boolean;
  hasConferenceRoom?: boolean;
}): Property[] {
  let results = [...PROPERTIES];

  if (opts.location) {
    const loc = opts.location.toLowerCase().trim();
    const STATE_MAP: Record<string, string> = {
      "new south wales": "NSW", "victoria": "VIC", "queensland": "QLD",
      "western australia": "WA", "south australia": "SA",
      "australian capital territory": "ACT", "northern territory": "NT",
    };
    const mappedState = STATE_MAP[loc];

    results = results.filter(p =>
      p.name.toLowerCase().includes(loc) ||
      p.suburb.toLowerCase().includes(loc) ||
      p.city.toLowerCase().includes(loc) ||
      p.postcode === loc ||
      p.state.toLowerCase() === loc ||
      (mappedState && p.state === mappedState) ||
      // handle common metro groupings
      (loc === "sydney" && p.city === "Sydney") ||
      (loc === "melbourne" && p.city === "Melbourne") ||
      (loc === "brisbane" && p.city === "Brisbane") ||
      (loc === "perth" && p.city === "Perth") ||
      (loc === "canberra" && p.city === "Canberra") ||
      (loc === "adelaide" && p.city === "Adelaide")
    );
  }

  if (opts.state) {
    results = results.filter(p => p.state.toUpperCase() === opts.state!.toUpperCase());
  }
  if (opts.hasGym) results = results.filter(p => p.hasGym);
  if (opts.hasPool) results = results.filter(p => p.hasPool);
  if (opts.hasParking) results = results.filter(p => p.hasParking);
  if (opts.hasConferenceRoom) results = results.filter(p => p.hasConferenceRoom);

  return results;
}

// ============================================================
// MCP SERVER FACTORY
// ============================================================

function createServer(): McpServer {
  const server = new McpServer({ name: "quest-mcp-server", version: "1.0.0" });

  server.registerResource(
    "quest-property-search-widget",
    SEARCH_WIDGET_URI,
    {
      title: "Quest Property Search Widget",
      description: "Interactive UI for exploring Quest property search results inside ChatGPT.",
      mimeType: "text/html;profile=mcp-app",
    },
    async () => ({
      contents: [
        {
          uri: SEARCH_WIDGET_URI,
          mimeType: "text/html;profile=mcp-app",
          text: SEARCH_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
          },
        },
      ],
    })
  );

  // ── Tool 1: quest_search_properties ──────────────────────
  server.registerTool(
    "quest_search_properties",
    {
      title: "Search Quest Properties",
      description: `Search for Quest Apartment Hotels in Australia by location, state, or amenities.

Use when a guest asks to find Quest properties in a city, state, or with specific facilities.

Args:
  - location: City, suburb, or state name (e.g. "Melbourne", "Chatswood", "Victoria", "NSW")
  - state: State abbreviation — NSW, VIC, QLD, WA, SA, ACT, NT
  - has_gym: true to filter to properties with a gym
  - has_pool: true to filter to properties with a pool
  - has_parking: true to filter to properties with parking
  - has_conference_room: true to filter to properties with conference facilities
  - response_format: "markdown" (default) or "json"

Returns property list with name, address, star rating, room types, base rates, and amenities.

Examples:
  - "Quest hotels in Brisbane" → location="Brisbane"
  - "Quest with a pool in Victoria" → state="VIC", has_pool=true
  - "Quest near Sydney CBD with gym" → location="Sydney", has_gym=true`,
      inputSchema: z.object({
        location: z.string().optional().describe("City, suburb, or state name/abbreviation"),
        state: z.string().optional().describe("State abbreviation: NSW, VIC, QLD, WA, SA, ACT, NT"),
        has_gym: z.boolean().optional().describe("Filter to properties with a gym"),
        has_pool: z.boolean().optional().describe("Filter to properties with a pool"),
        has_parking: z.boolean().optional().describe("Filter to properties with on-site parking"),
        has_conference_room: z.boolean().optional().describe("Filter to properties with conference facilities"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri: SEARCH_WIDGET_URI,
        },
        "openai/outputTemplate": SEARCH_WIDGET_URI,
        "openai/toolInvocation/invoking": "Searching Quest properties…",
        "openai/toolInvocation/invoked": "Quest properties ready.",
      },
    },
    async (params) => {
      const results = findProperties({
        location: params.location,
        state: params.state,
        hasGym: params.has_gym,
        hasPool: params.has_pool,
        hasParking: params.has_parking,
        hasConferenceRoom: params.has_conference_room,
      });

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No Quest properties found matching your criteria. Try broadening your search — e.g., use a city name or state abbreviation." }] };
      }

      const output = {
        total: results.length,
        properties: results.map(p => ({
          id: p.id,
          name: p.name,
          address: `${p.address}, ${p.suburb} ${p.state} ${p.postcode}`,
          city: p.city,
          state: p.state,
          starRating: p.starRating,
          shortDescription: p.shortDescription,
          amenities: p.amenities,
          roomTypes: p.roomTypes.map(r => ({ type: r.type, fromRate: `AUD $${r.baseRate}/night` })),
          hasGym: p.hasGym, hasPool: p.hasPool, hasParking: p.hasParking,
          checkIn: p.checkInTime, checkOut: p.checkOutTime,
        })),
      };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const lines = [`# 🏨 Quest Properties — ${results.length} found\n`];
      for (const p of results) {
        lines.push(`---`);
        lines.push(`## ${p.name}  ${"⭐".repeat(Math.round(p.starRating))}`);
        lines.push(`📍 ${p.address}, ${p.suburb} ${p.state} ${p.postcode}`);
        lines.push(`\n> ${p.shortDescription}\n`);
        const icons = [
          p.hasGym ? "🏋️ Gym" : null,
          p.hasPool ? "🏊 Pool" : null,
          p.hasParking ? "🅿️ Parking" : null,
          p.hasConferenceRoom ? "📞 Conference" : null,
        ].filter(Boolean);
        if (icons.length) lines.push(icons.join("  ·  "));
        lines.push(`\n🛏️ ${p.roomTypes.map(r => `**${r.type}** from $${r.baseRate}`).join("  |  ")} AUD/night`);
        lines.push(`🔑 \`${p.id}\``);
      }
      lines.push(`\n---`);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 2: quest_get_property_details ───────────────────
  server.registerTool(
    "quest_get_property_details",
    {
      title: "Get Quest Property Details",
      description: `Get full details for a specific Quest property by its ID.

Use when a guest wants to know everything about one property — description, all room types, amenities, check-in/out times, and base rates.

Args:
  - property_id: The property ID (e.g. "quest-docklands"). Get IDs from quest_search_properties.
  - response_format: "markdown" (default) or "json"

Returns full description, room types, amenities, coordinates, check-in/out times, and website link.`,
      inputSchema: z.object({
        property_id: z.string().describe('Property ID, e.g. "quest-docklands". Use quest_search_properties to find IDs.'),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = PROPERTIES.find(x => x.id === params.property_id);
      if (!p) return { content: [{ type: "text", text: `Property "${params.property_id}" not found. Use quest_search_properties to find valid IDs.` }] };

      const output = {
        id: p.id, name: p.name, address: p.address, suburb: p.suburb,
        city: p.city, state: p.state, postcode: p.postcode,
        starRating: p.starRating, description: p.description,
        coordinates: p.coordinates, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime,
        amenities: p.amenities, hasGym: p.hasGym, hasPool: p.hasPool,
        hasParking: p.hasParking, hasConferenceRoom: p.hasConferenceRoom,
        roomTypes: p.roomTypes.map(r => ({ type: r.type, count: r.count, baseRatePerNight: r.baseRate })),
        url: p.url,
      };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const icons = [
        p.hasGym ? "🏋️ Gym" : null,
        p.hasPool ? "🏊 Pool" : null,
        p.hasParking ? "🅿️ Parking" : null,
        p.hasConferenceRoom ? "📞 Conference" : null,
      ].filter(Boolean);
      const lines = [
        `# 🏨 ${p.name}`,
        `${"⭐".repeat(Math.round(p.starRating))}  ·  ${icons.join("  ·  ")}`,
        `\n📍 ${p.address}, ${p.suburb} ${p.state} ${p.postcode}`,
        `🗺️ [${p.coordinates.lat}, ${p.coordinates.lng}](https://maps.google.com/?q=${p.coordinates.lat},${p.coordinates.lng})`,
        `\n---`,
        `\n## About\n${p.description}\n`,
        `## 🛏️ Room Types\n`,
        `| Room Type | Available | From (AUD/night) |`,
        `|-----------|-----------|-----------------|`,
        ...p.roomTypes.map(r => `| ${r.type} | ${r.count} rooms | **$${r.baseRate}** |`),
        `\n## 🕐 Check-in & Check-out`,
        `- ✅ Check-in from **${p.checkInTime}**`,
        `- 🚪 Check-out by **${p.checkOutTime}**`,
        `\n## 🏅 Facilities`,
        ...p.amenities.map(a => `- ${a}`),
        `\n---`,
        `🔑 Property ID: \`${p.id}\`  ·  [View on Quest Website](${p.url})`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 3: quest_check_availability ─────────────────────
  server.registerTool(
    "quest_check_availability",
    {
      title: "Check Quest Availability",
      description: `Check room availability at a specific Quest property for given dates.

Args:
  - property_id: Property ID. Use quest_search_properties to find IDs.
  - check_in: Check-in date YYYY-MM-DD (e.g. "2025-06-15")
  - check_out: Check-out date YYYY-MM-DD (e.g. "2025-06-20")
  - room_type: Optional — "Studio", "1-Bedroom", "2-Bedroom", or "3-Bedroom". If omitted, checks all types.
  - response_format: "markdown" (default) or "json"

Returns availability and rooms remaining per room type.

Examples:
  - "Is Quest Docklands available 20-25 March?" → property_id="quest-docklands", check_in="2025-03-20", check_out="2025-03-25"
  - "2-bedroom at Quest Canberra next week?" → property_id="quest-canberra", room_type="2-Bedroom"`,
      inputSchema: z.object({
        property_id: z.string().describe("Property ID."),
        check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date YYYY-MM-DD"),
        check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date YYYY-MM-DD"),
        room_type: z.enum(["Studio", "1-Bedroom", "2-Bedroom", "3-Bedroom"]).optional().describe("Specific room type to check"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = PROPERTIES.find(x => x.id === params.property_id);
      if (!p) return { content: [{ type: "text", text: `Property "${params.property_id}" not found.` }] };

      const nights = calculateNights(params.check_in, params.check_out);
      if (nights <= 0) return { content: [{ type: "text", text: "Error: check_out must be after check_in." }] };

      const roomsToCheck = params.room_type
        ? p.roomTypes.filter(r => r.type === params.room_type)
        : p.roomTypes;

      if (roomsToCheck.length === 0) {
        return { content: [{ type: "text", text: `${p.name} does not offer ${params.room_type} apartments.` }] };
      }

      const availability = roomsToCheck.map(room => {
        const { available, roomsLeft } = isStayAvailable(p.id, params.check_in, params.check_out, room.type, room.count);
        return { roomType: room.type, available, roomsLeft, baseRate: room.baseRate };
      });

      const anyAvailable = availability.some(r => r.available);
      const output = { propertyId: p.id, propertyName: p.name, checkIn: params.check_in, checkOut: params.check_out, nights, anyAvailable, availability };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const lines = [
        `# 📅 Availability — ${p.name}`,
        `\n📍 ${p.address}, ${p.suburb} ${p.state}`,
        `🗓️ **${params.check_in}** → **${params.check_out}** · ${nights} night${nights !== 1 ? "s" : ""}`,
        `\n${anyAvailable ? "✅ **Rooms available for these dates!**" : "❌ **No rooms available for these dates.**"}`,
        `\n| Room Type | Status | Rooms Left | From (AUD/night) |`,
        `|-----------|--------|-----------|-----------------|`,
      ];
      for (const r of availability) {
        const status = r.available ? "✅ Available" : "❌ Sold out";
        const left = r.available ? `${r.roomsLeft}` : "—";
        const rate = r.available ? `**$${r.baseRate}**` : "—";
        lines.push(`| ${r.roomType} | ${status} | ${left} | ${rate} |`);
      }
      if (anyAvailable) lines.push(`\n_To check rates: use \`quest_get_rates\` with property_id \`${p.id}\`_`);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 4: quest_get_rates ───────────────────────────────
  server.registerTool(
    "quest_get_rates",
    {
      title: "Get Quest Rates",
      description: `Get detailed pricing and rate plans for a specific Quest property and room type.

Use when a guest wants pricing details or wants to compare rate plans.

Args:
  - property_id: Property ID.
  - check_in / check_out: Dates YYYY-MM-DD.
  - room_type: "Studio", "1-Bedroom", "2-Bedroom", or "3-Bedroom".
  - response_format: "markdown" (default) or "json"

Rate plans:
  - FLEX: Flexible (free cancellation 24h before, +10%)
  - STD: Standard (free cancellation 72h before)
  - ADVP: Advance Purchase — 10% off, non-refundable (available 7+ days ahead)
  - CORP: Corporate rate — 15% off
  - LONG7: Weekly stay — 15% off for 7+ night stays`,
      inputSchema: z.object({
        property_id: z.string().describe("Property ID."),
        check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date YYYY-MM-DD"),
        check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date YYYY-MM-DD"),
        room_type: z.enum(["Studio", "1-Bedroom", "2-Bedroom", "3-Bedroom"]).describe("Room type"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = PROPERTIES.find(x => x.id === params.property_id);
      if (!p) return { content: [{ type: "text", text: `Property "${params.property_id}" not found.` }] };

      if (!p.roomTypes.some(r => r.type === params.room_type)) {
        return { content: [{ type: "text", text: `${p.name} does not offer ${params.room_type} apartments.` }] };
      }

      const nights = calculateNights(params.check_in, params.check_out);
      if (nights <= 0) return { content: [{ type: "text", text: "Error: check_out must be after check_in." }] };

      const plans = getRatePlans(p, params.room_type, params.check_in, params.check_out);
      const output = { propertyId: p.id, propertyName: p.name, roomType: params.room_type, checkIn: params.check_in, checkOut: params.check_out, nights, currency: "AUD", ratePlans: plans };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const cheapestPlan = plans.reduce((min, r) => r.nightlyRate < min.nightlyRate ? r : min, plans[0]);
      const lines = [
        `# 💰 Rates — ${p.name}`,
        `\n🛏️ **${params.room_type}**  ·  📍 ${p.suburb}, ${p.state}`,
        `🗓️ **${params.check_in}** → **${params.check_out}** · ${nights} night${nights !== 1 ? "s" : ""}`,
        `\n🏷️ Best rate: **AUD $${cheapestPlan.nightlyRate}/night** (${cheapestPlan.planName}) — **$${cheapestPlan.totalCost} total**`,
        `\n| Rate Plan | Code | Per Night | ${nights}× Total | Cancellation |`,
        `|-----------|------|-----------|---------|--------------|`,
      ];
      for (const plan of plans) {
        const badge = plan.isPromotional ? "🏷️ " : plan.isCorporate ? "🏢 " : "";
        const highlight = plan.planCode === cheapestPlan.planCode ? "**" : "";
        lines.push(`| ${badge}${plan.planName} | \`${plan.planCode}\` | ${highlight}$${plan.nightlyRate}${highlight} | ${highlight}$${plan.totalCost}${highlight} | ${plan.cancellationPolicy} |`);
      }
      lines.push(`\n_Inclusions: ${cheapestPlan.inclusions.join(", ")}_`);
      lines.push(`_To book: use \`quest_create_booking\` with property_id \`${p.id}\` and your chosen rate plan code._`);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 5: quest_search_availability ────────────────────
  server.registerTool(
    "quest_search_availability",
    {
      title: "Search Quest Availability",
      description: `Find available Quest properties matching location, dates, room type, and budget. This is the PRIMARY discovery tool.

Use when a guest describes what they need — location, dates, room size, and/or budget — and you need to find matching options.

Args:
  - location: City, suburb, or state (e.g. "Melbourne", "Brisbane", "QLD")
  - state: State abbreviation: NSW, VIC, QLD, WA, SA, ACT, NT
  - check_in / check_out: Dates YYYY-MM-DD
  - room_type: Optional preferred room type. If omitted, all types are searched.
  - max_rate: Maximum nightly rate in AUD (optional)
  - guests: Number of guests — used to auto-suggest room type if room_type not specified
  - has_gym / has_pool: Filter flags
  - response_format: "markdown" (default) or "json"

Returns available properties sorted by price, with best rate per property/room combination.

Examples:
  - "2BR in Melbourne next week under $300/night" → location="Melbourne", room_type="2-Bedroom", max_rate=300
  - "Family accommodation Brisbane with pool" → location="Brisbane", has_pool=true, guests=4`,
      inputSchema: z.object({
        location: z.string().optional().describe("City, suburb, or region"),
        state: z.string().optional().describe("State abbreviation: NSW, VIC, QLD, WA, SA, ACT, NT"),
        check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date YYYY-MM-DD"),
        check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date YYYY-MM-DD"),
        room_type: z.enum(["Studio", "1-Bedroom", "2-Bedroom", "3-Bedroom"]).optional().describe("Preferred room type"),
        max_rate: z.number().optional().describe("Maximum nightly rate in AUD"),
        guests: z.number().int().min(1).max(10).optional().describe("Number of guests"),
        has_gym: z.boolean().optional().describe("Only properties with gym"),
        has_pool: z.boolean().optional().describe("Only properties with pool"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri: SEARCH_WIDGET_URI,
        },
        "openai/outputTemplate": SEARCH_WIDGET_URI,
        "openai/toolInvocation/invoking": "Searching live Quest availability…",
        "openai/toolInvocation/invoked": "Quest availability ready.",
      },
    },
    async (params) => {
      const nights = calculateNights(params.check_in, params.check_out);
      if (nights <= 0) return { content: [{ type: "text", text: "Error: check_out must be after check_in." }] };

      // Auto-suggest room type from guest count
      let targetType = params.room_type;
      if (!targetType && params.guests) {
        if (params.guests <= 1) targetType = "Studio";
        else if (params.guests <= 2) targetType = "1-Bedroom";
        else if (params.guests <= 4) targetType = "2-Bedroom";
        else targetType = "3-Bedroom";
      }

      const properties = findProperties({
        location: params.location, state: params.state,
        hasGym: params.has_gym, hasPool: params.has_pool,
      });

      type Result = { property: Property; roomType: string; roomsLeft: number; bestRate: RatePlan };
      const results: Result[] = [];

      for (const prop of properties) {
        const rooms = targetType ? prop.roomTypes.filter(r => r.type === targetType) : prop.roomTypes;
        for (const room of rooms) {
          const { available, roomsLeft } = isStayAvailable(prop.id, params.check_in, params.check_out, room.type, room.count);
          if (!available) continue;
          const plans = getRatePlans(prop, room.type, params.check_in, params.check_out);
          const best = plans.reduce((min, r) => r.nightlyRate < min.nightlyRate ? r : min, plans[0]);
          if (params.max_rate && best.nightlyRate > params.max_rate) continue;
          results.push({ property: prop, roomType: room.type, roomsLeft, bestRate: best });
        }
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No available Quest properties found for those criteria. Try different dates, location, or a higher budget." }] };
      }

      results.sort((a, b) => a.bestRate.nightlyRate - b.bestRate.nightlyRate);

      const output = {
        total: results.length, checkIn: params.check_in, checkOut: params.check_out,
        nights, currency: "AUD",
        results: results.map(r => ({
          propertyId: r.property.id,
          propertyName: r.property.name,
          address: `${r.property.address}, ${r.property.suburb} ${r.property.state}`,
          city: r.property.city, state: r.property.state, starRating: r.property.starRating,
          roomType: r.roomType, roomsLeft: r.roomsLeft, bestRate: r.bestRate,
          amenities: r.property.amenities, hasGym: r.property.hasGym, hasPool: r.property.hasPool,
        })),
      };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const lines = [
        `# 🔍 Quest Availability — ${results.length} option${results.length !== 1 ? "s" : ""} found`,
        `🗓️ **${params.check_in}** → **${params.check_out}** · ${nights} night${nights !== 1 ? "s" : ""}`,
        params.location ? `📍 ${params.location}` : "",
      ].filter(l => l !== "");
      for (const r of results) {
        const amenityIcons = [
          r.property.hasGym ? "🏋️" : null,
          r.property.hasPool ? "🏊" : null,
          r.property.hasParking ? "🅿️" : null,
        ].filter(Boolean).join(" ");
        lines.push(`\n---`);
        lines.push(`## 🏨 ${r.property.name}  ${"⭐".repeat(Math.round(r.property.starRating))}`);
        lines.push(`📍 ${r.property.address}, ${r.property.suburb} ${r.property.state}  ${amenityIcons}`);
        lines.push(`\n🛏️ **${r.roomType}** · ${r.roomsLeft} room${r.roomsLeft !== 1 ? "s" : ""} left`);
        lines.push(`\n| Rate Plan | Per Night | ${nights}-Night Total |`);
        lines.push(`|-----------|-----------|------------|`);
        const allPlans = getRatePlans(r.property, r.roomType as RoomType["type"], params.check_in, params.check_out);
        for (const plan of allPlans) {
          const isBest = plan.planCode === r.bestRate.planCode;
          lines.push(`| ${isBest ? "✨ " : ""}${plan.planName} (\`${plan.planCode}\`) | ${isBest ? "**" : ""}$${plan.nightlyRate}${isBest ? "**" : ""} | ${isBest ? "**" : ""}$${plan.totalCost}${isBest ? "**" : ""} |`);
        }
        lines.push(`\n🔑 \`${r.property.id}\``);
      }
      lines.push(`\n---`);
      lines.push(`_To get a quote: \`quest_get_booking_quote\` · To book: \`quest_create_booking\`_`);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 6: quest_get_booking_quote ──────────────────────
  server.registerTool(
    "quest_get_booking_quote",
    {
      title: "Get Quest Booking Quote",
      description: `Get a price estimate for a Quest stay without making a booking.

Use when a guest wants a price breakdown before committing.

Args:
  - property_id, room_type, check_in, check_out: as above.
  - rate_plan_code: Optional — FLEX, STD, ADVP, CORP, LONG7. If omitted, returns all plans.
  - response_format: "markdown" (default) or "json"`,
      inputSchema: z.object({
        property_id: z.string().describe("Property ID."),
        room_type: z.enum(["Studio", "1-Bedroom", "2-Bedroom", "3-Bedroom"]).describe("Room type"),
        check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date YYYY-MM-DD"),
        check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date YYYY-MM-DD"),
        rate_plan_code: z.string().optional().describe("Rate plan code: FLEX, STD, ADVP, CORP, LONG7"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const p = PROPERTIES.find(x => x.id === params.property_id);
      if (!p) return { content: [{ type: "text", text: `Property "${params.property_id}" not found.` }] };

      const nights = calculateNights(params.check_in, params.check_out);
      if (nights <= 0) return { content: [{ type: "text", text: "Error: check_out must be after check_in." }] };

      let plans = getRatePlans(p, params.room_type, params.check_in, params.check_out);
      if (params.rate_plan_code) {
        plans = plans.filter(x => x.planCode === params.rate_plan_code);
        if (plans.length === 0) return { content: [{ type: "text", text: `Rate plan "${params.rate_plan_code}" not available for these dates.` }] };
      }

      const output = { propertyId: p.id, propertyName: p.name, roomType: params.room_type, checkIn: params.check_in, checkOut: params.check_out, nights, currency: "AUD", quote: plans };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const cheapest = plans.reduce((min, r) => r.nightlyRate < min.nightlyRate ? r : min, plans[0]);
      const lines = [
        `# 🧾 Booking Quote — ${p.name}`,
        `\n🛏️ **${params.room_type}**  ·  📍 ${p.suburb}, ${p.state}`,
        `🗓️ **${params.check_in}** → **${params.check_out}** · ${nights} night${nights !== 1 ? "s" : ""}`,
        `\n✨ **Best rate: AUD $${cheapest.nightlyRate}/night — $${cheapest.totalCost} total** (${cheapest.planName})`,
        `\n| Rate Plan | Code | Per Night | ${nights}× Total | Cancellation |`,
        `|-----------|------|-----------|---------|--------------|`,
      ];
      for (const plan of plans) {
        const isBest = plan.planCode === cheapest.planCode;
        lines.push(`| ${isBest ? "✨ " : ""}${plan.planName} | \`${plan.planCode}\` | ${isBest ? "**" : ""}$${plan.nightlyRate}${isBest ? "**" : ""} | ${isBest ? "**" : ""}$${plan.totalCost}${isBest ? "**" : ""} | ${plan.cancellationPolicy} |`);
      }
      lines.push(`\n_Inclusions: ${cheapest.inclusions.join(", ")}_`);
      lines.push(`\n> Ready to book? Use \`quest_create_booking\` with property_id \`${p.id}\`, room_type \`${params.room_type}\`, and rate_plan_code \`${cheapest.planCode}\``);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 7: quest_create_booking ─────────────────────────
  server.registerTool(
    "quest_create_booking",
    {
      title: "Create Quest Booking",
      description: `Make a reservation at a Quest Apartment Hotel.

Use when a guest has chosen a property and is ready to confirm. Always confirm all details with the guest before calling this tool.

Args:
  - property_id, room_type, check_in, check_out: as above.
  - rate_plan_code: FLEX, STD, ADVP, CORP, or LONG7.
  - guests: Number of guests (1–10).
  - guest_name: Full name of lead guest.
  - guest_email: Email for confirmation.
  - guest_phone: Guest phone number.
  - response_format: "markdown" (default) or "json"

Returns a confirmation number and full booking summary.

⚠️ POC note: bookings are in-memory and reset on server restart.`,
      inputSchema: z.object({
        property_id: z.string().describe("Property ID."),
        room_type: z.enum(["Studio", "1-Bedroom", "2-Bedroom", "3-Bedroom"]).describe("Room type to book"),
        check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date YYYY-MM-DD"),
        check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date YYYY-MM-DD"),
        rate_plan_code: z.string().describe("Rate plan: FLEX, STD, ADVP, CORP, LONG7"),
        guests: z.number().int().min(1).max(10).describe("Number of guests"),
        guest_name: z.string().min(2).describe("Full name of the lead guest"),
        guest_email: z.string().email().describe("Guest email address"),
        guest_phone: z.string().describe("Guest phone number"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const p = PROPERTIES.find(x => x.id === params.property_id);
      if (!p) return { content: [{ type: "text", text: `Property "${params.property_id}" not found.` }] };

      const nights = calculateNights(params.check_in, params.check_out);
      if (nights <= 0) return { content: [{ type: "text", text: "Error: check_out must be after check_in." }] };

      const room = p.roomTypes.find(r => r.type === params.room_type);
      if (!room) return { content: [{ type: "text", text: `${p.name} does not offer ${params.room_type} apartments.` }] };

      const { available } = isStayAvailable(p.id, params.check_in, params.check_out, params.room_type, room.count);
      if (!available) {
        return { content: [{ type: "text", text: `Sorry, ${params.room_type} is not available at ${p.name} for those dates. Please try different dates or another room type.` }] };
      }

      const plans = getRatePlans(p, params.room_type, params.check_in, params.check_out);
      const selectedPlan = plans.find(x => x.planCode === params.rate_plan_code);
      if (!selectedPlan) {
        return { content: [{ type: "text", text: `Rate plan "${params.rate_plan_code}" not available. Valid plans: ${plans.map(x => x.planCode).join(", ")}` }] };
      }

      const confirmationNumber = generateConfirmationNumber();
      const booking: Booking = {
        confirmationNumber,
        propertyId: p.id, propertyName: p.name,
        roomType: params.room_type, checkIn: params.check_in, checkOut: params.check_out,
        nights, guests: params.guests,
        ratePlan: selectedPlan.planName, nightlyRate: selectedPlan.nightlyRate, totalCost: selectedPlan.totalCost,
        guestName: params.guest_name, guestEmail: params.guest_email, guestPhone: params.guest_phone,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      };
      bookings[confirmationNumber] = booking;

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }], structuredContent: booking };
      }

      const lines = [
        `# ✅ Booking Confirmed!`,
        `## Confirmation: **${confirmationNumber}**\n`,
        `| Field | Details |`,
        `|---|---|`,
        `| Property | ${p.name} |`,
        `| Address | ${p.address}, ${p.suburb} ${p.state} ${p.postcode} |`,
        `| Room | ${params.room_type} |`,
        `| Check-in | ${params.check_in} from ${p.checkInTime} |`,
        `| Check-out | ${params.check_out} by ${p.checkOutTime} |`,
        `| Nights | ${nights} |`,
        `| Guests | ${params.guests} |`,
        `| Rate Plan | ${selectedPlan.planName} |`,
        `| Nightly Rate | AUD $${selectedPlan.nightlyRate} |`,
        `| **Total** | **AUD $${selectedPlan.totalCost}** |`,
        `| Cancellation | ${selectedPlan.cancellationPolicy} |`,
        `| Guest | ${params.guest_name} |`,
        `| Email | ${params.guest_email} |`,
        `| Phone | ${params.guest_phone} |\n`,
        `_Save your confirmation number: **${confirmationNumber}**_`,
        `_A confirmation email will be sent to ${params.guest_email}._`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: booking };
    }
  );

  // ── Tool 8: quest_get_booking ─────────────────────────────
  server.registerTool(
    "quest_get_booking",
    {
      title: "Get Quest Booking",
      description: `Look up an existing Quest booking by confirmation number.

Args:
  - confirmation_number: Booking confirmation number (e.g. "Q7XK3P2")
  - response_format: "markdown" (default) or "json"

Returns booking details including property, dates, room type, rate, and guest info.

⚠️ POC note: Only bookings made in the current server session are retrievable.`,
      inputSchema: z.object({
        confirmation_number: z.string().describe('Booking confirmation number, e.g. "Q7XK3P2"'),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const b = bookings[params.confirmation_number.toUpperCase()];
      if (!b) {
        return { content: [{ type: "text", text: `Booking "${params.confirmation_number}" not found. Note: in this POC, bookings reset on server restart.` }] };
      }

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(b, null, 2) }], structuredContent: b };
      }

      const icon = b.status === "confirmed" ? "✅ Confirmed" : "❌ Cancelled";
      const lines = [
        `# Booking ${b.confirmationNumber} — ${icon}\n`,
        `| Field | Details |`,
        `|---|---|`,
        `| Property | ${b.propertyName} |`,
        `| Room | ${b.roomType} |`,
        `| Check-in | ${b.checkIn} |`,
        `| Check-out | ${b.checkOut} |`,
        `| Nights | ${b.nights} |`,
        `| Guests | ${b.guests} |`,
        `| Rate Plan | ${b.ratePlan} |`,
        `| Nightly Rate | AUD $${b.nightlyRate} |`,
        `| **Total** | **AUD $${b.totalCost}** |`,
        `| Guest | ${b.guestName} |`,
        `| Email | ${b.guestEmail} |`,
        `| Phone | ${b.guestPhone} |`,
        `| Booked | ${new Date(b.createdAt).toLocaleString("en-AU")} |`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: b };
    }
  );

  return server;
}

// ============================================================
// VERCEL SERVERLESS HANDLER
// Exported as default for Vercel's Node.js runtime.
// Accessible at /mcp (via vercel.json rewrite from /api/mcp).
// ============================================================

export default async function handler(req: any, res: any): Promise<void> {
  // CORS — allows ChatGPT and other AI clients to connect
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. This MCP server accepts POST requests only." });
    return;
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — required for serverless
    enableJsonResponse: true,
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
