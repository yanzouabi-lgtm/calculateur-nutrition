# Tâche : Intégration Open Pet Food Facts dans la base Firebase

## Contexte du projet

Ce site calcule des complémentations en oméga-3 pour chiens. Il existe déjà une base de données Firebase (Firestore) permettant d'ajouter et modifier des aliments pour chiens (croquettes). L'objectif est d'enrichir cette base automatiquement à partir de l'API **Open Pet Food Facts**.

---

## Ce que tu dois implémenter

### 1. Script d'import depuis Open Pet Food Facts

Crée un script (Node.js ou dans le langage du projet) capable de :

1. **Interroger l'API Open Pet Food Facts** pour récupérer des croquettes pour chiens :
   - URL de base : `https://world.openpetfoodfacts.org`
   - Endpoint de recherche : `GET /cgi/search.pl?action=process&tagtype_0=categories&tag_contains_0=contains&tag_0=dog-food&json=1&page_size=50&page=1`
   - Filtrer sur `pnns_groups_1` ou `categories_tags` contenant `en:dog-food` ou `en:dry-dog-food`

2. **Extraire pour chaque produit** les champs suivants (s'ils existent) :
   ```
   - product_name          → nom du produit
   - brands                → marque
   - nutriments.proteins_100g   → protéines (%)
   - nutriments.fat_100g        → matières grasses (%)
   - nutriments.fiber_100g      → fibres brutes (%)
   - nutriments.ash_100g        → cendres brutes (%)
   - nutriments.moisture_100g   → humidité (%)
   - nutriments.energy_100g     → énergie (kcal/100g)
   - ingredients_text_fr  → liste des ingrédients (FR si dispo, sinon EN)
   - code                 → code-barres EAN (utile comme identifiant unique)
   ```

3. **Calculer le champ `omega3_estimated`** si non présent :
   - Si les ingrédients contiennent "huile de saumon", "saumon", "huile de lin", "graines de lin", "anchois", "hareng", "thon" → mettre un flag `contains_omega3_source: true`
   - Si `nutriments.omega-3-fat_100g` existe → l'utiliser directement
   - Sinon → laisser le champ `omega3_g_per_100g: null` (à remplir manuellement)

4. **Écrire dans Firebase Firestore** :
   - Collection cible : récupère le nom de la collection existante dans le code (cherche dans les fichiers du projet les appels Firestore existants pour les aliments/croquettes)
   - Utiliser le code-barres EAN comme `document ID` pour éviter les doublons
   - Si le document existe déjà → ne pas écraser (mode "insert only"), sauf si `--force` est passé en argument
   - Ajouter un champ `source: "open_pet_food_facts"` et `imported_at: Timestamp`

5. **Gestion de la pagination** :
   - Paginer automatiquement jusqu'à `--max-pages` (défaut : 5 pages de 50 produits)
   - Respecter un délai de 1 seconde entre chaque requête (politesse API)
   - Logger le nombre de produits importés / ignorés / en erreur

---

### 2. Fonction de recherche par nom (lookup temps réel)

Dans l'interface existante du site, ajoute une fonctionnalité permettant à l'utilisateur de **rechercher une croquette par nom** et de l'importer à la volée :

- Input de recherche → appel `GET https://world.openpetfoodfacts.org/cgi/search.pl?search_terms={query}&tagtype_0=categories&tag_0=dog-food&json=1&page_size=10`
- Afficher les résultats trouvés avec nom + marque + aperçu des nutriments
- Bouton "Importer" → écriture dans Firebase avec les mêmes champs que ci-dessus
- Gère le cas où aucun résultat n'est trouvé (inviter à saisir manuellement)

---

### 3. Fonction de lookup par code-barres (optionnel mais souhaitable)

Si le projet a une interface mobile ou un champ code-barres :

- `GET https://world.openpetfoodfacts.org/api/v2/product/{barcode}.json`
- Extraire les mêmes champs et pré-remplir le formulaire d'ajout d'aliment

---

## Contraintes importantes

- **Ne pas modifier** le schéma Firestore existant — ajoute seulement les nouveaux champs, ne supprime rien
- **Ne pas casser** le formulaire d'ajout manuel existant — l'import automatique est une option supplémentaire
- Les champs oméga-3 ne sont presque jamais présents dans Open Pet Food Facts : le champ doit rester modifiable manuellement dans l'interface existante
- Prévoir un **mode dry-run** (`--dry-run`) qui affiche ce qui serait importé sans écrire dans Firebase
- Le script d'import doit fonctionner en CLI (pour un cron job ou une exécution manuelle)

---

## Structure de fichiers suggérée

```
scripts/
  import-petfoodfacts.js    ← script CLI d'import en masse
  petfoodfacts-api.js       ← module utilitaire pour l'API (réutilisable côté front)
src/ (ou là où est le code front existant)
  components/
    FoodSearch.jsx (ou .vue / .svelte selon le framework)  ← composant de recherche
```

---

## Exemple de document Firestore cible

```json
{
  "id": "3228021178",
  "name": "Royal Canin Medium Adult",
  "brand": "Royal Canin",
  "source": "open_pet_food_facts",
  "imported_at": "2026-06-03T10:00:00Z",
  "nutrients": {
    "proteins_percent": 25.0,
    "fat_percent": 14.0,
    "fiber_percent": 2.4,
    "ash_percent": 6.5,
    "moisture_percent": 10.0,
    "energy_kcal_100g": 362
  },
  "omega3_g_per_100g": null,
  "contains_omega3_source": true,
  "omega3_sources_detected": ["huile de saumon"],
  "ingredients_text": "Maïs, farine de volaille déshydratée...",
  "manually_reviewed": false
}
```

---

## Pour démarrer

1. Identifie d'abord la structure Firestore existante en cherchant dans le code les appels `addDoc`, `setDoc`, `collection(db, ...)` — adapte le schéma ci-dessus en conséquence
2. Vérifie si Firebase Admin SDK est déjà configuré (pour le script CLI) ou si seul le SDK client est présent
3. Crée le script CLI en premier, teste avec `--dry-run --max-pages 1`
4. Ensuite intègre la recherche dans l'UI

---

## Ressources

- Doc API Open Pet Food Facts : https://world.openpetfoodfacts.org/data
- API identique à Open Food Facts : https://openfoodfacts.github.io/openfoodfacts-server/api/
- Exemple d'appel direct : `curl "https://world.openpetfoodfacts.org/api/v2/product/3228021178.json"`
