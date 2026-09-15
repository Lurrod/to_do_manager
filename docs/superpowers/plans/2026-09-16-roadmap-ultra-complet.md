# Roadmap « ultra complet » — Cahier / to_do_manager

> **Nature de ce document :** c'est la **spécification** de référence, pas un plan exécutable.
> Elle fige les décisions (modèle de données, contrats d'API, critères d'acceptation) pour
> les trois vagues. Chaque vague a — ou aura — son propre plan d'implémentation TDD,
> exécutable indépendamment, dans ce même dossier.

**État à la date du 2026-09-16 :** `server.js` 397 l., `public/js/app.js` 590 l.,
34 tests API (Jest + Supertest) + 53 tests UI (Vitest + happy-dom), tous verts.
DA « cahier » via drawably, Mongo embarqué persistant dans `data/db`, mono-utilisateur, local.

---

## Principe directeur

L'application est **locale, mono-utilisateur, sans authentification**. Toute proposition qui
suppose du multi-utilisateur, de la synchronisation cloud ou un compte est hors périmètre.
Ce qui limite l'app aujourd'hui n'est pas la plomberie — elle est saine — mais **la platitude
du modèle** : une tâche = titre + description + 1 catégorie + 1 priorité + 1 date.

Trois vagues, du moins risqué au plus structurant :

| Vague | Thème | Touche au schéma ? | Plan |
|-------|-------|--------------------|------|
| 1 | Usage quotidien : voir ce qui compte, saisir vite | Non | `2026-09-16-vague-1-usage-quotidien.md` |
| 2 | Structure : sous-tâches, récurrence, tags, ordre | Oui | à écrire |
| 3 | Durabilité : export, PWA, perf, outillage | Marginalement | à écrire |

---

## Vague 1 — Usage quotidien

**Objectif :** transformer un registre en outil qu'on ouvre le matin.
**Contrainte :** aucune modification du schéma Mongo, donc aucune migration.

### 1.1 Filtre temporel `due`

Nouveau paramètre de `GET /tasks` (et de `GET /tasks/stats` pour le compteur).

| `due` | Signification | Filtre Mongo |
|-------|---------------|--------------|
| `all` (défaut) | pas de contrainte | — |
| `overdue` | échéance dépassée | `dueDate: { $ne: null, $lt: minuit_aujourd_hui }` |
| `today` | échéance d'ici ce soir, **retard inclus** | `dueDate: { $ne: null, $lt: minuit_demain }` |
| `week` | échéance sous 7 jours, **retard inclus** | `dueDate: { $ne: null, $lt: minuit_J+7 }` |
| `none` | sans échéance | `dueDate: null` |

**Décision — horizons emboîtés.** `today` inclut le retard, `week` inclut `today`. Une tâche
en retard ne doit jamais disparaître d'une vue plus large : c'est exactement l'oubli que les
vues temporelles servent à empêcher.

**Décision — la vue par défaut reste `all`.** J'avais d'abord proposé de démarrer sur
« Aujourd'hui ». À la relecture du modèle, `dueDate` est optionnel et la majorité des tâches
existantes n'en ont pas : ouvrir sur `today` afficherait une page vide sur une base pleine.
À la place, l'onglet « En retard » porte un compteur alimenté par `/tasks/stats`, visible
en permanence. Le signal est là sans cacher les données.

**Décision — fuseau.** Les bornes sont calculées côté serveur avec l'heure locale du
processus. Serveur et navigateur tournent sur la même machine : c'est exact ici, et ça évite
de faire transiter un décalage que le client pourrait falsifier.

### 1.2 Statistiques enrichies

`GET /tasks/stats` renvoie en plus `overdue` (nombre de tâches **non terminées** dont
l'échéance est dépassée). Alimente le badge de l'onglet et la phrase du sous-titre.

### 1.3 Saisie rapide en langage naturel

Nouveau module **pur** `public/js/parse.js` — aucun accès DOM, aucun accès réseau, donc
entièrement testable unitairement.

```
parseQuickEntry("Dentiste demain 14h #Santé !haute", { now, categories })
→ {
    title: "Dentiste",
    dueDate: "2026-09-17T14:00:00.000Z",
    category: "Santé",
    priority: "high",
    tokens: [ {type:'date', text:'demain'}, {type:'date', text:'14h'},
              {type:'category', text:'Santé'}, {type:'priority', text:'haute'} ]
  }
```

Motifs reconnus (français) :

| Motif | Exemple | Résultat |
|-------|---------|----------|
| `aujourd'hui` / `auj` | `auj` | jour même |
| `demain`, `après-demain` | `demain` | J+1, J+2 |
| jour de semaine | `mardi` | prochaine occurrence **strictement** future |
| `dans N jour(s)/semaine(s)` | `dans 3 jours` | J+3 |
| date numérique | `12/03`, `le 12/03/2027` | date ; année omise ⇒ prochaine occurrence |
| heure | `14h`, `14h30`, `à 9h` | heure posée sur le jour trouvé |
| `#catégorie` | `#Santé` | catégorie (recalée sur une catégorie connue si elle existe) |
| `!priorité` | `!haute`, `!1` | `high` / `medium` / `low` |

Règles de résolution :
- jour sans heure ⇒ **09:00**.
- heure sans jour ⇒ aujourd'hui si encore à venir, sinon demain.
- ni jour ni heure ⇒ `dueDate: null`.
- les segments consommés sont retirés du titre ; le reste est compacté et tronqué à 120.

**Décision — aperçu obligatoire.** Les tokens reconnus s'affichent sous le champ pendant la
frappe. Un parseur qui devine en silence est un parseur qu'on n'ose plus utiliser : l'aperçu
rend l'interprétation réfutable avant validation.

**Décision — le parseur ne remplace pas le formulaire.** Les champs date / catégorie /
priorité restent. La saisie rapide est un raccourci, pas un mode.

### 1.4 Écran Corbeille

Le soft-delete existe déjà côté serveur (`deletedAt`, `POST /tasks/:id/restore`, purge à
7 jours au démarrage) mais aucun écran ne l'expose : passé le toast « Annuler », une tâche
supprimée est inaccessible. Ajouts :

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/tasks/trash` | liste paginée des tâches supprimées, triée par `deletedAt` décroissant |
| `DELETE` | `/tasks/:id/purge` | suppression définitive d'une tâche déjà dans la corbeille |

`DELETE /tasks/:id/purge` refuse (404) une tâche qui n'est pas dans la corbeille : la
suppression définitive ne doit jamais être atteignable en un seul geste.

### 1.5 Clavier

- `Ctrl+K` : palette de commandes (recherche de tâche + actions : nouvelle tâche, changer de
  vue, ouvrir la corbeille).
- `n` : focus sur le champ de saisie rapide.
- `j` / `k` : naviguer dans la liste ; `x` : cocher/décocher ; `e` : éditer ; `Suppr` : supprimer.
- `/` : recherche (déjà en place), `Échap` : fermer (déjà en place).

Tous inactifs quand une modale est ouverte ou quand le focus est dans un champ de saisie —
la garde `isModalOpen()` et le test `e.target.matches('input, textarea')` existent déjà
dans `public/js/app.js:571`.

### Critères d'acceptation — Vague 1

- [ ] `GET /tasks?due=overdue|today|week|none` filtre correctement, et un `due` inconnu ou un
      opérateur Mongo injecté (`?due[$ne]=null`) est ignoré sans erreur.
- [ ] `GET /tasks/stats` expose `overdue`.
- [ ] Les onglets temporels remettent la pagination à 1 et se combinent avec statut,
      catégorie et recherche.
- [ ] `parseQuickEntry` est couvert par des tests à horloge figée (`now` injecté).
- [ ] La corbeille liste, restaure et purge ; purger une tâche vivante renvoie 404.
- [ ] Les raccourcis ne se déclenchent jamais depuis un champ de saisie.
- [ ] `npm test` vert, API et UI.

---

## Vague 2 — Structure

**Objectif :** sortir du modèle plat. **Prérequis :** vague 1 livrée. **Risque :** migrations.

### 2.1 Sous-tâches

```js
parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true }
```

- `GET /tasks` ne renvoie que les racines (`parentId: null`) — sinon la pagination compte les
  enfants et les pages deviennent incohérentes.
- Chaque tâche renvoyée porte `childCount` et `childDone`, calculés par un `$lookup` dans le
  pipeline d'agrégation existant.
- `GET /tasks/:id/children` liste les enfants.
- Profondeur limitée à **1 niveau** : un enfant ne peut pas avoir d'enfant. Une hiérarchie
  arbitraire demanderait un modèle d'arbre (matérialisation du chemin) que rien ne justifie ici.
- Cocher le parent coche tous les enfants. Cocher le dernier enfant ne coche pas le parent
  automatiquement (un parent peut avoir du travail propre au-delà de ses étapes).
- Supprimer un parent envoie ses enfants à la corbeille avec lui ; le restaurer les ressort.
- La jauge par tâche réutilise `progress()` de `public/js/sketch.js:228`.

### 2.2 Récurrence

```js
recurrence: {
  freq: { type: String, enum: ['', 'daily', 'weekly', 'monthly'], default: '' },
  interval: { type: Number, default: 1, min: 1, max: 99 },
  until: { type: Date, default: null },
}
```

**Décision — régénération à la complétion, pas par planificateur.** Quand une tâche
récurrente est cochée, le serveur la termine et **crée immédiatement la suivante** avec la
date d'échéance suivante. Pas de cron, pas de tâche de fond : le processus est un outil de
bureau qui n'est pas forcément allumé le jour J, un planificateur produirait des trous.

- Le calcul de la date suivante part de l'**échéance précédente**, pas de la date de
  complétion : sinon une série hebdomadaire dérive d'un jour à chaque retard.
- Si la date suivante dépasse `until`, aucune tâche n'est créée.
- La série n'est pas matérialisée à l'avance : une seule instance vivante à la fois.
- Une tâche récurrente porte un `recurrence` copié à l'identique sur son successeur.

### 2.3 Tags multiples

```js
tags: { type: [String], default: [], validate: [(v) => v.length <= 10, 'Maximum 10 étiquettes'] }
```

Chaque tag : 24 caractères max, normalisé en minuscules, dédoublonné.
`GET /tasks?tag=<nom>` filtre ; la catégorie reste le classement principal (une seule,
colorée, dans la marge), les tags sont transversaux.

### 2.4 Ordre manuel et glisser-déposer

```js
order: { type: Number, default: 0, index: true }
```

**Décision — indexation fractionnaire.** Déposer entre deux voisins d'ordre `a` et `b`
attribue `(a + b) / 2`. Une seule écriture au lieu de réécrire toute la liste. En bout de
liste : `min - 1024` ou `max + 1024`. Renumérotation complète déclenchée uniquement quand
l'écart entre deux voisins tombe sous `1e-6`.

Nouveau tri `sort=manual` (`order` croissant, `_id` en départage). Le glisser-déposer n'est
actif que sous ce tri — réordonner à la main une liste triée par priorité n'a pas de sens.
`PATCH /tasks/:id/order` avec `{ before, after }` (identifiants des voisins).

### 2.5 Sélection multiple et actions groupées

Case à cocher de sélection par ligne + `Maj+clic` pour une plage.
`POST /tasks/bulk` : `{ ids: [...], action: 'complete'|'uncomplete'|'delete'|'category'|'priority', value }`.
Maximum 100 identifiants par appel. Chaque action groupée est annulable par un toast unique.

### Critères d'acceptation — Vague 2

- [ ] Migration idempotente au démarrage : les tâches existantes reçoivent `parentId: null`,
      `tags: []`, `order` initialisé sur `createdAt`, `recurrence.freq: ''`.
- [ ] La pagination des racines reste exacte en présence d'enfants.
- [ ] Une hebdomadaire cochée avec 3 jours de retard replanifie sur la semaine suivante de la
      **date d'échéance**, pas de la date de complétion.
- [ ] Une récurrence dont `until` est dépassé ne régénère rien.
- [ ] Un glisser-déposer produit **une** écriture serveur.
- [ ] `POST /tasks/bulk` refuse au-delà de 100 identifiants et rejette les actions inconnues.

---

## Vague 3 — Durabilité

### 3.1 Export / import / sauvegarde

- `GET /export` → JSON complet (tâches + catégories + version de schéma).
- `POST /import` → `{ mode: 'merge' | 'replace' }`, validé champ par champ par la même liste
  blanche que les routes normales. `replace` exige un en-tête `X-Confirm: replace`.
- `GET /export.md` → cahier en Markdown (cases `- [ ]` / `- [x]`, groupées par catégorie).
- `GET /export.csv` → colonnes stables, séparateur `,`, échappement RFC 4180.
- `npm run backup` → dump horodaté dans `backups/`.

### 3.2 PWA

`manifest.webmanifest` + service worker : coquille applicative précachée
(HTML/CSS/JS/polices), API en *network-first* avec repli sur le cache en lecture seule et
bandeau « hors-ligne » explicite. **Pas de file d'écritures différées** : une synchronisation
différée sur une base locale mono-utilisateur ajoute un modèle de conflit pour un gain nul.

### 3.3 Performance de la recherche

Index texte Mongo sur `title` + `description` (poids 10 / 1) et bascule de la regex
(`server.js:216`, qui scanne) vers `$text` dès que `q` dépasse 2 caractères. La regex reste
le repli pour 1–2 caractères, où `$text` ne matche pas les préfixes.

### 3.4 Vue calendrier et statistiques

- Grille mensuelle, tâches placées sur leur `dueDate`, glisser-déposer d'un jour à l'autre.
- Écran bilan : complétées par semaine, série de jours consécutifs, répartition par catégorie.
  Tracé avec `sketch.js` pour rester dans la DA — pas de bibliothèque de graphiques.

### 3.5 Outillage

- ESLint (`eslint:recommended`) + Prettier, un script `npm run lint`.
- Seuil de couverture **80 %** appliqué dans la config Jest **et** Vitest (`coverageThreshold`
  / `coverage.thresholds`), le test échoue en dessous.
- CI GitHub Actions : `npm ci`, `npm run lint`, `npm test` sur Node 18 et 20.
- `helmet`, `express-rate-limit` (généreux : 300 req/min), `/healthz`.
- `npm audit --omit=dev` en CI, non bloquant en local.

### Critères d'acceptation — Vague 3

- [ ] Un export réimporté en mode `replace` reproduit la base à l'identique (test aller-retour).
- [ ] Un import malformé est refusé sans rien écrire (tout ou rien).
- [ ] L'app se charge et affiche le dernier état connu hors-ligne.
- [ ] La CI est verte sur Node 18 et 20, couverture ≥ 80 %.

---

## Ordre d'exécution recommandé

```
Vague 1  →  1.1 + 1.2  →  1.3  →  1.4  →  1.5
Vague 2  →  2.1  →  2.2  →  2.3  →  2.4  →  2.5
Vague 3  →  3.5 (outillage d'abord : la CI garde les deux vagues précédentes)
         →  3.1  →  3.3  →  3.2  →  3.4
```

L'outillage (3.5) est le seul élément de la vague 3 qu'il serait raisonnable d'avancer :
mis en place avant la vague 2, il protège les migrations.
