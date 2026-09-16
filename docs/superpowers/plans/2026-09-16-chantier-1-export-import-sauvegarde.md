# Chantier 1 — Export / import / sauvegarde : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** donner au Cahier de quoi sortir ses données et les remettre — pour qu'une base
corrompue, un dossier `data/db` effacé ou une migration ratée cessent d'être irréversibles.

**Architecture :** les formats de sortie (Markdown, CSV) et la validation d'import sont des
**fonctions pures**, isolées dans `lib/` et testées sans base ni serveur. `server.js` ne
gagne que quatre routes minces qui les appellent. Le script `npm run backup` n'ouvre pas la
base : il interroge le serveur en HTTP, parce que deux processus ne peuvent pas ouvrir le
même `dbPath` WiredTiger en même temps.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, Jest + Supertest. Aucune dépendance nouvelle.

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 3.1.

---

## Structure des fichiers

| Fichier                        | Rôle                                                                                | Chantier 1                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `lib/portable.js`              | Forme de l'export JSON, liste blanche et validation d'import — **aucun accès base** | **Créé**                                                                         |
| `lib/formats.js`               | Rendu Markdown et CSV — **fonctions pures**                                         | **Créé**                                                                         |
| `server.js`                    | API Express                                                                         | **Modifié** : `GET /export`, `GET /export.md`, `GET /export.csv`, `POST /import` |
| `scripts/backup.js`            | Dump horodaté via HTTP                                                              | **Créé**                                                                         |
| `package.json`                 | `npm run backup`, `testMatch` élargi à `test/server/`                               | **Modifié**                                                                      |
| `.gitignore`                   | ignorer `backups/`                                                                  | **Modifié**                                                                      |
| `test/server/portable.test.js` | Jest, unitaire, sans base                                                           | **Créé**                                                                         |
| `test/server/formats.test.js`  | Jest, unitaire, sans base                                                           | **Créé**                                                                         |
| `test/api/server.test.js`      | Jest + Supertest                                                                    | **Modifié** : les quatre routes                                                  |
| `README.md`                    | Documentation                                                                       | **Modifié**                                                                      |

**Pourquoi un dossier `lib/` et un dossier `test/server/`.** `server.js` est à 475 lignes ;
les quatre routes et leur validation lui en ajouteraient ~200, et surtout la validation
d'import mérite des tests unitaires qui ne montent ni Express ni Mongo. `test/api/` contient
des tests d'API ; des tests de fonctions pures n'y ont pas leur place, d'où `test/server/`
et une entrée `testMatch` supplémentaire.

---

## Décisions arrêtées avant d'écrire une ligne

**1. L'export contient `_id`, `createdAt` et `deletedAt`.** Le critère d'acceptation exige
qu'un export réimporté en `replace` reproduise la base **à l'identique**. C'est impossible
sans réintroduire les identifiants et les dates. La spec dit « validé par la même liste
blanche que les routes normales » : cette liste blanche-ci est donc un **sur-ensemble
explicite** de `CREATE_FIELDS`, réservé à l'import, et jamais atteignable par `POST /tasks`.
La validation reste champ par champ, via le schéma Mongoose.

**2. L'export contient la corbeille.** Une sauvegarde qui perd ce qui était restaurable
n'est pas une sauvegarde. Les tâches supprimées sortent avec leur `deletedAt`.

**3. `replace` écrit une sauvegarde automatique avant d'effacer.** Mongo tourne ici en
instance isolée, sans jeu de réplicas, donc **sans transaction** : « effacer puis insérer »
ne peut pas être atomique. La parade est en deux temps — tout valider avant d'écrire quoi que
ce soit, et déposer l'état courant dans `backups/` juste avant l'effacement. Si l'insertion
échoue malgré la validation, le fichier est là.

**4. `POST /import` a sa propre limite de corps.** Le serveur plafonne les corps JSON à
32 ko, ce qui est juste pour une tâche et absurde pour une base entière. `/import` reçoit son
propre `bodyParser` à 8 Mo, **monté avant** le global (body-parser ignore une requête dont le
corps est déjà lu).

**5. Le CSV est une sortie, pas une entrée.** Les cellules commençant par `=`, `+`, `-` ou
`@` sont préfixées d'une apostrophe : sans cela un tableur les exécute comme des formules.
Cela déforme la valeur, ce qui est acceptable pour un format qu'on ne réimporte jamais — le
format d'aller-retour, c'est le JSON.

**6. `npm run backup` passe par HTTP.** Le serveur détient le verrou WiredTiger sur
`data/db` ; un second processus qui tenterait d'ouvrir la base échouerait. Le script
interroge donc `GET /export` et dit clairement quoi faire si le serveur est éteint.

---

## Task 1 : forme de l'export et liste blanche d'import

**Files:**

- Create: `lib/portable.js`
- Create: `test/server/portable.test.js`
- Modify: `package.json` (champ `jest.testMatch`)

- [ ] **Step 1 : élargir `testMatch` pour que Jest voie `test/server/`**

Dans `package.json`, remplacer :

```json
  "jest": {
    "testMatch": [
      "<rootDir>/test/api/**/*.test.js"
    ]
  }
```

par :

```json
  "jest": {
    "testMatch": [
      "<rootDir>/test/api/**/*.test.js",
      "<rootDir>/test/server/**/*.test.js"
    ]
  }
```

- [ ] **Step 2 : écrire le test qui échoue**

Créer `test/server/portable.test.js` :

```js
const { SCHEMA_VERSION, exportShape, validateImport } = require('../../lib/portable');

const task = (extra = {}) => ({
  _id: '6aaa396cb6aaf45240b8b423',
  title: 'Relire le brief',
  description: '',
  completed: false,
  createdAt: '2026-09-10T08:00:00.000Z',
  dueDate: null,
  category: '',
  priority: '',
  deletedAt: null,
  ...extra,
});

describe('exportShape', () => {
  test('enveloppe les données avec une version de schéma', () => {
    const shape = exportShape({
      tasks: [task()],
      categories: [],
      now: new Date('2026-09-16T06:00:00Z'),
    });

    expect(shape.app).toBe('cahier');
    expect(shape.schemaVersion).toBe(SCHEMA_VERSION);
    expect(shape.exportedAt).toBe('2026-09-16T06:00:00.000Z');
    expect(shape.tasks).toHaveLength(1);
    expect(shape.categories).toEqual([]);
  });
});

describe('validateImport', () => {
  test('accepte une charge utile bien formée', () => {
    const result = validateImport({
      tasks: [task()],
      categories: [{ name: 'Perso', color: '#2f7d51' }],
    });

    expect(result.errors).toEqual([]);
    expect(result.tasks).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
  });

  test('refuse une charge utile qui n’est pas un objet', () => {
    expect(validateImport(null).errors[0]).toMatch(/objet/i);
    expect(validateImport('non').errors[0]).toMatch(/objet/i);
  });

  test('refuse des tâches qui ne sont pas un tableau', () => {
    expect(validateImport({ tasks: 'non' }).errors[0]).toMatch(/tableau/i);
  });

  test('signale la ligne fautive, pas seulement l’échec', () => {
    const { errors } = validateImport({ tasks: [task(), task({ title: '' })] });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tâche 2/i);
  });

  test('ne retient que les champs de la liste blanche', () => {
    const { tasks } = validateImport({ tasks: [task({ __proto__: undefined, injecte: 'oui' })] });

    expect(tasks[0]).not.toHaveProperty('injecte');
    // l'identifiant et les dates, eux, sont bien repris : sans eux l'aller-retour ment
    expect(tasks[0]._id).toBe('6aaa396cb6aaf45240b8b423');
    expect(tasks[0].createdAt).toBe('2026-09-10T08:00:00.000Z');
  });

  test('refuse plus de 10 000 tâches', () => {
    const { errors } = validateImport({ tasks: new Array(10001).fill(task()) });

    expect(errors[0]).toMatch(/10 000/);
  });

  test('refuse une catégorie sans couleur hexadécimale', () => {
    const { errors } = validateImport({ categories: [{ name: 'Perso', color: 'rouge' }] });

    expect(errors[0]).toMatch(/catégorie 1/i);
  });
});
```

- [ ] **Step 3 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/portable.test.js
```

Attendu : ÉCHEC — `Cannot find module '../../lib/portable'`.

- [ ] **Step 4 : écrire l'implémentation**

Créer `lib/portable.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — forme portable des données : ce qui sort dans un export, et ce
   qu'un import a le droit de faire entrer. Aucun accès à la base ici : ce
   module ne manipule que des objets simples, pour être testable seul.
   --------------------------------------------------------------------------- */

const SCHEMA_VERSION = 1;

/** Au-delà, ce n'est plus une sauvegarde de cahier personnel mais un déni de service. */
const MAX_TASKS = 10000;
const MAX_CATEGORIES = 500;

/**
 * Liste blanche d'import : sur-ensemble assumé de CREATE_FIELDS.
 * `_id`, `createdAt` et `deletedAt` en font partie — sans eux, réimporter un
 * export ne reproduit pas la base, et le critère d'acceptation du chantier
 * tombe. Ces champs restent inatteignables par POST /tasks.
 */
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
];

const IMPORT_CATEGORY_FIELDS = ['_id', 'name', 'color'];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Reprend les seuls champs listés, en ignorant tout le reste. */
const pickFields = (source, fields) =>
  fields.reduce(
    (acc, field) => (source?.[field] === undefined ? acc : { ...acc, [field]: source[field] }),
    {}
  );

/** Enveloppe d'export : les données, plus de quoi les relire dans dix ans. */
const exportShape = ({ tasks, categories, now = new Date() }) => ({
  app: 'cahier',
  schemaVersion: SCHEMA_VERSION,
  exportedAt: new Date(now).toISOString(),
  tasks,
  categories,
});

/**
 * Valide une charge utile d'import sans rien écrire.
 * @returns {{tasks: object[], categories: object[], errors: string[]}}
 *   `errors` vide signifie « prêt à écrire ». Sinon, rien ne doit être écrit :
 *   un import est tout ou rien.
 */
const validateImport = (payload) => {
  const errors = [];
  const empty = { tasks: [], categories: [], errors };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('Charge utile invalide : un objet est attendu.');
    return empty;
  }

  const rawTasks = payload.tasks === undefined ? [] : payload.tasks;
  const rawCategories = payload.categories === undefined ? [] : payload.categories;

  if (!Array.isArray(rawTasks)) {
    errors.push('Champ « tasks » invalide : un tableau est attendu.');
    return empty;
  }
  if (!Array.isArray(rawCategories)) {
    errors.push('Champ « categories » invalide : un tableau est attendu.');
    return empty;
  }
  if (rawTasks.length > MAX_TASKS) {
    errors.push(`Trop de tâches : ${rawTasks.length} pour un maximum de 10 000.`);
    return empty;
  }
  if (rawCategories.length > MAX_CATEGORIES) {
    errors.push(`Trop de catégories : ${rawCategories.length} pour un maximum de 500.`);
    return empty;
  }

  const tasks = rawTasks.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_TASK_FIELDS);
    // le titre est le seul champ sans lequel une tâche n'existe pas ; le reste
    // est laissé au schéma Mongoose, qui sait déjà le valider
    if (typeof kept.title !== 'string' || kept.title.trim() === '') {
      errors.push(`Tâche ${index + 1} : titre manquant.`);
    }
    return kept;
  });

  const categories = rawCategories.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_CATEGORY_FIELDS);
    if (typeof kept.name !== 'string' || kept.name.trim() === '') {
      errors.push(`Catégorie ${index + 1} : nom manquant.`);
    }
    if (typeof kept.color !== 'string' || !HEX_COLOR.test(kept.color)) {
      errors.push(`Catégorie ${index + 1} : couleur invalide (format #rgb ou #rrggbb attendu).`);
    }
    return kept;
  });

  return { tasks, categories, errors };
};

module.exports = {
  SCHEMA_VERSION,
  MAX_TASKS,
  MAX_CATEGORIES,
  IMPORT_TASK_FIELDS,
  IMPORT_CATEGORY_FIELDS,
  exportShape,
  validateImport,
};
```

- [ ] **Step 5 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/portable.test.js
```

Attendu : SUCCÈS, 8 tests.

- [ ] **Step 6 : committer**

```bash
git add lib/portable.js test/server/portable.test.js package.json
git commit -m "feat: forme portable des donnees et validation d'import"
```

---

## Task 2 : route `GET /export`

**Files:**

- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `test/api/server.test.js`, comme nouveau bloc de premier niveau :

```js
describe('Export / import', () => {
  const seed = async () => {
    await request(app).post('/categories').send({ name: 'Perso', color: '#2f7d51' });
    const vivante = await request(app)
      .post('/tasks')
      .send({ title: 'Relire le brief', category: 'Perso', priority: 'high' });
    const jetee = await request(app).post('/tasks').send({ title: 'Ancienne' });
    await request(app).delete(`/tasks/${jetee.body._id}`);
    return { vivante: vivante.body, jetee: jetee.body };
  };

  test('GET /export renvoie tâches, catégories et version de schéma', async () => {
    await seed();

    const res = await request(app).get('/export');

    expect(res.status).toBe(200);
    expect(res.body.app).toBe('cahier');
    expect(res.body.schemaVersion).toBe(1);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(res.body.categories.map((c) => c.name)).toEqual(['Perso']);
    // la corbeille fait partie de la sauvegarde : la perdre, c'est perdre
    // exactement ce qui était encore récupérable
    expect(res.body.tasks.map((t) => t.title).sort()).toEqual(['Ancienne', 'Relire le brief']);
  });

  test('GET /export conserve identifiants et dates, sans quoi l’aller-retour ment', async () => {
    const { vivante } = await seed();

    const res = await request(app).get('/export');
    const trouvee = res.body.tasks.find((t) => t.title === 'Relire le brief');

    expect(trouvee._id).toBe(vivante._id);
    expect(trouvee.createdAt).toBe(vivante.createdAt);
    expect(trouvee.deletedAt).toBeNull();
  });

  test('GET /export propose un nom de fichier au navigateur', async () => {
    const res = await request(app).get('/export');

    expect(res.headers['content-disposition']).toMatch(/attachment; filename="cahier-.*\.json"/);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- -t "Export / import"
```

Attendu : ÉCHEC — 404, `res.body.app` vaut `undefined`.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, en tête de fichier, après `require('dotenv').config();` :

```js
const { exportShape, validateImport } = require('./lib/portable');
```

Puis, **juste avant** le bloc de commentaire `/* ---- Catégories ---- */`, ajouter :

```js
/* --------------------------------------------------------------------------
   Export / import
   -------------------------------------------------------------------------- */

/** Horodatage de nom de fichier : 2026-09-16T08-42-11, trié correctement à plat. */
const fileStamp = (date = new Date()) => date.toISOString().replace(/:/g, '-').slice(0, 19);

/**
 * Sauvegarde complète : tâches (corbeille comprise) et catégories, avec leurs
 * identifiants et leurs dates. C'est la seule forme qui se réimporte à
 * l'identique.
 */
const collectExport = async () => {
  const [tasks, categories] = await Promise.all([
    Task.find().sort({ createdAt: 1, _id: 1 }).lean(),
    Category.find().sort({ name: 1 }).lean(),
  ]);
  return exportShape({ tasks, categories });
};

app.get('/export', async (req, res) => {
  try {
    const payload = await collectExport();
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.json"`);
    res.status(200).json(payload);
  } catch (error) {
    fail(res, error);
  }
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm run test:api -- -t "Export / import"
```

Attendu : SUCCÈS, 3 tests.

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: export JSON complet de la base"
```

---

## Task 3 : route `POST /import`

**Files:**

- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter **dans** le `describe('Export / import', …)` créé à la task 2 :

```js
test('POST /import en mode merge ajoute sans écraser l’existant', async () => {
  await seed();
  const avant = (await request(app).get('/export')).body;

  const res = await request(app)
    .post('/import')
    .send({
      mode: 'merge',
      tasks: [{ title: 'Venue de la sauvegarde' }],
      categories: [{ name: 'Travail', color: '#1f2f5c' }],
    });

  expect(res.status).toBe(200);
  const apres = (await request(app).get('/export')).body;
  expect(apres.tasks).toHaveLength(avant.tasks.length + 1);
  expect(apres.categories.map((c) => c.name)).toEqual(['Perso', 'Travail']);
});

test('POST /import en mode replace exige un en-tête de confirmation', async () => {
  await seed();

  const res = await request(app).post('/import').send({ mode: 'replace', tasks: [] });

  expect(res.status).toBe(428);
  expect(res.body.error).toMatch(/confirm/i);
  // et surtout : rien n'a été effacé
  const apres = (await request(app).get('/export')).body;
  expect(apres.tasks).toHaveLength(2);
});

test('un export réimporté en replace reproduit la base à l’identique', async () => {
  await seed();
  const avant = (await request(app).get('/export')).body;

  // on abîme la base entre les deux : sans cela le test passerait sans rien faire
  await request(app).post('/tasks').send({ title: 'Intrus' });
  await request(app).post('/categories').send({ name: 'Intruse', color: '#c8402f' });

  const res = await request(app)
    .post('/import')
    .set('X-Confirm', 'replace')
    .send({ mode: 'replace', tasks: avant.tasks, categories: avant.categories });

  expect(res.status).toBe(200);
  const apres = (await request(app).get('/export')).body;
  expect(apres.tasks).toEqual(avant.tasks);
  expect(apres.categories).toEqual(avant.categories);
});

test('un import malformé est refusé sans rien écrire', async () => {
  await seed();
  const avant = (await request(app).get('/export')).body;

  const res = await request(app)
    .post('/import')
    .set('X-Confirm', 'replace')
    .send({ mode: 'replace', tasks: [{ title: 'Correcte' }, { title: '' }] });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/tâche 2/i);
  const apres = (await request(app).get('/export')).body;
  expect(apres.tasks).toEqual(avant.tasks);
});

test('POST /import rejette un mode inconnu', async () => {
  const res = await request(app).post('/import').send({ mode: 'ecraser', tasks: [] });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/mode/i);
});

test('un replace dépose une sauvegarde avant d’effacer', async () => {
  await seed();

  await request(app)
    .post('/import')
    .set('X-Confirm', 'replace')
    .send({ mode: 'replace', tasks: [{ title: 'Seule survivante' }] });

  const fichiers = fs.readdirSync(process.env.BACKUP_DIR);
  expect(fichiers.some((f) => f.startsWith('avant-remplacement-'))).toBe(true);
  const depose = JSON.parse(
    fs.readFileSync(
      path.join(
        process.env.BACKUP_DIR,
        fichiers.find((f) => f.startsWith('avant-remplacement-'))
      ),
      'utf8'
    )
  );
  expect(depose.tasks).toHaveLength(2);
});
```

En tête du fichier de test, après les `require` existants, ajouter :

```js
const fs = require('fs');
const path = require('path');
const os = require('os');

// les sauvegardes automatiques ne doivent pas atterrir dans le dépôt
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cahier-backups-'));
```

L'ordre n'a pas d'importance ici : `writeBackup` relit `process.env.BACKUP_DIR` à chaque
appel, précisément pour que ce réglage ne dépende pas de la position des `require`.

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Export / import"
```

Attendu : ÉCHEC — `POST /import` répond 404.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, **avant** la ligne `app.use(bodyParser.json({ limit: '32kb' }));`, ajouter :

```js
// une sauvegarde entière ne tient pas dans la limite prévue pour une tâche.
// Monté avant le parseur global, qui laissera passer une requête déjà lue.
app.use('/import', bodyParser.json({ limit: '8mb' }));
```

Puis, à la suite de la route `GET /export` écrite à la task 2 :

```js
/**
 * Dépose un instantané sur disque et renvoie son chemin.
 * Le dossier est relu à chaque appel, et non figé au chargement du module :
 * sinon la valeur dépendrait de l'ordre des `require` dans les tests, qui
 * doivent pouvoir écrire ailleurs que dans le dépôt.
 */
const writeBackup = (prefix, payload) => {
  const dir = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${prefix}-${fileStamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
};

/**
 * Remise en base d'une sauvegarde.
 *
 * `merge` ajoute sans toucher à l'existant ; `replace` reconstruit la base.
 * Mongo tourne ici sans jeu de réplicas, donc sans transaction : l'atomicité
 * est obtenue autrement — tout est validé avant la moindre écriture, et un
 * `replace` dépose l'état courant dans BACKUP_DIR juste avant d'effacer.
 */
app.post('/import', async (req, res) => {
  try {
    // le mode se donne en query ou dans le corps : un fichier d'export ne
    // contient pas de « mode », et il ne faut pas obliger à le rouvrir pour
    // l'y glisser avant de le remettre
    const mode = asString(req.query?.mode, 16) || asString(req.body?.mode, 16) || 'merge';
    if (mode !== 'merge' && mode !== 'replace') {
      return res.status(400).json({ error: 'Mode inconnu : « merge » ou « replace » attendu.' });
    }
    // un effacement complet ne doit pas tenir dans une requête qu'on lance par mégarde
    if (mode === 'replace' && req.get('X-Confirm') !== 'replace') {
      return res
        .status(428)
        .json({ error: 'Remplacement refusé : en-tête X-Confirm: replace requis.' });
    }

    const { tasks, categories, errors } = validateImport(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.slice(0, 5).join(' · ') });
    }

    // seconde barrière : le schéma Mongoose relit chaque document, toujours
    // sans écrire — un import est tout ou rien
    const taskDocs = tasks.map((raw) => new Task(raw));
    const categoryDocs = categories.map((raw) => new Category(raw));
    for (const [index, doc] of taskDocs.entries()) {
      const invalid = doc.validateSync();
      if (invalid)
        return res.status(400).json({ error: `Tâche ${index + 1} : ${invalid.message}` });
    }
    for (const [index, doc] of categoryDocs.entries()) {
      const invalid = doc.validateSync();
      if (invalid) {
        return res.status(400).json({ error: `Catégorie ${index + 1} : ${invalid.message}` });
      }
    }

    let backup = null;
    if (mode === 'replace') {
      backup = writeBackup('avant-remplacement', await collectExport());
      await Promise.all([Task.deleteMany({}), Category.deleteMany({})]);
      await Task.insertMany(taskDocs);
      await Category.insertMany(categoryDocs);
    } else {
      // merge : on n'écrase jamais, on complète. Un identifiant ou un nom déjà
      // pris est laissé tel qu'il est en base.
      // un doublon n'est pas une erreur ici : c'est une entrée déjà en base,
      // qu'on laisse telle quelle. Une écriture en lot signale ses doublons
      // dans `writeErrors` plutôt que dans un `code` de premier niveau.
      const ignorerDoublons = (e) => {
        const doublon =
          e.code === 11000 || (e.writeErrors || []).every((w) => w.err?.code === 11000);
        if (!doublon) throw e;
      };
      await Task.insertMany(taskDocs, { ordered: false }).catch(ignorerDoublons);
      await Category.insertMany(categoryDocs, { ordered: false }).catch(ignorerDoublons);
    }

    res.status(200).json({
      message: mode === 'replace' ? 'Base remplacée' : 'Sauvegarde fusionnée',
      tasks: taskDocs.length,
      categories: categoryDocs.length,
      backup,
    });
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
git commit -m "feat: import d'une sauvegarde, en fusion ou en remplacement confirme"
```

---

## Task 4 : `GET /export.md` et `GET /export.csv`

**Files:**

- Create: `lib/formats.js`
- Create: `test/server/formats.test.js`
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test unitaire qui échoue**

Créer `test/server/formats.test.js` :

```js
const { toMarkdown, toCsv, csvCell } = require('../../lib/formats');

const task = (extra = {}) => ({
  _id: 'id-1',
  title: 'Relire le brief',
  description: '',
  completed: false,
  createdAt: '2026-09-10T08:00:00.000Z',
  dueDate: null,
  category: '',
  priority: '',
  deletedAt: null,
  ...extra,
});

describe('toMarkdown', () => {
  test('groupe par catégorie et coche ce qui est fait', () => {
    const md = toMarkdown([
      task({ title: 'Courses', category: 'Perso' }),
      task({ title: 'Brief', category: 'Travail', completed: true }),
    ]);

    expect(md).toContain('## Perso');
    expect(md).toContain('- [ ] Courses');
    expect(md).toContain('## Travail');
    expect(md).toContain('- [x] Brief');
  });

  test('range les tâches sans catégorie sous un intitulé explicite', () => {
    expect(toMarkdown([task()])).toContain('## Sans catégorie');
  });

  test('affiche l’échéance quand il y en a une', () => {
    const md = toMarkdown([task({ dueDate: '2026-12-25T09:00:00.000Z' })]);
    expect(md).toMatch(/— échéance 2026-12-25/);
  });

  test('laisse la corbeille dehors', () => {
    const md = toMarkdown([task({ title: 'Jetée', deletedAt: '2026-09-15T08:00:00.000Z' })]);
    expect(md).not.toContain('Jetée');
  });
});

describe('csvCell', () => {
  test('entoure de guillemets ce qui contient une virgule, un guillemet ou un saut de ligne', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(csvCell('deux\nlignes')).toBe('"deux\nlignes"');
  });

  test('neutralise une cellule que le tableur exécuterait comme une formule', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+33612345678')).toBe("'+33612345678");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@import')).toBe("'@import");
  });
});

describe('toCsv', () => {
  test('écrit un en-tête stable puis une ligne par tâche', () => {
    const lignes = toCsv([task({ title: 'Courses, urgentes' })]).split('\n');

    expect(lignes[0]).toBe(
      'id,title,description,completed,priority,category,dueDate,createdAt,deletedAt'
    );
    expect(lignes[1]).toContain('"Courses, urgentes"');
    expect(lignes).toHaveLength(2);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/formats.test.js
```

Attendu : ÉCHEC — `Cannot find module '../../lib/formats'`.

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/formats.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — rendus lisibles : le cahier en Markdown, la base en CSV.
   Fonctions pures, sans base ni serveur.
   --------------------------------------------------------------------------- */

const SANS_CATEGORIE = 'Sans catégorie';

/** Jour seul : l'heure n'apporte rien à une liste qu'on relit. */
const jour = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * Le cahier en Markdown, groupé par catégorie.
 * La corbeille reste dehors : c'est une lecture, pas une sauvegarde.
 */
const toMarkdown = (tasks) => {
  const vivantes = tasks.filter((t) => !t.deletedAt);
  const groupes = new Map();

  vivantes.forEach((task) => {
    const clef = task.category || SANS_CATEGORIE;
    if (!groupes.has(clef)) groupes.set(clef, []);
    groupes.get(clef).push(task);
  });

  const blocs = [...groupes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([categorie, liste]) => {
      const lignes = liste.map((task) => {
        const case_ = task.completed ? '- [x]' : '- [ ]';
        const echeance = task.dueDate ? ` — échéance ${jour(task.dueDate)}` : '';
        return `${case_} ${task.title}${echeance}`;
      });
      return `## ${categorie}\n\n${lignes.join('\n')}`;
    });

  return `# Cahier\n\n${blocs.join('\n\n')}\n`;
};

const CSV_COLUMNS = [
  'id',
  'title',
  'description',
  'completed',
  'priority',
  'category',
  'dueDate',
  'createdAt',
  'deletedAt',
];

/**
 * Échappement RFC 4180, plus une neutralisation : une cellule qui commence par
 * `=`, `+`, `-` ou `@` est exécutée comme une formule par les tableurs. On la
 * préfixe d'une apostrophe. Cela déforme la valeur — acceptable pour un format
 * qu'on ne réimporte jamais, le JSON étant le format d'aller-retour.
 */
const csvCell = (value) => {
  const texte = value === null || value === undefined ? '' : String(value);
  const sûr = /^[=+\-@]/.test(texte) ? `'${texte}` : texte;
  return /[",\n]/.test(sûr) ? `"${sûr.replace(/"/g, '""')}"` : sûr;
};

const toCsv = (tasks) => {
  const lignes = tasks.map((task) =>
    [
      task._id,
      task.title,
      task.description,
      task.completed,
      task.priority,
      task.category,
      task.dueDate ? new Date(task.dueDate).toISOString() : '',
      task.createdAt ? new Date(task.createdAt).toISOString() : '',
      task.deletedAt ? new Date(task.deletedAt).toISOString() : '',
    ]
      .map(csvCell)
      .join(',')
  );

  return [CSV_COLUMNS.join(','), ...lignes].join('\n');
};

module.exports = { SANS_CATEGORIE, CSV_COLUMNS, toMarkdown, toCsv, csvCell };
```

- [ ] **Step 4 : lancer le test unitaire pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/formats.test.js
```

Attendu : SUCCÈS, 8 tests.

- [ ] **Step 5 : écrire le test des deux routes**

Ajouter **dans** le `describe('Export / import', …)` :

```js
test('GET /export.md rend le cahier en Markdown', async () => {
  await seed();

  const res = await request(app).get('/export.md');

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/markdown/);
  expect(res.text).toContain('## Perso');
  expect(res.text).toContain('- [ ] Relire le brief');
  expect(res.text).not.toContain('Ancienne');
});

test('GET /export.csv rend un tableau à colonnes stables', async () => {
  await seed();

  const res = await request(app).get('/export.csv');

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  expect(res.text.split('\n')[0]).toBe(
    'id,title,description,completed,priority,category,dueDate,createdAt,deletedAt'
  );
});
```

- [ ] **Step 6 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Export / import"
```

Attendu : ÉCHEC — les deux routes répondent 404.

- [ ] **Step 7 : brancher les deux routes**

Dans `server.js`, ajouter l'import en tête, à côté de celui de `portable` :

```js
const { toMarkdown, toCsv } = require('./lib/formats');
```

Puis, à la suite de `POST /import` :

```js
app.get('/export.md', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ category: 1, createdAt: 1 }).lean();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.md"`);
    res.status(200).send(toMarkdown(tasks));
  } catch (error) {
    fail(res, error);
  }
});

app.get('/export.csv', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: 1, _id: 1 }).lean();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.csv"`);
    res.status(200).send(toCsv(tasks));
  } catch (error) {
    fail(res, error);
  }
});
```

- [ ] **Step 8 : lancer toute la suite**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 9 : committer**

```bash
git add lib/formats.js test/server/formats.test.js server.js test/api/server.test.js
git commit -m "feat: exports lisibles en Markdown et en CSV"
```

---

## Task 5 : `npm run backup`

**Files:**

- Create: `scripts/backup.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1 : ignorer le dossier des sauvegardes**

Ajouter à la fin de `.gitignore` :

```
backups/
```

- [ ] **Step 2 : écrire le script**

Créer `scripts/backup.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — sauvegarde horodatée.

   Le script n'ouvre pas la base : quand le serveur tourne, il détient le
   verrou WiredTiger sur data/db et un second processus échouerait. On passe
   donc par l'API, et on le dit clairement si le serveur est éteint.
   --------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const port = parseInt(process.env.PORT, 10) || 3000;
const host = process.env.HOST || '127.0.0.1';
const dossier = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

const stamp = () => new Date().toISOString().replace(/:/g, '-').slice(0, 19);

(async () => {
  const url = `http://${host}:${port}/export`;
  let payload;

  try {
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error(`réponse ${reponse.status}`);
    payload = await reponse.json();
  } catch (error) {
    console.error(`Sauvegarde impossible : ${url} est injoignable (${error.message}).`);
    console.error('Lance le serveur (« npm start ») dans un autre terminal, puis réessaie.');
    process.exit(1);
  }

  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `cahier-${stamp()}.json`);
  fs.writeFileSync(fichier, JSON.stringify(payload, null, 2), 'utf8');

  const poids = (fs.statSync(fichier).size / 1024).toFixed(1);
  console.log(`Sauvegarde écrite : ${fichier}`);
  console.log(
    `${payload.tasks.length} tâche(s), ${payload.categories.length} catégorie(s), ${poids} ko`
  );
})();
```

- [ ] **Step 3 : déclarer le script**

Dans `package.json`, ajouter à `scripts`, après `"start"` :

```json
    "backup": "node scripts/backup.js",
```

- [ ] **Step 4 : vérifier le message d'erreur, serveur éteint**

Serveur arrêté :

```bash
npm run backup
```

Attendu : ÉCHEC explicite, code de sortie 1, message « … est injoignable » suivi de la
consigne de lancer le serveur. **Aucune trace de pile.**

- [ ] **Step 5 : vérifier le cas nominal, serveur allumé**

Dans un terminal : `npm start`. Dans un autre :

```bash
npm run backup
ls backups/
```

Attendu : un fichier `cahier-2026-09-16T08-42-11.json`, et un récapitulatif chiffré.
Vérifier que le JSON s'ouvre et contient bien `tasks` et `categories`.

- [ ] **Step 6 : committer**

```bash
git add scripts/backup.js package.json .gitignore
git commit -m "feat: script de sauvegarde horodatee"
```

---

## Task 6 : bouton « Sauvegarder » dans l'interface

> **Cette tâche dépasse la spec § 3.1, qui ne demande que des routes et un script.** Elle est
> ici parce qu'une sauvegarde qu'on ne peut déclencher qu'en ligne de commande ne sera pas
> faite, et qu'une protection qu'on n'utilise pas ne protège rien. Elle est la dernière du
> chantier : la retirer ne casse rien de ce qui précède.

**Files:**

- Modify: `public/index.html`
- Modify: `public/css/components.css`
- Modify: `public/js/palette.js`

- [ ] **Step 1 : ajouter le lien de téléchargement**

Dans `public/index.html`, dans le panneau « Statut » de la barre latérale, juste après le
bouton `id="open-trash"` :

```html
<a
  class="btn side-action"
  id="export-link"
  href="/export"
  download
  data-sketch="button"
  data-tone="neutral"
  >Sauvegarder</a
>
```

- [ ] **Step 2 : styler le lien comme le bouton voisin**

Ajouter à la fin de `public/css/components.css` :

```css
.side-action {
  display: block;
  margin-top: var(--gap-1);
  text-align: center;
  text-decoration: none;
}
```

- [ ] **Step 3 : ajouter la commande à la palette**

Dans `public/js/palette.js`, ajouter une entrée à la fin de `PALETTE_COMMANDS` :

```js
    { label: 'Sauvegarder le cahier', run: () => document.getElementById('export-link').click() },
```

- [ ] **Step 4 : ajuster le test de comptage des commandes**

`test/ui/app.test.js` vérifie que la palette liste **8** commandes. Elle en listera **9**.
Remplacer dans le test « la palette liste ses commandes » :

```js
expect(nbCmd).toBe(8);
```

par :

```js
expect(nbCmd).toBe(9);
```

C'est le seul test existant que ce chantier a le droit de modifier, et uniquement parce que
le nombre de commandes est précisément ce qui change.

- [ ] **Step 5 : lancer toute la suite**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 6 : vérifier à l'œil**

```bash
npm start
```

Cliquer « Sauvegarder » : le navigateur télécharge `cahier-….json`. Ouvrir le fichier,
vérifier qu'il contient les tâches. `Ctrl+K`, taper « sauve », valider : même résultat.

- [ ] **Step 7 : committer**

```bash
git add public/index.html public/css/components.css public/js/palette.js test/ui/app.test.js
git commit -m "feat: bouton et commande de sauvegarde dans l'interface"
```

---

## Task 7 : documenter

**Files:**

- Modify: `README.md`

- [ ] **Step 1 : compléter le tableau de l'API**

Ajouter, après la ligne `DELETE /tasks/:id/purge` :

```markdown
| `GET` | `/export` | Sauvegarde JSON complète (corbeille comprise) |
| `GET` | `/export.md` | Le cahier en Markdown, groupé par catégorie |
| `GET` | `/export.csv` | Tableau CSV à colonnes stables |
| `POST` | `/import` | Remet une sauvegarde (`merge` ou `replace`) |
```

- [ ] **Step 2 : ajouter une section « Sauvegarde »**

Insérer avant la section « Tests » :

````markdown
## Sauvegarde

```bash
npm run backup     # écrit backups/cahier-<horodatage>.json (serveur allumé)
```
````

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
`backups/` avant d'effacer**. Un import est tout ou rien : une seule ligne invalide et rien
n'est écrit.

`export.csv` neutralise les cellules commençant par `=`, `+`, `-` ou `@` en les préfixant
d'une apostrophe — sans quoi un tableur les exécuterait comme des formules. C'est pourquoi le
format d'aller-retour est le JSON, pas le CSV.

```

- [ ] **Step 3 : compléter l'arborescence**

Dans le bloc « Structure », après la ligne `├── public/…`, ajouter :

```

├── lib/
│ ├── portable.js # Forme de l'export, liste blanche d'import
│ └── formats.js # Rendus Markdown et CSV (fonctions pures)
├── scripts/backup.js # Sauvegarde horodatée via l'API
├── backups/ # Sauvegardes (ignoré par git)

```

Et sous `test/` :

```

│ ├── server/*.test.js # Jest, unitaire, sans base

````

- [ ] **Step 4 : committer**

```bash
git add README.md
git commit -m "docs: documenter la sauvegarde, l'import et les exports lisibles"
````

---

## Vérification finale du chantier

- [ ] `npm test` — les deux suites vertes.
- [ ] `npm start`, puis le parcours complet : cliquer « Sauvegarder », abîmer la base
      (créer et supprimer des tâches), réimporter le fichier en `replace`, vérifier que la
      base est revenue à l'identique.
- [ ] `npm run backup` serveur éteint → message clair, code 1, aucune trace de pile.
- [ ] Ouvrir `export.csv` dans un tableur : aucune cellule ne s'exécute.
- [ ] `git log --oneline` — un commit par tâche, aucun commit qui mélange deux sujets.
- [ ] Relire `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 3.1 et
      « Critères d'acceptation — Vague 3 », et cocher les deux lignes qui concernent l'import.
