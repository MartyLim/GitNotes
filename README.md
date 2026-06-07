# GitNotes

GitNotes is a lightweight web notes app backed by a GitHub repo.

It is meant as a simple alternative if you want something in the orbit of Obsidian or Notion, but with a much smaller surface area: plain Markdown files, GitHub as the source of truth, and a clean web UI that works well as a PWA on iPhone and Android.

Hosted app:

https://martylim.github.io/GitNotes/

## What It Is

- A browser-first notes interface for Markdown files in a GitHub repo.
- Installable as a PWA on mobile.
- Static hosting only. No backend.
- Good fit for personal notes, a shared repo of docs, or a lightweight published notes setup.

## How It Works

- Notes live in a GitHub repository as `.md` files.
- The app reads and writes those files through the GitHub Contents API.
- On open, it syncs from GitHub.
- On save, it commits the edited file back to GitHub.
- Local drafts are cached in the browser so the app stays useful offline.

## Setup

1. Create a fine-grained GitHub token.
2. Scope it to the repo you want to use.
3. Give it `Contents: read and write`.
4. Open the app and enter:
   - `Repository Owner`
   - `Repository Name`
   - `Branch`
   - `Base Directory` if you want notes somewhere other than the repo root

Token setup details:

https://docs.github.com/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token

Permissions reference:

https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens

## Using It As A PWA

On iPhone or Android, open the site in your browser and add it to your home screen. Once installed, it behaves like a standalone app and gives you a cleaner full-screen experience than a normal tab.

On iPhone:

1. Open the site in Safari.
2. Use Share -> Add to Home Screen.

On Android:

1. Open the site in Chrome or another supported browser.
2. Use the browser menu to install the app.

## Local Development

Any static server works:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Deploying

This repo is set up to run from GitHub Pages:

https://martylim.github.io/GitNotes/

If you fork it or use it for your own repo, just publish the static files and update the hosted URL in your README.

## For Contributors

This is a small static app by design. If you want to contribute, start by keeping the UI simple and the sync model boring. The main goals are:

- fast note editing
- clear GitHub sync
- good mobile PWA behavior
- minimal setup friction

## A Few Limits

- GitHub-only sync.
- No full Git client.
- Basic conflict handling.
- Token is stored locally in the browser, not in a backend.
