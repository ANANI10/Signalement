/* ══════════════════════════════════════════════════════════════
   Composant <isoc-search-select>
   ──────────────────────────────────────────────────────────────
   Sélecteur avec recherche. Devant le champ, un conteneur
   affiche chaque élément sélectionné sous forme de pastille
   orange arrondie, retirable d'un clic.

   ── UTILISATION ──
   1. Dans <head> :
        <link rel="stylesheet" href="components/search-select.css">
   2. Où l'on veut le sélecteur :
        <isoc-search-select id="routerPick" label="Routeur"
                            placeholder="Sélectionner un routeur"
                            search-placeholder="Rechercher un routeur…"
                            multiple></isoc-search-select>
   3. Avant </body> :
        <script src="components/search-select.js"></script>
   4. Alimenter la liste :
        SearchSelect.get("routerPick").setOptions([
          { value: "lom-081_yoko-ixre-01", label: "lom-081_yoko-ixre-01",
            meta: "LOME · 3 OLT" }
        ]);

   ── ATTRIBUTS ──
   label               titre du conteneur de sélection
   placeholder         texte quand rien n'est sélectionné
   search-placeholder  texte du champ de recherche
   multiple            autorise plusieurs sélections
   empty-text          message quand la recherche ne donne rien

   ── API (sur l'élément) ──
   el.setOptions(list)   liste de {value,label,meta} — ou de chaînes
   el.options            liste courante
   el.value              valeur (ou tableau si multiple)
   el.selected           tableau des options sélectionnées
   el.select(value)      sélectionne par valeur
   el.deselect(value)
   el.clear()
   el.open() / close()

   ── ÉVÉNEMENT ──
   el.addEventListener("searchselect:change", e => e.detail.selected)

   ── API GLOBALE ──
   SearchSelect.get(id) / .instances() / .create({ mount, ... })
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var TAG = "isoc-search-select";
  if (window.customElements && customElements.get(TAG)) return; // déjà chargé

  var SVG = {
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    search:  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close:   '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  // recherche insensible aux accents et à la casse
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function toOption(o) {
    if (o == null) return null;
    if (typeof o === "string" || typeof o === "number") {
      return { value: String(o), label: String(o), meta: "" };
    }
    var value = o.value != null ? String(o.value) : String(o.label || "");
    return { value: value, label: String(o.label != null ? o.label : value), meta: o.meta || "" };
  }

  // ══════════════ ÉLÉMENT ══════════════
  class ISOCSearchSelect extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._options = [];
      this._selected = [];
      this._activeIndex = -1;
      this._build();
    }

    get options() { return this._options.slice(); }
    get selected() { return this._selected.slice(); }
    get value() {
      if (this._multiple) return this._selected.map(function (o) { return o.value; });
      return this._selected.length ? this._selected[0].value : "";
    }
    set value(v) {
      this._selected = [];
      (Array.isArray(v) ? v : [v]).forEach(function (val) {
        if (val === "" || val == null) return;
        var found = this._options.filter(function (o) { return o.value === String(val); })[0];
        if (found && !this._multiple) this._selected = [found];
        else if (found) this._selected.push(found);
      }, this);
      this._sync();
      this._emit();
    }
  }

  var proto = ISOCSearchSelect.prototype;

  proto._build = function () {
    var self = this;
    this._multiple = this.hasAttribute("multiple");
    this._placeholderText = this.getAttribute("placeholder") || "Aucune sélection";
    this._emptyText = this.getAttribute("empty-text") || "Aucun résultat";
    var label = this.getAttribute("label") || "";
    var searchPh = this.getAttribute("search-placeholder") || "Rechercher…";

    var row = document.createElement("div");
    row.className = "ss-row";
    row.innerHTML =
      // sur la même ligne : le champ de choix, puis le conteneur des pastilles
      '<div class="ss-wrap">' +
        '<button class="ss-field" type="button" aria-haspopup="listbox" aria-expanded="false">' +
          '<span class="ss-field-text"></span>' + SVG.chevron +
        "</button>" +
        '<div class="ss-pop">' +
          '<div class="ss-search-wrap">' +
            '<span class="ss-search-icon">' + SVG.search + "</span>" +
            '<input class="ss-search" type="text" autocomplete="off" spellcheck="false">' +
          "</div>" +
          '<div class="ss-list" role="listbox"></div>' +
          '<div class="ss-empty" hidden></div>' +
        "</div>" +
      "</div>" +
      '<div class="ss-selected" role="list"></div>';
    this.appendChild(row);

    this._selectedEl = row.querySelector(".ss-selected");
    this._field = row.querySelector(".ss-field");
    this._fieldText = row.querySelector(".ss-field-text");
    this._pop = row.querySelector(".ss-pop");
    this._search = row.querySelector(".ss-search");
    this._list = row.querySelector(".ss-list");
    this._emptyEl = row.querySelector(".ss-empty");

    this._fieldText.textContent = label ? "Choisir un " + label.toLowerCase() : "Choisir…";
    this._field.setAttribute("aria-label", label ? "Choisir un " + label.toLowerCase() : "Choisir");
    this._search.placeholder = searchPh;
    this._emptyEl.textContent = this._emptyText;
    this._selectedEl.setAttribute("aria-label", label || "Sélection");

    this._field.addEventListener("click", function () { self.toggle(); });
    this._search.addEventListener("input", function () { self._activeIndex = -1; self._renderList(); });
    this._search.addEventListener("keydown", function (e) { self._onKey(e); });
    this._pop.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); self.close(); self._field.focus(); } });

    this._onDocClick = function (e) { if (!self.contains(e.target)) self.close(); };

    this._sync();
  };

  // ── options ──
  proto.setOptions = function (list) {
    var self = this;
    this._options = (list || []).map(toOption).filter(Boolean);
    // conserve les sélections encore valides
    this._selected = this._selected
      .map(function (sel) {
        return self._options.filter(function (o) { return o.value === sel.value; })[0];
      })
      .filter(Boolean);
    this._sync();
    if (this._pop.classList.contains("show")) this._renderList();
    return this;
  };

  // ── sélection ──
  proto.select = function (value) {
    var opt = this._options.filter(function (o) { return o.value === String(value); })[0];
    if (!opt) return this;
    if (this._multiple) {
      if (!this._selected.some(function (o) { return o.value === opt.value; })) this._selected.push(opt);
    } else {
      this._selected = [opt];
    }
    this._sync();
    this._emit();
    return this;
  };
  proto.deselect = function (value) {
    var before = this._selected.length;
    this._selected = this._selected.filter(function (o) { return o.value !== String(value); });
    if (this._selected.length !== before) { this._sync(); this._emit(); }
    return this;
  };
  proto.clear = function () {
    if (!this._selected.length) return this;
    this._selected = [];
    this._sync();
    this._emit();
    return this;
  };

  // Libellé des pastilles : fn(option) → texte affiché
  proto.setChipFormatter = function (fn) {
    this._chipFormat = typeof fn === "function" ? fn : null;
    this._sync();
    return this;
  };
  // Redessine les pastilles (après modification d'une donnée externe)
  proto.refresh = function () { this._sync(); return this; };

  // ── ouverture / fermeture ──
  proto.open = function () {
    if (this._pop.classList.contains("show")) return;
    this._search.value = "";
    this._activeIndex = -1;
    this._renderList();
    this._pop.classList.add("show");
    this._field.classList.add("is-open");
    this._field.setAttribute("aria-expanded", "true");
    document.addEventListener("click", this._onDocClick, true);
    var rect = this._pop.getBoundingClientRect();
    this._pop.classList.toggle("to-right", rect.right > window.innerWidth - 8);
    this._search.focus();
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

  // ── rendu ──
  proto._sync = function () {
    var self = this;
    this._selectedEl.textContent = "";

    if (!this._selected.length) {
      var ph = document.createElement("span");
      ph.className = "ss-placeholder";
      ph.textContent = this._placeholderText;
      this._selectedEl.appendChild(ph);
      return;
    }

    this._selected.forEach(function (opt) {
      var chip = document.createElement("span");
      chip.className = "ss-chip";
      chip.setAttribute("role", "listitem");
      chip.title = opt.meta ? opt.label + " — " + opt.meta : opt.label;

      var lab = document.createElement("span");
      lab.className = "ss-chip-label";
      lab.textContent = self._chipFormat ? self._chipFormat(opt) : opt.label;

      // clic sur la pastille (hors croix) : signalé à la page hôte
      chip.addEventListener("click", function (e) {
        if (e.target.closest(".ss-chip-del")) return;
        self.dispatchEvent(new CustomEvent("searchselect:chipclick", {
          bubbles: true,
          detail: { option: opt, chip: chip }
        }));
      });

      var del = document.createElement("button");
      del.className = "ss-chip-del";
      del.type = "button";
      del.setAttribute("aria-label", "Retirer " + opt.label);
      del.innerHTML = SVG.close;
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        self.deselect(opt.value);
      });

      chip.appendChild(lab);
      chip.appendChild(del);
      self._selectedEl.appendChild(chip);
    });
  };

  proto._filtered = function () {
    var q = norm(this._search.value.trim());
    if (!q) return this._options.slice();
    return this._options.filter(function (o) {
      return norm(o.label).indexOf(q) !== -1 || norm(o.meta).indexOf(q) !== -1;
    });
  };

  proto._renderList = function () {
    var self = this;
    var list = this._filtered();
    this._list.textContent = "";
    this._visible = list;

    if (this._selected.length) {
      var clear = document.createElement("div");
      clear.className = "ss-opt clear";
      clear.textContent = "— Tout désélectionner —";
      clear.addEventListener("mousedown", function (e) { e.preventDefault(); self.clear(); });
      this._list.appendChild(clear);
    }

    this._emptyEl.hidden = list.length > 0;

    list.forEach(function (opt, i) {
      var item = document.createElement("div");
      item.className = "ss-opt";
      item.setAttribute("role", "option");
      if (self._selected.some(function (o) { return o.value === opt.value; })) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      }
      if (i === self._activeIndex) item.classList.add("is-active");

      var lab = document.createElement("span");
      lab.className = "ss-opt-label";
      lab.textContent = opt.label;
      var meta = document.createElement("span");
      meta.className = "ss-opt-meta";
      meta.textContent = opt.meta || "";

      item.appendChild(lab);
      item.appendChild(meta);
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        self._choose(opt);
      });
      self._list.appendChild(item);
    });
  };

  proto._choose = function (opt) {
    var already = this._selected.some(function (o) { return o.value === opt.value; });
    if (already && this._multiple) this.deselect(opt.value);
    else this.select(opt.value);
    if (this._multiple) {
      this._renderList();
      this._search.focus();
    } else {
      this.close();
      this._field.focus();
    }
  };

  // ── clavier ──
  proto._onKey = function (e) {
    var list = this._visible || [];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!list.length) return;
      var dir = e.key === "ArrowDown" ? 1 : -1;
      this._activeIndex = (this._activeIndex + dir + list.length) % list.length;
      this._renderList();
      var active = this._list.querySelector(".is-active");
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this._activeIndex >= 0 && list[this._activeIndex]) this._choose(list[this._activeIndex]);
      else if (list.length === 1) this._choose(list[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      this._field.focus();
    }
  };

  proto._emit = function () {
    this.dispatchEvent(new CustomEvent("searchselect:change", {
      bubbles: true,
      detail: { value: this.value, selected: this.selected }
    }));
  };

  // ══════════════ ENREGISTREMENT + API GLOBALE ══════════════
  customElements.define(TAG, ISOCSearchSelect);

  window.SearchSelect = {
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
      if (opts.label) el.setAttribute("label", opts.label);
      if (opts.placeholder) el.setAttribute("placeholder", opts.placeholder);
      if (opts.searchPlaceholder) el.setAttribute("search-placeholder", opts.searchPlaceholder);
      if (opts.multiple) el.setAttribute("multiple", "");
      (opts.mount || document.body).appendChild(el);
      if (opts.options) el.setOptions(opts.options);
      return el;
    }
  };
})();
