import "dotenv/config";
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import fs from "fs";
import multer from "multer";
import path from "path";

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
app.use("/uploads", express.static("uploads", { maxAge: "1d" }));

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

const DEFAULT_RADIUS = parseInt(process.env.DEFAULT_RADIUS || "90", 10);
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // set on Render
const OPENCAGE_KEY = process.env.OPENCAGE_KEY || ""; // set on Render for geocoding

// ---- load & keep places in memory; allow editing ----
let places = JSON.parse(fs.readFileSync("./places.json", "utf-8")).map(p => ({
  ...p, radius: p.radius || DEFAULT_RADIUS
}));
let placeById = Object.fromEntries(places.map(p => [p.id, p]));

function savePlaces() {
  fs.writeFileSync("./places.json", JSON.stringify(places, null, 2));
  placeById = Object.fromEntries(places.map(p => [p.id, p]));
}

// ---- geofence utils ----
const OUTSIDE_GRACE_MS = 10_000;
const toRad = d => (d * Math.PI) / 180;
const haversineMeters = (a, b) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
};
const getBaseUrl = (req) => {
  const envBase = process.env.BASE_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString().split(",")[0];
  return `${proto}://${req.get("host")}`;
};

// ---- avatar uploads (JPEG/PNG/WebP, 3 MB) ----
// (uses disk; on Render free it’s ephemeral but fine for demos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, nanoid() + (ext || ".png"));
  }
});
function fileFilter(req, file, cb) {
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
  cb(ok ? null : new Error("Only JPEG/PNG/WebP allowed"), ok);
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 3 * 1024 * 1024 } });

app.post("/api/upload", upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  return res.json({ url: `/uploads/${req.file.filename}` });
});

// ---- public APIs ----
app.get("/api/places", (req, res) => res.json(places));
app.get("/api/places/:id", (req, res) => {
  const p = placeById[req.params.id];
  if (!p) return res.status(404).json({ error: "Place not found" });
  res.json(p);
});
app.get("/qr/:placeId.png", async (req, res) => {
  const place = placeById[req.params.placeId];
  if (!place) return res.status(404).send("Unknown place");
  const base = getBaseUrl(req);
  const joinUrl = `${base}/join.html?place=${encodeURIComponent(place.id)}`;
  res.type("png");
  try {
    const buf = await QRCode.toBuffer(joinUrl, { width: 512, margin: 1 });
    res.send(buf);
  } catch { res.status(500).send("QR error"); }
});

// ---- sessions & sockets ----
// sessionId -> { placeId, alias, phone, funFact, gender, avatarUrl, socketId, outsideTimer, lastGpsAt, isInside, outCount }
const sessions = new Map();

app.post("/api/session/join", (req, res) => {
  const { placeId, alias, phone, funFact, gender, avatarUrl } = req.body || {};
  const place = placeById[placeId];
  if (!place) return res.status(400).json({ error: "Invalid place" });
  if (!alias || !phone) return res.status(400).json({ error: "Alias and phone required" });
  const sessionId = nanoid();
  sessions.set(sessionId, {
    placeId,
    alias: String(alias).slice(0,50),
    phone: String(phone).slice(0,32),
    funFact: String(funFact||"").slice(0,140),
    gender: String(gender||"").slice(0,40),
    avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
    socketId: null, outsideTimer: null, lastGpsAt: 0, isInside: null, outCount: 0
  });
  res.json({ sessionId });
});

app.get("/api/rooms/:placeId/members", (req, res) => {
  const { placeId } = req.params;
  const list = [];
  for (const [sid, s] of sessions.entries()) {
    if (s.placeId === placeId && s.socketId) {
      list.push({ sessionId: sid, alias: s.alias, gender: s.gender, avatarUrl: s.avatarUrl, funFact: s.funFact, lastGpsAt: s.lastGpsAt, isInside: s.isInside });
    }
  }
  res.json(list);
});

io.on("connection", (socket) => {
  socket.on("auth", ({ sessionId }) => {
    const sess = sessions.get(sessionId);
    if (!sess) { socket.emit("auth_error", "Invalid session"); return socket.disconnect(true); }
    sess.socketId = socket.id;
    socket.data.sessionId = sessionId;
    socket.join(sess.placeId);
    const place = placeById[sess.placeId];
    socket.emit("welcome", { alias: sess.alias, place: { id: place.id, name: place.name }, gender: sess.gender, avatarUrl: sess.avatarUrl });
    io.to(sess.placeId).emit("presence", { type: "join", id: sessionId, alias: sess.alias, gender: sess.gender, avatarUrl: sess.avatarUrl });
  });

  socket.on("gps", (payload = {}) => {
    const sess = sessions.get(socket.data.sessionId);
    if (!sess) return;
    const place = placeById[sess.placeId];
    const { lat, lng, accuracy } = payload;
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const acc = Math.max(0, Number(accuracy) || 0);
    const d = haversineMeters({ lat, lng }, { lat: place.lat, lng: place.lng });
    sess.lastGpsAt = Date.now();

    const accClamped = Math.min(acc, 80);
    const enterThreshold = place.radius + 10 + accClamped * 0.3;
    const leaveThreshold = place.radius + 25 + accClamped * 0.6;
    const veryPoorFix = acc > 150;

    const insideNow = d <= enterThreshold;
    const outsideNow = d >= leaveThreshold;

    if (veryPoorFix) { socket.emit("geodebug", { distance: d, accuracy: acc, radius: place.radius, enterThreshold, leaveThreshold, state: "ignored" }); return; }

    if (insideNow) {
      if (sess.outsideTimer) clearTimeout(sess.outsideTimer);
      sess.outsideTimer = null;
      sess.isInside = true;
      sess.outCount = 0;
      socket.emit("geofence", { state: "inside", distance: Math.round(d), accuracy: Math.round(acc), radius: place.radius, outCount: 0 });
      return;
    }

    if (!outsideNow) {
      socket.emit("geofence", { state: (sess.isInside ? "inside" : "borderline"), distance: Math.round(d), accuracy: Math.round(acc), radius: place.radius, outCount: sess.outCount });
      return;
    }

    sess.outCount = (sess.outCount || 0) + 1;
    if (sess.outCount < 3) {
      socket.emit("geofence", { state: "borderline", distance: Math.round(d), accuracy: Math.round(acc), radius: place.radius, outCount: sess.outCount });
      return;
    }

    if (sess.isInside !== false) {
      sess.isInside = false;
      socket.emit("geofence", { state: "outside", countdownSec: OUTSIDE_GRACE_MS/1000, distance: Math.round(d), accuracy: Math.round(acc), radius: place.radius, outCount: sess.outCount });
    }

    if (!sess.outsideTimer) {
      sess.outsideTimer = setTimeout(() => {
        socket.emit("kicked", { reason: "left_area" });
        const alias = sess.alias; const room = sess.placeId;
        sessions.delete(socket.data.sessionId);
        socket.leave(room);
        io.to(room).emit("presence", { type: "leave", id: socket.data.sessionId, alias });
        socket.disconnect(true);
      }, OUTSIDE_GRACE_MS);
    }
  });

  socket.on("message", (text) => {
    const sess = sessions.get(socket.data.sessionId);
    if (!sess) return;
    const trimmed = String(text||"").slice(0,2000).trim();
    if (!trimmed) return;
    io.to(sess.placeId).emit("message", {
      from: socket.data.sessionId, alias: sess.alias,
      gender: sess.gender, avatarUrl: sess.avatarUrl,
      funFact: sess.funFact, text: trimmed, at: Date.now()
    });
  });

  socket.on("dm_send", ({ to, text }) => {
    const fromId = socket.data.sessionId;
    const fromSess = sessions.get(fromId);
    const toSess = sessions.get(String(to||""));
    if (!fromSess || !toSess) return;
    if (fromSess.placeId !== toSess.placeId) return;
    const payload = { from: fromId, alias: fromSess.alias, gender: fromSess.gender, avatarUrl: fromSess.avatarUrl, text: String(text||"").slice(0,2000).trim(), at: Date.now(), peer: to };
    if (!payload.text) return;
    io.to(fromSess.socketId).emit("dm_message", payload);
    io.to(toSess.socketId).emit("dm_message", { ...payload, peer: fromId });
  });

  socket.on("disconnect", () => {
    const sess = sessions.get(socket.data.sessionId);
    if (!sess) return;
    if (sess.outsideTimer) clearTimeout(sess.outsideTimer);
    const alias = sess.alias; const room = sess.placeId;
    sessions.delete(socket.data.sessionId);
    io.to(room).emit("presence", { type: "leave", id: socket.data.sessionId, alias });
  });
});

// ---- Admin helpers & APIs (no face recognition) ----
function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.key || "";
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY not set on server" });
  if (String(key) !== String(ADMIN_KEY)) return res.status(401).json({ error: "Unauthorized" });
  next();
}
const slugify = (s) => String(s || "")
  .toLowerCase()
  .replace(/['"]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

app.get("/api/admin/ping", requireAdmin, (req, res) => res.json({ ok: true }));

app.get("/api/admin/places", requireAdmin, (req, res) => res.json(places));

app.post("/api/admin/places", requireAdmin, async (req, res) => {
  const { address, name, radius } = req.body || {};
  if (!address) return res.status(400).json({ error: "address is required" });
  if (!OPENCAGE_KEY) return res.status(500).json({ error: "OPENCAGE_KEY not set on server" });

  try {
    const url = new URL("https://api.opencagedata.com/geocode/v1/json");
    url.searchParams.set("q", address);
    url.searchParams.set("key", OPENCAGE_KEY);
    url.searchParams.set("limit", "1");
    url.searchParams.set("no_annotations", "1");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("geocode failed");
    const data = await resp.json();
    const best = data.results?.[0];
    if (!best) return res.status(404).json({ error: "Address not found" });

    const lat = best.geometry.lat;
    const lng = best.geometry.lng;
    const display = best.formatted || address;

    let baseId = slugify(name || display);
    if (!baseId) baseId = "place";
    let id = baseId; let n = 1;
    while (placeById[id]) { id = `${baseId}-${++n}`; }

    const place = {
      id,
      name: name || display,
      address: display,
      lat,
      lng,
      radius: Number(radius) || DEFAULT_RADIUS
    };
    places.push(place);
    savePlaces();

    const base = process.env.BASE_URL || "";
    const joinUrl = base ? `${base}/join.html?place=${encodeURIComponent(id)}` : `/join.html?place=${encodeURIComponent(id)}`;
    const qrUrl = base ? `${base}/qr/${id}.png` : `/qr/${id}.png`;

    res.json({ place, joinUrl, qrUrl });
  } catch (e) {
    res.status(500).json({ error: "Geocoding failed" });
  }
});

app.delete("/api/admin/places/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const idx = places.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  places.splice(idx, 1);
  savePlaces();
  res.json({ ok: true });
});

// ---- 404 for non-file API ----
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/qr/")) return res.status(404).json({ error: "Not found" });
  next();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QR Chatroom listening on http://localhost:${PORT}`));
