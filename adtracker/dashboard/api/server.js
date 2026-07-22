const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");
const leadsRouter = require("./routes/leads");
const performanceRouter = require("./routes/performance");
const overviewRouter = require("./routes/overview");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

// Basic auth: this API exposes lead PII (names, emails, phones), so every
// route below is gated. Fine for a single-operator dashboard; swap for
// real per-user accounts if more than one person needs access.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", "Basic");
    return res.status(401).json({ error: "Authentication required" });
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const [user, password] = decoded.split(":");

  if (user !== process.env.DASHBOARD_USER || password !== process.env.DASHBOARD_PASSWORD) {
    res.set("WWW-Authenticate", "Basic");
    return res.status(401).json({ error: "Invalid credentials" });
  }

  next();
}

app.use(requireAuth);

app.use("/api/leads", leadsRouter);
app.use("/api/performance", performanceRouter);
app.use("/api/overview", overviewRouter);

// GET /api/campaigns -- for filter dropdowns in the UI
app.get("/api/campaigns", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, status FROM campaigns ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch campaigns:", err);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.PORT || 3002;
app.listen(port, () => console.log(`Dashboard API listening on port ${port}`));
