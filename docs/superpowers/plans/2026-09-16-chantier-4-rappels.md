# Chantier 4 — Rappels : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que l'application dise quelque chose sans qu'on ait à l'ouvrir.

**Architecture :** le calcul de l'heure de rappel est une **fonction pure** dans `lib/`. Un
seul module parle au système (`lib/notify.js`), et il reçoit son émetteur en argument — les
tests n'affichent donc jamais de vraie notification. Le serveur balaie la base toutes les
soixante secondes tant qu'il tourne.

**Tech Stack:** Node 18+, Express 4, Mongoose 8, PowerShell/WinRT pour le toast Windows.
**Aucune dépendance nouvelle.** Le champ `reminder` est déjà en base (migration du chantier 2a).

**Spec de référence :** `docs/superpowers/plans/2026-09-16-roadmap-ultra-complet.md`, § 4.

---

## Décisions arrêtées avant d'écrire une ligne

**1. Canal : le toast natif de Windows, levé par le serveur.** C'est le seul canal qui atteint
l'utilisateur **navigateur fermé**. Les notifications du navigateur exigeraient un onglet
ouvert, ce qui revient à prévenir quelqu'un qui regarde déjà.

**2. Aucune dépendance.** Le toast passe par PowerShell et l'API WinRT, déjà présente sur la
machine. `node-notifier` ferait le même travail avec huit dépendances transitives de plus, pour
un projet qui en compte très peu.

**3. Le texte est passé par variables d'environnement, jamais interpolé dans le script.** Un
titre de tâche contenant une apostrophe, un `$` ou un guillemet casserait le script PowerShell,
et pire, pourrait y injecter du code. La valeur transite par l'environnement et est échappée
côté PowerShell avec `SecurityElement::Escape`.

**4. Limite assumée, à dire dans le README : rien ne part quand le serveur est éteint.**
L'application est locale, sans compte ni service distant. Aucun réglage ne doit laisser croire
le contraire.

**5. Rattrapage groupé au démarrage.** Les rappels dont l'heure est passée pendant l'arrêt ne
partent pas un par un : le premier balayage en fait **une seule** notification. Douze toasts
d'affilée au lancement seraient du bruit, et on les fermerait sans les lire.

**6. Pas de rattrapage au-delà de sept jours.** Un rappel vieux d'un mois est marqué envoyé
sans rien afficher : il ne rappelle plus rien.

**7. `reminder.at` est stocké, pas calculé à la volée.** Le balayage doit être une requête
indexée triviale. Il est recalculé à chaque écriture qui touche `dueDate` ou `reminder.offset`.

**8. Hors périmètre, assumé : le bandeau « des rappels sont partis pendant votre absence ».**
Il demanderait de savoir ce que l'utilisateur a déjà vu, donc un état supplémentaire en base.
Le pictogramme sur la tâche et la notification système couvrent l'essentiel. À dire dans le
README plutôt qu'à faire à moitié.

---

## Task 1 : l'heure du rappel

**Files:**

- Create: `lib/reminders.js`
- Create: `test/server/reminders.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/server/reminders.test.js` :

```js
const { remindAtFor, RETARD_MAX_MS, messageGroupe } = require('../../lib/reminders');

const d = (iso) => new Date(iso);

describe('remindAtFor', () => {
  test('sans échéance, il n’y a rien à rappeler', () => {
    expect(remindAtFor(null, '1h')).toBeNull();
  });

  test('sans réglage, il n’y a pas de rappel', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '')).toBeNull();
  });

  test('« à l’heure dite » tombe sur l’échéance', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), 'atDue').toISOString()).toBe(
      d('2026-09-20T09:00:00').toISOString()
    );
  });

  test('« une heure avant » retire soixante minutes', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '1h').toISOString()).toBe(
      d('2026-09-20T08:00:00').toISOString()
    );
  });

  test('« la veille » retire vingt-quatre heures', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '1d').toISOString()).toBe(
      d('2026-09-19T09:00:00').toISOString()
    );
  });

  test('un réglage inconnu ne produit rien plutôt qu’une heure fausse', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), 'dans-3-lunes')).toBeNull();
  });
});

describe('messageGroupe', () => {
  test('une seule tâche : son titre', () => {
    expect(messageGroupe([{ title: 'Dentiste' }])).toBe('Dentiste');
  });

  test('plusieurs tâches : les titres séparés', () => {
    expect(messageGroupe([{ title: 'Dentiste' }, { title: 'Impôts' }])).toBe('Dentiste · Impôts');
  });

  test('au-delà de cinq, le reste est compté', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}` }));
    expect(messageGroupe(six)).toBe('T0 · T1 · T2 · T3 · T4 · et 1 autre');
  });

  test('au-delà de six, le pluriel suit', () => {
    const huit = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}` }));
    expect(messageGroupe(huit)).toMatch(/et 3 autres$/);
  });
});

describe('RETARD_MAX_MS', () => {
  test('vaut sept jours', () => {
    expect(RETARD_MAX_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/reminders.test.js
```

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/reminders.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — rappels : quand prévenir, et avec quel texte.
   Fonctions pures : ni base, ni horloge, ni système.
   --------------------------------------------------------------------------- */

/** Écarts proposés, et ce qu'ils retirent à l'échéance. */
const OFFSETS = {
  atDue: 0,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

/**
 * Au-delà, un rappel ne rappelle plus rien : il est marqué envoyé sans rien
 * afficher, plutôt que d'encombrer le rattrapage du démarrage.
 */
const RETARD_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Nombre de titres cités dans une notification groupée avant de compter le reste. */
const MAX_TITRES = 5;

/**
 * Heure à laquelle le rappel doit partir.
 * @param {Date|string|null} dueDate
 * @param {string} offset `atDue`, `1h`, `1d`, ou vide
 * @returns {Date|null} null s'il n'y a pas d'ancrage ou pas de réglage
 */
const remindAtFor = (dueDate, offset) => {
  if (!dueDate || !offset || !Object.hasOwn(OFFSETS, offset)) return null;
  return new Date(new Date(dueDate).getTime() - OFFSETS[offset]);
};

/**
 * Texte d'une notification qui porte sur plusieurs tâches.
 * Citer tous les titres produirait un pavé qu'on ferme sans lire.
 * @param {{title: string}[]} tasks
 * @returns {string}
 */
const messageGroupe = (tasks) => {
  const titres = tasks.map((t) => t.title);
  if (titres.length <= MAX_TITRES) return titres.join(' · ');

  const reste = titres.length - MAX_TITRES;
  return `${titres.slice(0, MAX_TITRES).join(' · ')} · et ${reste} autre${reste > 1 ? 's' : ''}`;
};

module.exports = { OFFSETS, RETARD_MAX_MS, MAX_TITRES, remindAtFor, messageGroupe };
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/reminders.test.js
```

- [ ] **Step 5 : committer**

```bash
git add lib/reminders.js test/server/reminders.test.js
git commit -m "feat: calcul de l'heure d'un rappel"
```

---

## Task 2 : le canal de notification

**Files:**

- Create: `lib/notify.js`
- Create: `test/server/notify.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `test/server/notify.test.js` :

```js
const { sendNotification, POWERSHELL_ARGS } = require('../../lib/notify');

describe('sendNotification', () => {
  test('passe le texte par l’environnement, jamais dans le script', async () => {
    const appels = [];
    const faux = (commande, args, options) => {
      appels.push({ commande, args, options });
      return { on: (evt, cb) => evt === 'close' && cb(0) };
    };

    await sendNotification(
      { title: 'Cahier', message: "L'échéance de « Dentiste » approche" },
      faux
    );

    const { args, options } = appels[0];
    // le titre contient une apostrophe et des guillemets : s'il était interpolé
    // dans le script, celui-ci ne serait plus valide — et pire, injectable
    expect(args.join(' ')).not.toContain('Dentiste');
    expect(options.env.CAHIER_TITRE).toBe('Cahier');
    expect(options.env.CAHIER_MESSAGE).toBe("L'échéance de « Dentiste » approche");
  });

  test('un échec du canal ne fait pas tomber l’appelant', async () => {
    const faux = () => {
      throw new Error('powershell introuvable');
    };

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(false);
  });

  test('renvoie true quand le canal a rendu la main sans erreur', async () => {
    const faux = () => ({ on: (evt, cb) => evt === 'close' && cb(0) });

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(true);
  });

  test('renvoie false sur un code de sortie non nul', async () => {
    const faux = () => ({ on: (evt, cb) => evt === 'close' && cb(1) });

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

```bash
npm run test:api -- test/server/notify.test.js
```

- [ ] **Step 3 : écrire l'implémentation**

Créer `lib/notify.js` :

```js
/* ---------------------------------------------------------------------------
   Cahier — le seul module qui parle au système d'exploitation.

   Le toast passe par PowerShell et l'API WinRT, déjà présentes sur la machine :
   une bibliothèque ferait le même travail avec huit dépendances de plus.

   L'émetteur est reçu en argument pour que les tests n'affichent jamais de
   vraie notification.
   --------------------------------------------------------------------------- */

const { spawn } = require('child_process');

/**
 * Le script lit son texte dans l'environnement et l'échappe lui-même.
 *
 * Interpoler le titre d'une tâche dans le script serait doublement fautif :
 * une apostrophe ou un guillemet le rendrait invalide, et une valeur choisie
 * y injecterait du code. L'environnement ne traverse pas l'analyseur syntaxique.
 */
const SCRIPT = `
$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$titre = [System.Security.SecurityElement]::Escape($env:CAHIER_TITRE)
$message = [System.Security.SecurityElement]::Escape($env:CAHIER_MESSAGE)
$xml = "<toast><visual><binding template=""ToastGeneric""><text>$titre</text><text>$message</text></binding></visual></toast>"
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
$aumid = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
`;

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command', SCRIPT];

/**
 * Lève une notification système.
 *
 * N'échoue jamais bruyamment : un rappel qui ne s'affiche pas ne doit pas
 * faire tomber le balayage ni le serveur.
 *
 * @param {{title: string, message: string}} contenu
 * @param {Function} [spawner] injecté par les tests
 * @returns {Promise<boolean>} true si le canal a rendu la main sans erreur
 */
const sendNotification = ({ title, message }, spawner = spawn) =>
  new Promise((resolve) => {
    try {
      const enfant = spawner('powershell', POWERSHELL_ARGS, {
        env: { ...process.env, CAHIER_TITRE: title, CAHIER_MESSAGE: message },
        windowsHide: true,
      });
      enfant.on('error', () => resolve(false));
      enfant.on('close', (code) => resolve(code === 0));
    } catch (_) {
      resolve(false);
    }
  });

module.exports = { POWERSHELL_ARGS, sendNotification };
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

```bash
npm run test:api -- test/server/notify.test.js
```

- [ ] **Step 5 : committer**

```bash
git add lib/notify.js test/server/notify.test.js
git commit -m "feat: canal de notification systeme, sans dependance"
```

---

## Task 3 : poser un rappel et le faire partir

**Files:**

- Modify: `server.js`
- Test: `test/api/server.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `test/api/server.test.js` :

```js
describe('Rappels', () => {
  const { sweepReminders } = require('../../server');

  const dans = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

  /** Collecte les notifications au lieu de les afficher. */
  const collecteur = () => {
    const envoyees = [];
    return { envoyees, envoyer: async (contenu) => envoyees.push(contenu) };
  };

  test('poser un rappel calcule son heure à partir de l’échéance', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    expect(res.status).toBe(201);
    const attendue = new Date(new Date(res.body.dueDate).getTime() - 60 * 60 * 1000);
    expect(new Date(res.body.reminder.at).toISOString()).toBe(attendue.toISOString());
  });

  test('un rappel sans échéance n’a pas d’heure', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sans date', reminder: { offset: '1h' } });

    expect(res.body.reminder.at).toBeNull();
  });

  test('changer l’échéance recalcule l’heure du rappel', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    const res = await request(app)
      .put(`/tasks/${creee.body._id}`)
      .send({ dueDate: dans(300) });

    const attendue = new Date(new Date(res.body.dueDate).getTime() - 60 * 60 * 1000);
    expect(new Date(res.body.reminder.at).toISOString()).toBe(attendue.toISOString());
  });

  test('retirer le rappel efface son heure', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    const res = await request(app)
      .put(`/tasks/${creee.body._id}`)
      .send({ reminder: { offset: '' } });

    expect(res.body.reminder.at).toBeNull();
  });

  test('le balayage envoie les rappels échus et les marque', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(1);
    expect(envoyees[0].message).toContain('Dentiste');
    const apres = await request(app).get(`/tasks/${creee.body._id}`);
    expect(apres.body.reminder.sentAt).not.toBeNull();
  });

  test('un rappel ne part qu’une fois, même si le balayage repasse', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });
    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(1);
  });

  test('un rappel à venir ne part pas', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Plus tard', dueDate: dans(300), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('cocher une tâche avant l’heure du rappel empêche l’envoi', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Faite avant', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    await request(app).put(`/tasks/${creee.body._id}`).send({ completed: true });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('supprimer une tâche empêche son rappel', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Jetée', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    await request(app).delete(`/tasks/${creee.body._id}`);
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('plusieurs rappels échus font une seule notification', async () => {
    for (const titre of ['Un', 'Deux', 'Trois']) {
      await request(app)
        .post('/tasks')
        .send({ title: titre, dueDate: dans(-30), reminder: { offset: 'atDue' } });
    }
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    // douze toasts d'affilée au lancement seraient du bruit
    expect(envoyees).toHaveLength(1);
    expect(envoyees[0].message).toContain('Un');
    expect(envoyees[0].message).toContain('Trois');
  });

  test('un rappel oublié depuis plus de sept jours est marqué sans rien afficher', async () => {
    const vieux = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Oublié', dueDate: vieux, reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
    const apres = await request(app).get(`/tasks/${creee.body._id}`);
    // marqué quand même : sinon il resurgirait à chaque démarrage
    expect(apres.body.reminder.sentAt).not.toBeNull();
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

```bash
npm run test:api -- -t "Rappels"
```

- [ ] **Step 3 : écrire l'implémentation**

Dans `server.js`, importer :

```js
const { remindAtFor, messageGroupe, RETARD_MAX_MS } = require('./lib/reminders');
const { sendNotification } = require('./lib/notify');
```

Ajouter `reminder` à la liste blanche de création.

Ajouter un helper, à côté des autres :

```js
/**
 * Recalcule l'heure du rappel à partir de l'état résultant.
 * `at` est stocké plutôt que calculé à la lecture : le balayage doit rester
 * une requête indexée triviale, pas une arithmétique de dates en base.
 */
const poserHeureDeRappel = (apres) => {
  const offset = apres?.reminder?.offset || '';
  return {
    offset,
    at: remindAtFor(apres?.dueDate, offset),
    // un réglage qui change remet le compteur : le nouveau rappel doit partir
    sentAt: null,
  };
};
```

Dans `POST /tasks`, avant `new Task(champs)` :

```js
if (champs.reminder || champs.dueDate) champs.reminder = poserHeureDeRappel(champs);
```

Dans `PUT /tasks/:id`, après le calcul de `avant` :

```js
// l'heure du rappel dépend de l'échéance ET du réglage : toucher à l'une
// ou à l'autre la refait
if (Object.hasOwn(champs, 'reminder') || Object.hasOwn(champs, 'dueDate')) {
  champs.reminder = poserHeureDeRappel({ ...avant, ...champs });
}
```

Ajouter le balayage, à côté de `purgeDeletedTasks` :

```js
/**
 * Envoie les rappels échus, puis les marque.
 *
 * Le marquage rend l'opération idempotente : un rappel part **au plus une
 * fois**, même si le balayage repasse dessus.
 *
 * Tous les rappels échus d'un même passage font **une seule** notification :
 * au démarrage, ceux accumulés pendant l'arrêt sortiraient sinon en rafale, et
 * on les fermerait sans les lire.
 *
 * @param {{now?: Date, envoyer?: Function}} options `envoyer` est injecté par
 *   les tests, pour qu'ils n'affichent jamais de vraie notification
 */
async function sweepReminders({ now = new Date(), envoyer = sendNotification } = {}) {
  const echus = await Task.find({
    'reminder.at': { $ne: null, $lte: now },
    'reminder.sentAt': null,
    completed: false,
    deletedAt: null,
  })
    .sort({ 'reminder.at': 1 })
    .lean();

  if (echus.length === 0) return { envoyes: 0, perimes: 0 };

  const limite = new Date(now.getTime() - RETARD_MAX_MS);
  const aDire = echus.filter((t) => new Date(t.reminder.at) >= limite);
  const perimes = echus.length - aDire.length;

  if (aDire.length > 0) {
    await envoyer({
      title: aDire.length === 1 ? 'Cahier — rappel' : `Cahier — ${aDire.length} rappels`,
      message: messageGroupe(aDire),
    });
  }

  // les périmés sont marqués eux aussi : sinon ils resurgiraient à chaque
  // démarrage sans jamais rien apprendre à personne
  await Task.updateMany(
    { _id: { $in: echus.map((t) => t._id) } },
    { $set: { 'reminder.sentAt': now } }
  );

  return { envoyes: aDire.length, perimes };
}
```

Dans le bloc de démarrage, après la migration :

```js
await sweepReminders();
// le processus est un outil de bureau : tant qu'il tourne, il regarde
setInterval(() => {
  sweepReminders().catch((e) => console.error('Balayage des rappels :', e.message));
}, 60 * 1000).unref();
```

Et à l'export :

```js
module.exports.sweepReminders = sweepReminders;
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

- [ ] **Step 5 : committer**

```bash
git add server.js test/api/server.test.js
git commit -m "feat: poser des rappels et les faire partir"
```

---

## Task 4 : le rappel dans l'interface

**Files:**

- Modify: `public/index.html`, `public/css/components.css`, `public/js/app.js`
- Test: `test/ui/app.test.js`

- [ ] **Step 1 : écrire le test qui échoue**

```js
describe('rappels', () => {
  test('une tâche avec rappel porte un pictogramme', async () => {
    server.tasks = [task('Dentiste', { reminder: { offset: '1h', at: null, sentAt: null } })];
    await boot();

    const marque = document.querySelector('.task-reminder');
    expect(marque).not.toBeNull();
    expect(marque.getAttribute('title')).toMatch(/heure avant/i);
  });

  test('une tâche sans rappel n’en porte pas', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-reminder')).toBeNull();
  });

  test('le champ de rappel est désactivé tant qu’il n’y a pas d’échéance', async () => {
    await boot();

    const champ = document.getElementById('task-reminder');
    expect(champ.disabled).toBe(true);

    const date = document.getElementById('task-due-date');
    date.value = '2026-09-22T09:00';
    date.dispatchEvent(new Event('input', { bubbles: true }));

    expect(champ.disabled).toBe(false);
  });

  test('le composeur envoie le rappel choisi', async () => {
    await boot();

    document.getElementById('task-title').value = 'Dentiste';
    document.getElementById('task-due-date').value = '2026-09-22T09:00';
    const champ = document.getElementById('task-reminder');
    champ.disabled = false;
    champ.value = '1h';
    document
      .getElementById('task-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const creation = server.calls.find((c) => c.method === 'POST');
    expect(creation.body.reminder).toEqual({ offset: '1h' });
  });
});
```

- [ ] **Step 2 : ajouter le balisage**

Dans `.composer-row`, après le sélecteur de récurrence :

```html
<span class="field" data-sketch="select">
  <select id="task-reminder" aria-label="Rappel" disabled>
    <option value="">Sans rappel</option>
    <option value="atDue">Rappel : à l'heure</option>
    <option value="1h">Rappel : 1 h avant</option>
    <option value="1d">Rappel : la veille</option>
  </select>
</span>
```

- [ ] **Step 3 : ajouter le style**

```css
/* --------------------------------- rappels -------------------------------- */

.task-reminder {
  font-family: var(--font-hand);
  font-size: 1.05rem;
  line-height: 1;
  color: var(--ink-soft);
  cursor: help;
}
```

- [ ] **Step 4 : brancher**

Même mécanique que la récurrence : le champ suit l'échéance (un rappel sans ancrage n'a pas de
sens), le composeur l'envoie, et la ligne porte un `🔔` titré.

```js
const REMINDER_LABELS = {
  atDue: 'Rappel à l’heure dite',
  '1h': 'Rappel une heure avant',
  '1d': 'Rappel la veille',
};
```

- [ ] **Step 5 : lancer les tests, puis committer**

```bash
npm test
git add public/ test/ui/app.test.js
git commit -m "feat: choisir et voir le rappel d'une tache"
```

---

## Task 5 : documenter, limite comprise

**Files:**

- Modify: `README.md`

- [ ] **Step 1 : la fonctionnalité et sa limite**

```markdown
- **Rappels** : à l'heure dite, une heure avant ou la veille — une notification Windows part
  du serveur, donc **même navigateur fermé**

### Rappels

Le Cahier n'a ni compte, ni service distant : un rappel ne peut partir que **tant que
`npm start` tourne**. C'est la limite du modèle, et elle est assumée — aucun réglage ne laisse
croire que vous serez prévenu l'application éteinte.

Le serveur balaie la base toutes les soixante secondes. Les rappels dont l'heure est passée
pendant un arrêt sortent **groupés en une seule notification** au démarrage suivant : douze
toasts d'affilée seraient du bruit. Passé sept jours, un rappel est classé sans être affiché —
il ne rappelle plus rien.

Le toast passe par PowerShell et l'API WinRT de Windows, sans aucune dépendance ajoutée. Le
texte transite par variables d'environnement et n'est jamais interpolé dans le script : un
titre contenant une apostrophe ou un guillemet le casserait, et une valeur choisie pourrait y
injecter du code.

**Non fait, assumé :** le bandeau « des rappels sont partis pendant votre absence ». Il
demanderait de retenir ce que vous avez déjà vu, donc un état de plus en base ; le pictogramme
sur la tâche et la notification couvrent l'essentiel.
```

- [ ] **Step 2 : committer**

```bash
git add README.md
git commit -m "docs: documenter les rappels et leur limite"
```
