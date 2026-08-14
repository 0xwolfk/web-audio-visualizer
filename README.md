# 🎧 Live Audio Visualizer

A GitHub Pages site that visualizes **any audio playing on your computer** in real time — YouTube, Spotify, a local app, whatever. No uploading a file, no embedding a player.

## How it works

Browsers won't let a webpage silently listen to audio from other tabs or apps (privacy/security). Instead, this uses the browser's built-in **tab/screen sharing picker** (`getDisplayMedia`) to capture audio from a source *you* explicitly choose, then feeds it into the Web Audio API for real-time visualization. Nothing is uploaded or sent anywhere — it all happens locally in your browser.

## Usage

1. Open the page.
2. Click **Start Capture**.
3. In the browser's share picker, choose the tab, window, or entire screen playing your audio (e.g. your YouTube or Spotify tab).
4. Make sure **"Share audio"** (Chrome) / **"Share tab audio"** is checked in the picker — this is required, it's off by default.
5. Watch the visualization react to the audio.

Switch between **Bars**, **Waveform**, and **Circular** styles, and pick a color theme, using the controls below the canvas.

## Browser support

Requires a Chromium-based browser (Chrome, Edge, Brave) for tab-audio sharing support in `getDisplayMedia`. Firefox/Safari support for audio capture via this API is limited or absent.

## Local development

Just open `index.html` in a browser, or serve the folder with any static file server:

```
npx serve .
```

## Deployment

Deployed via GitHub Pages from the repository root (`main` branch).
