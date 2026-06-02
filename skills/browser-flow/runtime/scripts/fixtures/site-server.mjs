import http from "node:http";
import { getFreePort } from "../lib/net.mjs";

// selfclean fixture — in-memory item store (reset per server start).
// Routes: GET /selfclean (page), POST /api/selfclean/create, POST /api/selfclean/delete,
// GET /api/selfclean/list.
/** @type {string[]} */
const selfcleanStore = [];

// spa fixture store — proves contenteditable + role-less-div capture/replay.
/** @type {string[]} */
const spaStore = [];

// explore fixture — known 2-depth navigation graph + CUD trap button.
// The BFS e2e asserts this counter stays 0 (CUD button never clicked).
let exploreCudClicks = 0;

// noanchor fixture store — proves NAME-INDEPENDENT resolution (structuralKey/
// relXPath/coords) when the target has no id/data-*/aria/role and randomized classes.
/** @type {string[]} */
const noanchorStore = [];

const style = `
body { font-family: sans-serif; margin: 2rem; }
main { max-width: 40rem; }
button, a[data-bf], input { margin-top: 1rem; display: inline-block; }
.card { border: 1px solid #ccc; padding: 1rem; margin-top: 1rem; }
`;

const syntheticPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Synthetic Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="heading">Synthetic Demo</h1>
      <label>
        Display name
        <input data-bf="name-input" name="displayName" />
      </label>
      <button data-bf="launch" type="button">Run Demo</button>
    </main>
    <script>
      document.querySelector('[data-bf="launch"]').addEventListener('click', async () => {
        const value = document.querySelector('[data-bf="name-input"]').value || 'Guest';
        await fetch('/api/complete?mode=synthetic', { method: 'POST' });
        location.href = '/synthetic/result?name=' + encodeURIComponent(value);
      });
    </script>
  </body>
</html>
`;

/**
 * @param {string} name
 */
function syntheticResult(name) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Synthetic Result</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="result">Workflow Complete</h1>
      <p data-bf-evidence="name">Hello, ${escapeHtml(name)}</p>
    </main>
  </body>
</html>
`;
}

/**
 * @param {string} mode
 */
function urlStateMapPage(mode) {
  const label = mode === "rain" ? "Rain mode" : `${mode || "default"} mode`;
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>URL State Map</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="urlstate-mode">${escapeHtml(label)}</h1>
      <p>Map id: abc</p>
      <p>Mode is selected from the URL query state.</p>
    </main>
  </body>
</html>
`;
}

const stateActionPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>State Action Map</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1>State Action Map</h1>
      <button
        type="button"
        id="rain-layer"
        data-bf="rain-layer"
        aria-pressed="false"
        onclick="fetch('/api/state-layer?layer=rain').then(() => { this.setAttribute('aria-pressed', 'true'); document.querySelector('[data-bf-evidence=&quot;state-layer&quot;]').textContent = 'Rain layer selected'; })"
      >Rain</button>
      <p data-bf-evidence="state-layer">Satellite layer selected</p>
    </main>
  </body>
</html>
`;

const docsHome = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Docs Home</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="docs-home">Docs Home</h1>
      <a data-bf="catalog-link" href="/docs/catalog">Open Catalog</a>
    </main>
  </body>
</html>
`;

const docsCatalog = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Docs Catalog</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="catalog">Workflow Catalog</h1>
      <button data-bf="browser-filter" type="button">Browser Workflows</button>
      <div class="card">
        <button type="button">Browser Flow Compiler</button>
        <a href="/docs/detail/browser-flow">Open with legacy route</a>
      </div>
      <div class="card">
        <a data-bf="detail-link" href="/docs/detail/browser-flow">Browser Flow Compiler</a>
      </div>
    </main>
    <script>
      document.querySelector('[data-bf="browser-filter"]').addEventListener('click', async () => {
        await fetch('/api/filter?topic=browser-flow');
      });
    </script>
  </body>
</html>
`;

const docsDetail = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Browser Flow Compiler</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="detail-title">Browser Flow Compiler</h1>
      <p data-bf-evidence="detail-summary">Local-only capture and replay verification.</p>
    </main>
  </body>
</html>
`;

const statefulPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Stateful Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="stateful-heading">Stateful Demo</h1>
      <button data-bf="stateful-launch" type="button">Complete Stateful Flow</button>
    </main>
    <script>
      if (document.cookie.includes('browserFlowStatefulDone=1')) {
        location.href = '/stateful/result';
      }
      document.querySelector('[data-bf="stateful-launch"]').addEventListener('click', async () => {
        document.cookie = 'browserFlowStatefulDone=1; path=/; max-age=3600';
        await fetch('/api/stateful?mode=stateful', { method: 'POST' });
        location.href = '/stateful/result';
      });
    </script>
  </body>
</html>
`;

const statefulResult = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Stateful Result</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="stateful-result">Stateful Complete</h1>
    </main>
  </body>
</html>
`;

function revealPage(delayMs = 0) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Reveal Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <header>
      <nav>
        <a data-bf="expand" role="button" href="#">Expand menu</a>
        <ul id="reveal-links"></ul>
      </nav>
    </header>
    <main>
      <h1 data-bf-evidence="reveal-heading">Reveal Demo</h1>
      <p>Expand the menu to reveal the weather link.</p>
    </main>
    <script>
      document.querySelector('[data-bf="expand"]').addEventListener('click', (event) => {
        event.preventDefault();
        const render = () => {
          const list = document.getElementById('reveal-links');
          if (!list.querySelector('[data-bf="weather"]')) {
            const href = window.location.origin + '/reveal/weather';
            list.insertAdjacentHTML('beforeend', '<li><a data-bf="weather" href="' + href + '">Weather</a></li>');
          }
        };
        ${delayMs > 0 ? `window.setTimeout(render, ${delayMs});` : "render();"}
      });
    </script>
  </body>
</html>
`;
}

function revealNoisePage() {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Reveal Noise Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <header>
      <nav>
        <a data-bf="expand" role="button" href="/">Expand menu</a>
        <ul id="reveal-links"></ul>
      </nav>
    </header>
    <main>
      <h1 data-bf-evidence="reveal-noise-heading">Reveal Noise Demo</h1>
      <p>Rapid toggle the same affordance before selecting the revealed weather link.</p>
    </main>
    <script>
      const toggle = document.querySelector('[data-bf="expand"]');
      const list = document.getElementById('reveal-links');
      let isOpen = false;
      function render() {
        toggle.textContent = isOpen ? 'Collapse menu' : 'Expand menu';
        toggle.setAttribute('href', isOpen ? '#' : '/');
        list.innerHTML = isOpen
          ? '<li><a data-bf="weather" href="' + window.location.origin + '/reveal/weather">Weather</a></li>'
          : '';
      }
      toggle.addEventListener('click', async (event) => {
        event.preventDefault();
        isOpen = !isOpen;
        render();
        if (isOpen) {
          await fetch('/api/reveal/open', { method: 'POST' });
        }
      });
      render();
    </script>
  </body>
</html>
`;
}

const revealWeatherPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Weather Detail</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="reveal-weather">Weather detail</h1>
      <p>Weather detail evidence is visible on this page.</p>
    </main>
  </body>
</html>
`;

const submitPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Submit Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="submit-heading">Submit Demo</h1>
      <form id="decoy-form">
        <label>
          Decoy
          <input name="decoyName" />
        </label>
      </form>
      <form aria-label="submit-form">
        <label>
          Team
          <input data-bf="submit-name" name="teamName" />
        </label>
        <button data-bf="submit-button" type="submit">Send Form</button>
      </form>
    </main>
    <script>
      document.querySelector('form[aria-label="submit-form"]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = document.querySelector('[data-bf="submit-name"]').value || 'Guest';
        await fetch('/api/submit-flow?mode=submit', { method: 'POST' });
        location.href = '/submit/result?team=' + encodeURIComponent(value);
      });
    </script>
  </body>
</html>
`;

const secretPage = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Secret Demo</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="secret-heading">Secret Demo</h1>
      <label>
        Password
        <input data-bf="secret-password" type="password" name="password" />
      </label>
      <button data-bf="secret-launch" type="button">Run Secret Flow</button>
    </main>
    <script>
      document.querySelector('[data-bf="secret-launch"]').addEventListener('click', async () => {
        const value = document.querySelector('[data-bf="secret-password"]').value || '';
        if (value !== 'letmein') {
          document.body.dataset.secretError = '1';
          return;
        }
        await fetch('/api/secret?mode=secret', { method: 'POST' });
        location.href = '/secret/result';
      });
    </script>
  </body>
</html>
`;

const secretResult = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Secret Result</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="secret-result">Secret Flow Complete</h1>
    </main>
  </body>
</html>
`;

// selfclean fixture page.
// Uses form submissions (full-page POST) so the CDP runner can see the navigation
// and wait for the server round-trip to complete — avoiding the async-fetch timing gap.
// Create form POSTs to /api/selfclean/create (redirects → /selfclean).
// Delete form POSTs to /api/selfclean/delete (redirects → /selfclean).
// Two separate visible inputs ([data-bf="item-name"] and [data-bf="item-name-delete"])
// allow forward + teardown steps to each fill their own form independently.
/** @param {string[]} items */
function selfcleanPage(items = []) {
  const lis = items.map((n) => `<li data-bf="item">${escapeHtml(n)}</li>`).join("");
  return `
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Self-Clean Demo</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="selfclean-heading">Self-Clean Demo</h1>
      <form id="create-form" method="POST" action="/api/selfclean/create">
        <label>Item name<input data-bf="item-name" name="itemName" /></label>
        <button data-bf="item-create" type="submit">Create</button>
      </form>
      <form id="delete-form" method="POST" action="/api/selfclean/delete">
        <label>Delete item<input data-bf="item-name-delete" name="itemName" /></label>
        <button data-bf="item-delete" type="submit">Delete</button>
      </form>
      <ul id="item-list">${lis}</ul>
    </main>
  </body>
</html>`;
}

// spa fixture page — a contenteditable title (role=textbox, no <input>)
// and a role-less <div role="button"> create control (no <button>/<a> tag).
// Proves the recorder/runner enhancements capture+replay modern SPA patterns
// (Google Keep shape) that the semantic-HTML selfclean fixture does not exercise.
// Clicking Create reads the contenteditable's text and navigates to /spa/done.
function spaPage() {
  return `
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>SPA Demo</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="spa-heading">SPA Demo</h1>
      <div id="spa-title" data-bf="spa-title" role="textbox" aria-label="Title" contenteditable="true"
           style="min-height:28px;min-width:240px;border:1px solid #ccc;display:block;padding:4px"></div>
      <div data-bf="spa-create" role="button" aria-label="Create" tabindex="0"
           style="display:inline-block;margin-top:8px;padding:8px 16px;border:1px solid #888;cursor:pointer"
           onclick="location.href='/api/spa/create?name='+encodeURIComponent(document.getElementById('spa-title').innerText)">Create</div>
    </main>
  </body>
</html>`;
}

// samename fixture — TWO links both with visible text "지리" but different
// href + different neighbor text. Proves the coverage-aware scorer disambiguates the
// same-name collision that broke the old find-first resolver on Wikipedia.
// - ANCHOR link: href="#geo", neighbor "대한민국 개요"
// - ARTICLE link: href="/samename/geo", neighbor "지리학 문서"
const samenamePage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Samename</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="samename">Samename</h1>
      <p>대한민국 개요</p>
      <a data-bf="anchor" href="#geo">지리</a>
      <p>지리학 문서</p>
      <a data-bf="article" href="/samename/geo">지리</a>
      <h2 id="geo">지리 섹션</h2>
    </main>
  </body>
</html>`;

const samenamedestPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Geo Article</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="samename-dest">Geo article</h1>
    </main>
  </body>
</html>`;

// nav-tab fixture — three same-named "Section" tab links distinguished ONLY
// by href. Tests reproduce the wiki 토론-tab class: a stale structuralKey (sim 0) +
// decisive href. Default weights drift-hold (mass 0.5); a nav-tab weightOverride completes.
const navtabPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>navtab</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="navtab">Navtab</h1>
      <nav>
        <a data-bf="tab-home" href="/navtab/home">Section</a>
        <a data-bf="tab-talk" href="/navtab/talk">Section</a>
        <a data-bf="tab-history" href="/navtab/history">Section</a>
      </nav>
    </main>
  </body>
</html>`;

const navtabTalkPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>navtab talk</title><style>${style}</style></head>
  <body><main><h1 data-bf-evidence="navtab-talk">Talk page</h1></main></body>
</html>`;

// multitab fixture — a link that opens a NEW TAB (target=_blank) to /multitab/popup,
// where replay must continue (click Confirm) and reach evidence (#done = "Confirmed").
const multitabPage = `<!doctype html>
<html><head><meta charset="utf-8" /><title>multitab</title><style>${style}</style></head>
<body><main>
  <h1 data-bf-evidence="multitab">Multitab</h1>
  <a data-bf="open-popup" href="/multitab/popup" target="_blank">Open popup</a>
  <a data-bf="open-ad" href="/multitab/ad" target="_blank">Open ad</a>
</main></body></html>`;

// adversarial "ad" tab that the intended step does NOT target. It carries a
// DECOY button (text "Advertisement", not "Confirm") with an observable side effect, so a
// mis-routed resolver would visibly misfire if it clicked it. The fail-safe expectation is
// that the resolver REFUSES (action-path guard / confidence gate) and drift-holds instead.
const multitabAdPage = `<!doctype html>
<html><head><meta charset="utf-8" /><title>multitab ad</title><style>${style}</style></head>
<body><main>
  <h1 data-bf-evidence="ad">Advertisement</h1>
  <button data-bf="ad-cta" type="button" onclick="document.getElementById('wrong').textContent='WRONG-CLICK'">Advertisement</button>
  <p id="wrong" data-bf-evidence="wrong"></p>
</main></body></html>`;

const multitabPopupPage = `<!doctype html>
<html><head><meta charset="utf-8" /><title>multitab popup</title><style>${style}</style></head>
<body><main>
  <h1 data-bf-evidence="popup">Popup</h1>
  <button data-bf="confirm" type="button" onclick="document.getElementById('done').textContent='Confirmed'">Confirm</button>
  <p id="done" data-bf-evidence="done"></p>
</main></body></html>`;

// signals fixture — exercises each new locator signal in a single page.
// - input[id="mw9xZqA1"] has a dynamic id (mw…) → cleanId must be ""
// - anchor[id="go-link"] has a stable id → cleanId="go-link"; href="/signals/dest"
// - <p>Before marker</p>/<p>After marker</p> are siblings → neighborTexts includes "marker"
const signalsPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Signals</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="signals">Signals</h1>
      <p>Before marker</p>
      <input data-bf="field" id="mw9xZqA1" type="email" placeholder="email here" />
      <a data-bf="go" id="go-link" href="/signals/dest">Go to dest</a>
      <p>After marker</p>
    </main>
  </body>
</html>`;

const signalsDestPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Signals Dest</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="signals-dest">Dest</h1>
    </main>
  </body>
</html>`;

// layered-review fixture — generic layered/no-op capture review surface.
// The page intentionally combines a large content observation region, a hidden
// implementation-layer control, and a visible final action. Tests use it to
// prove review exclusions still leave a replayable visible-intent path.
const layeredReviewPage = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Layered Review</title>
    <style>${style}</style>
  </head>
  <body>
    <main data-bf="content-region" style="min-height:260px;border:1px solid #ddd;padding:20px">
      <h1 data-bf-evidence="layered-review">Layered Review</h1>
      <p>Observation value: 19:44</p>
      <button data-bf="hidden-internal" type="button"
        style="position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden"
        onclick="document.body.dataset.internalTouched='1'">Internal layer</button>
      <a data-bf="final" href="/layered-review/final">Open final</a>
    </main>
  </body>
</html>`;

const layeredReviewFinalPage = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Layered Review Final</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="layered-review-final">Layered review complete</h1>
    </main>
  </body>
</html>`;

// explore fixture pages — deterministic 2-depth nav graph for BFS e2e.
const exploreHub = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Explore Hub</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="explore-hub">Explore Hub</h1>
      <a data-bf="to-a" href="/explore/a">Section A</a>
      <a data-bf="to-b" href="/explore/b">Section B</a>
      <button data-bf="cud-del" type="button">Delete everything</button>
      <input data-bf="hub-input" />
    </main>
    <script>
      document.querySelector('[data-bf="cud-del"]').addEventListener('click', () => {
        fetch('/explore/cud', { method: 'POST' });
      });
    </script>
  </body>
</html>`;

const exploreA = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Section A</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="explore-a">Section A</h1>
      <a data-bf="to-ax" href="/explore/a/x">Detail X</a>
    </main>
  </body>
</html>`;

const exploreAX = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Detail X</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="explore-ax">Detail X</h1>
    </main>
  </body>
</html>`;

const exploreB = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Section B</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="explore-b">Section B</h1>
      <a data-bf="back" href="/explore">Back to hub</a>
    </main>
  </body>
</html>`;

/**
 * @param {string} team
 */
function submitResult(team) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Submit Result</title>
    <style>${style}</style>
  </head>
  <body>
    <main>
      <h1 data-bf-evidence="submit-result">Submit Complete</h1>
      <p data-bf-evidence="submit-team">Team: ${escapeHtml(team)}</p>
    </main>
  </body>
</html>
`;
}

/**
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export async function startFixtureServer() {
  const port = await getFreePort();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (request.method === "POST" && url.pathname === "/api/complete") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, workflow: "synthetic" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/filter") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, topic: url.searchParams.get("topic") }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/stateful") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, workflow: "stateful" }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/submit-flow") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, workflow: "submit" }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/secret") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, workflow: "secret" }));
      return;
    }

    if (url.pathname === "/synthetic") {
      respondHtml(response, syntheticPage);
      return;
    }

    if (url.pathname === "/synthetic/result") {
      respondHtml(response, syntheticResult(url.searchParams.get("name") ?? "Guest"));
      return;
    }

    if (url.pathname === "/urlstate/map") {
      respondHtml(response, urlStateMapPage(url.searchParams.get("mode") ?? ""));
      return;
    }

    if (url.pathname === "/state-action") {
      respondHtml(response, stateActionPage);
      return;
    }

    if (url.pathname === "/api/state-layer") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, layer: url.searchParams.get("layer") ?? "" }));
      return;
    }

    if (url.pathname === "/docs") {
      respondHtml(response, docsHome);
      return;
    }

    if (url.pathname === "/docs/catalog") {
      respondHtml(response, docsCatalog);
      return;
    }

    if (url.pathname === "/docs/detail/browser-flow") {
      respondHtml(response, docsDetail);
      return;
    }

    if (url.pathname === "/stateful") {
      respondHtml(response, statefulPage);
      return;
    }

    if (url.pathname === "/stateful/result") {
      respondHtml(response, statefulResult);
      return;
    }

    if (url.pathname === "/reveal") {
      respondHtml(response, revealPage());
      return;
    }

    if (url.pathname === "/reveal/async") {
      respondHtml(response, revealPage(500));
      return;
    }

    if (url.pathname === "/reveal/noise") {
      respondHtml(response, revealNoisePage());
      return;
    }

    if (url.pathname === "/reveal/weather") {
      respondHtml(response, revealWeatherPage);
      return;
    }

    if (url.pathname === "/api/reveal/open") {
      respondJson(response, { ok: true });
      return;
    }

    if (url.pathname === "/submit") {
      respondHtml(response, submitPage);
      return;
    }

    if (url.pathname === "/submit/result") {
      respondHtml(response, submitResult(url.searchParams.get("team") ?? "Guest"));
      return;
    }

    if (url.pathname === "/secret") {
      respondHtml(response, secretPage);
      return;
    }

    if (url.pathname === "/secret/result") {
      respondHtml(response, secretResult);
      return;
    }

    if (url.pathname === "/download-fixture") {
      const content = Buffer.from("hello download\n");
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="test.txt"',
        "content-length": String(content.length)
      });
      response.end(content);
      return;
    }

    if (url.pathname === "/pdf-fixture") {
      const content = Buffer.from("PDF");
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="test.pdf"',
        "content-length": String(content.length)
      });
      response.end(content);
      return;
    }

    // selfclean fixture routes.
    if (url.pathname === "/selfclean") {
      respondHtml(response, selfcleanPage([...selfcleanStore]));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/selfclean/create") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          const contentType = request.headers["content-type"] ?? "";
          let name = "";
          if (contentType.includes("application/json")) {
            name = JSON.parse(body).name ?? "";
          } else {
            // form-urlencoded (from form submit)
            const params = new URLSearchParams(body);
            name = params.get("itemName") ?? "";
          }
          if (typeof name === "string" && name.length > 0 && !selfcleanStore.includes(name)) {
            selfcleanStore.push(name);
          }
          // Redirect to /selfclean?created=1 — a DISTINCT URL from the start URL
          // /selfclean so the CDP runner's waitForExpectedUrl detects a real
          // navigation (avoids the already-at-same-URL false positive that would
          // let teardown start before the create redirect reloads the page and
          // wipes the teardown fill). The GET handler matches on url.pathname, which
          // strips the query, so the delete form is still rendered for teardown.
          response.writeHead(303, { location: "/selfclean?created=1" });
          response.end();
        } catch {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "bad request" }));
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/selfclean/delete") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          const contentType = request.headers["content-type"] ?? "";
          let name = "";
          if (contentType.includes("application/json")) {
            name = JSON.parse(body).name ?? "";
          } else {
            // form-urlencoded (from form submit)
            const params = new URLSearchParams(body);
            name = params.get("itemName") ?? "";
          }
          const idx = selfcleanStore.indexOf(name);
          if (idx !== -1) {
            selfcleanStore.splice(idx, 1);
          }
          // Redirect to /selfclean/done — a distinct URL from /selfclean so that
          // the CDP runner can detect the navigation has completed (avoids the
          // "already-at-expected-URL" timing issue where the source and destination
          // are the same URL).
          response.writeHead(303, { location: "/selfclean/done" });
          response.end();
        } catch {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "bad request" }));
        }
      });
      return;
    }

    if (url.pathname === "/selfclean/done") {
      respondHtml(response, `<!doctype html><html><head><meta charset="utf-8"/><title>Deleted</title></head><body><h1 data-bf-evidence="selfclean-done">Item Deleted</h1></body></html>`);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/selfclean/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [...selfcleanStore] }));
      return;
    }

    // spa fixture routes.
    if (url.pathname === "/spa") {
      respondHtml(response, spaPage());
      return;
    }
    if (url.pathname === "/api/spa/create") {
      const name = url.searchParams.get("name") ?? "";
      if (name) {
        spaStore.push(name);
      }
      // Distinct destination so the CDP runner's waitForExpectedUrl sees a real
      // navigation (avoids the already-at-same-URL false positive).
      response.writeHead(303, { location: "/spa/done" });
      response.end();
      return;
    }
    if (url.pathname === "/spa/done") {
      respondHtml(response, `<!doctype html><html><head><meta charset="utf-8"/><title>Created</title></head><body><h1 data-bf-evidence="spa-done">Created</h1></body></html>`);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/spa/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [...spaStore] }));
      return;
    }

    // noanchor fixture — the "Go" control has NO id/data-*/aria/role and a
    // RANDOMIZED class per load, so only structuralKey/relXPath/coords can re-locate it.
    // tabindex makes the recorder's click matcher capture it without being an anchor.
    if (url.pathname === "/noanchor") {
      const rnd = "c" + Math.random().toString(36).slice(2, 12);
      respondHtml(response, `<!doctype html><html><head><meta charset="utf-8"/><title>NoAnchor</title></head><body><main><h1 data-bf-evidence="noanchor-heading">NoAnchor</h1><div tabindex="0" class="${rnd}" style="display:inline-block;padding:10px;border:1px solid #888;cursor:pointer" onclick="location.href='/noanchor/go'">Go</div></main></body></html>`);
      return;
    }
    if (url.pathname === "/noanchor/go") {
      noanchorStore.push("hit");
      response.writeHead(303, { location: "/noanchor/done" });
      response.end();
      return;
    }
    if (url.pathname === "/noanchor/done") {
      respondHtml(response, `<!doctype html><html><head><meta charset="utf-8"/><title>Done</title></head><body><h1 data-bf-evidence="noanchor-done">Done</h1></body></html>`);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/noanchor/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ items: [...noanchorStore] }));
      return;
    }

    // samename fixture routes.
    if (request.method === "GET" && url.pathname === "/samename/geo") {
      respondHtml(response, samenamedestPage);
      return;
    }

    if (request.method === "GET" && url.pathname === "/samename") {
      respondHtml(response, samenamePage);
      return;
    }

    // navtab fixture routes. More-specific paths before /navtab.
    if (request.method === "GET" && url.pathname === "/navtab/talk") {
      respondHtml(response, navtabTalkPage);
      return;
    }
    if (request.method === "GET" && (url.pathname === "/navtab/home" || url.pathname === "/navtab/history")) {
      respondHtml(response, navtabTalkPage);
      return;
    }
    if (request.method === "GET" && url.pathname === "/navtab") {
      respondHtml(response, navtabPage);
      return;
    }

    // multitab fixture routes. More-specific path first.
    if (request.method === "GET" && url.pathname === "/multitab/ad") {
      respondHtml(response, multitabAdPage);
      return;
    }
    if (request.method === "GET" && url.pathname === "/multitab/popup") {
      respondHtml(response, multitabPopupPage);
      return;
    }
    if (request.method === "GET" && url.pathname === "/multitab") {
      respondHtml(response, multitabPage);
      return;
    }

    // signals fixture routes.
    if (request.method === "GET" && url.pathname === "/signals/dest") {
      respondHtml(response, signalsDestPage);
      return;
    }

    if (request.method === "GET" && url.pathname === "/signals") {
      respondHtml(response, signalsPage);
      return;
    }

    // layered-review fixture routes.
    if (request.method === "GET" && url.pathname === "/layered-review/final") {
      respondHtml(response, layeredReviewFinalPage);
      return;
    }

    if (request.method === "GET" && url.pathname === "/layered-review") {
      respondHtml(response, layeredReviewPage);
      return;
    }

    // explore fixture routes — 2-depth nav graph + CUD trap.
    // IMPORTANT: /explore/a/x must be matched before /explore/a to avoid shadowing.
    if (request.method === "GET" && url.pathname === "/explore/cud-count") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ clicks: exploreCudClicks }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/explore/cud") {
      exploreCudClicks += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/explore/a/x") {
      respondHtml(response, exploreAX);
      return;
    }

    if (request.method === "GET" && url.pathname === "/explore/a") {
      respondHtml(response, exploreA);
      return;
    }

    if (request.method === "GET" && url.pathname === "/explore/b") {
      respondHtml(response, exploreB);
      return;
    }

    if (request.method === "GET" && url.pathname === "/explore") {
      respondHtml(response, exploreHub);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        /** @type {(error?: Error) => void} */
        const handleClose = (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        };
        server.close(handleClose);
      });
    }
  };
}

/**
 * @param {http.ServerResponse} response
 * @param {string} html
 */
function respondHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

/**
 * @param {http.ServerResponse} response
 * @param {unknown} value
 */
function respondJson(response, value) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
