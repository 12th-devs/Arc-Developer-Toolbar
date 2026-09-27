# Arc-style Developer Toolbar for Zen

A Sine mod that replaces Zen's Developer Tools menu button with a toggle for a developer toolbar above the active page. The toolbar follows the page color and provides shortcuts for inspection, responsive design, browser tools, debugging, page source, and screenshots.

Developer Mode is saved per tab across browser restarts. You can also toggle it from the site-controls settings panel or Zen's URL bar commands.

## Portrait screenshots

The toolbar's Portrait button captures the current page. Portrait is also available in Firefox's screenshot selection and full-page preview UI, whether Developer Mode is on or off. It places the screenshot on a solid or gradient background, lets you adjust the hue, and copies the resulting PNG to the clipboard.

The copied notification includes a Share button. Native image sharing depends on whether the current Zen/Firefox build supports sharing image files through the Web Share API.

## Install

Install through Sine using the repository URL:

`https://github.com/12th-devs/Arc-Developer-Toolbar`

Restart Zen after installing or updating, since the mod registers a screenshot actor at browser startup.

## Files

- `theme.json` — Sine manifest
- `arc-developer-toolbar.uc.js` — browser UI, actions, Portrait panel, tab state
- `ArcDeveloperIntegration.sys.mjs` — screenshot and URL bar hooks
- `ArcDeveloperScreenshotChild.sys.mjs` and `ArcDeveloperScreenshotParent.sys.mjs` — screenshot selection action
- `chrome.css` and `icons/` — styling and icons
