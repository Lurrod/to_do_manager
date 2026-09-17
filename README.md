# To-Do Manager

Gestionnaire de tâches local — backend Express + MongoDB, frontend vanilla (HTML/CSS/JS), prêt à tourner depuis un clone GitHub.

Direction artistique « cahier » : papier crème quadrillé, encre bleue, stylo rouge, surligneur jaune. Tout le chrome de l'interface (cadres, cases à cocher, boutons, champs) est dessiné à main levée par [drawably](https://www.npmjs.com/package/drawably) — aucune bordure CSS ne simule un trait.

![tasks · to-do manager](https://img.shields.io/badge/stack-Node%20%E2%80%A2%20Express%20%E2%80%A2%20MongoDB-1a1a22?style=flat-square)

---

## Prérequis

- **Node.js** ≥ 18

C'est tout. MongoDB est embarqué dans l'app via [`mongodb-memory-server`](https://github.com/typegoose/mongodb-memory-server) — au premier `npm start`, un binaire MongoDB est téléchargé (~100 Mo, mis en cache pour de bon dans `~/.cache/mongodb-binaries`). Les lancements suivants sont instantanés.

---

## Installation

### En application Windows

```bash
npm install
npm run dist          # → dist/Cahier Setup 3.0.1.exe
```

Un installeur classique : raccourci sur le bureau et dans le menu Démarrer, désinstallable
depuis **Applications installées**. Les données vivent dans `%APPDATA%\Cahier\db`, hors de
l'application — une mise à jour ne les touche pas.

#### Les avertissements de Windows

L'exécutable n'est pas signé. Deux avertissements différents en découlent, et on les
confond souvent :

| Quand                                     | Ce qui s'affiche                                     | Quoi faire                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Au téléchargement**, dans le navigateur | « Fichier dangereux » / « rarement téléchargé »      | Chrome : ⌄ à côté du téléchargement → _Conserver_. Edge : ⋯ → _Conserver_ → _Afficher plus_ → _Conserver quand même_. |
| **Au lancement**                          | « Windows a protégé votre ordinateur » (SmartScreen) | _Informations complémentaires_ → _Exécuter quand même_.                                                               |

Aucun réglage du projet ne les fait disparaître : ils ne portent pas sur le contenu du
fichier mais sur **l'absence de signature et de réputation**. Un exécutable sans
certificat est traité par défaut comme inconnu, et il le restera jusqu'à ce qu'il soit
signé — voir [SECURITY.md](SECURITY.md) pour ce que ça demande.

#### Vérifier que le fichier est bien le nôtre

Puisque la signature ne peut pas l'attester, l'empreinte le peut. Chaque release publie
son empreinte SHA-256 ; pour la comparer, dans PowerShell :

```powershell
Get-FileHash -Algorithm SHA256 "$env:USERPROFILE\Downloads\Cahier-Setup-3.0.1.exe"
```

Si elle correspond à celle des notes de release, le fichier n'a pas été modifié en chemin.

> L'application a **sa propre base**, distincte de `data/db`. Pour y amener tes tâches :
> **Sauvegarder** d'un côté, **Restaurer…** de l'autre.

### Depuis le dépôt

```bash
git clone https://github.com/Lurrod/to_do_manager.git
cd to_do_manager
npm install
npm run app
```

`npm run app` démarre le serveur, attend qu'il réponde, puis ouvre **une fenêtre sans barre
d'adresse**. `Ctrl+C` ferme les deux. Si le port 3000 est occupé, le Cahier prend le suivant et
le dit.

`npm start` reste disponible pour lancer le serveur seul et ouvrir
[http://localhost:3000](http://localhost:3000) à la main.

Tes tâches sont stockées dans `./data/db/` (ignoré par Git) et persistent entre les redémarrages.

---

## Configuration (`.env`, optionnel)

Le fichier `.env` n'est pas requis. Si tu veux pointer vers une base distante (Atlas par exemple) :

```env
MONGO_URI=mongodb+srv://user:pass@cluster.xxx.mongodb.net/to_do_manager
PORT=3000
HOST=127.0.0.1
CORS_ORIGIN=https://exemple.fr
```

Si `MONGO_URI` est vide ou pointe sur localhost, le serveur démarre Mongo embarqué automatiquement.

L'API n'a pas d'authentification : elle n'écoute donc que sur la boucle locale
(`HOST=0.0.0.0` pour l'exposer sciemment) et ne répond à aucune origine tierce
tant que `CORS_ORIGIN` n'est pas défini.

---

## Fonctionnalités

- **Tâches** : créer, modifier, terminer, supprimer — avec **annulation** de la suppression
- **Étapes** : une tâche porte des sous-tâches (un seul niveau) ; cocher le dossier coche ses
  étapes, la corbeille emporte et rend la famille entière
- **Récurrence** : quotidienne, hebdomadaire ou mensuelle — cocher une occurrence crée
  immédiatement la suivante, calée sur l'échéance précédente (donc sans dérive en cas de
  retard) ; les étapes sont reprises, décochées
- **Étiquettes** : plusieurs mots-clés transversaux par tâche (`+maison` en saisie rapide),
  cliquables pour filtrer — la catégorie reste le classement principal, unique et coloré
- **Ordre manuel** : tri « manuel » et glisser-déposer — un déplacement ne produit qu'une
  écriture serveur, grâce à une indexation fractionnaire
- **Rappels** : à l'heure dite, une heure avant ou la veille — une notification Windows part du
  serveur, donc **même navigateur fermé**
- **Priorité** : basse / moyenne / haute, marquée d'un astérisque au stylo en marge
- **Catégories** : créer / supprimer, couleur personnalisée, filtrage
- **Filtres de statut** : toutes / à faire / terminées
- **Vues temporelles** : tout / en retard / aujourd'hui / cette semaine / sans date, avec
  compteur de retard — les horizons sont emboîtés, une tâche en retard reste visible dans
  « aujourd'hui » et « cette semaine »
- **Saisie rapide** : `Dentiste demain 14h #Santé !haute` est lu à la volée, avec aperçu de ce
  qui a été compris avant validation
- **Corbeille** consultable : restaurer ou supprimer définitivement (en deux clics)
- **Clavier** : `n` saisir · `/` chercher · `j`/`k` naviguer · `x` cocher · `e` modifier ·
  `Suppr` supprimer · `Ctrl+K` palette de commandes (`↑`/`↓` pour choisir, `Entrée` pour lancer)
- **Recherche** (titre + description) — raccourci `/`
- **Tri** : par création, par échéance ou par priorité
- **Tri, filtres et recherche côté serveur** : ils portent sur toute la base, pas sur la page affichée
- **Pagination** déterministe côté serveur (5 par page)
- **Statistiques** live (total / faites / restantes, et compte par catégorie)
- **États** : vide, chargement (skeleton), erreur (toast)
- **Traits dessinés** : chaque montage produit un croquis unique qui frémit (« boil ») ; les tâches terminées sont barrées d'un trait de stylo, la catégorie active est surlignée, la jauge d'avancement est hachurée
- **Accessibilité** : skip-link, focus visible, `aria-live`, `prefers-reduced-motion` (drawably fige alors le frémissement)

---

## Modèle de données

```json
{
  "_id": "string",
  "title": "string (requis, 120 caractères max)",
  "description": "string (500 max)",
  "completed": false,
  "createdAt": "ISO date",
  "dueDate": "ISO date | null",
  "category": "string (32 max)",
  "priority": "low | medium | high | vide",
  "deletedAt": "ISO date | null",
  "parentId": "string | null — la tâche dont celle-ci est une étape",
  "tags": ["string (24 max, minuscules)"],
  "order": 0,
  "recurrence": {
    "freq": "daily | weekly | monthly | vide",
    "interval": 1,
    "until": "ISO date | null"
  },
  "reminder": {
    "offset": "atDue | 1h | 1d | vide",
    "at": "ISO date | null",
    "sentAt": "ISO date | null"
  }
}
```

`createdAt`, `deletedAt` et `_id` ne sont jamais acceptés depuis le client : les
routes n'appliquent qu'une liste blanche de champs. Une suppression est douce —
la tâche part à la corbeille, reste restaurable, et disparaît définitivement au
démarrage suivant passé 7 jours.

Les champs de structure (`parentId`, `tags`, `order`, `recurrence`, `reminder`) sont
installés par une **migration idempotente au démarrage** : une base écrite avant leur
existence les reçoit au premier lancement, et relancer le serveur ne réécrit rien.

---

## API

| Méthode  | Route                 | Description                                     |
| -------- | --------------------- | ----------------------------------------------- |
| `GET`    | `/tasks`              | Liste paginée, triée et filtrée (voir ci-après) |
| `GET`    | `/tasks/stats`        | Totaux, compte par catégorie et retard          |
| `GET`    | `/tasks/trash`        | Liste paginée de la corbeille                   |
| `GET`    | `/tasks/:id`          | Détail d'une tâche                              |
| `GET`    | `/tasks/:id/children` | Étapes d'une tâche                              |
| `PATCH`  | `/tasks/:id/order`    | Déplace une tâche entre deux voisines           |
| `POST`   | `/tasks/bulk`         | Même action sur 100 tâches au plus              |
| `POST`   | `/tasks`              | Crée une tâche                                  |
| `PUT`    | `/tasks/:id`          | Met à jour une tâche                            |
| `DELETE` | `/tasks/:id`          | Met la tâche à la corbeille                     |
| `POST`   | `/tasks/:id/restore`  | Ressort une tâche de la corbeille               |
| `DELETE` | `/tasks/:id/purge`    | Supprime définitivement (corbeille seulement)   |
| `GET`    | `/export`             | Sauvegarde JSON complète (corbeille comprise)   |
| `GET`    | `/export.md`          | Le cahier en Markdown, groupé par catégorie     |
| `GET`    | `/export.csv`         | Tableau CSV à colonnes stables                  |
| `POST`   | `/import`             | Remet une sauvegarde (`merge` ou `replace`)     |
| `GET`    | `/categories`         | Liste des catégories                            |
| `POST`   | `/categories`         | Crée une catégorie (`name`, `color`)            |
| `DELETE` | `/categories/:name`   | Supprime et nettoie les tâches liées            |
| `GET`    | `/healthz`            | Le serveur répond, et la base est là            |

### Paramètres de `GET /tasks`

| Paramètre  | Valeurs                                                       | Défaut     |
| ---------- | ------------------------------------------------------------- | ---------- |
| `page`     | entier ≥ 1 (ramené à la dernière page si dépassé)             | `1`        |
| `limit`    | 1 à 100                                                       | `5`        |
| `sort`     | `creation`, `dueDate`, `priority`                             | `creation` |
| `status`   | `all`, `active`, `done`                                       | `all`      |
| `due`      | `all`, `overdue`, `today`, `week`, `none` — horizons emboîtés | `all`      |
| `category` | `all`, `none`, ou un nom                                      | `all`      |
| `tag`      | une étiquette (24 caractères max, insensible à la casse)      | —          |
| `q`        | recherche titre + description (100 caractères max)            | —          |

Réponse : `{ tasks, total, totalPages, currentPage }`. Le tri est toujours
départagé par `_id`, sans quoi paginer pourrait répéter ou sauter des tâches.

`GET /tasks/stats` renvoie `{ total, done, active, overdue, byCategory }` : `overdue`
compte les tâches non terminées dont l'échéance est passée — c'est le nombre affiché
sur l'onglet « en retard ».

`GET /tasks` ne renvoie que les **racines** : lister les étapes rendrait la pagination
incohérente, une page de cinq pouvant n'afficher qu'un dossier et ses quatre étapes. Chaque
racine porte `childCount` et `childDone`. Conséquence assumée : **la recherche ne trouve pas
une étape** — chercher « acompte » ne remonte pas l'étape « verser l'acompte » nichée sous
« Devis ».

### Récurrence

La suivante naît **au moment où l'occurrence est cochée**, pas par un planificateur : le Cahier
est un outil de bureau, qui n'est pas forcément allumé le jour J. Un planificateur produirait
des trous dans la série.

Sa date part de l'**échéance précédente**, jamais de la date de complétion : une hebdomadaire
cochée avec trois jours de retard revient le mardi suivant, pas le vendredi. Sans cela, « tous
les mardis » dériverait d'un cran à chaque retard.

Une récurrence exige une échéance — c'est elle qu'on fait avancer. Une mensuelle posée un 31
retombe sur le dernier jour des mois plus courts (28, 29 ou 30), et ne saute pas de mois.

### Rappels

Le Cahier n'a ni compte, ni service distant : un rappel ne peut partir que **tant que le
serveur tourne**. C'est la limite du modèle, et elle est assumée — aucun réglage ne laisse
croire que vous serez prévenu l'application éteinte.

Le serveur balaie la base toutes les soixante secondes. Les rappels dont l'heure est passée
pendant un arrêt sortent **groupés en une seule notification** au démarrage suivant : douze
toasts d'affilée seraient du bruit. Passé sept jours, un rappel est classé sans être affiché —
il ne rappelle plus rien.

Le toast passe par PowerShell et l'API WinRT de Windows, **sans aucune dépendance ajoutée**. Le
texte transite par variables d'environnement et n'est jamais interpolé dans le script : un
titre contenant une apostrophe le casserait, et une valeur choisie pourrait y injecter du code.

**Non fait, assumé :** le bandeau « des rappels sont partis pendant votre absence ». Il
demanderait de retenir ce que vous avez déjà vu, donc un état de plus en base ; le pictogramme
sur la tâche et la notification couvrent l'essentiel.

### Ordre manuel

Déposer une tâche entre deux voisines lui donne leur rang moyen : **une seule écriture**, au
lieu d'en faire autant que la liste compte de tâches. La liste n'est renumérotée que lorsque
l'écart entre deux voisines devient trop petit pour les flottants.

Le glisser-déposer n'est actif que sous le tri « manuel » : réordonner à la main une liste
triée par priorité produirait un ordre que le tri réécraserait au chargement suivant.

### Exemple — créer une tâche

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Acheter du lait",
    "description": "Avant 18h",
    "dueDate": "2026-05-01T18:00:00Z",
    "category": "Courses"
  }'
```

---

## Sauvegarde

```bash
npm run backup     # écrit backups/cahier-<horodatage>.json (serveur allumé)
```

Le bouton **Sauvegarder** de la barre latérale télécharge le même JSON, et `Ctrl+K` →
« sauvegarder » fait de même au clavier.

Pour remettre une sauvegarde :

```bash
# fusionner : ajoute ce qui manque, ne touche à rien d'existant
curl -X POST http://127.0.0.1:3000/import \
     -H 'Content-Type: application/json' \
     --data-binary @backups/cahier-2026-09-16T08-42-11.json

# remplacer : reconstruit la base à l'identique de la sauvegarde
curl -X POST 'http://127.0.0.1:3000/import?mode=replace' \
     -H 'Content-Type: application/json' -H 'X-Confirm: replace' \
     --data-binary @backups/cahier-2026-09-16T08-42-11.json
```

Le mode `replace` exige l'en-tête `X-Confirm: replace` et **dépose l'état courant dans
`backups/` avant d'effacer**. Un import est tout ou rien : une seule ligne invalide, un
identifiant en double dans le fichier, et rien n'est écrit — le refus intervient avant
l'effacement.

Une réimportation **comble les champs absents** avec les valeurs par défaut du schéma. Une
tâche écrite avant l'ajout de `priority` ou de `deletedAt` ressort donc avec `priority: ""`
et `deletedAt: null` : l'aller-retour reproduit les données, pas l'absence d'un champ. C'est
ce que ferait une migration, les requêtes ne font aucune différence entre « absent » et
« null », et l'opération est stable — un second aller-retour ne change plus rien.

`export.csv` neutralise les cellules commençant par `=`, `+`, `-` ou `@` en les préfixant
d'une apostrophe — sans quoi un tableur les exécuterait comme des formules. C'est pourquoi le
format d'aller-retour est le JSON, pas le CSV.

---

## Tests

```bash
npm test          # API puis interface
npm run test:api  # Jest + Supertest contre l'app Express
npm run test:ui   # Vitest + happy-dom sur les modules du navigateur
```

- `test/api/` : routes, validation, tri/filtres/recherche, horizons d'échéance,
  pagination, corbeille, paramètres hostiles (opérateurs Mongo passés en query).
- `test/ui/` : utilitaires purs, client HTTP, parseur de saisie rapide à horloge
  figée, cycle de vie des croquis drawably, piège de focus des modales, et le
  pilotage complet de l'application (chargement, recherche débouncée, réponses qui
  reviennent dans le désordre, bascule optimiste, suppression annulable, onglets
  temporels, corbeille, raccourcis clavier et palette) monté sur le vrai
  `index.html`.

Le navigateur charge drawably depuis `/vendor/drawably` ; en test, `vitest.config.js`
redirige cet alias vers `node_modules/drawably`.

Les deux commandes mesurent la couverture et **échouent sous le seuil** : 85 % des
lignes côté API, 88 % côté interface. Ces seuils sont posés juste sous le niveau
atteint — ils empêchent de redescendre, ils ne récompensent rien. La couverture des
branches de l'interface est à 79 %, sous la barre des 80 % que se donne le projet :
c'est une dette connue, écrite dans `vitest.config.js`.

---

## Qualité et publication

```bash
npm run format        # Prettier sur tout le dépôt
npm run format:check  # ce que vérifie la CI
npm run audit         # failles hautes dans les dépendances de production
npm run icons         # refabrique les icônes depuis public/favicon.svg
npm run dist          # installeur local, non publié
```

Chaque poussée et chaque PR déclenchent la CI (`.github/workflows/ci.yml`) sous
Windows : formatage, audit, 400 tests et seuils de couverture. L'audit des
dépendances de production **bloque** ; celui des outils de développement
avertit sans bloquer, ces paquets ne partant pas dans l'installeur.

### Publier une version

```bash
npm version minor        # met à jour package.json et crée l'étiquette
git push --follow-tags
```

L'étiquette `vX.Y.Z` déclenche `.github/workflows/release.yml` : la version de
l'étiquette est confrontée à `package.json`, les tests rejouent, puis l'installeur
et son `latest.yml` sont déposés dans une release GitHub **en brouillon**.
**Aucune release ne se construit sur un poste de développement.**

Le brouillon est délibéré : les trois seuls défauts d'empaquetage qu'a connus ce
projet n'apparaissaient que sur l'application installée, jamais en développement
ni en test. Il reste donc une étape à la main — installer le brouillon, l'ouvrir,
puis le publier dans GitHub. **Tant qu'il est en brouillon, aucun poste ne le
voit** : c'est la publication qui déclenche la mise à jour automatique chez les
utilisateurs.

Le binaire Mongo embarqué est téléchargé par `scripts/fetch-mongod.js` à une
version écrite noir sur blanc, et non pris dans le cache de la machine qui
construit.

### Mise à jour automatique

Les postes déjà installés interrogent les releases au lancement, téléchargent en
fond et ne proposent le redémarrage qu'une fois la version sur le disque. Décliner
ne perd rien : elle se pose à la fermeture suivante. Hors ligne, il ne se passe
rien et rien ne s'affiche — le Cahier s'utilise sans réseau. La logique est dans
`lib/updates.js`, testable sans ouvrir de fenêtre.

La proposition paraît **dans la page**, sur un bandeau de papier, et non dans une
boîte de dialogue Windows. La fenêtre étant bridée (`contextIsolation: true`,
aucun préchargement privilégié), le processus principal ne peut rien lui envoyer
directement : il écrit dans un état partagé (`lib/maj-etat.js`) que le serveur —
qui tourne dans ce même processus — expose en `GET /systeme`. Aucun pont Node
n'est ouvert vers la page ; elle ne voit qu'une réponse JSON de plus.

Les failles se signalent en privé — voir [SECURITY.md](SECURITY.md), qui dit aussi
ce que l'application ne protège pas. Les versions se lisent dans
[CHANGELOG.md](CHANGELOG.md).

---

## Structure

```
to_do_manager/
├── public/
│   ├── index.html          # UI (les éléments à dessiner portent data-sketch="…")
│   ├── css/
│   │   ├── tokens.css      # Palette, typo, papier quadrillé, thème drawably
│   │   ├── layout.css      # Structure : en-tête, colonnes, marge du cahier
│   │   └── components.css  # Panneaux, champs, tâches, modales, toasts
│   └── js/
│       ├── app.js          # État, rendu, événements, composeur
│       ├── api.js          # Client HTTP (tri, filtres et recherche en paramètres)
│       ├── parse.js        # Saisie rapide (module pur, horloge injectable)
│       ├── filters.js      # Pastilles de statut et d'échéance, invariant croisé
│       ├── trash.js        # Corbeille : liste, restauration, purge confirmée
│       ├── palette.js      # Palette de commandes (Ctrl+K), navigable au clavier
│       ├── reglages.js     # Page Réglages, dessinée depuis le schéma du serveur
│       ├── preferences.js  # Les réglages courants, détenus à un seul endroit
│       ├── maj.js          # Bandeau de mise à jour (n'ouvre que sur une version prête)
│       ├── steps.js        # Étapes d'une tâche, dépliage et cache
│       ├── keyboard.js     # Curseur et raccourcis clavier
│       ├── modal.js        # Ouverture, fermeture et piège de focus
│       ├── sketch.js       # Couche drawably (attache, biffage, jauge)
│       └── util.js         # Dates, échappement, toasts
├── lib/                    # Logique pure, testable sans base ni serveur
│   ├── portable.js         # Forme de l'export, liste blanche d'import
│   ├── formats.js          # Rendus Markdown et CSV
│   ├── recurrence.js       # Échéance suivante d'une récurrente
│   ├── tags.js             # Normalisation des étiquettes
│   ├── ordering.js         # Indexation fractionnaire de l'ordre manuel
│   ├── reminders.js        # Heure d'un rappel et texte groupé
│   ├── notify.js           # Toast Windows (le seul module qui parle à l'OS)
│   ├── listen.js           # Mise à l'écoute tolérante au port occupé
│   ├── preferences.js      # Schéma fermé des réglages : défauts et validation
│   ├── preferences-depot.js # Le document unique des réglages, dans Mongo
│   ├── preferences-routes.js # GET/PUT /preferences, et le schéma servi à la page
│   ├── maj-etat.js         # État de la mise à jour, partagé Electron ↔ page
│   ├── systeme-routes.js   # GET /systeme et les actions, gardées par l'origine
│   └── launcher.js         # Ce que le lanceur doit décider
├── electron/
│   ├── main.js             # Processus principal : données, mongod, fenêtre
│   └── icon.png            # Icône de l'application
├── scripts/
│   ├── app.js              # Lance le serveur puis ouvre la fenêtre
│   └── backup.js           # Sauvegarde horodatée via l'API
├── backups/                # Sauvegardes (ignoré par git)
├── test/
│   ├── api/server.test.js  # Jest + Supertest
│   ├── server/*.test.js    # Jest, unitaire, sans base
│   ├── ui/parse.test.js    # Parseur de saisie rapide, horloge figée
│   └── ui/*.test.js        # Vitest + happy-dom
├── server.js               # API Express + fichiers statiques + /vendor/drawably
├── .env.example
└── package.json
```

### La couche dessin

`public/js/sketch.js` est le seul module qui parle à drawably. Le HTML se contente
de déclarer ce qu'il veut :

```html
<button data-sketch="button" data-variant="solid">Ajouter</button>
<span class="field" data-sketch="input"><input id="task-title" /></span>
```

`sketchAll(racine)` attache les croquis manquants — y compris sur le HTML produit
à la volée par le rendu des tâches. La lib est servie telle quelle depuis
`node_modules` sur `/vendor/drawably` : pas d'étape de build, `npm start` suffit.

---

## Stack

- **Backend** : Node.js, Express, Mongoose
- **Frontend** : HTML, CSS, JavaScript vanilla (modules ES) — [drawably](https://www.npmjs.com/package/drawably) pour le tracé, Caveat & Karla via Google Fonts
- **Tests** : Jest et Supertest (API), Vitest et happy-dom (interface)

---

## Licence

ISC — voir [LICENSE](LICENSE).
