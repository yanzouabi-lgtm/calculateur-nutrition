// publish-to-opff.js — Publication des produits scrapés vers Open Pet Food Facts

const OPFF_BASE = 'https://world.openpetfoodfacts.org';

/**
 * Génère un pseudo-EAN reproductible à partir du nom + marque.
 * Préfixe 9900 pour distinguer ces codes des vrais EAN.
 */
export function generatePseudoEAN(name, brand) {
  const str = `${brand}_${name}`.toLowerCase().replace(/\s+/g, '_');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `9900${Math.abs(hash).toString().padStart(9, '0')}`;
}

/**
 * Publie un produit scrapé sur Open Pet Food Facts.
 * Nécessite OPFF_USER et OPFF_PASSWORD dans l'environnement.
 *
 * @param {object} product  - données issues du scraper
 * @param {boolean} dryRun  - si true, simule sans envoyer
 * @returns {{ success: boolean, opff_code: string, error?: any }}
 */
export async function publishToOPFF(product, { dryRun = false } = {}) {
  const { OPFF_USER, OPFF_PASSWORD } = process.env;

  if (!OPFF_USER || !OPFF_PASSWORD) {
    throw new Error('Variables OPFF_USER et OPFF_PASSWORD manquantes dans .env');
  }

  const n = product.nutrients || {};
  const code = product.ean || generatePseudoEAN(product.name, product.brand);

  const params = new URLSearchParams({
    user_id:  OPFF_USER,
    password: OPFF_PASSWORD,

    code,
    product_name:  product.name  || '',
    brands:        product.brand || '',
    categories:    'Aliments pour chiens, Croquettes pour chiens, Alimentation vétérinaire pour chiens',
    lang:          'fr',
    countries:     'France',

    ingredients_text_fr: product.ingredients_text || '',

    // Constituants analytiques (valeurs pour 100g en %)
    'nutriment_proteins':       nullToEmpty(n.proteins_percent),
    'nutriment_proteins_unit':  '%',
    'nutriment_fat':            nullToEmpty(n.fat_percent),
    'nutriment_fat_unit':       '%',
    'nutriment_fiber':          nullToEmpty(n.fiber_percent),
    'nutriment_fiber_unit':     '%',
    'nutriment_ash':            nullToEmpty(n.ash_percent),
    'nutriment_ash_unit':       '%',
    'nutriment_moisture':       nullToEmpty(n.moisture_percent),
    'nutriment_moisture_unit':  '%',

    // Oméga-3
    'nutriment_omega-3-fat':      nullToEmpty(n.omega3_percent),
    'nutriment_omega-3-fat_unit': '%',

    // EPA et DHA : si combinés, on les divise approximativement en 50/50
    'nutriment_epa':      n.epa_dha_percent != null ? String(n.epa_dha_percent / 2) : '',
    'nutriment_epa_unit': '%',
    'nutriment_dha':      n.epa_dha_percent != null ? String(n.epa_dha_percent / 2) : '',
    'nutriment_dha_unit': '%',

    'nutriment_energy-kcal':      nullToEmpty(n.energy_kcal),
    'nutriment_energy-kcal_unit': 'kcal',

    data_sources:     'Zooplus.fr',
    entry_dates_tags: new Date().toISOString().split('T')[0],
  });

  if (dryRun) {
    console.log(`  [DRY OPFF] ${product.brand} — ${product.name} (code: ${code})`);
    return { success: true, opff_code: code, dry: true };
  }

  try {
    const resp = await fetch(`${OPFF_BASE}/cgi/product_jqm2.pl`, {
      method:  'POST',
      body:    params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const result = await resp.json();

    if (result.status === 1) {
      return { success: true, opff_code: code };
    } else {
      console.error(`  ✗ OPFF error pour "${product.name}":`, result.status_verbose || result);
      return { success: false, opff_code: code, error: result };
    }
  } catch (e) {
    console.error(`  ✗ OPFF fetch error pour "${product.name}":`, e.message);
    return { success: false, opff_code: code, error: e.message };
  }
}

function nullToEmpty(v) {
  return v != null ? String(v) : '';
}
