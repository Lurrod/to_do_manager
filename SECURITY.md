# Sécurité

## Versions suivies

| Version | Correctifs de sécurité |
| ------- | ---------------------- |
| 3.1.x   | oui                    |
| < 3.1   | non                    |

Il n'y a pas de rétroportage : une version antérieure se remplace par la
dernière.

**La mise à jour automatique commence à la 3.0.0.** La 2.0.0 n'embarque pas le
code qui va la chercher : un poste qui en est resté là ne verra jamais rien
arriver et doit être mis à jour à la main, une dernière fois.

## Signaler une faille

Passer par **Security → Report a vulnerability** sur le dépôt GitHub
(_private vulnerability reporting_). Le rapport reste privé jusqu'au correctif.

Ne pas ouvrir d'issue publique pour une faille exploitable.

Délai visé : accusé de réception sous 7 jours, correctif ou position motivée
sous 30 jours. C'est un projet tenu par une personne — ces délais sont une
intention, pas un engagement contractuel.

## Ce que le Cahier protège, et ce qu'il ne protège pas

Le Cahier est une application **locale, mono-utilisateur**. Ce cadre décide de
presque tout le reste :

- **L'API n'a aucune authentification.** Elle n'écoute que sur la boucle locale
  (`127.0.0.1`). Quiconque a une session ouverte sur la machine a accès aux
  données — comme pour n'importe quel fichier du dossier personnel.
- **Les données ne sont pas chiffrées au repos.** Elles vivent en clair dans
  `%APPDATA%\Cahier\db`. Sur un poste partagé ou un disque non chiffré, c'est
  le chiffrement du disque qui protège, pas l'application.
- **La désinstallation ne supprime pas les données.** `%APPDATA%\Cahier` reste
  en place, délibérément : une mise à jour ne doit pas effacer un cahier.
- **Exposer le serveur sur le réseau (`HOST=0.0.0.0`) revient à ouvrir la base
  à tout le réseau.** Ce n'est pas un mode pris en charge.

## Ce qui est tenu

- **Processus de rendu bridé** : `nodeIntegration: false`,
  `contextIsolation: true`, aucun préchargement privilégié. Un lien externe
  s'ouvre dans le navigateur du système, jamais dans la fenêtre.
- **Instance unique** : deux processus ouvriraient la même base.
- **Entrées validées aux frontières** : l'import de sauvegarde refuse un
  document mal formé ou aux identifiants dupliqués _avant_ de toucher à la
  base, et remet la base en place si l'écriture échoue en cours de route.
- **Exports assainis** : une cellule commençant par `=`, `+`, `-` ou `@` est
  neutralisée à l'export CSV — un tableur l'exécuterait comme une formule.
- **Pas d'opérateur Mongo fourni par le client** : les filtres de `GET /tasks`
  et les listes d'identifiants sont construits côté serveur.
- **Les réglages sont validés contre un schéma fermé** : `PUT /preferences`
  n'écrit que des clés connues et des valeurs énumérées à l'avance. Une clé
  inventée est jetée, une valeur non reconnue retombe sur le défaut. Rien de ce
  qui entre par là n'atteint la base tel quel.
- **Aucun texte interpolé dans un script** : les notifications passent leur
  contenu à PowerShell par l'environnement, jamais par la ligne de commande.
- **Les actions sur la mise à jour sont gardées par l'origine** : un `POST` sur
  `/systeme/maj/*` refuse une requête portant un en-tête `Origin` qui n'est pas
  celui du serveur. Sans cela, n'importe quelle page ouverte dans un navigateur
  du poste pourrait faire redémarrer le Cahier — elle ne lirait pas la réponse,
  mais elle n'a pas besoin de la lire pour couper l'application. La lecture
  (`GET /systeme`) reste ouverte : sans en-tête CORS, le navigateur refuse déjà
  sa réponse à une page tierce.

## Mise à jour automatique : sur quoi repose la confiance

L'application installée interroge les releases du dépôt, télécharge en fond et
pose la nouvelle version après accord de l'utilisateur. Il faut savoir ce qui
garantit — et ce qui ne garantit pas — que ce qui s'installe est bien le
Cahier.

- **Ce qui est vérifié** : le transport est en HTTPS, et electron-updater
  contrôle l'empreinte SHA512 de l'installeur contre celle publiée dans
  `latest.yml`.
- **Ce qui ne l'est pas** : l'installeur n'étant pas signé, la vérification de
  l'éditeur (Authenticode) ne s'applique pas. Or l'installeur et le `latest.yml`
  qui l'atteste sortent de la **même** release, publiée par le **même** jeton.
  L'empreinte prouve que le fichier n'a pas été altéré en chemin ; elle ne
  prouve pas de qui il vient.

**Autrement dit, l'authenticité des mises à jour repose entièrement sur la
sécurité du compte GitHub propriétaire et de la chaîne de publication.**
Quiconque peut publier une release sur ce dépôt peut distribuer un binaire
arbitraire aux postes installés. En découlent trois exigences, qui ne sont pas
des recommandations :

- double authentification obligatoire sur le compte propriétaire ;
- aucun jeton de publication à portée en dehors de `release.yml` ;
- releases publiées depuis un brouillon relu, jamais automatiquement.

Signer l'exécutable est ce qui lèverait cette dépendance. Tant que ce n'est pas
fait, c'est le compte qui est le périmètre de sécurité.

### Ce que signer demanderait

La signature de code n'est pas un réglage : elle exige un certificat délivré après
vérification d'identité. Trois voies praticables pour un projet de cette taille :

| Voie                      | Coût indicatif | Remarque                                                         |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| **SignPath Foundation**   | gratuit        | réservé aux projets libres ; dossier à déposer                   |
| **Certum Open Source**    | ~25 €/an       | carte à puce, vérification d'identité                            |
| **Azure Trusted Signing** | ~10 $/mois     | le plus simple à automatiser, éligibilité variable selon le pays |

Côté code, rien à changer : `electron-builder` signe dès qu'il trouve `CSC_LINK` et
`CSC_KEY_PASSWORD` dans l'environnement. Il suffirait de les poser en secrets du dépôt
et `release.yml` signerait sans autre modification.

Tant que ce n'est pas fait, l'empreinte SHA-256 publiée avec chaque release est le seul
moyen offert à quelqu'un de vérifier ce qu'il a téléchargé.

## Dépendances

- `npm audit --omit=dev --audit-level=high` **bloque** la CI. Une faille haute
  ou critique dans ce qui est installé chez les gens arrête la chaîne.
- L'audit complet, outils de développement compris, tourne à chaque CI sans
  bloquer : ces paquets ne partent pas dans l'installeur.
- Dependabot ouvre une PR groupée par semaine.
- **Les dépendances de production ne portent aujourd'hui aucune faille connue**
  (`npm audit --omit=dev` : 0). C'est un état, pas une garantie : il se vérifie
  à chaque exécution de la CI.

### Risques acceptés, à date

| Sujet                                | Pourquoi il reste                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron` 32, `electron-builder` 24 | Les versions majeures suivantes cassent sur Node 22. Montée liée à un changement de socle Node, pas à une PR automatique.                                                                                  |
| Installeur non signé                 | Pas de certificat de signature de code. SmartScreen avertit à la première installation, et l'authenticité des mises à jour se réduit au compte GitHub (voir plus haut). Bloquant pour un déploiement géré. |

Ces deux points sont des décisions, pas des oublis. Ils se relisent à chaque
version majeure.
