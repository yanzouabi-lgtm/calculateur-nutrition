#!/usr/bin/env node
// run-import.js — Orchestrateur CLI : Zooplus → OPFF → Firebase
//
// Prérequis :
//   cd scripts && npm install && npx playwright install chromium
//   Copier .env.example → .env et renseigner OPFF_USER / OPFF_PASSWORD
//   Déposer scripts/serviceAccountKey.json (clé Firebase Admin)
//
// Usage :
//   node run-import.js                          # import complet
//   node run-import.js --dry-run                # simulation sans écriture
//   node run-import.js --brand royalcanin        # une seule marque
//   node run-import.js --max 20                  # limiter le nombre de produits
//   node run-import.js --no-opff                 # Firebase uniquement (sans publier OPFF)
//   node run-import.js --no-firebase             # OPFF uniquement

import 'dotenv/config';
import { chromium }               from 'playwright';
import { CATEGORY_URLS, scrapeCategory, scrapeProduct } from './scrape-zooplus.js';
import { publishToOPFF, generatePseudoEAN }             from './publish-to-opff.js';
import { mapScrapedToEntry, saveProducts }              from './save-to-firebase.js';

// ── Parsing des arguments ──────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const NO_OPFF    = args.includes('--no-opff');
const NO_FIREBASE = args.includes('--no-firebase');

const brandArg = args.find(a => a.startsWith('--brand='))?.split('=')[1]
              || (args.indexOf('--brand') !== -1 ? args[args.indexOf('--brand') + 1] : null);

const maxArg = args.find(a => a.startsWith('--max='))?.split('=')[1]
             || (args.indexOf('--max') !== -1 ? args[args.indexOf('--max') + 1] : null);
const MAX_PRODUCTS = maxArg ? parseInt(maxArg, 10) : Infinity;

const DELAY_MS = 2000;

const BRAND_KEYWORDS = {
  royalcanin: 'royal canin',
  hills:      "hill's",
  purina:     'purina',
  virbac:     'virbac',
};

function validateNutrients(n) {
  if (!n.proteins_percent || n.proteins_percent === 0) return 'protéines manquantes';
  if (!n.fat_percent      || n.fat_percent === 0)      return 'matières grasses manquantes';
  if (n.proteins_percent < 10 || n.proteins_percent > 65) return `protéines hors plage (${n.proteins_percent}%)`;
  if (n.fat_percent < 3      || n.fat_percent > 45)       return `matières grasses hors plage (${n.fat_percent}%)`;
  if (n.ash_percent  != null && (n.ash_percent < 1 || n.ash_percent > 15)) return `cendres hors plage (${n.ash_percent}%)`;
  if (n.fiber_percent != null && n.fiber_percent > 30)                      return `cellulose hors plage (${n.fiber_percent}%)`;
  // Somme des constituants
  const sum = (n.proteins_percent ?? 0) + (n.fat_percent ?? 0)
            + (n.fiber_percent ?? 0) + (n.ash_percent ?? 0) + (n.moisture_percent ?? 0);
  if (sum > 100) return `somme constituants impossible (${sum.toFixed(1)}%)`;
  if (sum < 20)  return `somme constituants trop faible — données probablement incomplètes (${sum.toFixed(1)}%)`;
  return null;
}

function validateProduct(product, brandKey, batchNames) {
  // Nom trop court
  if (product.name.trim().length < 5) return 'nom trop court';
  // Nom qui ressemble à un identifiant numérique
  if (/^\d+$/.test(product.name.trim())) return 'nom invalide (numérique)';
  // Cohérence marque
  const expectedKeyword = BRAND_KEYWORDS[brandKey];
  if (expectedKeyword && !product.name.toLowerCase().includes(expectedKeyword)
      && !(product.brand || '').toLowerCase().includes(expectedKeyword)) {
    return `marque incohérente — attendu "${expectedKeyword}", trouvé brand="${product.brand}"`;
  }
  // Doublon dans le batch courant
  const normalizedName = product.name.toLowerCase().trim();
  if (batchNames.has(normalizedName)) return 'doublon dans le batch';
  return null;
}
const sleep    = ms => new Promise(r => setTimeout(r, ms));
const line     = () => console.log('─'.repeat(60));

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🐾  Import Zooplus → OPFF → Firebase');
  console.log(`   Mode     : ${DRY_RUN ? 'DRY RUN — aucune écriture' : 'LIVE'}`);
  console.log(`   OPFF     : ${NO_OPFF ? 'désactivé' : 'activé'}`);
  console.log(`   Firebase : ${NO_FIREBASE ? 'désactivé' : 'activé'}`);
  console.log(`   Marque   : ${brandArg || 'toutes'}`);
  console.log(`   Max      : ${MAX_PRODUCTS === Infinity ? 'illimité' : MAX_PRODUCTS}`);
  line();

  // Sélection des catégories à scraper
  const categories = brandArg
    ? { [brandArg]: CATEGORY_URLS[brandArg] }
    : CATEGORY_URLS;

  if (brandArg && !CATEGORY_URLS[brandArg]) {
    console.error(`❌  Marque inconnue : "${brandArg}". Valeurs possibles : ${Object.keys(CATEGORY_URLS).join(', ')}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  let totalAdded = 0, totalSkipped = 0, totalErrors = 0;
  const allEntries = [];
  const batchNames = new Set();

  try {
    for (const [brand, categoryUrl] of Object.entries(categories)) {
      console.log(`\n📦  Marque : ${brand.toUpperCase()}`);
      console.log(`   Catégorie : ${categoryUrl}`);

      // 1. Récupérer les URLs produits de la catégorie
      let productUrls;
      try {
        productUrls = await scrapeCategory(browser, categoryUrl, { maxProducts: MAX_PRODUCTS });
      } catch (e) {
        console.error(`  ⚠  Erreur catégorie "${brand}" : ${e.message}`);
        totalErrors++;
        continue;
      }

      console.log(`  ${productUrls.length} produit(s) trouvé(s)`);

      // 2. Scraper chaque page produit
      const page = await browser.newPage();
      try {
        for (const [i, url] of productUrls.entries()) {
          if (allEntries.length >= MAX_PRODUCTS) break;

          console.log(`\n  [${i + 1}/${productUrls.length}] ${url}`);

          let product;
          try {
            product = await scrapeProduct(page, url);
          } catch (e) {
            console.error(`  ⚠  Erreur scraping : ${e.message}`);
            totalErrors++;
            continue;
          }

          if (!product?.name) {
            console.log('  ⚠  Nom introuvable — ignoré');
            totalErrors++;
            continue;
          }

          const n = product.nutrients;

          const productRejection = validateProduct(product, brand, batchNames);
          if (productRejection) {
            console.log(`  ✗ REJETÉ (${productRejection}) : ${product.name}`);
            totalErrors++;
            continue;
          }

          const nutrientRejection = validateNutrients(n);
          if (nutrientRejection) {
            console.log(`  ✗ REJETÉ (${nutrientRejection}) : ${product.name}`);
            console.log(`    P: ${n.proteins_percent ?? '?'}%  MG: ${n.fat_percent ?? '?'}%  CB: ${n.fiber_percent ?? '?'}%  Cendres: ${n.ash_percent ?? '?'}%`);
            totalErrors++;
            continue;
          }

          batchNames.add(product.name.toLowerCase().trim());

          console.log(
            `  ✓ ${product.brand} | ${product.name}\n` +
            `    P: ${n.proteins_percent ?? '?'}%  MG: ${n.fat_percent ?? '?'}%  ` +
            `EPA/DHA: ${n.epa_dha_percent ?? '?'}%  ω3: ${n.omega3_percent ?? '?'}%`
          );

          // 3. Publier dans OPFF
          let opffCode = generatePseudoEAN(product.name, product.brand);
          if (!NO_OPFF) {
            const opffResult = await publishToOPFF(product, { dryRun: DRY_RUN });
            opffCode = opffResult.opff_code;
            if (!opffResult.success && !DRY_RUN) {
              console.error('  ⚠  Publication OPFF échouée — on continue quand même');
            }
          }

          // 4. Préparer l'entrée Firebase
          const entry = mapScrapedToEntry(product, opffCode);
          allEntries.push(entry);

          if (i < productUrls.length - 1) await sleep(DELAY_MS);
        }
      } finally {
        await page.close();
      }
    }

    // 5. Écriture groupée dans Firebase
    if (!NO_FIREBASE && !DRY_RUN && allEntries.length > 0) {
      console.log(`\n💾  Écriture dans Firebase (${allEntries.length} entrées)…`);
      const { added, skipped } = await saveProducts(allEntries, { dryRun: false });
      totalAdded   += added;
      totalSkipped += skipped;
    } else if (DRY_RUN) {
      totalAdded = allEntries.length;
      console.log(`\n[DRY RUN] ${allEntries.length} produits seraient importés`);
      if (allEntries.length > 0) {
        console.log('\nAperçu du premier produit :');
        console.log(JSON.stringify(allEntries[0], null, 2));
      }
    }

  } finally {
    await browser.close();
  }

  line();
  console.log(`\n   Résumé : ${totalAdded} importés | ${totalSkipped} ignorés (déjà présents) | ${totalErrors} erreurs`);
  console.log();
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌  Erreur fatale :', e.message);
  process.exit(1);
});
