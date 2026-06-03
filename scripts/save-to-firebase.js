// save-to-firebase.js — Écriture des produits scrapés dans Firebase Firestore
//
// Schéma cible : vet_data/croquettes → { items: [...] }
// Compatible avec le schéma existant du calculateur nutrition.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp }       from 'firebase-admin/firestore';
import { readFileSync, existsSync }      from 'fs';
import { resolve, dirname }              from 'path';
import { fileURLToPath }                 from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

let _db = null;

function getDB() {
  if (_db) return _db;

  const keyPath = resolve(__dir, 'serviceAccountKey.json');
  if (!existsSync(keyPath)) {
    throw new Error(
      'scripts/serviceAccountKey.json introuvable.\n' +
      'Téléchargez-le depuis : Console Firebase → Paramètres → Comptes de service → Générer une clé privée'
    );
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
  }
  _db = getFirestore();
  return _db;
}

/**
 * Convertit un produit scrapé en entrée compatible avec le schéma Firestore existant.
 */
export function mapScrapedToEntry(product, opffCode) {
  const n = product.nutrients || {};

  // Détection sources oméga-3 dans les ingrédients
  const OMEGA3_KW = ['saumon', 'sardine', 'anchois', 'hareng', 'thon', 'lin', 'huile de poisson'];
  const lower = (product.ingredients_text || '').toLowerCase();
  const omega3Sources = OMEGA3_KW.filter(kw => lower.includes(kw));

  const omega3DataQuality = n.epa_dha_percent != null
    ? 'confirmed'
    : omega3Sources.length > 0
      ? 'estimated'
      : 'unknown';

  return {
    // — Champs existants du schéma —
    id:           opffCode,
    nom:          product.name  || '',
    marque:       product.brand || '',
    proteines:    n.proteins_percent  ?? 0,
    mg:           n.fat_percent       ?? 0,
    cb:           n.fiber_percent     ?? 0,
    cendres:      n.ash_percent       ?? 0,
    humidite:     n.moisture_percent  ?? 10,
    epa_dha:      n.epa_dha_percent   ?? 0,
    em_fabricant: n.energy_kcal       ?? 0,
    prix:         0,
    annee:        new Date().getFullYear(),

    // — Champs supplémentaires (scraping) —
    source:         'zooplus_scraping',
    source_url:     product.source_url || '',
    opff_code:      opffCode,
    imported_at:    new Date().toISOString(),

    omega3_percent:    n.omega3_percent  ?? null,
    omega6_percent:    n.omega6_percent  ?? null,
    omega3_data_quality: omega3DataQuality,
    contains_omega3_source:  omega3Sources.length > 0,
    omega3_sources_detected: omega3Sources,
    ingredients_text: product.ingredients_text || '',
    manually_reviewed: false,
  };
}

/**
 * Sauvegarde un tableau de produits dans vet_data/croquettes.
 * - Ne pas écraser les entrées existantes (vérification par id / nom+marque)
 * - Retourne { added, skipped }
 */
export async function saveProducts(products, { dryRun = false } = {}) {
  const db     = getDB();
  const docRef = db.collection('vet_data').doc('croquettes');
  const snap   = await docRef.get();
  const existing = snap.exists ? (snap.data().items || []) : [];

  // Index de déduplication : id + (marque+nom normalisé)
  const existingIds  = new Set(existing.map(c => c.id).filter(Boolean));
  const existingKeys = new Set(
    existing.map(c => normalizeKey(c.marque, c.nom))
  );

  let added = 0, skipped = 0;
  const toAdd = [];

  for (const entry of products) {
    const key = normalizeKey(entry.marque, entry.nom);
    if (existingIds.has(entry.id) || existingKeys.has(key)) {
      console.log(`  ⏭  Skip (déjà présent) : ${entry.marque} — ${entry.nom}`);
      skipped++;
      continue;
    }
    // Remplacer imported_at par Timestamp Firestore si live
    const firestoreEntry = dryRun
      ? entry
      : { ...entry, imported_at: Timestamp.now() };

    toAdd.push(firestoreEntry);
    added++;
  }

  if (!dryRun && toAdd.length > 0) {
    await docRef.set({ items: [...existing, ...toAdd] });
  }

  return { added, skipped };
}

function normalizeKey(brand, name) {
  return `${brand}_${name}`.toLowerCase().replace(/\s+/g, ' ').trim();
}
