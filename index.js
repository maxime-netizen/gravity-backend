const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors()); // Allow all origins (dashboard sur claude.ai)
app.use(express.json());

// ─── Helpers ────────────────────────────────────────────────────────────────
async function ghlFetch(path, apiKey, locationId) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (locationId) headers["Location-Id"] = locationId;

  const res = await fetch(`https://rest.gohighlevel.com/v1${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text}`);
  }
  return res.json();
}

async function fathomFetch(path, apiKey) {
  const res = await fetch(`https://api.usefathom.com/v1${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fathom ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// GHL — données complètes dashboard
app.post("/api/ghl", async (req, res) => {
  const { apiKey, locationId } = req.body;
  if (!apiKey) return res.status(400).json({ error: "apiKey manquante" });

  try {
    const [contactsData, pipelinesData] = await Promise.all([
      ghlFetch("/contacts/?limit=100", apiKey, locationId),
      ghlFetch("/pipelines/", apiKey, locationId),
    ]);

    const contacts = contactsData.contacts || [];
    const pipelines = pipelinesData.pipelines || [];

    // Opportunités du premier pipeline
    let opportunities = [];
    if (pipelines.length > 0) {
      const oppData = await ghlFetch(
        `/pipelines/${pipelines[0].id}/opportunities?limit=100`,
        apiKey,
        locationId
      );
      opportunities = oppData.opportunities || [];
    }

    // Stats mois en cours
    const now = new Date();
    const newContactsThisMonth = contacts.filter((c) => {
      const d = new Date(c.dateAdded || c.createdAt);
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    }).length;

    const wonOpps = opportunities.filter((o) => o.status === "won");
    const caTotal = wonOpps.reduce((s, o) => s + (o.monetaryValue || 0), 0);

    // Funnel
    const stageOrder = ["New Lead", "Contacted", "Qualified", "Proposal", "Won"];
    const funnelData = stageOrder.map((s) => ({
      label: s,
      count: opportunities.filter(
        (o) => (o.stage?.name || o.status) === s
      ).length,
    }));

    // Dernières opportunités
    const recentOpps = opportunities.slice(0, 10).map((o) => ({
      id: o.id,
      name: o.name || o.contactName || "—",
      stage: o.stage?.name || o.status || "—",
      value: o.monetaryValue || 0,
      status: o.status,
      date: o.createdAt || o.dateAdded,
    }));

    res.json({
      totalContacts: contacts.length,
      newContactsThisMonth,
      totalOpportunities: opportunities.length,
      caTotal,
      wonOpps: wonOpps.length,
      recentOpps,
      funnelData,
      pipelinesCount: pipelines.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fathom — analytics mois en cours
app.post("/api/fathom", async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "apiKey manquante" });

  try {
    const sitesData = await fathomFetch("/sites", apiKey);
    const sites = sitesData.data || [];

    if (sites.length === 0) {
      return res.json({ sites: [], pageviews: 0, visits: 0, bounceRate: 0, avgDuration: 0 });
    }

    const siteId = sites[0].id;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const to = now.toISOString().split("T")[0];

    const agg = await fathomFetch(
      `/aggregations?entity=pageview&entity_id=${siteId}&aggregates=pageviews,visits,bounce_rate,avg_duration&date_from=${from}&date_to=${to}`,
      apiKey
    );

    res.json({
      siteName: sites[0].name,
      siteCount: sites.length,
      pageviews: agg.pageviews || 0,
      visits: agg.visits || 0,
      bounceRate: agg.bounce_rate || 0,
      avgDuration: agg.avg_duration || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Gravity Backend running on port ${PORT}`);
});
