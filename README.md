# henryheligas.us

The published website, served by GitHub Pages from this repo's `main` branch
(repo name `henry-heligas.github.io`, custom domain in `CNAME`).

```
index.html     homepage
catchment/     the Catchment game (built, do not edit here)
CNAME          custom domain: henryheligas.us
.nojekyll      serve files as-is (no Jekyll processing)
```

## Update Catchment

From `../catchment`:

```sh
node tools/build_site.js          # rebuilds ./catchment/ here with production settings
```

Then commit and push this folder. GitHub Pages republishes in about a minute.

The puzzles are generated a year ahead (`data/puzzles.js`), so the site needs
no daily updates. Regenerate and redeploy before they run out.
