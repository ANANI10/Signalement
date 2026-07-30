/* ══════════════════════════════════════════════════════════════
   Composant <isoc-image-drop>
   ──────────────────────────────────────────────────────────────
   Conteneur d'images réutilisable dans tout le projet :
     • coller une capture avec Ctrl+V
     • glisser-déposer un fichier
     • importer un fichier enregistré sur la machine

   ── UTILISATION ──
   1. Dans <head> :
        <link rel="stylesheet" href="components/image-drop.css">
   2. Où l'on veut le conteneur :
        <isoc-image-drop id="mesImages" label="Captures & preuves"
                         hint="..." multiple max-size="5"></isoc-image-drop>
   3. Avant </body> :
        <script src="components/image-drop.js"></script>

   ── ATTRIBUTS ──
   label      titre affiché dans l'en-tête       (défaut : "Images")
   hint       texte d'aide sous la zone          (défaut : formats + taille)
   multiple   autorise plusieurs images          (sinon la nouvelle remplace)
   max-size   taille max par image, en Mo        (défaut : 5)
   accept     types acceptés                     (défaut : "image/*")

   ── API (sur l'élément) ──
   el.images            tableau {id, name, type, size, dataUrl, file}
   el.count             nombre d'images
   el.addFiles(list)    ajoute des File / FileList  → Promise
   el.remove(id)        retire une image
   el.clear()           vide le conteneur
   el.toDataURLs()      tableau de data URLs

   ── ÉVÉNEMENT ──
   el.addEventListener("imgdrop:change", e => e.detail.images)

   ── API GLOBALE ──
   ImageDrop.get("mesImages")            récupère une instance
   ImageDrop.instances()                 toutes les instances de la page
   ImageDrop.create({ mount, label })    création par script
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var TAG = "isoc-image-drop";
  if (window.customElements && customElements.get(TAG)) return; // déjà chargé

  var SVG = {
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>'
  };

  var uid = 0;
  function nextId() { uid++; return "img" + Date.now().toString(36) + uid; }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " o";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " Ko";
    return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " Mo";
  }

  // ── Agrandissement (une seule fois par document) ──
  var lightbox = null;
  function openLightbox(src, alt) {
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "imgdrop-lightbox";
      lightbox.innerHTML =
        '<button class="imgdrop-lb-close" type="button" aria-label="Fermer">' + SVG.close + "</button>" +
        '<img alt="">';
      document.body.appendChild(lightbox);
      lightbox.addEventListener("click", closeLightbox);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeLightbox();
      });
    }
    var img = lightbox.querySelector("img");
    img.src = src;
    img.alt = alt || "";
    lightbox.classList.add("show");
  }
  function closeLightbox() {
    if (lightbox) lightbox.classList.remove("show");
  }

  // ══════════════ ÉLÉMENT ══════════════
  class ISOCImageDrop extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      this._items = [];
      this._build();
    }

    get images() { return (this._items || []).slice(); }
    get count()  { return (this._items || []).length; }
  }

  var proto = ISOCImageDrop.prototype;

  proto._build = function () {
    var self = this;
    var label = this.getAttribute("label") || "Images";
    var maxSize = parseFloat(this.getAttribute("max-size") || "5") || 5;
    var accept = this.getAttribute("accept") || "image/*";
    var multiple = this.hasAttribute("multiple");
    var hint = this.getAttribute("hint") ||
      ("PNG, JPG, GIF ou WEBP — " + maxSize + " Mo max" + (multiple ? "" : " — une seule image"));

    this._maxBytes = maxSize * 1024 * 1024;
    this._multiple = multiple;

    var box = document.createElement("div");
    box.className = "imgdrop-box";
    box.setAttribute("tabindex", "0");
    box.setAttribute("role", "button");
    box.innerHTML =
      '<div class="imgdrop-row">' +
        '<span class="imgdrop-icon">' + SVG.upload + "</span>" +
        '<span class="imgdrop-text">' +
          '<span class="imgdrop-title"></span>' +
          '<span class="imgdrop-main"><span class="imgdrop-kbd">Ctrl</span>+<span class="imgdrop-kbd">V</span>, ' +
            'déposer, ou <span class="imgdrop-link">importer</span></span>' +
        "</span>" +
        '<span class="imgdrop-count"></span>' +
        '<button class="imgdrop-clear" type="button" hidden>Effacer</button>' +
        '<input type="file" class="imgdrop-input">' +
      "</div>" +
      '<div class="imgdrop-grid"></div>' +
      '<p class="imgdrop-error" role="alert" hidden></p>';

    this.appendChild(box);

    this._zone  = box;
    this._grid  = box.querySelector(".imgdrop-grid");
    this._input = box.querySelector(".imgdrop-input");
    this._count = box.querySelector(".imgdrop-count");
    this._error = box.querySelector(".imgdrop-error");
    this._clearBtn = box.querySelector(".imgdrop-clear");

    box.querySelector(".imgdrop-title").textContent = label;
    box.title = hint;
    box.setAttribute("aria-label", label + " — coller, déposer ou importer une image");
    this._input.accept = accept;
    if (multiple) this._input.multiple = true;

    // clic → sélecteur de fichiers
    this._zone.addEventListener("click", function () { self._input.click(); });
    this._zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); self._input.click(); }
    });
    this._input.addEventListener("change", function () {
      self.addFiles(self._input.files);
      self._input.value = "";
    });

    // glisser-déposer
    ["dragenter", "dragover"].forEach(function (evt) {
      self._zone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        self._zone.classList.add("is-over");
      });
    });
    ["dragleave", "dragend"].forEach(function (evt) {
      self._zone.addEventListener(evt, function (e) {
        e.preventDefault(); e.stopPropagation();
        self._zone.classList.remove("is-over");
      });
    });
    self._zone.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      self._zone.classList.remove("is-over");
      if (e.dataTransfer && e.dataTransfer.files) self.addFiles(e.dataTransfer.files);
    });

    // coller directement dans le conteneur (quand il a le focus)
    this.addEventListener("paste", function (e) { handlePaste(e, self); });

    // mémorise le dernier conteneur utilisé (pour le Ctrl+V global)
    this.addEventListener("focusin", function () { registry.last = self; });
    this.addEventListener("mousedown", function () { registry.last = self; });

    this._clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      self.clear();
    });

    this._render();
  };

  // ── API ──
  proto.addFiles = function (list) {
    var self = this;
    var files = [];
    var i;
    if (!list) return Promise.resolve([]);
    for (i = 0; i < list.length; i++) files.push(list[i]);

    var images = files.filter(function (f) { return f && /^image\//.test(f.type); });
    if (images.length === 0) {
      if (files.length) this._showError("Ce fichier n'est pas une image.");
      return Promise.resolve([]);
    }

    var tooBig = images.filter(function (f) { return f.size > self._maxBytes; });
    var ok = images.filter(function (f) { return f.size <= self._maxBytes; });
    if (tooBig.length) {
      this._showError(
        tooBig.length === 1
          ? "« " + tooBig[0].name + " » dépasse la taille maximale."
          : tooBig.length + " images dépassent la taille maximale."
      );
    }
    if (!ok.length) return Promise.resolve([]);
    if (!this._multiple) ok = ok.slice(-1);

    return Promise.all(ok.map(readFile)).then(function (entries) {
      if (!self._multiple) self._items = [];
      entries.forEach(function (entry) { self._items.push(entry); });
      self._render();
      self._emit();
      return entries;
    });
  };

  proto.remove = function (id) {
    var before = this._items.length;
    this._items = this._items.filter(function (it) { return it.id !== id; });
    if (this._items.length !== before) { this._render(); this._emit(); }
  };

  proto.clear = function () {
    if (!this._items.length) return;
    this._items = [];
    this._render();
    this._emit();
  };

  proto.toDataURLs = function () {
    return this._items.map(function (it) { return it.dataUrl; });
  };

  // ── interne ──
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({
          id: nextId(),
          name: file.name || "capture.png",
          type: file.type,
          size: file.size,
          dataUrl: reader.result,
          file: file
        });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  proto._render = function () {
    var self = this;
    var n = this._items.length;

    this._count.textContent = n === 0 ? "" : n + (n > 1 ? " images" : " image");
    this._clearBtn.hidden = n === 0;
    // le texte d'invite disparaît dès qu'il y a une image
    this._zone.classList.toggle("has-images", n > 0);
    // une seule image : aperçu pleine largeur
    this._grid.classList.toggle("is-single", n === 1);
    this._grid.textContent = "";

    this._items.forEach(function (it) {
      var fig = document.createElement("figure");
      fig.className = "imgdrop-item";
      fig.title = it.name + " — " + formatSize(it.size);

      var thumb = document.createElement("button");
      thumb.className = "imgdrop-thumb";
      thumb.type = "button";
      var img = document.createElement("img");
      img.src = it.dataUrl;
      img.alt = it.name;
      thumb.appendChild(img);
      thumb.addEventListener("click", function (e) {
        e.stopPropagation();
        openLightbox(it.dataUrl, it.name);
      });

      var zoom = document.createElement("span");
      zoom.className = "imgdrop-zoom";
      zoom.innerHTML = SVG.zoom + "<span>Agrandir</span>";

      var del = document.createElement("button");
      del.className = "imgdrop-del";
      del.type = "button";
      del.title = "Retirer l'image";
      del.setAttribute("aria-label", "Retirer " + it.name);
      del.innerHTML = SVG.close;
      del.addEventListener("click", function (e) { e.stopPropagation(); self.remove(it.id); });

      fig.appendChild(thumb);
      fig.appendChild(zoom);
      fig.appendChild(del);
      self._grid.appendChild(fig);
    });
  };

  proto._showError = function (msg) {
    var self = this;
    this._error.textContent = msg;
    this._error.hidden = false;
    clearTimeout(this._errTimer);
    this._errTimer = setTimeout(function () { self._error.hidden = true; }, 5000);
  };

  proto._emit = function () {
    this.dispatchEvent(new CustomEvent("imgdrop:change", {
      bubbles: true,
      detail: { images: this.images, count: this.count }
    }));
  };

  // ══════════════ COLLER (Ctrl+V) AU NIVEAU DU DOCUMENT ══════════════
  var registry = { last: null };

  function imageFilesFrom(clipboardData) {
    var out = [];
    if (!clipboardData) return out;
    var items = clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }

  function resolveTarget(node) {
    var direct = node && node.closest ? node.closest(TAG) : null;
    if (direct) return direct;
    if (registry.last && registry.last.isConnected) return registry.last;
    var all = document.querySelectorAll(TAG);
    return all.length ? all[0] : null;
  }

  function handlePaste(e, forced) {
    var files = imageFilesFrom(e.clipboardData);
    if (!files.length) return;

    var target = forced || resolveTarget(e.target);
    if (!target) return;

    // Si le presse-papiers contient aussi du texte et que le focus est
    // ailleurs (une zone de saisie par ex.), on laisse le texte se coller.
    var hasText = ((e.clipboardData.getData("text/plain") || "").trim().length > 0);
    var focused = target.contains(document.activeElement) || document.activeElement === target;
    if (hasText && !focused) return;

    e.preventDefault();
    target.addFiles(files);
  }

  document.addEventListener("paste", function (e) {
    if (e.defaultPrevented) return;
    handlePaste(e, null);
  });

  // ══════════════ ENREGISTREMENT + API GLOBALE ══════════════
  customElements.define(TAG, ISOCImageDrop);

  window.ImageDrop = {
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
      if (opts.label) el.setAttribute("label", opts.label);
      if (opts.hint) el.setAttribute("hint", opts.hint);
      if (opts.id) el.id = opts.id;
      if (opts.multiple) el.setAttribute("multiple", "");
      if (opts.maxSize) el.setAttribute("max-size", String(opts.maxSize));
      if (opts.accept) el.setAttribute("accept", opts.accept);
      (opts.mount || document.body).appendChild(el);
      return el;
    }
  };
})();
