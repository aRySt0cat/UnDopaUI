// UnDopaUI content script for X.
// x.css does the hiding, keyed on data-undopa-* flags this script sets on <html>.
// This script handles what CSS cannot: switching tabs, title/favicon badges,
// autoplay, and the stopping cue on the home timeline.
(() => {
  const root = document.documentElement;
  const { DEFAULTS, load, onChange } = globalThis.UnDopaSettings;

  const FLAG_ATTRS = {
    forceFollowing: "data-undopa-force-following",
    hideMetrics: "data-undopa-hide-metrics",
    hideBadges: "data-undopa-hide-badges",
    hideSidebar: "data-undopa-hide-sidebar",
    hideNewPostsPill: "data-undopa-hide-new-posts",
    mentionsOnly: "data-undopa-mentions-only",
    feedBreaks: "data-undopa-feed-breaks",
  };

  let settings = DEFAULTS;
  let page = "other";
  const on = (key) => settings.enabled && !!settings.x[key];

  // ---- scheduling -------------------------------------------------------

  // setTimeout rather than requestAnimationFrame: rAF stops in background tabs,
  // which is exactly where the "(3)" title badge needs cleaning.
  let tickTimer = 0;
  function schedule() {
    if (tickTimer) return;
    tickTimer = setTimeout(() => {
      tickTimer = 0;
      tick();
    }, 50);
  }

  function tick() {
    updatePage();
    enforceFollowing();
    enforceMentions();
    cleanTitle();
    cleanFavicon();
    checkFeed();
  }

  function applyFlags() {
    for (const [key, attr] of Object.entries(FLAG_ATTRS)) root.toggleAttribute(attr, on(key));
    if (!on("feedBreaks")) resetFeed();
    schedule();
  }

  // ---- page tracking ----------------------------------------------------

  function pageOf(pathname) {
    if (pathname === "/home") return "home";
    if (pathname === "/notifications" || pathname === "/notifications/verified") return "notifications-all";
    if (pathname.startsWith("/notifications/")) return "notifications";
    return "other";
  }

  function updatePage() {
    const next = pageOf(location.pathname);
    if (next === page && root.getAttribute("data-undopa-page") === next) return;
    page = next;
    root.setAttribute("data-undopa-page", page);
  }

  // ---- "おすすめ" → "フォロー中" -------------------------------------------

  // The home tablist is [おすすめ, フォロー中, ...pinned lists]. Position is the
  // only language-independent signal, so we rely on it.
  let lastTabSwitch = 0;
  function enforceFollowing() {
    if (!on("forceFollowing") || page !== "home") return;
    const tabs = document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]');
    if (tabs.length < 2 || tabs[0].getAttribute("aria-selected") !== "true") return;
    if (Date.now() - lastTabSwitch < 1000) return;
    lastTabSwitch = Date.now();
    tabs[1].click();
  }

  // ---- notifications: mentions only -------------------------------------

  let lastMentionsSwitch = 0;
  function enforceMentions() {
    if (!on("mentionsOnly") || page !== "notifications-all") return;
    const link = document.querySelector('[data-testid="primaryColumn"] a[href="/notifications/mentions"]');
    if (!link || Date.now() - lastMentionsSwitch < 1000) return;
    lastMentionsSwitch = Date.now();
    link.click();
  }

  // ---- badges in title and favicon --------------------------------------

  const TITLE_COUNT = /^\(\d+\+?\)\s*/;
  function cleanTitle() {
    if (on("hideBadges") && TITLE_COUNT.test(document.title)) {
      document.title = document.title.replace(TITLE_COUNT, "");
    }
  }

  // X swaps the favicon to a "-pip" variant (with a dot) when there are unread notifications.
  function cleanFavicon() {
    if (!on("hideBadges")) return;
    for (const link of document.querySelectorAll('link[rel~="icon"]')) {
      if (link.href.includes("-pip")) link.href = link.href.replace("-pip", "");
    }
  }

  // ---- autoplay ---------------------------------------------------------

  // A video may play only if the user pressed something inside its post just before.
  let lastGesture = { time: 0, target: null };
  const userStarted = new WeakSet();
  const noteGesture = (e) => {
    lastGesture = { time: performance.now(), target: e.target };
  };
  document.addEventListener("pointerdown", noteGesture, true);
  document.addEventListener("keydown", noteGesture, true);
  document.addEventListener(
    "play",
    (e) => {
      const video = e.target;
      if (!(video instanceof HTMLVideoElement) || !on("stopAutoplay") || userStarted.has(video)) return;
      const scope = video.closest('[data-testid="videoComponent"], article') ?? video.parentElement;
      const recent = performance.now() - lastGesture.time < 2000;
      if (recent && lastGesture.target instanceof Node && scope?.contains(lastGesture.target)) {
        userStarted.add(video);
        return;
      }
      video.pause();
    },
    true,
  );

  // ---- stopping cue on the home timeline --------------------------------

  // Infinite scroll has no natural end. After N posts we put the end back:
  // the timeline stops scrolling, the rest is covered, and continuing takes
  // an explicit (and slightly delayed) choice. Leaving is always one click.
  const CONTINUE_DELAY_SEC = 5;
  const feed = {
    seen: new Set(),
    count: 0,
    limit: 0,
    state: "reading", // "reading" | "paused" | "done"
    anchorKey: null,
    anchorBottom: 0, // document Y of the last allowed post's bottom edge
    floorY: Infinity, // max scrollY while paused
    host: null,
    shadow: null,
    countdownTimer: 0,
  };

  function timelineArticles() {
    return document.querySelectorAll('[data-testid="primaryColumn"] section article[data-testid="tweet"]');
  }

  function postKey(article) {
    const link = article.querySelector('a[href*="/status/"]:has(time)') ?? article.querySelector('a[href*="/status/"]');
    return link?.getAttribute("href") ?? null;
  }

  function findArticle(key) {
    for (const article of timelineArticles()) if (postKey(article) === key) return article;
    return null;
  }

  function checkFeed() {
    if (!on("feedBreaks") || page !== "home") {
      if (feed.host) feed.host.hidden = true;
      return;
    }
    if (!feed.limit) feed.limit = settings.x.feedBreakSize;

    if (feed.state === "reading") {
      let limitArticle = null;
      for (const article of timelineArticles()) {
        const rect = article.getBoundingClientRect();
        if (rect.height === 0 || rect.bottom > window.innerHeight) continue;
        const key = postKey(article);
        if (!key || feed.seen.has(key)) continue;
        feed.seen.add(key);
        feed.count++;
        if (feed.count === feed.limit) limitArticle = article;
      }
      if (feed.count >= feed.limit) pause(limitArticle);
    }
    if (feed.state !== "reading") placePanel();
  }

  function pause(anchorArticle) {
    feed.state = "paused";
    feed.anchorKey = anchorArticle ? postKey(anchorArticle) : null;
    feed.anchorBottom = anchorArticle
      ? anchorArticle.getBoundingClientRect().bottom + window.scrollY
      : window.scrollY + window.innerHeight * 0.5;
    renderPanel();
    placePanel();
    if (window.scrollY > feed.floorY) window.scrollTo({ top: feed.floorY, behavior: "smooth" });
  }

  function resume() {
    feed.state = "reading";
    feed.limit = feed.count + settings.x.feedBreakSize;
    feed.floorY = Infinity;
    if (feed.host) feed.host.hidden = true;
  }

  function finish() {
    feed.state = "done";
    feed.floorY = 0;
    root.setAttribute("data-undopa-feed-done", "");
    window.scrollTo(0, 0);
    renderPanel();
    placePanel();
  }

  function resetFeed() {
    Object.assign(feed, { seen: new Set(), count: 0, limit: 0, state: "reading", anchorKey: null, floorY: Infinity });
    clearInterval(feed.countdownTimer);
    root.removeAttribute("data-undopa-feed-done");
    if (feed.host) feed.host.hidden = true;
  }

  // Keep the scroll floor while paused. Wheel, keys and scrollbar all end up here.
  window.addEventListener(
    "scroll",
    () => {
      if (feed.state !== "reading" && page === "home" && on("feedBreaks") && window.scrollY > feed.floorY + 1) {
        window.scrollTo(0, feed.floorY);
      }
      schedule();
    },
    { passive: true },
  );
  window.addEventListener("resize", schedule, { passive: true });

  function themeColors() {
    const bg = getComputedStyle(document.body).backgroundColor || "rgb(255, 255, 255)";
    const [r, g, b] = (bg.match(/\d+/g) ?? [255, 255, 255]).map(Number);
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
    return {
      bg,
      fg: dark ? "rgb(231, 233, 234)" : "rgb(15, 20, 25)",
      muted: dark ? "rgb(113, 118, 123)" : "rgb(83, 100, 113)",
      line: dark ? "rgb(47, 51, 54)" : "rgb(207, 217, 222)",
    };
  }

  function ensurePanel() {
    if (feed.host?.isConnected) return;
    feed.host = document.createElement("undopa-feed-break");
    feed.shadow = feed.host.attachShadow({ mode: "open" });
    document.body.append(feed.host);
  }

  function renderPanel() {
    ensurePanel();
    clearInterval(feed.countdownTimer);
    const c = themeColors();
    const size = settings.x.feedBreakSize;
    const body =
      feed.state === "done"
        ? `<p class="title">今日はここまで</p>
           <p class="text">タイムラインを閉じました。ページを再読み込みすると再開できます。</p>`
        : `<p class="title">ここで一区切り</p>
           <p class="text">このタイムラインで ${feed.count} 件のポストを読みました。</p>
           <div class="actions">
             <button class="primary" data-action="finish">今日はここまで</button>
             <button data-action="continue" disabled>あと ${size} 件読む（${CONTINUE_DELAY_SEC}）</button>
           </div>`;
    feed.shadow.innerHTML = `
      <style>
        :host { position: absolute; z-index: 5; display: block; }
        :host([hidden]) { display: none; }
        .panel {
          box-sizing: border-box; height: 100%; padding: 32px 24px;
          background: ${c.bg}; color: ${c.fg}; border-top: 1px solid ${c.line};
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif;
          text-align: center;
        }
        .title { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
        .text { margin: 0 0 24px; font-size: 15px; color: ${c.muted}; line-height: 1.5; }
        .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        button {
          font: inherit; font-size: 15px; font-weight: 700; padding: 10px 20px; border-radius: 9999px;
          border: 1px solid ${c.line}; background: transparent; color: ${c.fg}; cursor: pointer;
        }
        button.primary { background: ${c.fg}; color: ${c.bg}; border-color: ${c.fg}; }
        button:disabled { cursor: default; color: ${c.muted}; }
      </style>
      <div class="panel">${body}</div>`;

    feed.shadow.querySelector('[data-action="finish"]')?.addEventListener("click", finish);
    const cont = feed.shadow.querySelector('[data-action="continue"]');
    if (cont) {
      let left = CONTINUE_DELAY_SEC;
      feed.countdownTimer = setInterval(() => {
        left--;
        if (left > 0) {
          cont.textContent = `あと ${size} 件読む（${left}）`;
          return;
        }
        clearInterval(feed.countdownTimer);
        cont.textContent = `あと ${size} 件読む`;
        cont.disabled = false;
      }, 1000);
      cont.addEventListener("click", resume);
    }
  }

  function placePanel() {
    ensurePanel();
    const column = document.querySelector('[data-testid="primaryColumn"]');
    if (!column) return;
    const col = column.getBoundingClientRect();
    feed.host.hidden = false;

    if (feed.state === "done") {
      Object.assign(feed.host.style, {
        position: "fixed",
        top: "120px",
        left: `${col.left}px`,
        width: `${col.width}px`,
        height: "auto",
      });
      return;
    }

    // Re-anchor on the post itself when it is still rendered; X re-lays out
    // the timeline when images load or when coming back from a post.
    const anchor = feed.anchorKey && findArticle(feed.anchorKey);
    if (anchor) feed.anchorBottom = anchor.getBoundingClientRect().bottom + window.scrollY;
    feed.floorY = Math.max(0, feed.anchorBottom - window.innerHeight * 0.5);
    Object.assign(feed.host.style, {
      position: "absolute",
      top: `${feed.anchorBottom}px`,
      left: `${col.left + window.scrollX}px`,
      width: `${col.width}px`,
      height: `${window.innerHeight}px`,
    });
  }

  // ---- boot -------------------------------------------------------------

  applyFlags(); // defaults first, so the quiet UI is in place before storage answers
  load().then((s) => {
    settings = s;
    applyFlags();
  });
  onChange((s) => {
    const sizeChanged = s.x.feedBreakSize !== settings.x.feedBreakSize;
    settings = s;
    if (sizeChanged && feed.state === "reading") feed.limit = feed.count + s.x.feedBreakSize;
    applyFlags();
  });

  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  if (window.navigation) window.navigation.addEventListener("currententrychange", schedule);

  // Dev reload: window.postMessage({ source: "undopa-dev", type: "reload" }, "*").
  // The background worker ignores it unless the extension is loaded unpacked.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data?.source === "undopa-dev" && e.data.type === "reload") {
      chrome.runtime.sendMessage({ type: "undopa:dev-reload" });
    }
  });
})();
