# Chantier 2c — Étiquettes : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pouvoir marquer une tâche de plusieurs mots-clés transversaux, là où la catégorie
reste un classement unique.

**Architecture :** la normalisation des étiquettes est une **fonction pure** dans `lib/`. Le
serveur l'applique au moment d'écrire et gagne un filtre `tag` dans le `buildFilter` existant.
L'interface réutilise la saisie rapide : `#maison` pose déjà une catégorie, `+maison` posera
une étiquette.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, JS vanilla, Jest + Supertest, Vitest.
Le champ `tags` est déjà en base (migration du chantier 2a).

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 2.3.

---

## Décisions arrêtées avant d'écrire une ligne

**1. Les étiquettes sont normalisées à l'écriture, pas à la lecture.** Minuscules, espaces
rognés, doublons écartés, 24 caractères maximum, 10 étiquettes maximum. Normaliser à la lecture
obligerait chaque filtre et chaque compteur à refaire le travail, et `Maison` ne retrouverait
pas `maison`.

**2. Une étiquette vide ou faite d'espaces est écartée en silence, pas refusée.** Contrairement
à une récurrence sans échéance, ce n'est pas une intention mal formée : c'est une virgule en
trop dans une saisie. La rejeter ferait échouer toute la tâche pour une broutille.

**3. Le séparateur de saisie rapide est `+`, pas `#`.** `#` est déjà pris par la catégorie, et
changer sa signification casserait ce que l'utilisateur a appris au chantier précédent.

**4. La catégorie reste le classement principal.** Une seule, colorée, dans la marge. Les
étiquettes sont transversales et ne portent pas de couleur : les colorier ferait deux systèmes
de classement concurrents dans la même vue.

---

## Task 1 : normaliser une liste d'étiquettes

**Files:**

- Create: `lib/tags.js`
- Create: `test/server/tags.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/server/tags.test.js` :

```js
const { normalizeTags, MAX_TAGS, MAX_TAG_LENGTH } = require('../../lib/tags');

describe('normalizeTags', () => {
  test('met en minuscules et rogne les espaces', () => {
    expect(normalizeTags([' Maison ', 'COURSES'])).toEqual(['maison', 'courses']);
  });

  test('écarte les doublons, quelle que soit la casse', () => {
    expect(normalizeTags(['maison', 'Maison', 'MAISON'])).toEqual(['maison']);
  });

  test('écarte les entrées vides sans faire échouer le reste', () => {
    // une virgule en trop dans une saisie n'est pas une intention mal formée
    expect(normalizeTags(['maison', '', '   ', 'courses'])).toEqual(['maison', 'courses']);
  });

  test('tronque une étiquette trop longue plutôt que de la refuser', () => {
    const longue = 'a'.repeat(40);
    expect(normalizeTags([longue])[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  test('garde les dix premières et laisse tomber le reste', () => {
    const douze = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    expect(normalizeTags(douze)).toHaveLength(MAX_TAGS);
  });

  test('ce qui n’est pas un tableau donne une liste vide', () => {
    expect(normalizeTags('maison')).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  test('ce qui n’est pas une chaîne dans le tableau est écarté', () => {
    expect(normalizeTags(['maison', 42, null, { $ne: null }])).toEqual(['maison']);
  });

  test('l’ordre de première apparition est conservé', () => {
    expect(normalizeTags(['b', 'a', 'b'])).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/tags.test.js
```

Attendu : ÉCHEC — `Cannot find module '../../lib/tags'`.

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/tags.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — étiquettes : normalisation. Fonction pure, appliquée à l'écriture.

   Normaliser à la lecture obligerait chaque filtre et chaque compteur à
   refaire le travail, et « Maison » ne retrouverait jamais « maison ».
   --------------------------------------------------------------------------- */

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 24;

/**
 * Ramène une liste d'étiquettes à sa forme canonique : minuscules, rognées,
 * dédoublonnées, bornées.
 *
 * Ce qui est vide ou mal typé est **écarté en silence** plutôt que refusé :
 * une virgule en trop dans une saisie n'est pas une intention mal formée, et
 * faire échouer toute la tâche pour ça serait disproportionné.
 *
 * @param {unknown} valeur
 * @returns {string[]}
 */
const normalizeTags = (valeur) => {
  if (!Array.isArray(valeur)) return [];

  const vues = new Set();
  const gardees = [];

  for (const brute of valeur) {
    if (typeof brute !== 'string') continue;
    const propre = brute.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (propre === '' || vues.has(propre)) continue;
    vues.add(propre);
    gardees.push(propre);
    if (gardees.length === MAX_TAGS) break;
  }

  return gardees;
};

module.exports = { MAX_TAGS, MAX_TAG_LENGTH, normalizeTags };
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/tags.test.js
```

Attendu : SUCCÈS, 8 tests.

- [ ] **Step 5 : committer**

```bash
git add lib/tags.js test/server/tags.test.js
git commit -m "feat: normalisation des etiquettes"
```

---

## Task 2 : poser et filtrer des étiquettes

**Files:**

- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js`, comme nouveau bloc de premier niveau :

```js
describe('Étiquettes', () => {
  test('POST /tasks pose des étiquettes normalisées', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Courses', tags: [' Maison ', 'MAISON', 'urgent'] });

    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(['maison', 'urgent']);
  });

  test('PUT /tasks/:id remplace les étiquettes', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Courses', tags: ['maison'] });

    const res = await request(app)
      .put(`/tasks/${creee.body._id}`)
      .send({ tags: ['Bureau'] });

    expect(res.body.tags).toEqual(['bureau']);
  });

  test('GET /tasks?tag=… ne renvoie que les tâches marquées', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Avec', tags: ['maison'] });
    await request(app)
      .post('/tasks')
      .send({ title: 'Sans', tags: ['bureau'] });

    const res = await request(app).get('/tasks?limit=50&tag=maison');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Avec']);
  });

  test('le filtre par étiquette est insensible à la casse de la requête', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Avec', tags: ['maison'] });

    const res = await request(app).get('/tasks?limit=50&tag=MAISON');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Avec']);
  });

  test('un opérateur Mongo injecté dans tag est ignoré', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Une', tags: ['maison'] });
    await request(app).post('/tasks').send({ title: 'Deux' });

    const res = await request(app).get('/tasks?limit=50&tag[$ne]=null');

    expect(res.body.tasks).toHaveLength(2);
  });

  test('le filtre par étiquette se combine avec le statut', async () => {
    const faite = await request(app)
      .post('/tasks')
      .send({ title: 'Faite', tags: ['maison'] });
    await request(app).put(`/tasks/${faite.body._id}`).send({ completed: true });
    await request(app)
      .post('/tasks')
      .send({ title: 'À faire', tags: ['maison'] });

    const res = await request(app).get('/tasks?limit=50&tag=maison&status=active');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['À faire']);
  });

  test('plus de dix étiquettes : les dix premières sont gardées', async () => {
    const douze = Array.from({ length: 12 }, (_, i) => `tag${i}`);

    const res = await request(app).post('/tasks').send({ title: 'Beaucoup', tags: douze });

    expect(res.status).toBe(201);
    expect(res.body.tags).toHaveLength(10);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Étiquettes"
```

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, importer en tête :

```js
const { normalizeTags } = require('./lib/tags');
```

Ajouter `tags` à la liste blanche :

```js
const CREATE_FIELDS = [
  'title',
  'description',
  'dueDate',
  'category',
  'priority',
  'parentId',
  'recurrence',
  'tags',
];
```

Dans `buildFilter`, après le filtre de catégorie :

```js
// asString neutralise ?tag[$ne]=null, et la normalisation fait que « MAISON »
// retrouve « maison » : les étiquettes sont rangées en minuscules
const tag = asString(query.tag, 24).toLowerCase();
if (tag) filter.tags = tag;
```

Dans `POST /tasks`, juste avant `new Task(champs)` :

```js
if (Object.hasOwn(champs, 'tags')) champs.tags = normalizeTags(champs.tags);
```

Dans `PUT /tasks/:id`, au même endroit que les autres contrôles :

```js
if (Object.hasOwn(champs, 'tags')) champs.tags = normalizeTags(champs.tags);
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: poser et filtrer des etiquettes"
```

---

## Task 3 : les étiquettes en saisie rapide et à l'écran

**Files:**

- Modify: `public/js/parse.js`, `public/js/app.js`, `public/css/components.css`
- Test: `test/ui/parse.test.js`, `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test du parseur**

Ajouter à `test/ui/parse.test.js` :

```js
describe('étiquettes', () => {
  test('« +maison » pose une étiquette et quitte le titre', () => {
    const lu = parseQuickEntry('Ranger le garage +maison', { now: FIXED_NOW, categories: [] });

    expect(lu.title).toBe('Ranger le garage');
    expect(lu.tags).toEqual(['maison']);
  });

  test('plusieurs étiquettes se cumulent', () => {
    const lu = parseQuickEntry('Courses +maison +urgent', { now: FIXED_NOW, categories: [] });

    expect(lu.tags).toEqual(['maison', 'urgent']);
  });

  test('une étiquette se distingue d’une catégorie', () => {
    const lu = parseQuickEntry('Courses #Perso +maison', {
      now: FIXED_NOW,
      categories: ['Perso'],
    });

    expect(lu.category).toBe('Perso');
    expect(lu.tags).toEqual(['maison']);
    expect(lu.title).toBe('Courses');
  });

  test('un « + » isolé n’est pas une étiquette', () => {
    const lu = parseQuickEntry('1 + 1 = 2', { now: FIXED_NOW, categories: [] });

    expect(lu.tags).toEqual([]);
    expect(lu.title).toBe('1 + 1 = 2');
  });

  test('sans étiquette, la liste est vide et non absente', () => {
    expect(parseQuickEntry('Simple', { now: FIXED_NOW, categories: [] }).tags).toEqual([]);
  });
});
```

> `FIXED_NOW` est la constante d'horloge figée déjà utilisée dans ce fichier ; reprends son nom
> réel si elle s'appelle autrement.

- [ ] **Step 2 : écrire le test d'affichage**

Ajouter à `test/ui/app.test.js` :

```js
describe('étiquettes à l’écran', () => {
  test('une tâche marquée affiche ses étiquettes', async () => {
    server.tasks = [task('Courses', { tags: ['maison', 'urgent'] })];
    await boot();

    const vues = [...document.querySelectorAll('.task-tag')].map((e) => e.textContent.trim());
    expect(vues).toEqual(['+maison', '+urgent']);
  });

  test('cliquer une étiquette filtre la liste dessus', async () => {
    server.tasks = [task('Courses', { tags: ['maison'] })];
    await boot();
    server.calls = [];

    document.querySelector('.task-tag').click();
    await settle();

    const url = calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();
    expect(new URL(url, 'http://test').searchParams.get('tag')).toBe('maison');
  });

  test('une tâche sans étiquette n’affiche rien', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-tag')).toBeNull();
  });
});
```

- [ ] **Step 3 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui
```

- [ ] **Step 4 : étendre le parseur**

Dans `public/js/parse.js`, ajouter le motif d'étiquette à côté de celui de catégorie. Le
séparateur est `+`, suivi d'au moins un caractère de mot — un `+` isolé, comme dans « 1 + 1 »,
ne doit rien déclencher :

```js
/** `+maison` : au moins un caractère de mot après le signe, sinon « 1 + 1 » en poserait une. */
const TAG_PATTERN = /(?:^|\s)\+([\p{L}\p{N}_-]+)/gu;
```

Le retrait du titre suit exactement la même mécanique que celui de la catégorie (y compris le
recollage de la ponctuation) : reprends la fonction existante plutôt que d'en écrire une
seconde. Le résultat gagne `tags: string[]`, vide par défaut.

- [ ] **Step 5 : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* ------------------------------- étiquettes ------------------------------- */

.task-tag {
  border: 0;
  background: none;
  padding: 0;
  font-family: var(--font-ui);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  cursor: pointer;
}

.task-tag:hover,
.task-tag:focus-visible {
  color: var(--ink-soft);
}
```

- [ ] **Step 6 : afficher et brancher**

Dans `public/js/app.js`, dans `.task-meta` :

```js
      ${(task.tags || [])
        .map(
          (tag) =>
            `<button type="button" class="task-tag" data-tag="${escapeHtml(tag)}">+${escapeHtml(tag)}</button>`
        )
        .join('')}
```

Dans le gestionnaire de clic délégué :

```js
const tag = e.target.closest('.task-tag');
if (tag) {
  state = { ...state, tag: tag.dataset.tag };
  refresh({ page: 1 });
  return;
}
```

Ajouter `tag: ''` à l'état initial, et le transmettre là où les autres filtres le sont, dans la
construction de la requête de liste.

Enfin, le composeur envoie les étiquettes lues par la saisie rapide, là où il envoie déjà la
catégorie et la priorité.

- [ ] **Step 7 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 8 : vérifier à l'œil**

```bash
npm start
```

Saisir `Ranger le garage +maison +bricolage` : l'aperçu montre les deux étiquettes, le titre
reste propre, les étiquettes s'affichent sous la tâche, et cliquer l'une d'elles filtre.

- [ ] **Step 9 : committer**

```bash
git add public/ test/ui/
git commit -m "feat: etiquettes en saisie rapide, affichees et filtrables"
```

---

## Task 4 : documenter

**Files:**

- Modify: `README.md`

- [ ] **Step 1 : ajouter la fonctionnalité**

```markdown
- **Étiquettes** : plusieurs mots-clés transversaux par tâche (`+maison` en saisie rapide),
  cliquables pour filtrer — la catégorie reste le classement principal, unique et coloré
```

- [ ] **Step 2 : compléter le tableau des paramètres de `GET /tasks`**

```markdown
| `tag` | une étiquette (24 caractères max, insensible à la casse) | — |
```

- [ ] **Step 3 : committer**

```bash
git add README.md
git commit -m "docs: documenter les etiquettes"
```
