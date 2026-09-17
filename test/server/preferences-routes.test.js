const express = require('express');
const request = require('supertest');

const { DEFAUTS } = require('../../lib/preferences');
const { creerRoutesPreferences } = require('../../lib/preferences-routes');

/** Un dépôt en mémoire : les routes ne doivent rien savoir de Mongo. */
const fauxDepot = () => ({
  valeurs: DEFAUTS,
  ecrits: [],
  async lire() {
    return this.valeurs;
  },
  async ecrire(patch) {
    this.ecrits.push(patch);
    this.valeurs = { ...this.valeurs, ...patch };
    return this.valeurs;
  },
});

const depotEnPanne = () => ({
  lire: () => Promise.reject(new Error('base injoignable')),
  ecrire: () => Promise.reject(new Error('base injoignable')),
});

const journalMuet = { warn: () => {}, error: () => {} };

const monter = (depot) => {
  const app = express();
  app.use(express.json());
  app.use('/preferences', creerRoutesPreferences({ depot, journal: journalMuet }));
  return app;
};

describe('routes des préférences', () => {
  test('GET rend le document complet', async () => {
    const res = await request(monter(fauxDepot())).get('/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAUTS);
  });

  test('le schema est servi pour que la page Reglages se construise seule', async () => {
    const res = await request(monter(fauxDepot())).get('/preferences/schema');

    expect(res.status).toBe(200);
    // la page doit y trouver de quoi dessiner chaque champ sans rien deviner
    expect(res.body.sections.apparence.titre).toEqual(expect.any(String));
    expect(res.body.schema.apparence.densite.type).toBe('choix');
    expect(res.body.schema.apparence.densite.valeurs.length).toBeGreaterThan(1);
  });

  test('PUT enregistre le patch et rend le document résultant', async () => {
    const depot = fauxDepot();

    const res = await request(monter(depot))
      .put('/preferences')
      .send({ apparence: { densite: 'compact' } });

    expect(res.status).toBe(200);
    expect(depot.ecrits).toEqual([{ apparence: { densite: 'compact' } }]);
    expect(res.body.apparence.densite).toBe('compact');
  });

  test('PUT refuse un corps qui n’est pas un objet', async () => {
    const depot = fauxDepot();

    const res = await request(monter(depot)).put('/preferences').send('["compact"]').type('json');

    expect(res.status).toBe(400);
    // rien ne doit atteindre la base quand l'entrée est refusée
    expect(depot.ecrits).toEqual([]);
  });

  test('une base injoignable donne une 500 sans détail de machine', async () => {
    const res = await request(monter(depotEnPanne())).get('/preferences');

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual(expect.any(String));
    // le message de l'exception ne doit pas ressortir tel quel au client
    expect(res.body.error).not.toMatch(/injoignable/);
  });

  test('une écriture impossible donne une 500 elle aussi', async () => {
    const res = await request(monter(depotEnPanne())).put('/preferences').send({});

    expect(res.status).toBe(500);
  });
});
