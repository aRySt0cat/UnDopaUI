// Runs in X's own JS world (not the isolated content-script world) so it can
// see X's network requests. The Following tab's 人気 / 最新 sort is only the
// enableRanking variable on HomeLatestTimeline; we pin it to false (最新).
// On/off comes from the data-undopa-force-following flag that content.js sets.
(() => {
  const shouldForce = () => document.documentElement.hasAttribute("data-undopa-force-following");

  function pinLatest(variables) {
    if (typeof variables?.enableRanking !== "boolean" || !variables.enableRanking) return false;
    variables.enableRanking = false;
    return true;
  }

  function patchUrl(url) {
    try {
      const u = new URL(url, location.href);
      const variables = JSON.parse(u.searchParams.get("variables"));
      if (pinLatest(variables)) {
        u.searchParams.set("variables", JSON.stringify(variables));
        return u.toString();
      }
    } catch {
      // Unknown request shape: leave it alone.
    }
    return url;
  }

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__undopaLatest = false;
    if (shouldForce() && String(url).includes("/HomeLatestTimeline")) {
      if (String(method).toUpperCase() === "GET") url = patchUrl(url);
      else this.__undopaLatest = true;
    }
    return open.call(this, method, url, ...rest);
  };

  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__undopaLatest && typeof body === "string") {
      try {
        const data = JSON.parse(body);
        if (pinLatest(data?.variables)) body = JSON.stringify(data);
      } catch {
        // Not JSON: leave it alone.
      }
    }
    return send.call(this, body);
  };
})();
