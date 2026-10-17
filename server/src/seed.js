import "dotenv/config";
import { randomUUID } from "node:crypto";
import { openDatabase, one, run } from "./db.js";

const db = await openDatabase(process.env.DATABASE_FILE ?? "./data/events.sqlite");
const samples = [
  {
    title: "Tech Conference 2026",
    category: "Tech",
    description: "A full day of big ideas, practical engineering talks, and conversations with the people building what comes next.",
    date: "2026-11-14",
    time: "09:00",
    venue: "KTPO Convention Centre",
    city: "Bengaluru",
    price: 1999,
    seats: 300,
    image: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=85",
  },
  {
    title: "Design Workshop",
    category: "Workshops",
    description: "Make better products through a hands-on day of visual exploration, prototyping, and thoughtful critique.",
    date: "2026-11-21",
    time: "10:30",
    venue: "The Bombay Art Society",
    city: "Mumbai",
    price: 799,
    seats: 60,
    image: "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=1400&q=85",
  },
  {
    title: "Frontend Meetup",
    category: "Tech",
    description: "Connect with Pune's frontend community for lightning talks, live demos, and an evening of shared learning.",
    date: "2026-11-28",
    time: "17:00",
    venue: "Ideas to Impacts",
    city: "Pune",
    price: 499,
    seats: 120,
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1400&q=85",
  },
  {
    title: "Live Music Festival",
    category: "Music",
    description: "An open-air night of brilliant independent artists, good food, and live music under the Delhi sky.",
    date: "2026-12-05",
    time: "16:00",
    venue: "Garden of Five Senses",
    city: "Delhi",
    price: 1499,
    seats: 800,
    image: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1400&q=85",
  },
  {
    title: "Business Networking Summit",
    category: "Business",
    description: "Meet ambitious founders and business leaders for a day of practical insights and meaningful connections.",
    date: "2026-12-12",
    time: "09:30",
    venue: "The Grand, Noida",
    city: "Noida",
    price: 999,
    seats: 250,
    image: "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1400&q=85",
  },
];

let inserted = 0;
for (const sample of samples) {
  if (one(db, "SELECT id FROM events WHERE title = ?", [sample.title])) continue;
  run(
    db,
    `INSERT INTO events (id, title, category, description, banner_url, event_date, start_time, venue, city,
      ticket_price, total_seats, available_seats, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)`,
    [randomUUID(), sample.title, sample.category, sample.description, sample.image, sample.date, sample.time,
      sample.venue, sample.city, sample.price * 100, sample.seats, sample.seats, new Date().toISOString()],
  );
  inserted += 1;
}
db.persist();
console.log(`Seeded ${inserted} demo event(s).`);
