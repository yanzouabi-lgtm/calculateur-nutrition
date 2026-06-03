# Mise en place du pipeline d'import — À faire depuis l'ordinateur personnel

## Contexte
Le projet **calculateur-nutrition** est hébergé sur GitHub :
`https://github.com/yanzouabi-lgtm/calculateur-nutrition`

Les scripts importent des croquettes vétérinaires depuis Zooplus.fr,
les publient sur Open Pet Food Facts, et les enregistrent dans Firebase.

---

## Étape 1 — Récupérer le projet

```bash
git clone https://github.com/yanzouabi-lgtm/calculateur-nutrition.git
cd calculateur-nutrition
```

Si le projet est déjà cloné :
```bash
git pull
```

---

## Étape 2 — Clé Firebase Admin

1. Aller sur **console.firebase.google.com**
2. Sélectionner le projet **base-de-donnees-nutrition**
3. Roue dentée → **Paramètres du projet** → onglet **Comptes de service**
4. Cliquer **"Générer une nouvelle clé privée"** → télécharge un fichier `.json`
5. Renommer ce fichier `serviceAccountKey.json`
6. Le déposer dans le dossier `scripts/` du projet

```
calculateur-nutrition/
  scripts/
    serviceAccountKey.json   ← ici
```

⚠️  Ne jamais committer ce fichier (il est déjà dans .gitignore).

---

## Étape 3 — Compte Open Pet Food Facts

Si vous n'avez pas encore de compte :
1. Aller sur **world.openpetfoodfacts.org**
2. Créer un compte (gratuit)
3. Noter le **nom d'utilisateur** et le **mot de passe**

---

## Étape 4 — Fichier .env

Dans le dossier `scripts/`, créer un fichier `.env` :

```bash
cd scripts
touch .env
```

Puis ouvrir `.env` et y mettre :
```
OPFF_USER=votre_username_opff
OPFF_PASSWORD=votre_mot_de_passe_opff
```

⚠️  Ne jamais committer ce fichier (il est déjà dans .gitignore).

---

## Étape 5 — Installer les dépendances

Node.js 18+ requis. Vérifier avec : `node --version`

```bash
cd scripts
npm install
npx playwright install chromium
```

La deuxième commande télécharge le navigateur headless (~150 Mo, une seule fois).

---

## Étape 6 — Tester en dry-run

Avant d'importer quoi que ce soit, vérifier que tout fonctionne :

```bash
node run-import.js --dry-run --brand royalcanin --max 5
```

Résultat attendu : 5 produits affichés avec leurs nutriments, **sans rien écrire**.

---

## Étape 7 — Import réel

Une fois le dry-run validé :

```bash
# Une seule marque
node run-import.js --brand royalcanin
node run-import.js --brand hills
node run-import.js --brand purina
node run-import.js --brand virbac

# Ou toutes les marques d'un coup
node run-import.js
```

---

## Options disponibles

| Commande                        | Effet                                      |
|---------------------------------|--------------------------------------------|
| `--dry-run`                     | Simule sans écrire nulle part              |
| `--brand royalcanin`            | Une seule marque                           |
| `--max 20`                      | Limite à 20 produits                       |
| `--no-opff`                     | N'envoie pas vers Open Pet Food Facts      |
| `--no-firebase`                 | N'écrit pas dans Firebase                  |

Marques disponibles : `royalcanin`, `hills`, `purina`, `virbac`

---

## En cas de problème

| Erreur                                  | Solution                                                  |
|-----------------------------------------|-----------------------------------------------------------|
| `serviceAccountKey.json introuvable`    | Vérifier que le fichier est bien dans `scripts/`          |
| `OPFF_USER manquant`                    | Vérifier le fichier `scripts/.env`                        |
| Timeout Playwright                      | Zooplus a changé de structure — relancer, c'est souvent intermittent |
| `node --version` < 18                   | Mettre à jour Node.js sur nodejs.org                      |

---

## Structure des fichiers scripts

```
scripts/
  run-import.js          ← point d'entrée CLI (lancer celui-ci)
  scrape-zooplus.js      ← scraper Playwright
  publish-to-opff.js     ← publication vers OPFF
  save-to-firebase.js    ← écriture Firebase
  petfoodfacts-api.js    ← import OPFF en masse (script séparé)
  import-petfoodfacts.js ← import OPFF en masse (script séparé)
  package.json
  .env.example           ← template à copier en .env
  serviceAccountKey.json ← à déposer manuellement (non versionné)
```
