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
