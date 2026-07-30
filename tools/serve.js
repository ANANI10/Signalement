/* ══════════════════════════════════════════════════════════════
   serve.js — petit serveur local, sans aucune dépendance
   ──────────────────────────────────────────────────────────────
   Nécessaire depuis le passage à Firebase : les modules ES et
   Firestore sont bloqués quand une page est ouverte en file://
   (double-clic). Servir le dossier règle le problème.

       node tools/serve.js            → http://localhost:8080
       node tools/serve.js 3000       → autre port

   Lancer_iSOC.bat s'en sert automatiquement.
   ══════════════════════════════════════════════════════════════ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.argv[2], 10) || 8080;
const HOME = "accueil.html";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/" + HOME;

  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));

  // on ne sort pas du dossier du projet
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Accès refusé");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>404</h1><p>" + rel + " est introuvable.</p>");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = "http://localhost:" + PORT + "/";
  console.log("");
  console.log("  iSOC — serveur local demarre");
  console.log("  " + url);
  console.log("  (Ctrl+C pour arreter)");
  console.log("");
  exec('start "" "' + url + '"');
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("  Le port " + PORT + " est deja utilise.");
    console.error("  Essayez : node tools/serve.js 8081");
  } else {
    console.error("  Erreur : " + err.message);
  }
  process.exit(1);
});
