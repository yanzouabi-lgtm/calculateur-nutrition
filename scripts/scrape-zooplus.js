// scrape-zooplus.js — Scraper Playwright pour les croquettes vétérinaires Zooplus.fr

export const CATEGORY_URLS = {
  royalcanin: 'https://www.zooplus.fr/shop/chiens/croquettes_chien/royal_canin_veterinary_diet',
  hills:      'https://www.zooplus.fr/shop/chiens/croquettes_chien/croquettes_chien_hills_prescription_diet',
  purina:     'https://www.zooplus.fr/shop/chiens/croquettes_chien/croquettes_chien_purina_veterinary_diets',
  virbac:     'https://www.zooplus.fr/shop/chiens/croquettes_chien/virbac_vet_hpm',
};

const DELAY_MS = 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Scrape toutes les URLs produits d'une page de catégorie Zooplus (avec pagination).
 * @returns {string[]} liste d'URLs produits
 */
export async function scrapeCategory(browser, categoryUrl, { maxProducts = Infinity } = {}) {
  const page = await browser.newPage();
  const productUrls = new Set();

  try {
    let currentUrl = categoryUrl;
    let pageNum = 1;

    while (currentUrl) {
      console.log(`  → Catégorie page ${pageNum} : ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(2000);

      // Extraire les liens produits
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(href =>
            href.includes('/shop/chiens/') &&
            !href.includes('?') &&
            href.split('/').length > 6
          );
      });

      for (const link of links) {
        productUrls.add(link);
        if (productUrls.size >= maxProducts) break;
      }

      if (productUrls.size >= maxProducts) break;

      // Chercher le bouton "page suivante"
      const nextUrl = await page.evaluate(() => {
        const next = document.querySelector(
          'a[rel="next"], a[aria-label*="suivant"], a[aria-label*="next"], .pagination__next a, [data-testid="next-page"] a'
        );
        return next ? next.href : null;
      });

      if (!nextUrl || nextUrl === currentUrl) break;
      currentUrl = nextUrl;
      pageNum++;
      await sleep(DELAY_MS);
    }
  } finally {
    await page.close();
  }

  return [...productUrls];
}

/**
 * Scrape une page produit Zooplus et retourne les données extraites.
 */
export async function scrapeProduct(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  const raw = await page.evaluate(() => {
    // Nom (h1)
    const name = document.querySelector('h1')?.innerText?.trim() ?? null;

    // Marque (breadcrumb, meta ou attribut brand)
    const brand =
      document.querySelector('[itemprop="brand"]')?.innerText?.trim() ||
      document.querySelector('[class*="brand"]')?.innerText?.trim() ||
      document.querySelector('meta[property="product:brand"]')?.content ||
      null;

    // Texte complet de la page (pour parsing analytiques)
    const text = document.body.innerText;

    return { name, brand, text };
  });

  const { name, brand, text } = raw;
  if (!name) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Bloc "Composants analytiques"
  const analyticsIdx = lines.findIndex(l =>
    l.toLowerCase().includes('composants analytiques')
  );
  const analyticsBlock = analyticsIdx !== -1
    ? lines.slice(analyticsIdx, analyticsIdx + 15).join(' ')
    : '';

  // Bloc "Ingrédients"
  const ingredientsIdx = lines.findIndex(l =>
    /^ingr[eé]dients?\s*:/i.test(l)
  );
  const ingredientsText = ingredientsIdx !== -1
    ? lines.slice(ingredientsIdx, ingredientsIdx + 6)
        .join(' ')
        .replace(/^ingr[eé]dients?\s*:\s*/i, '')
        .substring(0, 1000)
    : '';

  // Marque déduite du nom si non trouvée
  const resolvedBrand = brand || extractBrandFromName(name);

  return {
    name:             name,
    brand:            resolvedBrand,
    source_url:       url,
    ingredients_text: ingredientsText,
    nutrients:        parseAnalyticsBlock(analyticsBlock),
  };
}

function extractBrandFromName(name) {
  if (!name) return '';
  const brands = ['Royal Canin', "Hill's", 'Purina', 'Virbac', 'Eukanuba', 'Advance'];
  return brands.find(b => name.toLowerCase().includes(b.toLowerCase())) || '';
}

function parseAnalyticsBlock(text) {
  const extract = pattern => {
    const m = text.match(pattern);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };

  return {
    proteins_percent:      extract(/prot[eé]ines?\s+brutes?\s*[:\(]?\s*([\d,\.]+)\s*%/i),
    fat_percent:           extract(/mati[eè]res?\s+grasses?\s+brutes?\s*[:\(]?\s*([\d,\.]+)\s*%/i),
    fiber_percent:         extract(/cellulose\s+brute\s*[:\(]?\s*([\d,\.]+)\s*%/i),
    ash_percent:           extract(/cendres?\s+brutes?\s*[:\(]?\s*([\d,\.]+)\s*%/i),
    moisture_percent:      extract(/humidit[eé]\s*[:\(]?\s*([\d,\.]+)\s*%/i),
    linoleic_acid_percent: extract(/acide\s+linol[eé]ique[^\(]*\(\s*([\d,\.]+)\s*%/i),
    epa_dha_percent:       extract(/EPA\s*[\/]?\s*DHA\s*\(?\s*([\d,\.]+)\s*%/i),
    omega3_percent:        extract(/ac[iî]des?\s+gras\s+om[eé]ga[\s-]*3\s*\(?\s*([\d,\.]+)\s*%/i),
    omega6_percent:        extract(/ac[iî]des?\s+gras\s+om[eé]ga[\s-]*6\s*\(?\s*([\d,\.]+)\s*%/i),
    energy_kcal:           extract(/([\d,\.]+)\s*kcal\s*\/\s*kg/i),
  };
}
