import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  Email,
  Maps,
  Members,
  Phone,
  Sparkles,
  Star,
} from "@openai/apps-sdk-ui/components/Icon";
import { startTransition, useEffect, useState } from "react";

type RoomType = {
  type: "Studio" | "1-Bedroom" | "2-Bedroom" | "3-Bedroom";
  fromRate?: string;
  count?: number;
  baseRatePerNight?: number;
};

type SearchProperty = {
  id: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  suburb?: string;
  postcode?: string;
  shortDescription?: string;
  description?: string;
  starRating?: number;
  amenities?: string[];
  roomTypes?: RoomType[];
  hasGym?: boolean;
  hasPool?: boolean;
  hasParking?: boolean;
  hasConferenceRoom?: boolean;
  checkIn?: string;
  checkOut?: string;
  checkInTime?: string;
  checkOutTime?: string;
  url?: string;
};

type AvailabilityResult = {
  propertyId: string;
  propertyName: string;
  address: string;
  roomType: RoomType["type"];
  roomsLeft: number;
  bestRate: {
    nightlyRate: number;
    totalCost: number;
    planCode: string;
    planName: string;
    cancellationPolicy: string;
  };
  starRating?: number;
};

type QuotePlan = {
  planCode: string;
  planName: string;
  nightlyRate: number;
  totalCost: number;
  cancellationPolicy: string;
};

type QuotePayload = {
  propertyId: string;
  propertyName: string;
  roomType: RoomType["type"];
  nights: number;
  quote: QuotePlan[];
};

type BookingPayload = {
  confirmationNumber: string;
  propertyName: string;
  totalCost: number;
  guestName: string;
  guestEmail: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  ratePlan: string;
};

type SearchInput = {
  location?: string;
  state?: string;
  check_in?: string;
  check_out?: string;
  room_type?: RoomType["type"];
  guests?: number;
  has_gym?: boolean;
  has_pool?: boolean;
  has_parking?: boolean;
  has_conference_room?: boolean;
};

type SearchResultPayload = {
  total?: number;
  properties?: SearchProperty[];
  results?: AvailabilityResult[];
};

type NormalizedProperty = SearchProperty & {
  bestRate?: AvailabilityResult["bestRate"];
  roomsLeft?: number;
  suggestedRoomType?: RoomType["type"];
};

const DEFAULT_ROOM_TYPE: RoomType["type"] = "Studio";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function nextDate(daysFromToday: number) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

function buildAmenityTags(property: SearchProperty) {
  const tags = new Set<string>(property.amenities ?? []);
  if (property.hasGym) tags.add("Gym");
  if (property.hasPool) tags.add("Pool");
  if (property.hasParking) tags.add("Parking");
  if (property.hasConferenceRoom) tags.add("Conference");
  return Array.from(tags).slice(0, 6);
}

function normalizeProperties(payload: SearchResultPayload | null): NormalizedProperty[] {
  if (!payload) return [];
  if (Array.isArray(payload.properties)) return payload.properties;
  if (!Array.isArray(payload.results)) return [];
  return payload.results.map((item) => ({
    id: item.propertyId,
    name: item.propertyName,
    address: item.address,
    shortDescription: `${item.roomType} ready to book with ${item.roomsLeft} room${item.roomsLeft === 1 ? "" : "s"} left.`,
    starRating: item.starRating,
    roomTypes: [
      {
        type: item.roomType,
        fromRate: `${formatCurrency(item.bestRate.nightlyRate)}/night`,
      },
    ],
    bestRate: item.bestRate,
    roomsLeft: item.roomsLeft,
    suggestedRoomType: item.roomType,
  }));
}

function inferDefaultRoomType(property: NormalizedProperty | null, input: SearchInput | null) {
  if (input?.room_type) return input.room_type;
  if (property?.suggestedRoomType) return property.suggestedRoomType;
  return property?.roomTypes?.[0]?.type ?? DEFAULT_ROOM_TYPE;
}

function rpcRequest<T>(method: string, params: unknown): Promise<T> {
  const id = `rpc_${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 15000);

    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0" || message.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(message.error.message || "RPC request failed"));
        return;
      }
      resolve(message.result as T);
    }

    window.addEventListener("message", onMessage, { passive: true });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}

export function App() {
  const [lastInput, setLastInput] = useState<SearchInput | null>(null);
  const [lastResult, setLastResult] = useState<SearchResultPayload | null>(null);
  const [properties, setProperties] = useState<NormalizedProperty[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detailsById, setDetailsById] = useState<Record<string, SearchProperty>>({});
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [booking, setBooking] = useState<BookingPayload | null>(null);
  const [status, setStatus] = useState("Run a Quest search in ChatGPT to load the property cards.");
  const [busyAction, setBusyAction] = useState<"" | "details" | "quote" | "book">("");
  const [form, setForm] = useState({
    checkIn: nextDate(7),
    checkOut: nextDate(10),
    roomType: DEFAULT_ROOM_TYPE,
    guests: "2",
    guestName: "Alex Weiner",
    guestEmail: "alex@example.com",
    guestPhone: "+61 400 000 000",
  });

  const selectedProperty =
    properties.find((property) => property.id === selectedId) ??
    (properties.length > 0 ? properties[0] : null);
  const selectedPropertyWithDetails = selectedProperty
    ? { ...selectedProperty, ...(detailsById[selectedProperty.id] ?? {}) }
    : null;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;

      if (message.method === "ui/notifications/tool-input") {
        const input = (message.params ?? null) as SearchInput | null;
        startTransition(() => {
          setLastInput(input);
          setStatus("Search filters synced from the conversation.");
        });
      }

      if (message.method === "ui/notifications/tool-result") {
        const payload = (message.params?.structuredContent ?? null) as SearchResultPayload | null;
        const nextProperties = normalizeProperties(payload);
        startTransition(() => {
          setLastResult(payload);
          setProperties(nextProperties);
          setSelectedId(nextProperties[0]?.id ?? "");
          setQuote(null);
          setBooking(null);
          setStatus(
            nextProperties.length > 0
              ? `Showing ${payload?.total ?? nextProperties.length} Quest option${nextProperties.length === 1 ? "" : "s"}.`
              : "No matching properties for the latest search."
          );
        });
      }
    }

    window.addEventListener("message", onMessage, { passive: true });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!selectedProperty) return;
    setForm((current) => ({
      ...current,
      roomType: inferDefaultRoomType(selectedProperty, lastInput),
      checkIn: lastInput?.check_in ?? current.checkIn,
      checkOut: lastInput?.check_out ?? current.checkOut,
      guests: String(lastInput?.guests ?? current.guests),
    }));
  }, [selectedProperty?.id, lastInput?.check_in, lastInput?.check_out, lastInput?.guests, lastInput?.room_type]);

  useEffect(() => {
    if (!selectedProperty || detailsById[selectedProperty.id]) return;

    setBusyAction("details");
    setStatus(`Loading details for ${selectedProperty.name}...`);
    void rpcRequest<{ structuredContent?: SearchProperty }>("tools/call", {
      name: "quest_get_property_details",
      arguments: {
        property_id: selectedProperty.id,
        response_format: "json",
      },
    })
      .then((result) => {
        if (!result.structuredContent) return;
        setDetailsById((current) => ({
          ...current,
          [selectedProperty.id]: result.structuredContent as SearchProperty,
        }));
        setStatus(`${selectedProperty.name} details loaded.`);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : "Failed to load property details.");
      })
      .finally(() => setBusyAction(""));
  }, [selectedProperty, detailsById]);

  async function sendPrompt(text: string) {
    await rpcRequest("ui/message", {
      role: "user",
      content: [{ type: "text", text }],
    });
  }

  async function requestQuote() {
    if (!selectedProperty) return;
    setBusyAction("quote");
    setBooking(null);
    setStatus(`Getting a live quote for ${selectedProperty.name}...`);

    try {
      const result = await rpcRequest<{ structuredContent?: QuotePayload }>("tools/call", {
        name: "quest_get_booking_quote",
        arguments: {
          property_id: selectedProperty.id,
          room_type: form.roomType,
          check_in: form.checkIn,
          check_out: form.checkOut,
          response_format: "json",
        },
      });
      if (result.structuredContent) {
        setQuote(result.structuredContent);
        setStatus("Live quote ready.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to fetch a quote.");
    } finally {
      setBusyAction("");
    }
  }

  async function createBooking() {
    if (!selectedProperty || !quote?.quote?.[0]) return;
    setBusyAction("book");
    setStatus(`Creating a POC booking for ${selectedProperty.name}...`);

    try {
      const result = await rpcRequest<{ structuredContent?: BookingPayload }>("tools/call", {
        name: "quest_create_booking",
        arguments: {
          property_id: selectedProperty.id,
          room_type: form.roomType,
          check_in: form.checkIn,
          check_out: form.checkOut,
          rate_plan_code: quote.quote[0].planCode,
          guests: Number(form.guests),
          guest_name: form.guestName,
          guest_email: form.guestEmail,
          guest_phone: form.guestPhone,
          response_format: "json",
        },
      });
      if (result.structuredContent) {
        setBooking(result.structuredContent);
        setStatus(`Booking confirmed: ${result.structuredContent.confirmationNumber}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create booking.");
    } finally {
      setBusyAction("");
    }
  }

  const filters = [
    lastInput?.location ? `Location: ${lastInput.location}` : null,
    lastInput?.state ? `State: ${lastInput.state}` : null,
    lastInput?.has_gym ? "Gym" : null,
    lastInput?.has_pool ? "Pool" : null,
    lastInput?.has_parking ? "Parking" : null,
    lastInput?.has_conference_room ? "Conference" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="quest-shell px-4 py-4 text-[15px] text-[#102233] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <section className="quest-card-glow relative overflow-hidden rounded-[28px] p-5 text-white shadow-[0_28px_60px_rgba(9,35,29,0.22)] sm:p-7">
          <div className="quest-mesh absolute inset-0 opacity-20" />
          <div className="relative grid gap-5 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="space-y-4">
              <Badge color="success" pill>
                Quest x Apps SDK UI
              </Badge>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
                  Premium Quest property cards, inside the ChatGPT booking journey.
                </h1>
                <p className="max-w-2xl text-[15px] leading-6 text-white/82 sm:text-base">
                  The search results stay conversational, while the app surfaces a polished card, live quote preview, and a minimal booking handoff without leaving ChatGPT.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {filters.length > 0 ? (
                  filters.map((filter) => (
                    <Badge key={filter} color="info" variant="soft" pill>
                      {filter}
                    </Badge>
                  ))
                ) : (
                  <Badge color="secondary" variant="soft" pill>
                    Waiting for search filters
                  </Badge>
                )}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/14 bg-white/10 p-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Current status</p>
                  <p className="mt-2 text-lg font-medium text-white">{status}</p>
                </div>
                <Star className="size-6 text-white/80" />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/55">Properties</p>
                  <p className="mt-2 text-3xl font-semibold">{properties.length}</p>
                </div>
                <div className="rounded-2xl bg-white/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/55">Selection</p>
                  <p className="mt-2 text-base font-medium text-white/92">{selectedProperty?.name ?? "None yet"}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_1.4fr]">
          <aside className="rounded-[28px] border border-[rgba(16,34,51,0.08)] bg-white/90 p-4 shadow-[0_24px_50px_rgba(16,34,51,0.08)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--quest-muted)]">Properties</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Discovery cards</h2>
              </div>
              <Badge color="secondary" variant="outline" pill>
                {lastResult?.total ?? properties.length} results
              </Badge>
            </div>
            <div className="grid gap-3">
              {properties.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[rgba(16,34,51,0.12)] bg-[rgba(246,242,234,0.7)] px-5 py-10 text-center">
                  <p className="text-base font-medium">No properties loaded yet</p>
                  <p className="mt-2 text-sm text-[var(--quest-muted)]">
                    Run <strong>quest_search_properties</strong> or <strong>quest_search_availability</strong> in ChatGPT to populate the card UI.
                  </p>
                </div>
              ) : (
                properties.map((property) => {
                  const isActive = property.id === selectedProperty?.id;
                  return (
                    <button
                      key={property.id}
                      type="button"
                      onClick={() => setSelectedId(property.id)}
                      className={`group rounded-[24px] border p-3 text-left transition ${
                        isActive
                          ? "border-[rgba(14,107,87,0.28)] bg-[rgba(216,236,232,0.56)] shadow-[0_18px_30px_rgba(14,107,87,0.12)]"
                          : "border-[rgba(16,34,51,0.08)] bg-white hover:-translate-y-0.5 hover:border-[rgba(14,107,87,0.18)]"
                      }`}
                    >
                      <div className="quest-photo relative overflow-hidden rounded-[18px] p-4 text-white">
                        <div className="absolute inset-0 quest-mesh opacity-20" />
                        <div className="relative flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/64">
                              {property.city ?? "Quest Stay"}
                            </p>
                            <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em]">{property.name}</h3>
                          </div>
                          <Badge color="warning" variant="soft" pill>
                            {Math.round(property.starRating ?? 4)} star
                          </Badge>
                        </div>
                        <p className="relative mt-12 max-w-xs text-sm leading-6 text-white/82">
                          {property.shortDescription ?? "Apartment-style accommodation with premium Quest hospitality."}
                        </p>
                      </div>
                      <div className="space-y-3 px-1 pt-3">
                        <div className="flex items-start gap-2 text-sm text-[var(--quest-muted)]">
                          <Maps className="mt-0.5 size-4 shrink-0" />
                          <span>{property.address}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {buildAmenityTags(property).map((tag) => (
                            <Badge key={tag} color="secondary" variant="soft" pill>
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--quest-muted)]">From</p>
                            <p className="mt-1 text-lg font-semibold">
                              {property.bestRate
                                ? `${formatCurrency(property.bestRate.nightlyRate)}/night`
                                : property.roomTypes?.[0]?.fromRate ?? "Quote on request"}
                            </p>
                          </div>
                          <ArrowRight
                            className={`size-5 transition ${isActive ? "translate-x-1 text-[var(--quest-brand)]" : "text-[var(--quest-muted)] group-hover:translate-x-1"}`}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <main className="grid gap-4">
            <section className="rounded-[30px] border border-[rgba(16,34,51,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,242,234,0.78))] p-4 shadow-[0_24px_50px_rgba(16,34,51,0.08)]">
              {selectedPropertyWithDetails ? (
                <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color="success" pill>
                        Featured property
                      </Badge>
                      {selectedPropertyWithDetails.roomsLeft ? (
                        <Badge color="warning" variant="soft" pill>
                          {selectedPropertyWithDetails.roomsLeft} rooms left
                        </Badge>
                      ) : null}
                    </div>
                    <div>
                      <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.04em]">
                        {selectedPropertyWithDetails.name}
                      </h2>
                      <p className="mt-2 max-w-2xl text-[15px] leading-7 text-[var(--quest-muted)]">
                        {selectedPropertyWithDetails.description ?? selectedPropertyWithDetails.shortDescription}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-[rgba(16,34,51,0.08)] bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--quest-muted)]">Stay details</p>
                        <div className="mt-3 grid gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <Calendar className="size-4 text-[var(--quest-brand)]" />
                            <span>{selectedPropertyWithDetails.checkInTime ?? selectedPropertyWithDetails.checkIn ?? "14:00"} check-in</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="size-4 text-[var(--quest-brand)]" />
                            <span>{selectedPropertyWithDetails.checkOutTime ?? selectedPropertyWithDetails.checkOut ?? "10:00"} check-out</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Maps className="size-4 text-[var(--quest-brand)]" />
                            <span>{selectedPropertyWithDetails.address}</span>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-[rgba(16,34,51,0.08)] bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--quest-muted)]">Apartment mix</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(selectedPropertyWithDetails.roomTypes ?? []).map((room) => (
                            <Badge key={room.type} color="info" variant="soft" pill>
                              {room.type}
                              {room.baseRatePerNight ? ` · ${formatCurrency(room.baseRatePerNight)}` : ""}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {buildAmenityTags(selectedPropertyWithDetails).map((tag) => (
                        <Badge key={tag} color="secondary" variant="soft" pill>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[rgba(16,34,51,0.08)] bg-white p-4 shadow-[0_18px_36px_rgba(16,34,51,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--quest-muted)]">Minimal booking flow</p>
                        <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Quote to confirmation</h3>
                      </div>
                      <Sparkles className="size-5 text-[var(--quest-brand)]" />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="quest-field">
                        <span className="quest-label">Check-in</span>
                        <Input
                          type="date"
                          value={form.checkIn}
                          onChange={(event) => setForm((current) => ({ ...current, checkIn: event.target.value }))}
                        />
                      </label>
                      <label className="quest-field">
                        <span className="quest-label">Check-out</span>
                        <Input
                          type="date"
                          value={form.checkOut}
                          onChange={(event) => setForm((current) => ({ ...current, checkOut: event.target.value }))}
                        />
                      </label>
                      <label className="quest-field">
                        <span className="quest-label">Guests</span>
                        <Input
                          type="number"
                          min="1"
                          max="10"
                          value={form.guests}
                          onChange={(event) => setForm((current) => ({ ...current, guests: event.target.value }))}
                        />
                      </label>
                      <label className="quest-field">
                        <span className="quest-label">Room type</span>
                        <select
                          className="quest-select"
                          value={form.roomType}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              roomType: event.target.value as RoomType["type"],
                            }))
                          }
                        >
                          {(selectedPropertyWithDetails.roomTypes ?? []).map((room) => (
                            <option key={room.type} value={room.type}>
                              {room.type}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="quest-divider mt-4 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--quest-muted)]">Guest details</p>
                      <div className="mt-3 grid gap-3">
                        <Input
                          value={form.guestName}
                          onChange={(event) => setForm((current) => ({ ...current, guestName: event.target.value }))}
                          startAdornment={<Members className="size-4 text-[var(--quest-muted)]" />}
                          placeholder="Lead guest name"
                        />
                        <Input
                          type="email"
                          value={form.guestEmail}
                          onChange={(event) => setForm((current) => ({ ...current, guestEmail: event.target.value }))}
                          startAdornment={<Email className="size-4 text-[var(--quest-muted)]" />}
                          placeholder="Guest email"
                        />
                        <Input
                          value={form.guestPhone}
                          onChange={(event) => setForm((current) => ({ ...current, guestPhone: event.target.value }))}
                          startAdornment={<Phone className="size-4 text-[var(--quest-muted)]" />}
                          placeholder="Guest phone"
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Button color="primary" block loading={busyAction === "quote"} onClick={requestQuote}>
                        <CreditCard />
                        Check quote
                      </Button>
                      <Button
                        color="secondary"
                        variant="soft"
                        block
                        onClick={() =>
                          sendPrompt(
                            `Compare ${selectedPropertyWithDetails.name} for ${form.checkIn} to ${form.checkOut} and suggest the best room type for ${form.guests} guests.`
                          ).catch((error) =>
                            setStatus(error instanceof Error ? error.message : "Unable to send follow-up prompt.")
                          )
                        }
                      >
                        <Sparkles />
                        Ask ChatGPT
                      </Button>
                    </div>

                    {quote ? (
                      <div className="mt-4 rounded-[24px] bg-[var(--quest-sand)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--quest-muted)]">Best available quote</p>
                            <h4 className="mt-1 text-2xl font-semibold">
                              {formatCurrency(quote.quote[0].totalCost)}
                            </h4>
                            <p className="mt-1 text-sm text-[var(--quest-muted)]">
                              {quote.quote[0].planName} at {formatCurrency(quote.quote[0].nightlyRate)}/night
                            </p>
                          </div>
                          <Badge color="success" pill>
                            {quote.nights} nights
                          </Badge>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {quote.quote.slice(0, 3).map((plan) => (
                            <div
                              key={plan.planCode}
                              className="flex items-center justify-between rounded-[18px] border border-[rgba(16,34,51,0.08)] bg-white/80 px-3 py-2"
                            >
                              <div>
                                <p className="font-medium">{plan.planName}</p>
                                <p className="text-sm text-[var(--quest-muted)]">{plan.cancellationPolicy}</p>
                              </div>
                              <p className="text-base font-semibold">{formatCurrency(plan.totalCost)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4">
                          <Button color="primary" block loading={busyAction === "book"} onClick={createBooking}>
                            <CheckCircle />
                            Create POC booking
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {booking ? (
                      <div className="mt-4 rounded-[24px] border border-[rgba(14,107,87,0.18)] bg-[rgba(216,236,232,0.52)] p-4">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="size-5 text-[var(--quest-brand)]" />
                          <p className="text-lg font-semibold">Booking confirmed</p>
                        </div>
                        <p className="mt-2 text-sm text-[var(--quest-muted)]">
                          Confirmation <strong>{booking.confirmationNumber}</strong> for {booking.guestName}.
                        </p>
                        <div className="mt-3 grid gap-2 text-sm text-[var(--quest-muted)]">
                          <p>
                            {booking.roomType} at {booking.propertyName}
                          </p>
                          <p>
                            {booking.checkIn} to {booking.checkOut} · {booking.ratePlan}
                          </p>
                          <p>
                            {formatCurrency(booking.totalCost)} · {booking.guestEmail}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-[rgba(16,34,51,0.12)] bg-white/70 px-6 py-16 text-center">
                  <p className="text-xl font-semibold">Search for a Quest property to begin</p>
                  <p className="mx-auto mt-2 max-w-xl text-[15px] leading-7 text-[var(--quest-muted)]">
                    Once a search tool returns structured results, this view becomes a premium property card with a minimal quote and booking flow.
                  </p>
                </div>
              )}
            </section>
          </main>
        </section>
      </div>
    </div>
  );
}
