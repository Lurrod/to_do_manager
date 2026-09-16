# Chantier 2b — Récurrence : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** qu'une tâche qui revient ne soit pas à réécrire chaque fois. « Sortir les poubelles »
se coche le mardi et réapparaît pour le mardi suivant.

**Architecture :** le calcul de la date suivante est une **fonction pure** dans `lib/`, testée
sans base ni horloge réelle. Le serveur s'en sert au moment où une tâche récurrente est cochée :
il la termine et crée immédiatement son successeur. Pas de planificateur, pas de tâche de fond.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, JS vanilla, Jest + Supertest, Vitest.
Aucune dépendance nouvelle. Le champ `recurrence` est déjà en base (migration du chantier 2a).

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 2.2.

---

## Structure des fichiers

| Fichier | Rôle | Chantier 2b |
|---------|------|-------------|
| `lib/recurrence.js` | Calcul de la date suivante — **fonction pure** | **Créé** |
| `server.js` | API Express | **Modifié** : validation, régénération à la complétion |
| `public/js/app.js` | Rendu et composeur | **Modifié** : champ de récurrence, pictogramme |
| `public/index.html` | Balisage | **Modifié** : sélecteur de récurrence |
| `public/css/components.css` | Styles | **Modifié** : pictogramme |
| `test/server/recurrence.test.js` | Jest, unitaire, sans base | **Créé** |
| `test/api/server.test.js` | Jest + Supertest | **Modifié** |
| `test/ui/app.test.js` | Vitest | **Modifié** |
| `README.md` | Documentation | **Modifié** |

---

## Décisions arrêtées avant d'écrire une ligne

**1. Régénération à la complétion, pas par planificateur.** Quand une tâche récurrente est
cochée, le serveur la termine et crée **immédiatement** la suivante. Un planificateur
supposerait que le processus tourne le jour J ; c'est un outil de bureau qu'on n'allume pas
tous les jours, et il produirait des trous dans la série.

**2. La date suivante part de l'échéance précédente, pas de la date de complétion.** Une
hebdomadaire cochée avec trois jours de retard replanifie sur le mardi suivant, pas sur le
vendredi. Sinon la série dérive d'un cran à chaque retard et « tous les mardis » finit par
tomber n'importe quand.

**3. Une récurrence exige une échéance.** Sans `dueDate`, il n'y a rien à faire avancer :
`freq` non vide sans `dueDate` est refusé en `400`, à la création comme à la modification.
Le refus est explicite plutôt que silencieux — une récurrence qui ne se déclenche jamais est
pire qu'une récurrence refusée.

**4. Le mois se cale sur la fin de mois.** Le 31 janvier + 1 mois donne le **28 (ou 29) février**,
pas le 3 mars. `setMonth` en JavaScript déborde silencieusement : une échéance mensuelle posée
un 31 sauterait un mois sur deux. Le calcul rabat sur le dernier jour du mois visé.

**5. Le successeur reprend les étapes, décochées.** Une récurrence sans sa liste d'étapes n'est
pas la même tâche : « faire les courses » qui revient sans sa liste ne sert à rien. Les étapes
sont recopiées (titre, description, catégorie, priorité, ordre), remises à zéro.
Point non tranché par la spec, tranché ici.

**6. La série n'est pas matérialisée à l'avance.** Une seule instance vivante à la fois. Les
occurrences passées restent en base, cochées : c'est l'historique.

**7. Si la date suivante dépasse `until`, rien n'est créé.** La tâche cochée reste cochée, la
série s'arrête d'elle-même.

---

## Task 1 : le calcul de la date suivante

**Files:**
- Create: `lib/recurrence.js`
- Create: `test/server/recurrence.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/server/recurrence.test.js` :

```js
const { nextDueDate } = require('../../lib/recurrence');

/** Date locale lisible, pour que les tests ne dépendent pas du fuseau. */
const d = (iso) => new Date(iso);

describe('nextDueDate', () => {
  test('sans récurrence, il n’y a pas de suite', () => {
    expect(nextDueDate(d('2026-09-15T09:00:00'), { freq: '', interval: 1, until: null })).toBeNull();
  });

  test('quotidienne : le lendemain, à la même heure', () => {
    const suite = nextDueDate(d('2026-09-15T09:30:00'), { freq: 'daily', interval: 1, until: null });
    expect(suite.getFullYear()).toBe(2026);
    expect(suite.getMonth()).toBe(8);
    expect(suite.getDate()).toBe(16);
    expect(suite.getHours()).toBe(9);
    expect(suite.getMinutes()).toBe(30);
  });

  test('l’intervalle saute d’autant de pas', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), { freq: 'daily', interval: 3, until: null });
    expect(suite.getDate()).toBe(18);
  });

  test('hebdomadaire : sept jours plus tard, même jour de la semaine', () => {
    const depart = d('2026-09-15T09:00:00'); // un mardi
    const suite = nextDueDate(depart, { freq: 'weekly', interval: 1, until: null });
    expect(suite.getDay()).toBe(depart.getDay());
    expect(suite.getDate()).toBe(22);
  });

  test('mensuelle : le même quantième le mois suivant', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), { freq: 'monthly', interval: 1, until: null });
    expect(suite.getMonth()).toBe(9);
    expect(suite.getDate()).toBe(15);
  });

  test('mensuelle depuis un 31 : rabattue sur la fin du mois visé, pas débordée', () => {
    // sans garde, setMonth ferait glisser le 31 janvier au 3 mars
    const suite = nextDueDate(d('2026-01-31T09:00:00'), { freq: 'monthly', interval: 1, until: null });
    expect(suite.getMonth()).toBe(1);
    expect(suite.getDate()).toBe(28);
  });

  test('mensuelle depuis un 31 vers un mois de 30 jours', () => {
    const suite = nextDueDate(d('2026-08-31T09:00:00'), { freq: 'monthly', interval: 1, until: null });
    expect(suite.getMonth()).toBe(8);
    expect(suite.getDate()).toBe(30);
  });

  test('une date suivante au-delà de `until` arrête la série', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'weekly',
      interval: 1,
      until: d('2026-09-20T00:00:00'),
    });
    expect(suite).toBeNull();
  });

  test('`until` le jour même de la suite laisse passer', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'daily',
      interval: 1,
      until: d('2026-09-16T23:59:59'),
    });
    expect(suite).not.toBeNull();
  });

  test('sans échéance de départ, il n’y a rien à faire avancer', () => {
    expect(nextDueDate(null, { freq: 'daily', interval: 1, until: null })).toBeNull();
  });

  test('une fréquence inconnue ne produit rien plutôt qu’une date fausse', () => {
    expect(nextDueDate(d('2026-09-15T09:00:00'), { freq: 'yearly', interval: 1, until: null })).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/recurrence.test.js
```

Attendu : ÉCHEC — `Cannot find module '../../lib/recurrence'`.

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/recurrence.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — récurrence : à quelle date revient une tâche qu'on vient de cocher.
   Fonction pure, sans base ni horloge : la date de départ est toujours donnée.
   --------------------------------------------------------------------------- */

const FREQUENCES = ['daily', 'weekly', 'monthly'];

/** Nombre de jours du mois visé, pour ne pas déborder sur le suivant. */
const dernierJourDuMois = (annee, mois) => new Date(annee, mois + 1, 0).getDate();

/**
 * Échéance suivante d'une tâche récurrente.
 *
 * Le calcul part de l'échéance **précédente**, jamais de la date de
 * complétion : sinon une hebdomadaire cochée avec trois jours de retard
 * replanifierait sur le vendredi, et « tous les mardis » dériverait à chaque
 * retard.
 *
 * @param {Date|string|null} depart échéance de l'occurrence qu'on vient de cocher
 * @param {{freq: string, interval: number, until: Date|string|null}} recurrence
 * @returns {Date|null} la date suivante, ou null s'il n'y a pas de suite
 *   (pas de récurrence, pas d'échéance de départ, fréquence inconnue, ou
 *   série arrivée au bout de `until`)
 */
const nextDueDate = (depart, recurrence) => {
  if (!depart || !recurrence || !FREQUENCES.includes(recurrence.freq)) return null;

  const pas = Math.max(1, Math.min(99, Number(recurrence.interval) || 1));
  const suite = new Date(depart);

  if (recurrence.freq === 'daily') {
    suite.setDate(suite.getDate() + pas);
  } else if (recurrence.freq === 'weekly') {
    suite.setDate(suite.getDate() + 7 * pas);
  } else {
    // `setMonth` déborde en silence : le 31 janvier + 1 mois donnerait le
    // 3 mars. On vise le mois, puis on rabat le quantième sur sa fin.
    const quantieme = suite.getDate();
    suite.setDate(1);
    suite.setMonth(suite.getMonth() + pas);
    suite.setDate(Math.min(quantieme, dernierJourDuMois(suite.getFullYear(), suite.getMonth())));
  }

  if (recurrence.until && suite > new Date(recurrence.until)) return null;

  return suite;
};

module.exports = { FREQUENCES, nextDueDate };
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/recurrence.test.js
```

Attendu : SUCCÈS, 11 tests.

- [ ] **Step 5 : committer**

```bash
git add lib/recurrence.js test/server/recurrence.test.js
git commit -m "feat: calcul de l'echeance suivante d'une tache recurrente"
```

---

## Task 2 : une récurrence exige une échéance

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js`, comme nouveau bloc de premier niveau :

```js
describe('Récurrence', () => {
  const dans = (jours, heure = 9) => {
    const d = new Date();
    d.setHours(heure, 0, 0, 0);
    d.setDate(d.getDate() + jours);
    return d.toISOString();
  };

  test('POST /tasks accepte une récurrence avec une échéance', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Sortir les poubelles',
        dueDate: dans(1),
        recurrence: { freq: 'weekly', interval: 1, until: null },
      });

    expect(res.status).toBe(201);
    expect(res.body.recurrence.freq).toBe('weekly');
  });

  test('une récurrence sans échéance est refusée', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sans ancrage', recurrence: { freq: 'daily', interval: 1, until: null } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/échéance/i);
  });

  test('retirer l’échéance d’une tâche récurrente est refusé', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Récurrente', dueDate: dans(1), recurrence: { freq: 'daily', interval: 1, until: null } });

    const res = await request(app).put(`/tasks/${creee.body._id}`).send({ dueDate: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/échéance/i);
  });

  test('une fréquence inconnue est refusée', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Bizarre', dueDate: dans(1), recurrence: { freq: 'yearly', interval: 1, until: null } });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Récurrence"
```

Attendu : ÉCHEC — `recurrence` est ignoré (absent de la liste blanche), aucun refus.

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, ajouter `recurrence` à la liste blanche :

```js
const CREATE_FIELDS = [
  'title',
  'description',
  'dueDate',
  'category',
  'priority',
  'parentId',
  'recurrence',
];
```

Ajouter, à côté de `parentageInvalide` :

```js
/**
 * Une récurrence a besoin d'une échéance : c'est elle qu'on fait avancer.
 * Le contrôle porte sur l'état APRÈS modification, d'où les deux arguments —
 * retirer l'échéance d'une tâche déjà récurrente est aussi un refus.
 * @returns {string|null} le message d'erreur, ou null
 */
const recurrenceInvalide = (champsApres) => {
  const freq = champsApres?.recurrence?.freq;
  if (!freq) return null;
  if (!champsApres.dueDate) {
    return 'Une récurrence a besoin d’une échéance : c’est elle qui avance.';
  }
  return null;
};
```

Dans `POST /tasks`, après le contrôle de parentage :

```js
    const refusRecurrence = recurrenceInvalide(champs);
    if (refusRecurrence) return res.status(400).json({ error: refusRecurrence });
```

Dans `PUT /tasks/:id`, après le contrôle de parentage :

```js
    // le contrôle porte sur l'état résultant, pas sur la seule modification :
    // retirer l'échéance d'une tâche déjà récurrente la laisserait sans ancrage
    const avant = await Task.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!avant) return res.status(404).json({ error: 'Tâche non trouvée' });

    const refusRecurrence = recurrenceInvalide({ ...avant, ...champs });
    if (refusRecurrence) return res.status(400).json({ error: refusRecurrence });
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: une recurrence exige une echeance"
```

---

## Task 3 : cocher une récurrente crée la suivante

**Files:**
- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter **dans** le `describe('Récurrence', …)` :

```js
  /** Crée une tâche récurrente et renvoie le corps de la réponse. */
  const recurrente = async (extra = {}) => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Sortir les poubelles',
        dueDate: dans(1),
        recurrence: { freq: 'weekly', interval: 1, until: null },
        ...extra,
      });
    return res.body;
  };

  test('cocher une récurrente crée la suivante', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    expect(suivante).toBeDefined();
    expect(suivante._id).not.toBe(tache._id);
    expect(suivante.completed).toBe(false);
  });

  test('la suivante est calée sur l’échéance précédente, pas sur aujourd’hui', async () => {
    // échéance il y a trois jours : cochée en retard
    const tache = await recurrente({ dueDate: dans(-3) });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    const attendue = new Date(tache.dueDate);
    attendue.setDate(attendue.getDate() + 7);
    expect(new Date(suivante.dueDate).toISOString()).toBe(attendue.toISOString());
  });

  test('l’occurrence cochée reste en place, cochée', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const ancienne = await request(app).get(`/tasks/${tache._id}`);
    expect(ancienne.body.completed).toBe(true);
    expect(ancienne.body.recurrence.freq).toBe('weekly');
  });

  test('la suivante reprend la récurrence à l’identique', async () => {
    const tache = await recurrente({ recurrence: { freq: 'daily', interval: 3, until: null } });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    expect(suivante.recurrence.freq).toBe('daily');
    expect(suivante.recurrence.interval).toBe(3);
  });

  test('une récurrence arrivée au bout de `until` ne régénère rien', async () => {
    const fin = new Date();
    fin.setDate(fin.getDate() + 2);
    const tache = await recurrente({
      recurrence: { freq: 'weekly', interval: 1, until: fin.toISOString() },
    });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    expect(liste.body.tasks.find((t) => t.title === 'Sortir les poubelles')).toBeUndefined();
  });

  test('décocher une récurrente ne crée rien', async () => {
    const tache = await recurrente();
    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const avant = (await request(app).get('/tasks?limit=50')).body.total;
    await request(app).put(`/tasks/${tache._id}`).send({ completed: false });
    const apres = (await request(app).get('/tasks?limit=50')).body.total;

    expect(apres).toBe(avant);
  });

  test('cocher deux fois la même occurrence ne crée qu’une suivante', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });
    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50');
    const toutes = liste.body.tasks.filter((t) => t.title === 'Sortir les poubelles');
    expect(toutes).toHaveLength(2);
  });

  test('la suivante reprend les étapes, décochées', async () => {
    const tache = await recurrente({ title: 'Courses' });
    const etape = await request(app)
      .post('/tasks')
      .send({ title: 'Pain', parentId: tache._id });
    await request(app).put(`/tasks/${etape.body._id}`).send({ completed: true });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Courses');
    const etapes = await request(app).get(`/tasks/${suivante._id}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Pain']);
    expect(etapes.body.tasks[0].completed).toBe(false);
  });
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Récurrence"
```

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, importer la fonction en tête :

```js
const { nextDueDate } = require('./lib/recurrence');
```

Ajouter, à côté des autres helpers :

```js
/**
 * Crée l'occurrence suivante d'une tâche récurrente qu'on vient de cocher.
 * Ne fait rien si la tâche n'est pas récurrente, si la série est arrivée au
 * bout de `until`, ou si une suivante existe déjà (cocher deux fois la même
 * occurrence ne doit pas dédoubler la série).
 * @returns {object|null} la tâche créée, ou null
 */
const regenererRecurrence = async (task) => {
  if (!task.recurrence?.freq) return null;

  const suivanteLe = nextDueDate(task.dueDate, task.recurrence);
  if (!suivanteLe) return null;

  // garde d'idempotence : la série ne porte qu'une instance vivante à la fois
  const dejaLa = await Task.exists({
    title: task.title,
    dueDate: suivanteLe,
    completed: false,
    deletedAt: null,
  });
  if (dejaLa) return null;

  const suivante = await Task.create({
    title: task.title,
    description: task.description,
    category: task.category,
    priority: task.priority,
    tags: task.tags,
    dueDate: suivanteLe,
    recurrence: task.recurrence,
    reminder: { offset: task.reminder?.offset || '', at: null, sentAt: null },
    order: task.order,
  });

  // les étapes font partie de la tâche : une liste de courses qui revient
  // sans sa liste n'est pas la même tâche
  const etapes = await Task.find({ parentId: task._id, deletedAt: null })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  if (etapes.length > 0) {
    await Task.insertMany(
      etapes.map((e) => ({
        title: e.title,
        description: e.description,
        category: e.category,
        priority: e.priority,
        order: e.order,
        parentId: suivante._id,
      }))
    );
  }

  return suivante;
};
```

Dans `PUT /tasks/:id`, après la propagation du cochage aux étapes :

```js
    // une tâche récurrente cochée fait naître la suivante tout de suite : un
    // planificateur supposerait que le processus tourne le jour J, ce qui
    // n'est pas le cas d'un outil de bureau
    if (champs.completed === true) {
      await regenererRecurrence(task);
    }
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: cocher une tache recurrente cree l'occurrence suivante"
```

---

## Task 4 : la récurrence dans l'interface

**Files:**
- Modify: `public/index.html`, `public/css/components.css`, `public/js/app.js`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/ui/app.test.js` :

```js
describe('récurrence', () => {
  test('une tâche récurrente porte un pictogramme', async () => {
    server.tasks = [task('Poubelles', { recurrence: { freq: 'weekly', interval: 1, until: null } })];
    await boot();

    const marque = document.querySelector('.task-recurrence');
    expect(marque).not.toBeNull();
    expect(marque.getAttribute('title')).toMatch(/semaine/i);
  });

  test('une tâche sans récurrence n’en porte pas', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-recurrence')).toBeNull();
  });

  test('le composeur envoie la récurrence choisie', async () => {
    await boot();

    document.getElementById('task-title').value = 'Poubelles';
    document.getElementById('task-due-date').value = '2026-09-22T09:00';
    document.getElementById('task-recurrence').value = 'weekly';
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const creation = server.calls.find((c) => c.method === 'POST');
    expect(creation.body.recurrence.freq).toBe('weekly');
  });

  test('le champ de récurrence est désactivé tant qu’il n’y a pas d’échéance', async () => {
    await boot();

    const champ = document.getElementById('task-recurrence');
    expect(champ.disabled).toBe(true);

    const date = document.getElementById('task-due-date');
    date.value = '2026-09-22T09:00';
    date.dispatchEvent(new Event('input', { bubbles: true }));

    expect(champ.disabled).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:ui -- -t "récurrence"
```

- [ ] **Step 3a : ajouter le balisage**

Dans `public/index.html`, dans `.composer-row`, après le sélecteur de priorité :

```html
            <span class="field" data-sketch="select">
              <select id="task-recurrence" aria-label="Récurrence" disabled>
                <option value="">Ne se répète pas</option>
                <option value="daily">Chaque jour</option>
                <option value="weekly">Chaque semaine</option>
                <option value="monthly">Chaque mois</option>
              </select>
            </span>
```

- [ ] **Step 3b : ajouter le style**

Ajouter à la fin de `public/css/components.css` :

```css
/* ------------------------------- récurrence ------------------------------- */

.task-recurrence {
  font-family: var(--font-hand);
  font-size: 1.1rem;
  line-height: 1;
  color: var(--ink-soft);
  cursor: help;
}
```

- [ ] **Step 3c : brancher la logique**

Dans `public/js/app.js` :

1. Ajouter le sélecteur, à côté des autres du composeur :

```js
const taskRecurrenceInput = $('task-recurrence');
```

2. Ajouter, près des autres helpers de rendu :

```js
/** Ce que dit le pictogramme de récurrence au survol et aux aides techniques. */
const RECURRENCE_LABELS = {
  daily: 'Chaque jour',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
};
```

3. Dans la fonction qui construit une ligne de tâche, dans `.task-meta` :

```js
      ${
        task.recurrence?.freq
          ? `<span class="task-recurrence" title="${RECURRENCE_LABELS[task.recurrence.freq]}" aria-label="${RECURRENCE_LABELS[task.recurrence.freq]}">↻</span>`
          : ''
      }
```

4. Une récurrence sans échéance n'a pas d'ancrage : le champ suit la date.

```js
/** Le champ de récurrence n'a de sens qu'avec une échéance : il la suit. */
const syncRecurrenceEnabled = () => {
  const avecDate = taskDueDateInput.value !== '';
  taskRecurrenceInput.disabled = !avecDate;
  if (!avecDate) taskRecurrenceInput.value = '';
};

taskDueDateInput.addEventListener('input', syncRecurrenceEnabled);
syncRecurrenceEnabled();
```

5. Dans la soumission du composeur, ajouter au corps envoyé :

```js
    recurrence: taskRecurrenceInput.value
      ? { freq: taskRecurrenceInput.value, interval: 1, until: null }
      : undefined,
```

6. Après une création réussie, remettre le champ à zéro là où les autres le sont :

```js
  taskRecurrenceInput.value = '';
  syncRecurrenceEnabled();
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : vérifier à l'œil**

```bash
npm start
```

Créer « Sortir les poubelles » avec une échéance demain et « Chaque semaine ». La cocher :
elle doit disparaître de « À faire » et une nouvelle occurrence apparaître, datée de la semaine
suivante, portant le pictogramme `↻`.

- [ ] **Step 6 : committer**

```bash
git add public/ test/ui/app.test.js
git commit -m "feat: choisir et voir la recurrence d'une tache"
```

---

## Task 5 : documenter

**Files:**
- Modify: `README.md`

- [ ] **Step 1 : ajouter la fonctionnalité**

Dans « Fonctionnalités », après la ligne « Étapes » :

```markdown
- **Récurrence** : quotidienne, hebdomadaire ou mensuelle — cocher une occurrence crée
  immédiatement la suivante, calée sur l'échéance précédente (donc sans dérive en cas de
  retard) ; les étapes sont reprises, décochées
```

- [ ] **Step 2 : expliquer les deux décisions qui surprennent**

Sous le tableau de l'API :

```markdown
### Récurrence

La suivante naît **au moment où l'occurrence est cochée**, pas par un planificateur : le Cahier
est un outil de bureau, qui n'est pas forcément allumé le jour J. Un planificateur produirait
des trous dans la série.

Sa date part de l'**échéance précédente**, jamais de la date de complétion : une hebdomadaire
cochée avec trois jours de retard revient le mardi suivant, pas le vendredi. Sans cela, « tous
les mardis » dériverait d'un cran à chaque retard.

Une récurrence exige une échéance — c'est elle qu'on fait avancer. Une mensuelle posée un 31
retombe sur le dernier jour des mois plus courts (28, 29 ou 30), et ne saute pas de mois.
```

- [ ] **Step 3 : committer**

```bash
git add README.md
git commit -m "docs: documenter la recurrence et ses deux decisions"
```

---

## Vérification finale du chantier

- [ ] `npm test` — les deux suites vertes.
- [ ] `npm start` : créer une hebdomadaire échue hier, la cocher, vérifier que la suivante
      tombe **sept jours après l'échéance d'hier**, et non sept jours après aujourd'hui.
- [ ] Créer une mensuelle au 31 janvier, la cocher, vérifier qu'elle revient le 28 février.
- [ ] `git log --oneline` — un commit par tâche.
