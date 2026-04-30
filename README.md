# To-Do Manager

Gestionnaire de tâches local — backend Express + MongoDB, frontend vanilla (HTML/CSS/JS), prêt à tourner depuis un clone GitHub.

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
```

Si `MONGO_URI` est vide ou pointe sur localhost, le serveur démarre Mongo embarqué automatiquement.

---

## Fonctionnalités

- **Tâches** : créer, modifier, terminer, supprimer
- **Catégories** : créer / supprimer, couleur personnalisée, filtrage
- **Filtres de statut** : toutes / à faire / terminées
- **Recherche** en temps réel (titre + description) — raccourci `/`
- **Tri** : par date de création ou par échéance
- **Pagination** côté serveur (5 par page)
- **Statistiques** live (total / faites / restantes)
- **États** : vide, chargement (skeleton), erreur (toast)
- **Accessibilité** : skip-link, focus visible, `aria-live`, `prefers-reduced-motion`

---

## Modèle de données

```json
{
  "_id": "string",
  "title": "string",
  "description": "string",
  "completed": false,
  "createdAt": "ISO date",
  "dueDate": "ISO date | null",
  "category": "string"
}
```

---

## API

| Méthode  | Route                | Description                            |
| -------- | -------------------- | -------------------------------------- |
| `GET`    | `/tasks?page&limit`  | Liste paginée des tâches               |
| `GET`    | `/tasks/:id`         | Détail d'une tâche                     |
| `POST`   | `/tasks`             | Crée une tâche                         |
| `PUT`    | `/tasks/:id`         | Met à jour une tâche                   |
| `DELETE` | `/tasks/:id`         | Supprime une tâche                     |
| `GET`    | `/categories`        | Liste des catégories                   |
| `POST`   | `/categories`        | Crée une catégorie (`name`, `color`)   |
| `DELETE` | `/categories/:name`  | Supprime et nettoie les tâches liées   |

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
npm test
```

Les tests utilisent Jest + Supertest et s'exécutent contre l'app Express.

---

## Structure

```
to_do_manager/
├── public/
│   ├── index.html      # UI
│   ├── styles.css      # Design system (Inter + JetBrains Mono, dark)
│   └── script.js       # Logique frontend (recherche, filtres, toasts)
├── test/
│   └── server.test.js
├── server.js           # API Express + static files
├── .env.example
└── package.json
```

---

## Stack

- **Backend** : Node.js, Express, Mongoose
- **Frontend** : HTML, CSS, JavaScript vanilla — Inter & JetBrains Mono via Google Fonts
- **Tests** : Jest, Supertest

---

## Licence

ISC
