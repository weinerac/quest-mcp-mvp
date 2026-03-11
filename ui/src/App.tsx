import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import {
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  Maps,
  Members,
  Sparkles,
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
  city?: string;
  state?: string;
  roomType: RoomType["type"];
  roomsLeft: number;
  starRating?: number;
  hasGym?: boolean;
  hasPool?: boolean;
  bestRate: {
    nightlyRate: number;
    totalCost: number;
    planCode: string;
    planName: string;
    cancellationPolicy: string;
  };
};

type SearchInput = {
  location?: string;
  state?: string;
  check_in?: string;
  check_out?: string;
  room_type?: RoomType["type"];
  guests?: number;
  max_rate?: number;
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

type ResultKind = "discovery" | "availability" | "empty";

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

function nextDate(offsetDays: number) {
  const next = new Date();
  next.setDate(next.getDate() + offsetDays);
  return next.toISOString().slice(0, 10);
}

function amenityTags(property: SearchProperty) {
  const tags = new Set<string>();
  if (property.hasGym) tags.add("Gym");
  if (property.hasPool) tags.add("Pool");
  if (property.hasParking) tags.add("Parking");
  if (property.hasConferenceRoom) tags.add("Conference");
  for (const amenity of property.amenities ?? []) {
    if (tags.size >= 6) break;
    tags.add(amenity);
  }
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
    city: item.city,
    state: item.state,
    starRating: item.starRating,
    hasGym: item.hasGym,
    hasPool: item.hasPool,
    shortDescription: `${item.roomType} available with ${item.roomsLeft} room${item.roomsLeft === 1 ? "" : "s"} left.`,
    roomTypes: [{ type: item.roomType, fromRate: `${formatCurrency(item.bestRate.nightlyRate)}/night` }],
    bestRate: item.bestRate,
    roomsLeft: item.roomsLeft,
    suggestedRoomType: item.roomType,
  }));
}

function getDestinationLabel(input: SearchInput | null) {
  return input?.location ?? input?.state ?? "";
}

function getStayLabel(input: SearchInput | null, checkIn: string, checkOut: string) {
  return `${input?.check_in ?? checkIn} to ${input?.check_out ?? checkOut}`;
}

function getDefaultRoomType(property: NormalizedProperty | null, input: SearchInput | null) {
  if (input?.room_type) return input.room_type;
  if (property?.suggestedRoomType) return property.suggestedRoomType;
  return property?.roomTypes?.[0]?.type ?? DEFAULT_ROOM_TYPE;
}

export function App() {
  const [lastInput, setLastInput] = useState<SearchInput | null>(null);
  const [lastResult, setLastResult] = useState<SearchResultPayload | null>(null);
  const [properties, setProperties] = useState<NormalizedProperty[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, SearchProperty>>({});
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("Waiting for tool output.");
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "quote" | "details">("");
  const [showAllResults, setShowAllResults] = useState(false);
  const [form, setForm] = useState({
    checkIn: nextDate(7),
    checkOut: nextDate(10),
    guests: "2",
    roomType: DEFAULT_ROOM_TYPE,
  });

  const { app, isConnected, error } = useApp({
    appInfo: { name: "Quest Search Results", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (createdApp) => {
      createdApp.ontoolinput = (params) => {
        startTransition(() => {
          setLastInput((params.arguments ?? null) as SearchInput | null);
          setStatus("Tool input received.");
        });
      };

      createdApp.ontoolresult = (params) => {
        const payload = (params.structuredContent ?? null) as SearchResultPayload | null;
        const normalized = normalizeProperties(payload);
        startTransition(() => {
          setLastResult(payload);
          setProperties(normalized);
          setSelectedId(normalized[0]?.id || "");
          setQuote(null);
          setShowAllResults(false);
          setStatus(
            normalized.length > 0
              ? `Showing ${payload?.total ?? normalized.length} result${normalized.length === 1 ? "" : "s"}.`
              : "No results from the latest search."
          );
        });
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  const selectedProperty =
    properties.find((property) => property.id === selectedId) ??
    (properties.length > 0 ? properties[0] : null);
  const selectedPropertyWithDetails = selectedProperty
    ? { ...selectedProperty, ...(detailsById[selectedProperty.id] ?? {}) }
    : null;

  useEffect(() => {
    if (!selectedProperty) return;
    setForm((current) => ({
      ...current,
      roomType: getDefaultRoomType(selectedProperty, lastInput),
      checkIn: lastInput?.check_in ?? current.checkIn,
      checkOut: lastInput?.check_out ?? current.checkOut,
      guests: String(lastInput?.guests ?? current.guests),
    }));
  }, [selectedProperty?.id, lastInput?.check_in, lastInput?.check_out, lastInput?.guests, lastInput?.room_type]);

  useEffect(() => {
    if (!app || !selectedProperty || detailsById[selectedProperty.id]) return;

    setBusyAction("details");
    void app
      .callServerTool({
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
      })
      .catch((requestError) => {
        setStatus(requestError instanceof Error ? requestError.message : "Failed to load property details.");
      })
      .finally(() => setBusyAction(""));
  }, [app, selectedProperty, detailsById]);

  async function requestQuote() {
    if (!app || !selectedProperty) return;
    setBusyAction("quote");
    setStatus(`Fetching quote for ${selectedProperty.name}...`);

    try {
      const result = await app.callServerTool({
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
        setQuote(result.structuredContent as QuotePayload);
        setStatus("Quote ready.");
      }
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : "Unable to fetch quote.");
    } finally {
      setBusyAction("");
    }
  }

  async function askChatGPT() {
    if (!app || !selectedProperty) return;
    try {
      await app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `Compare ${selectedProperty.name} with the other Quest options and recommend the best choice.`,
          },
        ],
      });
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : "Unable to send follow-up.");
    }
  }

  const totalResults = lastResult?.total ?? properties.length;
  const resultKind: ResultKind = Array.isArray(lastResult?.results)
    ? "availability"
    : Array.isArray(lastResult?.properties)
      ? "discovery"
      : "empty";
  const destinationLabel = getDestinationLabel(lastInput);
  const stayLabel = getStayLabel(lastInput, form.checkIn, form.checkOut);
  const filters = [
    lastInput?.location ? `Location: ${lastInput.location}` : null,
    lastInput?.state ? `State: ${lastInput.state}` : null,
    lastInput?.check_in ? `Check-in: ${lastInput.check_in}` : null,
    lastInput?.check_out ? `Check-out: ${lastInput.check_out}` : null,
    lastInput?.room_type ? `Room: ${lastInput.room_type}` : null,
    lastInput?.max_rate ? `Max ${formatCurrency(lastInput.max_rate)}` : null,
    lastInput?.has_gym ? "Gym" : null,
    lastInput?.has_pool ? "Pool" : null,
  ].filter(Boolean) as string[];
  const hasSummaryContext = Boolean(destinationLabel || lastInput?.check_in || lastInput?.check_out || filters.length > 0);
  const hasStayContext = Boolean(lastInput?.check_in || lastInput?.check_out);
  const canQuote = resultKind === "availability" && hasStayContext;
  const visibleResultCount = resultKind === "discovery" ? 6 : 8;
  const visibleProperties = showAllResults ? properties : properties.slice(0, visibleResultCount);

  if (error) {
    return (
      <div className="quest-shell p-4">
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="quest-shell bg-transparent p-3 text-primary sm:p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {hasSummaryContext ? (
          <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge color="secondary" pill>
                    Quest
                  </Badge>
                  <Badge color="info" variant="soft" pill>
                    {isConnected ? "Connected" : "Connecting"}
                  </Badge>
                </div>
                <div>
                  {destinationLabel ? <h1 className="heading-lg">{destinationLabel}</h1> : null}
                  {(lastInput?.check_in || lastInput?.check_out) ? (
                    <p className="mt-1 text-sm text-secondary">{stayLabel}</p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-2 rounded-xl border border-default bg-surface-secondary p-3 text-sm sm:min-w-[220px]">
                <div className="flex items-center justify-between">
                  <span className="text-secondary">Results</span>
                  <span className="font-medium">{totalResults}</span>
                </div>
                <div className="text-secondary">{status}</div>
              </div>
            </div>

            {filters.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {filters.map((filter) => (
                  <Badge key={filter} color="secondary" variant="soft" pill>
                    {filter}
                  </Badge>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2">
            {properties.length === 0 ? (
              <div className="rounded-2xl border border-subtle bg-surface p-8 text-center text-sm text-secondary shadow-sm md:col-span-2">
                Use <strong>quest_search_properties</strong> or <strong>quest_search_availability</strong> to render results here.
              </div>
            ) : (
              visibleProperties.map((property) => {
                const active = property.id === selectedProperty?.id;
                const priceLabel = property.bestRate
                  ? `${formatCurrency(property.bestRate.nightlyRate)}/night`
                  : property.roomTypes?.[0]?.fromRate ?? "Quote";

                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => setSelectedId(property.id)}
                    className={`h-full w-full rounded-2xl border bg-surface p-4 text-left shadow-sm transition ${
                      active ? "border-primary ring-1 ring-primary/20" : "border-default hover:border-secondary"
                    }`}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="heading-sm">{property.name}</h2>
                        {property.roomsLeft ? (
                          <Badge color="success" variant="soft" pill>
                            {property.roomsLeft} left
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-secondary">{property.address}</p>
                      <p className="text-sm text-primary">
                        {property.shortDescription ?? "Apartment-style Quest stay with flexible room options."}
                      </p>

                      <div className="w-fit rounded-xl border border-default bg-surface-secondary px-3 py-2">
                        <p className="text-xs text-secondary">From</p>
                        <p className="mt-1 font-semibold text-primary">{priceLabel}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {amenityTags(property).map((tag) => (
                          <Badge key={tag} color="secondary" variant="outline" pill>
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })
            )}

            {properties.length > visibleResultCount ? (
              <div className="md:col-span-2">
                <Button
                  color="secondary"
                  variant="soft"
                  onClick={() => setShowAllResults((current) => !current)}
                >
                  {showAllResults ? "Show fewer" : `Show all ${properties.length} results`}
                </Button>
              </div>
            ) : null}
          </div>

          <aside className="grid gap-4">
            <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
              {selectedPropertyWithDetails ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="heading-sm truncate">{selectedPropertyWithDetails.name}</h2>
                      <p className="mt-1 text-sm text-secondary">{selectedPropertyWithDetails.address}</p>
                    </div>
                    <Badge color="secondary" variant="soft" pill>
                      {selectedPropertyWithDetails.starRating ? `${Math.round(selectedPropertyWithDetails.starRating)} star` : "Quest"}
                    </Badge>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-secondary">
                    {selectedPropertyWithDetails.description ?? selectedPropertyWithDetails.shortDescription}
                  </p>

                  <div className="mt-4 grid gap-3 text-sm">
                    <div className="flex items-start gap-2">
                      <Maps className="mt-0.5 size-4 text-secondary" />
                      <span>{selectedPropertyWithDetails.city ?? destinationLabel}</span>
                    </div>
                    {hasStayContext ? (
                      <div className="flex items-start gap-2">
                        <Calendar className="mt-0.5 size-4 text-secondary" />
                        <span>{stayLabel}</span>
                      </div>
                    ) : null}
                    {hasStayContext ? (
                      <div className="flex items-start gap-2">
                        <Clock className="mt-0.5 size-4 text-secondary" />
                        <span>
                          Check-in {selectedPropertyWithDetails.checkInTime ?? "14:00"} / Check-out {selectedPropertyWithDetails.checkOutTime ?? "10:00"}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(selectedPropertyWithDetails.roomTypes ?? []).map((room) => (
                      <Badge key={room.type} color="info" variant="soft" pill>
                        {room.type}
                        {room.baseRatePerNight ? ` ${formatCurrency(room.baseRatePerNight)}` : ""}
                      </Badge>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-secondary">Select a property from the results list.</div>
              )}
            </section>

            {selectedPropertyWithDetails && canQuote ? (
              <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="heading-sm">Quote</h3>
                  <Badge color="secondary" variant="soft" pill>
                    {form.guests} guest{form.guests === "1" ? "" : "s"}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3">
                  <Input
                    type="date"
                    value={form.checkIn}
                    onChange={(event) => setForm((current) => ({ ...current, checkIn: event.target.value }))}
                  />
                  <Input
                    type="date"
                    value={form.checkOut}
                    onChange={(event) => setForm((current) => ({ ...current, checkOut: event.target.value }))}
                  />
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={form.guests}
                    onChange={(event) => setForm((current) => ({ ...current, guests: event.target.value }))}
                    startAdornment={<Members className="size-4 text-secondary" />}
                  />
                </div>

                <div className="mt-4 flex gap-2">
                  <Button color="primary" block loading={busyAction === "quote"} onClick={requestQuote}>
                    <CreditCard />
                    Get quote
                  </Button>
                  <Button color="secondary" variant="soft" onClick={askChatGPT}>
                    <Sparkles />
                  </Button>
                </div>

                {quote?.quote?.[0] ? (
                  <div className="mt-4 rounded-xl border border-success/20 bg-success/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-secondary">{quote.quote[0].planName}</p>
                        <p className="mt-1 text-xl font-semibold text-primary">{formatCurrency(quote.quote[0].totalCost)}</p>
                        <p className="mt-1 text-sm text-secondary">
                          {formatCurrency(quote.quote[0].nightlyRate)}/night for {quote.nights} nights
                        </p>
                      </div>
                      <CheckCircle className="size-5 text-success" />
                    </div>
                    <p className="mt-3 text-sm text-secondary">{quote.quote[0].cancellationPolicy}</p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {selectedPropertyWithDetails && !canQuote ? (
              <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="heading-sm">Next step</h3>
                  <Badge color="secondary" variant="soft" pill>
                    Discovery
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-secondary">
                  This result is a property discovery view. Quote and booking controls appear only after an availability search with dates.
                </p>
                <div className="mt-4">
                  <Button color="secondary" variant="soft" onClick={askChatGPT}>
                    <Sparkles />
                    Ask ChatGPT to narrow this list
                  </Button>
                </div>
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
