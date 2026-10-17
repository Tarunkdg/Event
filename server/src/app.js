import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { all, one, run, transaction } from "./db.js";
import { createAuthHandlers, requireAuth, requireRole } from "./auth.js";
import { HttpError, errorHandler } from "./errors.js";
import { bookingSchema, eventSchema, eventUpdateSchema } from "./validation.js";

const asEvent = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category,
  description: row.description,
  bannerUrl: row.banner_url,
  eventDate: row.event_date,
  startTime: row.start_time,
  venue: row.venue,
  city: row.city,
  ticketPrice: row.ticket_price,
  totalSeats: row.total_seats,
  availableSeats: row.available_seats,
  status: row.status,
  hostId: row.host_id,
  createdAt: row.created_at,
});

const asBooking = (row) => ({
  id: row.id,
  eventId: row.event_id,
  eventTitle: row.event_title,
  eventDate: row.event_date,
  startTime: row.start_time,
  venue: row.venue,
  city: row.city,
  bannerUrl: row.banner_url,
  ticketQuantity: row.ticket_quantity,
  unitPrice: row.unit_price,
  totalAmount: row.total_amount,
  bookingStatus: row.booking_status,
  paymentStatus: row.payment_status,
  createdAt: row.created_at,
  reservationExpiresAt: row.reservation_expires_at,
  stripeSessionId: row.stripe_session_id,
});

function getBooking(db, id) {
  return one(
    db,
    `SELECT b.*, e.title AS event_title, e.event_date, e.start_time, e.venue, e.city, e.banner_url
     FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.id = ?`,
    [id],
  );
}

export function expireReservations(db) {
  const now = new Date().toISOString();
  const expired = all(
    db,
    "SELECT id, event_id, ticket_quantity FROM bookings WHERE booking_status = 'PENDING' AND reservation_expires_at <= ?",
    [now],
  );
  if (!expired.length) return;
  transaction(db, () => {
    for (const booking of expired) {
      const changed = run(
        db,
        "UPDATE bookings SET booking_status = 'EXPIRED', payment_status = 'CANCELLED', updated_at = ? WHERE id = ? AND booking_status = 'PENDING'",
        [now, booking.id],
      );
      if (changed) {
        run(db, "UPDATE events SET available_seats = MIN(total_seats, available_seats + ?) WHERE id = ?", [
          booking.ticket_quantity,
          booking.event_id,
        ]);
        run(db, "UPDATE payments SET status = 'CANCELLED' WHERE booking_id = ? AND status = 'PENDING'", [booking.id]);
      }
    }
  });
}

function assertStripe(stripe) {
  if (!stripe) throw new HttpError(503, "Stripe test checkout is not configured on the server");
}

async function createCheckout(db, stripe, booking) {
  assertStripe(stripe);
  if (booking.booking_status !== "PENDING" || booking.payment_status !== "PENDING") {
    throw new HttpError(409, "This booking is no longer eligible for checkout");
  }
  if (new Date(booking.reservation_expires_at).getTime() <= Date.now()) {
    expireReservations(db);
    throw new HttpError(410, "The ticket reservation has expired");
  }
  if (booking.stripe_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
    if (existing.status === "open" && existing.url) return { booking, checkoutUrl: existing.url };
    throw new HttpError(409, "This checkout session is no longer active; the reservation will expire shortly");
  }

  const event = one(db, "SELECT title FROM events WHERE id = ?", [booking.event_id]);
  const expiresAt = Math.floor(new Date(booking.reservation_expires_at).getTime() / 1000);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: booking.ticket_quantity,
        price_data: {
          currency: "inr",
          unit_amount: booking.unit_price,
          product_data: { name: event.title, description: `${booking.ticket_quantity} event ticket(s)` },
        },
      }],
      metadata: { bookingId: booking.id },
      expires_at: expiresAt,
      success_url: `${process.env.CLIENT_URL ?? "http://localhost:5173"}/booking/confirmation?bookingId=${encodeURIComponent(booking.id)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL ?? "http://localhost:5173"}/events/${encodeURIComponent(booking.event_id)}?checkout=cancelled`,
    },
    { idempotencyKey: `booking-checkout-${booking.id}` },
  );
  if (!session.url) throw new HttpError(502, "Stripe did not return a checkout URL");

  transaction(db, () => {
    run(db, "UPDATE bookings SET stripe_session_id = ?, updated_at = ? WHERE id = ? AND booking_status = 'PENDING'", [
      session.id,
      new Date().toISOString(),
      booking.id,
    ]);
    run(
      db,
      `INSERT INTO payments (id, booking_id, stripe_session_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, 'inr', 'PENDING', ?)
       ON CONFLICT(booking_id) DO UPDATE SET stripe_session_id = excluded.stripe_session_id, amount = excluded.amount, status = 'PENDING'`,
      [randomUUID(), booking.id, session.id, booking.total_amount, new Date().toISOString()],
    );
  });
  return { booking: getBooking(db, booking.id), checkoutUrl: session.url };
}

function paymentHandlers({ db, stripe, webhookSecret }) {
  return async (request, response) => {
    if (!stripe || !webhookSecret) {
      return response.status(503).json({ error: "Stripe webhook is not configured on the server" });
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(request.body, request.get("stripe-signature"), webhookSecret);
    } catch {
      return response.status(400).json({ error: "Invalid Stripe webhook signature" });
    }
    if (one(db, "SELECT id FROM webhook_events WHERE id = ?", [event.id])) {
      return response.json({ received: true, duplicate: true });
    }
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId;
    const relevant = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type);
    transaction(db, () => {
      run(db, "INSERT INTO webhook_events (id, processed_at) VALUES (?, ?)", [event.id, new Date().toISOString()]);
      if (!relevant || !bookingId) return;
      const booking = one(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
      if (!booking || booking.stripe_session_id !== session.id || booking.booking_status !== "PENDING") return;
      if (
        (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
        session.payment_status === "paid"
      ) {
        const paidAt = new Date().toISOString();
        run(db, "UPDATE bookings SET booking_status = 'CONFIRMED', payment_status = 'PAID', updated_at = ? WHERE id = ?", [
          paidAt,
          bookingId,
        ]);
        run(
          db,
          "UPDATE payments SET status = 'PAID', paid_at = ?, stripe_payment_intent_id = ? WHERE booking_id = ?",
          [paidAt, typeof session.payment_intent === "string" ? session.payment_intent : null, bookingId],
        );
      } else if (
        event.type === "checkout.session.async_payment_failed" ||
        event.type === "checkout.session.expired"
      ) {
        const status = event.type === "checkout.session.expired" ? "CANCELLED" : "FAILED";
        run(db, "UPDATE bookings SET booking_status = 'CANCELLED', payment_status = ?, updated_at = ? WHERE id = ?", [
          status,
          new Date().toISOString(),
          bookingId,
        ]);
        run(db, "UPDATE events SET available_seats = MIN(total_seats, available_seats + ?) WHERE id = ?", [
          booking.ticket_quantity,
          booking.event_id,
        ]);
        run(db, "UPDATE payments SET status = ? WHERE booking_id = ?", [status, bookingId]);
      }
    });
    return response.json({ received: true });
  };
}

export function createApp({ db, stripe = null, jwtSecret, adminEmail = "", webhookSecret = "" }) {
  const app = express();
  const auth = requireAuth({ db, jwtSecret });
  const authHandlers = createAuthHandlers({ db, jwtSecret, adminEmail });

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));
  app.post("/api/payments/webhook", express.raw({ type: "application/json" }), paymentHandlers({ db, stripe, webhookSecret }));
  app.use(express.json({ limit: "32kb" }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
  const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });

  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.post("/api/auth/signup", authLimiter, authHandlers.signup);
  app.post("/api/auth/login", authLimiter, authHandlers.login);
  app.get("/api/auth/me", auth, authHandlers.me);

  app.get("/api/events", (request, response) => {
    expireReservations(db);
    const { q = "", category, sort = "date" } = request.query;
    const orderBy = sort === "price" ? "ticket_price ASC, event_date ASC" : "event_date ASC, start_time ASC";
    const params = [];
    let where = "status = 'PUBLISHED'";
    if (typeof category === "string" && category !== "All Events") {
      where += " AND category = ?";
      params.push(category);
    }
    if (typeof q === "string" && q.trim()) {
      where += " AND (title LIKE ? COLLATE NOCASE OR city LIKE ? COLLATE NOCASE OR venue LIKE ? COLLATE NOCASE)";
      const term = `%${q.trim().slice(0, 100)}%`;
      params.push(term, term, term);
    }
    response.json({ events: all(db, `SELECT * FROM events WHERE ${where} ORDER BY ${orderBy}`, params).map(asEvent) });
  });

  app.get("/api/events/:id", (request, response, next) => {
    const event = one(db, "SELECT * FROM events WHERE id = ? AND status = 'PUBLISHED'", [request.params.id]);
    if (!event) return next(new HttpError(404, "Event not found"));
    return response.json({ event: asEvent(event) });
  });

  app.post("/api/events", auth, (request, response) => {
    const input = eventSchema.parse(request.body);
    if (input.eventDate < new Date().toISOString().slice(0, 10)) throw new HttpError(400, "Event date must be in the future");
    const id = randomUUID();
    const now = new Date().toISOString();
    transaction(db, () => {
      run(db, "UPDATE users SET role = CASE WHEN role = 'ADMIN' THEN role ELSE 'HOST' END WHERE id = ?", [request.user.id]);
      run(
        db,
        `INSERT INTO events (id, title, category, description, banner_url, event_date, start_time, venue, city,
          ticket_price, total_seats, available_seats, status, host_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [id, input.title, input.category, input.description, input.bannerUrl, input.eventDate, input.startTime,
          input.venue, input.city, input.ticketPrice, input.totalSeats, input.totalSeats, request.user.id, now],
      );
    });
    response.status(201).json({ event: asEvent(one(db, "SELECT * FROM events WHERE id = ?", [id])), message: "Event submitted for admin approval" });
  });

  app.put("/api/events/:id", auth, (request, response, next) => {
    const current = one(db, "SELECT * FROM events WHERE id = ?", [request.params.id]);
    if (!current) return next(new HttpError(404, "Event not found"));
    if (request.user.role !== "ADMIN" && current.host_id !== request.user.id) {
      return next(new HttpError(403, "You can only update events you host"));
    }
    const updates = eventUpdateSchema.parse(request.body);
    if (request.user.role !== "ADMIN" && updates.status !== undefined) {
      return next(new HttpError(403, "Only administrators can change event approval status"));
    }
    const merged = { ...asEvent(current), ...updates };
    if (merged.eventDate < new Date().toISOString().slice(0, 10)) {
      return next(new HttpError(400, "Event date must be in the future"));
    }
    const columns = {
      title: "title", category: "category", description: "description", bannerUrl: "banner_url",
      eventDate: "event_date", startTime: "start_time", venue: "venue", city: "city",
      ticketPrice: "ticket_price", totalSeats: "total_seats", status: "status",
    };
    const keys = Object.keys(updates);
    if (!keys.length) return response.json({ event: asEvent(current) });
    if (updates.totalSeats !== undefined && updates.totalSeats < current.total_seats - current.available_seats) {
      return next(new HttpError(409, "Total seats cannot be fewer than the tickets already reserved"));
    }
    const assignments = keys.map((key) => `${columns[key]} = ?`).join(", ");
    const values = keys.map((key) => merged[key]);
    if (updates.totalSeats !== undefined) {
      values.push(Math.max(0, updates.totalSeats - (current.total_seats - current.available_seats)));
      run(db, `UPDATE events SET ${assignments}, available_seats = ? WHERE id = ?`, [...values, request.params.id]);
    } else {
      run(db, `UPDATE events SET ${assignments} WHERE id = ?`, [...values, request.params.id]);
    }
    db.persist();
    return response.json({ event: asEvent(one(db, "SELECT * FROM events WHERE id = ?", [request.params.id])) });
  });

  app.delete("/api/events/:id", auth, (request, response, next) => {
    const event = one(db, "SELECT * FROM events WHERE id = ?", [request.params.id]);
    if (!event) return next(new HttpError(404, "Event not found"));
    if (request.user.role !== "ADMIN" && event.host_id !== request.user.id) {
      return next(new HttpError(403, "You can only delete events you host"));
    }
    if (one(db, "SELECT id FROM bookings WHERE event_id = ? LIMIT 1", [request.params.id])) {
      return next(new HttpError(409, "Events with booking history cannot be deleted"));
    }
    run(db, "DELETE FROM events WHERE id = ?", [request.params.id]);
    db.persist();
    return response.status(204).end();
  });

  app.post("/api/bookings", auth, checkoutLimiter, async (request, response) => {
    assertStripe(stripe);
    const input = bookingSchema.parse(request.body);
    const event = one(db, "SELECT * FROM events WHERE id = ? AND status = 'PUBLISHED'", [input.eventId]);
    if (!event) throw new HttpError(404, "Event not found");
    if (event.available_seats < input.ticketQuantity) throw new HttpError(409, "Not enough tickets are available");
    const now = new Date();
    const bookingId = randomUUID();
    const expiresAt = new Date(now.getTime() + 31 * 60 * 1000).toISOString();
    const createdAt = now.toISOString();
    transaction(db, () => {
      const reserved = run(
        db,
        "UPDATE events SET available_seats = available_seats - ? WHERE id = ? AND status = 'PUBLISHED' AND available_seats >= ?",
        [input.ticketQuantity, input.eventId, input.ticketQuantity],
      );
      if (!reserved) throw new HttpError(409, "Not enough tickets are available");
      run(
        db,
        `INSERT INTO bookings (id, user_id, event_id, ticket_quantity, unit_price, total_amount,
          booking_status, payment_status, reservation_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?, ?)`,
        [bookingId, request.user.id, input.eventId, input.ticketQuantity, event.ticket_price,
          event.ticket_price * input.ticketQuantity, expiresAt, createdAt, createdAt],
      );
    });
    const result = await createCheckout(db, stripe, one(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]));
    response.status(201).json({ booking: asBooking(getBooking(db, bookingId)), checkoutUrl: result.checkoutUrl });
  });

  app.get("/api/bookings/my", auth, (request, response) => {
    expireReservations(db);
    const bookings = all(
      db,
      `SELECT b.*, e.title AS event_title, e.event_date, e.start_time, e.venue, e.city, e.banner_url
       FROM bookings b JOIN events e ON e.id = b.event_id WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      [request.user.id],
    );
    response.json({ bookings: bookings.map(asBooking) });
  });

  app.get("/api/bookings/:id", auth, (request, response, next) => {
    expireReservations(db);
    const booking = getBooking(db, request.params.id);
    if (!booking) return next(new HttpError(404, "Booking not found"));
    if (booking.user_id !== request.user.id && request.user.role !== "ADMIN") {
      return next(new HttpError(403, "You cannot access this booking"));
    }
    return response.json({ booking: asBooking(booking) });
  });

  app.post("/api/bookings/:id/checkout", auth, checkoutLimiter, async (request, response, next) => {
    expireReservations(db);
    const booking = one(db, "SELECT * FROM bookings WHERE id = ?", [request.params.id]);
    if (!booking) return next(new HttpError(404, "Booking not found"));
    if (booking.user_id !== request.user.id && request.user.role !== "ADMIN") {
      return next(new HttpError(403, "You cannot access this booking"));
    }
    const result = await createCheckout(db, stripe, booking);
    return response.json({ booking: asBooking(getBooking(db, booking.id)), checkoutUrl: result.checkoutUrl });
  });

  app.post("/api/payments/create-checkout-session", auth, checkoutLimiter, async (request, response, next) => {
    const { bookingId } = request.body ?? {};
    if (typeof bookingId !== "string" || !bookingId) return next(new HttpError(400, "bookingId is required"));
    const booking = one(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
    if (!booking) return next(new HttpError(404, "Booking not found"));
    if (booking.user_id !== request.user.id && request.user.role !== "ADMIN") {
      return next(new HttpError(403, "You cannot access this booking"));
    }
    const result = await createCheckout(db, stripe, booking);
    return response.json({ booking: asBooking(getBooking(db, booking.id)), checkoutUrl: result.checkoutUrl });
  });

  app.get("/api/payments/:bookingId/status", auth, (request, response, next) => {
    expireReservations(db);
    const booking = one(db, "SELECT * FROM bookings WHERE id = ?", [request.params.bookingId]);
    if (!booking) return next(new HttpError(404, "Booking not found"));
    if (booking.user_id !== request.user.id && request.user.role !== "ADMIN") {
      return next(new HttpError(403, "You cannot access this payment"));
    }
    const payment = one(db, "SELECT status, amount, currency, paid_at FROM payments WHERE booking_id = ?", [booking.id]);
    return response.json({
      bookingStatus: booking.booking_status,
      paymentStatus: booking.payment_status,
      payment,
    });
  });

  app.get("/api/admin/summary", auth, requireRole("ADMIN"), (_request, response) => {
    const stats = one(
      db,
      `SELECT (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM events) AS events,
        (SELECT COUNT(*) FROM bookings) AS bookings,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'PAID') AS revenue,
        (SELECT COUNT(*) FROM events WHERE status = 'PENDING') AS pending_events`,
    );
    const pendingEvents = all(db, "SELECT * FROM events WHERE status = 'PENDING' ORDER BY created_at ASC").map(asEvent);
    const events = all(db, "SELECT * FROM events ORDER BY created_at DESC").map(asEvent);
    response.json({ stats, pendingEvents, events });
  });

  app.get("/api/admin/bookings", auth, requireRole("ADMIN"), (_request, response) => {
    const bookings = all(
      db,
      `SELECT b.id, b.ticket_quantity, b.total_amount, b.booking_status, b.payment_status, b.created_at,
        e.title AS event_title, u.name AS user_name, u.email AS user_email,
        p.stripe_session_id, p.stripe_payment_intent_id, p.amount AS payment_amount,
        p.currency AS payment_currency, p.status AS payment_record_status, p.paid_at
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN users u ON u.id = b.user_id
       LEFT JOIN payments p ON p.booking_id = b.id
       ORDER BY b.created_at DESC LIMIT 100`,
    );
    response.json({ bookings });
  });

  app.post("/api/admin/bookings/:id/cancel", auth, requireRole("ADMIN"), async (request, response, next) => {
    const booking = one(db, "SELECT * FROM bookings WHERE id = ?", [request.params.id]);
    if (!booking) return next(new HttpError(404, "Booking not found"));
    if (booking.booking_status !== "PENDING") {
      return next(new HttpError(409, "Only pending bookings can be cancelled; completed payments cannot be reversed here"));
    }
    if (booking.stripe_session_id && stripe) {
      const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
      if (session.status === "complete") {
        return next(new HttpError(409, "This checkout has completed; wait for payment confirmation instead"));
      }
      if (session.status === "open") {
        await stripe.checkout.sessions.expire(booking.stripe_session_id);
      }
    }
    const cancelled = transaction(db, () => {
      const changed = run(
        db,
        "UPDATE bookings SET booking_status = 'CANCELLED', payment_status = 'CANCELLED', updated_at = ? WHERE id = ? AND booking_status = 'PENDING'",
        [new Date().toISOString(), booking.id],
      );
      if (!changed) return false;
      run(db, "UPDATE events SET available_seats = MIN(total_seats, available_seats + ?) WHERE id = ?", [
        booking.ticket_quantity,
        booking.event_id,
      ]);
      run(db, "UPDATE payments SET status = 'CANCELLED' WHERE booking_id = ? AND status = 'PENDING'", [booking.id]);
      return true;
    });
    if (!cancelled) return next(new HttpError(409, "This booking is no longer pending"));
    return response.json({ message: "Pending booking cancelled and tickets released" });
  });

  app.use((_request, _response, next) => next(new HttpError(404, "Route not found")));
  app.use(errorHandler);
  return app;
}
