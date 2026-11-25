const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../js/pwa-install.js'), 'utf8');

function setup(t, { ua = '', standalone = false, dismissed = false, platform = '', touch = 0 } = {}) {
  const dom = new JSDOM('<section id="appHome"><div class="moduleGrid"></div></section><div id="playerPortalHomeView"><div class="playerPortalHomeGrid"></div></div><div id="profilePopup"><button data-open-web-push>Notifications</button></div><div id="playerPortalAccountCard"><button data-open-web-push>Notifications</button></div>', { url: 'https://test.example/kb-coaching/index.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperties(w.navigator, { userAgent: { value: ua }, standalone: { value: standalone }, platform: { value: platform }, maxTouchPoints: { value: touch } });
  Object.defineProperty(w, 'isSecureContext', { value: true });
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (dismissed) w.localStorage.setItem('kc-install-dismissed:/kb-coaching/', '1');
  vm.runInContext(source, dom.getInternalVMContext());
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const all = selector => [...w.document.querySelectorAll(selector)];
  return { w, all, cards: all('.kcInstallCard'), profile: all('.kcInstallProfile'), dialog: all('.kcInstallDialog')[0] };
}

test('iPhone: instructions manuelles, refus mémorisé, profil toujours accessible', t => {
  const { w, cards, profile, dialog } = setup(t, { ua: 'iPhone' });
  assert.equal(cards.length, 2);
  assert.ok(cards.every(card => !card.hidden));
  cards[0].querySelector('[data-kc-install]').click();
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /Sur l’écran d’accueil/);
  dialog.close();
  cards[0].querySelector('[data-kc-dismiss]').click();
  assert.ok(cards.every(card => card.hidden));
  assert.ok(profile.every(button => !button.hidden));
  assert.equal(w.localStorage.getItem('kc-install-dismissed:/kb-coaching/'), '1');
  profile[1].click();
  assert.equal(dialog.open, true);
});
test('iPad en mode bureau et application déjà installée', t => {
  const a = setup(t, { platform: 'MacIntel', touch: 5 });
  assert.ok(a.cards.every(card => !card.hidden));
  const b = setup(t, { ua: 'iPhone', standalone: true });
  assert.ok(b.cards.every(card => card.hidden));
  assert.ok(b.profile.every(button => button.hidden));
});
test('Android : aide manuelle et choix déjà mémorisé', t => {
  const a = setup(t, { ua: 'Android', dismissed: true });
  assert.ok(a.cards.every(card => card.hidden));
  a.profile[0].click();
  assert.match(a.dialog.textContent, /menu du navigateur/);
});
test('Bureau : invitation native uniquement si le navigateur la propose', async t => {
  const { w, cards, profile } = setup(t);
  assert.ok(cards.every(card => card.hidden));
  const event = new w.Event('beforeinstallprompt', { cancelable: true });
  let calls = 0;
  event.prompt = async () => { calls++; };
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  w.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.ok(cards.every(card => !card.hidden));
  cards[0].querySelector('[data-kc-install]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.ok(cards.every(card => card.hidden));
  assert.ok(profile.every(button => button.hidden));
});
test('appinstalled masque toutes les propositions sans toucher aux notifications', t => {
  const { w, cards, profile } = setup(t, { ua: 'Android' });
  w.dispatchEvent(new w.Event('appinstalled'));
  assert.ok(cards.every(card => card.hidden));
  assert.ok(profile.every(button => button.hidden));
});
