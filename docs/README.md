# Static axi docs (GitHub Pages)

Public product docs. Point GitHub Pages at the `/docs` folder on the default branch.

```
docs/
  documentation/   # product docs (getting started, chat, CLI, mission, …)
  changelog/       # release notes (markdown + Pages HTML)
  assets/          # shared chrome (CSS, logo, favicon)
  index.html       # redirects → documentation/
```

**Edit by regenerating:** `node scripts/build-docs.mjs` (or edit HTML under `documentation/` directly).

- Docs home: [`documentation/`](documentation/)
- Changelog: [`changelog/`](changelog/) — indexed from root [`CHANGELOG.md`](../CHANGELOG.md)

Root URL `https://aquinf03.github.io/axi/` redirects into `documentation/`.
