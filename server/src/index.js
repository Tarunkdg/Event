import "dotenv/config";
import Stripe from "stripe";
import { openDatabase } from "./db.js";
import { createApp, expireReservations } from "./app.js";

const port = Number(process.env.PORT ?? 5000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set to a random value at least 32 characters long");
}

const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
if (secretKey && !secretKey.startsWith("sk_test_")) {
  throw new Error("Only Stripe test-mode secret keys (sk_test_...) are accepted by this demo");
}
const stripe = secretKey ? new Stripe(secretKey) : null;
const db = await openDatabase(process.env.DATABASE_FILE ?? "./data/events.sqlite");
const app = createApp({
  db,
  stripe,
  jwtSecret,
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
});

app.listen(port, () => {
  console.log(`Event booking API listening on http://localhost:${port}`);
});
const expiryTimer = setInterval(() => expireReservations(db), 60_000);
expiryTimer.unref();
