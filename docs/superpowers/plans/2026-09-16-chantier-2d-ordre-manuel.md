# Chantier 2d — Ordre manuel : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pouvoir ranger ses tâches dans l'ordre qu'on veut, et déplacer une ligne à la souris.

**Architecture :** indexation fractionnaire. Déposer une tâche entre deux voisines lui donne le
rang moyen des deux, ce qui coûte **une seule écriture** au lieu de renuméroter la liste. Le
calcul est une fonction pure dans `lib/`, le serveur expose `PATCH /tasks/:id/order`, et le
glisser-déposer n'est actif que sous le tri manuel.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, JS vanilla (API HTML5 drag & drop),
Jest + Supertest, Vitest. Le champ `order` est déjà en base (migration du chantier 2a).

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 2.4.

---

## Décisions arrêtées avant d'écrire une ligne

**1. Indexation fractionnaire, pas renumérotation.** Déposer entre les rangs `a` et `b` donne
`(a + b) / 2`. Renuméroter toute la liste à chaque déplacement demanderait autant d'écritures
que de tâches, pour un geste qui n'en concerne qu'une.

**2. Renumérotation seulement quand les flottants s'épuisent.** Couper l'intervalle en deux à
chaque fois finit par buter sur la précision des flottants. Quand l'écart entre deux voisines
tombe sous `1e-6`, on renumérote **toute la liste** par pas de 1024, une bonne fois. Ce cas
demande une cinquantaine de dépôts au même endroit : il est rare, mais il arrive, et sans lui
deux tâches finiraient par partager le même rang.

**3. Le glisser-déposer n'est actif que sous le tri manuel.** Réordonner à la main une liste
triée par priorité produirait un ordre qu'on ne reverrait jamais — le tri le réécraserait au
prochain chargement. Sous un autre tri, les lignes ne sont pas saisissables.

**4. Le serveur reçoit les voisines, pas un rang.** `PATCH /tasks/:id/order` prend
`{ before, after }`, les identifiants des tâches qui encadrent le point de dépôt. C'est le
serveur qui calcule le rang : lui laisser ce calcul évite qu'un client mal synchronisé pose un
rang déjà pris.

**5. Le tri manuel ne s'applique qu'aux racines.** Les étapes gardent leur propre ordre au sein
de leur parent, déjà rendu par `GET /tasks/:id/children`.

---

## Task 1 : le calcul du rang

**Files:**
- Create: `lib/ordering.js`
- Create: `test/server/ordering.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/server/ordering.test.js` :

```js
const { rankBetween, NEEDS_RENUMBER, STEP } = require('../../lib/ordering');

describe('rankBetween', () => {
  test('entre deux voisines, le rang du milieu', () => {
    expect(rankBetween(100, 200)).toBe(150);
  });

  test('en tête de liste, un rang en dessous de la première', () => {
    expect(rankBetween(null, 100)).toBe(100 - STEP);
  });

  test('en fin de liste, un rang au-dessus de la dernière', () => {
    expect(rankBetween(100, null)).toBe(100 + STEP);
  });

  test('dans une liste vide, un rang de départ', () => {
    expect(rankBetween(null, null)).toBe(0);
  });

  test('deux voisines trop proches demandent une renumérotation', () => {
    // couper l'intervalle en deux finit par buter sur la précision des
    // flottants : sous ce seuil, deux tâches partageraient le même rang
    expect(rankBetween(1, 1 + 1e-9)).toBe(NEEDS_RENUMBER);
  });

  test('deux voisines identiques demandent une renumérotation', () => {
    expect(rankBetween(42, 42)).toBe(NEEDS_RENUMBER);
  });

  test('des voisines dans le désordre demandent une renumérotation', () => {
    // le client a envoyé un encadrement incohérent : on ne devine pas
    expect(rankBetween(200, 100)).toBe(NEEDS_RENUMBER);
  });
});

describe('renumber', () => {
  const { renumber } = require('../../lib/ordering');

  test('réécrit les rangs par pas réguliers, en gardant l’ordre', () => {
    const rangs = renumber(['a', 'b', 'c']);

    expect(rangs).toEqual([
      { _id: 'a', order: 0 },
      { _id: 'b', order: STEP },
      { _id: 'c', order: 2 * STEP },
    ]);
  });

  test('une liste vide ne produit rien', () => {
    expect(renumber([])).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/ordering.test.js
```

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/ordering.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — ordre manuel : indexation fractionnaire.

   Déposer entre deux voisines donne le rang moyen des deux : une seule
   écriture, au lieu d'en faire autant que la liste compte de tâches.
   --------------------------------------------------------------------------- */

/** Écart posé en bout de liste, et pas de la renumérotation complète. */
const STEP = 1024;

/**
 * Seuil en dessous duquel couper encore l'intervalle n'a plus de sens : les
 * flottants n'ont plus assez de précision, et deux tâches finiraient par
 * partager le même rang.
 */
const MIN_GAP = 1e-6;

/** Renvoyé quand la liste doit être renumérotée avant de pouvoir insérer. */
const NEEDS_RENUMBER = Symbol('renumber');

/**
 * Rang à donner à une tâche déposée entre deux voisines.
 * @param {number|null} avant rang de la voisine du dessus, null en tête
 * @param {number|null} apres rang de la voisine du dessous, null en fin
 * @returns {number|symbol} le rang, ou NEEDS_RENUMBER si l'intervalle est épuisé
 */
const rankBetween = (avant, apres) => {
  if (avant === null || avant === undefined) {
    return apres === null || apres === undefined ? 0 : apres - STEP;
  }
  if (apres === null || apres === undefined) return avant + STEP;

  // un encadrement incohérent n'est pas devinable : on renumérote plutôt que
  // de poser un rang au hasard
  if (apres - avant < MIN_GAP) return NEEDS_RENUMBER;

  return (avant + apres) / 2;
};

/**
 * Rangs réguliers pour une liste entière, dans l'ordre donné.
 * @param {string[]} ids
 * @returns {{_id: string, order: number}[]}
 */
const renumber = (ids) => ids.map((_id, index) => ({ _id, order: index * STEP }));

module.exports = { STEP, MIN_GAP, NEEDS_RENUMBER, rankBetween, renumber };
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/ordering.test.js
```

- [ ] **Step 5 : committer**

```bash
git add lib/ordering.js test/server/ordering.test.js
git commit -m "feat: calcul de rang par indexation fractionnaire"
```

---

## Task 2 : le tri manuel et la route de déplacement

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js` :

```js
describe('Ordre manuel', () => {
  /** Crée trois tâches et renvoie leurs identifiants dans l'ordre de création. */
  const trois = async () => {
    const ids = [];
    for (const titre of ['A', 'B', 'C']) {
      const res = await request(app).post('/tasks').send({ title: titre });
      ids.push(res.body._id);
    }
    return ids;
  };

  const ordreManuel = async () => {
    const res = await request(app).get('/tasks?limit=50&sort=manual');
    return res.body.tasks.map((t) => t.title);
  };

  test('sort=manual trie par rang croissant', async () => {
    await trois();

    // à la création, le rang suit l'ordre d'écriture
    expect(await ordreManuel()).toEqual(['A', 'B', 'C']);
  });

  test('PATCH /tasks/:id/order déplace une tâche entre deux voisines', async () => {
    const [a, b, c] = await trois();

    // on remonte C entre A et B
    const res = await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    expect(res.status).toBe(200);
    expect(await ordreManuel()).toEqual(['A', 'C', 'B']);
  });

  test('déplacer en tête de liste', async () => {
    const [a, , c] = await trois();

    await request(app).patch(`/tasks/${c}/order`).send({ before: null, after: a });

    expect(await ordreManuel()).toEqual(['C', 'A', 'B']);
  });

  test('déplacer en fin de liste', async () => {
    const [a, , c] = await trois();

    await request(app).patch(`/tasks/${a}/order`).send({ before: c, after: null });

    expect(await ordreManuel()).toEqual(['B', 'C', 'A']);
  });

  test('un déplacement ne produit qu’une écriture', async () => {
    const [a, b, c] = await trois();
    const avant = await request(app).get('/tasks?limit=50&sort=manual');
    const rangsAvant = Object.fromEntries(avant.body.tasks.map((t) => [t.title, t.order]));

    await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    const apres = await request(app).get('/tasks?limit=50&sort=manual');
    const rangsApres = Object.fromEntries(apres.body.tasks.map((t) => [t.title, t.order]));
    // A et B n'ont pas bougé : seule la tâche déplacée est réécrite
    expect(rangsApres.A).toBe(rangsAvant.A);
    expect(rangsApres.B).toBe(rangsAvant.B);
    expect(rangsApres.C).not.toBe(rangsAvant.C);
  });

  test('un identifiant de voisine inconnu est refusé', async () => {
    const [, , c] = await trois();
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app).patch(`/tasks/${c}/order`).send({ before: fantome, after: null });

    expect(res.status).toBe(400);
  });

  test('l’intervalle épuisé déclenche une renumérotation, et l’ordre est conservé', async () => {
    const [a, b, c] = await trois();
    // on colle A et B à un cheveu l'un de l'autre
    await mongoose.connection
      .collection('tasks')
      .updateOne({ title: 'A' }, { $set: { order: 1 } });
    await mongoose.connection
      .collection('tasks')
      .updateOne({ title: 'B' }, { $set: { order: 1 + 1e-9 } });

    const res = await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    expect(res.status).toBe(200);
    expect(await ordreManuel()).toEqual(['A', 'C', 'B']);
    // et les rangs sont de nouveau espacés : le prochain dépôt tiendra
    const apres = await request(app).get('/tasks?limit=50&sort=manual');
    const rangs = apres.body.tasks.map((t) => t.order);
    expect(rangs[1] - rangs[0]).toBeGreaterThan(1);
  });

  test('déplacer une tâche qui n’existe pas répond 404', async () => {
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app).patch(`/tasks/${fantome}/order`).send({ before: null, after: null });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Ordre manuel"
```

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, importer :

```js
const { NEEDS_RENUMBER, rankBetween, renumber } = require('./lib/ordering');
```

Ajouter `manual` aux tris :

```js
const SORTS = {
  creation: { createdAt: -1, _id: -1 },
  dueDate: { noDue: 1, dueDate: 1, _id: 1 },
  priority: { priorityRank: 1, createdAt: -1, _id: -1 },
  // `_id` départage : sans lui, deux rangs égaux rendraient la page instable
  manual: { order: 1, _id: 1 },
};
```

Ajouter la route, **avant** `app.get('/tasks/:id', …)` :

```js
/**
 * Déplace une tâche dans l'ordre manuel.
 *
 * Le client envoie les **voisines** du point de dépôt, pas un rang : c'est le
 * serveur qui calcule, ce qui évite qu'un client en retard d'un rafraîchissement
 * pose un rang déjà pris.
 */
app.patch('/tasks/:id/order', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, deletedAt: null });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });

    const lireRang = async (id) => {
      if (!id) return null;
      const voisine = await Task.findOne({ _id: id, deletedAt: null }).select('order').lean();
      if (!voisine) return undefined;
      return voisine.order;
    };

    const avant = await lireRang(asString(req.body?.before, 32) || null);
    const apres = await lireRang(asString(req.body?.after, 32) || null);
    if (avant === undefined || apres === undefined) {
      return res.status(400).json({ error: 'Voisine introuvable : la liste a dû changer.' });
    }

    let rang = rankBetween(avant, apres);

    if (rang === NEEDS_RENUMBER) {
      // l'intervalle est épuisé : on réécrit toute la liste une bonne fois,
      // puis on recalcule le point de dépôt sur les rangs frais
      const racines = await Task.find({ parentId: null, deletedAt: null })
        .sort({ order: 1, _id: 1 })
        .select('_id')
        .lean();

      await Task.bulkWrite(
        renumber(racines.map((t) => String(t._id))).map(({ _id, order }) => ({
          updateOne: { filter: { _id }, update: { $set: { order } } },
        }))
      );

      const avantFrais = await lireRang(asString(req.body?.before, 32) || null);
      const apresFrais = await lireRang(asString(req.body?.after, 32) || null);
      rang = rankBetween(avantFrais, apresFrais);
    }

    task.order = rang;
    await task.save();

    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: tri manuel et deplacement d'une tache"
```

---

## Task 3 : le glisser-déposer

**Files:**
- Modify: `public/js/api.js`, `public/js/app.js`, `public/index.html`, `public/css/components.css`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : ajouter l'option de tri au balisage**

Dans `public/index.html`, dans le `<select id="sort-select">`, après les options existantes :

```html
              <option value="manual">Tri : manuel</option>
```

- [ ] **Step 2 : écrire le test qui échoue**

happy-dom ne simule pas un vrai glisser-déposer : le test déclenche les événements à la main,
ce qui vérifie le câblage et le calcul des voisines — le geste physique, lui, se vérifie à
l'œil.

Ajouter à `test/ui/app.test.js` :

```js
describe('glisser-déposer', () => {
  const dragTo = (source, cible) => {
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    cible.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    cible.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    source.dispatchEvent(new Event('dragend', { bubbles: true }));
  };

  test('les lignes ne sont saisissables que sous le tri manuel', async () => {
    server.tasks = [task('A'), task('B')];
    await boot();

    expect(document.querySelector('.task').draggable).toBe(false);

    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(document.querySelector('.task').draggable).toBe(true);
  });

  test('déposer une ligne envoie ses voisines au serveur', async () => {
    server.tasks = [task('A'), task('B'), task('C')];
    await boot();
    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    server.calls = [];

    const lignes = document.querySelectorAll('.task');
    dragTo(lignes[2], lignes[0]);
    await settle();

    const appel = server.calls.find((c) => c.method === 'PATCH');
    expect(appel.url).toBe('/tasks/id-C/order');
    // déposé sur la première ligne : il n'y a personne au-dessus
    expect(appel.body).toEqual({ before: null, after: 'id-A' });
  });

  test('déposer une ligne sur elle-même ne demande rien au serveur', async () => {
    server.tasks = [task('A'), task('B')];
    await boot();
    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    server.calls = [];

    const ligne = document.querySelector('.task');
    dragTo(ligne, ligne);
    await settle();

    expect(server.calls.find((c) => c.method === 'PATCH')).toBeUndefined();
  });
});
```

Le faux serveur doit accepter `PATCH` : dans `mutate`, ajouter avant le `return {}` final :

```js
  if (method === 'PATCH' && url.endsWith('/order')) {
    return { message: 'ordre mis à jour' };
  }
```

- [ ] **Step 3 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "glisser-déposer"
```

- [ ] **Step 4 : ajouter le client HTTP**

Dans `public/js/api.js` :

```js
/** Déplace une tâche : le serveur reçoit les voisines, pas un rang. */
export const moveTask = (id, voisines) =>
  request(`/tasks/${id}/order`, { method: 'PATCH', body: voisines });
```

> Adapte à la forme réelle du helper du module.

- [ ] **Step 5 : ajouter le style**

```css
/* ----------------------------- glisser-déposer ---------------------------- */

.task[draggable='true'] {
  cursor: grab;
}

.task.is-dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.task.is-drop-target {
  /* un trait d'encre marque où la ligne va tomber */
  box-shadow: inset 0 3px 0 -1px var(--ink);
}
```

- [ ] **Step 6 : brancher la logique**

Dans `public/js/app.js`, dans la construction d'une ligne, poser l'attribut selon le tri :

```js
  // réordonner à la main une liste triée par priorité produirait un ordre
  // que le tri réécraserait au prochain chargement
  const saisissable = state.sort === 'manual';
```

et sur l'élément de ligne : `draggable="${saisissable}"`.

Ajouter le câblage, en délégation sur la liste :

```js
let tireeId = null;

taskList.addEventListener('dragstart', (e) => {
  const ligne = e.target.closest('.task');
  if (!ligne || state.sort !== 'manual') return;
  tireeId = ligne.dataset.id;
  ligne.classList.add('is-dragging');
});

taskList.addEventListener('dragover', (e) => {
  if (!tireeId) return;
  e.preventDefault();
  const ligne = e.target.closest('.task');
  taskList.querySelectorAll('.is-drop-target').forEach((l) => l.classList.remove('is-drop-target'));
  if (ligne) ligne.classList.add('is-drop-target');
});

taskList.addEventListener('drop', async (e) => {
  e.preventDefault();
  const cible = e.target.closest('.task');
  if (!cible || !tireeId || cible.dataset.id === tireeId) return;

  // les voisines sont lues dans le DOM affiché : c'est ce que l'utilisateur
  // a sous les yeux au moment où il lâche
  const lignes = [...taskList.querySelectorAll('.task')].filter((l) => l.dataset.id !== tireeId);
  const index = lignes.indexOf(cible);

  try {
    await api.moveTask(tireeId, {
      before: index > 0 ? lignes[index - 1].dataset.id : null,
      after: cible.dataset.id,
    });
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
});

taskList.addEventListener('dragend', () => {
  tireeId = null;
  taskList.querySelectorAll('.is-dragging, .is-drop-target').forEach((l) => {
    l.classList.remove('is-dragging', 'is-drop-target');
  });
});
```

- [ ] **Step 7 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 8 : vérifier à l'œil**

```bash
npm start
```

Choisir « Tri : manuel », déplacer une ligne : le trait d'encre montre où elle tombera, et
l'ordre tient après rechargement. Sous « Tri : création », les lignes ne doivent pas se saisir.

- [ ] **Step 9 : committer**

```bash
git add public/ test/ui/app.test.js
git commit -m "feat: reordonner les taches au glisser-deposer"
```

---

## Task 4 : documenter

- [ ] **Step 1 : fonctionnalité et API**

```markdown
- **Ordre manuel** : tri « manuel » et glisser-déposer — un déplacement ne produit qu'une
  écriture serveur, grâce à une indexation fractionnaire
```

```markdown
| `PATCH`  | `/tasks/:id/order`        | Déplace une tâche entre deux voisines           |
```

- [ ] **Step 2 : committer**

```bash
git add README.md
git commit -m "docs: documenter l'ordre manuel"
```
