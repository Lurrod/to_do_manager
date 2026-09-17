# Journal des versions

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

Une version se publie en étiquetant un commit : `npm version <niveau>` puis
`git push --follow-tags`. L'étiquette construit l'installeur et le dépose en
release brouillon ; publier ce brouillon dans GitHub est ce qui la rend visible
des postes déjà installés.

## [3.1.0] — 2026-09-17

### Ajouté

- **Une page Réglages**, ouverte par le bouton de l'en-tête ou par la palette
  (`Ctrl`+`K`). Elle dit aussi où en est la mise à jour, permet d'en chercher
  une sans attendre le prochain lancement, et nomme la version installée ainsi
  que le dossier où vivent les données.
- **L'apparence se règle** : densité des lignes, taille du texte, grain du
  papier, et traits au crayon — ces derniers peuvent être rangés, ce qui allège
  nettement l'affichage sur une longue liste. Le choix est repris tel quel au
  lancement suivant, sans que la page s'ouvre d'abord dans l'autre mise en page.
- **La vue d'ouverture se règle** : le Cahier peut s'ouvrir directement sur les
  tâches à faire de la semaine, triées par échéance, plutôt que sur tout.
- **Une préférence pour la mise à jour** : décocher « prévenir quand une version
  est prête » fait disparaître le bandeau — la version se posera alors sans un
  mot à la fermeture.

### Modifié

- **La mise à jour se propose dans le Cahier, plus dans une boîte Windows.**
  Un bandeau de papier s'affiche en haut de la page, avec les mots de
  l'application : « La version 3.1.0 est prête. » Rien ne s'affiche tant que la
  version n'est pas téléchargée, et « Plus tard » ne la fait pas revenir toutes
  les minutes — elle se posera à la fermeture, comme avant.
- Un redémarrage qui échoue s'explique désormais dans ce même bandeau, au lieu
  d'une seconde boîte de dialogue.

## [3.0.1] — 2026-09-17

### Modifié

- Le sous-titre « to-do manager » disparaît de l'en-tête, du titre de la fenêtre
  et du manifeste : l'application s'appelle Cahier, et le répéter autrement ne
  disait rien de plus.
- **L'icône Windows porte enfin sept tailles** (16 à 256 px) au lieu d'une
  seule. Windows ne réduit pas gracieusement : le trait fin du carnet devenait
  illisible à 16 px dans l'Explorateur. L'installeur et le désinstalleur la
  portent aussi, ce qui n'était pas le cas.

### Documenté

- Les deux avertissements Windows — celui du navigateur au téléchargement et
  celui de SmartScreen au lancement — sont distingués dans le README, avec la
  marche à suivre pour chacun. Aucun réglage ne les supprime : ils portent sur
  l'absence de signature, pas sur le contenu du fichier.
- `SECURITY.md` chiffre ce que signer demanderait, et note que `release.yml`
  signerait sans modification dès que les secrets seraient posés.

## [3.0.0] — 2026-09-17

### Ajouté

- **Mise à jour automatique** depuis les releases GitHub. Le téléchargement se
  fait en fond, sans rien interrompre ; le redémarrage n'est proposé qu'une
  fois la version sur le disque, et se reporte à la fermeture si on décline.
  Une panne de réseau reste silencieuse : le Cahier s'utilise hors ligne.
- **Intégration continue** (`.github/workflows/ci.yml`) : formatage, audit des
  dépendances de production et 400 tests avec seuils de couverture, sur
  Windows, à chaque poussée et chaque PR.
- **Chaîne de publication** (`.github/workflows/release.yml`) : une étiquette
  `vX.Y.Z` construit l'installeur et le dépose en release **brouillon**. Plus
  aucune release ne sort d'un poste de développement. L'étiquette est confrontée à
  `package.json` avant de construire quoi que ce soit. Publier le brouillon reste
  un geste manuel : c'est lui qui déclenche la mise à jour des postes installés.
- `LICENSE` (ISC), `SECURITY.md` et ce journal.
- `SECURITY.md` nomme ce que l'application ne protège pas — absence
  d'authentification, données en clair au repos — et les trois risques acceptés
  à date.
- Dependabot : une PR groupée par semaine, montées majeures d'Electron
  volontairement ignorées.
- Prettier, avec `npm run format` et un contrôle bloquant en CI.
- Seuils de couverture bloquants : 85 % des lignes côté API, 88 % côté
  interface. Ils sont posés sous le niveau atteint — ils empêchent de
  redescendre plutôt que de récompenser.
- `scripts/fetch-mongod.js` : le binaire Mongo embarqué est téléchargé à une
  version écrite noir sur blanc, au lieu d'être pris dans le cache de la
  machine qui construit.

### Modifié

- `package-lock.json` est désormais versionné. Deux constructions à deux dates
  donnaient jusqu'ici deux applications différentes.
- Express 4.21 → 4.22 et Mongoose 8.9 → 8.24 : trois vulnérabilités modérées
  levées dans ce qui est installé chez les utilisateurs.
- L'arrêt des services (le verrou Mongo) est relâché par une fonction unique,
  qu'on ferme la fenêtre ou qu'on pose une mise à jour.
- Les notes de planification (`docs/`) sortent du dépôt. Ce qui devait survivre
  est dans `SECURITY.md`, `CHANGELOG.md` et `README.md`.

### Corrigé

- **Les icônes de l'application étaient des canevas blancs.** Le générateur
  d'origine chargeait `favicon.svg` par `<img src=…>` et n'obtenait rien : ce
  qui a été livré avec la 2.0.0 comme icône du raccourci, de la barre des
  tâches, de l'installeur et de la PWA était une image cassée. Mesuré à 0,86 %
  d'encre contre 82,5 % après réparation. `npm run icons` les refabrique à
  partir du SVG, désormais inséré dans la page et non référencé — et refuse
  d'écrire un rendu vide.

### Sécurité

- **Express 4 → 5.** La faille `qs` que le projet portait en risque accepté
  disparaît : les dépendances de production ne présentent plus aucune
  vulnérabilité connue. L'analyseur de requête d'Express 5 est par ailleurs plus
  strict — une porte de moins pour glisser un objet dans un paramètre d'URL.

  Montée vérifiée autrement que par la couleur de la CI : trente requêtes
  identiques rejouées sous 4.22.1 puis 5.2.1 — injections d'opérateurs Mongo,
  paramètres en tableau, routes à point, 404, validation de corps — réponses
  identiques, aux horodatages près.

- `.env` n'est plus suivi par git. Il l'était malgré le `.gitignore`, ajouté
  avant celui-ci : le jour où quelqu'un y aurait mis une URI Atlas avec un mot
  de passe, ce mot de passe partait dans un commit.

## [2.0.0] — 2026-09-16

Le Cahier devient une application installable, et gagne de quoi tenir un vrai
usage quotidien.

### Ajouté

- **Application Windows** : Electron, MongoDB embarqué, installeur NSIS de
  88 Mo, raccourci bureau et menu Démarrer. Aucune installation préalable, rien
  à télécharger au premier lancement.
- **Installable comme PWA** depuis le navigateur.
- **Vues temporelles** (aujourd'hui, semaine, en retard) et compteur de tâches
  en retard.
- **Saisie rapide en langage naturel** avec aperçu de ce qui a été compris.
- **Corbeille** : suppression réversible, restauration, purge confirmée.
- **Raccourcis clavier et palette de commandes**, navigable au clavier.
- **Sous-tâches** sur un niveau, avec compte des étapes et cochage en cascade.
- **Récurrence** : cocher une tâche récurrente crée l'occurrence suivante.
- **Étiquettes**, posables à la saisie et filtrables.
- **Ordre manuel** par glisser-déposer, sur indexation fractionnaire.
- **Rappels** avec notification système Windows.
- **Sauvegarde et restauration** : export JSON complet, import en fusion ou en
  remplacement confirmé, exports lisibles en Markdown et CSV, sauvegarde
  horodatée en ligne de commande et depuis l'interface.
- **Actions groupées** sur une sélection de tâches.
- `GET /healthz`, et démarrage tolérant à un port déjà occupé.
- Refonte graphique : le papier, l'encre et le trait dessiné.

### Corrigé

- Un import aux identifiants dupliqués est refusé **avant** d'effacer la base.
- Un import en remplacement qui échoue en cours d'écriture remet la base en
  place.
- L'application empaquetée écrit ses données dans `%APPDATA%\Cahier`, quel que
  soit le mode de lancement — trois chemins différents cohabitaient.
- Le verrou WiredTiger est relâché avant la sortie d'Electron.

### Sécurité

- Une cellule d'export CSV commençant par `=`, `+`, `-` ou `@` est neutralisée :
  un tableur l'exécuterait comme une formule.
- Les erreurs de lecture du corps de requête répondent en JSON assaini.

## Avant 2.0.0

Aucun journal n'était tenu. L'historique se lit dans les commits, depuis le
premier le 5 février 2025.
