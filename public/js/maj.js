/* ---------------------------------------------------------------------------
   Cahier — le bandeau de mise à jour.

   Il ne s'ouvre que sur une version déjà téléchargée, prête à se poser : la
   recherche et le téléchargement se font en fond, sans rien dire. Le Cahier ne
   coupe jamais la parole à quelqu'un qui écrit.

   Tout ce que ce module ne peut pas faire seul lui est injecté — interroger le
   serveur, agir sur la mise à jour, lire la préférence, battre la mesure. Les
   tests n'ouvrent donc aucune connexion et ne dorment jamais.
   --------------------------------------------------------------------------- */

import { sketchAll, unsketchAll } from './sketch.js';
import { $ } from './util.js';

/** Une minute : assez pour ne rien manquer, assez peu pour ne rien coûter. */
const INTERVALLE_MS = 60_000;

/** Les seules étapes qui méritent d'interrompre la page. */
const PARLANTES = ['prete', 'echec'];

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.lireSysteme `GET /systeme`
 * @param {(quoi: 'chercher'|'installer'|'reporter') => Promise<object>} deps.agir
 * @param {() => boolean} deps.prevenir la préférence « prévenir quand une
 *   version est prête », lue à chaque fois : elle peut changer en cours de route
 * @param {(message: string, variante?: string) => void} deps.toast
 * @param {{poser: Function, retirer: Function}} [deps.minuteur]
 * @param {number} [deps.intervalleMs]
 * @returns {{rafraichir: () => Promise<object|null>, dernier: () => object|null}}
 */
export const initMisesAJour = ({
  lireSysteme,
  agir,
  prevenir,
  toast,
  minuteur = { poser: setInterval, retirer: clearInterval },
  intervalleMs = INTERVALLE_MS,
}) => {
  const bandeau = $('maj-banner');
  const titre = $('maj-title');
  const detail = $('maj-detail');
  const boutonInstaller = $('maj-install');
  const boutonPlusTard = $('maj-later');

  /** Dernier état lu, partagé avec la page Réglages pour ne pas demander deux fois. */
  let dernierEtat = null;
  let battement = null;
  /** Ce que l'utilisateur a rangé à la main ne doit pas revenir au battement suivant. */
  let rangeALaMain = false;

  const ranger = () => {
    if (bandeau.hidden) return;
    unsketchAll(bandeau);
    bandeau.hidden = true;
  };

  const montrer = (titreTexte, detailTexte, { avecInstallation }) => {
    titre.textContent = titreTexte;
    detail.textContent = detailTexte;
    boutonInstaller.hidden = !avecInstallation;

    if (bandeau.hidden) {
      bandeau.hidden = false;
      // les traits se mesurent à l'attache : rien à dessiner tant que le
      // bandeau est caché, tout à dessiner dès qu'il paraît
      sketchAll(bandeau);
    }
  };

  const arreter = () => {
    if (battement === null) return;
    minuteur.retirer(battement);
    battement = null;
  };

  /** Ce que le bandeau dit de chaque étape. Le silence est la règle. */
  const rendre = (maj) => {
    if (rangeALaMain || !prevenir() || !PARLANTES.includes(maj.etape)) return ranger();

    if (maj.etape === 'echec') {
      // proposer « Redémarrer » après un redémarrage impossible serait une
      // impasse : la version se posera d'elle-même à la fermeture
      return montrer('Le Cahier n’a pas pu redémarrer.', maj.message || '', {
        avecInstallation: false,
      });
    }

    const version = maj.version ? `La version ${maj.version} est prête.` : 'Une version est prête.';
    return montrer(version, 'Elle se posera à la fermeture si tu préfères finir d’abord.', {
      avecInstallation: true,
    });
  };

  /**
   * Va lire l'état du serveur.
   * @returns {Promise<object|null>} null quand le serveur n'a pas répondu —
   *   une panne ne doit rien faire apparaître : le Cahier s'utilise hors ligne
   */
  const rafraichir = async () => {
    try {
      const systeme = await lireSysteme();
      dernierEtat = systeme;

      // dans un navigateur ou en développement, il n'y aura jamais de mise à
      // jour : continuer à demander toutes les minutes serait du bruit. Une
      // réponse sans état — serveur plus ancien, réponse tronquée — se traite
      // pareil : on ne devine pas ce qu'on n'a pas reçu.
      if (!systeme?.maj || systeme.maj.etape === 'inactive') {
        arreter();
        ranger();
        return systeme;
      }

      rendre(systeme.maj);
      return systeme;
    } catch {
      return null;
    }
  };

  const demander = async (quoi) => {
    try {
      dernierEtat = await agir(quoi);
    } catch (erreur) {
      toast(erreur.message, 'error');
    }
  };

  boutonPlusTard.addEventListener('click', async () => {
    rangeALaMain = true;
    ranger();
    // sans le dire au serveur, le bandeau reviendrait au prochain battement
    await demander('reporter');
  });

  boutonInstaller.addEventListener('click', async () => {
    titre.textContent = 'Fermeture du Cahier…';
    await demander('installer');
  });

  battement = minuteur.poser(rafraichir, intervalleMs);

  return { rafraichir, arreter, dernier: () => dernierEtat };
};
