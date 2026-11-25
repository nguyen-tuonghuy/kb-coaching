const CATEGORIES = ['videos', 'messages', 'training'];

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

function platformIssue() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) {
    return 'Sur iPhone ou iPad (iOS 16.4 ou ultérieur), ouvre le menu Partager, choisis « Sur l’écran d’accueil », puis ouvre Kinball Coach depuis son icône.';
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) ||
      !('Notification' in window) || !('caches' in window)) {
    return 'Les notifications push sont indisponibles dans ce navigateur.';
  }
  if (Notification.permission === 'denied') {
    return 'Les notifications sont bloquées. Tu peux les autoriser dans les réglages de ce site ou de l’appareil.';
  }
  return '';
}

function decodeKey(key) {
  return Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), char => char.charCodeAt(0));
}

async function enable(db, owner, registration, key, lifecycle) {
  const { storedDevice, rememberDevice, binding, removeDevice } = lifecycle;
  const { data, error } = await db.auth.getSession();
  if (error || data?.session?.user?.id !== owner) throw new Error('Account changed');
  const old = storedDevice();
  if (old && old.owner !== owner) await removeDevice(null, old.owner);
  let subscription = await registration.pushManager.getSubscription();
  let device = storedDevice();
  if (!device || !subscription || device.endpoint !== subscription.endpoint ||
      !await rpc(db, 'web_push_device_active', { p_proof: device.proof })) {
    if (device) await removeDevice(db, device.owner);
    else if (subscription) await subscription.unsubscribe();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(key),
    });
    device = { owner, proof: crypto.randomUUID(), endpoint: subscription.endpoint };
  }
  let registered = false;
  try {
    const { keys } = subscription.toJSON();
    const id = await rpc(db, 'register_web_push', {
      p_owner: owner, p_proof: device.proof, p_endpoint: subscription.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    });
    registered = true;
    rememberDevice(device);
    await binding(registration, id);
  } catch (error) {
    await binding(registration, null).catch(() => {});
    if (registered) await rpc(db, 'disable_web_push', { p_proof: device.proof }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
    rememberDevice(null);
    throw error;
  }
}

export function openSettings(db, owner, lifecycle) {
  const { storedDevice, deviceLock, removeDevice, reconcile } = lifecycle;
  const dialog = document.querySelector('#webPushDialog');
  if (!owner || !dialog || dialog.open) return;
  const status = dialog.querySelector('[role=status]');
  const buttons = Object.fromEntries(['enable', 'disable', 'test', 'save'].map(action =>
    [action, dialog.querySelector(`[data-push-action="${action}"]`)]));
  const fields = Object.fromEntries(CATEGORIES.map(category => [category, dialog.querySelector(`[name="${category}"]`)]));
  let pending = false, active = false, key = '', registration, applicable = false, preferencesLoaded = false;
  const sync = () => {
    buttons.enable.disabled = pending || active || !key || !applicable;
    buttons.disable.disabled = pending || storedDevice()?.owner !== owner;
    buttons.test.disabled = pending || !active || !applicable;
    buttons.save.disabled = pending || !preferencesLoaded;
    Object.values(fields).forEach(field => { field.disabled = buttons.save.disabled; });
  };
  const report = async (action, fallback) => {
    if (pending) return;
    pending = true;
    sync();
    try { await action(); }
    catch { status.textContent = fallback; }
    finally { pending = false; sync(); }
  };
  buttons.enable.onclick = () => report(async () => {
    if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
      status.textContent = platformIssue() || 'Autorisation non accordée.';
      applicable = !platformIssue();
      return;
    }
    await deviceLock(() => enable(db, owner, registration, key, lifecycle));
    active = true;
    status.textContent = 'Notifications actives sur cet appareil.';
  }, 'Impossible d’activer les notifications sur cet appareil.');
  buttons.disable.onclick = () => report(async () => {
    try { await deviceLock(() => removeDevice(db, owner)); }
    finally { active = false; }
    status.textContent = 'Notifications désactivées sur cet appareil.';
  }, 'Désactivation incomplète. Réessaie depuis cet appareil.');
  buttons.test.onclick = () => report(async () => {
    await rpc(db, 'test_web_push', { p_proof: storedDevice()?.proof });
    status.textContent = 'Test mis en file d’attente. Il devrait arriver dans les prochaines minutes.';
  }, 'Test indisponible. Attends deux minutes avant de réessayer.');
  buttons.save.onclick = () => report(async () => {
    const values = Object.fromEntries(CATEGORIES.map(category => [category, fields[category].checked]));
    const { error } = await db.from('web_push_preferences').upsert({ user_id: owner, ...values });
    if (error) throw error;
    status.textContent = 'Préférences enregistrées pour ton compte.';
  }, 'Impossible d’enregistrer les préférences.');

  dialog.showModal();
  status.textContent = 'Vérification de cet appareil…';
  report(async () => {
    const issue = platformIssue();
    applicable = !issue;
    const preferences = await db.from('web_push_preferences').select(CATEGORIES.join(',')).eq('user_id', owner).maybeSingle();
    if (!preferences.error) {
      for (const category of CATEGORIES) fields[category].checked = preferences.data?.[category] ?? true;
      preferencesLoaded = true;
    }
    if (issue) { status.textContent = issue; return; }
    await reconcile(owner);
    registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) {
      registration = null;
      status.textContent = 'L’application se prépare. Ferme ces réglages et réessaie.';
      return;
    }
    const device = storedDevice();
    const [publicKey, subscription, registered] = await Promise.all([
      rpc(db, 'web_push_public_key'),
      registration.pushManager.getSubscription(),
      device ? rpc(db, 'web_push_device_active', { p_proof: device.proof }) : false,
    ]);
    key = publicKey || '';
    active = Boolean(key && registered && subscription?.endpoint === device?.endpoint &&
      Notification.permission === 'granted');
    status.textContent = !key ? 'Les notifications push ne sont pas encore disponibles.' : active ?
      'Notifications actives sur cet appareil.' : 'Notifications désactivées sur cet appareil.';
  }, 'Impossible de lire l’état des notifications.');
}
