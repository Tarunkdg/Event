import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const eventSchema = z.object({
  title: z.string().trim().min(3).max(140),
  category: z.enum(["Music", "Tech", "Workshops", "Business"]),
  description: z.string().trim().min(20).max(5000),
  bannerUrl: z.string().trim().url().max(1000),
  eventDate: z.iso.date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  venue: z.string().trim().min(2).max(180),
  city: z.string().trim().min(2).max(100),
  ticketPrice: z.number().int().min(0).max(100000000),
  totalSeats: z.number().int().min(1).max(100000),
});

export const bookingSchema = z.object({
  eventId: z.string().min(1).max(80),
  ticketQuantity: z.number().int().min(1).max(10),
});

export const eventUpdateSchema = eventSchema.partial().extend({
  status: z.enum(["PENDING", "PUBLISHED", "REJECTED"]).optional(),
});
