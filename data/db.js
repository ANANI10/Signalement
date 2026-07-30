/* ══════════════════════════════════════════════════════════════
   ISOC_DB — accès unifié aux bases de données du projet
   ──────────────────────────────────────────────────────────────
   Toutes les bases sont conservées dans le navigateur
   (localStorage). Ce fichier est le seul endroit qui connaît les
   clés de stockage et les valeurs par défaut.

   ── UTILISATION ──
     <script src="data/sites.js"></script>   (graine des sites)
     <script src="data/db.js"></script>

     ISOC_DB.get("escalades")        → ["EMEF", "TRANS_FO", …]
     ISOC_DB.set("escalades", [...])
     ISOC_DB.reset("escalades")
     ISOC_DB.names()                 → identifiants des bases
     ISOC_DB.schema("olt")           → description des colonnes

   Les bases « simples » (escalades, causes, équipements, natures)
   sont des listes de chaînes. Les bases OLT, routeurs et sites
   sont des listes d'objets décrits par leur schéma.
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  if (window.ISOC_DB) return;

  var SCHEMAS = {
    olt: {
      label: "OLT",
      hint: "Nom, région, routeur, port et nombre de clients. Alimente le calcul des impacts et la fiche diagnostic.",
      key: "isoc_olt_db",
      simple: false,
      cols: [
        { k: "name",    t: "text",   ph: "Nom de l'OLT", grow: true },
        { k: "region",  t: "text",   ph: "Région",  w: "110px" },
        { k: "router",  t: "text",   ph: "Routeur", w: "170px" },
        { k: "port",    t: "text",   ph: "Port",    w: "90px" },
        { k: "clients", t: "number", ph: "Clients", w: "90px" }
      ]
    },
    routeurs: {
      label: "Routeurs",
      hint: "Routeurs IP/MPLS proposés dans le sélecteur. Initialisés à partir des routeurs déclarés dans la base OLT.",
      key: "isoc_db_routeurs",
      simple: false,
      cols: [
        { k: "name",   t: "text", ph: "Nom du routeur", grow: true },
        { k: "region", t: "text", ph: "Région", w: "140px" },
        { k: "site",   t: "text", ph: "Site",   w: "170px" }
      ]
    },
    sites: {
      label: "Sites",
      hint: "Sites BTS proposés dans le sélecteur. Initialisés depuis le fichier Excel (tools/build-sites.js).",
      key: "isoc_db_sites",
      simple: false,
      cols: [
        { k: "name",   t: "text", ph: "Nom du site", grow: true },
        { k: "region", t: "text", ph: "Région", w: "140px" },
        { k: "id",     t: "text", ph: "Site ID", w: "140px", noKey: true }
      ]
    },
    techniciens: {
      label: "Techniciens",
      hint: "Annuaire utilisé par la recherche « Technicien » et la ligne TECH INF des signalements. La colonne Identifiant est technique : laissez-la vide pour une nouvelle entrée.",
      key: "isoc_tech_list",
      simple: false,
      idFromDoc: true,          // un identifiant stable est requis par les générateurs
      cols: [
        { k: "name", t: "text", ph: "Nom du technicien", grow: true },
        { k: "num",  t: "text", ph: "Numéro", w: "140px" },
        { k: "id",   t: "text", ph: "Identifiant", w: "150px" }
      ]
    },
    escalades: {
      label: "Escalades",
      hint: "Valeurs proposées dans le menu Escalade, du signalement comme des mises à jour.",
      key: "isoc_db_escalades",
      simple: true,
      seed: ["EMEF", "TRANS FO/FTTH", "TRANS_FO", "PROJET", "EMEF / TRANS FO/FTTH"]
    },
    causes: {
      label: "Causes",
      hint: "Valeurs proposées dans le menu Cause.",
      key: "isoc_db_causes",
      simple: true,
      seed: ["Investigation en cours", "Coupure fibre", "Panne énergie", "Panne équipement", "Travaux tiers"]
    },
    equipements: {
      label: "Équipements",
      hint: "Types d'équipement. « Lien … » déclenche la formulation « routeur A vers routeur B » dans le signalement.",
      key: "isoc_db_equipements",
      simple: true,
      seed: ["Routeur", "Lien IP/MPLS", "Lien DWDM"]
    },
    natures: {
      label: "Natures d'incident",
      hint: "Premier mot de la phrase du signalement : « Indisponibilité du routeur… », « Fluctuation du lien… ».",
      key: "isoc_db_natures",
      simple: true,
      seed: ["Indisponibilité", "Fluctuation"]
    }
  };

  var ORDER = ["olt", "routeurs", "sites", "techniciens",
               "escalades", "causes", "equipements", "natures"];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  // ── graines calculées ──
  function seedRouteurs() {
    var olts = read(SCHEMAS.olt.key, []);
    var seen = {}, out = [];
    olts.forEach(function (o) {
      var r = String(o.router || "").trim();
      if (!r) return;
      var k = r.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push({ name: r, region: o.region || "", site: "" });
    });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name, "fr", { sensitivity: "base" }); });
  }

  function seedSites() {
    var list = Array.isArray(window.ISOC_SITES) ? window.ISOC_SITES : [];
    return list.map(function (n) { return { name: n, region: "", id: "" }; });
  }

  function seedOf(name) {
    var s = SCHEMAS[name];
    if (!s) return [];
    if (s.simple) return s.seed.slice();
    if (name === "routeurs") return seedRouteurs();
    if (name === "sites") return seedSites();
    return [];   // OLT : la graine vit dans les pages générateur
  }

  // ── API ──
  var API = {
    names: function () { return ORDER.slice(); },
    schema: function (name) { return SCHEMAS[name] || null; },

    get: function (name) {
      var s = SCHEMAS[name];
      if (!s) return [];
      var stored = read(s.key, null);
      if (stored && stored.length) return stored;
      var seed = seedOf(name);
      if (seed.length) write(s.key, seed);
      return seed;
    },

    set: function (name, rows) {
      var s = SCHEMAS[name];
      if (!s) return false;
      return write(s.key, rows || []);
    },

    reset: function (name) {
      var s = SCHEMAS[name];
      if (!s) return [];
      var seed = seedOf(name);
      write(s.key, seed);
      return seed;
    },

    // Valeurs prêtes pour les composants de sélection
    values: function (name) {
      var s = SCHEMAS[name];
      if (!s) return [];
      var rows = API.get(name);
      return s.simple ? rows.slice()
                      : rows.map(function (r) { return r.name; }).filter(Boolean);
    },

    // Options {value,label,meta} pour <isoc-search-select>
    options: function (name) {
      var s = SCHEMAS[name];
      if (!s) return [];
      var rows = API.get(name);
      if (s.simple) {
        return rows.map(function (v) { return { value: v, label: v, meta: "" }; });
      }
      return rows.filter(function (r) { return r && r.name; }).map(function (r) {
        var meta = [];
        if (r.region) meta.push(r.region);
        if (name === "olt" && r.clients) meta.push(r.clients + " clients");
        if (name === "routeurs" && r.site) meta.push(r.site);
        if (name === "sites" && r.id) meta.push(r.id);
        return { value: r.name, label: r.name, meta: meta.join(" · ") };
      });
    }
  };

  window.ISOC_DB = API;
})();
