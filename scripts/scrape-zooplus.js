// scrape-zooplus.js — Scraper Playwright pour les croquettes vétérinaires Zooplus.fr

export const CATEGORY_URLS = {
  royalcanin: 'https://www.zooplus.fr/shop/chiens/croquettes_chien/royal_canin_veterinary_diet',
  hills:      'https://www.zooplus.fr/shop/chiens/croquettes_chien/croquettes_chien_hills_prescription_diet',
  purina:     'https://www.zooplus.fr/shop/chiens/croquettes_chien/croquettes_chien_purina_veterinary_diets',
  virbac:     'https://www.zooplus.fr/shop/chiens/croquettes_chien/virbac_vet_hpm',
};

const DELAY_MS = 2000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function acceptCookiesIfPresent(page) {
  try {
    // Sélecteurs CSS directs (sans :has-text)
    const directSelectors = [
      '[data-zta="cookieBannerAcceptButton"]',
      '[data-testid="cookie-accept"]',
      '#onetrust-accept-btn-handler',
      '.cookie-accept',
    ];
    for (const sel of directSelectors) {
      const el = await page.$(sel);
      if (el) { await el.click(); await sleep(1500); return; }
    }
    // Fallback : locator Playwright (supporte hasText)
    const btn = page.locator('button', { hasText: /accepter et continuer/i });
    if (await btn.count() > 0) {
      await btn.first().click({ timeout: 3000 });
      await sleep(1500);
    }
  } catch (_) {}
}

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
      await acceptCookiesIfPresent(page);

      // Extraire les liens produits — uniquement ceux sous la catégorie courante
      const links = await page.evaluate((baseCategoryUrl) => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(href =>
            href.startsWith(baseCategoryUrl) &&
            !href.includes('?') &&
            href.split('/').length > baseCategoryUrl.split('/').length
          );
      }, categoryUrl);

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
  await acceptCookiesIfPresent(page);

  // Scroll pour déclencher le lazy loading
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // Cliquer sur les accordéons/onglets liés à la composition pour les ouvrir
  await page.evaluate(() => {
    const keywords = ['composants', 'analytiques', 'composition', 'ingrédient', 'ingredient', 'constituant', 'analyse'];
    const candidates = Array.from(document.querySelectorAll(
      'button, [role="button"], [role="tab"], [class*="accordion"], [class*="toggle"], [class*="expand"], [class*="tab"]'
    ));
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '').toLowerCase();
      if (keywords.some(kw => text.includes(kw))) {
        try { el.click(); } catch (_) {}
      }
    }
  });
  await sleep(1500);

  const raw = await page.evaluate(() => {
    const name = document.querySelector('h1')?.innerText?.trim() ?? null;

    const rawBrand =
      document.querySelector('[itemprop="brand"]')?.innerText?.trim() ||
      document.querySelector('meta[property="product:brand"]')?.content ||
      null;
    // N'accepte que les marques connues, sinon on extraira depuis le nom
    const knownBrands = ['royal canin', "hill's", 'purina', 'virbac', 'eukanuba', 'advance'];
    const brand = (rawBrand && knownBrands.some(b => rawBrand.toLowerCase().includes(b)))
      ? rawBrand
      : null;

    // Extraire aussi le JSON-LD structuré (souvent plus fiable)
    const jsonLdText = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => s.textContent).join('\n');

    // textContent pour capturer les sections repliées/cachées
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
    const text = clone.textContent;

    return { name, brand, text, jsonLdText };
  });

  const { name, brand, text, jsonLdText } = raw;
  if (!name) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Bloc "Composants analytiques"
  const analyticsIdx = lines.findIndex(l =>
    l.toLowerCase().includes('composants analytiques') ||
    l.toLowerCase().includes('constituants analytiques')
  );
  const analyticsBlock = analyticsIdx !== -1
    ? lines.slice(analyticsIdx, analyticsIdx + 25).join(' ')
    : '';

  if (analyticsIdx === -1) {
    console.log('  ⚠  "Composants analytiques" non trouvé dans le texte de la page');
  }

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

  const resolvedBrand = brand || extractBrandFromName(name);

  return {
    name:             cleanProductName(name, resolvedBrand),
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

function cleanProductName(name, brand) {
  if (!name) return name;
  let clean = name;

  // Supprimer le nom de marque en début
  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`^${escaped}\\s*`, 'i'), '');
  }

  // Supprimer les préfixes génériques qui suivent la marque
  clean = clean.replace(/^(veterinary\s*(diet)?|vétérinaire\s*(diet)?|vet\s+hpm|prescription\s+diet)\s*/i, '');

  // Supprimer le suffixe espèce
  clean = clean.replace(/\s*[-–—]\s*(pour\s+chiens?|pour\s+chats?)\s*$/i, '');
  clean = clean.replace(/\s+pour\s+(chiens?|chats?)\s*$/i, '');

  return clean.trim();
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
    epa_dha_percent:       extract(/acides?\s+gras\s+EPA\s+et\s+DHA\s*([\d,\.]+)/i)
                        || extract(/EPA\s*(?:et\s+|[+\/]\s*)DHA\s*[:\(]?\s*([\d,\.]+)/i),
    omega3_percent:        extract(/ac[iî]des?\s+gras\s+om[eé]ga[\s-]*3\s*\(?\s*([\d,\.]+)\s*%/i),
    omega6_percent:        extract(/ac[iî]des?\s+gras\s+om[eé]ga[\s-]*6\s*\(?\s*([\d,\.]+)\s*%/i),
    energy_kcal:           extract(/([\d,\.]+)\s*kcal\s*\/\s*kg/i),
  };
}
