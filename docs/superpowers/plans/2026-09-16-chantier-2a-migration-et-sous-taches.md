# Chantier 2a — Migration et sous-tâches : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sortir du modèle plat. Une tâche peut porter des étapes ; cocher le parent coche ses
étapes ; la corbeille emporte et rend la famille entière.

**Architecture :** une migration idempotente au démarrage donne aux tâches existantes **tous**
les champs de la vague 2 *et* celui de la vague 4, en une seule passe. `GET /tasks` ne renvoie
plus que les racines, chacune accompagnée du compte de ses étapes, calculé par un `$lookup`
dans le pipeline d'agrégation qui existe déjà.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, JS vanilla (modules ES), Jest + Supertest,
Vitest + happy-dom. Aucune dépendance nouvelle.

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 2.1 et
« Critères d'acceptation — Vague 2 ».

**Préalable :** une sauvegarde a été prise avant d'entamer ce chantier
(`backups/cahier-2026-09-16T12-14-22.json`). C'est le premier chantier qui écrit dans les
documents existants.

---

## Structure des fichiers

| Fichier | Rôle | Chantier 2a |
|---------|------|-------------|
| `server.js` | API Express | **Modifié** : schéma, migration, `parentId`, `$lookup`, cascade corbeille |
| `lib/portable.js` | Liste blanche d'import | **Modifié** : les nouveaux champs doivent survivre à un aller-retour |
| `public/js/app.js` | État, rendu, événements | **Modifié** : affichage et création d'étapes |
| `public/js/api.js` | Client HTTP | **Modifié** : `listChildren` |
| `public/index.html` | Balisage | **Modifié** : bloc des étapes dans une tâche |
| `public/css/components.css` | Styles | **Modifié** : étapes, jauge |
| `test/api/server.test.js` | Jest + Supertest | **Modifié** |
| `test/ui/app.test.js` | Vitest | **Modifié** |
| `README.md` | Documentation | **Modifié** |

---

## Décisions arrêtées avant d'écrire une ligne

**1. Une seule migration, pour les deux vagues.** Elle installe `parentId`, `tags`, `order`,
`recurrence` (vague 2) **et** `reminder` (vague 4). Migrer deux fois la même base pour ajouter
des champs qu'on sait déjà nécessaires est du travail en double, et double le risque.

**2. `GET /tasks` ne renvoie que les racines.** Sans cela, la pagination compte les enfants et
les pages deviennent incohérentes : une page de 5 pourrait n'afficher qu'une tâche et ses
quatre étapes.

**Limite assumée, à documenter dans le README :** une recherche ne trouve donc pas une étape.
Chercher « acompte » ne remontera pas l'étape « verser l'acompte » nichée sous « Devis ». C'est
le prix de la cohérence de pagination ; le corriger demanderait de remonter les parents des
enfants trouvés, donc un second pipeline et une pagination sur un ensemble hétérogène. Hors
périmètre.

**3. Les compteurs comptent tout, étapes comprises.** Une étape cochée est du travail fait.
`GET /tasks/stats` continue donc de porter sur toutes les tâches vivantes. Conséquence
visible : l'en-tête peut annoncer « 8 écrites » là où la liste montre 5 lignes. C'est voulu —
le compteur mesure le travail, la liste montre les dossiers.

**4. La cascade de corbeille se trace à l'horodatage.** Quand un parent part à la corbeille,
ses enfants encore vivants partent avec lui en portant **exactement le même** `deletedAt`.
Restaurer le parent ne ressort que les enfants qui portent cet horodatage-là.

Sans cette précision, restaurer un parent ressusciterait aussi les étapes que l'utilisateur
avait jetées lui-même la semaine d'avant — une suppression annulée à son insu. L'égalité stricte
de date est ce qui distingue « emporté par le parent » de « jeté pour de bon ».

**5. Purger un parent purge ses étapes.** Une étape n'est atteignable qu'à travers son parent :
la laisser seule en base, c'est créer un document que plus aucune vue ne montre.

**6. Profondeur limitée à un niveau.** Une étape ne peut pas porter d'étape. Une hiérarchie
libre demanderait un modèle d'arbre (matérialisation du chemin) que rien ne justifie ici.
Le refus est explicite : `400`, pas un silence.

---

## Task 1 : migration idempotente au démarrage

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js`, comme nouveau bloc de premier niveau :

```js
describe('Migration de schéma', () => {
  const { migrateSchema } = require('../../server');

  test('donne les nouveaux champs aux tâches écrites avant eux', async () => {
    await mongoose.connection.collection('tasks').insertOne({
      title: 'Ancienne façon',
      createdAt: new Date('2026-01-02T08:00:00.000Z'),
    });

    await migrateSchema();

    const migree = await mongoose.connection.collection('tasks').findOne({ title: 'Ancienne façon' });
    expect(migree.parentId).toBeNull();
    expect(migree.tags).toEqual([]);
    expect(migree.recurrence).toEqual({ freq: '', interval: 1, until: null });
    expect(migree.reminder).toEqual({ offset: '', at: null, sentAt: null });
    // l'ordre manuel part de la date d'écriture : le seul ordre que
    // l'utilisateur a déjà sous les yeux
    expect(migree.order).toBe(new Date('2026-01-02T08:00:00.000Z').getTime());
  });

  test('ne touche pas à une tâche déjà migrée', async () => {
    const creee = await request(app).post('/tasks').send({ title: 'Déjà moderne' });
    await mongoose.connection
      .collection('tasks')
      .updateOne({ title: 'Déjà moderne' }, { $set: { order: 42, tags: ['garder'] } });

    await migrateSchema();

    const apres = await mongoose.connection.collection('tasks').findOne({ _id: new mongoose.Types.ObjectId(creee.body._id) });
    expect(apres.order).toBe(42);
    expect(apres.tags).toEqual(['garder']);
  });

  test('est rejouable sans rien changer', async () => {
    await mongoose.connection.collection('tasks').insertOne({
      title: 'Deux passages',
      createdAt: new Date('2026-01-03T08:00:00.000Z'),
    });

    await migrateSchema();
    const apresUn = await mongoose.connection.collection('tasks').findOne({ title: 'Deux passages' });
    await migrateSchema();
    const apresDeux = await mongoose.connection.collection('tasks').findOne({ title: 'Deux passages' });

    expect(apresDeux).toEqual(apresUn);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- -t "Migration de schéma"
```

Attendu : ÉCHEC — `migrateSchema is not a function`.

- [ ] **Step 3 : étendre le schéma**

Dans `server.js`, dans `taskSchema`, après `deletedAt` :

```js
  // --- vague 2 : structure ---
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
  tags: {
    type: [String],
    default: [],
    validate: [(v) => v.length <= 10, 'Maximum 10 étiquettes'],
  },
  order: { type: Number, default: 0, index: true },
  recurrence: {
    freq: { type: String, enum: ['', 'daily', 'weekly', 'monthly'], default: '' },
    interval: { type: Number, default: 1, min: 1, max: 99 },
    until: { type: Date, default: null },
  },
  // --- vague 4 : rappels ---
  reminder: {
    offset: { type: String, enum: ['', 'atDue', '1h', '1d'], default: '' },
    at: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
  },
```

Et, après les index existants :

```js
taskSchema.index({ deletedAt: 1, parentId: 1, createdAt: -1 });
```

- [ ] **Step 4 : écrire la migration**

Dans `server.js`, juste après `purgeDeletedTasks` :

```js
/**
 * Migration au démarrage. Chaque clause ne vise que les documents à qui le
 * champ manque (`$exists: false`) : relancer le serveur ne réécrit donc rien,
 * et une base déjà à jour coûte quatre requêtes qui ne touchent aucune ligne.
 *
 * `reminder` appartient à la vague 4 mais part ici : ajouter deux champs
 * connus en deux migrations successives double le risque pour rien.
 */
async function migrateSchema() {
  const defauts = [
    [{ parentId: { $exists: false } }, { parentId: null }],
    [{ tags: { $exists: false } }, { tags: [] }],
    [
      { 'recurrence.freq': { $exists: false } },
      { recurrence: { freq: '', interval: 1, until: null } },
    ],
    [
      { 'reminder.offset': { $exists: false } },
      { reminder: { offset: '', at: null, sentAt: null } },
    ],
  ];

  for (const [cible, valeurs] of defauts) {
    await Task.updateMany(cible, { $set: valeurs });
  }

  // `order` ne peut pas être une constante : deux tâches partageant le même
  // rang rendraient le tri manuel instable. On part de la date d'écriture,
  // qui est déjà l'ordre que l'utilisateur a sous les yeux.
  const sansOrdre = await Task.find({ order: { $exists: false } })
    .select('_id createdAt')
    .lean();

  if (sansOrdre.length > 0) {
    await Task.bulkWrite(
      sansOrdre.map((t) => ({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { order: new Date(t.createdAt).getTime() } },
        },
      }))
    );
    console.log(`Migration : ${sansOrdre.length} tâche(s) mise(s) à jour`);
  }
}
```

- [ ] **Step 5 : la lancer au démarrage, et l'exporter**

Dans le bloc `if (process.env.NODE_ENV !== 'test')`, remplacer :

```js
      await purgeDeletedTasks();
```

par :

```js
      await migrateSchema();
      await purgeDeletedTasks();
```

Et en bas du fichier, remplacer `module.exports = app;` par :

```js
module.exports = app;
module.exports.migrateSchema = migrateSchema;
```

- [ ] **Step 6 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 7 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: migration idempotente des champs de structure et de rappel"
```

---

## Task 2 : créer et lire une étape

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js` :

```js
describe('Sous-tâches', () => {
  /** Crée un parent et renvoie son identifiant. */
  const parent = async (title = 'Devis') => {
    const res = await request(app).post('/tasks').send({ title });
    return res.body._id;
  };

  test('POST /tasks accepte un parentId', async () => {
    const parentId = await parent();

    const res = await request(app).post('/tasks').send({ title: 'Verser l’acompte', parentId });

    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parentId);
  });

  test('GET /tasks ne renvoie que les racines', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Verser l’acompte', parentId });

    const res = await request(app).get('/tasks?limit=50');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Devis']);
    // le total sert la pagination : il ne doit compter que ce qui est listé
    expect(res.body.total).toBe(1);
  });

  test('GET /tasks/:id/children liste les étapes, les plus anciennes en tête', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Première', parentId });
    await request(app).post('/tasks').send({ title: 'Seconde', parentId });

    const res = await request(app).get(`/tasks/${parentId}/children`);

    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t) => t.title)).toEqual(['Première', 'Seconde']);
  });

  test('une étape ne peut pas porter d’étape', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Étape', parentId });

    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sous-étape', parentId: etape.body._id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un seul niveau/i);
  });

  test('un parentId qui ne désigne rien est refusé', async () => {
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app).post('/tasks').send({ title: 'Orpheline', parentId: fantome });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });

  test('on ne peut pas rattacher une tâche à elle-même', async () => {
    const parentId = await parent();

    const res = await request(app).put(`/tasks/${parentId}`).send({ parentId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/elle-même/i);
  });

  test('rattacher une tâche qui a déjà des étapes est refusé', async () => {
    const grandParent = await parent('Grand-parent');
    const pere = await parent('Père');
    await request(app).post('/tasks').send({ title: 'Fils', parentId: pere });

    const res = await request(app).put(`/tasks/${pere}`).send({ parentId: grandParent });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un seul niveau/i);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Sous-tâches"
```

Attendu : ÉCHEC — `parentId` est ignoré (absent de la liste blanche), `GET /tasks` renvoie
les deux tâches, `/children` répond 404.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, ajouter `parentId` aux deux listes blanches :

```js
const CREATE_FIELDS = ['title', 'description', 'dueDate', 'category', 'priority', 'parentId'];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'completed'];
```

Ajouter, après `buildFilter` :

```js
/**
 * Vérifie qu'un rattachement est légal : le parent doit exister, ne pas être
 * lui-même une étape, et la tâche rattachée ne doit pas déjà en porter.
 * @returns {string|null} le message d'erreur, ou null si le rattachement est bon
 */
const parentageInvalide = async (parentId, enfantId = null) => {
  if (parentId === null || parentId === undefined || parentId === '') return null;

  if (enfantId && String(parentId) === String(enfantId)) {
    return 'Une tâche ne peut pas être sa propre étape : elle-même n’est pas un parent.';
  }

  const parent = await Task.findOne({ _id: parentId, deletedAt: null }).select('parentId').lean();
  if (!parent) return 'Parent introuvable.';
  if (parent.parentId) return 'Les étapes ne s’imbriquent que sur un seul niveau.';

  if (enfantId) {
    const aDesEtapes = await Task.exists({ parentId: enfantId, deletedAt: null });
    if (aDesEtapes) return 'Les étapes ne s’imbriquent que sur un seul niveau.';
  }

  return null;
};
```

Dans `buildFilter`, après `const filter = { deletedAt: null };` :

```js
  // seules les racines sont listées : compter les étapes rendrait la
  // pagination incohérente, une page de 5 pouvant n'afficher qu'un dossier
  filter.parentId = null;
```

Remplacer la route `POST /tasks` par :

```js
app.post('/tasks', async (req, res) => {
  try {
    const champs = pick(req.body, CREATE_FIELDS);
    const refus = await parentageInvalide(champs.parentId);
    if (refus) return res.status(400).json({ error: refus });

    const task = new Task(champs);
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    fail(res, error);
  }
});
```

Remplacer la route `PUT /tasks/:id` par :

```js
app.put('/tasks/:id', async (req, res) => {
  try {
    const champs = pick(req.body, UPDATE_FIELDS);
    if (Object.hasOwn(champs, 'parentId')) {
      const refus = await parentageInvalide(champs.parentId, req.params.id);
      if (refus) return res.status(400).json({ error: refus });
    }

    const task = await Task.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, champs, {
      new: true,
      runValidators: true,
    });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});
```

> Si la route `PUT` existante diffère (options, message), garde sa forme et n'ajoute que le
> bloc de vérification du parentage : ce plan ne demande pas de la réécrire.

Ajouter, **avant** `app.get('/tasks/:id', …)` pour que « children » ne passe pas pour un
identifiant :

```js
app.get('/tasks/:id/children', async (req, res) => {
  try {
    const tasks = await Task.find({ parentId: req.params.id, deletedAt: null })
      .sort({ order: 1, createdAt: 1, _id: 1 })
      .lean();
    res.status(200).json({ tasks, total: tasks.length });
  } catch (error) {
    fail(res, error);
  }
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: rattacher une tache a un parent, sur un seul niveau"
```

---

## Task 3 : compte des étapes sur chaque racine

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter **dans** le `describe('Sous-tâches', …)` :

```js
  test('chaque racine porte le compte de ses étapes', async () => {
    const parentId = await parent();
    const faite = await request(app).post('/tasks').send({ title: 'Faite', parentId });
    await request(app).put(`/tasks/${faite.body._id}`).send({ completed: true });
    await request(app).post('/tasks').send({ title: 'À faire', parentId });

    const res = await request(app).get('/tasks?limit=50');
    const devis = res.body.tasks.find((t) => t.title === 'Devis');

    expect(devis.childCount).toBe(2);
    expect(devis.childDone).toBe(1);
  });

  test('une racine sans étape porte des compteurs à zéro, pas des champs absents', async () => {
    await parent('Seule');

    const res = await request(app).get('/tasks?limit=50');
    const seule = res.body.tasks.find((t) => t.title === 'Seule');

    expect(seule.childCount).toBe(0);
    expect(seule.childDone).toBe(0);
  });

  test('une étape à la corbeille ne compte plus', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Jetée', parentId });
    await request(app).delete(`/tasks/${etape.body._id}`);

    const res = await request(app).get('/tasks?limit=50');
    const devis = res.body.tasks.find((t) => t.title === 'Devis');

    expect(devis.childCount).toBe(0);
  });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Sous-tâches"
```

Attendu : ÉCHEC — `childCount` vaut `undefined`.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, ajouter après `SORT_FIELDS` :

```js
/**
 * Compte les étapes de chaque racine en une seule requête. Les compter côté
 * client demanderait un appel par ligne affichée ; les compter ici coûte un
 * `$lookup` sur un champ indexé.
 */
const CHILD_COUNTS = [
  {
    $lookup: {
      from: 'tasks',
      let: { racine: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$parentId', '$$racine'] }, deletedAt: null } },
        { $group: { _id: null, total: { $sum: 1 }, faites: { $sum: { $cond: ['$completed', 1, 0] } } } },
      ],
      as: 'etapes',
    },
  },
  {
    $addFields: {
      // `$ifNull` parce qu'une racine sans étape ne produit aucun groupe :
      // le tableau est alors vide, pas rempli de zéros
      childCount: { $ifNull: [{ $first: '$etapes.total' }, 0] },
      childDone: { $ifNull: [{ $first: '$etapes.faites' }, 0] },
    },
  },
];
```

Dans la route `GET /tasks`, remplacer le pipeline par :

```js
    const tasks = await Task.aggregate([
      { $match: filter },
      SORT_FIELDS,
      { $sort: SORTS[sort] },
      { $skip: skip },
      { $limit: limit },
      // le comptage vient après la pagination : compter les étapes de toute la
      // base pour n'en afficher cinq serait du travail jeté
      ...CHILD_COUNTS,
      { $project: { noDue: 0, priorityRank: 0, etapes: 0 } },
    ]);
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: compter les etapes de chaque racine dans la liste"
```

---

## Task 4 : cocher un parent coche ses étapes

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter **dans** le `describe('Sous-tâches', …)` :

```js
  test('cocher un parent coche toutes ses étapes', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).post('/tasks').send({ title: 'Deux', parentId });

    await request(app).put(`/tasks/${parentId}`).send({ completed: true });

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.every((t) => t.completed)).toBe(true);
  });

  test('décocher un parent décoche ses étapes', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).put(`/tasks/${parentId}`).send({ completed: true });

    await request(app).put(`/tasks/${parentId}`).send({ completed: false });

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.every((t) => t.completed)).toBe(false);
  });

  test('cocher la dernière étape ne coche pas le parent', async () => {
    const parentId = await parent();
    const seule = await request(app).post('/tasks').send({ title: 'Seule étape', parentId });

    await request(app).put(`/tasks/${seule.body._id}`).send({ completed: true });

    // un parent peut porter du travail propre au-delà de ses étapes : le
    // cocher à sa place serait décider pour l'utilisateur
    const apres = await request(app).get(`/tasks/${parentId}`);
    expect(apres.body.completed).toBe(false);
  });

  test('modifier autre chose que `completed` ne touche pas aux étapes', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).put(`/tasks/${parentId}`).send({ title: 'Devis revu' });

    const apres = await request(app).get(`/tasks/${etape.body._id}`);
    expect(apres.body.completed).toBe(false);
  });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Sous-tâches"
```

Attendu : ÉCHEC — les étapes restent décochées.

- [ ] **Step 3 : écrire l'implémentation**

Dans la route `PUT /tasks/:id`, juste avant `res.status(200).json(task);` :

```js
    // cocher un dossier coche ce qu'il contient ; l'inverse n'est pas vrai
    // (voir le test « cocher la dernière étape ne coche pas le parent »)
    if (Object.hasOwn(champs, 'completed') && !task.parentId) {
      await Task.updateMany(
        { parentId: task._id, deletedAt: null },
        { $set: { completed: champs.completed } }
      );
    }
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: cocher un parent coche ses etapes"
```

---

## Task 5 : la corbeille emporte et rend la famille

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter **dans** le `describe('Sous-tâches', …)` :

```js
  test('supprimer un parent envoie ses étapes à la corbeille avec lui', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).delete(`/tasks/${parentId}`);

    const corbeille = await request(app).get('/tasks/trash?limit=50');
    expect(corbeille.body.tasks.map((t) => t.title).sort()).toEqual(['Devis', 'Une']);
  });

  test('restaurer un parent ressort les étapes parties avec lui', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).delete(`/tasks/${parentId}`);

    await request(app).post(`/tasks/${parentId}/restore`);

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Une']);
  });

  test('restaurer un parent ne ressuscite pas une étape jetée avant lui', async () => {
    const parentId = await parent();
    const jeteeAvant = await request(app).post('/tasks').send({ title: 'Jetée avant', parentId });
    await request(app).post('/tasks').send({ title: 'Partie avec', parentId });

    await request(app).delete(`/tasks/${jeteeAvant.body._id}`);
    await request(app).delete(`/tasks/${parentId}`);
    await request(app).post(`/tasks/${parentId}/restore`);

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    // « Jetée avant » avait été supprimée pour de bon par l'utilisateur :
    // la ressortir serait annuler une décision qu'il a prise
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Partie avec']);
  });

  test('purger un parent purge ses étapes', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).delete(`/tasks/${parentId}`);

    await request(app).delete(`/tasks/${parentId}/purge`);

    const restante = await mongoose.connection
      .collection('tasks')
      .findOne({ _id: new mongoose.Types.ObjectId(etape.body._id) });
    expect(restante).toBeNull();
  });

  test('supprimer une étape seule ne touche pas au parent', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).delete(`/tasks/${etape.body._id}`);

    const apres = await request(app).get(`/tasks/${parentId}`);
    expect(apres.status).toBe(200);
  });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Sous-tâches"
```

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, remplacer le corps de `DELETE /tasks/:id` par une version qui pose le même
horodatage sur la famille. Repérer la route existante et remplacer sa ligne
`{ deletedAt: new Date() }` (ou équivalent) par le bloc suivant, en gardant le reste :

```js
app.delete('/tasks/:id', async (req, res) => {
  try {
    // un seul horodatage pour toute la famille : c'est lui qui distingue
    // « emportée par son parent » de « jetée pour elle-même », et qui permet
    // de ne ressortir que la première au moment de restaurer
    const quand = new Date();
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: quand },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });

    if (!task.parentId) {
      await Task.updateMany({ parentId: task._id, deletedAt: null }, { $set: { deletedAt: quand } });
    }

    res.status(200).json({ message: 'Tâche supprimée', task });
  } catch (error) {
    fail(res, error);
  }
});
```

> Si la route existante renvoie un autre message ou une autre forme, **garde la sienne** :
> des tests existants en dépendent. Seule la pose de `deletedAt` change.

Remplacer `POST /tasks/:id/restore` par :

```js
app.post('/tasks/:id/restore', async (req, res) => {
  try {
    const jetee = await Task.findOne({ _id: req.params.id, deletedAt: { $ne: null } }).lean();
    if (!jetee) return res.status(404).json({ error: 'Tâche non trouvée dans la corbeille' });

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id },
      { deletedAt: null },
      { new: true }
    );

    if (!jetee.parentId) {
      // seules les étapes parties AVEC ce parent reviennent : l'égalité de
      // l'horodatage est ce qui les distingue de celles jetées auparavant
      await Task.updateMany(
        { parentId: task._id, deletedAt: jetee.deletedAt },
        { $set: { deletedAt: null } }
      );
    }

    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});
```

Dans `DELETE /tasks/:id/purge`, juste après la suppression réussie et avant la réponse :

```js
    // une étape n'est atteignable qu'à travers son parent : la laisser en base
    // créerait un document que plus aucune vue ne montre
    await Task.deleteMany({ parentId: task._id });
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: la corbeille emporte et rend la famille entiere"
```

---

## Task 6 : les nouveaux champs survivent à un aller-retour

**Files:**
- Modify: `lib/portable.js`
- Test: `test/server/portable.test.js`, `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/server/portable.test.js`, dans `describe('validateImport', …)` :

```js
  test('retient les champs de structure ajoutés par la vague 2', () => {
    const { tasks } = validateImport({
      tasks: [
        task({
          parentId: '6aaa396cb6aaf45240b8b999',
          tags: ['maison'],
          order: 1234,
          recurrence: { freq: 'weekly', interval: 2, until: null },
          reminder: { offset: '1d', at: '2026-09-20T08:00:00.000Z', sentAt: null },
        }),
      ],
    });

    expect(tasks[0].parentId).toBe('6aaa396cb6aaf45240b8b999');
    expect(tasks[0].tags).toEqual(['maison']);
    expect(tasks[0].order).toBe(1234);
    expect(tasks[0].recurrence.freq).toBe('weekly');
    expect(tasks[0].reminder.offset).toBe('1d');
  });
```

Et à `test/api/server.test.js`, dans `describe('Export / import', …)` :

```js
  test('un aller-retour conserve la hiérarchie', async () => {
    const parentRes = await request(app).post('/tasks').send({ title: 'Devis' });
    await request(app)
      .post('/tasks')
      .send({ title: 'Verser l’acompte', parentId: parentRes.body._id });

    const avant = (await request(app).get('/export')).body;
    await request(app)
      .post('/import?mode=replace')
      .set('X-Confirm', 'replace')
      .send({ tasks: avant.tasks, categories: avant.categories });

    const etapes = await request(app).get(`/tasks/${parentRes.body._id}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Verser l’acompte']);
  });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api
```

Attendu : ÉCHEC — les champs sont écartés par la liste blanche, l'étape revient orpheline.

- [ ] **Step 3 : écrire l'implémentation**

Dans `lib/portable.js`, compléter `IMPORT_TASK_FIELDS` :

```js
const IMPORT_TASK_FIELDS = [
  '_id',
  'title',
  'description',
  'completed',
  'createdAt',
  'dueDate',
  'category',
  'priority',
  'deletedAt',
  // vague 2 — sans eux, réimporter une sauvegarde aplatirait la hiérarchie
  'parentId',
  'tags',
  'order',
  'recurrence',
  // vague 4
  'reminder',
];
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add lib/portable.js test/server/portable.test.js test/api/server.test.js
git commit -m "feat: la sauvegarde conserve la hierarchie et les nouveaux champs"
```

---

## Task 7 : les étapes dans l'interface

**Files:**
- Modify: `public/js/api.js`, `public/js/app.js`, `public/index.html`, `public/css/components.css`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Le faux serveur de `test/ui/app.test.js` doit d'abord savoir répondre aux étapes. Ajouter
dans le `beforeEach` qui construit `server`, à côté de `tasks` :

```js
    children: {},
```

et, dans la fonction qui aiguille les requêtes (celle qui reconnaît `/tasks?`, `/tasks/stats`,
`/tasks/trash`), ajouter une branche **avant** celle qui traite `/tasks/:id` :

```js
  if (/^\/tasks\/[^/]+\/children$/.test(path)) {
    const id = path.split('/')[2];
    return ok({ tasks: server.children[id] || [], total: (server.children[id] || []).length });
  }
```

Puis ajouter le bloc de tests :

```js
describe('étapes', () => {
  test('une tâche qui porte des étapes affiche leur compte', async () => {
    server.tasks = [task('Devis', { childCount: 3, childDone: 1 })];
    await boot();

    expect(document.querySelector('.task-steps-count').textContent).toMatch(/1\s*\/\s*3/);
  });

  test('une tâche sans étape n’affiche pas de compte', async () => {
    server.tasks = [task('Simple', { childCount: 0, childDone: 0 })];
    await boot();

    expect(document.querySelector('.task-steps-count')).toBeNull();
  });

  test('déplier une tâche demande ses étapes et les affiche', async () => {
    server.tasks = [task('Devis', { childCount: 1, childDone: 0 })];
    server.children['id-Devis'] = [task('Verser l’acompte', { parentId: 'id-Devis' })];
    await boot();

    document.querySelector('.task-steps-toggle').click();
    await settle();

    const titres = [...document.querySelectorAll('.step-title')].map((e) => e.textContent.trim());
    expect(titres).toEqual(['Verser l’acompte']);
  });

  test('replier masque les étapes sans les redemander', async () => {
    server.tasks = [task('Devis', { childCount: 1, childDone: 0 })];
    server.children['id-Devis'] = [task('Une', { parentId: 'id-Devis' })];
    await boot();

    document.querySelector('.task-steps-toggle').click();
    await settle();
    const appelsApresOuverture = calls().filter((u) => u.includes('/children')).length;

    document.querySelector('.task-steps-toggle').click();
    await settle();

    expect(document.querySelectorAll('.step-title')).toHaveLength(0);
    expect(calls().filter((u) => u.includes('/children'))).toHaveLength(appelsApresOuverture);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "étapes"
```

Attendu : ÉCHEC — `.task-steps-count` est `null`.

- [ ] **Step 3a : ajouter le client HTTP**

Dans `public/js/api.js`, à côté des autres exports :

```js
/** Étapes d'une tâche. Appelé au dépliage seulement : une liste n'en a pas besoin. */
export const listChildren = (id) => request(`/tasks/${id}/children`);
```

> Si le module nomme son helper autrement que `request`, utilise le sien.

- [ ] **Step 3b : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* --------------------------------- étapes --------------------------------- */

.task-steps-toggle {
  border: 0;
  background: none;
  padding: 0;
  font-family: var(--font-ui);
  font-size: var(--step-xs);
  color: var(--ink-soft);
  cursor: pointer;
}

.task-steps-count {
  font-family: var(--font-hand);
  font-size: 1.05rem;
  color: var(--ink-soft);
}

.step-list {
  list-style: none;
  margin: var(--gap-2) 0 0;
  padding: 0 0 0 var(--gap-4);
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  /* la marge gauche fait le lien visuel avec le dossier qui les porte */
  border-left: 1px dashed var(--rule-strong);
}

.step {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  font-size: var(--step-sm);
}

.step.is-done .step-title {
  color: var(--ink-faint);
  text-decoration: line-through;
}
```

- [ ] **Step 3c : brancher le rendu**

Dans `public/js/app.js`, dans la fonction qui construit une ligne de tâche, ajouter au bloc
`.task-meta` (après la date d'échéance) :

```js
      ${
        task.childCount > 0
          ? `<button type="button" class="task-steps-toggle" data-id="${task._id}">
               Étapes <span class="task-steps-count">${task.childDone} / ${task.childCount}</span>
             </button>`
          : ''
      }
```

Ajouter, après la déclaration de `render` :

```js
/** Étapes déjà chargées, par identifiant de parent. Le dépliage ne demande
    donc le serveur qu'une fois par tâche et par rendu. */
let stepsCache = {};

const renderSteps = (row, tasks) => {
  const liste = document.createElement('ul');
  liste.className = 'step-list';
  tasks.forEach((step) => {
    const li = document.createElement('li');
    li.className = `step${step.completed ? ' is-done' : ''}`;
    li.innerHTML = `<span class="step-title">${escapeHtml(step.title)}</span>`;
    liste.appendChild(li);
  });
  row.appendChild(liste);
  sketchAll(liste);
};

const toggleSteps = async (bouton) => {
  const row = bouton.closest('.task');
  const ouverte = row.querySelector('.step-list');
  if (ouverte) {
    unsketchAll(ouverte);
    ouverte.remove();
    return;
  }

  const id = bouton.dataset.id;
  try {
    if (!stepsCache[id]) {
      const { tasks } = await api.listChildren(id);
      stepsCache[id] = tasks || [];
    }
    renderSteps(row, stepsCache[id]);
  } catch (error) {
    toast(error.message, 'error');
  }
};
```

Dans le gestionnaire de clic délégué de la liste (ou, s'il n'y en a pas, en câblant chaque
bouton au moment du rendu), ajouter :

```js
  const steps = e.target.closest('.task-steps-toggle');
  if (steps) {
    toggleSteps(steps);
    return;
  }
```

Enfin, dans `render()`, avant de reconstruire la liste, vider le cache :

```js
  // une liste fraîchement rendue ne doit pas rouvrir sur des étapes périmées
  stepsCache = {};
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Créer une tâche, y ajouter une étape via l'API (`curl -X POST … -d '{"title":"…","parentId":"…"}'`),
recharger : le compte s'affiche, le dépliage montre l'étape, le repliage la masque.

- [ ] **Step 6 : committer**

```bash
git add public/ test/ui/app.test.js
git commit -m "feat: afficher et deplier les etapes d'une tache"
```

---

## Task 8 : documenter

**Files:**
- Modify: `README.md`

- [ ] **Step 1 : ajouter la fonctionnalité**

Dans « Fonctionnalités », après la ligne « Tâches » :

```markdown
- **Étapes** : une tâche porte des sous-tâches (un seul niveau) ; cocher le dossier coche ses
  étapes, la corbeille emporte et rend la famille entière
```

- [ ] **Step 2 : compléter le modèle de données**

Dans le bloc JSON de « Modèle de données », après `deletedAt` :

```json
  "parentId": "string | null",
  "tags": [],
  "order": 0,
  "recurrence": { "freq": "", "interval": 1, "until": null },
  "reminder": { "offset": "", "at": null, "sentAt": null }
```

Et sous le bloc :

```markdown
Les champs de structure sont installés par une migration idempotente au démarrage : une base
écrite avant leur existence les reçoit au premier lancement, et relancer le serveur ne réécrit
rien.
```

- [ ] **Step 3 : compléter le tableau de l'API**

```markdown
| `GET`    | `/tasks/:id/children`     | Étapes d'une tâche                             |
```

- [ ] **Step 4 : dire la limite de la recherche**

Sous le tableau des paramètres de `GET /tasks` :

```markdown
`GET /tasks` ne renvoie que les **racines** : compter les étapes rendrait la pagination
incohérente. Conséquence assumée, la recherche ne trouve pas une étape — chercher « acompte »
ne remonte pas l'étape « verser l'acompte » nichée sous « Devis ».
```

- [ ] **Step 5 : committer**

```bash
git add README.md
git commit -m "docs: documenter les etapes et la migration de schema"
```

---

## Vérification finale du chantier

- [ ] `npm test` — les deux suites vertes.
- [ ] `npm start` sur la vraie base : la migration s'annonce dans la console au premier
      lancement, et **ne dit plus rien au second**.
- [ ] Les 5 tâches existantes sont toujours là, intactes.
- [ ] `npm run backup` puis comparer avec `backups/cahier-2026-09-16T12-14-22.json` : mêmes
      titres, mêmes identifiants, les nouveaux champs en plus.
- [ ] `git log --oneline` — un commit par tâche.
