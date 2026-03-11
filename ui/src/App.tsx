import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import { Input } from "@openai/apps-sdk-ui/components/Input";
import {
  Calendar,
  CheckCircle,
  CreditCard,
  Maps,
  Members,
  Phone,
} from "@openai/apps-sdk-ui/components/Icon";
import { startTransition, useEffect, useMemo, useState } from "react";

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
  roomType: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  ratePlan: string;
  totalCost: number;
  guestName: string;
  guestEmail: string;
};

type RecommendationResult = SearchProperty & {
  rank: number;
  reasons: string[];
};

type SearchResultPayload = {
  total?: number;
  properties?: SearchProperty[];
  results?: AvailabilityResult[];
  recommendations?: RecommendationResult[];
  summary?: string;
  id?: string;
  name?: string;
  address?: string;
};

type ResultKind = "detail" | "recommendations" | "discovery" | "availability" | "empty";
type AppScreen = "results" | "checkout" | "confirmed";

type NormalizedProperty = SearchProperty & {
  bestRate?: AvailabilityResult["bestRate"];
  roomsLeft?: number;
  suggestedRoomType?: RoomType["type"];
  rank?: number;
  reasons?: string[];
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
    if (tags.size >= 5) break;
    tags.add(amenity);
  }
  return Array.from(tags).slice(0, 5);
}

function normalizeProperties(payload: SearchResultPayload | null): NormalizedProperty[] {
  if (!payload) return [];
  if (typeof payload.id === "string" && typeof payload.name === "string") return [payload as NormalizedProperty];
  if (Array.isArray(payload.recommendations)) return payload.recommendations;
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

function getResultKind(payload: SearchResultPayload | null): ResultKind {
  if (!payload) return "empty";
  if (typeof payload.id === "string") return "detail";
  if (Array.isArray(payload.recommendations)) return "recommendations";
  if (Array.isArray(payload.results)) return "availability";
  if (Array.isArray(payload.properties)) return "discovery";
  return "empty";
}

function getDestinationLabel(input: SearchInput | null) {
  return input?.location ?? input?.state ?? "";
}

function getDefaultRoomType(property: NormalizedProperty | null, input: SearchInput | null) {
  if (input?.room_type) return input.room_type;
  if (property?.suggestedRoomType) return property.suggestedRoomType;
  return property?.roomTypes?.[0]?.type ?? DEFAULT_ROOM_TYPE;
}

function getHeaderCopy(kind: ResultKind, total: number) {
  if (kind === "recommendations") return { eyebrow: "Recommended stays", title: `${total} curated options` };
  if (kind === "availability") return { eyebrow: "Available now", title: `${total} ready to book` };
  if (kind === "detail") return { eyebrow: "Property ready", title: "Review stay details" };
  if (kind === "discovery") return { eyebrow: "Search results", title: `${total} matching properties` };
  return { eyebrow: "Quest booking", title: "Search to begin" };
}

export function App() {
  const [lastInput, setLastInput] = useState<SearchInput | null>(null);
  const [lastResult, setLastResult] = useState<SearchResultPayload | null>(null);
  const [properties, setProperties] = useState<NormalizedProperty[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, SearchProperty>>({});
  const [selectedId, setSelectedId] = useState("");
  const [screen, setScreen] = useState<AppScreen>("results");
  const [status, setStatus] = useState("Waiting for a Quest result.");
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [booking, setBooking] = useState<BookingPayload | null>(null);
  const [busyAction, setBusyAction] = useState<"" | "quote" | "details" | "book">("");
  const [showAllResults, setShowAllResults] = useState(false);
  const [form, setForm] = useState({
    checkIn: nextDate(7),
    checkOut: nextDate(10),
    guests: "2",
    roomType: DEFAULT_ROOM_TYPE,
    guestName: "",
    guestEmail: "",
    guestPhone: "",
  });

  const { app, isConnected, error } = useApp({
    appInfo: { name: "Quest Booking", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (createdApp) => {
      createdApp.ontoolinput = (params) => {
        startTransition(() => {
          setLastInput((params.arguments ?? null) as SearchInput | null);
          setStatus("Receiving Quest results.");
        });
      };

      createdApp.ontoolresult = (params) => {
        const payload = (params.structuredContent ?? null) as SearchResultPayload | null;
        const normalized = normalizeProperties(payload);
        startTransition(() => {
          setLastResult(payload);
          setProperties(normalized);
          setSelectedId(normalized[0]?.id ?? "");
          setScreen("results");
          setQuote(null);
          setBooking(null);
          setShowAllResults(false);
          setStatus(
            normalized.length > 0
              ? `Showing ${payload?.total ?? normalized.length} Quest option${normalized.length === 1 ? "" : "s"}.`
              : "No Quest properties matched the latest request."
          );
        });
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  const resultKind = getResultKind(lastResult);
  const totalResults = lastResult?.total ?? properties.length;
  const selectedProperty =
    properties.find((property) => property.id === selectedId) ??
    (properties.length > 0 ? properties[0] : null);
  const selectedPropertyWithDetails = selectedProperty
    ? { ...selectedProperty, ...(detailsById[selectedProperty.id] ?? {}) }
    : null;
  const destinationLabel = getDestinationLabel(lastInput);
  const headerCopy = getHeaderCopy(resultKind, totalResults);
  const visibleProperties = showAllResults ? properties : properties.slice(0, 5);
  const roomOptions = useMemo(
    () => selectedPropertyWithDetails?.roomTypes?.map((room) => room.type) ?? [DEFAULT_ROOM_TYPE],
    [selectedPropertyWithDetails]
  );
  const activeQuote = quote?.propertyId === selectedProperty?.id ? quote : null;
  const canSubmitBooking = Boolean(form.guestName.trim() && form.guestEmail.trim() && activeQuote?.quote?.[0]);

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

  useEffect(() => {
    setQuote(null);
  }, [selectedId, form.checkIn, form.checkOut, form.guests, form.roomType]);

  function startCheckout(propertyId: string) {
    setSelectedId(propertyId);
    setScreen("checkout");
  }

  async function requestQuote() {
    if (!app || !selectedProperty) return;
    setBusyAction("quote");
    setBooking(null);
    setStatus(`Fetching live rate for ${selectedProperty.name}.`);

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
        setStatus("Rate ready.");
      }
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : "Unable to fetch quote.");
    } finally {
      setBusyAction("");
    }
  }

  async function createBooking() {
    if (!app || !selectedProperty || !activeQuote?.quote?.[0]) return;
    setBusyAction("book");
    setStatus(`Creating booking for ${selectedProperty.name}.`);

    try {
      const result = await app.callServerTool({
        name: "quest_create_booking",
        arguments: {
          property_id: selectedProperty.id,
          room_type: form.roomType,
          check_in: form.checkIn,
          check_out: form.checkOut,
          rate_plan_code: activeQuote.quote[0].planCode,
          guests: Number(form.guests),
          guest_name: form.guestName,
          guest_email: form.guestEmail,
          guest_phone: form.guestPhone,
          response_format: "json",
        },
      });

      if (result.structuredContent) {
        const confirmedBooking = result.structuredContent as BookingPayload;
        setBooking(confirmedBooking);
        setScreen("confirmed");
        setStatus("Booking confirmed.");

        try {
          await app.updateModelContext({
            structuredContent: {
              booking_confirmation: confirmedBooking,
              selected_property: {
                id: selectedProperty.id,
                name: selectedProperty.name,
                address: selectedProperty.address,
              },
            },
          });

          await app.sendMessage({
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `I confirmed this booking in the Quest app. ` +
                  `Please present the booking confirmation in chat using these details: ` +
                  `${confirmedBooking.confirmationNumber} for ${confirmedBooking.propertyName}, ` +
                  `${confirmedBooking.checkIn} to ${confirmedBooking.checkOut}, ` +
                  `${confirmedBooking.roomType}, ${confirmedBooking.guests} guest${confirmedBooking.guests === 1 ? "" : "s"}, ` +
                  `${formatCurrency(confirmedBooking.totalCost)}, booked for ${confirmedBooking.guestName} (${confirmedBooking.guestEmail}).`,
              },
            ],
          });
        } catch (messageError) {
          setStatus(
            messageError instanceof Error
              ? `Booking confirmed, but chat sync failed: ${messageError.message}`
              : "Booking confirmed, but chat sync failed."
          );
        }
      }
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : "Unable to complete booking.");
    } finally {
      setBusyAction("");
    }
  }

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
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="secondary" pill>
                  Quest
                </Badge>
                <Badge color="info" variant="soft" pill>
                  {isConnected ? "Connected" : "Connecting"}
                </Badge>
                {destinationLabel ? (
                  <Badge color="secondary" variant="soft" pill>
                    {destinationLabel}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-secondary">{headerCopy.eyebrow}</p>
              <h1 className="heading-lg">{headerCopy.title}</h1>
              <p className="text-sm text-secondary">{lastResult?.summary ?? status}</p>
            </div>
            {totalResults > 0 ? (
              <div className="rounded-xl border border-default bg-surface-secondary px-3 py-2 text-sm text-secondary">
                {totalResults} result{totalResults === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        </section>

        {screen === "confirmed" && booking ? (
          <section className="rounded-2xl border border-success/20 bg-success/5 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-1 size-5 text-success" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-secondary">Booking confirmed</p>
                <h2 className="heading-sm">{booking.confirmationNumber}</h2>
                <p className="text-sm text-primary">
                  {booking.propertyName} · {booking.checkIn} to {booking.checkOut}
                </p>
                <p className="text-sm text-secondary">
                  {booking.guestName} · {booking.roomType} · {formatCurrency(booking.totalCost)}
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button color="primary" onClick={() => setScreen("results")}>
                    View other stays
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {screen === "checkout" && selectedPropertyWithDetails ? (
          <>
            <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color="info" variant="soft" pill>
                      Checkout
                    </Badge>
                    {selectedPropertyWithDetails.roomsLeft ? (
                      <Badge color="success" variant="soft" pill>
                        {selectedPropertyWithDetails.roomsLeft} left
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="heading-sm">{selectedPropertyWithDetails.name}</h2>
                  <div className="flex items-start gap-2 text-sm text-secondary">
                    <Maps className="mt-0.5 size-4" />
                    <span>{selectedPropertyWithDetails.address}</span>
                  </div>
                  <p className="text-sm text-secondary">
                    {selectedPropertyWithDetails.description ?? selectedPropertyWithDetails.shortDescription}
                  </p>
                </div>
                <Button color="secondary" variant="soft" onClick={() => setScreen("results")}>
                  Back to results
                </Button>
              </div>

              {selectedPropertyWithDetails.reasons?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedPropertyWithDetails.reasons.map((reason) => (
                    <Badge key={reason} color="secondary" variant="soft" pill>
                      {reason}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="heading-sm">Complete your stay</h3>
                {busyAction === "details" ? (
                  <Badge color="secondary" variant="soft" pill>
                    Loading details
                  </Badge>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  value={form.checkIn}
                  onChange={(event) => setForm((current) => ({ ...current, checkIn: event.target.value }))}
                  startAdornment={<Calendar className="size-4 text-secondary" />}
                />
                <Input
                  type="date"
                  value={form.checkOut}
                  onChange={(event) => setForm((current) => ({ ...current, checkOut: event.target.value }))}
                  startAdornment={<Calendar className="size-4 text-secondary" />}
                />
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={form.guests}
                  onChange={(event) => setForm((current) => ({ ...current, guests: event.target.value }))}
                  startAdornment={<Members className="size-4 text-secondary" />}
                />
                <label className="grid gap-2 text-sm text-secondary">
                  <span>Room type</span>
                  <select
                    value={form.roomType}
                    onChange={(event) => setForm((current) => ({ ...current, roomType: event.target.value as RoomType["type"] }))}
                    className="h-11 rounded-xl border border-default bg-surface px-3 text-primary outline-none transition focus:border-primary"
                  >
                    {roomOptions.map((roomType) => (
                      <option key={roomType} value={roomType}>
                        {roomType}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  value={form.guestName}
                  onChange={(event) => setForm((current) => ({ ...current, guestName: event.target.value }))}
                  placeholder="Guest name"
                />
                <Input
                  type="email"
                  value={form.guestEmail}
                  onChange={(event) => setForm((current) => ({ ...current, guestEmail: event.target.value }))}
                  placeholder="Guest email"
                />
                <div className="sm:col-span-2">
                  <Input
                    value={form.guestPhone}
                    onChange={(event) => setForm((current) => ({ ...current, guestPhone: event.target.value }))}
                    placeholder="Guest phone"
                    startAdornment={<Phone className="size-4 text-secondary" />}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {amenityTags(selectedPropertyWithDetails).map((tag) => (
                  <Badge key={tag} color="secondary" variant="outline" pill>
                    {tag}
                  </Badge>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button color="primary" loading={busyAction === "quote"} onClick={requestQuote}>
                  <CreditCard />
                  {activeQuote ? "Refresh quote" : "Get live rate"}
                </Button>
              </div>

              {activeQuote?.quote?.[0] ? (
                <div className="mt-4 rounded-2xl border border-success/20 bg-success/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-secondary">{activeQuote.quote[0].planName}</p>
                      <p className="mt-1 text-2xl font-semibold text-primary">{formatCurrency(activeQuote.quote[0].totalCost)}</p>
                      <p className="mt-1 text-sm text-secondary">
                        {formatCurrency(activeQuote.quote[0].nightlyRate)}/night for {activeQuote.nights} nights
                      </p>
                      <p className="mt-2 text-sm text-secondary">{activeQuote.quote[0].cancellationPolicy}</p>
                    </div>
                    <Badge color="success" variant="soft" pill>
                      Live quote
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <Button color="primary" block disabled={!canSubmitBooking} loading={busyAction === "book"} onClick={createBooking}>
                      <CheckCircle />
                      Book now
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-default bg-surface-secondary p-3 text-sm text-secondary">
                  Get a live rate, then confirm the booking from the same screen.
                </div>
              )}
            </section>
          </>
        ) : null}

        {screen === "results" ? (
          <section className="grid gap-3">
            {properties.length === 0 ? (
              <div className="rounded-2xl border border-default bg-surface p-6 text-sm text-secondary shadow-sm">
                Ask for Quest recommendations or availability to render a booking shortlist here.
              </div>
            ) : (
              visibleProperties.map((property) => {
                const isActive = property.id === selectedProperty?.id;
                const priceLabel = property.bestRate
                  ? `${formatCurrency(property.bestRate.nightlyRate)}/night`
                  : property.roomTypes?.[0]?.fromRate ?? "Get quote";

                return (
                  <article
                    key={property.id}
                    className={`rounded-2xl border bg-surface p-4 shadow-sm transition ${
                      isActive ? "border-primary ring-1 ring-primary/15" : "border-default"
                    }`}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="heading-sm">{property.name}</h2>
                            {typeof property.rank === "number" ? (
                              <Badge color="info" variant="soft" pill>
                                #{property.rank}
                              </Badge>
                            ) : null}
                            {property.roomsLeft ? (
                              <Badge color="success" variant="soft" pill>
                                {property.roomsLeft} left
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex items-start gap-2 text-sm text-secondary">
                            <Maps className="mt-0.5 size-4" />
                            <span>{property.address}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-default bg-surface-secondary px-3 py-2">
                          <p className="text-xs text-secondary">From</p>
                          <p className="mt-1 font-semibold text-primary">{priceLabel}</p>
                        </div>
                      </div>

                      <p className="text-sm text-primary">
                        {property.shortDescription ?? "Apartment-style Quest stay with flexible room options."}
                      </p>

                      {property.reasons?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {property.reasons.map((reason) => (
                            <Badge key={reason} color="secondary" variant="soft" pill>
                              {reason}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {amenityTags(property).map((tag) => (
                          <Badge key={tag} color="secondary" variant="outline" pill>
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button color="primary" onClick={() => startCheckout(property.id)}>
                          <CreditCard />
                          Book
                        </Button>
                        <Button color="secondary" variant="soft" onClick={() => setSelectedId(property.id)}>
                          Review
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}

            {properties.length > 5 ? (
              <div>
                <Button color="secondary" variant="soft" onClick={() => setShowAllResults((current) => !current)}>
                  {showAllResults ? "Show fewer" : `Show all ${properties.length} stays`}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
