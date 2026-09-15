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

```bash
git clone https://github.com/Lurrod/to_do_manager.git
cd to_do_manager
npm install
npm start
```

Puis ouvre [http://localhost:3000](http://localhost:3000).

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
- **Priorité** : basse / moyenne / haute, marquée d'un astérisque au stylo en marge
- **Catégories** : créer / supprimer, couleur personnalisée, filtrage
- **Filtres de statut** : toutes / à faire / terminées
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
  "deletedAt": "ISO date | null"
}
```

`createdAt`, `deletedAt` et `_id` ne sont jamais acceptés depuis le client : les
routes n'appliquent qu'une liste blanche de champs. Une suppression est douce —
la tâche part à la corbeille, reste restaurable, et disparaît définitivement au
démarrage suivant passé 7 jours.

---

## API

| Méthode  | Route                     | Description                                    |
| -------- | ------------------------- | ---------------------------------------------- |
| `GET`    | `/tasks`                  | Liste paginée, triée et filtrée (voir ci-après) |
| `GET`    | `/tasks/stats`            | Totaux et compte par catégorie                 |
| `GET`    | `/tasks/:id`              | Détail d'une tâche                             |
| `POST`   | `/tasks`                  | Crée une tâche                                 |
| `PUT`    | `/tasks/:id`              | Met à jour une tâche                           |
| `DELETE` | `/tasks/:id`              | Met la tâche à la corbeille                    |
| `POST`   | `/tasks/:id/restore`      | Ressort une tâche de la corbeille              |
| `GET`    | `/categories`             | Liste des catégories                           |
| `POST`   | `/categories`             | Crée une catégorie (`name`, `color`)           |
| `DELETE` | `/categories/:name`       | Supprime et nettoie les tâches liées           |

### Paramètres de `GET /tasks`

| Paramètre  | Valeurs                              | Défaut     |
| ---------- | ------------------------------------ | ---------- |
| `page`     | entier ≥ 1 (ramené à la dernière page si dépassé) | `1` |
| `limit`    | 1 à 100                              | `5`        |
| `sort`     | `creation`, `dueDate`, `priority`    | `creation` |
| `status`   | `all`, `active`, `done`              | `all`      |
| `category` | `all`, `none`, ou un nom             | `all`      |
| `q`        | recherche titre + description (100 caractères max) | — |

Réponse : `{ tasks, total, totalPages, currentPage }`. Le tri est toujours
départagé par `_id`, sans quoi paginer pourrait répéter ou sauter des tâches.

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

## Tests

```bash
npm test          # API puis interface
npm run test:api  # Jest + Supertest contre l'app Express
npm run test:ui   # Vitest + happy-dom sur les modules du navigateur
```

- `test/api/` : routes, validation, tri/filtres/recherche, pagination, corbeille,
  paramètres hostiles (opérateurs Mongo passés en query).
- `test/ui/` : utilitaires purs, client HTTP, cycle de vie des croquis drawably,
  piège de focus des modales, et le pilotage complet de l'application (chargement,
  recherche débouncée, réponses qui reviennent dans le désordre, bascule
  optimiste, suppression annulable) monté sur le vrai `index.html`.

Le navigateur charge drawably depuis `/vendor/drawably` ; en test, `vitest.config.js`
redirige cet alias vers `node_modules/drawably`.

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
│       ├── app.js          # État, rendu, événements
│       ├── api.js          # Client HTTP (tri, filtres et recherche en paramètres)
│       ├── modal.js        # Ouverture, fermeture et piège de focus
│       ├── sketch.js       # Couche drawably (attache, biffage, jauge)
│       └── util.js         # Dates, échappement, toasts
├── test/
│   ├── api/server.test.js  # Jest + Supertest
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
- **Tests** : Jest, Supertest

---

## Licence

ISC
