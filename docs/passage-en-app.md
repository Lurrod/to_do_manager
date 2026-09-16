# Passer le Cahier en application

> **Nature de ce document :** un état des lieux et une décision à prendre, pas un plan
> d'exécution. Il dit ce qui est déjà en place, ce qui bloque réellement, et ce que coûte
> chacune des trois voies possibles. Le plan viendra une fois la voie choisie.
>
> Rédigé le 2026-09-16.

---

## Ce qui est déjà fait

Le projet n'attend plus qu'une décision : la plomberie du lancement est posée.

| Acquis | Ce que ça apporte |
|--------|-------------------|
| `npm run app` | Démarre le serveur, attend `/healthz`, ouvre une **fenêtre sans barre d'adresse** (Chrome ou Edge en mode `--app`), et `Ctrl+C` arrête les deux. Vérifié de bout en bout. |
| `GET /healthz` | Un point trivial et muet sur la machine, que n'importe quel enveloppeur peut interroger pour savoir quand ouvrir sa fenêtre. |
| Repli de port | Le port 3000 occupé ne fait plus échouer le démarrage : le serveur glisse vers le suivant et l'annonce. Vérifié : 3001. |
| Écoute sur la boucle locale | `127.0.0.1` par défaut, jamais exposé au réseau. |
| Arrêt propre | `SIGINT`/`SIGTERM` ferment Mongo et libèrent le verrou sur `data/db`. |
| Logo vectoriel | `favicon.svg` + `apple-touch-icon.png` (180 px). Il manque un `.ico` multi-tailles pour une icône de bureau Windows. |
| Export / import | Les données sortent et rentrent en JSON. **C'est ce qui rend un changement de moteur de stockage envisageable sans rien perdre.** |

À ce stade, `npm run app` donne déjà une fenêtre qui ressemble à une application. Ce qui manque
pour en être vraiment une : une icône dans le menu Démarrer, un double-clic qui la lance, et
pas de terminal ouvert derrière.

---

## Le vrai obstacle : MongoDB embarqué

C'est le point qu'il faut regarder en face avant de choisir une voie. Mesures faites sur cette
machine, le 2026-09-16 :

| Mesure | Taille |
|--------|--------|
| Binaire `mongod-x64-win32-8.2.6.exe` | **74 Mo** |
| `data/db` — pour **5 tâches** | **204 Mo**, dont **201 Mo de journal WiredTiger** |
| `node_modules` complet | 208 Mo |

Deux cent mégaoctets de journal pour cinq tâches. Ce n'est pas un défaut de l'application :
c'est MongoDB qui préalloue ses fichiers de journalisation, parce qu'il est conçu pour des
bases de plusieurs gigaoctets et des écritures continues. Sur un cahier personnel, c'est un
serveur de base de données industriel employé à noter des courses.

Conséquence directe : **toute application empaquetée embarquerait ces 74 Mo de binaire et
préallouerait ces 200 Mo au premier lancement.** Un installeur de ~90 Mo pour un gestionnaire
de tâches, et un dossier de données qui pèse deux cents fois ce qu'il contient.

---

## Les trois voies

### A. PWA — la moins chère

Un `manifest.webmanifest` et un service worker suffisent à rendre le Cahier **installable
depuis le navigateur** : icône dans le menu Démarrer, fenêtre propre, lancement en un clic.

- **Coût :** faible. Deux fichiers, une coquille précachée, un bandeau « hors-ligne ».
  C'est déjà prévu au § 3.2 de la feuille de route.
- **Ce que ça ne règle pas :** le serveur doit tourner. Une PWA installée qui ouvre une fenêtre
  sur un serveur éteint affiche une page morte. Il faudrait lancer `npm start` au démarrage de
  la session Windows — faisable (tâche planifiée), mais c'est un bricolage qui se voit.
- **Verdict :** excellent rapport effort/effet **si** le serveur tourne déjà en permanence.

### B. Electron — la plus complète, et la plus lourde

Une vraie application Windows : un `.exe`, un installeur, une icône, pas de terminal.

- **Coût :** Electron ajoute ~150 Mo au paquet, **plus** les 74 Mo de `mongod`. Soit un
  installeur autour de 220 Mo. Il faut aussi empaqueter le binaire Mongo, gérer son cycle de
  vie depuis le processus principal, et signer l'exécutable pour éviter l'avertissement
  SmartScreen.
- **Ce que ça règle :** tout le reste. Double-clic, icône, mises à jour, notifications natives
  sans passer par PowerShell.
- **Verdict :** la bonne réponse si le Cahier doit être distribué à d'autres. Disproportionné
  pour un usage sur une seule machine.

### C. Tauri — la plus légère, mais elle exige de changer de stockage

Tauri produit un `.exe` de quelques mégaoctets (il utilise le WebView2 déjà présent sur
Windows au lieu d'embarquer Chromium).

- **Coût :** une chaîne de compilation Rust, et surtout **le remplacement de MongoDB** —
  embarquer `mongod` dans un paquet Tauri annulerait tout son intérêt.
- **Verdict :** le résultat le plus élégant, au prix du chantier le plus lourd.

---

## Ce que je recommande

**Deux étapes, dans cet ordre.**

**1. La PWA maintenant** (voie A). C'est deux fichiers, c'est déjà dans la feuille de route, et
ça donne une icône et une fenêtre propre dès cette semaine. Avec une tâche planifiée Windows
qui lance `npm start` à l'ouverture de session, le Cahier devient utilisable comme une
application sans rien casser.

**2. Le changement de moteur de stockage, ensuite — et seulement s'il y a une suite.**
C'est lui qui débloque tout le reste, pas le choix de l'enveloppe. Remplacer MongoDB par
**SQLite** (`better-sqlite3`, ~5 Mo, un seul fichier de données) ferait passer l'empreinte de
280 Mo à une dizaine, supprimerait le téléchargement du premier lancement, et rendrait Tauri
envisageable.

Ce n'est pas un petit chantier : `server.js` parle à Mongoose directement, sans couche
d'abstraction. Il faudrait d'abord isoler l'accès aux données derrière une interface, puis
écrire la seconde implémentation. **L'export/import déjà livré est ce qui rend l'opération
sûre** : on exporte en JSON, on change de moteur, on réimporte, et on compare.

**Ce que je déconseille :** empaqueter en Electron l'état actuel. Ça marcherait, et ça livrerait
un installeur de 220 Mo dont 200 de journal vide — en figeant pour longtemps le choix qui pose
problème.

---

## Si la voie A est retenue — ce qu'il reste à faire

1. `public/manifest.webmanifest` : nom, couleurs (`#f6f1e4` / `#1f2f5c`), `display: standalone`,
   icônes 192 et 512 px dérivées de `favicon.svg`.
2. `public/sw.js` : précache de la coquille (HTML, CSS, JS, polices), API en *network-first*
   avec repli sur le cache en lecture seule. **Pas de file d'écritures différées** — sur une
   base locale mono-utilisateur, ça ajouterait un modèle de conflit pour un gain nul.
3. Un bandeau « hors-ligne » explicite, plutôt qu'une page qui ment.
4. Un `favicon.ico` multi-tailles pour l'icône de bureau.
5. Une tâche planifiée Windows qui lance `npm start` à l'ouverture de session.

Points 1 à 4 : une demi-journée. Point 5 : dix minutes, mais c'est le seul qui se voit.
