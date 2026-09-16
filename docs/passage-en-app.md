# Le Cahier en application Windows

> **État : fait.** `npm run dist` produit un installeur `.exe`. Ce document dit ce qui a été
> choisi, ce que ça coûte réellement — mesuré, pas estimé — et ce qui reste ouvert.
>
> Mis à jour le 2026-09-16.

---

## Ce qu'on obtient

```bash
npm run dist          # → dist/Cahier Setup 3.0.0.exe
```

Un installeur NSIS classique : on le double-clique, il propose un dossier, il pose un raccourci
sur le bureau et dans le menu Démarrer, et l'application apparaît dans **Applications
installées** pour être désinstallée comme n'importe quelle autre.

| Mesuré sur cette machine        |                                               |
| ------------------------------- | --------------------------------------------- |
| Installeur `.exe`               | **88 Mo**                                     |
| Application installée           | **358 Mo** (`%LOCALAPPDATA%\Programs\Cahier`) |
| Données après premier lancement | **201 Mo** (`%APPDATA%\Cahier\db`)            |

Les données vivent **hors** de l'application : une mise à jour ne les touche pas, et
désinstaller ne les efface pas.

---

## Pourquoi Electron, et pas Tauri

Tauri produirait un exécutable de quelques mégaoctets au lieu de 358. Mais il n'aurait de sens
qu'accompagné d'un changement de moteur de stockage : embarquer les 74 Mo de `mongod` dans un
paquet Tauri annulerait exactement ce pour quoi on l'aurait choisi. Electron livre aujourd'hui
un `.exe` qui marche, sans toucher au modèle de données.

---

## Les trois pièges, et ce qu'ils ont appris

Chacun s'est manifesté **uniquement** sur l'application empaquetée — aucun ne se voyait en
développement. C'est la leçon générale : une application Electron ne se valide qu'empaquetée.

**1. Le champ `main` du `package.json` pointait encore sur `server.js`.** Electron chargeait donc
le serveur directement, sans jamais passer par le processus principal. Symptôme : le serveur
écoutait, aucune fenêtre ne s'ouvrait, et le dossier de données restait calculé depuis
`__dirname` — c'est-à-dire **dans l'archive `app.asar`**, qui est un fichier. `mkdir` y échoue
par `ENOTDIR`.

**2. `mongodb-memory-server` calcule son dossier de travail à côté de son propre module.** Donc
dans l'archive, là encore. Il lui est désormais donné explicitement, hors de l'application, même
quand le binaire est déjà fourni et qu'il n'a rien à télécharger.

**3. L'échec de Mongo appelait `process.exit`.** L'application mourait avant que la fenêtre ait
pu dire quoi que ce soit — un démarrage raté était donc parfaitement silencieux. L'erreur remonte
maintenant jusqu'à une boîte de dialogue qui nomme le dossier de données et le chemin de `mongod`.

Un quatrième, mineur : `app.setName()` ne suffit pas à nommer le dossier de données. Electron le
dérive du champ `name` du paquet une fois empaqueté, et de « Electron » en développement — trois
noms pour la même application, donc trois bases. Il est maintenant posé explicitement par
`app.setPath('userData', …)`.

---

## Ce qui reste ouvert

### L'avertissement SmartScreen

L'exécutable n'est pas signé. Au premier lancement, Windows affichera **« Windows a protégé
votre ordinateur »** ; il faut cliquer _Informations complémentaires_ puis _Exécuter quand
même_. Sans conséquence pour un usage personnel ; rédhibitoire pour distribuer à d'autres.

Signer demande un certificat de signature de code (≈ 200 à 400 € par an, ou un certificat EV
sur clé matérielle pour lever l'avertissement immédiatement). À décider seulement si le Cahier
sort de cette machine.

### Les 201 Mo de données pour cinq tâches

Ce n'est pas un défaut de l'application : MongoDB préalloue ses fichiers de journalisation,
parce qu'il est conçu pour des bases de plusieurs gigaoctets et des écritures continues. Sur un
cahier personnel, c'est un serveur de base de données industriel employé à noter des courses.

Le remplacer par **SQLite** (`better-sqlite3`, un seul fichier de données) ferait tomber
l'installeur autour de 25 Mo et les données à quelques centaines de kilo-octets. Ce n'est pas un
petit chantier : `server.js` parle à Mongoose directement, sans couche d'abstraction ; il
faudrait isoler l'accès aux données derrière une interface, puis écrire la seconde
implémentation.

**L'export/import est ce qui rendrait l'opération sûre** : on exporte en JSON, on change de
moteur, on réimporte, on compare. C'est exactement le test d'aller-retour déjà écrit.

### Mise à jour automatique

Non branchée. `electron-updater` sait le faire, mais il lui faut un endroit où publier les
versions (GitHub Releases, par exemple) et une signature pour que Windows ne s'y oppose pas.
Aujourd'hui, mettre à jour = relancer `npm run dist` et réinstaller par-dessus.

---

## Reprendre ses données

L'application a **sa propre base**, distincte de celle du dépôt (`data/db`). Les deux ne
communiquent pas.

Pour amener ses tâches dans l'application :

1. Dans la version du dépôt, cliquer **Sauvegarder** (ou `npm run backup`).
2. Dans l'application, cliquer **Restaurer…** et choisir le fichier.

La restauration **fusionne** : elle ajoute ce qui manque et ne touche à rien d'existant. Le
remplacement exact — qui efface — reste réservé à la ligne de commande, où il se demande
explicitement avec l'en-tête `X-Confirm: replace`. Mettre ce bouton-là dans la barre latérale
aurait été poser un piège à un clic de distance.

---

## Reconstruire

```bash
npm install
npm test              # 222 tests serveur + 162 tests interface
npm run desktop       # lance l'application sans l'empaqueter
npm run dist          # produit l'installeur
```

Deux versions sont épinglées volontairement, et il faut savoir pourquoi avant de les monter :

- **electron@32** — la 44 casse à l'installation sous Node 22 (`require()` d'un module ESM dans
  son propre script d'installation).
- **electron-builder@24.13.3** — la 26 charge `@noble/hashes` v2, passé en ESM pur, avec un
  `require()` CommonJS. Le build échoue avant de commencer.
