/* ══════════════════════════════════════════════════════════════
   import-to-firestore.js — remplit les bases Firestore
   ──────────────────────────────────────────────────────────────
   Envoie les données locales (JSON du projet) vers Firestore via
   l'API REST. Aucune dépendance : ni npm install, ni SDK.

       node tools/import-to-firestore.js              (toutes les bases)
       node tools/import-to-firestore.js sites olt    (au choix)
       node tools/import-to-firestore.js --replace    (vide puis importe)
       node tools/import-to-firestore.js --dry        (simulation)

   Par défaut, une base déjà remplie est ignorée : relancer le
   script ne crée donc pas de doublons. --replace force le
   remplacement complet.

   ⚠ Fonctionne tant que les règles Firestore autorisent l'écriture
     (mode test). Une fois les règles restreintes, il faudra passer
     par le SDK Admin avec un compte de service.
   ══════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const PROJECT = "recap-signalement";
const API_KEY = "AIzaSyBpooypIQJYBiA258VJWNXT3rLk7EptE38";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
             "/databases/(default)/documents";
const DOCS = "projects/" + PROJECT + "/databases/(default)/documents";
const CHUNK = 400;   // Firestore limite un commit à 500 écritures

// ── sources : une base → collection + données ──
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function sources() {
  const sites = readJson("data/sites.json").map((n) => ({ name: n, region: "", id: "" }));
  const olt = readJson("data/olt.json");

  // routeurs : déduits de la base OLT
  const seen = {};
  const routeurs = [];
  olt.forEach((o) => {
    const r = String(o.router || "").trim();
    if (!r) return;
    const k = r.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    routeurs.push({ name: r, region: o.region || "", site: "" });
  });
  routeurs.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  return {
    olt:         { collection: "db_olt",         rows: olt },
    routeurs:    { collection: "db_routeurs",    rows: routeurs },
    sites:       { collection: "db_sites",       rows: sites },
    techniciens: { collection: "db_techniciens", rows: readJson("data/techniciens.json") },
    escalades:   { collection: "db_escalades",   rows: ["EMEF", "TRANS FO/FTTH", "TRANS_FO", "PROJET", "EMEF / TRANS FO/FTTH"] },
    causes:      { collection: "db_causes",      rows: ["Investigation en cours", "Coupure fibre", "Panne énergie", "Panne équipement", "Travaux tiers"] },
    equipements: { collection: "db_equipements", rows: ["Routeur", "Lien IP/MPLS", "Lien DWDM"] },
    natures:     { collection: "db_natures",     rows: ["Indisponibilité", "Fluctuation"] }
  };
}

// ── HTTP ──
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method,
      headers: data
        ? { "Content-Type": "application/json", "Content-Length": data.length }
        : {}
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (e) { parsed = { raw: raw }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error("HTTP " + res.statusCode + " — " +
          (parsed && parsed.error ? parsed.error.message : raw.slice(0, 200))));
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── conversion JS → types Firestore ──
function toFields(value) {
  const obj = (typeof value === "string" || typeof value === "number")
    ? { value: value }
    : value;
  const fields = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: v == null ? "" : String(v) };
  });
  return fields;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function autoId() {
  let s = "";
  for (let i = 0; i < 20; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// ── opérations ──
async function listIds(collection) {
  const ids = [];
  let token = "";
  do {
    const url = BASE + "/" + collection + "?pageSize=300&key=" + API_KEY +
                (token ? "&pageToken=" + encodeURIComponent(token) : "");
    const res = await request("GET", url);
    (res.documents || []).forEach((d) => ids.push(d.name.split("/").pop()));
    token = res.nextPageToken || "";
  } while (token);
  return ids;
}

async function commit(writes) {
  for (let i = 0; i < writes.length; i += CHUNK) {
    await request("POST", BASE + ":commit?key=" + API_KEY, { writes: writes.slice(i, i + CHUNK) });
    process.stdout.write(".");
  }
}

async function wipe(collection) {
  const ids = await listIds(collection);
  if (!ids.length) return 0;
  await commit(ids.map((id) => ({ delete: DOCS + "/" + collection + "/" + id })));
  return ids.length;
}

async function push(collection, rows) {
  await commit(rows.map((row) => ({
    update: {
      name: DOCS + "/" + collection + "/" + autoId(),
      fields: toFields(row)
    }
  })));
  return rows.length;
}

// ── programme ──
async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const dry = args.includes("--dry");
  const wanted = args.filter((a) => !a.startsWith("--"));

  const all = sources();
  const names = wanted.length ? wanted : Object.keys(all);

  console.log("\n  Projet : " + PROJECT + (dry ? "   [SIMULATION]" : ""));
  console.log("  " + "-".repeat(56));

  for (const name of names) {
    const src = all[name];
    if (!src) { console.log("  " + name.padEnd(14) + "base inconnue"); continue; }

    const existing = await listIds(src.collection);
    const label = "  " + name.padEnd(14);

    if (existing.length && !replace) {
      console.log(label + existing.length + " document(s) déjà présents — ignorée (--replace pour remplacer)");
      continue;
    }
    if (dry) {
      console.log(label + "enverrait " + src.rows.length + " entrée(s)" +
                  (existing.length ? " après suppression de " + existing.length : ""));
      continue;
    }

    process.stdout.write(label);
    if (existing.length) {
      const n = await wipe(src.collection);
      process.stdout.write(" (" + n + " supprimé)");
    }
    const n = await push(src.collection, src.rows);
    console.log(" → " + n + " entrée(s)");
  }

  console.log("  " + "-".repeat(56));
  console.log("  Terminé.\n");
}

main().catch((e) => {
  console.error("\n  Échec : " + e.message + "\n");
  process.exit(1);
});
