import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase, run, one } from "../src/db.js";
import { createApp } from "../src/app.js";

const jwtSecret = "this-test-secret-is-long-enough-to-be-safe-123";
let db;
let server;
let baseUrl;
let stripe;
let sessionNumber = 0;
const sessions = new Map();

before(async () => {
  db = await openDatabase(":memory:");
  const eventSamples = [
    ["event-tech", "Tech Conference", "Tech", "Bengaluru", 199900, 2],
    ["event-music", "Indie Music Night", "Music", "Pune", 49900, 3],
  ];
  for (const [id, title, category, city, price, seats] of eventSamples) {
    run(
      db,
      `INSERT INTO events (id, title, category, description, banner_url, event_date, start_time, venue, city,
        ticket_price, total_seats, available_seats, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '18:00', 'Test Hall', ?, ?, ?, ?, 'PUBLISHED', ?)`,
      [id, title, category, `${title} is a detailed test event description.`, "https://example.test/banner.jpg",
        "2026-12-20", city, price, seats, seats, new Date().toISOString()],
    );
  }
  stripe = {
    checkout: {
      sessions: {
        create: async (params) => {
          const session = {
            id: `cs_test_${++sessionNumber}`,
            url: `https://checkout.stripe.test/${sessionNumber}`,
            status: "open",
            payment_status: "unpaid",
            ...params,
          };
          sessions.set(session.id, session);
          return session;
        },
        retrieve: async (id) => sessions.get(id),
        expire: async (id) => {
          const session = sessions.get(id);
          session.status = "expired";
          return session;
        },
      },
    },
    webhooks: {
      constructEvent: (body, signature, secret) => {
        assert.equal(secret, "whsec_test");
        if (signature !== "valid-test-signature" || !Buffer.isBuffer(body)) throw new Error("invalid");
        return JSON.parse(body.toString("utf8"));
      },
    },
  };
  const app = createApp({ db, stripe, jwtSecret, adminEmail: "admin@example.test", webhookSecret: "whsec_test" });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server?.close();
  db?.close();
});

async function request(path, { method = "GET", token, body, signature } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

test("authentication, event filtering, bookings, Stripe confirmation, and authorization", async () => {
  const invalidSignup = await request("/auth/signup", { method: "POST", body: { name: "A", email: "bad", password: "short" } });
  assert.equal(invalidSignup.response.status, 400);
  const noAuth = await request("/auth/me");
  assert.equal(noAuth.response.status, 401);
  const malformedJson = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformedJson.status, 400);

  const signup = await request("/auth/signup", {
    method: "POST",
    body: { name: "Alex User", email: "alex@example.test", password: "password123" },
  });
  assert.equal(signup.response.status, 201);
  const userToken = signup.data.token;
  const badLogin = await request("/auth/login", {
    method: "POST",
    body: { email: "alex@example.test", password: "wrong-password" },
  });
  assert.equal(badLogin.response.status, 401);
  const login = await request("/auth/login", {
    method: "POST",
    body: { email: "alex@example.test", password: "password123" },
  });
  assert.equal(login.response.status, 200);
  assert.equal((await request("/auth/me", { token: userToken })).data.user.email, "alex@example.test");

  const search = await request("/events?q=bangalore");
  assert.equal(search.data.events.length, 0);
  const citySearch = await request("/events?q=Bengaluru&category=Tech");
  assert.equal(citySearch.data.events.length, 1);
  assert.equal(citySearch.data.events[0].ticketPrice, 199900);
  assert.equal((await request("/events?category=Music")).data.events[0].title, "Indie Music Night");

  const unavailable = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-tech", ticketQuantity: 3 },
  });
  assert.equal(unavailable.response.status, 409);
  const checkout = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-tech", ticketQuantity: 2 },
  });
  assert.equal(checkout.response.status, 201);
  assert.equal(checkout.data.booking.totalAmount, 399800);
  assert.equal(one(db, "SELECT available_seats FROM events WHERE id = 'event-tech'").available_seats, 0);

  const retry = await request(`/bookings/${checkout.data.booking.id}/checkout`, { method: "POST", token: userToken, body: {} });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.checkoutUrl, checkout.data.checkoutUrl);
  assert.equal(sessionNumber, 1);
  const otherUser = await request("/auth/signup", {
    method: "POST", body: { name: "Sam Other", email: "sam@example.test", password: "password123" },
  });
  const forbidden = await request(`/bookings/${checkout.data.booking.id}`, { token: otherUser.data.token });
  assert.equal(forbidden.response.status, 403);

  const session = [...sessions.values()][0];
  const payload = (id, type, paymentSession = session) => JSON.stringify({
    id,
    type,
    data: { object: paymentSession },
  });
  const invalidWebhook = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": "bad-signature" }, body: payload("evt_bad", "checkout.session.completed"),
  });
  assert.equal(invalidWebhook.status, 400);
  session.payment_status = "paid";
  session.payment_intent = "pi_test_1";
  const webhook = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": "valid-test-signature" }, body: payload("evt_paid", "checkout.session.completed"),
  });
  assert.equal(webhook.status, 200);
  const status = await request(`/payments/${checkout.data.booking.id}/status`, { token: userToken });
  assert.equal(status.data.paymentStatus, "PAID");
  assert.equal(status.data.bookingStatus, "CONFIRMED");
  assert.equal(status.data.payment.amount, 399800);
  assert.equal(one(db, "SELECT stripe_payment_intent_id FROM payments WHERE booking_id = ?", [checkout.data.booking.id]).stripe_payment_intent_id, "pi_test_1");
  const duplicateWebhook = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": "valid-test-signature" }, body: payload("evt_paid", "checkout.session.completed"),
  });
  assert.equal((await duplicateWebhook.json()).duplicate, true);
  assert.equal((await request("/bookings/my", { token: userToken })).data.bookings[0].paymentStatus, "PAID");

  const failedCheckout = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-music", ticketQuantity: 1 },
  });
  assert.equal(failedCheckout.response.status, 201);
  const failedSession = [...sessions.values()][1];
  const failedWebhook = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "valid-test-signature" },
    body: JSON.stringify({
      id: "evt_failed",
      type: "checkout.session.async_payment_failed",
      data: { object: failedSession },
    }),
  });
  assert.equal(failedWebhook.status, 200);
  const failedStatus = await request(`/payments/${failedCheckout.data.booking.id}/status`, { token: userToken });
  assert.equal(failedStatus.data.bookingStatus, "CANCELLED");
  assert.equal(failedStatus.data.paymentStatus, "FAILED");
  assert.equal(one(db, "SELECT available_seats FROM events WHERE id = 'event-music'").available_seats, 3);

  const abandonedCheckout = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-music", ticketQuantity: 1 },
  });
  assert.equal(abandonedCheckout.response.status, 201);
  run(db, "UPDATE bookings SET reservation_expires_at = ? WHERE id = ?", [
    "2020-01-01T00:00:00.000Z", abandonedCheckout.data.booking.id,
  ]);
  await request("/bookings/my", { token: userToken });
  const abandonedStatus = await request(`/payments/${abandonedCheckout.data.booking.id}/status`, { token: userToken });
  assert.equal(abandonedStatus.data.bookingStatus, "EXPIRED");
  assert.equal(abandonedStatus.data.paymentStatus, "CANCELLED");
  assert.equal(one(db, "SELECT available_seats FROM events WHERE id = 'event-music'").available_seats, 3);

  const newEvent = await request("/events", {
    method: "POST",
    token: userToken,
    body: {
      title: "Community Design Day",
      category: "Workshops",
      description: "A hands-on day to learn, share, and build better designs together.",
      bannerUrl: "https://example.test/design.jpg",
      eventDate: "2027-01-12",
      startTime: "10:00",
      venue: "Studio Hall",
      city: "Bengaluru",
      ticketPrice: 50000,
      totalSeats: 25,
    },
  });
  assert.equal(newEvent.response.status, 201);
  assert.equal(newEvent.data.event.status, "PENDING");
  const deniedApproval = await request(`/events/${newEvent.data.event.id}`, {
    method: "PUT", token: userToken, body: { status: "PUBLISHED" },
  });
  assert.equal(deniedApproval.response.status, 403);
  const admin = await request("/auth/signup", {
    method: "POST", body: { name: "Admin User", email: "admin@example.test", password: "password123" },
  });
  assert.equal(admin.data.user.role, "ADMIN");
  const approved = await request(`/events/${newEvent.data.event.id}`, {
    method: "PUT", token: admin.data.token, body: { status: "PUBLISHED" },
  });
  assert.equal(approved.data.event.status, "PUBLISHED");
  assert.equal((await request("/admin/summary", { token: admin.data.token })).response.status, 200);
  assert.equal((await request("/admin/summary", { token: userToken })).response.status, 403);
  const pendingBooking = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-music", ticketQuantity: 1 },
  });
  assert.equal(pendingBooking.response.status, 201);
  const adminRecords = await request("/admin/bookings", { token: admin.data.token });
  assert.equal(adminRecords.response.status, 200);
  assert.ok(adminRecords.data.bookings.some((booking) => booking.id === pendingBooking.data.booking.id));
  const cancelled = await request(`/admin/bookings/${pendingBooking.data.booking.id}/cancel`, {
    method: "POST", token: admin.data.token,
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(one(db, "SELECT booking_status FROM bookings WHERE id = ?", [pendingBooking.data.booking.id]).booking_status, "CANCELLED");
  assert.equal(one(db, "SELECT available_seats FROM events WHERE id = 'event-music'").available_seats, 3);
  const expiredCheckout = await request("/bookings", {
    method: "POST", token: userToken, body: { eventId: "event-music", ticketQuantity: 1 },
  });
  const expiredSession = sessions.get(expiredCheckout.data.booking.stripeSessionId);
  const expiredWebhook = await fetch(`${baseUrl}/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "valid-test-signature" },
    body: JSON.stringify({
      id: "evt_session_expired",
      type: "checkout.session.expired",
      data: { object: expiredSession },
    }),
  });
  assert.equal(expiredWebhook.status, 200);
  const expiredStatus = await request(`/payments/${expiredCheckout.data.booking.id}/status`, { token: userToken });
  assert.equal(expiredStatus.data.bookingStatus, "CANCELLED");
  assert.equal(expiredStatus.data.paymentStatus, "CANCELLED");
  assert.equal(one(db, "SELECT available_seats FROM events WHERE id = 'event-music'").available_seats, 3);
});
