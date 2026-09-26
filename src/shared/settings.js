// Settings shared by content scripts and the popup.
// Every feature defaults to ON so the page is already "quiet" before storage loads.
(() => {
  const DEFAULTS = {
    enabled: true,
    x: {
      forceFollowing: true,
      hideMetrics: true,
      hideBadges: true,
      hideSidebar: true,
      hideNewPostsPill: true,
      stopAutoplay: true,
      mentionsOnly: true,
      feedBreaks: true,
      feedBreakSize: 20,
    },
  };

  const KEY = "settings";

  function merge(base, override) {
    if (typeof base !== "object" || base === null) return override ?? base;
    const out = { ...base };
    for (const [k, v] of Object.entries(override ?? {})) {
      out[k] = typeof base[k] === "object" && base[k] !== null ? merge(base[k], v) : v;
    }
    return out;
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    return merge(DEFAULTS, stored[KEY]);
  }

  async function save(settings) {
    await chrome.storage.local.set({ [KEY]: settings });
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[KEY]) callback(merge(DEFAULTS, changes[KEY].newValue));
    });
  }

  globalThis.UnDopaSettings = { DEFAULTS, load, save, onChange, merge };
})();
