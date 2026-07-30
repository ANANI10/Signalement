// ══════════════════════════════════════════════════════════════
//  app.js — connexion Firebase + accès à la base Firestore
//  ─────────────────────────────────────────────────────────────
//  À charger dans une page HTML avec :
//      <script type="module" src="app.js"></script>
//
//  ⚠ Les modules ES ne fonctionnent PAS en ouvrant le fichier par
//    double-clic (file://). Il faut servir le dossier :
//        python -m http.server 8000
//    puis ouvrir http://localhost:8000/…
// ══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ── Configuration du projet ──
const firebaseConfig = {
  apiKey: "AIzaSyBpooypIQJYBiA258VJWNXT3rLk7EptE38",
  authDomain: "recap-signalement.firebaseapp.com",
  projectId: "recap-signalement",
  storageBucket: "recap-signalement.firebasestorage.app",
  messagingSenderId: "497202404007",
  appId: "1:497202404007:web:c6cc8ba0bc7a88e0809982",
  measurementId: "G-9ZT9FJQZNY"
};

// getAnalytics a été retiré : il échoue hors https et n'est pas
// nécessaire pour lire ou écrire dans la base.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Nom de la collection dans Firestore
const ROUTES = "routes";

// ══════════════ AJOUTER ══════════════
// addDoc crée un document avec un identifiant généré par Firestore.
export async function ajouterRoute(nom, ip) {
  const ref = await addDoc(collection(db, ROUTES), {
    nom: nom,
    ip: ip,
    status: "Actif",
    creeLe: serverTimestamp()      // horodatage posé par le serveur
  });
  return ref.id;                   // identifiant du document créé
}

// ══════════════ LIRE UNE FOIS ══════════════
// Renvoie un tableau d'objets, chacun avec son id.
export async function listerRoutes() {
  const snapshot = await getDocs(query(collection(db, ROUTES), orderBy("nom")));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ══════════════ ÉCOUTER EN DIRECT ══════════════
// Le callback est rappelé à chaque ajout, modification ou suppression,
// y compris depuis un autre poste. Renvoie une fonction pour arrêter
// l'écoute.
export function ecouterRoutes(callback) {
  return onSnapshot(query(collection(db, ROUTES), orderBy("nom")), (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error("Écoute interrompue :", err);
  });
}

// ══════════════ MODIFIER / SUPPRIMER ══════════════
export async function modifierRoute(id, champs) {
  await updateDoc(doc(db, ROUTES, id), champs);
}

export async function supprimerRoute(id) {
  await deleteDoc(doc(db, ROUTES, id));
}
