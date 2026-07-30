/* ══════════════════════════════════════════════════════════════
   build-sites.js — génère la liste des sites depuis l'Excel
   ──────────────────────────────────────────────────────────────
   Source  : NOUVEAU BASE TECH DT.xlsx
             feuille « BASE SITES ID », colonne A « SITES NAMES »
   Sortie  : data/sites.json  (le JSON demandé)
             data/sites.js    (le même contenu exposé en global,
                               car fetch() est bloqué en file://)

   À relancer après chaque mise à jour du fichier Excel :
       node tools/build-sites.js

   Aucune dépendance : le .xlsx est un ZIP de fichiers XML, on le
   lit directement avec zlib.
   ══════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const XLSX = path.join(ROOT, "NOUVEAU BASE TECH DT.xlsx");
const SHEET = "xl/worksheets/sheet1.xml"; // BASE SITES ID
const COLUMN = "A";                        // SITES NAMES

// ── ZIP ──────────────────────────────────────────────────────
function unzip(file) {
  const buf = fs.readFileSync(file);
  const out = {};
  const SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let i = 0;
  while ((i = buf.indexOf(SIG, i)) !== -1) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    if (csize > 0) {
      const raw = buf.slice(start, start + csize);
      try { out[name] = method === 0 ? raw : zlib.inflateRawSync(raw); } catch (e) {}
    }
    i = start + (csize || 1);
  }
  return out;
}

// ── XML ──────────────────────────────────────────────────────
function decodeXml(s) {
  return s.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&");
}

function sharedStrings(files) {
  const xml = files["xl/sharedStrings.xml"];
  if (!xml) return [];
  const src = xml.toString("utf8");
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(src))) {
    let text = "";
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tre.exec(m[1]))) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

function columnValues(files, sheetPath, column) {
  const src = files[sheetPath].toString("utf8");
  const ss = sharedStrings(files);
  const rows = [];
  const re = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1], inner = m[2] || "";
    const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
    if (!ref || ref.replace(/\d+/g, "") !== column) continue;
    const rowNum = parseInt(ref.replace(/\D+/g, ""), 10);
    const type = (attrs.match(/t="([^"]+)"/) || [])[1] || "n";
    let val = "";
    if (type === "inlineStr") {
      const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      val = t ? decodeXml(t[1]) : "";
    } else {
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (v) val = type === "s" ? (ss[+v[1]] || "") : decodeXml(v[1]);
    }
    rows.push({ row: rowNum, value: val });
  }
  return rows.sort((a, b) => a.row - b.row);
}

// ── génération ───────────────────────────────────────────────
function main() {
  if (!fs.existsSync(XLSX)) {
    console.error("Fichier introuvable : " + XLSX);
    process.exit(1);
  }

  const files = unzip(XLSX);
  const raw = columnValues(files, SHEET, COLUMN);

  const seen = new Set();
  const sites = [];
  raw.forEach(({ row, value }) => {
    if (row === 1) return;                       // en-tête
    const v = String(value).replace(/\s+/g, " ").trim();
    if (!v) return;
    const key = v.toUpperCase();
    if (seen.has(key)) return;                   // doublons
    seen.add(key);
    sites.push(v);
  });
  sites.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));

  const dataDir = path.join(ROOT, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, "sites.json"),
    JSON.stringify(sites, null, 2) + "\n", "utf8");

  const header =
    '/* Genere depuis "NOUVEAU BASE TECH DT.xlsx" — feuille "BASE SITES ID", colonne "SITES NAMES".\n' +
    "   Meme contenu que data/sites.json, expose en global car fetch() est bloque\n" +
    "   sur les pages ouvertes en file:// .\n" +
    "   Pour regenerer : node tools/build-sites.js */\n";
  fs.writeFileSync(path.join(dataDir, "sites.js"),
    header + "window.ISOC_SITES = " + JSON.stringify(sites, null, 2) + ";\n", "utf8");

  console.log(sites.length + " sites -> data/sites.json + data/sites.js");
}

main();
