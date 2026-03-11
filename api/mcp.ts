/**
 * Quest Apartment Hotels — MCP Server (POC)
 * Deployed on Vercel, accessible at /mcp
 * Compatible with OpenAI ChatGPT MCP testing and Claude Desktop
 *
 * Tools (Phase 1):
 *   quest_recommend_properties  — curated shortlist for guest-facing discovery
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

import { readFileSync } from "node:fs";

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { PROPERTIES, type Property, type RoomType } from "./property-data.js";

const SEARCH_RESULTS_WIDGET_URI = "ui://quest/widgets/search-results.html";
const SEARCH_RESULTS_WIDGET_PATH = new URL("../public/quest-search-results.html", import.meta.url);

// ============================================================
// TYPES
// ============================================================

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

type Landmark = {
  aliases: string[];
  coordinates: { lat: number; lng: number };
  maxDistanceKm: number;
};

const LANDMARKS: Landmark[] = [
  {
    aliases: ["mcg", "melbourne cricket ground"],
    coordinates: { lat: -37.8199, lng: 144.9834 },
    maxDistanceKm: 5,
  },
];

function calculateDistanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getLandmarkMatch(location: string): Landmark | null {
  const normalized = location.toLowerCase().trim();
  return LANDMARKS.find((landmark) =>
    landmark.aliases.some((alias) => normalized.includes(alias))
  ) ?? null;
}

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
    const landmark = getLandmarkMatch(loc);
    const STATE_MAP: Record<string, string> = {
      "new south wales": "NSW", "victoria": "VIC", "queensland": "QLD",
      "western australia": "WA", "south australia": "SA",
      "australian capital territory": "ACT", "northern territory": "NT",
    };
    const mappedState = STATE_MAP[loc];

    if (landmark) {
      results = results
        .map((property) => ({
          property,
          distanceKm: calculateDistanceKm(landmark.coordinates, property.coordinates),
        }))
        .filter(({ distanceKm }) => distanceKm <= landmark.maxDistanceKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map(({ property }) => property);
    } else {
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

function scorePropertyForRecommendation(
  property: Property,
  opts: {
    location?: string;
    state?: string;
    hasGym?: boolean;
    hasPool?: boolean;
    hasParking?: boolean;
    hasConferenceRoom?: boolean;
  }
): number {
  let score = property.starRating * 10;
  const location = opts.location?.toLowerCase().trim();

  if (location) {
    if (property.suburb.toLowerCase() === location) score += 40;
    if (property.city.toLowerCase() === location) score += 24;
    if (property.name.toLowerCase().includes(location)) score += 18;
    if (property.suburb.toLowerCase().includes(location)) score += 14;
    if (property.city.toLowerCase().includes(location)) score += 12;
    if (property.state.toLowerCase() === location) score += 8;
  }

  if (opts.state && property.state.toUpperCase() === opts.state.toUpperCase()) score += 8;
  if (opts.hasGym && property.hasGym) score += 8;
  if (opts.hasPool && property.hasPool) score += 8;
  if (opts.hasParking && property.hasParking) score += 6;
  if (opts.hasConferenceRoom && property.hasConferenceRoom) score += 6;

  return score;
}

function buildRecommendationReasons(
  property: Property,
  opts: {
    location?: string;
    state?: string;
    hasGym?: boolean;
    hasPool?: boolean;
    hasParking?: boolean;
    hasConferenceRoom?: boolean;
  }
): string[] {
  const reasons: string[] = [];
  const location = opts.location?.toLowerCase().trim();

  if (location && property.suburb.toLowerCase() === location) reasons.push(`Direct match for ${property.suburb}`);
  else if (location && property.city.toLowerCase() === location) reasons.push(`In ${property.city}`);
  else if (location && property.suburb.toLowerCase().includes(location)) reasons.push(`Close suburb match for ${opts.location}`);

  if (property.starRating >= 4) reasons.push(`${property.starRating}-star stay`);
  if (opts.hasGym && property.hasGym) reasons.push("Includes a gym");
  if (opts.hasPool && property.hasPool) reasons.push("Includes a pool");
  if (opts.hasParking && property.hasParking) reasons.push("Has parking");
  if (opts.hasConferenceRoom && property.hasConferenceRoom) reasons.push("Has conference facilities");

  if (reasons.length < 3) {
    reasons.push(property.shortDescription);
  }

  return reasons.slice(0, 3);
}

// ============================================================
// MCP SERVER FACTORY
// ============================================================

function createServer(): McpServer {
  const server = new McpServer({ name: "quest-mcp-server", version: "1.0.0" });

  registerAppResource(
    server,
    "quest-search-results",
    SEARCH_RESULTS_WIDGET_URI,
    {
      title: "Quest Search Results",
      description: "Apps SDK widget for browsing Quest search and availability results inside ChatGPT.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          prefersBorder: false,
          csp: {
            connectDomains: [],
            resourceDomains: [],
          },
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: SEARCH_RESULTS_WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(SEARCH_RESULTS_WIDGET_PATH, "utf8"),
          _meta: {
            ui: {
              prefersBorder: false,
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

  // ── Tool 1: quest_recommend_properties ───────────────────
  registerAppTool(
    server,
    "quest_recommend_properties",
    {
      title: "Recommend Quest Properties",
      description: `Return a curated shortlist of the best Quest properties for the guest's request. This is the PRIMARY guest-facing discovery tool.

Use when the guest asks for recommendations, nearby options, or the best Quest properties for a location and amenities.

Args:
  - location: City, suburb, landmark, or state name
  - state: State abbreviation — NSW, VIC, QLD, WA, SA, ACT, NT
  - has_gym / has_pool / has_parking / has_conference_room: optional facility filters
  - max_results: shortlist size, default 5, max 5
  - response_format: "markdown" (default) or "json"

Returns a ranked shortlist with reasons for each recommendation.`,
      inputSchema: {
        location: z.string().optional().describe("City, suburb, landmark, or state name"),
        state: z.string().optional().describe("State abbreviation: NSW, VIC, QLD, WA, SA, ACT, NT"),
        has_gym: z.boolean().optional().describe("Prefer properties with a gym"),
        has_pool: z.boolean().optional().describe("Prefer properties with a pool"),
        has_parking: z.boolean().optional().describe("Prefer properties with parking"),
        has_conference_room: z.boolean().optional().describe("Prefer properties with conference facilities"),
        max_results: z.number().int().min(1).max(5).default(5).describe("Maximum recommendations to return"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri: SEARCH_RESULTS_WIDGET_URI,
        },
        "openai/outputTemplate": SEARCH_RESULTS_WIDGET_URI,
        "openai/toolInvocation/invoking": "Curating Quest recommendations",
        "openai/toolInvocation/invoked": "Quest recommendations ready",
      },
    },
    async (params) => {
      const ranked = findProperties({
        location: params.location,
        state: params.state,
        hasGym: params.has_gym,
        hasPool: params.has_pool,
        hasParking: params.has_parking,
        hasConferenceRoom: params.has_conference_room,
      })
        .map((property) => ({
          property,
          score: scorePropertyForRecommendation(property, {
            location: params.location,
            state: params.state,
            hasGym: params.has_gym,
            hasPool: params.has_pool,
            hasParking: params.has_parking,
            hasConferenceRoom: params.has_conference_room,
          }),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, params.max_results);

      if (ranked.length === 0) {
        return { content: [{ type: "text", text: "No Quest recommendations matched those criteria. Try a broader area or fewer facility constraints." }] };
      }

      const output = {
        total: ranked.length,
        summary: `Top ${ranked.length} Quest recommendation${ranked.length === 1 ? "" : "s"} for this request`,
        recommendations: ranked.map(({ property }, index) => ({
          rank: index + 1,
          id: property.id,
          name: property.name,
          address: `${property.address}, ${property.suburb} ${property.state} ${property.postcode}`,
          city: property.city,
          state: property.state,
          starRating: property.starRating,
          shortDescription: property.shortDescription,
          amenities: property.amenities,
          roomTypes: property.roomTypes.map((room) => ({ type: room.type, fromRate: `AUD $${room.baseRate}/night` })),
          hasGym: property.hasGym,
          hasPool: property.hasPool,
          hasParking: property.hasParking,
          hasConferenceRoom: property.hasConferenceRoom,
          reasons: buildRecommendationReasons(property, {
            location: params.location,
            state: params.state,
            hasGym: params.has_gym,
            hasPool: params.has_pool,
            hasParking: params.has_parking,
            hasConferenceRoom: params.has_conference_room,
          }),
        })),
      };

      if (params.response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
      }

      const lines = [`# Quest Recommendations`, ""];
      for (const recommendation of output.recommendations) {
        lines.push(`## ${recommendation.rank}. ${recommendation.name}`);
        lines.push(`${recommendation.address}`);
        lines.push(`Reasons: ${recommendation.reasons.join(" · ")}`);
        lines.push(`Room types: ${recommendation.roomTypes.map((room) => `${room.type} from ${room.fromRate}`).join(" | ")}`);
        lines.push(`Property ID: \`${recommendation.id}\``);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  // ── Tool 2: quest_search_properties ──────────────────────
  server.registerTool(
    "quest_search_properties",
    {
      title: "Search Quest Properties",
      description: `Search for Quest Apartment Hotels in Australia by location, state, or amenities. This is the raw search tool.

Use when you need the full uncurated result set. For guest-facing recommendations, prefer quest_recommend_properties.

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
      inputSchema: {
        location: z.string().optional().describe("City, suburb, or state name/abbreviation"),
        state: z.string().optional().describe("State abbreviation: NSW, VIC, QLD, WA, SA, ACT, NT"),
        has_gym: z.boolean().optional().describe("Filter to properties with a gym"),
        has_pool: z.boolean().optional().describe("Filter to properties with a pool"),
        has_parking: z.boolean().optional().describe("Filter to properties with on-site parking"),
        has_conference_room: z.boolean().optional().describe("Filter to properties with conference facilities"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
  registerAppTool(
    server,
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
      inputSchema: {
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
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri: SEARCH_RESULTS_WIDGET_URI,
        },
        "openai/outputTemplate": SEARCH_RESULTS_WIDGET_URI,
        "openai/toolInvocation/invoking": "Searching Quest availability",
        "openai/toolInvocation/invoked": "Quest availability ready",
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
