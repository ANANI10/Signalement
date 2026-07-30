/* ══════════════════════════════════════════════════════════════
   SheetReader — lecture de fichiers CSV et Excel (.xlsx)
   ──────────────────────────────────────────────────────────────
   Aucune bibliothèque : le .xlsx est un ZIP de fichiers XML,
   décompressé par DecompressionStream (Chrome / Edge / Firefox
   récents).

   ── UTILISATION ──
       <script src="components/sheet-reader.js"></script>

       const classeur = await SheetReader.read(file);
       // → { type:"xlsx"|"csv",
       //     sheets:[ { name:"Feuil1", rows:[["A1","B1"], …] } ] }

   Les lignes sont des tableaux de chaînes ; la 1re ligne contient
   en général les en-têtes de colonnes.
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  if (window.SheetReader) return;

  // ══════════════ CSV ══════════════
  function detectDelimiter(line) {
    var best = ",", max = 0;
    [",", ";", "\t", "|"].forEach(function (d) {
      var n = line.split(d).length - 1;
      if (n > max) { max = n; best = d; }
    });
    return best;
  }

  // découpe une ligne en respectant les guillemets
  function splitLine(line, delim) {
    var out = [], cur = "", quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = false;
        } else cur += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delim) {
        out.push(cur); cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function parseCsv(text) {
    // BOM éventuel
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return [];
    var delim = detectDelimiter(lines[0]);
    return lines.map(function (l) { return splitLine(l, delim); });
  }

  // ══════════════ ZIP ══════════════
  async function inflateRaw(bytes) {
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function unzip(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var files = {};
    var i = 0;

    function findSig(from) {
      for (var p = from; p < bytes.length - 3; p++) {
        if (bytes[p] === 0x50 && bytes[p + 1] === 0x4b &&
            bytes[p + 2] === 0x03 && bytes[p + 3] === 0x04) return p;
      }
      return -1;
    }

    while ((i = findSig(i)) !== -1) {
      var method = view.getUint16(i + 8, true);
      var csize  = view.getUint32(i + 18, true);
      var nlen   = view.getUint16(i + 26, true);
      var elen   = view.getUint16(i + 28, true);
      var name   = new TextDecoder("utf-8").decode(bytes.subarray(i + 30, i + 30 + nlen));
      var start  = i + 30 + nlen + elen;
      if (csize > 0) {
        var raw = bytes.subarray(start, start + csize);
        try {
          files[name] = method === 0 ? raw : await inflateRaw(raw);
        } catch (e) { /* entrée illisible : ignorée */ }
      }
      i = start + (csize || 1);
    }
    return files;
  }

  // ══════════════ XLSX ══════════════
  function decodeXml(s) {
    return s.replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&");
  }

  function text(files, name) {
    return files[name] ? new TextDecoder("utf-8").decode(files[name]) : "";
  }

  function sharedStrings(files) {
    var src = text(files, "xl/sharedStrings.xml");
    if (!src) return [];
    var out = [], re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(src))) {
      var s = "", tre = /<t[^>]*>([\s\S]*?)<\/t>/g, t;
      while ((t = tre.exec(m[1]))) s += t[1];
      out.push(decodeXml(s));
    }
    return out;
  }

  function colIndex(ref) {
    var letters = ref.replace(/\d+/g, ""), n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function sheetRows(files, path, ss) {
    var src = text(files, path);
    if (!src) return [];
    var rows = [];
    var re = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(src))) {
      var attrs = m[1], inner = m[2] || "";
      var ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      var type = (attrs.match(/t="([^"]+)"/) || [])[1] || "n";
      var val = "";
      if (type === "inlineStr") {
        var t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = t ? decodeXml(t[1]) : "";
      } else {
        var v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) val = type === "s" ? (ss[+v[1]] || "") : decodeXml(v[1]);
      }
      var r = parseInt(ref.replace(/\D+/g, ""), 10) - 1;
      var c = colIndex(ref);
      if (!rows[r]) rows[r] = [];
      rows[r][c] = val;
    }
    // lignes pleines, cellules vides normalisées
    return rows.filter(Boolean).map(function (row) {
      var out = [];
      for (var i = 0; i < row.length; i++) out.push(row[i] == null ? "" : String(row[i]));
      return out;
    });
  }

  async function parseXlsx(buffer) {
    var files = await unzip(buffer);
    var ss = sharedStrings(files);

    // noms des feuilles, dans l'ordre du classeur
    var wb = text(files, "xl/workbook.xml");
    var names = [];
    var re = /<sheet[^>]*name="([^"]+)"/g, m;
    while ((m = re.exec(wb))) names.push(decodeXml(m[1]));

    var sheets = [];
    Object.keys(files)
      .filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort(function (a, b) {
        return parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10);
      })
      .forEach(function (path, i) {
        sheets.push({ name: names[i] || ("Feuille " + (i + 1)), rows: sheetRows(files, path, ss) });
      });
    return sheets;
  }

  // ══════════════ API ══════════════
  window.SheetReader = {
    supported: typeof DecompressionStream !== "undefined",

    async read(file) {
      var name = (file.name || "").toLowerCase();

      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        var txt = await file.text();
        return { type: "csv", sheets: [{ name: file.name, rows: parseCsv(txt) }] };
      }

      if (name.endsWith(".xlsx")) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("Ce navigateur ne sait pas lire les .xlsx — exportez la feuille en CSV.");
        }
        var buf = await file.arrayBuffer();
        return { type: "xlsx", sheets: await parseXlsx(buf) };
      }

      throw new Error("Format non reconnu : utilisez un fichier .csv ou .xlsx");
    }
  };
})();
