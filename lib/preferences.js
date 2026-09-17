/* ---------------------------------------------------------------------------
   Cahier — les préférences : ce que l'utilisateur règle une fois et qui doit
   lui être rendu tel quel au lancement suivant.

   Un seul schéma gouverne tout : les valeurs par défaut, la validation de ce
   qui entre, et la construction de la page Réglages. Ajouter un réglage, c'est
   ajouter une ligne ici — rien d'autre n'a besoin de le savoir.

   Deux principes :
     — une valeur qu'on ne reconnaît pas ne fait pas échouer la lecture, elle
       retombe sur le défaut. Un réglage écrit par une version plus ancienne ne
       doit jamais rendre le cahier inutilisable ;
     — rien n'est modifié sur place : on rend toujours un document neuf.
   --------------------------------------------------------------------------- */

/** Un choix : la valeur stockée, et ce qu'on en lit à l'écran. */
const choix = (valeur, libelle) => ({ valeur, libelle });

/**
 * Le schéma, section par section. Chaque règle porte de quoi se dessiner
 * toute seule dans la page Réglages : un libellé, un type, ses valeurs.
 */
const SCHEMA = {
  apparence: {
    densite: {
      libelle: 'Densité',
      aide: 'L’espace entre les lignes du cahier.',
      type: 'choix',
      valeurs: [choix('confort', 'Confort'), choix('compact', 'Compact')],
      defaut: 'confort',
    },
    taille: {
      libelle: 'Taille du texte',
      type: 'choix',
      valeurs: [choix('petite', 'Petite'), choix('normale', 'Normale'), choix('grande', 'Grande')],
      defaut: 'normale',
    },
    grain: {
      libelle: 'Grain du papier',
      aide: 'Le léger tramé posé sur le fond.',
      type: 'booleen',
      defaut: true,
    },
    crayon: {
      libelle: 'Traits au crayon',
      aide: 'Les cadres et les cases dessinés à la main. Les décocher allège l’affichage.',
      type: 'booleen',
      defaut: true,
    },
  },

  ouverture: {
    statut: {
      libelle: 'Tâches affichées',
      type: 'choix',
      valeurs: [choix('all', 'Toutes'), choix('active', 'À faire'), choix('done', 'Rayées')],
      defaut: 'all',
    },
    horizon: {
      libelle: 'Échéance',
      type: 'choix',
      valeurs: [
        choix('all', 'Tout'),
        choix('overdue', 'En retard'),
        choix('today', 'Aujourd’hui'),
        choix('week', 'Cette semaine'),
        choix('none', 'Sans date'),
      ],
      defaut: 'all',
    },
    tri: {
      libelle: 'Tri',
      type: 'choix',
      valeurs: [
        choix('creation', 'Création'),
        choix('dueDate', 'Échéance'),
        choix('priority', 'Priorité'),
        choix('manual', 'Manuel'),
      ],
      defaut: 'creation',
    },
  },

  misesAJour: {
    prevenir: {
      libelle: 'Prévenir quand une version est prête',
      aide: 'Décoché, la mise à jour se posera silencieusement à la fermeture du Cahier.',
      type: 'booleen',
      defaut: true,
    },
  },
};

/** Ce que chaque section annonce en tête de page. */
const SECTIONS = {
  apparence: { titre: 'Apparence', note: 'Le papier et l’encre.' },
  ouverture: { titre: 'À l’ouverture', note: 'Ce que le Cahier montre en arrivant.' },
  misesAJour: { titre: 'Mises à jour', note: null },
};

/** Le document complet, tel qu'il est servi à qui n'a jamais rien réglé. */
const DEFAUTS = Object.fromEntries(
  Object.entries(SCHEMA).map(([section, reglages]) => [
    section,
    Object.fromEntries(Object.entries(reglages).map(([nom, regle]) => [nom, regle.defaut])),
  ])
);

/** Une valeur est retenue si le schéma la reconnaît ; sinon on garde l'ancienne. */
const valeurRetenue = (regle, proposee, actuelle) => {
  if (regle.type === 'booleen') {
    return typeof proposee === 'boolean' ? proposee : actuelle;
  }
  return regle.valeurs.some((v) => v.valeur === proposee) ? proposee : actuelle;
};

const estObjet = (valeur) =>
  typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);

/**
 * Rend un document de préférences complet et sûr à appliquer.
 *
 * L'entrée est traitée comme un patch : ce qu'elle ne dit pas est repris de
 * `base`. Ce qu'elle dit mal est repris de `base` aussi — une valeur inconnue
 * n'est pas une erreur, c'est un réglage qu'on ne sait pas honorer.
 *
 * @param {unknown} entree ce qui arrive du client, ou de la base
 * @param {object} [base] le document sur lequel appliquer le patch
 * @returns {object} un document neuf, jamais l'un des deux arguments
 */
const normaliserPreferences = (entree, base = DEFAUTS) => {
  const patch = estObjet(entree) ? entree : {};

  return Object.fromEntries(
    Object.entries(SCHEMA).map(([section, reglages]) => {
      const proposees = estObjet(patch[section]) ? patch[section] : {};
      const actuelles = estObjet(base[section]) ? base[section] : DEFAUTS[section];

      return [
        section,
        Object.fromEntries(
          Object.entries(reglages).map(([nom, regle]) => [
            nom,
            valeurRetenue(
              regle,
              proposees[nom],
              // la base peut elle-même être incomplète : le défaut reste le socle
              actuelles[nom] === undefined ? regle.defaut : actuelles[nom]
            ),
          ])
        ),
      ];
    })
  );
};

module.exports = { DEFAUTS, SCHEMA, SECTIONS, normaliserPreferences };
