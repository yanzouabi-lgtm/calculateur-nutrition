// publish-to-opff.js — Publication des produits scrapés vers Open Pet Food Facts

const OPFF_BASE = 'https://world.openpetfoodfacts.org';

/**
 * Génère un EAN-13 reproductible avec checksum valide à partir du nom + marque.
 * Préfixe 9900 pour distinguer ces codes des vrais EAN.
 */
export function generatePseudoEAN(name, brand) {
  const str = `${brand}_${name}`.toLowerCase().replace(/\s+/g, '_');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  // 12 chiffres de base : "9900" + 8 chiffres de hash
  const base12 = `9900${Math.abs(hash).toString().padStart(8, '0')}`.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base12 + check;
}

/**
 * Publie un produit scrapé sur Open Pet Food Facts.
 * Nécessite OPFF_USER et OPFF_PASSWORD dans l'environnement.
 *
 * Notes sur les unités OPFF :
 * - crude-protein / crude-fat / crude-fibre / crude-ash / moisture → valeur en %
 *   envoyée avec unit "g" (OPFF les traite comme g/100g = %)
 * - omega-3-fat, energy-kcal → OPFF traite la valeur comme par kg.
 *   Donc : multiplier par 10 les valeurs en % pour obtenir g/kg.
 *   Ex : 0.68% oméga-3 → envoyer 6.8 (g/kg) → OPFF stocke 0.68 g/100g
 * - EPA et DHA séparés ne sont pas encore acceptés par l'API OPFF.
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

  // Convertit un % en g/kg (pour les nutriments que OPFF stocke par kg)
  const pctToGPerKg = (v) => v != null ? String(v * 10) : '';
  const toStr       = (v) => v != null ? String(v) : '';

  const params = new URLSearchParams({
    user_id:  OPFF_USER,
    password: OPFF_PASSWORD,

    code,
    // product_name_fr est obligatoire pour que le nom s'affiche en français
    product_name_fr: product.name  || '',
    brands:          product.brand || '',
    categories:      'Aliments pour chiens, Croquettes pour chiens, Alimentation vétérinaire pour chiens',
    lang:            'fr',
    countries:       'France',

    ingredients_text_fr: product.ingredients_text || '',

    // Constituants analytiques — noms OPFF petfood (crude-*)
    // L'unité "g" est interprétée par OPFF comme g/100g (= %) pour ces champs
    'nutriment_crude-protein':      toStr(n.proteins_percent),
    'nutriment_crude-protein_unit': 'g',
    'nutriment_crude-fat':          toStr(n.fat_percent),
    'nutriment_crude-fat_unit':     'g',
    'nutriment_crude-fibre':        toStr(n.fiber_percent),
    'nutriment_crude-fibre_unit':   'g',
    'nutriment_crude-ash':          toStr(n.ash_percent),
    'nutriment_crude-ash_unit':     'g',
    'nutriment_moisture':           toStr(n.moisture_percent),
    'nutriment_moisture_unit':      'g',

    // Oméga-3 : OPFF traite la valeur comme g/kg → multiplier par 10
    'nutriment_omega-3-fat':        pctToGPerKg(n.omega3_percent),
    'nutriment_omega-3-fat_unit':   'g',

    // omega-6
    'nutriment_omega-6-fat':        pctToGPerKg(n.omega6_percent),
    'nutriment_omega-6-fat_unit':   'g',

    // Énergie : OPFF traite aussi la valeur comme par kg → multiplier par 10
    'nutriment_energy-kcal':        pctToGPerKg(n.energy_kcal),
    'nutriment_energy-kcal_unit':   'kcal',

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
      body:    params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const raw = await resp.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      console.error(`  ✗ OPFF réponse non-JSON pour "${product.name}": ${raw.slice(0, 200)}`);
      return { success: false, opff_code: code, error: 'non-JSON response' };
    }

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

/**
 * Télécharge l'image produit depuis Zooplus et l'uploade sur OPFF comme photo de face.
 * Sans photo, les produits n'apparaissent pas dans les résultats de recherche OPFF.
 *
 * @param {string} code        - code EAN du produit sur OPFF
 * @param {string} imageUrl    - URL de l'image sur Zooplus
 * @returns {{ success: boolean, error?: string }}
 */
export async function uploadImageToOPFF(code, imageUrl) {
  const { OPFF_USER, OPFF_PASSWORD } = process.env;

  // Télécharger l'image depuis Zooplus
  let imageBuffer;
  try {
    const imgResp = await fetch(imageUrl, {
      headers: { 'Referer': 'https://www.zooplus.fr/', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
    imageBuffer = await imgResp.arrayBuffer();
  } catch (e) {
    return { success: false, error: `Téléchargement image échoué : ${e.message}` };
  }

  const mimeType = imageUrl.match(/\.webp$/i) ? 'image/webp'
                 : imageUrl.match(/\.png$/i)  ? 'image/png'
                 : 'image/jpeg';

  const formData = new FormData();
  formData.append('user_id',  OPFF_USER);
  formData.append('password', OPFF_PASSWORD);
  formData.append('code',     code);
  formData.append('imagefield', 'front_fr');
  formData.append('imgupload_front_fr', new Blob([imageBuffer], { type: mimeType }), 'product.jpg');

  try {
    const resp = await fetch(`${OPFF_BASE}/cgi/product_image_upload.pl`, {
      method: 'POST',
      body:   formData,
    });
    const raw = await resp.text();
    let result;
    try { result = JSON.parse(raw); } catch { result = { status: 0, raw }; }

    // L'API image retourne {"imgid": N, "files": [...]} en cas de succès
    // (pas "status: 1" comme l'API produit)
    if (result.imgid != null) return { success: true, imgid: result.imgid };
    if (result.status === 1)  return { success: true };
    return { success: false, error: result.error || result.status_verbose || raw.slice(0, 100) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
