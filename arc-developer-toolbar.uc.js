// ==UserScript==
// @name        Arc-style Developer Toolbar
// @include     main
// ==/UserScript==

(function () {
  "use strict";

  const ORIGINAL_ID = "developer-button";
  const REPLACEMENT_ID = "arc-developer-menu-button";
  const SESSION_KEY = "arc-developer-toolbar-enabled";
  const SCREENSHOT_ACTOR = "ArcDeveloperScreenshot";
  let observer;
  let bar;
  let urlLabel;
  let actions;
  let themeRequest = 0;
  let openPortraitCapture;
  const { installScreenshotIntegration, installUrlbarActions } = ChromeUtils.importESModule(
    "chrome://sine/content/arc-developer-toolbar/ArcDeveloperIntegration.sys.mjs"
  );
  const sessionStore = (() => {
    try {
      return window.SessionStore || ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      ).SessionStore;
    } catch (error) {
      console.error("[Arc Developer Toolbar] Session storage unavailable", error);
      return null;
    }
  })();
  const openTabs = new WeakSet();

  function restoreTabs() {
    const browser = typeof gBrowser !== "undefined" ? gBrowser : window.gBrowser;
    for (const tab of browser?.tabs || []) {
      if (sessionStore?.getCustomTabValue(tab, SESSION_KEY) === "true") {
        openTabs.add(tab);
        tab.setAttribute("arc-developer-active", "true");
      }
    }
    if (ensureBar()) {
      updateBar();
      if (!actions.children.length) populateActions();
    }
  }

  function selectedTab() {
    const browser = typeof gBrowser !== "undefined" ? gBrowser : window.gBrowser;
    return browser?.selectedTab;
  }

  function openTool(toolId) {
    const tab = selectedTab();
    if (!tab) return;
    try {
      const { require } = ChromeUtils.importESModule(
        "resource://devtools/shared/loader/Loader.sys.mjs"
      );
      const { gDevTools } = require("devtools/client/framework/devtools");
      gDevTools.showToolboxForTab(tab, toolId ? { toolId } : {}).catch(error =>
        console.error("[Arc Developer Menu] DevTools failed", error)
      );
    } catch (error) {
      console.error("[Arc Developer Menu] DevTools failed", error);
    }
  }

  function currentBrowser() {
    const browser = typeof gBrowser !== "undefined" ? gBrowser : window.gBrowser;
    return browser?.selectedBrowser;
  }

  function iconFor(label) {
    const name = String(label).toLowerCase();
    const local = file => `chrome://sine/content/arc-developer-toolbar/icons/${file}`;
    const icons = [
      [/inspect|element|picker/, local("inspect.svg")],
      [/responsive|device/, local("phone.svg")],
      [/debug/, local("wrench.svg")],
      [/task manager/, local("task-manager.svg")],
      [/page source|view source/, "selectable/code.svg"],
      [/console|terminal/, "brackets-curly.svg"],
      [/eyedropper|color/, "eyedropper.svg"],
      [/source|code/, "selectable/code.svg"],
      [/network|remote/, "link.svg"],
      [/screenshot|capture/, "screenshot.svg"],
      [/performance|memory/, "tool-profiler.svg"],
      [/extension|addon/, "extension.svg"],
      [/close|hide/, "close.svg"],
      [/settings|options/, "settings.svg"],
      [/browser toolbox|devtools|toolbox/, "developer.svg"],
    ];
    const file = icons.find(([pattern]) => pattern.test(name))?.[1] || "developer.svg";
    return file.startsWith("chrome://") ? file : `chrome://browser/skin/zen-icons/${file}`;
  }

  function makeAction(label, title, action) {
    const button = document.createXULElement("toolbarbutton");
    button.className = "arc-developer-action";
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", title);
    button.setAttribute("image", iconFor(title));
    button.addEventListener("command", action);
    return button;
  }

  function makeDivider() {
    const divider = document.createXULElement("box");
    divider.className = "arc-developer-divider";
    return divider;
  }

  function showCopiedToast(bytes) {
    let container = document.getElementById("zen-toast-container");
    if (!container) {
      container = document.getElementById("arc-developer-toast-container");
      if (!container) {
        container = document.createXULElement("vbox");
        container.id = "arc-developer-toast-container";
        container.style.cssText = "position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;";
        document.documentElement.appendChild(container);
      }
    }
    const toast = document.createXULElement("hbox");
    toast.className = "zen-toast";
    toast.style.cssText = "align-items: center; padding: 10px 16px;";
    if (container.id === "arc-developer-toast-container") {
      toast.style.cssText += "background: var(--arrowpanel-background, #2b2d33); color: var(--arrowpanel-color, white); border-radius: 9px; box-shadow: 0 6px 22px rgba(0,0,0,.3);";
    }
    const label = document.createXULElement("label");
    label.textContent = "Portrait copied to clipboard";
    label.style.margin = "0";
    toast.appendChild(label);
    const share = document.createXULElement("button");
    share.classList.add("footer-button", "primary");
    share.setAttribute("label", "Share");
    share.addEventListener("command", async () => {
      try {
        const file = new File([bytes], "zen-portrait.png", { type: "image/png" });
        if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
          throw new Error("Image sharing is unavailable in this browser");
        }
        await navigator.share({ files: [file] });
      } catch (error) {
        if (error?.name !== "AbortError") console.error("[Arc Developer Toolbar] Sharing portrait failed", error);
      }
    });
    toast.appendChild(share);
    toast.setAttribute("button", "true");
    container.removeAttribute("hidden");
    container.appendChild(toast);
    const motion = window.gZenUIManager?.motion;
    toast.style.transform = "scale(0)";
    if (motion) motion.animate(toast, { scale: 1 }, { type: "spring", bounce: 0.2, duration: 0.5 });
    else toast.style.transform = "scale(1)";
    window.setTimeout(async () => {
      if (motion) await motion.animate(toast, { opacity: [1, 0], scale: [1, 0.5] }, { duration: 0.2 });
      toast.remove();
      if (!container.children.length) container.setAttribute("hidden", true);
    }, 3000);
  }

  function makePortraitButton() {
    document.getElementById("arc-portrait-panel")?.remove();
    const panel = document.createXULElement("panel");
    panel.id = "arc-portrait-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", "true");
    const content = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    content.className = "arc-portrait-content";
    const capture = document.createXULElement("button");
    capture.setAttribute("label", "Capture in Portrait Mode");
    capture.className = "arc-portrait-capture";
    const preview = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    preview.width = 320;
    preview.height = 180;
    preview.className = "arc-portrait-preview";
    const controls = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    controls.className = "arc-portrait-controls";
    const gradient = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
    gradient.className = "arc-portrait-swatch arc-portrait-gradient";
    gradient.title = "Gradient background";
    const hue = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    hue.type = "range";
    hue.min = "0";
    hue.max = "359";
    hue.value = "20";
    hue.className = "arc-portrait-hue";
    hue.title = "Background color shade";
    const solid = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
    solid.className = "arc-portrait-swatch arc-portrait-solid";
    solid.title = "Solid color background";
    controls.append(gradient, hue, solid);
    content.append(capture, preview, controls);
    panel.appendChild(content);
    document.getElementById("mainPopupSet").appendChild(panel);
    let bitmap = null;
    let mode = "gradient";
    let captureBrowser = null;
    function chooseHue(image) {
      const sample = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      sample.width = 24;
      sample.height = 24;
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 24, 24);
      const pixels = context.getImageData(0, 0, 24, 24).data;
      let x = 0, y = 0, weight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (delta < 0.12 || max < 0.13) continue;
        let angle = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        angle *= Math.PI / 3;
        const importance = delta * (0.5 + max);
        x += Math.cos(angle) * importance;
        y += Math.sin(angle) * importance;
        weight += importance;
      }
      if (weight > 0.5) hue.value = String(Math.round(((Math.atan2(y, x) * 180 / Math.PI + 540) % 360)));
    }
    const logo = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    logo.src = "chrome://sine/content/arc-developer-toolbar/icons/zen-watermark.svg";
    logo.addEventListener("load", () => draw(preview));
    function draw(canvas) {
      const ctx = canvas.getContext("2d");
      const { width, height } = canvas;
      const angle = Number(hue.value);
      hue.style.setProperty("--arc-portrait-hue", angle);
      solid.style.backgroundColor = `hsl(${angle} 90% 68%)`;
      gradient.style.background = `linear-gradient(135deg, hsl(${angle} 90% 72%), hsl(${(angle + 55) % 360} 95% 65%))`;
      gradient.setAttribute("aria-pressed", String(mode === "gradient"));
      solid.setAttribute("aria-pressed", String(mode === "solid"));
      if (mode === "solid") {
        ctx.fillStyle = `hsl(${angle} 90% 68%)`;
      } else {
        const background = ctx.createLinearGradient(0, 0, width, height);
        background.addColorStop(0, `hsl(${angle} 90% 72%)`);
        background.addColorStop(1, `hsl(${(angle + 55) % 360} 95% 65%)`);
        ctx.fillStyle = background;
      }
      ctx.fillRect(0, 0, width, height);
      if (!bitmap) return;
      const padding = Math.min(width, height) * 0.09;
      const scale = Math.min(
        (width - padding * 2) / bitmap.width,
        (height - padding * 2) / bitmap.height
      );
      const imageWidth = bitmap.width * scale;
      const imageHeight = bitmap.height * scale;
      const x = (width - imageWidth) / 2;
      const y = (height - imageHeight) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.24)";
      ctx.shadowBlur = width * 0.035;
      ctx.shadowOffsetY = width * 0.02;
      ctx.fillStyle = "white";
      const radius = Math.min(width, height) * 0.025;
      ctx.beginPath();
      ctx.roundRect(x, y, imageWidth, imageHeight, radius);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, imageWidth, imageHeight, radius);
      ctx.clip();
      ctx.drawImage(bitmap, x, y, imageWidth, imageHeight);
      ctx.restore();
      if (logo.complete && logo.naturalWidth) {
        const size = Math.min(width, height) * 0.047;
        ctx.drawImage(logo, padding * 0.35, height - padding * 0.35 - size, size, size);
      }
    }
    async function refresh() {
      bitmap?.close();
      bitmap = null;
      captureBrowser = currentBrowser();
      const tabbox = document.getElementById("zen-tabbox-wrapper");
      const bounds = tabbox?.getBoundingClientRect();
      preview.width = Math.max(1, Math.round(bounds?.width || captureBrowser?.clientWidth || 320));
      preview.height = Math.max(1, Math.round(bounds?.height || captureBrowser?.clientHeight || 180));
      const global = captureBrowser?.browsingContext?.currentWindowGlobal;
      if (!global) return;
      try {
        bitmap = await global.drawSnapshot(
          new DOMRect(0, 0, captureBrowser.clientWidth, captureBrowser.clientHeight),
          1, "white", { drawView: true }
        );
        if (panel.state === "closed") { bitmap.close(); bitmap = null; return; }
        chooseHue(bitmap);
        draw(preview);
      } catch (error) {
        console.error("[Arc Developer Toolbar] Portrait preview failed", error);
      }
    }
    hue.addEventListener("input", () => draw(preview));
    gradient.addEventListener("click", () => { mode = "gradient"; draw(preview); });
    solid.addEventListener("click", () => { mode = "solid"; draw(preview); });
    capture.addEventListener("command", async () => {
      if (!bitmap || !captureBrowser) return;
      try {
        const output = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        const bounds = document.getElementById("zen-tabbox-wrapper")?.getBoundingClientRect();
        output.width = Math.max(1, Math.round(bounds?.width || captureBrowser.clientWidth));
        output.height = Math.max(1, Math.round(bounds?.height || captureBrowser.clientHeight));
        draw(output);
        const blob = await new Promise(resolve => output.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not encode portrait screenshot");
        const bytes = await blob.arrayBuffer();
        const { BrowserUtils } = ChromeUtils.importESModule("resource://gre/modules/BrowserUtils.sys.mjs");
        BrowserUtils.copyImageToClipboard(bytes);
        panel.hidePopup();
        showCopiedToast(bytes);
      } catch (error) {
        console.error("[Arc Developer Toolbar] Portrait capture failed", error);
      }
    });
    panel.addEventListener("popuphidden", () => { bitmap?.close(); bitmap = null; });
    const button = makeAction("Portrait Mode", "Portrait Mode", () => {
      panel.openPopup(button, "after_start", 0, 4);
      draw(preview);
      refresh();
    });
    button.setAttribute("image", "chrome://sine/content/arc-developer-toolbar/icons/portrait.svg");
    openPortraitCapture = (sourceBitmap, sourceBrowser, anchor = null) => {
      bitmap?.close();
      bitmap = sourceBitmap;
      captureBrowser = sourceBrowser;
      const bounds = document.getElementById("zen-tabbox-wrapper")?.getBoundingClientRect();
      preview.width = Math.max(1, Math.round(bounds?.width || sourceBrowser.clientWidth));
      preview.height = Math.max(1, Math.round(bounds?.height || sourceBrowser.clientHeight));
      chooseHue(bitmap);
      const siteButton = document.getElementById("zen-site-data-icon-button");
      if (siteButton) {
        panel.openPopup(siteButton, "after_start", 0, 4);
      } else if (anchor) {
        const ratio = (anchor.devicePixelRatio || 1) / (window.devicePixelRatio || 1);
        panel.openPopupAtScreen(anchor.x * ratio, anchor.y * ratio + 8, false);
      } else {
        panel.openPopup(button, "after_start", 0, 4);
      }
      draw(preview);
    };
    return button;
  }

  function startScreenshot() {
    const browser = currentBrowser();
    if (!browser) return;
    Services.obs.notifyObservers(window, "menuitem-screenshot", "Toolbar");
  }

  async function onScreenshotRegion(browser, payload) {
    const region = payload?.region;
    if (!browser || !(region?.width > 0) || !(region?.height > 0)) return;
    const global = browser.browsingContext?.currentWindowGlobal;
    if (!global) return;
    const { ScreenshotsUtils } = ChromeUtils.importESModule(
      "moz-src:///browser/components/screenshots/ScreenshotsUtils.sys.mjs"
    );
    try {
      ScreenshotsUtils.closePanel(browser);
      await global.getActor(SCREENSHOT_ACTOR).sendQuery("ArcDeveloperScreenshot:End");
      const bitmap = await global.drawSnapshot(
        new DOMRect(region.left, region.top, region.width, region.height),
        1, "white", {}
      );
      ScreenshotsUtils.exit(browser);
      openPortraitCapture?.(bitmap, browser, payload.anchor);
    } catch (error) {
      try { ScreenshotsUtils.exit(browser); } catch (_) {}
      console.error("[Arc Developer Toolbar] Selected portrait capture failed", error);
    }
  }

  async function attachScreenshotPreview(doc) {
    await doc.defaultView.customElements.whenDefined("screenshots-preview");
    const preview = doc.querySelector("screenshots-preview");
    if (!preview) return;
    if (preview.updateComplete) await preview.updateComplete;
    const row = preview.shadowRoot?.querySelector(".preview-buttons");
    if (!row || row.querySelector("#arc-developer-portrait-preview")) return;
    const button = doc.createElement("moz-button");
    button.id = "arc-developer-portrait-preview";
    button.setAttribute("label", "Portrait");
    button.setAttribute("iconSrc", "chrome://sine/content/arc-developer-toolbar/icons/portrait.svg");
    button.addEventListener("click", async event => {
      event.stopPropagation();
      try {
        const bitmap = await doc.defaultView.createImageBitmap(preview.previewImg);
        const browser = preview.openerBrowser;
        const rect = button.getBoundingClientRect();
        const view = doc.defaultView;
        const anchor = {
          x: view.mozInnerScreenX + rect.left,
          y: view.mozInnerScreenY + rect.bottom,
          devicePixelRatio: view.devicePixelRatio,
        };
        preview.close();
        openPortraitCapture?.(bitmap, browser, anchor);
      } catch (error) {
        console.error("[Arc Developer Toolbar] Portrait preview failed", error);
      }
    });
    row.insertBefore(button, row.querySelector("#copy") || null);
  }

  const screenshotPreviewObserver = {
    observe(subject) {
      const doc = subject;
      if (!doc?.documentURI?.startsWith("chrome://browser/content/screenshots/screenshots-preview.html")) return;
      if (doc.defaultView?.browsingContext?.topChromeWindow !== window) return;
      attachScreenshotPreview(doc).catch(error => console.error("[Arc Developer Toolbar] Screenshot preview hook failed", error));
    },
  };

  function ensureBar() {
    const page = document.getElementById("tabbrowser-tabbox");
    if (!page) return false;
    if (bar?.isConnected) {
      if (bar.parentElement !== page) page.insertBefore(bar, page.firstChild);
      return true;
    }
    bar = document.createXULElement("hbox");
    bar.id = "arc-developer-toolbar";
    bar.setAttribute("align", "center");
    bar.hidden = true;
    urlLabel = document.createXULElement("label");
    urlLabel.id = "arc-developer-url";
    urlLabel.setAttribute("crop", "center");
    const spacer = document.createXULElement("spacer");
    spacer.id = "arc-developer-spacer";
    spacer.setAttribute("flex", "1");
    actions = document.createXULElement("scrollbox");
    actions.id = "arc-developer-actions";
    actions.setAttribute("orient", "horizontal");
    bar.append(
      urlLabel,
      spacer,
      actions,
      makeDivider(),
      makeAction("×", "Close developer toolbar", toggleBar)
    );
    page.insertBefore(bar, page.firstChild);
    console.log("[Arc Developer Toolbar] Inserted inside", page.id);
    return true;
  }

  function populateActions() {
    if (!actions) return;
    actions.replaceChildren();
    actions.appendChild(makePortraitButton());
    actions.appendChild(makeAction("Screenshot", "Select screenshot area", startScreenshot));
    const originalMenu = document.getElementById("menuWebDeveloperPopup");
    if (!originalMenu) {
      console.warn("[Arc Developer Toolbar] Native Developer Tools menu not ready");
      return;
    }
    // Firefox fills the native menu lazily. Its own popup listener initializes it.
    if (!originalMenu.querySelector('[id^="menuitem_"]')) {
      document.getElementById("browserToolsMenu")?.dispatchEvent(
        new Event("popupshowing", { bubbles: false })
      );
    }
    let count = 0;
    let browserToolboxButton = null;
    let browserConsoleButton = null;
    let responsiveButton = null;
    let eyedropperButton = null;
    const nativeButtons = [];
    function addMenuItems(parent, prefix = "") {
      for (const node of parent.children) {
        if (node.localName === "menu") {
          const submenu = node.querySelector("menupopup");
          if (submenu) addMenuItems(submenu, `${prefix}${node.getAttribute("label") || "More"} · `);
          continue;
        }
        if (node.localName !== "menuitem" || node.hidden || node.getAttribute("hidden") === "true") continue;
        const nativeLabel = node.getAttribute("label");
        if (!nativeLabel) continue;
        if (/screenshot|take screenshot/i.test(nativeLabel)) continue;
        const isWebDeveloperTools = /^web developer tools$/i.test(nativeLabel);
        const label = isWebDeveloperTools ? "Inspect" : nativeLabel;
        const button = makeAction(label, `${prefix}${label}`, () =>
          isWebDeveloperTools ? openTool("inspector") : node.doCommand()
        );
        button.disabled = node.disabled;
        if (/browser toolbox/i.test(nativeLabel)) browserToolboxButton = button;
        else if (/browser console/i.test(nativeLabel)) browserConsoleButton = button;
        else if (/responsive design mode/i.test(nativeLabel)) responsiveButton = button;
        else if (/eyedropper/i.test(nativeLabel)) eyedropperButton = button;
        else nativeButtons.push({ button, pageSource: /page source|view source/i.test(nativeLabel) });
        count++;
      }
    }
    addMenuItems(originalMenu);
    if (eyedropperButton) actions.append(eyedropperButton, makeDivider());
    if (responsiveButton) actions.appendChild(responsiveButton);
    for (const { button, pageSource } of nativeButtons) {
      actions.appendChild(button);
      if (pageSource) actions.appendChild(makeDivider());
    }
    if (browserConsoleButton) actions.appendChild(browserConsoleButton);
    if (browserToolboxButton) actions.appendChild(browserToolboxButton);
    if (!count) console.error("[Arc Developer Toolbar] Native menu has no actions yet");
  }

  function parseColor(value) {
    if (!value) return null;
    const probe = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    probe.style.color = value;
    document.documentElement.appendChild(probe);
    const parsed = getComputedStyle(probe).color;
    probe.remove();
    const match = parsed.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function chromeFallbackColor() {
    for (const id of ["zen-appcontent-navbar-wrapper", "navigator-toolbox", "zen-main-app-wrapper"]) {
      const element = document.getElementById(id);
      if (!element) continue;
      const bg = getComputedStyle(element).backgroundColor;
      if (bg && bg !== "transparent" && !/^rgba\([^)]*,\s*0\s*\)$/.test(bg) && parseColor(bg)) {
        return bg;
      }
    }
    return getComputedStyle(document.documentElement).getPropertyValue("--zen-primary-color").trim();
  }

  function samplePageColorInContent(documentOverride) {
    const doc = documentOverride || content.document;
    const view = doc.defaultView;
    if (!view || !doc.documentElement) return null;
    const visible = bg => bg && bg !== "transparent" &&
      !/^rgba\([^)]*,\s*0\s*\)$/.test(bg);
    const background = style => {
      if (visible(style.backgroundColor)) return style.backgroundColor;
      const image = style.backgroundImage || "";
      return image.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i)?.[0] || null;
    };
    const points = [
      [1, 3],
      [Math.floor(view.innerWidth / 2), 3],
      [Math.max(1, view.innerWidth - 2), 3],
      [Math.floor(view.innerWidth / 2), 30],
    ];
    for (const [x, y] of points) {
      for (const element of doc.elementsFromPoint(x, y)) {
        const rect = element.getBoundingClientRect();
        const style = view.getComputedStyle(element);
        if (rect.width < 1 || rect.height < 1 || style.visibility === "hidden") continue;
        const bg = background(style);
        if (visible(bg)) return bg;
      }
    }
    for (const meta of doc.querySelectorAll('meta[name="theme-color" i]')) {
      const media = meta.getAttribute("media");
      if (media && !view.matchMedia(media).matches) continue;
      if (visible(meta.content)) return meta.content;
    }
    return background(view.getComputedStyle(doc.body || doc.documentElement)) ||
      background(view.getComputedStyle(doc.documentElement));
  }

  function getPageColorViaMessageManager(browser) {
    return new Promise(resolve => {
      const manager = browser?.messageManager || browser?.frameLoader?.messageManager;
      if (!manager) return resolve(null);
      const name = "arc-developer-toolbar:theme";
      const id = `${Date.now()}-${Math.random()}`;
      let timeout;
      let settled = false;
      const finish = color => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { manager.removeMessageListener(name, listener); } catch (error) {}
        resolve(color || null);
      };
      const listener = {
        receiveMessage(message) {
          if (message.data?.id === id) finish(message.data.color);
        },
      };
      try {
        manager.addMessageListener(name, listener);
        timeout = window.setTimeout(() => finish(null), 750);
        const script = `try { sendAsyncMessage(${JSON.stringify(name)}, { id: ${JSON.stringify(id)}, color: (${samplePageColorInContent.toString()})() }); } catch (error) { sendAsyncMessage(${JSON.stringify(name)}, { id: ${JSON.stringify(id)}, color: null }); }`;
        manager.loadFrameScript(
          `data:application/javascript;charset=UTF-8,${encodeURIComponent(script)}`,
          false
        );
      } catch (error) {
        finish(null);
      }
    });
  }

  async function updateTheme() {
    if (!bar || bar.hidden) return;
    const request = ++themeRequest;
    const browser = currentBrowser();
    let color = null;
    try {
      color = browser?.contentDocument ? samplePageColorInContent(browser.contentDocument) : null;
      if (browser && typeof ContentTask !== "undefined") {
        color ||= await ContentTask.spawn(browser, null, samplePageColorInContent);
      }
    } catch (error) {
      console.debug("[Arc Developer Toolbar] Page color unavailable", error);
    }
    if (!color) color = await getPageColorViaMessageManager(browser);
    if (!color) color = chromeFallbackColor();
    console.debug("[Arc Developer Toolbar] Page color", color || "fallback");
    if (request !== themeRequest || !bar || bar.hidden) return;
    const rgb = parseColor(color);
    if (!rgb) {
      bar.style.removeProperty("--arc-developer-bg");
      bar.style.removeProperty("--arc-developer-fg");
      return;
    }
    const linear = rgb.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    bar.style.setProperty("--arc-developer-bg", `rgb(${rgb.join(", ")})`);
    bar.style.setProperty("--arc-developer-fg", luminance > 0.55 ? "#17202a" : "#f5f7fa");
  }

  function updateBar() {
    if (!bar && !ensureBar()) return;
    const tab = selectedTab();
    if (tab && sessionStore?.getCustomTabValue(tab, SESSION_KEY) === "true") openTabs.add(tab);
    bar.hidden = !tab || !openTabs.has(tab);
    if (tab && !bar.hidden) tab.setAttribute("arc-developer-active", "true");
    else tab?.removeAttribute("arc-developer-active");
    document.getElementById(REPLACEMENT_ID)
      ?.setAttribute("aria-pressed", String(!bar.hidden));
    if (bar.hidden) {
      themeRequest++;
      return;
    }
    const spec = selectedTab()?.linkedBrowser?.currentURI?.displaySpec || "";
    urlLabel.setAttribute("value", spec);
    urlLabel.setAttribute("tooltiptext", spec);
    updateTheme();
  }

  function setDevMode(enabled) {
    if (!ensureBar()) {
      console.error("[Arc Developer Toolbar] Zen page panel not found");
      return;
    }
    const tab = selectedTab();
    if (!tab) return;
    if (enabled) {
      openTabs.add(tab);
      sessionStore?.setCustomTabValue(tab, SESSION_KEY, "true");
    } else {
      openTabs.delete(tab);
      sessionStore?.deleteCustomTabValue(tab, SESSION_KEY);
    }
    updateBar();
    if (!bar.hidden) populateActions();
    console.log("[Arc Developer Toolbar] Toggled", { visible: !bar.hidden });
  }

  function toggleBar() {
    const tab = selectedTab();
    setDevMode(!tab || !openTabs.has(tab));
  }

  function updateSiteControlsSetting() {
    const list = document.getElementById("zen-site-data-settings-list");
    if (!list) return;
    const enabled = !!selectedTab() && openTabs.has(selectedTab());
    let row = document.getElementById("arc-developer-site-setting");
    if (!row) {
      row = document.createXULElement("hbox");
      row.id = "arc-developer-site-setting";
      row.classList.add("permission-popup-permission-item");
      row.setAttribute("align", "center");
      row.setAttribute("role", "group");
      const icon = document.createXULElement("toolbarbutton");
      icon.classList.add("permission-popup-permission-icon", "zen-site-data-permission-icon");
      icon.setAttribute("image", "chrome://browser/skin/zen-icons/developer.svg");
      icon.setAttribute("closemenu", "none");
      const labels = document.createXULElement("vbox");
      labels.classList.add("permission-popup-permission-label-container");
      labels.setAttribute("flex", "1");
      labels.setAttribute("align", "start");
      const name = document.createXULElement("label");
      name.classList.add("permission-popup-permission-label");
      name.textContent = "Developer Mode";
      const state = document.createXULElement("label");
      state.classList.add("zen-permission-popup-permission-state-label");
      labels.append(name, state);
      row.append(icon, labels);
      row.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        setDevMode(!openTabs.has(selectedTab()));
        updateSiteControlsSetting();
      }, true);
    }
    row.setAttribute("state", enabled ? "allow" : "block");
    row.querySelector(".zen-permission-popup-permission-state-label").textContent = enabled ? "On" : "Off";
    const separator = list.querySelector("toolbarseparator");
    if (separator) separator.before(row);
    else list.appendChild(row);
    const section = list.closest(".zen-site-data-section");
    if (section) section.hidden = false;
  }

  function installSiteControlsSetting() {
    const panel = document.getElementById("zen-unified-site-data-panel");
    if (!panel || panel.dataset.arcDeveloperSettingInstalled) return false;
    panel.dataset.arcDeveloperSettingInstalled = "true";
    panel.addEventListener("popupshowing", () => window.setTimeout(updateSiteControlsSetting, 0), true);
    window.addEventListener("TabSelect", updateSiteControlsSetting);
    return true;
  }

  function installUrlbarCommands() {
    const commandSet = document.getElementById("zenCommandSet");
    if (!commandSet) return;
    for (const [id, enabled] of [["cmd_arcDeveloperOn", true], ["cmd_arcDeveloperOff", false]]) {
      document.getElementById(id)?.remove();
      const command = document.createXULElement("command");
      command.id = id;
      command.addEventListener("command", () => setDevMode(enabled));
      commandSet.appendChild(command);
    }
    installUrlbarActions();
  }

  function install() {
    const original = document.getElementById(ORIGINAL_ID);
    if (!original?.parentNode) return false;
    const previous = document.getElementById(REPLACEMENT_ID);
    if (previous?.getAttribute("data-arc-toolbar-version") === "1.4.3") return true;
    previous?.remove();

    // Remove the previous version's separate button and page strip on hot reload.
    document.getElementById("arc-developer-toolbar-button")?.remove();
    document.getElementById("arc-developer-toolbar")?.remove();

    const button = document.createXULElement("toolbarbutton");
    button.id = REPLACEMENT_ID;
    button.setAttribute("class", original.getAttribute("class") || "toolbarbutton-1");
    button.setAttribute("type", "button");
    button.setAttribute("label", "Developer Tools");
    button.setAttribute("tooltiptext", "Developer tools and page actions");
    button.setAttribute("removable", "true");
    button.setAttribute("data-arc-toolbar-version", "1.4.3");
    const icon = getComputedStyle(original).listStyleImage;
    if (icon && icon !== "none") button.style.listStyleImage = icon;

    button.addEventListener("command", toggleBar);
    original.before(button);
    original.hidden = true;
    original.setAttribute("aria-hidden", "true");
    window.addEventListener("TabSelect", updateBar);
    window.addEventListener("pageshow", updateBar);
    window.addEventListener("SSTabRestored", restoreTabs);
    window.addEventListener("SSWindowRestored", restoreTabs);
    window.arcDeveloperToolbarOnRegionPick = onScreenshotRegion;
    try { installScreenshotIntegration(window); } catch (error) {
      console.error("[Arc Developer Toolbar] Screenshot integration unavailable", error);
    }
    installUrlbarCommands();
    if (!installSiteControlsSetting()) {
      const siteObserver = new MutationObserver(() => {
        if (installSiteControlsSetting()) siteObserver.disconnect();
      });
      siteObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (ensureBar()) populateActions();
    for (const topic of ["chrome-document-loaded", "document-element-inserted"]) {
      Services.obs.addObserver(screenshotPreviewObserver, topic);
    }
    sessionStore?.promiseAllWindowsRestored?.then(restoreTabs).catch(error =>
      console.error("[Arc Developer Toolbar] Session restore failed", error)
    );
    window.setTimeout(restoreTabs, 0);
    const browser = typeof gBrowser !== "undefined" ? gBrowser : window.gBrowser;
    browser?.addTabsProgressListener({
      onLocationChange(changedBrowser) {
        if (changedBrowser === currentBrowser()) {
          updateBar();
          window.setTimeout(updateBar, 700);
        }
      },
    });
    console.log("[Arc Developer Menu] Replaced #developer-button");
    return true;
  }

  function start() {
    if (install()) return;
    observer = new MutationObserver(() => {
      if (install()) {
        observer.disconnect();
        observer = null;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.addEventListener("unload", () => {
    observer?.disconnect();
    for (const topic of ["chrome-document-loaded", "document-element-inserted"]) {
      try { Services.obs.removeObserver(screenshotPreviewObserver, topic); } catch (_) {}
    }
    delete window.arcDeveloperToolbarOnRegionPick;
  }, { once: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
