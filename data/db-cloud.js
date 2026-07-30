/* ══════════════════════════════════════════════════════════════
   db-cloud.js — les bases de données dans Firestore
   ──────────────────────────────────────────────────────────────
   Chaque base du projet devient une collection Firestore, partagée
   entre tous les postes. Le localStorage (data/db.js) sert de
   cache : il est rafraîchi à chaque changement distant, ce qui
   permet aux pages de continuer à fonctionner hors connexion.

       Firestore  ──(onSnapshot)──►  localStorage  ──►  pages
            ▲
            └──(add / update / delete)── page bases.html

   ── CHARGEMENT ──
       <script src="data/db.js"></script>              (cache local)
       <script type="module" src="data/db-cloud.js"></script>

   ⚠ Modules ES : la page doit être servie en http (Lancer_iSOC.bat),
     pas ouverte en double-clic.

   ── API (window.ISOC_CLOUD) ──
     ISOC_CLOUD.ready              connecté ou non
     ISOC_CLOUD.add(base, valeur)
     ISOC_CLOUD.update(base, id, valeur)
     ISOC_CLOUD.remove(base, id)
     ISOC_CLOUD.idOf(base, nom)    identifiant Firestore d'une entrée
     ISOC_CLOUD.publish(base, rows)  envoi en masse (migration)
     ISOC_CLOUD.count(base)

   ── ÉVÉNEMENTS (sur window) ──
     "isoc-cloud:ready"    la connexion est établie
     "isoc-cloud:error"    connexion impossible (on reste en local)
     "isoc-db:updated"     detail:{ base } — le cache vient de changer
   ══════════════════════════════════════════════════════════════ */

import { db } from "../app.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// une collection Firestore par base
const COLLECTIONS = {
  olt: "db_olt",
  routeurs: "db_routeurs",
  sites: "db_sites",
  techniciens: "db_techniciens",
  escalades: "db_escalades",
  causes: "db_causes",
  equipements: "db_equipements",
  natures: "db_natures"
};

// état distant : base → [{ id, data }]
const remote = {};
const unsubs = [];

function schemaOf(base) {
  return window.ISOC_DB ? window.ISOC_DB.schema(base) : null;
}
function isSimple(base) {
  const s = schemaOf(base);
  return !!(s && s.simple);
}

// Firestore → forme attendue par le cache local
function toCache(base, entries) {
  if (isSimple(base)) {
    return entries
      .map((e) => String(e.data.value || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  }
  const s = schemaOf(base);
  return entries
    .map((e) => {
      const row = Object.assign({}, e.data);
      // certaines bases (techniciens) ont besoin d'un identifiant
      // stable : à défaut, celui du document Firestore fait l'affaire
      if (s && s.idFromDoc && !row.id) row.id = e.id;
      return row;
    })
    .filter((r) => r && r.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base" }));
}

// valeur locale → document Firestore
function toDoc(base, value) {
  if (isSimple(base)) return { value: String(value).trim() };
  const s = schemaOf(base);
  const out = {};
  (s ? s.cols : []).forEach((c) => {
    out[c.k] = value[c.k] != null ? value[c.k] : "";
  });
  return out;
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
}

function listen(base) {
  const ref = collection(db, COLLECTIONS[base]);
  const stop = onSnapshot(
    ref,
    (snap) => {
      remote[base] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

      // Le cache local suit Firestore — sauf si la base distante est
      // encore vide : on ne veut pas effacer des données locales qui
      // n'ont pas encore été publiées.
      if (window.ISOC_DB) {
        const rows = toCache(base, remote[base]);
        const local = window.ISOC_DB.get(base) || [];
        if (rows.length || local.length === 0) window.ISOC_DB.set(base, rows);
      }
      emit("isoc-db:updated", { base, count: remote[base].length });
    },
    (err) => {
      console.error("[db-cloud] écoute « " + base + " » interrompue :", err);
      emit("isoc-cloud:error", { base, error: err });
    }
  );
  unsubs.push(stop);
}

// ══════════════ API ══════════════
const API = {
  ready: false,
  bases: Object.keys(COLLECTIONS),

  count(base) {
    return (remote[base] || []).length;
  },

  rows(base) {
    return (remote[base] || []).map((e) => ({ id: e.id, ...e.data }));
  },

  idOf(base, name) {
    const key = String(name).trim().toLowerCase();
    const hit = (remote[base] || []).find((e) => {
      const v = isSimple(base) ? e.data.value : e.data.name;
      return String(v || "").trim().toLowerCase() === key;
    });
    return hit ? hit.id : null;
  },

  async add(base, value) {
    const ref = await addDoc(collection(db, COLLECTIONS[base]), toDoc(base, value));
    return ref.id;
  },

  async update(base, id, value) {
    await updateDoc(doc(db, COLLECTIONS[base], id), toDoc(base, value));
  },

  async remove(base, id) {
    await deleteDoc(doc(db, COLLECTIONS[base], id));
  },

  // Envoi en masse — sert à la première migration depuis le local.
  // Firestore limite un lot à 500 écritures : on découpe.
  async publish(base, rows) {
    const list = rows || [];
    let done = 0;
    for (let i = 0; i < list.length; i += 400) {
      const batch = writeBatch(db);
      list.slice(i, i + 400).forEach((row) => {
        batch.set(doc(collection(db, COLLECTIONS[base])), toDoc(base, row));
      });
      await batch.commit();
      done += Math.min(400, list.length - i);
    }
    return done;
  },

  async clear(base) {
    const entries = remote[base] || [];
    for (let i = 0; i < entries.length; i += 400) {
      const batch = writeBatch(db);
      entries.slice(i, i + 400).forEach((e) => {
        batch.delete(doc(db, COLLECTIONS[base], e.id));
      });
      await batch.commit();
    }
  }
};

window.ISOC_CLOUD = API;

try {
  API.bases.forEach(listen);
  API.ready = true;
  emit("isoc-cloud:ready", {});
  console.info("[db-cloud] connecté à Firestore — les bases sont partagées");
} catch (err) {
  API.ready = false;
  console.error("[db-cloud] connexion impossible, les bases restent locales :", err);
  emit("isoc-cloud:error", { error: err });
}
