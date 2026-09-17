import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

/* ---------------------------------------------------------------------------
   Le bandeau de mise à jour. Tout ce qu'il ne peut pas faire seul — interroger
   le serveur, agir sur la mise à jour, lire la préférence, battre la mesure —
   lui est injecté : ces tests n'ouvrent aucune connexion et ne dorment jamais.
   --------------------------------------------------------------------------- */

const HTML = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>')).replace(
  /<script[\s\S]*?<\/script>/g,
  ''
);

const { initMisesAJour } = await import('../../public/js/maj.js');

/**
 * Un faux minuteur : on déclenche ses battements à la main.
 * Il retire vraiment ce qu'on lui demande de retirer — sinon le test « on
 * cesse d'interroger » passerait quoi qu'il arrive.
 */
const fauxMinuteur = () => ({
  battements: new Map(),
  suivant: 0,
  arrets: 0,
  poser(rappel) {
    this.suivant += 1;
    this.battements.set(this.suivant, rappel);
    return this.suivant;
  },
  retirer(id) {
    this.arrets += 1;
    this.battements.delete(id);
  },
  async battre() {
    for (const rappel of [...this.battements.values()]) await rappel();
  },
});

const systeme = (maj) => ({ version: '3.0.1', dossierDonnees: 'C:\\Cahier\\db', maj });

/**
 * Arme le bandeau sur une suite de réponses serveur.
 * @param {object[]} reponses servies dans l'ordre ; la dernière se répète
 */
const armer = (reponses, options = {}) => {
  const appels = { lectures: 0, gestes: [] };
  const minuteur = fauxMinuteur();

  const bandeau = initMisesAJour({
    lireSysteme: () => {
      const reponse = reponses[Math.min(appels.lectures, reponses.length - 1)];
      appels.lectures += 1;
      return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse);
    },
    agir: (quoi) => {
      appels.gestes.push(quoi);
      return Promise.resolve(systeme({ etape: 'repos' }));
    },
    prevenir: () => true,
    toast: () => {},
    minuteur,
    ...options,
  });

  return { bandeau, appels, minuteur };
};

const el = (id) => document.getElementById(id);
const visible = () => !el('maj-banner').hidden;

beforeEach(() => {
  document.body.innerHTML = BODY;
});

describe('bandeau de mise à jour', () => {
  test('rien de prêt : le bandeau reste rangé', async () => {
    const { bandeau } = armer([systeme({ etape: 'repos' })]);

    await bandeau.rafraichir();

    expect(visible()).toBe(false);
  });

  test('un téléchargement en cours ne dérange pas non plus', async () => {
    const { bandeau } = armer([systeme({ etape: 'telechargement', version: '3.1.0' })]);

    await bandeau.rafraichir();

    // le téléchargement se fait en fond : l'annoncer serait une interruption
    // pour une chose que personne n'a demandée
    expect(visible()).toBe(false);
  });

  test('une version prête est annoncée, et nommée', async () => {
    const { bandeau } = armer([systeme({ etape: 'prete', version: '3.1.0' })]);

    await bandeau.rafraichir();

    expect(visible()).toBe(true);
    expect(el('maj-banner').textContent).toContain('3.1.0');
  });

  test('« Plus tard » range le bandeau et le dit au serveur', async () => {
    const { bandeau, appels } = armer([systeme({ etape: 'prete', version: '3.1.0' })]);
    await bandeau.rafraichir();

    el('maj-later').click();
    await Promise.resolve();

    expect(visible()).toBe(false);
    // sans le dire au serveur, le bandeau reviendrait au battement suivant
    expect(appels.gestes).toEqual(['reporter']);
  });

  test('« Redémarrer » demande l’installation', async () => {
    const { bandeau, appels } = armer([systeme({ etape: 'prete', version: '3.1.0' })]);
    await bandeau.rafraichir();

    el('maj-install').click();
    await Promise.resolve();

    expect(appels.gestes).toEqual(['installer']);
  });

  test('hors application installée, on cesse d’interroger le serveur', async () => {
    const { bandeau, appels, minuteur } = armer([systeme({ etape: 'inactive' })]);

    await bandeau.rafraichir();
    await minuteur.battre();

    // dans un navigateur, il n'y aura jamais de mise à jour : continuer à
    // demander toutes les minutes serait du bruit pour rien
    expect(minuteur.arrets).toBe(1);
    expect(appels.lectures).toBe(1);
    expect(visible()).toBe(false);
  });

  test('une réponse sans état ne fait rien apparaître, et arrête les questions', async () => {
    const { bandeau, minuteur } = armer([{}]);

    await bandeau.rafraichir();

    // on ne devine pas ce qu'on n'a pas reçu
    expect(visible()).toBe(false);
    expect(minuteur.arrets).toBe(1);
  });

  test('une panne de réseau ne fait rien apparaître', async () => {
    const { bandeau } = armer([new Error('serveur injoignable')]);

    await expect(bandeau.rafraichir()).resolves.toBeNull();

    expect(visible()).toBe(false);
  });

  test('la préférence « ne pas prévenir » garde le bandeau fermé', async () => {
    const { bandeau } = armer([systeme({ etape: 'prete', version: '3.1.0' })], {
      prevenir: () => false,
    });

    await bandeau.rafraichir();

    // la mise à jour se posera quand même à la fermeture : ne pas prévenir
    // n'est pas refuser
    expect(visible()).toBe(false);
  });

  test('un redémarrage impossible s’explique, sans proposer de recommencer', async () => {
    const { bandeau } = armer([
      systeme({
        etape: 'echec',
        version: '3.1.0',
        message: 'Le redémarrage n’a pas pu se faire maintenant.',
      }),
    ]);

    await bandeau.rafraichir();

    expect(visible()).toBe(true);
    expect(el('maj-banner').textContent).toContain('pas pu se faire');
    // proposer « Redémarrer » après un échec de redémarrage serait une impasse
    expect(el('maj-install').hidden).toBe(true);
  });

  test('une version reportée ne revient pas s’imposer', async () => {
    const { bandeau } = armer([systeme({ etape: 'reportee', version: '3.1.0' })]);

    await bandeau.rafraichir();

    expect(visible()).toBe(false);
  });

  test('le dernier état lu reste consultable pour la page Réglages', async () => {
    const { bandeau } = armer([systeme({ etape: 'prete', version: '3.1.0' })]);

    await bandeau.rafraichir();

    // la page Réglages lit ce que le bandeau a déjà demandé, plutôt que de
    // poser la même question au serveur
    expect(bandeau.dernier()).toMatchObject({ version: '3.0.1', maj: { etape: 'prete' } });
  });
});
