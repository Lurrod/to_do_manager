# Vague 1 — Usage quotidien : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** faire passer le Cahier d'un registre chronologique à un outil qu'on ouvre le matin — filtres temporels, saisie en langage naturel, corbeille consultable, pilotage au clavier.

**Architecture:** aucune modification du schéma Mongo. Le serveur gagne un filtre `due` dans le `buildFilter` existant, un compteur `overdue` dans `/tasks/stats`, et deux routes de corbeille. Le client gagne un module pur `parse.js` (aucun DOM, horloge injectable), une rangée d'onglets temporels, une modale corbeille et une palette de commandes. Chaque tâche est livrable et testable seule.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, JS vanilla (modules ES), drawably 0.3, Jest + Supertest (API), Vitest + happy-dom (UI).

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, section « Vague 1 ».

---

## Structure des fichiers

| Fichier                     | Rôle                                              | Vague 1                                                                                                                  |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `server.js`                 | API Express                                       | **Modifié** : helpers de date, `dueClause`, `buildFilter`, `/tasks/stats`, `GET /tasks/trash`, `DELETE /tasks/:id/purge` |
| `public/js/parse.js`        | Saisie rapide en langage naturel — **module pur** | **Créé**                                                                                                                 |
| `public/js/app.js`          | État, rendu, événements                           | **Modifié** : `state.due`, onglets, aperçu de saisie, corbeille, raccourcis                                              |
| `public/js/api.js`          | Client HTTP                                       | **Modifié** : `listTrash`, `purgeTask`                                                                                   |
| `public/index.html`         | Balisage                                          | **Modifié** : panneau Échéance, aperçu, modales corbeille et palette                                                     |
| `public/css/components.css` | Styles                                            | **Modifié** : badge, aperçu, corbeille, palette                                                                          |
| `test/api/server.test.js`   | Jest + Supertest                                  | **Modifié** : filtre `due`, stats, corbeille                                                                             |
| `test/ui/parse.test.js`     | Vitest                                            | **Créé**                                                                                                                 |
| `test/ui/app.test.js`       | Vitest + happy-dom                                | **Modifié** : onglets, saisie rapide, corbeille, raccourcis                                                              |

`parse.js` est un fichier séparé — et pas une fonction de plus dans `util.js` — parce qu'il est
le seul morceau de logique métier du client : isolé, il se teste sans DOM et se relit d'un bloc.

---

## Task 1 : filtre temporel `due` côté serveur

**Files:**

- Modify: `server.js:146-155` (après le helper `toInt`) et `server.js:200-224` (`buildFilter`)
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter ce bloc à la fin de `test/api/server.test.js`, à l'intérieur du `describe('Tasks API', …)`
existant (avant sa dernière accolade fermante) :

```js
describe('GET /tasks — filtre temporel', () => {
  /** Échéance à J+offset, midi, pour rester loin des bornes de minuit. */
  const at = (offsetDays) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };

  beforeEach(async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'hier', dueDate: at(-1) });
    await request(app)
      .post('/tasks')
      .send({ title: 'aujourdhui', dueDate: at(0) });
    await request(app)
      .post('/tasks')
      .send({ title: 'dans3j', dueDate: at(3) });
    await request(app)
      .post('/tasks')
      .send({ title: 'dans30j', dueDate: at(30) });
    await request(app).post('/tasks').send({ title: 'sansdate' });
  });

  const titlesFor = async (query) => {
    const res = await request(app).get(`/tasks?limit=100&${query}`);
    expect(res.status).toBe(200);
    return res.body.tasks.map((t) => t.title).sort();
  };

  test('due=overdue ne renvoie que les échéances dépassées', async () => {
    expect(await titlesFor('due=overdue')).toEqual(['hier']);
  });

  test('due=today inclut le retard et le jour même', async () => {
    expect(await titlesFor('due=today')).toEqual(['aujourdhui', 'hier']);
  });

  test('due=week couvre sept jours, retard inclus', async () => {
    expect(await titlesFor('due=week')).toEqual(['aujourdhui', 'dans3j', 'hier']);
  });

  test('due=none ne renvoie que les tâches sans échéance', async () => {
    expect(await titlesFor('due=none')).toEqual(['sansdate']);
  });

  test('une valeur inconnue de due est ignorée', async () => {
    expect(await titlesFor('due=nimportequoi')).toHaveLength(5);
  });

  test('un opérateur Mongo injecté dans due est ignoré', async () => {
    expect(await titlesFor('due[$ne]=null')).toHaveLength(5);
  });

  test('due se combine avec le statut et la recherche', async () => {
    // chaque leurre n'est écarté que par un seul des trois filtres : si l'un
    // d'eux cesse d'agir, un intrus apparaît et le test tombe
    await request(app)
      .post('/tasks')
      .send({ title: 'hier futur', dueDate: at(30) });
    await request(app)
      .post('/tasks')
      .send({ title: 'course', dueDate: at(-1) });
    const fini = await request(app)
      .post('/tasks')
      .send({ title: 'hier fini', dueDate: at(-1) });
    await request(app).put(`/tasks/${fini.body._id}`).send({ completed: true });

    expect(await titlesFor('due=overdue&status=active&q=hier')).toEqual(['hier']);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- -t "filtre temporel"
```

Attendu : ÉCHEC. `due=overdue` renvoie les 5 tâches (le paramètre n'existe pas encore), donc
`expect(['aujourdhui','dans30j','dans3j','hier','sansdate']).toEqual(['hier'])` échoue.

- [ ] **Step 3 : écrire l'implémentation minimale**

Dans `server.js`, juste après le helper `toInt` (ligne 149, avant le commentaire `/** Les détails
internes restent dans les logs … */`), insérer :

```js
/* Bornes de journée en heure locale du serveur : le navigateur tourne sur la
   même machine, il n'y a donc aucun décalage à faire transiter. */
const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Horizons emboîtés : `today` contient le retard, `week` contient `today`.
 * Une tâche en retard ne doit jamais disparaître d'une vue plus large — c'est
 * précisément l'oubli que ces vues servent à empêcher.
 * @returns {object|null} clause à fusionner dans le filtre, ou null si `due` est inconnu
 */
const dueClause = (due, now = new Date()) => {
  const start = startOfDay(now);
  if (due === 'overdue') return { dueDate: { $ne: null, $lt: start } };
  if (due === 'today') return { dueDate: { $ne: null, $lt: addDays(start, 1) } };
  if (due === 'week') return { dueDate: { $ne: null, $lt: addDays(start, 7) } };
  if (due === 'none') return { dueDate: null };
  return null;
};
```

Puis dans `buildFilter`, après le bloc `category` et avant le bloc `term` :

```js
// asString neutralise ?due[$ne]=null : un objet devient chaîne vide, donc aucun filtre
const due = dueClause(asString(query.due, 16));
if (due) Object.assign(filter, due);
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api
```

Attendu : SUCCÈS, 34 tests précédents + 7 nouveaux.

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: filtre temporel due sur GET /tasks"
```

---

## Task 2 : compteur `overdue` dans `/tasks/stats`

**Files:**

- Modify: `server.js` (route `GET /tasks/stats`, et le commentaire de `buildFilter`)
- Test: `test/api/server.test.js`

Cette tâche emporte aussi une correction de commentaire laissée par la task 1 : la
docstring de `buildFilter` énumère les critères qui portent sur toute la base et ne
mentionne pas `due`, qu'elle applique pourtant désormais. Remplacer

```js
/** Filtre de liste — statut, catégorie et recherche s'appliquent à TOUTES les tâches. */
```

par

```js
/** Filtre de liste — statut, échéance, catégorie et recherche portent sur TOUTES les tâches. */
```

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter dans le même `describe('Tasks API', …)` :

```js
test('GET /tasks/stats compte les tâches en retard non terminées', async () => {
  const past = new Date();
  past.setDate(past.getDate() - 2);
  const future = new Date();
  future.setDate(future.getDate() + 2);

  await request(app).post('/tasks').send({ title: 'retard', dueDate: past.toISOString() });
  await request(app).post('/tasks').send({ title: 'a venir', dueDate: future.toISOString() });
  await request(app).post('/tasks').send({ title: 'sans date' });

  const done = await request(app)
    .post('/tasks')
    .send({ title: 'retard mais fini', dueDate: past.toISOString() });
  await request(app).put(`/tasks/${done.body._id}`).send({ completed: true });

  const res = await request(app).get('/tasks/stats');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(4);
  // la tâche terminée ne compte pas : elle n'est plus un rappel
  expect(res.body.overdue).toBe(1);
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- -t "en retard non terminées"
```

Attendu : ÉCHEC avec `expect(received).toBe(expected) // Expected: 1, Received: undefined`.

- [ ] **Step 3 : écrire l'implémentation minimale**

Dans `server.js`, route `GET /tasks/stats`, remplacer le `Promise.all` et la réponse par :

```js
const [total, done, overdue, byCategory] = await Promise.all([
  Task.countDocuments(base),
  Task.countDocuments({ ...base, completed: true }),
  // une tâche terminée n'est plus un rappel, même si son échéance est passée
  Task.countDocuments({
    ...base,
    completed: false,
    dueDate: { $ne: null, $lt: startOfDay(new Date()) },
  }),
  Task.aggregate([{ $match: base }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
]);

res.status(200).json({
  total,
  done,
  active: total - done,
  overdue,
  byCategory: byCategory.map(({ _id, count }) => ({ category: _id || '', count })),
});
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api
```

Attendu : SUCCÈS.

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: compteur des tâches en retard dans /tasks/stats"
```

---

## Task 3 : onglets temporels dans l'interface

**Files:**

- Modify: `public/index.html` (panneau « Statut », y ajouter un panneau « Échéance »)
- Modify: `public/css/components.css` (après le bloc `.pill`, ligne 115)
- Modify: `public/js/app.js` (sélecteurs, `state`, `queryFor`, `updateCounters`, `EMPTY_COPY`, événements)
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `test/ui/app.test.js` :

```js
describe('onglets temporels', () => {
  const lastListUrl = () =>
    calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();

  test('la vue par défaut ne contraint pas l’échéance', async () => {
    await boot();
    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('all');
  });

  test('cliquer un onglet relance la liste sur cet horizon, page 1', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="today"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('today');
    expect(params.get('page')).toBe('1');
  });

  test('l’onglet « en retard » aligne le statut sur ce que compte le badge', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('overdue');
    expect(params.get('status')).toBe('active');
    // l'interface ne doit pas afficher « Toutes » en filtrant sur « À faire »
    const statusPill = document.querySelector('.pill[data-filter="active"]');
    expect(statusPill.classList.contains('is-active')).toBe(true);
  });

  test('élargir le statut quitte l’horizon « en retard » au lieu de le faire mentir', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();
    server.calls = [];

    document.querySelector('.pill[data-filter="done"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('status')).toBe('done');
    expect(params.get('due')).toBe('all');
    expect(
      document.querySelector('.due-pill[data-due="all"]').classList.contains('is-active')
    ).toBe(true);
  });

  test('revenir sur « à faire » ne quitte pas l’horizon : rien ne se contredit', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();
    server.calls = [];

    document.querySelector('.pill[data-filter="active"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('status')).toBe('active');
    expect(params.get('due')).toBe('overdue');
  });

  test('l’état de sélection est exposé aux aides techniques', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="today"]').click();
    await settle();

    expect(document.querySelector('.due-pill[data-due="today"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector('.due-pill[data-due="all"]').getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  test('le badge nomme ce qu’il compte', async () => {
    server.stats = { ...server.stats, overdue: 2 };
    await boot();

    const pill = document.querySelector('.due-pill[data-due="overdue"]');
    expect(pill.getAttribute('aria-label')).toBe('En retard, 2 tâches');
  });

  test('les autres horizons laissent le statut tranquille', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="week"]').click();
    await settle();

    expect(new URL(lastListUrl(), 'http://test').searchParams.get('status')).toBe('all');
    expect(document.querySelector('.pill[data-filter="all"]').classList.contains('is-active')).toBe(
      true
    );
  });

  test('l’onglet actif est le seul marqué', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();

    const active = [...document.querySelectorAll('.due-pill.is-active')].map(
      (el) => el.dataset.due
    );
    expect(active).toEqual(['overdue']);
  });

  test('le badge affiche le nombre de tâches en retard', async () => {
    server.stats = { ...server.stats, overdue: 3 };
    await boot();

    const badge = document.getElementById('due-overdue-count');
    expect(badge.textContent).toBe('3');
    expect(badge.hidden).toBe(false);
  });

  test('le badge disparaît quand rien n’est en retard', async () => {
    server.stats = { ...server.stats, overdue: 0 };
    await boot();

    expect(document.getElementById('due-overdue-count').hidden).toBe(true);
  });

  test('un horizon vide affiche un état vide qui le dit', async () => {
    server.tasks = [];
    server.stats = { total: 0, done: 0, active: 0, overdue: 0, byCategory: [] };
    await boot();

    document.querySelector('.due-pill[data-due="week"]').click();
    await settle();

    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.empty-title').textContent).toBe('Rien sur cet horizon.');
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:ui -- -t "onglets temporels"
```

Attendu : ÉCHEC — `document.querySelector('.due-pill[data-due="today"]')` vaut `null`, donc
`TypeError: Cannot read properties of null (reading 'click')`.

- [ ] **Step 3a : ajouter le balisage**

Dans `public/index.html`, juste après la `<section>` du panneau « Statut » (celle qui contient
`role="group" aria-label="Filtrer par statut"`) et avant le `<p class="margin-note">` :

```html
<section class="panel" data-sketch="card">
  <h2 class="panel-title">Échéance</h2>
  <div class="filters" role="group" aria-label="Filtrer par échéance">
    <button
      class="btn pill due-pill is-active"
      data-due="all"
      data-sketch="button"
      data-variant="solid"
      aria-pressed="true"
    >
      Tout
    </button>
    <button class="btn pill due-pill" data-due="overdue" data-sketch="button" aria-pressed="false">
      En retard <b class="due-badge" id="due-overdue-count" hidden>0</b>
    </button>
    <button class="btn pill due-pill" data-due="today" data-sketch="button" aria-pressed="false">
      Aujourd'hui
    </button>
    <button class="btn pill due-pill" data-due="week" data-sketch="button" aria-pressed="false">
      Semaine
    </button>
    <button class="btn pill due-pill" data-due="none" data-sketch="button" aria-pressed="false">
      Sans date
    </button>
  </div>
</section>
```

Remplacer aussi la note de marge pour annoncer les nouveaux raccourcis (ils arrivent en Task 8,
la note peut être posée dès maintenant) :

```html
<p class="margin-note">
  <span class="kbd">↵</span> ajouter · <span class="kbd">/</span> chercher ·
  <span class="kbd">Ctrl</span>+<span class="kbd">K</span> palette ·
  <span class="kbd">Esc</span> fermer
</p>
```

- [ ] **Step 3b : ajouter le style**

Dans `public/css/components.css`, juste après le bloc `.pill { … }` (ligne 115) :

```css
/* pastille de compte sur l'onglet « En retard » — encre rouge, comme une annotation */
.due-badge {
  margin-left: 5px;
  color: var(--red-pen);
  font-family: var(--font-hand);
  font-size: 1.05rem;
  line-height: 1;
}

.due-badge[hidden] {
  display: none;
}
```

- [ ] **Step 3c : brancher l'état**

Dans `public/js/app.js` :

1. Remplacer la ligne `const filterPills = [...document.querySelectorAll('.pill')];` (elle
   ramasserait sinon les nouveaux onglets, qui portent eux aussi la classe `.pill`) par :

```js
// `.pill` est porté par les deux rangées : on les sépare sur leur attribut
const filterPills = [...document.querySelectorAll('.pill[data-filter]')];
const duePills = [...document.querySelectorAll('.due-pill')];
const dueOverdueCount = $('due-overdue-count');
```

2. Dans l'objet `state`, ajouter `due: 'all',` après `category: 'all',`, et remplacer la ligne
   `stats: { total: 0, done: 0, active: 0, byCategory: [] },` par :

```js
  stats: { total: 0, done: 0, active: 0, overdue: 0, byCategory: [] },
```

3. Dans `queryFor`, ajouter `due: state.due,` après `category: state.category,`.

4. Dans `EMPTY_COPY`, ajouter en première position :

```js
  horizon: ['Rien sur cet horizon.', 'Aucune tâche à cette échéance.'],
```

5. Dans `updateEmptyState`, remplacer le calcul de `key` par :

```js
let key = 'blank';
if (state.query) key = 'search';
else if (state.due !== 'all') key = 'horizon';
else if (state.status === 'done') key = 'done';
else if (state.status === 'active' && state.stats.total > 0) key = 'cleared';
else if (state.category !== 'all') key = 'category';
```

6. À la fin de `updateCounters`, avant la fermeture de la fonction, ajouter :

```js
const overdue = state.stats.overdue || 0;
dueOverdueCount.textContent = overdue;
dueOverdueCount.hidden = overdue === 0;

// sans cela le nom accessible du bouton devient « En retard 3 », un nombre
// posé là sans dire de quoi il parle
const overduePill = duePills.find((p) => p.dataset.due === 'overdue');
overduePill.setAttribute(
  'aria-label',
  overdue === 0 ? 'En retard' : `En retard, ${overdue} tâche${overdue > 1 ? 's' : ''}`
);
```

7. Remplacer le bloc `filterPills.forEach(…)` existant par le code ci-dessous, qui factorise le
   marquage de la pastille active et branche les onglets temporels.

**Décision — l'onglet « En retard » force le statut « À faire ».** Le badge compte les tâches
en retard **non terminées** (task 2), alors que `due=overdue` et `status` sont orthogonaux côté
serveur : sans rien faire, le badge annoncerait 3 et l'onglet listerait 5. Un compteur qui ment
est pire que pas de compteur. L'onglet aligne donc le statut — **et met à jour la rangée
« Statut » en conséquence**, sinon l'interface afficherait « Toutes » tout en filtrant sur
« À faire ». Les autres horizons ne touchent pas au statut : sur « Aujourd'hui », voir ce qu'on
a déjà rayé dans la journée est utile.

**Le couplage doit être symétrique.** Forcer le statut à l'entrée de l'onglet ne suffit pas : si
l'utilisateur clique ensuite « Rayées », il reste sur « En retard », badge allumé à N, en train
de lister des tâches terminées — le bug revient par l'autre rangée. L'invariant à tenir est
précis : **tant que l'onglet « En retard » est actif, la liste qu'il montre doit valoir le
badge.** Élargir le statut quitte donc l'horizon au lieu de le faire mentir. Choisir « À faire »
ne le quitte pas : il n'y a pas de contradiction.

Le badge, lui, reste affiché en permanence : il dit « il reste N tâches en retard », ce qui est
vrai quelle que soit la vue courante. Il n'étiquette pas la liste, il signale.

```js
/** Marque une pastille comme seule active de sa rangée. */
const activatePill = (pills, target) => {
  pills.forEach((p) => {
    const isTarget = p === target;
    p.classList.toggle('is-active', isTarget);
    // sans cet état, une aide technique ne sait pas quel filtre est appliqué :
    // la classe CSS et le trait drawably ne disent rien à personne d'autre
    p.setAttribute('aria-pressed', String(isTarget));
    setVariant(p, isTarget ? 'solid' : null);
  });
};

filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const status = pill.dataset.filter;
    activatePill(filterPills, pill);

    // élargir le statut ferait diverger l'onglet « en retard » et son badge :
    // on quitte l'horizon plutôt que de le laisser mentir
    const due = state.due === 'overdue' && status !== 'active' ? 'all' : state.due;
    if (due !== state.due) {
      activatePill(
        duePills,
        duePills.find((p) => p.dataset.due === due)
      );
    }

    state = { ...state, status, due };
    refresh({ page: 1 });
  });
});

duePills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const due = pill.dataset.due;
    activatePill(duePills, pill);

    // le badge compte le travail qui reste : l'onglet doit montrer la même
    // chose, et la rangée « Statut » doit dire la vérité sur ce qui est filtré
    const status = due === 'overdue' ? 'active' : state.status;
    if (status !== state.status) {
      activatePill(
        filterPills,
        filterPills.find((p) => p.dataset.filter === status)
      );
    }

    state = { ...state, due, status };
    refresh({ page: 1 });
  });
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm run test:ui
```

Attendu : SUCCÈS, les 53 tests existants + 6 nouveaux.

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Ouvrir http://localhost:3000, cliquer chaque onglet, vérifier que les traits drawably sont bien
posés sur les nouveaux boutons et que le badge n'apparaît que s'il y a du retard. `Ctrl+C` pour arrêter.

- [ ] **Step 6 : committer**

```bash
git add public/index.html public/css/components.css public/js/app.js test/ui/app.test.js
git commit -m "feat: onglets temporels et badge des tâches en retard"
```

---

## Task 4 : module `parse.js` — saisie rapide en langage naturel

**Files:**

- Create: `public/js/parse.js`
- Test: `test/ui/parse.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/ui/parse.test.js` :

```js
import { describe, expect, test } from 'vitest';
import { parseQuickEntry } from '../../public/js/parse.js';

/* Horloge figée : mercredi 16 septembre 2026, 10h00 locales.
   Les assertions portent sur les champs de date locaux, jamais sur la chaîne
   ISO — sinon le fuseau de la machine ferait osciller le test. */
const NOW = new Date(2026, 8, 16, 10, 0, 0);

const parse = (text, categories = []) => parseQuickEntry(text, { now: NOW, categories });

const at = (result) => {
  const d = new Date(result.dueDate);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};

describe('parseQuickEntry — titre', () => {
  test('sans motif, tout est le titre et rien n’est daté', () => {
    const r = parse('Relire le brief');
    expect(r.title).toBe('Relire le brief');
    expect(r.dueDate).toBeNull();
    expect(r.category).toBe('');
    expect(r.priority).toBe('');
    expect(r.tokens).toEqual([]);
  });

  test('les segments reconnus sortent du titre', () => {
    const r = parse('Dentiste demain 14h #Santé !haute');
    expect(r.title).toBe('Dentiste');
  });

  test('une entrée vide ne casse pas', () => {
    expect(parse('').title).toBe('');
    expect(parseQuickEntry(null, { now: NOW }).title).toBe('');
  });

  test('le titre est tronqué à 120 caractères', () => {
    expect(parse('a'.repeat(200)).title).toHaveLength(120);
  });
});

describe('parseQuickEntry — dates relatives', () => {
  test('demain sans heure tombe à 9h', () => {
    expect(at(parse('Courses demain'))).toEqual([2026, 9, 17, 9, 0]);
  });

  test('après-demain', () => {
    expect(at(parse('Courses après-demain'))).toEqual([2026, 9, 18, 9, 0]);
  });

  test('aujourd’hui garde le jour même', () => {
    expect(at(parse('Courses aujourd’hui'))).toEqual([2026, 9, 16, 9, 0]);
  });

  test('auj est accepté', () => {
    expect(at(parse('Courses auj 18h'))).toEqual([2026, 9, 16, 18, 0]);
  });

  test('dans 3 jours', () => {
    expect(at(parse('Relancer dans 3 jours'))).toEqual([2026, 9, 19, 9, 0]);
  });

  test('dans 2 semaines', () => {
    expect(at(parse('Relancer dans 2 semaines'))).toEqual([2026, 9, 30, 9, 0]);
  });
});

describe('parseQuickEntry — jours de semaine', () => {
  test('mardi vise la prochaine occurrence', () => {
    expect(at(parse('Réunion mardi'))).toEqual([2026, 9, 22, 9, 0]);
  });

  test('le jour courant vise la semaine suivante, jamais aujourd’hui', () => {
    expect(at(parse('Réunion mercredi'))).toEqual([2026, 9, 23, 9, 0]);
  });
});

describe('parseQuickEntry — dates numériques', () => {
  test('jour/mois à venir reste sur l’année en cours', () => {
    expect(at(parse('Facture le 12/11'))).toEqual([2026, 11, 12, 9, 0]);
  });

  test('jour/mois déjà passé bascule sur l’année suivante', () => {
    expect(at(parse('Facture le 12/03'))).toEqual([2027, 3, 12, 9, 0]);
  });

  test('une année explicite est respectée telle quelle', () => {
    expect(at(parse('Facture le 12/03/2027'))).toEqual([2027, 3, 12, 9, 0]);
  });

  test('une date impossible est laissée dans le titre', () => {
    const r = parse('Diviser 31/02');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('Diviser 31/02');
  });
});

describe('parseQuickEntry — heures', () => {
  test('heure et minutes', () => {
    expect(at(parse('Appel demain 14h30'))).toEqual([2026, 9, 17, 14, 30]);
  });

  test('« à 9h » est accepté', () => {
    expect(at(parse('Appel demain à 9h'))).toEqual([2026, 9, 17, 9, 0]);
  });

  test('une heure seule encore à venir désigne aujourd’hui', () => {
    expect(at(parse('Appel 18h'))).toEqual([2026, 9, 16, 18, 0]);
  });

  test('une heure seule déjà passée désigne demain', () => {
    expect(at(parse('Appel 8h'))).toEqual([2026, 9, 17, 8, 0]);
  });

  test('une heure impossible reste dans le titre', () => {
    const r = parse('Compter 42h');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('Compter 42h');
  });
});

describe('parseQuickEntry — catégorie et priorité', () => {
  test('#catégorie est extraite', () => {
    expect(parse('Vaccin #Santé').category).toBe('Santé');
  });

  test('la casse est recalée sur une catégorie connue', () => {
    expect(parse('Vaccin #sante', ['Santé']).category).toBe('Santé');
  });

  test('une catégorie inconnue est gardée telle quelle', () => {
    expect(parse('Vaccin #Divers', ['Santé']).category).toBe('Divers');
  });

  test('!haute, !moyenne, !basse', () => {
    expect(parse('X !haute').priority).toBe('high');
    expect(parse('X !moyenne').priority).toBe('medium');
    expect(parse('X !basse').priority).toBe('low');
  });

  test('!1 !2 !3 sont des synonymes', () => {
    expect(parse('X !1').priority).toBe('high');
    expect(parse('X !2').priority).toBe('medium');
    expect(parse('X !3').priority).toBe('low');
  });

  test('un ! isolé n’est pas une priorité', () => {
    const r = parse('Bravo !');
    expect(r.priority).toBe('');
    expect(r.title).toBe('Bravo !');
  });
});

describe('parseQuickEntry — aperçu', () => {
  test('les tokens se lisent dans l’ordre où l’utilisateur a tapé', () => {
    const r = parse('Dentiste demain 14h #Santé !haute');
    expect(r.tokens).toEqual([
      { type: 'date', text: 'demain' },
      { type: 'date', text: '14h' },
      { type: 'category', text: '#Santé' },
      { type: 'priority', text: '!haute' },
    ]);
  });
});

describe('parseQuickEntry — ne pas mutiler le titre', () => {
  /* Un motif à moitié consommé laisse un fragment orphelin dans le champ, sous
     les yeux de l'utilisateur. Mieux vaut ne rien reconnaître du tout. */

  test('#12/03 n’est pas une catégorie et ne laisse pas « /03 »', () => {
    const r = parse('Truc #12/03');
    expect(r.title).toBe('Truc #12/03');
    expect(r.category).toBe('');
    expect(r.dueDate).toBeNull();
  });

  test('!1/2 n’est pas une priorité et ne laisse pas « /2 »', () => {
    const r = parse('Truc !1/2');
    expect(r.title).toBe('Truc !1/2');
    expect(r.priority).toBe('');
  });

  test('une catégorie trop longue n’est pas tronquée puis recollée', () => {
    const long = 'a'.repeat(40);
    const r = parse(`Truc #${long} fin`);
    expect(r.title).toBe(`Truc #${long} fin`);
    expect(r.category).toBe('');
  });

  test('« il y a 3h » garde son « a »', () => {
    expect(parse('Reunion il y a 3h').title).toBe('Reunion il y a');
  });

  test('« Le » majuscule est reconnu comme amorce de date', () => {
    const r = parse('Facture Le 12/11');
    expect(r.title).toBe('Facture');
  });

  test('une étiquette en fin de phrase est reconnue, et le point recolle', () => {
    const r = parse('Truc #Santé.');
    expect(r.category).toBe('Santé');
    expect(r.title).toBe('Truc.');
  });

  test('une étiquette suivie d’une virgule est reconnue', () => {
    const r = parse('Truc !haute, autre chose');
    expect(r.priority).toBe('high');
    expect(r.title).toBe('Truc, autre chose');
  });

  test('l’espace avant un point d’exclamation français est préservée', () => {
    // « Bravo ! » s'écrit avec une espace : le recollage ne vaut que . et ,
    expect(parse('Bravo !').title).toBe('Bravo !');
    expect(parse('Vaccin #Santé!').title).toBe('Vaccin !');
  });

  test('la ponctuation écrite par l’utilisateur n’est jamais retouchée', () => {
    // aucune étiquette retirée ici : rien ne justifie de toucher au texte,
    // et aucune pastille ne signalerait la retouche
    expect(parse('Truc , suite').title).toBe('Truc , suite');
    expect(parse('Truc ...').title).toBe('Truc ...');
    expect(parse('Payer 3 , 50').title).toBe('Payer 3 , 50');
    // même quand une date est reconnue ailleurs dans la phrase
    expect(parse('Attendre ... demain').title).toBe('Attendre ...');
  });
});

describe('parseQuickEntry — divers', () => {
  test('« ce lundi » est accepté', () => {
    expect(at(parse('Réunion ce lundi'))).toEqual([2026, 9, 21, 9, 0]);
  });

  test('une seule catégorie est retenue, la seconde reste dans le titre', () => {
    const r = parse('Truc #Un #Deux');
    expect(r.category).toBe('Un');
    expect(r.title).toBe('Truc #Deux');
  });

  test('l’horloge fournie n’est jamais modifiée', () => {
    const clock = new Date(2026, 8, 16, 10, 0, 0);
    const before = clock.getTime();
    parseQuickEntry('Courses demain 14h', { now: clock });
    expect(clock.getTime()).toBe(before);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:ui -- parse
```

Attendu : ÉCHEC au chargement — `Failed to load url ../../public/js/parse.js`.

- [ ] **Step 3 : écrire l'implémentation**

Créer `public/js/parse.js` :

```js
/* ---------------------------------------------------------------------------
   Saisie rapide : « Dentiste demain 14h #Santé !haute ».
   Module pur — aucun DOM, aucun réseau, horloge injectable. Tout ce qui est
   reconnu sort du titre et revient dans `tokens` pour être montré à l'écran :
   un parseur qui devine en silence est un parseur qu'on n'ose plus utiliser.
   --------------------------------------------------------------------------- */

const MAX_TITLE = 120;
// un jour sans heure vaut « dans la matinée »
const DEFAULT_HOUR = 9;

const PRIORITIES = {
  haute: 'high',
  urgent: 'high',
  urgente: 'high',
  1: 'high',
  moyenne: 'medium',
  normale: 'medium',
  2: 'medium',
  basse: 'low',
  3: 'low',
};

const WEEKDAYS = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

/* Chaque motif commence par (^|\s) : un motif ne se déclenche qu'en début de
   mot, sinon « #Santé » livrerait un jour dans « ...di ». Le groupe 1 est cette
   frontière, et n'est jamais consommé. */
/* `#` et `!` exigent aussi une frontière APRÈS le motif, et ce doit être une
   anticipation sur l'espace ou la fin : un simple \b ne suffirait pas, puisqu'il
   y a justement une frontière de mot entre le « 2 » et le « / » de « !1/2 ».
   Sans elle, « #12/03 » consommerait « #12 » et laisserait « /03 » dans le
   titre — un titre mutilé sous les yeux de l'utilisateur, ce que l'aperçu ne
   rattrape pas. Mieux vaut ne rien reconnaître et lui laisser le fragment.
   La ponctuation de fin de phrase est admise comme frontière : « #Santé. »
   doit être reconnu, et le « / » n'en fait pas partie, donc « #12/03 » reste
   écarté. Et surtout pas \b ici : il est ASCII-only en JS, et une étiquette
   accentuée comme « #Santé » n'y satisferait jamais. */
const RE_PRIORITY = /(^|\s)!(haute|urgente?|moyenne|normale|basse|[123])(?=[\s.,!?;:]|$)/iu;
const RE_CATEGORY = /(^|\s)#([\p{L}\p{N}_-]{1,32})(?=[\s.,!?;:]|$)/u;
const RE_IN = /(^|\s)dans\s+(\d{1,3})\s*(jours?|j|semaines?|sem)\b/iu;
const RE_RELATIVE = /(^|\s)(apr[èe]s-demain|demain|aujourd['’]?hui|auj)\b/iu;
const RE_WEEKDAY =
  /(^|\s)(?:(?:ce|cette)\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/iu;
const RE_DATE = /(^|\s)(?:le\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/iu;
// seul « à » introduit une heure : accepter « a » nu ferait de « il y a 3h »
// une échéance, alors que c'est la tournure la plus banale du français
const RE_TIME = /(^|\s)(?:à\s*)?(\d{1,2})\s*h\s*([0-5]\d)?\b/iu;

/** Minuscules sans accents : « Après-demain » et « apres-demain » se valent. */
const plain = (value) =>
  String(value)
    .normalize('NFD')
    // U+0300 a U+036F : les diacritiques que NFD vient de détacher
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const atMidnight = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Lit une saisie libre et en extrait échéance, catégorie et priorité.
 * @param {string} input texte saisi
 * @param {{now?: Date, categories?: string[]}} options horloge et catégories connues
 * @returns {{title: string, dueDate: string|null, category: string, priority: string,
 *            tokens: Array<{type: string, text: string}>}}
 */
export function parseQuickEntry(input, { now = new Date(), categories = [] } = {}) {
  const text = String(input ?? '');
  const cuts = [];
  const tokens = [];
  let day = null;
  let time = null;
  let category = '';
  let priority = '';

  const overlaps = (start, end) => cuts.some(([s, e]) => start < e && s < end);

  /**
   * Retire le segment du titre et le montre dans l'aperçu.
   * @returns {boolean} false si le segment chevauche un segment déjà pris
   */
  const take = (match, type) => {
    const start = match.index + match[1].length;
    const end = match.index + match[0].length;
    if (overlaps(start, end)) return false;

    /* « Truc #Santé. » : retirer l'étiquette laisserait « Truc . ». L'espace
       qui la précédait part donc avec elle — mais seulement devant un point ou
       une virgule, et seulement ici. Un passage global sur le titre fini
       toucherait aussi la ponctuation que l'utilisateur a écrite lui-même, sans
       qu'aucune pastille ne le signale. */
    const glued = /[.,]/.test(text[end] || '') && start > 0 && /\s/.test(text[start - 1]);

    cuts.push([glued ? start - 1 : start, end]);
    tokens.push({ type, text: text.slice(start, end).trim(), start });
    return true;
  };

  const mPriority = RE_PRIORITY.exec(text);
  if (mPriority && take(mPriority, 'priority')) {
    priority = PRIORITIES[plain(mPriority[2])] || '';
  }

  const mCategory = RE_CATEGORY.exec(text);
  if (mCategory && take(mCategory, 'category')) {
    const raw = mCategory[2];
    // la casse saisie est recalée sur la catégorie existante, si elle existe
    category = categories.find((name) => plain(name) === plain(raw)) || raw;
  }

  // une seule source de jour : le premier motif qui matche l'emporte
  const mIn = RE_IN.exec(text);
  const mRelative = RE_RELATIVE.exec(text);
  const mWeekday = RE_WEEKDAY.exec(text);
  const mDate = RE_DATE.exec(text);

  if (mIn && take(mIn, 'date')) {
    const step = plain(mIn[3]).startsWith('sem') ? 7 : 1;
    day = addDays(atMidnight(now), parseInt(mIn[2], 10) * step);
  } else if (mRelative && take(mRelative, 'date')) {
    const word = plain(mRelative[2]);
    if (word.startsWith('apres-demain')) day = addDays(atMidnight(now), 2);
    else if (word === 'demain') day = addDays(atMidnight(now), 1);
    else day = atMidnight(now);
    // même forme que ses trois branches sœurs : un `take` refusé doit laisser
    // sa chance au motif suivant, pas abandonner la date en silence
  } else if (mWeekday && take(mWeekday, 'date')) {
    const today = atMidnight(now);
    // « mercredi » un mercredi désigne le mercredi suivant, jamais aujourd'hui
    const delta = (WEEKDAYS[plain(mWeekday[2])] - today.getDay() + 7) % 7 || 7;
    day = addDays(today, delta);
  } else if (mDate) {
    const dayNum = parseInt(mDate[2], 10);
    const monthNum = parseInt(mDate[3], 10);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      let year = mDate[4] ? parseInt(mDate[4], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      let candidate = new Date(year, monthNum - 1, dayNum);
      // année omise et date déjà passée : l'utilisateur vise l'année suivante
      if (!mDate[4] && candidate < atMidnight(now)) {
        candidate = new Date(year + 1, monthNum - 1, dayNum);
      }
      // le 31 février déborde sur mars : ce n'était pas une date
      if (candidate.getMonth() === monthNum - 1 && take(mDate, 'date')) day = candidate;
    }
  }

  const mTime = RE_TIME.exec(text);
  if (mTime) {
    const hours = parseInt(mTime[2], 10);
    if (hours <= 23 && take(mTime, 'date')) {
      time = { hours, minutes: mTime[3] ? parseInt(mTime[3], 10) : 0 };
    }
  }

  let dueDate = null;
  if (day || time) {
    const resolved = new Date(day || atMidnight(now));
    resolved.setHours(time ? time.hours : DEFAULT_HOUR, time ? time.minutes : 0, 0, 0);
    // une heure seule déjà passée désigne le lendemain
    const shift = !day && resolved.getTime() <= now.getTime();
    dueDate = (shift ? addDays(resolved, 1) : resolved).toISOString();
  }

  // découpe par la fin : les indices des coupes restantes restent valides
  const title = cuts
    .slice()
    .sort((a, b) => a[0] - b[0])
    .reduceRight((acc, [start, end]) => acc.slice(0, start) + acc.slice(end), text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);

  // les pastilles se lisent dans l'ordre où l'utilisateur a tapé, pas dans
  // celui où le parseur a reconnu : `start` sert au tri, puis disparaît
  const ordered = tokens
    .sort((a, b) => a.start - b.start)
    .map(({ type, text: label }) => ({ type, text: label }));

  return { title, dueDate, category, priority, tokens: ordered };
}
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm run test:ui -- parse
```

Attendu : SUCCÈS, 28 tests.

- [ ] **Step 5 : committer**

```bash
git add public/js/parse.js test/ui/parse.test.js
git commit -m "feat: parseur de saisie rapide en langage naturel"
```

### Limite connue et assumée : `3h` est toujours une heure

`Reunion il y a 3h` garde bien son « a » depuis que seul `à` introduit une heure, mais `3h` reste
lu comme une échéance. C'est irréductible : distinguer « 3h » l'heure de « 3h » la durée demande
de comprendre la phrase, pas de la faire correspondre à un motif. Et `Appel 18h`, sans aucune
préposition, doit continuer de marcher — c'est le cas d'usage principal.

Même parade que ci-dessous : l'aperçu affiche la date résolue, donc l'utilisateur voit
l'échéance qu'il n'a pas demandée avant de valider.

### Limite connue et assumée : `3/4`

`Payer 3/4 du loyer` lit `3/4` comme le 3 avril et sort le fragment du titre. C'est inhérent à
tout motif de date à barre oblique : la seule heuristique qui l'éviterait — refuser deux nombres
inférieurs à 13 sans année ni « le » — tuerait `12/11`, une date parfaitement légitime.

La parade n'est pas dans le parseur, elle est dans l'aperçu : la pastille `3/4` s'affiche sous le
champ **avant** validation, et l'utilisateur voit qu'une date a été comprise là où il n'en
voulait pas. C'est précisément la raison d'être de l'aperçu — ne jamais deviner en silence.

---

## Task 5 : brancher la saisie rapide sur le composeur

**Files:**

- Modify: `public/index.html` (champ titre du composeur)
- Modify: `public/css/components.css`
- Modify: `public/js/app.js` (import, aperçu, soumission)
- Test: `test/ui/app.test.js`

**Décision de conception :** les valeurs lues dans le texte ne remplissent un champ du
formulaire que s'il est **vide**. Un choix explicite fait à la souris l'emporte toujours sur
une déduction faite à partir du texte.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `test/ui/app.test.js` :

```js
describe('saisie rapide', () => {
  const type = (value) => {
    const input = document.getElementById('task-title');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const posted = () => server.calls.filter((c) => c.method === 'POST' && c.url === '/tasks').length;

  test('l’aperçu montre ce qui a été compris', async () => {
    await boot();
    type('Dentiste demain 14h #Perso !haute');
    await settle();

    const chips = [...document.querySelectorAll('#quick-preview .chip')].map((el) =>
      el.textContent.trim()
    );
    expect(chips).toContain('demain');
    expect(chips).toContain('#Perso');
    expect(chips).toContain('!haute');
  });

  test('l’aperçu se vide quand le texte ne contient plus de motif', async () => {
    await boot();
    type('Dentiste demain');
    await settle();
    expect(document.getElementById('quick-preview').hidden).toBe(false);

    type('Dentiste');
    await settle();
    expect(document.getElementById('quick-preview').hidden).toBe(true);
  });

  test('envoyer poste le titre nettoyé et les champs déduits', async () => {
    await boot();
    type('Dentiste demain 14h #Perso !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    const call = server.calls.find((c) => c.method === 'POST' && c.url === '/tasks');
    expect(call).toBeTruthy();
    expect(call.body.title).toBe('Dentiste');
    expect(call.body.category).toBe('Perso');
    expect(call.body.priority).toBe('high');
    expect(call.body.dueDate).not.toBeNull();
  });

  test('un choix fait à la souris l’emporte sur le texte', async () => {
    await boot();
    document.getElementById('task-priority').value = 'low';
    type('Dentiste !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    const call = server.calls.find((c) => c.method === 'POST' && c.url === '/tasks');
    expect(call.body.priority).toBe('low');
  });

  test('un texte qui ne laisse aucun titre n’est pas envoyé', async () => {
    await boot();
    const before = posted();
    type('#Perso !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    expect(posted()).toBe(before);
  });
});
```

Ce bloc a besoin que le faux serveur retienne le corps des requêtes. Dans le `vi.stubGlobal`
de `beforeEach`, remplacer la ligne :

```js
server.calls.push({ url, method });
```

par :

```js
server.calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "saisie rapide"
```

Attendu : ÉCHEC — `#quick-preview` est `null`, `TypeError: Cannot read properties of null (reading 'hidden')`.

- [ ] **Step 3a : ajouter le balisage**

Dans `public/index.html`, remplacer le champ titre du composeur par :

```html
<span class="field" data-sketch="input">
  <input
    type="text"
    id="task-title"
    placeholder="Que dois-tu faire ? (ex. Dentiste demain 14h #Santé !haute)"
    required
    maxlength="200"
  />
</span>
<p class="quick-preview" id="quick-preview" aria-live="polite" hidden></p>
```

Le `maxlength` passe de 120 à 200 : les motifs consommés ne comptent pas dans le titre final,
lui-même tronqué à 120 par le parseur.

- [ ] **Step 3b : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* ------------------------------- saisie rapide ---------------------------- */

.quick-preview {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-1);
  margin: calc(-1 * var(--gap-1)) 0 0;
  font-size: var(--step-xs);
}

.quick-preview[hidden] {
  display: none;
}

.quick-preview .chip {
  padding: 1px 7px;
  color: var(--ink-soft);
  font-family: var(--font-hand);
  font-size: 1rem;
  line-height: 1.3;
}

.quick-preview .chip[data-type='priority'] {
  color: var(--red-pen);
}

.quick-preview .chip[data-type='category'] {
  color: var(--green-pen);
}
```

- [ ] **Step 3c : brancher le parseur**

Dans `public/js/app.js` :

1. Sous l'import de `./api.js`, ajouter :

```js
import { parseQuickEntry } from './parse.js';
```

2. Après `const taskTitleInput = $('task-title');`, ajouter :

```js
const quickPreview = $('quick-preview');
```

3. Avant le gestionnaire `taskForm.addEventListener('submit', …)`, ajouter :

```js
/** Lecture du champ titre : ce que le texte contient en plus du titre lui-même. */
const readComposer = () =>
  parseQuickEntry(taskTitleInput.value, {
    categories: state.categories.map((c) => c.name),
  });

/** L'aperçu rend l'interprétation réfutable avant l'envoi. */
const renderQuickPreview = () => {
  const { tokens } = readComposer();
  quickPreview.innerHTML = tokens
    .map(
      ({ type, text }) =>
        `<span class="chip" data-type="${escapeHtml(type)}">${escapeHtml(text)}</span>`
    )
    .join('');
  quickPreview.hidden = tokens.length === 0;
};

taskTitleInput.addEventListener('input', renderQuickPreview);
```

4. Remplacer le corps du gestionnaire `taskForm.addEventListener('submit', …)` par :

```js
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const parsed = readComposer();
  if (!parsed.title) return;

  try {
    await api.createTask({
      title: parsed.title,
      description: taskDescInput.value.trim(),
      // un choix fait à la souris l'emporte sur ce que le texte laisse deviner
      dueDate: toIso(taskDueInput.value) || parsed.dueDate,
      category: taskCategorySelect.value || parsed.category,
      priority: taskPrioritySelect.value || parsed.priority,
    });
    taskForm.reset();
    renderQuickPreview();
    await refresh({ page: 1 });
    toast('Tâche ajoutée.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm run test:ui
```

Attendu : SUCCÈS.

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Taper `Dentiste demain 14h #Perso !haute` dans le champ, vérifier que les pastilles
apparaissent sous le champ, valider, vérifier la tâche créée (titre nettoyé, échéance à demain
14h, priorité haute). `Ctrl+C` pour arrêter.

- [ ] **Step 6 : committer**

```bash
git add public/index.html public/css/components.css public/js/app.js test/ui/app.test.js
git commit -m "feat: saisie rapide en langage naturel avec apercu"
```

---

## Task 6 : corbeille — routes API

**Files:**

- Modify: `server.js` (après la route `GET /tasks/stats`, et après `POST /tasks/:id/restore`)
- Modify: `public/js/api.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter dans le `describe('Tasks API', …)` :

```js
describe('corbeille', () => {
  /** Crée une tâche puis la supprime ; renvoie son identifiant. */
  const trashed = async (title) => {
    const created = await request(app).post('/tasks').send({ title });
    await request(app).delete(`/tasks/${created.body._id}`);
    return created.body._id;
  };

  test('GET /tasks/trash liste les tâches supprimées, la plus récente en tête', async () => {
    await trashed('premiere');
    await trashed('seconde');
    await request(app).post('/tasks').send({ title: 'vivante' });

    const res = await request(app).get('/tasks/trash');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.tasks.map((t) => t.title)).toEqual(['seconde', 'premiere']);
  });

  test('GET /tasks/trash pagine', async () => {
    await trashed('a');
    await trashed('b');
    await trashed('c');

    const res = await request(app).get('/tasks/trash?limit=2&page=2');
    expect(res.body.totalPages).toBe(2);
    expect(res.body.currentPage).toBe(2);
    expect(res.body.tasks).toHaveLength(1);
  });

  test('« trash » n’est pas confondu avec un identifiant', async () => {
    const res = await request(app).get('/tasks/trash');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
  });

  test('DELETE /tasks/:id/purge supprime définitivement', async () => {
    const id = await trashed('a purger');

    const res = await request(app).delete(`/tasks/${id}/purge`);
    expect(res.status).toBe(200);

    const after = await request(app).get('/tasks/trash');
    expect(after.body.total).toBe(0);

    const restore = await request(app).post(`/tasks/${id}/restore`);
    expect(restore.status).toBe(404);
  });

  test('purger une tâche vivante est refusé', async () => {
    const created = await request(app).post('/tasks').send({ title: 'vivante' });

    const res = await request(app).delete(`/tasks/${created.body._id}/purge`);
    expect(res.status).toBe(404);

    const still = await request(app).get(`/tasks/${created.body._id}`);
    expect(still.status).toBe(200);
  });

  test('les tâches en corbeille ne remontent pas dans GET /tasks', async () => {
    await trashed('supprimee');
    const res = await request(app).get('/tasks?limit=100');
    expect(res.body.tasks).toHaveLength(0);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "corbeille"
```

Attendu : ÉCHEC — `GET /tasks/trash` tombe sur la route `GET /tasks/:id`, Mongo refuse de caster
« trash » en ObjectId, la réponse est `400 { error: 'Identifiant ou valeur invalide' }`.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, juste après la route `GET /tasks/stats` et **avant** `app.get('/tasks', …)` :

```js
// déclaré avant /tasks/:id, sinon « trash » serait pris pour un identifiant
app.get('/tasks/trash', async (req, res) => {
  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(req.query.limit, DEFAULT_LIMIT)));
    const requestedPage = Math.max(1, toInt(req.query.page, 1));
    const filter = { deletedAt: { $ne: null } };

    const total = await Task.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(requestedPage, totalPages);

    const tasks = await Task.find(filter)
      .sort({ deletedAt: -1, _id: -1 })
      .skip((currentPage - 1) * limit)
      .limit(limit);

    res.status(200).json({ tasks, total, totalPages, currentPage });
  } catch (error) {
    fail(res, error);
  }
});
```

Puis, juste après la route `POST /tasks/:id/restore` :

```js
/**
 * Suppression définitive. Réservée à ce qui est déjà dans la corbeille : rien
 * d'irréversible ne doit être atteignable en un seul geste.
 */
app.delete('/tasks/:id/purge', async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, deletedAt: { $ne: null } });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée dans la corbeille' });
    res.status(200).json({ message: 'Tâche supprimée définitivement', task });
  } catch (error) {
    fail(res, error);
  }
});
```

Dans `public/js/api.js`, après `export const restoreTask = …` :

```js
export const listTrash = (query) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) params.set(key, value);
  });
  return request(`tasks/trash?${params}`);
};

export const purgeTask = (id) => request(`tasks/${id}/purge`, { method: 'DELETE' });
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm run test:api
```

Attendu : SUCCÈS.

- [ ] **Step 5 : committer**

```bash
git add server.js public/js/api.js test/api/server.test.js
git commit -m "feat: routes de corbeille (liste et purge definitive)"
```

---

## Task 7 : corbeille — interface

**Files:**

- Modify: `public/index.html` (bouton dans la barre latérale + modale)
- Modify: `public/css/components.css`
- Modify: `public/js/app.js`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Le faux serveur de `test/ui/app.test.js` ne connaît pas encore `/tasks/trash`. Dans `bodyFor`,
ajouter **avant** la ligne `if (url.startsWith('/tasks?'))` :

```js
if (url.startsWith('/tasks/trash')) {
  const tasks = server.trash.map((entry) => entry.task);
  return { tasks, total: tasks.length, totalPages: 1, currentPage: 1 };
}
```

Et dans `mutate`, avant le bloc `if (method === 'DELETE')` :

```js
if (method === 'DELETE' && url.endsWith('/purge')) {
  const purged = url.replace('/tasks/', '').replace('/purge', '');
  server.trash = server.trash.filter((entry) => entry.task._id !== purged);
  return { message: 'Tâche supprimée définitivement' };
}
```

`idFrom` doit ignorer le suffixe `/purge` — remplacer sa définition par :

```js
const idFrom = (url) => url.replace('/tasks/', '').replace('/restore', '').replace('/purge', '');
```

Puis ajouter le bloc de test :

```js
describe('corbeille', () => {
  const trashFirstTask = async () => {
    document.querySelector('.task .delete').click();
    await settle();
  };

  test('ouvrir la corbeille liste les tâches supprimées', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();

    expect(document.getElementById('trash-modal').classList.contains('active')).toBe(true);
    const rows = [...document.querySelectorAll('#trash-list .trash-title')].map((el) =>
      el.textContent.trim()
    );
    expect(rows).toEqual(['Relire le brief']);
  });

  test('restaurer remet la tâche dans la liste', async () => {
    await boot();
    await trashFirstTask();
    expect(titles()).not.toContain('Relire le brief');

    document.getElementById('open-trash').click();
    await settle();
    document.querySelector('#trash-list .trash-restore').click();
    await settle();

    expect(titles()).toContain('Relire le brief');
  });

  test('purger demande confirmation puis supprime définitivement', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();
    document.querySelector('#trash-list .trash-purge').click();
    await settle();

    // premier clic : la ligne passe en mode confirmation, rien n'est envoyé
    expect(server.calls.some((c) => c.url.endsWith('/purge'))).toBe(false);

    document.querySelector('#trash-list .trash-purge').click();
    await settle();

    expect(server.calls.some((c) => c.url.endsWith('/purge'))).toBe(true);
    expect(document.querySelectorAll('#trash-list .trash-row')).toHaveLength(0);
  });

  test('une corbeille vide le dit', async () => {
    await boot();
    document.getElementById('open-trash').click();
    await settle();

    expect(document.getElementById('trash-empty').hidden).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "corbeille"
```

Attendu : ÉCHEC — `document.getElementById('open-trash')` vaut `null`.

- [ ] **Step 3a : ajouter le balisage**

Dans `public/index.html`, remplacer le panneau « Statut » pour y glisser le bouton corbeille
en pied de panneau — ajouter cette ligne juste avant la fermeture `</section>` du panneau « Statut » :

```html
<button
  id="open-trash"
  class="btn trash-open"
  type="button"
  data-sketch="button"
  data-tone="neutral"
>
  Corbeille
</button>
```

Puis, juste avant `<div class="toast-container" …>`, ajouter la modale :

```html
<div
  id="trash-modal"
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="trash-modal-title"
>
  <div class="modal-content modal-content--wide" data-sketch="card">
    <h2 id="trash-modal-title" class="modal-title">Corbeille</h2>
    <p class="modal-text">
      Les tâches supprimées restent ici sept jours, puis disparaissent au démarrage suivant.
    </p>

    <ul id="trash-list" class="trash-list"></ul>
    <p id="trash-empty" class="modal-text" hidden>La corbeille est vide.</p>

    <div class="modal-actions">
      <button id="close-trash" class="btn" type="button" data-sketch="button" data-tone="neutral">
        Fermer
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 3b : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* --------------------------------- corbeille ------------------------------ */

.trash-open {
  margin-top: var(--gap-3);
  width: 100%;
}

.modal-content--wide {
  width: min(560px, 100%);
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: var(--gap-1);
  max-height: 46vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.trash-row {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  padding: var(--gap-1) 0;
  border-bottom: 1px solid var(--rule-line);
}

.trash-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-date {
  color: var(--ink-faint);
  font-size: var(--step-xs);
}

.trash-purge[data-confirm='true'] {
  color: var(--red-pen);
}
```

- [ ] **Step 3c : brancher la logique**

Dans `public/js/app.js` :

1. Après les sélecteurs de `delete-category-modal`, ajouter :

```js
const trashModal = $('trash-modal');
const trashList = $('trash-list');
const trashEmpty = $('trash-empty');
const openTrashBtn = $('open-trash');
const closeTrashBtn = $('close-trash');
```

2. Après la fonction `restoreTask`, ajouter :

```js
/**
 * Contenu de la corbeille. Le deuxième clic sur « Supprimer » confirme :
 * une suppression définitive ne doit jamais tenir en un seul geste.
 */
const renderTrash = (tasks) => {
  unsketchAll(trashList);
  trashList.innerHTML = '';
  trashEmpty.hidden = tasks.length > 0;

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'trash-row';
    li.innerHTML = `
      <span class="trash-title">${escapeHtml(task.title)}</span>
      <span class="trash-date">${escapeHtml(formatDate(task.deletedAt) || '')}</span>
      <button class="btn trash-restore" type="button" data-sketch="button" data-tone="neutral">Restaurer</button>
      <button class="btn trash-purge" type="button" data-sketch="button" data-tone="danger">Supprimer</button>
    `;

    li.querySelector('.trash-restore').addEventListener('click', async () => {
      await restoreTask(task._id);
      await openTrash();
    });

    const purgeBtn = li.querySelector('.trash-purge');
    purgeBtn.addEventListener('click', async () => {
      if (purgeBtn.dataset.confirm !== 'true') {
        purgeBtn.dataset.confirm = 'true';
        setText(purgeBtn, 'Confirmer ?');
        return;
      }
      try {
        await api.purgeTask(task._id);
        await openTrash();
        toast('Tâche supprimée définitivement.', 'info');
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    trashList.appendChild(li);
  });

  sketchAll(trashList);
};

const openTrash = async () => {
  try {
    const { tasks } = await api.listTrash({ page: 1, limit: 50 });
    renderTrash(tasks || []);
    openModal(trashModal);
  } catch (error) {
    toast(error.message, 'error');
  }
};
```

3. Après le gestionnaire `cancelDeleteCategoryBtn`, ajouter :

```js
openTrashBtn.addEventListener('click', () => openTrash());
closeTrashBtn.addEventListener('click', () => closeModal(trashModal));
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Supprimer une tâche, ouvrir la corbeille, restaurer ; supprimer à nouveau, purger (deux clics),
vérifier que la tâche ne revient plus. `Ctrl+C` pour arrêter.

- [ ] **Step 6 : committer**

```bash
git add public/index.html public/css/components.css public/js/app.js test/ui/app.test.js
git commit -m "feat: ecran corbeille avec restauration et purge confirmee"
```

---

## Task 8 : raccourcis clavier et palette de commandes

**Files:**

- Modify: `public/index.html` (modale palette)
- Modify: `public/css/components.css`
- Modify: `public/js/app.js`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `test/ui/app.test.js` :

```js
describe('clavier', () => {
  const press = (key, options = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));

  test('n met le focus sur le champ de saisie', async () => {
    await boot();
    press('n');
    expect(document.activeElement.id).toBe('task-title');
  });

  test('les raccourcis ne se déclenchent pas depuis un champ', async () => {
    await boot();
    const search = document.getElementById('search-input');
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

    expect(document.activeElement.id).toBe('search-input');
  });

  test('j et k déplacent la sélection dans la liste', async () => {
    await boot();
    press('j');
    expect(document.querySelectorAll('.task')[0].classList.contains('is-cursor')).toBe(true);

    press('j');
    expect(document.querySelectorAll('.task')[1].classList.contains('is-cursor')).toBe(true);

    press('k');
    expect(document.querySelectorAll('.task')[0].classList.contains('is-cursor')).toBe(true);
  });

  test('x coche la tâche sous le curseur', async () => {
    await boot();
    press('j');
    press('x');
    await settle();

    const call = server.calls.find((c) => c.method === 'PUT');
    expect(call.body.completed).toBe(true);
  });

  test('Ctrl+K ouvre la palette', async () => {
    await boot();
    press('k', { ctrlKey: true });

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(true);
  });

  test('la palette filtre ses commandes', async () => {
    await boot();
    press('k', { ctrlKey: true });

    const input = document.getElementById('palette-input');
    input.value = 'retard';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const labels = [...document.querySelectorAll('#palette-list .palette-item')].map((el) =>
      el.textContent.trim()
    );
    expect(labels).toEqual(['Voir : en retard']);
  });

  test('choisir une commande de la palette l’exécute et ferme', async () => {
    await boot();
    press('k', { ctrlKey: true });

    const input = document.getElementById('palette-input');
    input.value = 'retard';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#palette-list .palette-item').click();
    await settle();

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(false);
    const url = calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();
    expect(new URL(url, 'http://test').searchParams.get('due')).toBe('overdue');
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "clavier"
```

Attendu : ÉCHEC — `press('n')` ne fait rien, `document.activeElement.id` vaut `''`.

- [ ] **Step 3a : ajouter le balisage**

Dans `public/index.html`, juste avant `<div class="toast-container" …>` :

```html
<div
  id="palette-modal"
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="palette-title"
>
  <div class="modal-content" data-sketch="card">
    <h2 id="palette-title" class="modal-title">Aller à…</h2>
    <span class="field" data-sketch="input">
      <input type="text" id="palette-input" placeholder="Une commande…" autocomplete="off" />
    </span>
    <ul id="palette-list" class="palette-list"></ul>
  </div>
</div>
```

- [ ] **Step 3b : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* --------------------------------- palette -------------------------------- */

.palette-list {
  display: flex;
  flex-direction: column;
  max-height: 44vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.palette-item {
  padding: var(--gap-1) var(--gap-2);
  border: 0;
  background: none;
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--step-md);
  text-align: left;
  cursor: pointer;
}

.palette-item:hover,
.palette-item:focus-visible {
  background: color-mix(in srgb, var(--highlighter) 40%, transparent);
}

.task.is-cursor {
  outline: 2px dashed var(--ink-faint);
  outline-offset: 3px;
}
```

- [ ] **Step 3c : brancher la logique**

Dans `public/js/app.js` :

1. Après les sélecteurs de la corbeille, ajouter :

```js
const paletteModal = $('palette-modal');
const paletteInput = $('palette-input');
const paletteList = $('palette-list');
```

2. Dans l'objet `state`, ajouter `cursor: -1,` après `currentTaskId: null,`.

3. Dans `render()`, juste après `sketchAll(taskList);`, ajouter :

```js
// le curseur clavier survit au rendu tant qu'il reste dans la page
applyCursor();
```

4. Avant la déclaration de `render`, ajouter :

```js
const taskAt = (index) => state.tasks[index] || null;

/**
 * Une frappe partie d'un champ appartient au champ, pas aux raccourcis.
 * `matches` n'existe que sur les éléments : un événement clavier envoyé au
 * document (ce que font les tests) a `document` pour cible, et appeler
 * `document.matches` lèverait une TypeError.
 */
const isTyping = (target) =>
  typeof target?.matches === 'function' && target.matches('input, textarea, select');

const applyCursor = () => {
  const rows = [...taskList.querySelectorAll('.task')];
  rows.forEach((row, index) => row.classList.toggle('is-cursor', index === state.cursor));
};

/** Déplace le curseur clavier, en restant dans les bornes de la page affichée. */
const moveCursor = (delta) => {
  if (state.tasks.length === 0) return;
  const next = Math.min(state.tasks.length - 1, Math.max(0, state.cursor + delta));
  state = { ...state, cursor: state.cursor === -1 && delta > 0 ? 0 : next };
  applyCursor();
};
```

5. Avant le gestionnaire `document.addEventListener('keydown', …)` existant, ajouter la palette :

```js
/** Commandes de la palette : libellé + action. Aucune ne dépend du DOM courant. */
const PALETTE_COMMANDS = [
  { label: 'Nouvelle tâche', run: () => taskTitleInput.focus() },
  { label: 'Chercher', run: () => searchInput.focus() },
  { label: 'Voir : tout', run: () => selectDue('all') },
  { label: 'Voir : en retard', run: () => selectDue('overdue') },
  { label: "Voir : aujourd'hui", run: () => selectDue('today') },
  { label: 'Voir : cette semaine', run: () => selectDue('week') },
  { label: 'Voir : sans date', run: () => selectDue('none') },
  { label: 'Ouvrir la corbeille', run: () => openTrash() },
];

const selectDue = (due) => {
  duePills.find((p) => p.dataset.due === due)?.click();
};

const renderPalette = () => {
  const needle = paletteInput.value.trim().toLowerCase();
  const matches = PALETTE_COMMANDS.filter(({ label }) => label.toLowerCase().includes(needle));

  unsketchAll(paletteList);
  paletteList.innerHTML = '';

  matches.forEach((command) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'palette-item';
    button.textContent = command.label;
    button.addEventListener('click', () => {
      closeModal(paletteModal);
      command.run();
    });
    li.appendChild(button);
    paletteList.appendChild(li);
  });
};

const openPalette = () => {
  paletteInput.value = '';
  renderPalette();
  openModal(paletteModal);
  paletteInput.focus();
};

paletteInput.addEventListener('input', renderPalette);
```

6. Remplacer le gestionnaire `document.addEventListener('keydown', …)` final par :

```js
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    // la palette se referme sur elle-même ; une autre modale garde la main
    // (closeModal ne fait rien si ce n'est pas elle qui est ouverte)
    if (isModalOpen()) {
      closeModal(paletteModal);
      return;
    }
    openPalette();
    return;
  }

  if (isModalOpen()) return;
  // un raccourci d'une lettre ne doit jamais manger une frappe de saisie
  if (isTyping(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const cursorTask = taskAt(state.cursor);

  switch (e.key) {
    case '/':
      e.preventDefault();
      searchInput.focus();
      break;
    case 'n':
      e.preventDefault();
      taskTitleInput.focus();
      break;
    case 'j':
      e.preventDefault();
      moveCursor(1);
      break;
    case 'k':
      e.preventDefault();
      moveCursor(-1);
      break;
    case 'x':
      if (cursorTask) {
        e.preventDefault();
        toggleTask(cursorTask, !cursorTask.completed);
      }
      break;
    case 'e':
      if (cursorTask) {
        e.preventDefault();
        taskList.querySelectorAll('.task .edit')[state.cursor]?.click();
      }
      break;
    case 'Delete':
    case 'Backspace':
      if (cursorTask) {
        e.preventDefault();
        removeTask(cursorTask);
      }
      break;
    default:
      break;
  }
});
```

Le `default: break;` est explicite : sans lui, `eslint` (vague 3) signalera un `switch` sans
cas par défaut.

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : SUCCÈS sur les deux suites.

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Vérifier au clavier : `n`, `/`, `j`/`k` (le curseur pointillé se déplace), `x`, `e`, `Ctrl+K`
puis taper « corbeille » et valider. Vérifier qu'aucun raccourci ne se déclenche pendant la
frappe dans un champ. `Ctrl+C` pour arrêter.

- [ ] **Step 6 : committer**

```bash
git add public/index.html public/css/components.css public/js/app.js test/ui/app.test.js
git commit -m "feat: raccourcis clavier et palette de commandes"
```

---

## Task 8b : découper `app.js`

> **Renuméroté en cours de route : cette tâche passe AVANT la task 8.** Elle était prévue après,
> sur l'idée que les coutures se voient une fois le code écrit. Elles se voient maintenant :
> `app.js` est à 762 lignes après la task 7, et la task 8 lui en ajouterait ~90, soit un
> dépassement du plafond de 800. Découper d'abord évite de gonfler un fichier pour le dégonfler
> juste après, et la task 8 crée alors son module directement.

**Files:**

- Create: `public/js/filters.js`, `public/js/trash.js`
- Modify: `public/js/app.js`
- Test: la suite existante, **sans modification**

**Décision — découper par responsabilité, pas par couche.** Deux blocs sortent proprement, et ce
sont les deux qui sont finis :

| Module       | Contenu                                                                           | Pourquoi il sort seul                                                              |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `filters.js` | `activatePill`, câblage des deux rangées de pastilles, invariant échéance/statut  | Un seul sujet, une seule invariante à tenir, aucune dépendance au rendu des tâches |
| `trash.js`   | `renderTrash`, `openTrash`, la confirmation en deux temps, le rattrapage du focus | Ne touche qu'à sa modale ; ne lit jamais `state`                                   |

`palette.js` ne figure plus ici : la task 8 le crée directement, plutôt que d'écrire son code
dans `app.js` pour l'en extraire ensuite.

`render`, `updateCounters` et `updateEmptyState` **restent** dans `app.js` : ils lisent tous
`state` et le déplacement demanderait de faire circuler l'état, ce qui coûterait plus que ça ne
rapporte à cette taille.

**Le piège à éviter.** `app.js` est un module à effets de bord : l'importer amorce l'application.
Les modules extraits ne doivent donc **jamais** l'importer en retour. Ils reçoivent ce dont ils
ont besoin en arguments — une fonction de rafraîchissement, un accès en lecture à l'état — via
une fonction d'initialisation explicite.

- [ ] **Step 1 : mesurer avant**

```bash
wc -l public/js/*.js
```

Noter le chiffre d'`app.js`. Le seuil de déclenchement était 700 ; il est franchi (762 après la
task 7). Si une mesure future le ramenait sous 700, cette tâche serait à reporter — découper un
fichier qui tient encore est du travail pour rien.

- [ ] **Step 2 : déplacer, sans rien réécrire**

Déplacer le code tel quel, en passant les dépendances en arguments plutôt qu'en important `app.js`
(qui est un module à effets de bord : l'importer relancerait l'application).

- [ ] **Step 3 : la suite doit rester verte, sans être touchée**

```bash
npm test
```

Attendu : exactement les mêmes nombres qu'avant le découpage. **Si un test doit être modifié, le
découpage a changé un comportement : revenir en arrière.** C'est le seul critère d'acceptation
de cette tâche.

- [ ] **Step 4 : committer**

```bash
git add public/js/
git commit -m "refactor: sortir les filtres et la palette de app.js"
```

---

## Task 9 : mettre le README à jour

**Files:**

- Modify: `README.md` (sections « Fonctionnalités », « API », « Paramètres de GET /tasks », « Structure »)

- [ ] **Step 1 : ajouter les nouvelles fonctionnalités**

Dans la section « Fonctionnalités », ajouter :

```markdown
- **Vues temporelles** : tout / en retard / aujourd'hui / cette semaine / sans date, avec
  compteur de retard — les horizons sont emboîtés, une tâche en retard reste visible dans
  « aujourd'hui » et « cette semaine »
- **Saisie rapide** : `Dentiste demain 14h #Santé !haute` est lu à la volée, avec aperçu de ce
  qui a été compris avant validation
- **Corbeille** consultable : restaurer ou supprimer définitivement (en deux clics)
- **Clavier** : `n` saisir · `/` chercher · `j`/`k` naviguer · `x` cocher · `e` modifier ·
  `Suppr` supprimer · `Ctrl+K` palette de commandes
```

- [ ] **Step 2 : compléter le tableau des paramètres de `GET /tasks`**

Ajouter la ligne :

```markdown
| `due` | `all`, `overdue`, `today`, `week`, `none` — horizons emboîtés | `all` |
```

- [ ] **Step 3 : compléter le tableau de l'API**

Ajouter les lignes :

```markdown
| `GET` | `/tasks/trash` | Liste paginée de la corbeille |
| `DELETE` | `/tasks/:id/purge` | Supprime définitivement (corbeille seulement) |
```

Et préciser, sous le tableau, que `GET /tasks/stats` renvoie désormais `overdue`.

- [ ] **Step 4 : ajouter `parse.js` à l'arborescence**

Dans le bloc « Structure », sous `public/js/`, ajouter :

```
│       ├── parse.js         # Saisie rapide (module pur, horloge injectable)
```

Et sous `test/` :

```
│   └── ui/parse.test.js    # Parseur de saisie rapide, horloge figée
```

- [ ] **Step 5 : committer**

```bash
git add README.md
git commit -m "docs: documenter les vues temporelles, la saisie rapide et la corbeille"
```

---

## Vérification finale de la vague

- [ ] `npm test` — les deux suites vertes.
- [ ] `npm start` puis parcours complet : créer une tâche en saisie rapide, la voir apparaître
      dans le bon onglet temporel, la cocher au clavier, la supprimer, la restaurer depuis la
      corbeille, la purger.
- [ ] `git log --oneline` — un commit par tâche, aucun commit qui mélange deux sujets.
- [ ] Relire `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, section
      « Critères d'acceptation — Vague 1 », et cocher chaque ligne.
