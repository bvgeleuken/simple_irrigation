#!/usr/bin/env node
/*
 * Regenerate the Lovelace card screenshots in ../screenshots.
 *
 * Renders the "Irrigation card" demo dashboard headless (system Chrome via
 * puppeteer-core), authenticated with a Home Assistant long-lived access token,
 * and writes tight, 2x element screenshots of the card in its views plus the
 * card configuration dialog.
 *
 * Sibling of make_screenshots.js, which covers the admin panel instead.
 *
 * Prerequisites:
 *   - A sandbox HA reachable at HA_URL with a Simple Irrigation entry that has
 *     zones and schedule cycles, and a storage dashboard at url_path "si-card"
 *     whose views hold the card in the configurations listed in SHOTS below
 *     (view path + index of the card among that view's Simple Irrigation cards).
 *   - Google Chrome installed (override with CHROME_PATH).
 *   - npm i puppeteer-core   (run inside scripts/)
 *
 * Usage:
 *   HA_URL=http://localhost:8123 \
 *   HA_TOKEN=<long-lived-access-token> \
 *   node scripts/make_card_screenshots.js [outDir]
 */
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HA_URL || "http://localhost:8123";
const TOKEN = process.env.HA_TOKEN;
const DASH = process.env.SI_DASHBOARD || "si-card";
const OUT = process.argv[2] || path.join(__dirname, "..", "screenshots");

if (!TOKEN) {
  console.error("Set HA_TOKEN (see header comment).");
  process.exit(1);
}

/** view path · index among that view's cards · output file. */
const SHOTS = [
  ["status", 1, "card_status.png"],
  ["zones", 0, "card_zones.png"],
  ["schedule", 0, "card_schedule.png"],
  ["schedule", 3, "card_week.png"],
  ["compact", 0, "card_compact.png"],
  ["run", 3, "card_run.png"],
];

/** Single masonry column — see the note at first use. */
const CARD_VIEWPORT = 520;

const walkSrc = `function* walk(root){const els=root.querySelectorAll('*');for(const e of els){yield e;if(e.shadowRoot)yield* walk(e.shadowRoot);}}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bounding box (CSS px) of the nth Simple Irrigation card on the page. */
async function cardBox(page, index) {
  return page.evaluate(
    (ws, i) => {
      eval(ws);
      const cards = [];
      for (const e of walk(document)) {
        if (e.tagName === "SIMPLE-IRRIGATION-CARD") cards.push(e);
      }
      const card = cards[i];
      if (!card || !card.shadowRoot) return null;
      const inner = card.shadowRoot.querySelector("ha-card");
      const r = (inner ?? card).getBoundingClientRect();
      if (r.height < 24) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height, n: cards.length };
    },
    walkSrc,
    index
  );
}

/** Wait until the nth card has a box, retrying while it re-renders. */
async function waitForCard(page, index, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const box = await cardBox(page, index);
    if (box) return box;
    await sleep(250);
  }
  return null;
}

async function shootCard(page, view, index, file) {
  await page.goto(`${BASE}/${DASH}/${view}`, { waitUntil: "networkidle0" });
  let box = await waitForCard(page, index);
  if (!box) throw new Error(`card ${index} not found on view ${view}`);
  // The card renders once more when its first snapshot arrives; let the
  // countdowns and the run state settle before clipping.
  await sleep(900);
  box = (await waitForCard(page, index, 8)) ?? box;
  await page.screenshot({
    path: path.join(OUT, file),
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  console.log("wrote", file, `${Math.round(box.width)}×${Math.round(box.height)}`);
}

/**
 * Capture the card configuration dialog with its live preview. Best-effort: the
 * Lovelace edit flow is a little flaky headless, so a failure here only logs
 * and leaves the other screenshots intact.
 */
async function shootEditor(page, view, file) {
  // ?edit=1 drops the dashboard straight into edit mode (no menu clicks).
  await page.goto(`${BASE}/${DASH}/${view}?edit=1`, { waitUntil: "networkidle0" });
  await sleep(1800);
  // Click the "Edit" of the card options wrapper that actually holds a Simple
  // Irrigation card — the markdown headers on the demo dashboard have one too,
  // and their editor is not the one we are after. .click() rather than a
  // synthetic mouse click: the edit-mode overlay swallows real pointer events.
  const clicked = await page.evaluate((ws) => {
    eval(ws);
    const holdsCard = (root) => {
      for (const e of walk(root)) {
        if (e.tagName === "SIMPLE-IRRIGATION-CARD") return true;
      }
      return false;
    };
    for (const wrapper of walk(document)) {
      if (wrapper.tagName !== "HUI-CARD-OPTIONS") continue;
      // The card sits in the wrapper's light DOM (slotted), the buttons in its
      // shadow root — so the two searches run over different trees.
      if (!holdsCard(wrapper)) continue;
      for (const e of walk(wrapper.shadowRoot ?? wrapper)) {
        if (!/HA-BUTTON|MWC-BUTTON|BUTTON/.test(e.tagName)) continue;
        if ((e.textContent || "").trim().toLowerCase() !== "edit") continue;
        e.scrollIntoView({ block: "center" });
        e.click();
        return true;
      }
    }
    return false;
  }, walkSrc);
  if (!clicked) throw new Error("card Edit button not found");
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    await sleep(400);
    ok = await page.evaluate((ws) => {
      eval(ws);
      for (const e of walk(document))
        if (e.tagName === "SIMPLE-IRRIGATION-CARD-EDITOR") return true;
      return false;
    }, walkSrc);
  }
  if (!ok) throw new Error("card editor did not mount");
  // Scroll the editor pane to the Interactions section — the point of the shot.
  await sleep(900);
  await page.evaluate((ws) => {
    eval(ws);
    for (const e of walk(document)) {
      if (e.tagName !== "SIMPLE-IRRIGATION-CARD-EDITOR") continue;
      const label = [...e.shadowRoot.querySelectorAll(".flabel.strong")][0];
      if (label) label.scrollIntoView({ block: "start" });
    }
  }, walkSrc);
  await sleep(600);
  const box = await page.evaluate((ws) => {
    eval(ws);
    let best = null;
    for (const e of walk(document)) {
      if (e.tagName !== "DIALOG") continue;
      const r = e.getBoundingClientRect();
      if (r.width > 200 && r.height > 120 && (!best || r.width * r.height > best.a)) {
        best = { x: r.x, y: r.y, width: r.width, height: r.height, a: r.width * r.height };
      }
    }
    return best;
  }, walkSrc);
  await page.screenshot({
    path: path.join(OUT, file),
    ...(box ? { clip: { x: box.x, y: box.y, width: box.width, height: box.height } } : {}),
  });
  console.log("wrote", file);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  // 520 px puts the masonry view into a single column, so every card is
  // captured at the ~500 px width a dashboard actually gives it.
  await page.setViewport({ width: CARD_VIEWPORT, height: 1200, deviceScaleFactor: 2 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (base, token) => {
      localStorage.setItem(
        "hassTokens",
        JSON.stringify({
          access_token: token,
          token_type: "Bearer",
          expires_in: 315360000,
          hassUrl: base,
          clientId: null,
          expires: 4102444800000,
          refresh_token: null,
        })
      );
      localStorage.setItem("dockedSidebar", '"always_hidden"');
      localStorage.setItem("selectedLanguage", '"en"');
    },
    BASE,
    TOKEN
  );

  for (const [view, index, file] of SHOTS) {
    await shootCard(page, view, index, file);
  }

  // The dialog needs room: it is a near-fullscreen panel with a live preview.
  await page.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 2 });
  try {
    await shootEditor(page, "zones", "card_editor.png");
  } catch (e) {
    console.warn("editor screenshot skipped:", e.message);
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
