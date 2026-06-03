#!/usr/bin/env node
// import-petfoodfacts.js — Import en masse Open Pet Food Facts → Firebase Firestore
//
// Prérequis :
//   1. cd scripts && npm install
//   2. Télécharger la clé de service Firebase :
//      Console Firebase → Paramètres projet → Comptes de service → Générer une nouvelle clé privée
//      → Sauvegarder sous  scripts/serviceAccountKey.json
//
// Usage :
//   node import-petfoodfacts.js                   # import live (5 pages × 50)
//   node import-petfoodfacts.js --dry-run          # simulation sans écriture
//   node import-petfoodfacts.js --max-pages=2      # limiter à 2 pages
//   node import-petfoodfacts.js --force            # écraser les entrées existantes

import { initializeApp, cert }   from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname }        from 'path';
import { fileURLToPath }           from 'url';

import { fetchDogFoodPage, mapProductToEntry } from './petfoodfacts-api.js';

// ── Parsing des arguments ──────────────────────────────────────────────────
const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const FORCE     = args.includes('--force');
const maxArg    = args.find(a => a.startsWith('--max-pages='));
const MAX_PAGES = maxArg ? parseInt(maxArg.split('=')[1], 10) : 5;
const PAGE_SIZE = 50;

// ── Firebase Admin ─────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const keyPath = resolve(__dir, 'serviceAccountKey.json');

if (!existsSync(keyPath)) {
  console.error('\n❌  Fichier serviceAccountKey.json introuvable dans scripts/');
  console.error('   Téléchargez-le depuis :');
  console.error('   Console Firebase → Paramètres du projet → Comptes de service → Générer une nouvelle clé privée\n');
  process.exit(1);
}

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
const db  = getFirestore(app);

// ── Helpers ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line  = () => console.log('─'.repeat(60));

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🐾  Import Open Pet Food Facts → Firebase');
  console.log(`   Mode       : ${DRY_RUN ? 'DRY RUN — aucune écriture Firebase' : 'LIVE'}`);
  console.log(`   Pages      : ${MAX_PAGES} × ${PAGE_SIZE} produits`);
  console.log(`   Force      : ${FORCE}`);
  line();

  // Lecture des croquettes existantes
  const docRef = db.collection('vet_data').doc('croquettes');
  const snap   = await docRef.get();
  const existing    = snap.exists ? (snap.data().items || []) : [];
  const existingIds = new Set(existing.map(c => c.id).filter(Boolean));

  console.log(`   Aliments existants en base : ${existing.length}`);

  let countImported = 0, countSkipped = 0, countErrors = 0;
  const toAdd = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`\n📄  Page ${page}/${MAX_PAGES}…`);

    let data;
    try {
      data = await fetchDogFoodPage({ pageSize: PAGE_SIZE, page });
    } catch (e) {
      console.error(`   ⚠  Erreur page ${page} : ${e.message}`);
      countErrors++;
      continue;
    }

    const products = (data.products || []);
    console.log(`   ${products.length} produits reçus`);

    for (const p of products) {
      if (!p.code || !p.product_name) {
        countErrors++;
        continue;
      }

      const entry = mapProductToEntry(p);
      // Remplacer imported_at (chaîne) par un vrai Timestamp Firestore
      entry.imported_at = Timestamp.now();

      const label = `${entry.marque ? entry.marque + ' — ' : ''}${entry.nom}`;

      if (existingIds.has(entry.id) && !FORCE) {
        console.log(`   ⏭  Skip    : ${label}`);
        countSkipped++;
        continue;
      }

      console.log(`   ${DRY_RUN ? '[DRY] ' : ''}✅  Import  : ${label}`);
      toAdd.push(entry);
      countImported++;
    }

    if (page < MAX_PAGES) await sleep(1000); // politesse API
  }

  line();
  console.log(`\n   Résumé : ${countImported} à importer | ${countSkipped} ignorés | ${countErrors} ignorés (données incomplètes)`);

  if (!DRY_RUN && toAdd.length > 0) {
    console.log('\n💾  Écriture dans Firestore…');

    const updatedItems = [...existing];
    const existingByIdMap = new Map(existing.map((c, i) => [c.id, i]));

    for (const entry of toAdd) {
      if (FORCE && existingByIdMap.has(entry.id)) {
        updatedItems[existingByIdMap.get(entry.id)] = entry;
      } else {
        updatedItems.push(entry);
      }
    }

    await docRef.set({ items: updatedItems });
    console.log(`✅  ${toAdd.length} aliment(s) écrits dans vet_data/croquettes.`);
  } else if (DRY_RUN) {
    console.log('\n   (dry-run — aucune écriture effectuée)');
  }

  console.log();
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌  Erreur fatale :', e.message);
  process.exit(1);
});
