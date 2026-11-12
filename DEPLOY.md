# TrailKeep deploy guide

TrailKeep is a static site. It needs HTTPS hosting (required for GPS and for offline use) and nothing else: no server, no database, no keys.

> **Status on 2026-11-12:** the production build succeeds, 73 unit tests pass, and 9 end-to-end tests pass in WebKit (iPhone profile) and Chromium, including a reload with no network. It has **not been run on a real iPhone yet**: do section 3 and the checks in section 5 before you rely on it.

## 1. Run it on the Mac first

```bash
npm install
```

```bash
npm test
```

```bash
npm run dev
```

Open http://127.0.0.1:5173, import `example.gpx`, and check that the map and trail appear. The service worker (offline app shell) only exists in the production build:

```bash
npm run build
```

```bash
npm run preview
```

Then open http://127.0.0.1:4173.

Optional, needs internet (it downloads real map tiles):

```bash
npx playwright install webkit chromium
```

```bash
npm run e2e
```

## 2. Deploy to GitHub Pages (free)

You need a free GitHub account. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. Create the empty repository: open https://github.com/new?name=trailkeep&visibility=public and press **Create repository**. Public is required for Pages on a free account. Do not add a README, .gitignore or license.
2. This folder is already a git repository with a first commit on `main`, and its remote is set to `git@github.com:urino00/trailkeep.git` (SSH, using the key already on this Mac). Push:

```bash
git push -u origin main
```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to go green. If the first run failed because Pages was not enabled yet, press **Re-run all jobs**. The workflow uses the action versions current on 2026-11-12 (`checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`); it has not been run on GitHub yet.
5. Your address is `https://urino00.github.io/trailkeep/`. The build uses relative paths, so any repository name works.

`example.gpx` and `PLAN.md` are pushed too. Add them to `.gitignore` first if you do not want them public.

### Your email address stays private

Commits in this repository are authored with your GitHub private address (`…+urino00@users.noreply.github.com`), set for this repository only, so your real email is not in the public history and the commits still count as yours. To make that the rule for everything you push, open GitHub → Settings → Emails and tick **Keep my email addresses private** and **Block command line pushes that expose my email**.

### Alternative: Cloudflare Pages

Connect the repository in the Cloudflare dashboard (Workers & Pages → Create → Pages), build command `npm run build`, output directory `dist`. No other settings.

## 3. Install on the iPhone

1. Open the address in **Safari** (not Chrome).
2. Share → **Add to Home Screen** → Add.
3. Close Safari. From now on open TrailKeep only from the icon: data saved in the Safari tab is not shared with the Home Screen app.
4. Import a GPX, tap **Download map**, wait for *Ready offline ✓*.
5. **Storage & trip check → Check before trip**: everything should be green.
6. Airplane Mode on, force-quit the app, reopen it, open the trail. The map must show labels, shading and contours.

## 4. Updating later

Push to `main`; Pages redeploys. The installed app shows **Update available** the next time it is opened online, and only updates when you tap **Update**. Trails and maps are kept. Do not update right before or during a trip.

To refresh the bundled fonts, sprites and base style: `npm run assets:map`. To regenerate icons: `npm run assets:icons`.

## 5. iPhone checks before the Argentina trip

These cannot be tested on the Mac. Do them once on the real phone:

- [ ] Add to Home Screen works and the app opens full screen from the icon.
- [ ] **Import GPX** shows your `.gpx` files in Files and iCloud Drive as selectable. If they are greyed out, tap the "GPX file greyed out?" link under the button and import again.
- [ ] Download a trail map; the card shows *Ready offline ✓*.
- [ ] Airplane Mode on, force-quit, reopen: library and map render with labels, shading and contours.
- [ ] **Check before trip** is all green, including "Opened from the Home Screen icon" and "Storage is protected".
- [ ] Walk outside with the app open: the blue dot follows you and the progress numbers move. Tap the arrow button twice to test compass mode.
- [ ] Lock the phone: the location arrow in the status bar disappears. Unlock: the dot is grey for a moment, then blue again.
- [ ] Leave the trail screen open for 30 minutes and note the battery drop.
- [ ] Rotate the phone and try dark mode.
- [ ] Import a real Argentine GPX (El Chaltén or Bariloche) and download it. The automated tests already download and render an area at El Chaltén, but with a synthetic route.
- [ ] Keep a few GB free on the phone. **Deleting the app icon deletes all trails and maps.**

## 6. Open items for you

- **OPEN-1:** OpenFreeMap's terms ask offline downloaders for a unique User-Agent, which browsers cannot set. The app stays within the other limits (≤ 2,500 tiles and ≤ 40 MB per chunk, 4 parallel requests) and is identified by its Origin header. Consider emailing `info@openfreemap.org` to describe this personal app and ask whether that is enough.
- **OPEN-3:** GitHub Pages or Cloudflare Pages: your choice; both are covered above.
- **OPEN-4:** "TrailKeep" is a placeholder name. To change it, edit `vite.config.ts` (manifest), `index.html` and the brand text in `src/ui/LibraryScreen.tsx`.
