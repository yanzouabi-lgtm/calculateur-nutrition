#!/usr/bin/env node
// test-opff.js — Diagnostic OPFF : teste auth + création + récupération d'un produit
//
// Usage :
//   node test-opff.js
//   node test-opff.js --code 9900123456789   # vérifier un code déjà créé

import 'dotenv/config';

const OPFF_BASE = 'https://world.openpetfoodfacts.org';

// ── EAN-13 avec checksum valide ────────────────────────────────────────────
function ean13WithChecksum(digits12) {
  const d = digits12.toString().padStart(12, '0').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(d[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return d + check;
}

function pseudoEAN(name, brand) {
  const str = `${brand}_${name}`.toLowerCase().replace(/\s+/g, '_');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const base12 = `9900${Math.abs(hash).toString().padStart(8, '0')}`;
  return ean13WithChecksum(base12);
}

// ── Cherche un produit par code ────────────────────────────────────────────
async function fetchProduct(code) {
  const url = `${OPFF_BASE}/api/v2/product/${code}.json`;
  console.log(`\nGET ${url}`);
  const resp = await fetch(url);
  const body = await resp.text();
  try {
    const json = JSON.parse(body);
    if (json.status === 1) {
      console.log('  ✓ Produit trouvé sur OPFF :');
      const p = json.product;
      console.log(`    Nom  : ${p.product_name}`);
      console.log(`    URL  : ${OPFF_BASE}/product/${code}`);
    } else {
      console.log(`  ✗ Produit introuvable (status=${json.status})`);
    }
  } catch {
    console.log('  ✗ Réponse non-JSON :', body.slice(0, 200));
  }
  return resp.status;
}

// ── Publie un produit de test ──────────────────────────────────────────────
async function testCreate() {
  const { OPFF_USER, OPFF_PASSWORD } = process.env;

  console.log('─'.repeat(60));
  console.log('Variables d\'environnement :');
  console.log(`  OPFF_USER     = "${OPFF_USER}"`);
  console.log(`  OPFF_PASSWORD = "${OPFF_PASSWORD ? '****' + OPFF_PASSWORD.slice(-3) : '(manquant)'}"`);

  if (!OPFF_USER || !OPFF_PASSWORD) {
    console.error('\n❌  OPFF_USER ou OPFF_PASSWORD manquant dans .env');
    process.exit(1);
  }

  const testProduct = {
    name:  'Royal Canin Hepatic TEST DIAGNOSTIC',
    brand: 'Royal Canin',
  };
  const code = pseudoEAN(testProduct.name, testProduct.brand);
  console.log(`\nCode EAN-13 généré : ${code}`);

  const params = new URLSearchParams({
    user_id:      OPFF_USER,
    password:     OPFF_PASSWORD,
    code,
    product_name: testProduct.name,
    brands:       testProduct.brand,
    categories:   'Aliments pour chiens',
    lang:         'fr',
    countries:    'France',
    'nutriment_proteins':      '18',
    'nutriment_proteins_unit': '%',
  });

  console.log(`\nPOST ${OPFF_BASE}/cgi/product_jqm2.pl`);
  const resp = await fetch(`${OPFF_BASE}/cgi/product_jqm2.pl`, {
    method:  'POST',
    body:    params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  console.log(`  HTTP status : ${resp.status} ${resp.statusText}`);
  console.log(`  Content-Type: ${resp.headers.get('content-type')}`);

  const raw = await resp.text();
  console.log(`  Corps brut  : ${raw.slice(0, 500)}`);

  let json;
  try {
    json = JSON.parse(raw);
    console.log('\n  JSON parsé :');
    console.log('  ', JSON.stringify(json, null, 2).replace(/\n/g, '\n   '));
  } catch {
    console.log('\n  ✗ La réponse n\'est pas du JSON valide');
  }

  if (json?.status === 1) {
    console.log('\n  ✓ Produit créé (status=1)');
    console.log(`  URL OPFF : ${OPFF_BASE}/product/${code}`);
    // Vérifier immédiatement si le produit est accessible
    await new Promise(r => setTimeout(r, 2000));
    await fetchProduct(code);
  } else {
    console.log('\n  ✗ Création échouée');
  }
}

// ── Vérification d'un code existant ───────────────────────────────────────
const codeArg = process.argv.find(a => a.startsWith('--code='))?.split('=')[1]
             || (process.argv.includes('--code') ? process.argv[process.argv.indexOf('--code') + 1] : null);

if (codeArg) {
  console.log(`Vérification du code existant : ${codeArg}`);
  fetchProduct(codeArg).then(() => process.exit(0));
} else {
  testCreate().then(() => process.exit(0)).catch(e => {
    console.error('\n❌ Erreur :', e.message);
    process.exit(1);
  });
}
