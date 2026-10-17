import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";
import { one, run } from "./db.js";
import { loginSchema, signupSchema } from "./validation.js";

const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

export function createAuthHandlers({ db, jwtSecret, adminEmail }) {
  return {
    signup(request, response) {
      const input = signupSchema.parse(request.body);
      const email = input.email.toLowerCase();
      if (one(db, "SELECT id FROM users WHERE email = ?", [email])) {
        throw new HttpError(409, "An account with this email already exists");
      }
      const role = adminEmail && email === adminEmail.toLowerCase() ? "ADMIN" : "USER";
      const user = {
        id: randomUUID(),
        name: input.name,
        email,
        role,
      };
      run(
        db,
        "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [user.id, user.name, user.email, bcrypt.hashSync(input.password, 12), user.role, new Date().toISOString()],
      );
      db.persist();
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
      response.status(201).json({ user, token });
    },

    login(request, response) {
      const input = loginSchema.parse(request.body);
      const user = one(db, "SELECT * FROM users WHERE email = ?", [input.email.toLowerCase()]);
      if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
        throw new HttpError(401, "Email or password is incorrect");
      }
      const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: "7d" });
      response.json({ user: publicUser(user), token });
    },

    me(request, response) {
      response.json({ user: publicUser(request.user) });
    },
  };
}

export function requireAuth({ db, jwtSecret }) {
  return (request, _response, next) => {
    const header = request.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return next(new HttpError(401, "Authentication is required"));
    }
    let subject;
    try {
      subject = jwt.verify(token, jwtSecret).sub;
    } catch {
      return next(new HttpError(401, "Invalid or expired access token"));
    }
    const user = one(db, "SELECT id, name, email, role FROM users WHERE id = ?", [subject]);
    if (!user) return next(new HttpError(401, "Authentication is required"));
    request.user = user;
    return next();
  };
}

export function requireRole(...roles) {
  return (request, _response, next) => {
    if (!roles.includes(request.user?.role)) return next(new HttpError(403, "You are not allowed to perform this action"));
    return next();
  };
}
