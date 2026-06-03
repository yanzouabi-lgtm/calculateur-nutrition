// cleanup-scraping.js — Supprime les entrées issues du scraping Zooplus
// Usage : node cleanup-scraping.js [--dry-run]

import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore }                  from 'firebase-admin/firestore';
import { readFileSync }                  from 'fs';
import { resolve, dirname }              from 'path';
import { fileURLToPath }                 from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const keyPath = resolve(__dir, 'serviceAccountKey.json');
const DRY_RUN = process.argv.includes('--dry-run');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
}
const db = getFirestore();

async function main() {
  const docRef = db.collection('vet_data').doc('croquettes');
  const snap   = await docRef.get();
  const items  = snap.data()?.items || [];

  const toKeep   = items.filter(i => i.source !== 'zooplus_scraping');
  const toDelete = items.filter(i => i.source === 'zooplus_scraping');

  console.log(`Total : ${items.length} entrées`);
  console.log(`À conserver : ${toKeep.length} (entrées manuelles)`);
  console.log(`À supprimer : ${toDelete.length} (scraping Zooplus)`);
  toDelete.forEach(i => console.log(`  - ${i.marque?.substring(0, 40)} — ${i.nom}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Aucune modification effectuée.');
    return;
  }

  await docRef.set({ items: toKeep });
  console.log('\nNettoyage terminé.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
