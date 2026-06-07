# GitNotes

GitNotes is a clean, installable Markdown notes PWA backed by a GitHub repository. It is designed for personal notes on iPhone without App Store publishing, native signing, or a backend server.

The app uses GitHub's REST Contents API rather than a real local Git clone. Opening the app refreshes notes from GitHub, and saving a note creates a commit in your repository.

## Features

- Installable PWA for iPhone home-screen use.
- Markdown notes stored as `.md` files in a GitHub repo folder.
- GitHub Pages friendly static hosting.
- Local IndexedDB cache for fast loading and offline drafts.
- Create, edit, delete, search, sync, and save notes.
- Commit-on-save using the GitHub Contents API.
- Basic conflict detection using GitHub file SHAs.
- No third-party analytics or remote scripts.

## iPhone Install

1. Open the hosted GitNotes URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Enable Open as Web App if prompted.
5. Tap Add.

The app will launch from your home screen like a standalone app.

## GitHub Token Setup

Create a fine-grained personal access token:

1. Go to GitHub Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens.
2. Generate a new token.
3. Set the resource owner to your account.
4. Select only the repository you want GitNotes to use.
5. Grant repository permission: Contents -> Read and write.
6. Set an expiration date.
7. Copy the token and paste it into GitNotes setup.

Do not use a broad classic token unless fine-grained tokens do not work for your repo or organization.

## Security Model

GitNotes is a static PWA hosted on GitHub Pages. There is no server-side secret storage, so the browser must store and send your GitHub token directly.

For v1, the token is stored in IndexedDB on the device/browser where you set up the app. To reduce risk:

- Use a fine-grained token scoped to one notes repo.
- Grant only Contents read/write.
- Set a token expiration.
- Do not add third-party scripts or analytics.
- Do not paste the token into URLs, issues, logs, or screenshots.

If someone gets JavaScript execution in this app's origin while your token is stored, they may be able to read the token. This is the main tradeoff of a no-backend PWA.

## Local Development

This app is dependency-free. Any static file server works.

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Deploy To GitHub Pages

1. Push this project to a GitHub repository.
2. In the repo, open Settings -> Pages.
3. Choose Deploy from a branch.
4. Select the branch and root folder.
5. Save.
6. Open the published GitHub Pages URL.

Because all asset paths are relative, the app works from either a custom domain or a repository subpath like `/GitNotes/`.

## How Sync Works

- App open: fetches the configured notes folder from GitHub.
- Note open: loads cached content first, then fetches the file from GitHub if needed.
- Save: writes local content immediately and pushes the file through GitHub's Contents API.
- Commit message: `Create path/to/note.md` or `Update path/to/note.md`.
- Offline: notes remain pending locally and push when the app returns online.
- Conflict: if the remote file SHA changed since the note was loaded, GitNotes asks whether to reload remote, save as copy, or overwrite.

## Current Limitations

- GitHub only.
- Not a full Git client; no local clone, branches UI, merge UI, or rebase.
- Basic conflict handling, not a visual diff.
- Token is stored in browser storage, not iOS Keychain.
- No end-to-end encryption.
- Markdown editing only; preview and backlinks are future work.

## Roadmap Ideas

- Optional passphrase lock for the stored token.
- Markdown preview.
- Tags and backlinks.
- Conflict diff viewer.
- Batch commits.
- GitHub OAuth or GitHub App backend for safer public use.
