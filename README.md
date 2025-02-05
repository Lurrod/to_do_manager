# to_do_manager

**Documentation de l'API To-Do List**

## Introduction
L'API To-Do List permet de gérer des tâches en effectuant des opérations CRUD (Create, Read, Update, Delete) via des requêtes HTTP. Les données sont stockées dans une base MongoDB.

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
  "createdAt": "date"
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
    "description": "Aller au supermarché avant 18h"
  }
  ```
- **Réponse** :
  ```json
  {
    "_id": "123",
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "completed": false,
    "createdAt": "2025-02-05T12:00:00Z"
  }
  ```

### 2. Lire toutes les tâches
**GET /tasks**
- **Réponse** :
  ```json
  [
    {
      "_id": "123",
      "title": "Acheter du lait",
      "description": "Aller au supermarché avant 18h",
      "completed": false,
      "createdAt": "2025-02-05T12:00:00Z"
    }
  ]
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
    "createdAt": "2025-02-05T12:00:00Z"
  }
  ```

### 4. Mettre à jour une tâche
**PUT /tasks/:id**
- **Body** :
  ```json
  {
    "completed": true
  }
  ```
- **Réponse** :
  ```json
  {
    "_id": "123",
    "title": "Acheter du lait",
    "description": "Aller au supermarché avant 18h",
    "completed": true,
    "createdAt": "2025-02-05T12:00:00Z"
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

## Test et validation
- Utiliser **Postman** ou **Thunder Client** pour tester les routes.
- Vérifier que toutes les opérations fonctionnent correctement avec la base de données MongoDB.

---

## Auteur
Développé par [Votre Nom] dans le cadre de la formation AFEC.

