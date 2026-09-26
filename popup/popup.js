// Binds every [data-key] input to the setting at that dotted path.
(async () => {
  const { load, save } = globalThis.UnDopaSettings;
  let settings = await load();

  const get = (path) => path.split(".").reduce((o, k) => o[k], settings);
  const set = (path, value) => {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((o, k) => o[k], settings)[last] = value;
  };

  const inputs = document.querySelectorAll("[data-key]");
  const render = () => {
    for (const input of inputs) {
      const value = get(input.dataset.key);
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    }
    document.body.classList.toggle("off", !settings.enabled);
  };

  for (const input of inputs) {
    input.addEventListener("change", async () => {
      if (input.type === "checkbox") {
        set(input.dataset.key, input.checked);
      } else {
        const n = Math.round(Number(input.value));
        const min = Number(input.min);
        const max = Number(input.max);
        set(input.dataset.key, Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
      }
      render();
      await save(settings);
    });
  }

  // The number field sits inside a <label>; keep clicks on it from toggling the checkbox.
  for (const n of document.querySelectorAll('input[type="number"]')) {
    n.addEventListener("click", (e) => e.preventDefault());
  }

  render();
})();
