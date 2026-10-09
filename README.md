# Cat vs Dog Tournament

Two brackets of 16 (cats and dogs) are projected two images at a time. Students vote on their phones, no login needed. Rounds advance automatically: Round 1, Round 2, Round 3, Semi Final, Final.

## Put it online (about 10 minutes)

You need a free Netlify account and a free GitHub account.

1. Create a new GitHub repository and upload everything in this folder (leave out `node_modules`).
2. In Netlify choose Add new project, then Import an existing project, and pick that repository. Keep the default settings: the folder `public` is the site and `netlify/functions` holds the server code (both are already set in `netlify.toml`).
3. Before the first deploy finishes, open Project configuration, then Environment variables, and add `PRESENTER_PASSCODE` with any passcode you like. Only you will use it. If you add it after deploying, trigger a new deploy.
4. Open `https://YOUR-SITE.netlify.app/present`, enter the passcode, and upload 16 cat and 16 dog images.

Instead of GitHub you can use the Netlify command line: install it, run `netlify deploy --prod` in this folder, and set the passcode with `netlify env:set PRESENTER_PASSCODE yourpasscode`. Dragging the folder onto the Netlify website probably will not work, because the server code needs its package installed during deploy.

## Running a class

- Presenter screen: `/present` on the site. Use the laptop connected to the projector.
- Students: the site's main address (`/`). It shows as a QR code on the screen before each round.
- Space or Enter starts voting and moves to the next matchup.
- Voting lasts 20 seconds. Students can change their vote until time is up. Counts appear only after voting closes. A tie triggers a revote.
- If phones fail, use Enter counts by hand to type in a show of hands.
- To reuse: choose Start over, then Start tournament again with the same images, or Clear all images and upload new ones.

## Before class

Test it once with your phone on mobile data (not the school wifi) and with a second device. Check your Netlify usage page after a test run, since the free plan has a monthly credit limit and each phone checks in about once a second while the page is open.

## Limits to know

- Each phone gets one vote per matchup, tracked by a random ID stored in that browser. A student who clears their browser data could vote twice. That is fine for a class.
- Phones check for updates every second or so, so a student may see the buttons up to about a second after you start voting.
