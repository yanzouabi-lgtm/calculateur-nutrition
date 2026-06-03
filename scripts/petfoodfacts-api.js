// petfoodfacts-api.js — Utilitaire Open Pet Food Facts (Node.js, ES Modules)

export const OPFF_BASE = 'https://world.openpetfoodfacts.org';

export const OMEGA3_KEYWORDS = [
  'huile de saumon', 'saumon', 'huile de lin', 'graines de lin',
  'anchois', 'hareng', 'thon', 'maquereau', 'sardine', 'huile de poisson',
];

const HEADERS = { 'User-Agent': 'calculateur-nutrition-import/1.0 (contact: yanzouabi@gmail.com)' };

/** Recherche paginée par catégorie dog-food (import en masse). */
export async function fetchDogFoodPage({ pageSize = 50, page = 1 } = {}) {
  const url =
    `${OPFF_BASE}/cgi/search.pl?action=process` +
    `&tagtype_0=categories&tag_contains_0=contains&tag_0=dog-food` +
    `&json=1&page_size=${pageSize}&page=${page}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on page ${page}`);
  return resp.json();
}

/** Recherche par nom de produit. */
export async function searchProducts(query, { pageSize = 10, page = 1 } = {}) {
  const url =
    `${OPFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&tagtype_0=categories&tag_0=dog-food&json=1&page_size=${pageSize}&page=${page}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** Lookup par code-barres EAN. */
export async function getProductByBarcode(ean) {
  const url = `${OPFF_BASE}/api/v2/product/${encodeURIComponent(ean)}.json`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Convertit un produit OPFF en entrée compatible avec le schéma Firestore
 * du calculateur nutrition (collection vet_data/croquettes).
 */
export function mapProductToEntry(p) {
  const n = p.nutriments || {};
  const ingredientsRaw =
    p.ingredients_text_fr || p.ingredients_text_en || p.ingredients_text || '';
  const lower = ingredientsRaw.toLowerCase();
  const sourcesDetected = OMEGA3_KEYWORDS.filter(kw => lower.includes(kw));

  const omega3Direct =
    n['omega-3-fat_100g'] != null ? parseFloat(n['omega-3-fat_100g']) : null;

  // OPFF stocke l'énergie en kJ dans energy_100g et en kcal dans energy-kcal_100g
  const energyKcal = n['energy-kcal_100g']
    ? parseFloat(n['energy-kcal_100g'])
    : n.energy_100g
      ? Math.round(parseFloat(n.energy_100g) / 4.184)
      : 0;

  return {
    id:      p.code || null,
    ean:     p.code || null,
    nom:     (p.product_name || p.product_name_fr || p.product_name_en || '').trim(),
    marque:  (p.brands || '').trim(),
    proteines:    parseFloat(n.proteins_100g) || 0,
    mg:           parseFloat(n.fat_100g)      || 0,
    cb:           parseFloat(n.fiber_100g)    || 0,
    cendres:      parseFloat(n.ash_100g)      || 0,
    humidite:     parseFloat(n.moisture_100g) || 10,
    epa_dha:      0,
    em_fabricant: energyKcal,
    prix:         0,
    annee:        new Date().getFullYear(),
    source:       'open_pet_food_facts',
    imported_at:  new Date().toISOString(),
    omega3_g_per_100g:      omega3Direct,
    contains_omega3_source: sourcesDetected.length > 0,
    omega3_sources_detected: sourcesDetected,
    ingredients_text: ingredientsRaw,
    manually_reviewed: false,
  };
}
