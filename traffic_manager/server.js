const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

/* CONFIG: replace IPs with actual machine IPs */
const EDGES = {
  India: "http://192.168.1.10:3001",
  US: "http://192.168.1.11:3002",
  Asia: "http://192.168.1.12:3003"
};

const FALLBACK = {
  India: ["US", "Asia"],
  US: ["Asia", "India"],
  Asia: ["India", "US"]
};

let healthStatus = {
  India: true,
  US: true,
  Asia: true
};

let busyStatus = {
  India: false,
  US: false,
  Asia: false
};

/* ROUTING API */
app.get("/route", (req, res) => {
  const location = req.headers["x-client-location"];

  if (!location || !EDGES[location]) {
    return res.status(400).json({ error: "Invalid location" });
  }

  let selected = location;

  if (!healthStatus[selected] || busyStatus[selected]) {
    for (let fallback of FALLBACK[selected]) {
      if (healthStatus[fallback] && !busyStatus[fallback]) {
        selected = fallback;
        break;
      }
    }
  }

  res.json({
    edge: selected,
    url: EDGES[selected]
  });
});

/* PURGE API */
app.post("/purge", async (req, res) => {
  const { file } = req.body;

  if (!file) {
    return res.status(400).json({ error: "file is required" });
  }

  const results = await Promise.all(
    Object.entries(EDGES).map(async ([region, edge]) => {
      try {
        await axios.delete(`${edge}/cache/${file}`, { timeout: 2000 });
        return { region, status: "success" };
      } catch (err) {
        return { region, status: "failed" };
      }
    })
  );

  res.json({ message: "Purge broadcasted", results });
});

/* HEALTH CHECK LOOP */
setInterval(async () => {
  for (let region in EDGES) {
    try {
      await axios.get(`${EDGES[region]}/health`, { timeout: 2000 });
      healthStatus[region] = true;
    } catch {
      healthStatus[region] = false;
    }
  }
}, 5000);

/* LOAD CHECK LOOP */
setInterval(async () => {
  for (let region in EDGES) {
    try {
      const res = await axios.get(`${EDGES[region]}/status`, { timeout: 2000 });
      busyStatus[region] = res.data.activeConnections > 10;
    } catch {
      busyStatus[region] = true;
    }
  }
}, 3000);

/* ROOT */
app.get("/", (req, res) => {
  res.send("Traffic Manager Running");
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Traffic Manager running on port 5000");
});