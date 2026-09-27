export class ArcDeveloperScreenshotParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name !== "ArcDeveloperScreenshot:Region") return null;
    const browser = this.browsingContext?.top?.embedderElement;
    const chrome = browser?.ownerGlobal ?? this.browsingContext?.topChromeWindow;
    chrome?.arcDeveloperToolbarOnRegionPick?.(browser, message.data);
    return null;
  }
}
