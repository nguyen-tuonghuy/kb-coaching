/* One application context per document. Modules register before page bootstrap. */
(() => {
  const kc=window.KinballCoach ||= {};
  kc.app ||= {};
  kc.policies ||= {};
})();
