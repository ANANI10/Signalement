/* ══════════════════════════════════════════════════════════════
   Composant <isoc-date-picker>
   ──────────────────────────────────────────────────────────────
   Sélecteur de date et d'heure entièrement personnalisé :
   calendrier maison, en français, aucun widget natif du
   navigateur — même rendu sur Chrome, Edge et Firefox.

   ── UTILISATION ──
   1. Dans <head> :
        <link rel="stylesheet" href="components/date-picker.css">
   2. Où l'on veut le champ :
        <isoc-date-picker id="dateDebut"
                          placeholder="Début — auto"></isoc-date-picker>
   3. Avant </body> :
        <script src="components/date-picker.js"></script>

   ── ATTRIBUTS ──
   placeholder   texte quand aucune date        (défaut : "Choisir une date")
   value         date initiale ISO ou "now"     (optionnel)
   date-only     masque la sélection de l'heure
   min / max     bornes ISO (AAAA-MM-JJ)        (optionnel)

   ── API (sur l'élément) ──
   el.value              Date | null   (lecture / écriture)
   el.valueISO           chaîne ISO ou ""
   el.toReportString()   "06/07/2026@00h46"   ← format du signalement
   el.toDiagString()     "06-07-2026 @00H46"  ← format fiche diagnostic
   el.setNow()           met la date/heure courante
   el.clear()            vide le champ
   el.open() / close()

   ── ÉVÉNEMENT ──
   el.addEventListener("datepicker:change", e => e.detail.value)

   ── API GLOBALE ──
   DatePicker.get("dateDebut")           récupère une instance
   DatePicker.instances()                toutes les instances
   DatePicker.create({ mount, ... })      création par script
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var TAG = "isoc-date-picker";
  if (window.customElements && customElements.get(TAG)) return; // déjà chargé

  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

  var SVG = {
    cal:   '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    prev:  '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    next:  '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  function pad(n) { return String(n).padStart(2, "0"); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function parseAttr(v) {
    if (!v) return null;
    if (v === "now") return new Date();
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // lundi = 0 … dimanche = 6
  function weekIndex(date) { return (date.getDay() + 6) % 7; }

  // ══════════════ ÉLÉMENT ══════════════
  class ISOCDatePicker extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._value = parseAttr(this.getAttribute("value"));
      this._cursor = startOfDay(this._value || new Date());
      this._build();
    }

    get value() { return this._value ? new Date(this._value) : null; }
    set value(v) {
      var d = (v instanceof Date) ? v : parseAttr(v);
      this._value = d;
      if (d) this._cursor = startOfDay(d);
      this._sync();
      this._emit();
    }
    get valueISO() { return this._value ? this._value.toISOString() : ""; }
  }

  var proto = ISOCDatePicker.prototype;

  proto._build = function () {
    var self = this;
    var placeholder = this.getAttribute("placeholder") || "Choisir une date";
    this._dateOnly = this.hasAttribute("date-only");
    this._min = parseAttr(this.getAttribute("min"));
    this._max = parseAttr(this.getAttribute("max"));

    // ── champ ──
    var field = document.createElement("button");
    field.className = "dp-field";
    field.type = "button";
    field.setAttribute("aria-haspopup", "dialog");
    field.setAttribute("aria-expanded", "false");
    field.innerHTML =
      SVG.cal +
      '<span class="dp-value is-empty"></span>' +
      '<span class="dp-reset" role="button" tabindex="0" title="Effacer la date">' + SVG.close + "</span>";
    this.appendChild(field);

    this._field = field;
    this._valueEl = field.querySelector(".dp-value");
    this._placeholder = placeholder;

    field.addEventListener("click", function (e) {
      if (e.target.closest(".dp-reset")) { e.stopPropagation(); self.clear(); return; }
      self.toggle();
    });
    field.querySelector(".dp-reset").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); self.clear(); }
    });

    // ── panneau ──
    var pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Sélection de la date");
    pop.innerHTML =
      '<div class="dp-hd">' +
        '<button class="dp-nav dp-prev" type="button" aria-label="Mois précédent">' + SVG.prev + "</button>" +
        '<span class="dp-month"></span>' +
        '<button class="dp-nav dp-next" type="button" aria-label="Mois suivant">' + SVG.next + "</button>" +
      "</div>" +
      '<div class="dp-week">' + JOURS.map(function (j) { return "<span>" + j + "</span>"; }).join("") + "</div>" +
      '<div class="dp-grid" role="grid"></div>' +
      '<div class="dp-time">' +
        '<span class="dp-time-label">Heure</span>' +
        '<input class="dp-hh" type="number" min="0" max="23" inputmode="numeric" aria-label="Heures">' +
        '<span class="dp-time-sep">:</span>' +
        '<input class="dp-mm" type="number" min="0" max="59" inputmode="numeric" aria-label="Minutes">' +
      "</div>" +
      '<div class="dp-ft">' +
        '<button class="dp-btn dp-now" type="button">Maintenant</button>' +
        '<button class="dp-btn dp-clear" type="button">Effacer</button>' +
        '<button class="dp-btn primary dp-ok" type="button">OK</button>' +
      "</div>";
    this.appendChild(pop);

    this._pop = pop;
    this._grid = pop.querySelector(".dp-grid");
    this._monthEl = pop.querySelector(".dp-month");
    this._hh = pop.querySelector(".dp-hh");
    this._mm = pop.querySelector(".dp-mm");
    if (this._dateOnly) pop.classList.add("is-date-only");

    pop.querySelector(".dp-prev").addEventListener("click", function () { self._shiftMonth(-1); });
    pop.querySelector(".dp-next").addEventListener("click", function () { self._shiftMonth(1); });
    pop.querySelector(".dp-now").addEventListener("click", function () { self.setNow(); self.close(); });
    pop.querySelector(".dp-clear").addEventListener("click", function () { self.clear(); self.close(); });
    pop.querySelector(".dp-ok").addEventListener("click", function () { self.close(); self._field.focus(); });

    [this._hh, this._mm].forEach(function (input) {
      input.addEventListener("input", function () { self._applyTime(); });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); self.close(); self._field.focus(); }
      });
    });

    // navigation clavier dans la grille
    pop.addEventListener("keydown", function (e) { self._onKey(e); });

    // fermeture au clic extérieur
    this._onDocClick = function (e) { if (!self.contains(e.target)) self.close(); };

    this._sync();
  };

  // ── ouverture / fermeture ──
  proto.open = function () {
    if (this._pop.classList.contains("show")) return;
    this._cursor = startOfDay(this._value || new Date());
    this._renderCalendar();
    this._pop.classList.add("show");
    this._field.classList.add("is-open");
    this._field.setAttribute("aria-expanded", "true");
    document.addEventListener("click", this._onDocClick, true);
    // bascule à droite si le panneau déborde de la fenêtre
    var rect = this._pop.getBoundingClientRect();
    this._pop.classList.toggle("to-right", rect.right > window.innerWidth - 8);
  };
  proto.close = function () {
    if (!this._pop.classList.contains("show")) return;
    this._pop.classList.remove("show");
    this._field.classList.remove("is-open");
    this._field.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", this._onDocClick, true);
  };
  proto.toggle = function () {
    if (this._pop.classList.contains("show")) this.close(); else this.open();
  };

  // ── valeurs ──
  proto.setNow = function () {
    var n = new Date();
    n.setSeconds(0, 0);
    this.value = n;
  };
  proto.clear = function () {
    this._value = null;
    this._sync();
    this._emit();
  };
  proto.toReportString = function () {
    if (!this._value) return "";
    var d = this._value;
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
           "@" + pad(d.getHours()) + "h" + pad(d.getMinutes());
  };
  proto.toDiagString = function () {
    if (!this._value) return "";
    var d = this._value;
    return pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear() +
           " @" + pad(d.getHours()) + "H" + pad(d.getMinutes());
  };

  // ── rendu ──
  proto._sync = function () {
    var has = !!this._value;
    this._field.classList.toggle("has-value", has);
    this._valueEl.classList.toggle("is-empty", !has);
    this._valueEl.textContent = has
      ? (this._dateOnly
          ? pad(this._value.getDate()) + "/" + pad(this._value.getMonth() + 1) + "/" + this._value.getFullYear()
          : this.toReportString())
      : this._placeholder;
    if (has) {
      this._hh.value = pad(this._value.getHours());
      this._mm.value = pad(this._value.getMinutes());
    } else {
      this._hh.value = "";
      this._mm.value = "";
    }
    if (this._pop.classList.contains("show")) this._renderCalendar();
  };

  proto._shiftMonth = function (delta) {
    this._cursor = new Date(this._cursor.getFullYear(), this._cursor.getMonth() + delta, 1);
    this._renderCalendar();
  };

  proto._outOfRange = function (d) {
    if (this._min && d < startOfDay(this._min)) return true;
    if (this._max && d > startOfDay(this._max)) return true;
    return false;
  };

  proto._renderCalendar = function () {
    var self = this;
    var cur = this._cursor;
    var year = cur.getFullYear(), month = cur.getMonth();
    var today = startOfDay(new Date());

    this._monthEl.textContent = MOIS[month] + " " + year;

    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - weekIndex(first));

    this._grid.textContent = "";
    for (var i = 0; i < 42; i++) {
      var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-day";
      btn.textContent = day.getDate();
      btn.dataset.ts = day.getTime();
      if (day.getMonth() !== month) btn.classList.add("is-out");
      if (sameDay(day, today)) btn.classList.add("is-today");
      if (this._value && sameDay(day, this._value)) btn.classList.add("is-selected");
      if (this._outOfRange(day)) btn.disabled = true;
      btn.setAttribute("aria-label",
        day.getDate() + " " + MOIS[day.getMonth()] + " " + day.getFullYear());
      btn.addEventListener("click", function () {
        self._pick(new Date(Number(this.dataset.ts)));
      });
      this._grid.appendChild(btn);
    }
  };

  proto._pick = function (day) {
    var h = this._value ? this._value.getHours() : 0;
    var m = this._value ? this._value.getMinutes() : 0;
    if (!this._value && !this._dateOnly) {
      var now = new Date();
      h = now.getHours(); m = now.getMinutes();
    }
    if (this._dateOnly) { h = 0; m = 0; }
    this._value = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
    this._cursor = startOfDay(this._value);
    this._sync();
    this._emit();
  };

  proto._applyTime = function () {
    if (!this._value) return;
    var h = parseInt(this._hh.value, 10);
    var m = parseInt(this._mm.value, 10);
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    h = Math.min(23, Math.max(0, h));
    m = Math.min(59, Math.max(0, m));
    this._value.setHours(h, m, 0, 0);
    this._field.classList.add("has-value");
    this._valueEl.classList.remove("is-empty");
    this._valueEl.textContent = this.toReportString();
    this._emit();
  };

  // ── clavier ──
  proto._onKey = function (e) {
    if (e.key === "Escape") { e.preventDefault(); this.close(); this._field.focus(); return; }
    var moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in moves)) return;
    if (e.target.classList && e.target.classList.contains("dp-day")) {
      e.preventDefault();
      var ts = Number(e.target.dataset.ts);
      var next = new Date(ts + 0);
      next.setDate(next.getDate() + moves[e.key]);
      if (next.getMonth() !== this._cursor.getMonth() ||
          next.getFullYear() !== this._cursor.getFullYear()) {
        this._cursor = new Date(next.getFullYear(), next.getMonth(), 1);
        this._renderCalendar();
      }
      var target = this._grid.querySelector('[data-ts="' + next.getTime() + '"]');
      if (target) target.focus();
    }
  };

  proto._emit = function () {
    this.dispatchEvent(new CustomEvent("datepicker:change", {
      bubbles: true,
      detail: {
        value: this.value,
        iso: this.valueISO,
        report: this.toReportString(),
        diag: this.toDiagString()
      }
    }));
  };

  // ══════════════ ENREGISTREMENT + API GLOBALE ══════════════
  customElements.define(TAG, ISOCDatePicker);

  window.DatePicker = {
    tag: TAG,
    get: function (id) {
      var el = document.getElementById(id);
      return el && el.tagName.toLowerCase() === TAG ? el : null;
    },
    instances: function () {
      return Array.prototype.slice.call(document.querySelectorAll(TAG));
    },
    create: function (options) {
      var opts = options || {};
      var el = document.createElement(TAG);
      if (opts.id) el.id = opts.id;
      if (opts.placeholder) el.setAttribute("placeholder", opts.placeholder);
      if (opts.value) el.setAttribute("value", opts.value);
      if (opts.dateOnly) el.setAttribute("date-only", "");
      if (opts.min) el.setAttribute("min", opts.min);
      if (opts.max) el.setAttribute("max", opts.max);
      (opts.mount || document.body).appendChild(el);
      return el;
    }
  };
})();
