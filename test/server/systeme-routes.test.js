const express = require('express');
const request = require('supertest');

const { ETAPES, creerEtatMaj } = require('../../lib/maj-etat');
const { creerRoutesSysteme } = require('../../lib/systeme-routes');

const journalMuet = { warn: () => {} };

const monter = (etat, options = {}) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/systeme',
    creerRoutesSysteme({
      etat,
      version: '3.0.1',
      dossierDonnees: 'C:\\Users\\quelquun\\AppData\\Roaming\\Cahier\\db',
      journal: journalMuet,
      ...options,
    })
  );
  return app;
};

/** Un état déjà branché sur un faux processus principal. */
const etatBranche = () => {
  const appels = [];
  const etat = creerEtatMaj();
  etat.brancher({
    chercher: () => {
      appels.push('chercher');
      return Promise.resolve();
    },
    installer: () => {
      appels.push('installer');
      return Promise.resolve();
    },
  });
  return { etat, appels };
};

describe('routes système', () => {
  test('GET dit la version, le dossier de données et l’état de la mise à jour', async () => {
    const { etat } = etatBranche();
    etat.poser({ etape: ETAPES.PRETE, version: '3.1.0' });

    const res = await request(monter(etat)).get('/systeme');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe('3.0.1');
    expect(res.body.dossierDonnees).toContain('Cahier');
    expect(res.body.maj).toMatchObject({ etape: ETAPES.PRETE, version: '3.1.0' });
  });

  test('chercher relance une recherche et rend l’état', async () => {
    const { etat, appels } = etatBranche();

    const res = await request(monter(etat)).post('/systeme/maj/chercher');

    expect(res.status).toBe(200);
    expect(appels).toEqual(['chercher']);
    expect(res.body.maj).toBeDefined();
  });

  test('installer redémarre, et rend l’état avant de partir', async () => {
    const { etat, appels } = etatBranche();
    etat.poser({ etape: ETAPES.PRETE, version: '3.1.0' });

    const res = await request(monter(etat)).post('/systeme/maj/installer');

    expect(res.status).toBe(200);
    expect(appels).toEqual(['installer']);
  });

  test('reporter garde la version sans l’installer', async () => {
    const { etat, appels } = etatBranche();
    etat.poser({ etape: ETAPES.PRETE, version: '3.1.0' });

    const res = await request(monter(etat)).post('/systeme/maj/reporter');

    expect(res.status).toBe(200);
    expect(res.body.maj.etape).toBe(ETAPES.REPORTEE);
    expect(appels).toEqual([]);
  });

  test('hors application empaquetée, agir sur la mise à jour est refusé proprement', async () => {
    // rien n'est branché : on est dans un navigateur, ou en développement
    const etat = creerEtatMaj();

    const res = await request(monter(etat)).post('/systeme/maj/installer');

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual(expect.any(String));
  });

  test('une page tierce ne peut pas faire redémarrer le Cahier', async () => {
    const { etat, appels } = etatBranche();
    etat.poser({ etape: ETAPES.PRETE, version: '3.1.0' });

    const res = await request(monter(etat))
      .post('/systeme/maj/installer')
      .set('Origin', 'https://site-malveillant.example');

    // l'API n'a pas d'authentification : sans ce garde-fou, n'importe quelle
    // page ouverte dans un navigateur du poste pourrait couper l'application
    expect(res.status).toBe(403);
    expect(appels).toEqual([]);
  });

  test('la page du Cahier elle-même n’est pas gênée par ce garde-fou', async () => {
    const { etat, appels } = etatBranche();

    const res = await request(monter(etat))
      .post('/systeme/maj/chercher')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('Host', '127.0.0.1:3000');

    expect(res.status).toBe(200);
    expect(appels).toEqual(['chercher']);
  });

  test('une origine explicitement autorisée passe', async () => {
    const { etat, appels } = etatBranche();

    const res = await request(monter(etat, { origineAutorisee: 'https://cahier.example' }))
      .post('/systeme/maj/chercher')
      .set('Origin', 'https://cahier.example');

    expect(res.status).toBe(200);
    expect(appels).toEqual(['chercher']);
  });

  test('la lecture reste ouverte : seules les actions sont gardées', async () => {
    const { etat } = etatBranche();

    const res = await request(monter(etat))
      .get('/systeme')
      .set('Origin', 'https://site-malveillant.example');

    // une page tierce ne pourra de toute façon pas lire la réponse : sans
    // en-tête CORS, le navigateur la lui refuse
    expect(res.status).toBe(200);
  });
});
