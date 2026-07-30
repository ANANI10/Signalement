/* ══════════════════════════════════════════════════════════════
   Composant <isoc-dropdown>
   ──────────────────────────────────────────────────────────────
   Conteneur cliquable qui déroule un menu de choix.

   ── UTILISATION ──
   1. Dans <head> :
        <link rel="stylesheet" href="components/dropdown.css">
   2. Où l'on veut le conteneur :
        <isoc-dropdown id="impactPick" label="Impact"
                       options="Aucun impact|Impact Réseau"></isoc-dropdown>
   3. Avant </body> :
        <script src="components/dropdown.js"></script>

   ── ATTRIBUTS ──
   label        texte fixe affiché devant la valeur
   placeholder  texte quand rien n'est choisi   (défaut : "Choisir…")
   options      choix séparés par « | »          (ou via setOptions)
   value        valeur initiale
   states       "ok|warn" — pastille verte / orange par option,
                dans l'ordre des options (optionnel)

   ── API (sur l'élément) ──
   el.setOptions(list)   liste de chaînes ou de {value,label,state}
   el.value              valeur choisie (lecture / écriture)
   el.selected           option choisie complète
   el.select(value)
   el.clear()
   el.open() / close()

   ── ÉVÉNEMENT ──
   el.addEventListener("dropdown:change", e => e.detail.value)

   ── API GLOBALE ──
   Dropdown.get(id) / .instances() / .create({ mount, ... })
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var TAG = "isoc-dropdown";
  if (window.customElements && customElements.get(TAG)) return; // déjà chargé

  var SVG = {
    caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
  };

  // au-delà de ce nombre d'options, un champ de recherche s'affiche
  var SEARCH_FROM = 8;

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function toOption(o, state) {
    if (o == null) return null;
    if (typeof o === "string" || typeof o === "number") {
      return { value: String(o), label: String(o), state: state || "" };
    }
    var value = o.value != null ? String(o.value) : String(o.label || "");
    return {
      value: value,
      label: String(o.label != null ? o.label : value),
      state: o.state || state || ""
    };
  }

  // ══════════════ ÉLÉMENT ══════════════
  class ISOCDropdown extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._options = [];
      this._selected = null;
      this._activeIndex = -1;
      this._build();
    }

    get options() { return this._options.slice(); }
    get selected() { return this._selected ? Object.assign({}, this._selected) : null; }
    get value() { return this._selected ? this._selected.value : ""; }
    set value(v) { this.select(v); }
  }

  var proto = ISOCDropdown.prototype;

  proto._build = function () {
    var self = this;
    var label = this.getAttribute("label") || "";
    this._placeholder = this.getAttribute("placeholder") || "Choisir…";

    var field = document.createElement("button");
    field.className = "dd-field";
    field.type = "button";
    field.setAttribute("aria-haspopup", "listbox");
    field.setAttribute("aria-expanded", "false");
    field.innerHTML =
      '<span class="dd-dot" aria-hidden="true"></span>' +
      (label ? '<span class="dd-label"></span>' : "") +
      '<span class="dd-value is-empty"></span>' +
      '<span class="dd-caret" aria-hidden="true">' + SVG.caret + "</span>";
    this.appendChild(field);

    var menu = document.createElement("div");
    menu.className = "dd-menu";
    menu.setAttribute("role", "listbox");
    this.appendChild(menu);

    this._field = field;
    this._menu = menu;
    this._valueEl = field.querySelector(".dd-value");
    if (label) {
      field.querySelector(".dd-label").textContent = label;
      field.setAttribute("aria-label", label);
      menu.setAttribute("aria-label", label);
    }

    field.addEventListener("click", function () { self.toggle(); });
    field.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); self.open(); }
    });
    menu.addEventListener("keydown", function (e) { self._onKey(e); });
    this._onDocClick = function (e) { if (!self.contains(e.target)) self.close(); };

    // options depuis l'attribut
    var attr = this.getAttribute("options");
    if (attr) {
      var states = (this.getAttribute("states") || "").split("|");
      this.setOptions(attr.split("|").map(function (s, i) {
        return toOption(s.trim(), (states[i] || "").trim());
      }));
    }
    var initial = this.getAttribute("value");
    if (initial) this.select(initial);
    else this._sync();
  };

  // ── options ──
  proto.setOptions = function (list) {
    this._options = (list || []).map(function (o) { return toOption(o); }).filter(Boolean);
    if (this._selected) {
      var still = this._options.filter(function (o) { return o.value === this._selected.value; }, this)[0];
      this._selected = still || null;
    }
    this._sync();
    if (this._menu.classList.contains("show")) this._renderMenu();
    return this;
  };

  // ── sélection ──
  proto.select = function (value) {
    var opt = this._options.filter(function (o) { return o.value === String(value); })[0];
    if (!opt) return this;
    this._selected = opt;
    this._sync();
    this._emit();
    return this;
  };
  proto.clear = function () {
    if (!this._selected) return this;
    this._selected = null;
    this._sync();
    this._emit();
    return this;
  };

  // ── ouverture / fermeture ──
  proto.open = function () {
    if (this._menu.classList.contains("show")) return;
    this._filter = "";
    this._activeIndex = this._selected
      ? this._options.map(function (o) { return o.value; }).indexOf(this._selected.value)
      : -1;
    this._buildMenu();
    this._renderMenu();
    this._menu.classList.add("show");
    this._field.classList.add("is-open");
    this._field.setAttribute("aria-expanded", "true");
    document.addEventListener("click", this._onDocClick, true);
    var rect = this._menu.getBoundingClientRect();
    this._menu.classList.toggle("to-right", rect.right > window.innerWidth - 8);
  };
  proto.close = function () {
    if (!this._menu.classList.contains("show")) return;
    this._menu.classList.remove("show");
    this._field.classList.remove("is-open");
    this._field.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", this._onDocClick, true);
  };
  proto.toggle = function () {
    if (this._menu.classList.contains("show")) this.close(); else this.open();
  };

  // ── rendu ──
  proto._sync = function () {
    var has = !!this._selected;
    this._valueEl.textContent = has ? this._selected.label : this._placeholder;
    this._valueEl.classList.toggle("is-empty", !has);
    this._field.classList.remove("state-ok", "state-warn");
    if (has && this._selected.state === "ok") this._field.classList.add("state-ok");
    if (has && this._selected.state === "warn") this._field.classList.add("state-warn");
  };

  // options correspondant à la recherche en cours
  proto._filtered = function () {
    var q = norm(this._filter || "").trim();
    if (!q) return this._options.slice();
    return this._options.filter(function (o) { return norm(o.label).indexOf(q) !== -1; });
  };

  // structure du menu, reconstruite à chaque ouverture : le champ de
  // recherche est créé une seule fois pour ne pas perdre le focus
  proto._buildMenu = function () {
    var self = this;
    this._menu.textContent = "";
    this._searchEl = null;

    if (this._options.length > SEARCH_FROM) {
      var wrap = document.createElement("div");
      wrap.className = "dd-search-wrap";
      var icon = document.createElement("span");
      icon.className = "dd-search-icon";
      icon.innerHTML = SVG.search;
      var input = document.createElement("input");
      input.className = "dd-search";
      input.type = "text";
      input.placeholder = "Rechercher…";
      input.autocomplete = "off";
      input.addEventListener("input", function () {
        self._filter = input.value;
        self._activeIndex = -1;
        self._renderMenu();
      });
      wrap.appendChild(icon);
      wrap.appendChild(input);
      this._menu.appendChild(wrap);
      this._searchEl = input;
    }

    this._listEl = document.createElement("div");
    this._listEl.className = "dd-list";
    this._menu.appendChild(this._listEl);

    var empty = document.createElement("div");
    empty.className = "dd-empty";
    empty.textContent = "Aucun résultat";
    empty.hidden = true;
    this._menu.appendChild(empty);
    this._emptyEl = empty;
  };

  proto._renderMenu = function () {
    var self = this;
    if (!this._listEl) this._buildMenu();
    this._listEl.textContent = "";

    var list = this._filtered();
    this._visible = list;
    if (this._emptyEl) this._emptyEl.hidden = list.length > 0;

    list.forEach(function (opt, i) {
      var item = document.createElement("div");
      item.className = "dd-opt";
      item.setAttribute("role", "option");
      item.tabIndex = -1;
      if (self._selected && self._selected.value === opt.value) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      }
      if (i === self._activeIndex) item.classList.add("is-active");

      var check = document.createElement("span");
      check.className = "dd-opt-check";
      check.innerHTML = SVG.check;
      var lab = document.createElement("span");
      lab.textContent = opt.label;

      item.appendChild(check);
      item.appendChild(lab);
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        self.select(opt.value);
        self.close();
        self._field.focus();
      });
      self._listEl.appendChild(item);
    });

    // le focus reste dans la recherche ; sinon on le place sur l'option
    if (this._searchEl) {
      var active = this._listEl.querySelector(".is-active");
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
      if (document.activeElement !== this._searchEl) this._searchEl.focus();
    } else {
      var first = this._listEl.querySelector(".is-active") || this._listEl.firstChild;
      if (first && first.focus) first.focus();
    }
  };

  // ── clavier ──
  proto._onKey = function (e) {
    var list = this._visible || this._options;
    var n = list.length;
    if (!n) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var dir = e.key === "ArrowDown" ? 1 : -1;
      this._activeIndex = (this._activeIndex + dir + n) % n;
      this._renderMenu();
    } else if (e.key === "Enter" || (e.key === " " && !this._searchEl)) {
      e.preventDefault();
      if (this._activeIndex >= 0 && list[this._activeIndex]) {
        this.select(list[this._activeIndex].value);
        this.close();
        this._field.focus();
      } else if (list.length === 1) {
        this.select(list[0].value);
        this.close();
        this._field.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      this._field.focus();
    }
  };

  proto._emit = function () {
    this.dispatchEvent(new CustomEvent("dropdown:change", {
      bubbles: true,
      detail: { value: this.value, selected: this.selected }
    }));
  };

  // ══════════════ ENREGISTREMENT + API GLOBALE ══════════════
  customElements.define(TAG, ISOCDropdown);

  window.Dropdown = {
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
      (opts.mount || document.body).appendChild(el);
      if (opts.options) el.setOptions(opts.options);
      if (opts.value) el.select(opts.value);
      return el;
    }
  };
})();
