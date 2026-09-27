const OVERLAY = "moz-src:///browser/components/screenshots/ScreenshotsOverlayChild.sys.mjs";
const BUTTON_ID = "arc-developer-portrait-region";

function installButton(overlay) {
  const wrapper = overlay.buttonsContainer?.querySelector(".buttons-wrapper");
  const copy = overlay.copyButton;
  if (!wrapper || !copy || wrapper.querySelector(`#${BUTTON_ID}`)) return;
  const button = copy.cloneNode(true);
  button.id = BUTTON_ID;
  button.title = "Capture selection as portrait";
  button.setAttribute("aria-label", button.title);
  button.querySelector("label").textContent = "Portrait";
  const image = button.querySelector("img");
  if (image) {
    const svg = overlay.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 18 18");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    const rect = overlay.document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "3"); rect.setAttribute("y", "2");
    rect.setAttribute("width", "12"); rect.setAttribute("height", "14");
    rect.setAttribute("rx", "2");
    const path = overlay.document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 12l2.5-2.5 2 2 1.5-1.5 2 2");
    svg.append(rect, path);
    button.replaceChild(svg, image);
  }
  wrapper.insertBefore(button, copy);
}

function patchOverlay() {
  const { ScreenshotsOverlay } = ChromeUtils.importESModule(OVERLAY);
  const proto = ScreenshotsOverlay.prototype;
  if (proto._arcDeveloperPortraitPatched) return;
  proto._arcDeveloperPortraitPatched = true;
  const originalInit = proto.initializeElements;
  proto.initializeElements = function (...args) {
    originalInit.apply(this, args);
    try { installButton(this); } catch (error) { console.error("[Arc Developer Toolbar] Screenshot button failed", error); }
  };
  const originalClick = proto.handleClick;
  proto.handleClick = function (event) {
    const target = event.originalTarget;
    const picked = event.button === 0 &&
      (target?.id === BUTTON_ID || target?.closest?.(`#${BUTTON_ID}`));
    if (picked) {
      const region = Object.assign({}, this.selectionRegion.dimensions);
      region.devicePixelRatio = this.window.devicePixelRatio;
      const rect = this.getElementById(BUTTON_ID).getBoundingClientRect();
      this.window.windowGlobalChild.getActor("ArcDeveloperScreenshot")
        .sendAsyncMessage("ArcDeveloperScreenshot:Region", {
          region,
          anchor: {
            x: this.window.mozInnerScreenX + rect.left,
            y: this.window.mozInnerScreenY + rect.bottom,
            devicePixelRatio: this.window.devicePixelRatio,
          },
        });
      return;
    }
    return originalClick.apply(this, arguments);
  };
}

export class ArcDeveloperScreenshotChild extends JSWindowActorChild {
  actorCreated() {
    // Install before Screenshots:ShowOverlay initializes the selection controls.
    // A Prime message sent at that point arrives too late for the first capture.
    patchOverlay();
  }

  receiveMessage(message) {
    if (message.name === "ArcDeveloperScreenshot:Prime") patchOverlay();
    if (message.name === "ArcDeveloperScreenshot:End") {
      this.contentWindow.windowGlobalChild.getActor("ScreenshotsComponent")
        .endScreenshotsOverlay({ doNotResetMethods: true });
    }
    return null;
  }
}
