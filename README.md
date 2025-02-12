# to_do_manager

**Documentation de l'API To-Do List**

## Introduction
L'API To-Do List permet de gérer des tâches en effectuant des opérations CRUD (Create, Read, Update, Delete) via des requêtes HTTP. Les données sont stockées dans une base MongoDB. Elle inclut également des fonctionnalités avancées comme la gestion des catégories, la pagination et le tri des tâches.

---

## Installation

1. Cloner le projet :
   ```bash
   git clone https://github.com/Lurrod/to_do_manager.git
   cd todo-manager
   ```

2. Installer les dépendances :
   ```bash
   npm install
   ```

3. Configurer les variables d'environnement dans un fichier `.env` :
   ```
   PORT=5000
   MONGO_URI=<votre_url_mongodb>
   ```

4. Lancer le serveur :
   ```bash
   npm start
   ```

---

## Modèle de données
Chaque tâche est représentée par l'objet suivant :

```json
{
  "_id": "string",
  "title": "string",
  "description": "string",
  "completed": "boolean",
  "createdAt": "date",
  "dueDate": "date",
  "category": "string"
}
```

---

## Routes de l'API

### 1. Créer une tâche
**POST /tasks**

- **Body** :
  ```json
  {
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "dueDate": "2025-02-15T12:00:00Z",
    "category": "Courses"
  }
  ```

- **Réponse** :
  ```json
  {
    "_id": "123",
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "completed": false,
    "createdAt": "2025-02-05T12:00:00Z",
    "dueDate": "2025-02-15T12:00:00Z",
    "category": "Courses"
  }
  ```

### 2. Lire toutes les tâches
**GET /tasks?page=1&limit=5**

- **Paramètres query** :
  - `page` : Numéro de la page (par défaut 1).
  - `limit` : Nombre de tâches par page (par défaut 5).

- **Réponse** :
  ```json
  {
    "tasks": [
      {
        "_id": "123",
        "title": "Acheter du lait",
        "description": "Aller au supermarché avant 18h",
        "completed": false,
        "createdAt": "2025-02-05T12:00:00Z",
        "dueDate": "2025-02-15T12:00:00Z",
        "category": "Courses"
      }
    ],
    "totalPages": 2,
    "currentPage": 1
  }
  ```

### 3. Lire une tâche spécifique
**GET /tasks/:id**

- **Réponse** :
  ```json
  {
    "_id": "123",
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "completed": false,
    "createdAt": "2025-02-05T12:00:00Z",
    "dueDate": "2025-02-15T12:00:00Z",
    "category": "Courses"
  }
  ```

### 4. Mettre à jour une tâche
**PUT /tasks/:id**

- **Body** :
  ```json
  {
    "completed": true,
    "category": "Urgent"
  }
  ```

- **Réponse** :
  ```json
  {
    "_id": "123",
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "completed": true,
    "createdAt": "2025-02-05T12:00:00Z",
    "dueDate": "2025-02-15T12:00:00Z",
    "category": "Urgent"
  }
  ```

### 5. Supprimer une tâche
**DELETE /tasks/:id**

- **Réponse** :
  ```json
  {
    "message": "Tâche supprimée"
  }
  ```

---

## Fonctionnalités supplémentaires

### Gestion des catégories
- Les catégories permettent de regrouper les tâches par thème.
- Une catégorie peut être ajoutée ou supprimée via l'interface utilisateur.

### Pagination
- Les tâches sont paginées pour améliorer la navigation.
- Les paramètres `page` et `limit` permettent de contrôler l'affichage des tâches.

### Tri des tâches
- Les tâches peuvent être triées par :
  - Date de création
  - Date limite (dueDate)

### Interface utilisateur
- L'interface inclut :
  - Un panneau pour gérer les catégories
  - Une liste des tâches avec des options pour modifier ou supprimer
  - Un système de pagination
  - Des contrôles pour trier les tâches

---

## Technologies utilisées

- Backend : Node.js, Express.js, MongoDB
- Frontend : HTML, CSS, JavaScript (vanilla)
- Librairies : Font Awesome, body-parser, cors, dotenv

---


## Auteur
Projet créé par Lurrod.
