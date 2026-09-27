const BASE = "chrome://sine/content/arc-developer-toolbar/";
const ACTOR = "ArcDeveloperScreenshot";
let installed = false;

export function installScreenshotIntegration(win) {
  if (installed) return;
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: BASE + "ArcDeveloperScreenshotParent.sys.mjs" },
      child: { esModuleURI: BASE + "ArcDeveloperScreenshotChild.sys.mjs" },
      messageManagerGroups: ["browsers"],
      allFrames: false,
      safeForUntrustedWebProcess: true,
    });
  } catch (error) {
    // Another browser window may already have registered the actor.
  }
  // Initialize existing tabs at browser startup, including restored tabs.
  for (const browser of win?.gBrowser?.browsers || []) {
    try {
      browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR)
        ?.sendAsyncMessage("ArcDeveloperScreenshot:Prime");
    } catch (_) {
      // A discarded or still restoring tab is primed when screenshots open.
    }
  }
  const { ScreenshotsUtils } = ChromeUtils.importESModule(
    "moz-src:///browser/components/screenshots/ScreenshotsUtils.sys.mjs"
  );
  const original = ScreenshotsUtils.showPanelAndOverlay;
  ScreenshotsUtils.showPanelAndOverlay = function (browser, data) {
    try {
      // Creating the actor installs the selection button synchronously in
      // actorCreated(), before Firefox sends Screenshots:ShowOverlay.
      browser?.browsingContext?.currentWindowGlobal?.getActor(ACTOR)
        ?.sendAsyncMessage("ArcDeveloperScreenshot:Prime");
    } catch (error) {
      console.error("[Arc Developer Toolbar] Screenshot Portrait action unavailable", error);
    }
    return original.apply(this, arguments);
  };
  installed = true;
}

const ON = "cmd_arcDeveloperOn";
const OFF = "cmd_arcDeveloperOff";

export function installUrlbarActions() {
  const { globalActions } = ChromeUtils.importESModule(
    "resource:///modules/ZenUBGlobalActions.sys.mjs"
  );
  if (!Array.isArray(globalActions)) return;
  for (const [id, label, active] of [
    [ON, "Turn on Developer Mode", false],
    [OFF, "Turn off Developer Mode", true],
  ]) {
    const action = {
      label,
      icon: "chrome://browser/skin/zen-icons/developer.svg",
      command: id,
      commandId: id,
      extraPayload: {},
      isAvailable: win => {
        const tab = win?.gBrowser?.selectedTab;
        return !!win?.document?.getElementById(id) && !!tab &&
          tab.hasAttribute("arc-developer-active") === active;
      },
    };
    const index = globalActions.findIndex(item => item.commandId === id);
    if (index >= 0) globalActions.splice(index, 1, action);
    else globalActions.push(action);
  }
}
