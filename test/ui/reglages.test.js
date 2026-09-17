import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

/* ---------------------------------------------------------------------------
   La page Réglages. Elle ne connaît aucun réglage : elle se dessine à partir
   du schéma que le serveur lui décrit. Ajouter un réglage dans
   lib/preferences.js doit suffire à le faire paraître ici.
   --------------------------------------------------------------------------- */

const HTML = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>')).replace(
  /<script[\s\S]*?<\/script>/g,
  ''
);

const { initReglages } = await import('../../public/js/reglages.js');
const { initPreferences } = await import('../../public/js/preferences.js');

const SCHEMA = {
  sections: {
    apparence: { titre: 'Apparence', note: 'Le papier et l’encre.' },
    misesAJour: { titre: 'Mises à jour', note: null },
  },
  schema: {
    apparence: {
      densite: {
        libelle: 'Densité',
        aide: 'L’espace entre les lignes.',
        type: 'choix',
        valeurs: [
          { valeur: 'confort', libelle: 'Confort' },
          { valeur: 'compact', libelle: 'Compact' },
        ],
        defaut: 'confort',
      },
      grain: { libelle: 'Grain du papier', type: 'booleen', defaut: true },
    },
    misesAJour: {
      prevenir: { libelle: 'Prévenir quand une version est prête', type: 'booleen', defaut: true },
    },
  },
};

const VALEURS = {
  apparence: { densite: 'confort', grain: true },
  misesAJour: { prevenir: true },
};

const systeme = (maj = { etape: 'repos', version: null, progression: 0, message: null }) => ({
  version: '3.0.1',
  dossierDonnees: 'C:\\Users\\quelquun\\AppData\\Roaming\\Cahier\\db',
  maj,
});

const armer = (options = {}) => {
  const journal = { ecrits: [], gestes: [], schemas: 0, systemes: 0 };
  const serveur = {
    valeurs: VALEURS,
    panne: null,
  };

  const preferences = initPreferences({
    lire: async () => serveur.valeurs,
    ecrire: async (patch) => {
      if (serveur.panne) throw serveur.panne;
      journal.ecrits.push(patch);
      serveur.valeurs = Object.fromEntries(
        Object.entries(serveur.valeurs).map(([section, reglages]) => [
          section,
          { ...reglages, ...(patch[section] || {}) },
        ])
      );
      return serveur.valeurs;
    },
  });

  const reglages = initReglages({
    preferences,
    lireSchema: async () => {
      journal.schemas += 1;
      return SCHEMA;
    },
    lireSysteme: async () => {
      journal.systemes += 1;
      return options.systeme || systeme();
    },
    agirMaj: async (quoi) => {
      journal.gestes.push(quoi);
      return options.systeme || systeme();
    },
    toast: (message, variante) => journal.gestes.push(`toast:${variante}:${message}`),
    ...options.deps,
  });

  return { reglages, preferences, journal, serveur };
};

const champ = (chemin) => document.querySelector(`[data-reglage="${chemin}"] .reglage-controle`);

beforeEach(() => {
  document.body.innerHTML = BODY;
});

describe('page Réglages', () => {
  test('se construit à partir du schéma, sans rien savoir des réglages', async () => {
    const { reglages, preferences } = armer();
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.querySelectorAll('.reglages-section')).not.toHaveLength(0);
    expect(document.body.textContent).toContain('Apparence');
    expect(champ('apparence.densite')).toBeTruthy();
    expect(champ('apparence.grain')).toBeTruthy();
  });

  test('un choix s’affiche avec ses options et la valeur courante', async () => {
    const { reglages, preferences } = armer();
    await preferences.charger();

    await reglages.ouvrir();

    const select = champ('apparence.densite');
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual(['confort', 'compact']);
    expect(select.value).toBe('confort');
  });

  test('un booléen s’affiche coché quand il l’est', async () => {
    const { reglages, preferences } = armer();
    await preferences.charger();

    await reglages.ouvrir();

    expect(champ('apparence.grain').checked).toBe(true);
  });

  test('changer un choix l’enregistre', async () => {
    const { reglages, preferences, journal } = armer();
    await preferences.charger();
    await reglages.ouvrir();

    const select = champ('apparence.densite');
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(journal.ecrits).toEqual([{ apparence: { densite: 'compact' } }]);
  });

  test('décocher une case l’enregistre', async () => {
    const { reglages, preferences, journal } = armer();
    await preferences.charger();
    await reglages.ouvrir();

    const case_ = champ('apparence.grain');
    case_.checked = false;
    case_.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(journal.ecrits).toEqual([{ apparence: { grain: false } }]);
  });

  test('un enregistrement refusé remet le champ comme il était, et le dit', async () => {
    const { reglages, preferences, journal, serveur } = armer();
    await preferences.charger();
    await reglages.ouvrir();
    serveur.panne = new Error('base injoignable');

    const select = champ('apparence.densite');
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // laisser le champ sur « compact » ferait croire à un réglage enregistré
    expect(select.value).toBe('confort');
    expect(journal.gestes.some((g) => g.startsWith('toast:error'))).toBe(true);
  });

  test('la version et le dossier de données sont nommés', async () => {
    const { reglages, preferences } = armer();
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.body.textContent).toContain('3.0.1');
    expect(document.body.textContent).toContain('Cahier\\db');
  });

  test('l’état de la mise à jour est dit en toutes lettres', async () => {
    const { reglages, preferences } = armer({
      systeme: systeme({ etape: 'prete', version: '3.1.0', progression: 100, message: null }),
    });
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.getElementById('reglages-maj-etat').textContent).toContain('3.1.0');
  });

  test('hors application installée, on ne propose pas de chercher une mise à jour', async () => {
    const { reglages, preferences } = armer({
      systeme: systeme({ etape: 'inactive', version: null, progression: 0, message: null }),
    });
    await preferences.charger();

    await reglages.ouvrir();

    // dans un navigateur, il n'y a pas de version publiée à comparer :
    // un bouton qui ne peut rien faire n'a rien à faire là
    expect(document.getElementById('reglages-maj-chercher').hidden).toBe(true);
  });

  test('« Chercher » demande au serveur et redit l’état', async () => {
    const { reglages, preferences, journal } = armer();
    await preferences.charger();
    await reglages.ouvrir();

    document.getElementById('reglages-maj-chercher').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(journal.gestes).toContain('chercher');
  });

  test('rouvrir la page ne redemande pas le schéma', async () => {
    const { reglages, preferences, journal } = armer();
    await preferences.charger();

    await reglages.ouvrir();
    reglages.fermer();
    await reglages.ouvrir();

    // le schéma ne change pas en cours de session ; l'état du système, si
    expect(journal.schemas).toBe(1);
    expect(journal.systemes).toBe(2);
  });

  test('un schéma injoignable n’ouvre pas une page vide sans explication', async () => {
    const { reglages, preferences, journal } = armer({
      deps: { lireSchema: () => Promise.reject(new Error('injoignable')) },
    });
    await preferences.charger();

    await reglages.ouvrir();

    expect(journal.gestes.some((g) => g.startsWith('toast:error'))).toBe(true);
  });
});

describe('page Réglages — la mise à jour vue de près', () => {
  const casDEtat = [
    ['telechargement', { etape: 'telechargement', version: '3.1.0', progression: 42 }, '42 %'],
    ['reportee', { etape: 'reportee', version: '3.1.0', progression: 100 }, 'à la fermeture'],
    ['echec', { etape: 'echec', version: '3.1.0', message: 'Mongo tenait encore.' }, 'Mongo'],
    ['recherche', { etape: 'recherche', version: null, progression: 0 }, 'Recherche'],
  ];

  test.each(casDEtat)('l’étape « %s » est dite en français', async (_nom, maj, attendu) => {
    const { reglages, preferences } = armer({ systeme: systeme(maj) });
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.getElementById('reglages-maj-etat').textContent).toContain(attendu);
  });

  test('une étape inconnue ne laisse pas la ligne vide', async () => {
    const { reglages, preferences } = armer({ systeme: systeme({ etape: 'inventée' }) });
    await preferences.charger();

    await reglages.ouvrir();

    // un serveur plus récent pourrait nommer une étape que cette page ignore
    expect(document.getElementById('reglages-maj-etat').textContent.trim()).not.toBe('');
  });

  test('l’heure de la dernière recherche est rappelée', async () => {
    const { reglages, preferences } = armer({
      systeme: systeme({ etape: 'repos', derniereRecherche: '2026-09-17T08:30:00Z' }),
    });
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.getElementById('reglages-maj-etat').textContent).toMatch(
      /Vérifié à \d{2}:\d{2}/
    );
  });

  test('une date de recherche illisible est simplement tue', async () => {
    const { reglages, preferences } = armer({
      systeme: systeme({ etape: 'repos', derniereRecherche: 'pas une date' }),
    });
    await preferences.charger();

    await reglages.ouvrir();

    expect(document.getElementById('reglages-maj-etat').textContent).not.toContain('Vérifié');
  });

  test('« Redémarrer maintenant » n’est proposé que sur une version prête', async () => {
    const { reglages, preferences, journal } = armer({
      systeme: systeme({ etape: 'prete', version: '3.1.0', progression: 100 }),
    });
    await preferences.charger();
    await reglages.ouvrir();

    expect(document.getElementById('reglages-maj-installer').hidden).toBe(false);
    document.getElementById('reglages-maj-installer').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(journal.gestes).toContain('installer');
  });

  test('un serveur qui refuse le redémarrage le dit au lieu de ne rien faire', async () => {
    const { reglages, preferences, journal } = armer({
      systeme: systeme({ etape: 'prete', version: '3.1.0', progression: 100 }),
      deps: { agirMaj: () => Promise.reject(new Error('installation impossible')) },
    });
    await preferences.charger();
    await reglages.ouvrir();

    document.getElementById('reglages-maj-installer').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(journal.gestes.some((g) => g.includes('installation impossible'))).toBe(true);
  });

  test('une recherche qui échoue le dit aussi', async () => {
    const { reglages, preferences, journal } = armer({
      deps: { agirMaj: () => Promise.reject(new Error('réseau absent')) },
    });
    await preferences.charger();
    await reglages.ouvrir();

    document.getElementById('reglages-maj-chercher').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(journal.gestes.some((g) => g.includes('réseau absent'))).toBe(true);
  });

  test('un système injoignable n’empêche pas d’ouvrir les réglages', async () => {
    const { reglages, preferences } = armer({
      deps: { lireSysteme: () => Promise.reject(new Error('injoignable')) },
    });
    await preferences.charger();

    await reglages.ouvrir();

    // les réglages d'apparence, eux, se règlent très bien sans le serveur
    expect(document.getElementById('settings-modal').classList.contains('active')).toBe(true);
    expect(champ('apparence.densite')).toBeTruthy();
  });

  test('sans réglages chargés, la page montre les valeurs par défaut', async () => {
    const { reglages } = armer();

    // le serveur n'a pas répondu au démarrage : la page doit quand même
    // s'ouvrir sur quelque chose de cohérent
    await reglages.ouvrir();

    expect(champ('apparence.densite').value).toBe('confort');
    expect(champ('apparence.grain').checked).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   Sauvegarder et restaurer, désormais dans les Réglages.

   Le corps de la page est reconstruit à chaque ouverture : ces gestes ne
   peuvent pas s'accrocher une fois pour toutes au chargement du module, et
   c'est tout l'objet de ces tests. L'envoi au serveur est injecté — ils
   n'ouvrent aucune connexion.
   --------------------------------------------------------------------------- */

/** Un fichier choisi dans le sélecteur, réduit à ce que le code en lit. */
const fichierChoisi = (contenu) => {
  const champFichier = document.getElementById('reglages-fichier');
  Object.defineProperty(champFichier, 'files', {
    configurable: true,
    value: [{ text: async () => contenu }],
  });
  champFichier.dispatchEvent(new Event('change'));
  return champFichier;
};

describe('sauvegarde et restauration', () => {
  test('la section Données porte les deux gestes, avant « À propos »', async () => {
    const { reglages } = armer();

    await reglages.ouvrir();

    const lien = document.getElementById('reglages-sauvegarder');
    expect(lien.getAttribute('href')).toBe('/export');
    expect(lien.hasAttribute('download')).toBe(true);
    expect(document.getElementById('reglages-restaurer')).toBeTruthy();

    const sections = [...document.querySelectorAll('.reglages-section')].map(
      (s) => s.dataset.section
    );
    expect(sections.indexOf('donnees')).toBeLessThan(sections.indexOf('apropos'));
  });

  test('restaurer envoie la sauvegarde lue, puis rafraîchit la liste', async () => {
    const envois = [];
    const { reglages } = armer({
      deps: {
        importer: async (contenu) => {
          envois.push(contenu);
          return { tasks: 12 };
        },
        rafraichir: async () => envois.push('rafraichi'),
      },
    });
    await reglages.ouvrir();

    fichierChoisi('{"tasks":[{"title":"relire"}]}');
    await new Promise((r) => setTimeout(r, 0));

    // fusionner, jamais remplacer : le mode part avec la requête
    expect(envois[0]).toMatchObject({ mode: 'merge', tasks: [{ title: 'relire' }] });
    expect(envois[1]).toBe('rafraichi');
  });

  test('un fichier illisible n’est jamais envoyé, et le dit avec des mots', async () => {
    const { reglages, journal } = armer({
      deps: {
        importer: async () => {
          throw new Error('on ne devrait pas arriver ici');
        },
      },
    });
    await reglages.ouvrir();

    fichierChoisi('ceci n’est pas du JSON');
    await new Promise((r) => setTimeout(r, 0));

    expect(journal.gestes).toContain("toast:error:Ce fichier n'est pas une sauvegarde du Cahier.");
  });

  test('une erreur du serveur est rapportée telle quelle', async () => {
    const { reglages, journal } = armer({
      deps: {
        importer: async () => {
          throw new Error('Sauvegarde refusée : format inconnu.');
        },
      },
    });
    await reglages.ouvrir();

    fichierChoisi('{"tasks":[]}');
    await new Promise((r) => setTimeout(r, 0));

    expect(journal.gestes).toContain('toast:error:Sauvegarde refusée : format inconnu.');
  });

  test('rouvrir les réglages rebranche les gestes', async () => {
    const envois = [];
    const { reglages } = armer({
      deps: { importer: async (c) => envois.push(c) || { tasks: 0 }, rafraichir: async () => {} },
    });

    await reglages.ouvrir();
    reglages.fermer();
    // le corps est réécrit à chaque ouverture : les éléments d'avant n'existent
    // plus, et un branchement fait une fois pour toutes serait perdu
    await reglages.ouvrir();

    fichierChoisi('{"tasks":[]}');
    await new Promise((r) => setTimeout(r, 0));

    expect(envois).toHaveLength(1);
  });

  test('la barre latérale ne porte plus ces gestes', async () => {
    // les laisser aux deux endroits ferait deux chemins à tenir, et deux
    // occasions de n'en réparer qu'un
    expect(HTML).not.toContain('id="export-link"');
    expect(HTML).not.toContain('id="open-restore"');
    expect(HTML).not.toContain('id="import-file"');
  });
});
