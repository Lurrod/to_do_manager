/* ---------------------------------------------------------------------------
   Cahier — le seul module qui parle au système d'exploitation.

   Le toast passe par PowerShell et l'API WinRT, déjà présentes sur la machine :
   une bibliothèque ferait le même travail avec huit dépendances de plus.

   L'émetteur est reçu en argument pour que les tests n'affichent jamais de
   vraie notification.
   --------------------------------------------------------------------------- */

const { spawn } = require('child_process');

/**
 * Le script lit son texte dans l'environnement et l'échappe lui-même.
 *
 * Interpoler le titre d'une tâche dans le script serait doublement fautif :
 * une apostrophe ou un guillemet le rendrait invalide, et une valeur choisie
 * y injecterait du code. L'environnement ne traverse pas l'analyseur syntaxique.
 */
const SCRIPT = `
$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$titre = [System.Security.SecurityElement]::Escape($env:CAHIER_TITRE)
$message = [System.Security.SecurityElement]::Escape($env:CAHIER_MESSAGE)
$xml = "<toast><visual><binding template=""ToastGeneric""><text>$titre</text><text>$message</text></binding></visual></toast>"
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
$aumid = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
`;

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command', SCRIPT];

/**
 * Lève une notification système.
 *
 * N'échoue jamais bruyamment : un rappel qui ne s'affiche pas ne doit faire
 * tomber ni le balayage, ni le serveur.
 *
 * @param {{title: string, message: string}} contenu
 * @param {Function} [spawner] injecté par les tests
 * @returns {Promise<boolean>} true si le canal a rendu la main sans erreur
 */
const sendNotification = ({ title, message }, spawner = spawn) =>
  new Promise((resolve) => {
    try {
      const enfant = spawner('powershell', POWERSHELL_ARGS, {
        env: { ...process.env, CAHIER_TITRE: title, CAHIER_MESSAGE: message },
        windowsHide: true,
      });
      enfant.on('error', () => resolve(false));
      enfant.on('close', (code) => resolve(code === 0));
    } catch (_) {
      resolve(false);
    }
  });

module.exports = { POWERSHELL_ARGS, sendNotification };
