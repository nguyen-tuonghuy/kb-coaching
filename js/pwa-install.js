/* Installation PWA : aucune dépendance réseau ou authentification. */
(() => {
  if (!window.isSecureContext) return;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mode = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)');
  const key = 'kc-install-dismissed:' + new URL('.', location.href).pathname;
  let deferredPrompt = null, installedHere = false, prompting = false;
  let dismissed = false, cards = [], profileButtons = [], dialog = null;
  try { dismissed = localStorage.getItem(key) === '1'; } catch {}
  const installed = () => installedHere || navigator.standalone === true || mode.matches;
  const available = () => !installed() && (ios || android || Boolean(deferredPrompt));
  function render() {
    const show = available();
    for (const card of cards) card.hidden = !show || dismissed;
    for (const button of profileButtons) button.hidden = !show;
    if (installed() && dialog?.open) dialog.close();
  }
  function dismiss() {
    dismissed = true;
    try { localStorage.setItem(key, '1'); } catch {}
    render();
  }
  function showHelp() {
    if (!dialog || dialog.open) return;
    const title = dialog.querySelector('h2');
    const steps = dialog.querySelector('ol');
    title.textContent = ios ? 'Installer sur iPhone ou iPad' : 'Installer Kinball Coach';
    const instructions = ios ? [
      'Ouvre Kinball Coach dans Safari.',
      'Appuie sur Partager (le carré avec une flèche vers le haut).',
      'Choisis « Sur l’écran d’accueil ». Si « Ouvrir comme app web » apparaît, active cette option.',
      'Appuie sur « Ajouter », puis ouvre Kinball Coach depuis sa nouvelle icône.'
    ] : android ? [
      'Ouvre Kinball Coach dans Chrome ou un navigateur compatible.',
      'Ouvre le menu du navigateur (⋮).',
      'Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil », si proposé.',
      'Confirme, puis ouvre Kinball Coach depuis son icône.'
    ] : [
      'Ouvre le menu de ton navigateur ou l’icône d’installation dans la barre d’adresse.',
      'Choisis « Installer Kinball Coach », si cette option est proposée.'
    ];
    steps.replaceChildren(...instructions.map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    dialog.showModal();
  }
  async function install() {
    if (installed() || prompting) return;
    if (!deferredPrompt || ios) { showHelp(); return; }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    prompting = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') installedHere = true;
    } catch { showHelp(); }
    finally { prompting = false; render(); }
  }
  // Capture dès le chargement du script, avant le démarrage des modules métier.
  window.addEventListener('beforeinstallprompt', event => {
    if (ios || installed()) return;
    event.preventDefault();
    deferredPrompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedHere = true;
    render();
  });
  mode.addEventListener?.('change', render);
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    dismissed = event.newValue === '1';
    render();
  });
  function mount() {
    if (dialog) return;
    const homes = [
      document.querySelector('#appHome > .moduleGrid'),
      document.querySelector('#playerPortalHomeView > .playerPortalHomeGrid')
    ].filter(Boolean);
    const profileOpeners = [...document.querySelectorAll('#profilePopup [data-open-web-push], #playerPortalAccountCard [data-open-web-push]')];
    if (!homes.length && !profileOpeners.length) return;
    dialog = document.createElement('dialog');
    dialog.className = 'kcInstallDialog';
    dialog.setAttribute('aria-labelledby', 'kcInstallTitle');
    dialog.innerHTML = '<h2 id="kcInstallTitle"></h2><ol></ol><form method="dialog"><button type="submit" class="ghost">Fermer</button></form>';
    document.body.append(dialog);
    for (const anchor of homes) {
      const card = document.createElement('aside');
      card.className = 'kcInstallCard';
      card.hidden = true;
      card.setAttribute('aria-label', 'Installation de Kinball Coach');
      card.innerHTML = '<div class="kcInstallCopy"><strong>Installer Kinball Coach</strong><p>Retrouve l’application sur ton écran d’accueil et profite des notifications lorsqu’elles sont disponibles.</p></div><div class="kcInstallActions"><button type="button" class="primary" data-kc-install>Installer l’application</button><button type="button" class="ghost" data-kc-dismiss>Ne plus afficher</button></div>';
      card.querySelector('[data-kc-install]').addEventListener('click', install);
      card.querySelector('[data-kc-dismiss]').addEventListener('click', dismiss);
      anchor.before(card);
      cards.push(card);
    }
    for (const opener of profileOpeners) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost kcInstallProfile';
      button.textContent = 'Installer l’application';
      button.hidden = true;
      button.addEventListener('click', install);
      opener.after(button);
      profileButtons.push(button);
    }
    render();
  }
  // Le shell partagé monte les profils dans les scripts defer suivants.
  if (document.readyState === 'complete') mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
