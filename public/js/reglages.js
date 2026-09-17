/* ---------------------------------------------------------------------------
   Cahier — la page Réglages.

   Elle ne connaît aucun réglage. Elle demande au serveur de lui décrire ce
   qu'il sait tenir (`GET /preferences/schema`) et se dessine à partir de cette
   description. Ajouter un réglage dans `lib/preferences.js` le fait paraître
   ici sans qu'on touche à ce fichier — c'est tout l'intérêt.

   Ce qu'elle ne peut pas faire seule lui est injecté : lire le schéma,
   interroger le système, agir sur la mise à jour, écrire les réglages.
   --------------------------------------------------------------------------- */

import { brancherSauvegarde } from './backup.js';
import { closeModal, openModal } from './modal.js';
import { sketchAll, unsketchAll } from './sketch.js';
import { $, escapeHtml } from './util.js';

/** Ce que la page dit de chaque étape de la mise à jour. */
const PHRASES_MAJ = {
  inactive: () =>
    'Le Cahier tourne depuis le dépôt : il n’y a pas de version publiée à laquelle se comparer.',
  repos: () => 'Le Cahier est à jour.',
  recherche: () => 'Recherche en cours…',
  telechargement: (maj) =>
    `Téléchargement de la version ${maj.version || 'suivante'}… ${maj.progression} %`,
  prete: (maj) =>
    `La version ${maj.version || 'suivante'} est prête. Elle se posera au redémarrage.`,
  reportee: (maj) =>
    `La version ${maj.version || 'suivante'} est prête. Elle se posera à la fermeture du Cahier.`,
  echec: (maj) => maj.message || 'La dernière tentative n’a pas abouti.',
};

/** Heure de la dernière recherche, pour dire quand plutôt que de le taire. */
const heure = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

/**
 * @param {object} deps
 * @param {ReturnType<import('./preferences.js').initPreferences>} deps.preferences
 * @param {() => Promise<{sections: object, schema: object}>} deps.lireSchema
 * @param {() => Promise<object>} deps.lireSysteme
 * @param {(quoi: string) => Promise<object>} deps.agirMaj
 * @param {(contenu: object) => Promise<{tasks: number}>} deps.importer fusionne une sauvegarde
 * @param {() => Promise<void>} deps.rafraichir relit la liste après une fusion
 * @param {(message: string, variante?: string) => void} deps.toast
 */
export const initReglages = ({
  preferences,
  lireSchema,
  lireSysteme,
  agirMaj,
  importer,
  rafraichir = () => Promise.resolve(),
  toast,
}) => {
  const modale = $('settings-modal');
  const corps = $('settings-body');

  /** Le schéma ne change pas en cours de session : une seule demande suffit. */
  let schema = null;

  /* ------------------------------ dessin ------------------------------ */

  const ligneChoix = (chemin, regle, valeur) => `
    <label class="reglage-libelle" for="reglage-${escapeHtml(chemin)}">
      ${escapeHtml(regle.libelle)}
      ${regle.aide ? `<small class="reglage-aide">${escapeHtml(regle.aide)}</small>` : ''}
    </label>
    <span class="field" data-sketch="select">
      <select class="reglage-controle" id="reglage-${escapeHtml(chemin)}">
        ${regle.valeurs
          .map(
            (option) =>
              `<option value="${escapeHtml(option.valeur)}"${option.valeur === valeur ? ' selected' : ''}>${escapeHtml(option.libelle)}</option>`
          )
          .join('')}
      </select>
    </span>
  `;

  const ligneBooleen = (chemin, regle, valeur) => `
    <label class="reglage-libelle" for="reglage-${escapeHtml(chemin)}">
      ${escapeHtml(regle.libelle)}
      ${regle.aide ? `<small class="reglage-aide">${escapeHtml(regle.aide)}</small>` : ''}
    </label>
    <span class="reglage-case" data-sketch="checkbox">
      <input
        type="checkbox"
        class="reglage-controle"
        id="reglage-${escapeHtml(chemin)}"
        ${valeur ? 'checked' : ''}
      />
    </span>
  `;

  const dessinerSection = (cle, entete, reglages, valeurs) => `
    <section class="reglages-section" data-section="${escapeHtml(cle)}">
      <h3 class="reglages-titre">${escapeHtml(entete.titre)}</h3>
      ${entete.note ? `<p class="reglages-note">${escapeHtml(entete.note)}</p>` : ''}
      ${Object.entries(reglages)
        .map(([nom, regle]) => {
          const chemin = `${cle}.${nom}`;
          const valeur = valeurs?.[cle]?.[nom] ?? regle.defaut;
          return `
            <div class="reglage" data-reglage="${escapeHtml(chemin)}">
              ${regle.type === 'choix' ? ligneChoix(chemin, regle, valeur) : ligneBooleen(chemin, regle, valeur)}
            </div>
          `;
        })
        .join('')}
    </section>
  `;

  /** Le bloc « où en est la mise à jour », greffé sous la section qui en parle. */
  const BLOC_MAJ = `
    <div class="reglages-maj">
      <p class="reglages-maj-etat" id="reglages-maj-etat"></p>
      <button
        id="reglages-maj-chercher"
        class="btn"
        type="button"
        data-sketch="button"
        data-tone="neutral"
      >
        Chercher une mise à jour
      </button>
      <button
        id="reglages-maj-installer"
        class="btn"
        type="button"
        data-sketch="button"
        data-variant="solid"
        hidden
      >
        Redémarrer maintenant
      </button>
    </div>
  `;

  /**
   * Sauvegarder et restaurer.
   *
   * Placé juste avant « À propos », qui nomme le dossier où vivent les
   * données : les deux gestes et l'endroit dont ils parlent se suivent.
   */
  const BLOC_DONNEES = `
    <section class="reglages-section" data-section="donnees">
      <h3 class="reglages-titre">Données</h3>
      <div class="reglages-donnees">
        <a
          class="btn"
          id="reglages-sauvegarder"
          href="/export"
          download
          data-sketch="button"
          data-tone="neutral"
          >Sauvegarder</a
        >
        <button
          id="reglages-restaurer"
          class="btn"
          type="button"
          data-sketch="button"
          data-tone="neutral"
        >
          Restaurer…
        </button>
        <input type="file" id="reglages-fichier" accept="application/json,.json" hidden />
      </div>
      <p class="reglages-note">
        Restaurer ajoute ce qui manque et ne touche à rien d’existant.
      </p>
    </section>
  `;

  const blocAPropos = (systeme) => `
    <section class="reglages-section" data-section="apropos">
      <h3 class="reglages-titre">À propos</h3>
      <dl class="reglages-faits">
        <dt>Version</dt>
        <dd>${escapeHtml(systeme.version || '—')}</dd>
        <dt>Données</dt>
        <dd><code>${escapeHtml(systeme.dossierDonnees || '—')}</code></dd>
      </dl>
      <p class="reglages-note">
        Le dossier de données survit aux mises à jour comme à la désinstallation.
      </p>
    </section>
  `;

  /* ------------------------------ mise à jour ------------------------------ */

  /** Reporte l'état du système sur la section « Mises à jour ». */
  const direEtatMaj = (systeme) => {
    const ligne = $('reglages-maj-etat');
    if (!ligne) return;

    const maj = systeme?.maj || { etape: 'inactive' };
    const phrase = (PHRASES_MAJ[maj.etape] || PHRASES_MAJ.repos)(maj);
    const quand = heure(maj.derniereRecherche);

    ligne.textContent =
      quand && (maj.etape === 'repos' || maj.etape === 'recherche')
        ? `${phrase} Vérifié à ${quand}.`
        : phrase;

    const inactive = maj.etape === 'inactive';
    // un bouton qui ne peut rien faire n'a rien à faire là
    $('reglages-maj-chercher').hidden = inactive;
    $('reglages-maj-installer').hidden = !['prete', 'reportee'].includes(maj.etape);
  };

  /* ------------------------------ écriture ------------------------------ */

  /**
   * Enregistre un réglage. Le magasin l'applique tout de suite et le retire si
   * le serveur refuse ; il ne reste ici qu'à remettre le champ d'accord avec
   * ce qui est réellement enregistré.
   */
  const enregistrer = async (section, nom, valeur, controle, valeurAvant) => {
    try {
      await preferences.regler({ [section]: { [nom]: valeur } });
    } catch (erreur) {
      if (controle.type === 'checkbox') controle.checked = valeurAvant;
      else controle.value = valeurAvant;
      toast(erreur.message, 'error');
    }
  };

  const brancherChamps = () => {
    corps.querySelectorAll('.reglage').forEach((ligne) => {
      const [section, nom] = ligne.dataset.reglage.split('.');
      const controle = ligne.querySelector('.reglage-controle');
      const lireChamp = () => (controle.type === 'checkbox' ? controle.checked : controle.value);

      let valeurAvant = lireChamp();
      controle.addEventListener('change', () => {
        const valeur = lireChamp();
        const precedente = valeurAvant;
        valeurAvant = valeur;
        enregistrer(section, nom, valeur, controle, precedente);
      });
    });

    brancherSauvegarde({ racine: corps, importer, rafraichir, toast });

    $('reglages-maj-chercher').addEventListener('click', async () => {
      try {
        direEtatMaj(await agirMaj('chercher'));
      } catch (erreur) {
        toast(erreur.message, 'error');
      }
    });

    $('reglages-maj-installer').addEventListener('click', async () => {
      try {
        await agirMaj('installer');
      } catch (erreur) {
        toast(erreur.message, 'error');
      }
    });
  };

  /* ------------------------------ ouverture ------------------------------ */

  const construire = async () => {
    schema = schema || (await lireSchema());
    const systeme = await lireSysteme().catch(() => null);
    const valeurs = preferences.valeurs();

    unsketchAll(corps);
    corps.innerHTML = [
      ...Object.entries(schema.schema).map(([cle, reglages]) =>
        dessinerSection(cle, schema.sections[cle] || { titre: cle, note: null }, reglages, valeurs)
      ),
      BLOC_DONNEES,
      blocAPropos(systeme || {}),
    ].join('');

    // le bloc d'état se greffe sous la section qui parle des mises à jour,
    // là où quelqu'un le cherchera
    const sectionMaj = corps.querySelector('[data-section="misesAJour"]') || corps.lastElementChild;
    sectionMaj.insertAdjacentHTML('beforeend', BLOC_MAJ);

    direEtatMaj(systeme);
    brancherChamps();
    sketchAll(corps);
  };

  const ouvrir = async () => {
    try {
      await construire();
    } catch (erreur) {
      // ouvrir une page vide sans un mot serait pire que ne pas l'ouvrir
      toast(erreur.message || 'Les réglages n’ont pas pu être chargés.', 'error');
      return;
    }
    openModal(modale);
  };

  const fermer = () => closeModal(modale);

  return { ouvrir, fermer };
};
