# Claude Code themes

The site and the Claude Code plugin marketplace at
<https://themes.whirlwin.io>. A theme is a
[Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)
that takes over the spinner while Claude works. This repo holds every theme,
each a plugin in its own folder under `plugins/`, plus the catalog that lists
them and the page that shows them.

| Theme | Plugin | Folder |
| --- | --- | --- |
| Halloween | `halloween` | [plugins/halloween](plugins/halloween) |
| Christmas | `christmas` | [plugins/christmas](plugins/christmas) |
| Hacker News | `hackernews` | [plugins/hackernews](plugins/hackernews) |
| VG | `vg` | [plugins/vg](plugins/vg) |

Install a theme in a Claude Code session:

```
/plugin install halloween --marketplace https://themes.whirlwin.io/marketplace.json
```

It asks to add the marketplace first if it is not added yet, then installs.
From a shell, the command is
`claude plugin install halloween --marketplace https://themes.whirlwin.io/marketplace.json`.

## Good to know

- Only one theme can draw the spinner at a time. Hide one with its own
  command, such as `/halloween`, or keep it off with
  `claude plugin disable halloween@claude-themes`.
- The marketplace used to be called `whirlwin-themes`, and each theme used to
  live in a repo of its own (`whirlwin/claude-code-halloween` and so on). If
  you installed from either, uninstall that copy and remove the old
  marketplace first, for example
  `claude plugin uninstall halloween@whirlwin-themes` and
  `claude plugin marketplace remove whirlwin-themes`, then install again.
- To update, run `claude plugin marketplace update claude-themes`, then
  `claude plugin update <theme>@claude-themes`, then `/reload-plugins` in
  an open session.
- In the desktop app only the spinner's word changes. The tiles, the Clawd
  and the links need the terminal.

## Layout

| Path | What it is |
| --- | --- |
| `plugins/<name>/` | One theme: a whole Claude Code plugin with its own README, tests and `docs/demo.gif` |
| `.claude-plugin/marketplace.json` | The catalog, and its only copy in git |
| `wrangler.jsonc` | The Worker: static assets only, no code, on themes.whirlwin.io |
| `public/` | The site: plain HTML and CSS, no framework and no build step |
| `public/index.html` | The page: the title, two sentences on what a mod is, and one card per theme |
| `public/404.html` | Served for any path that has no file |
| `public/copy.js` | The copy buttons, the only script on the site |
| `public/_headers` | Security headers for every response, plus the content type, cache and CORS headers for `/marketplace.json` |
| `public/images/` | Each theme's spinner GIF and its reduced-motion still (cropped from its plugin's `docs/demo.gif`), the whirlwin.io wordmark and the grain overlay |
| `public/fonts/` | JetBrains Mono and its license (OFL), served by the site so the CSP allows no other origin |
| `public/og.png` | The link preview picture, rendered from `og/card.html` |
| `og/card.html` | The source of `og.png`, not deployed |
| `og/images/` | The pictures `og/card.html` uses, not deployed |
| `scripts/check.sh` | The consistency check that `npm run check` runs |

The look (colors, the card with its window dots, the status bar and the
scanlines) comes from [whirlwin.io](https://whirlwin.io), so the two sites read
as one family. Each theme card adds its own accent color.

### How /marketplace.json is served

The catalog lives in `.claude-plugin/marketplace.json`, where
`claude plugin validate .` looks for it. The `build.command` in
`wrangler.jsonc` copies it to `public/marketplace.json`. Wrangler runs that
command before `wrangler dev` and before `wrangler deploy`, so the site always
serves the same bytes as the file in git. The copy is gitignored, so there is
nothing to keep in sync by hand.

Workers Builds, Cloudflare's deploy-from-git service, does not run
`build.command`. If you connect this repo to it, set its build command to
`cp .claude-plugin/marketplace.json public/marketplace.json`, or the deployed
site has no `/marketplace.json`.

### Caching

Workers static assets send every file with
`Cache-Control: public, max-age=0, must-revalidate` and an ETag, so browsers
check for a new version each time and the pages need no version query
strings. `/marketplace.json` is the exception: `_headers` gives it
`max-age=300`, so an update to the catalog reaches users within five minutes.

## Local preview

```sh
npm install
npm run dev
```

Open <http://localhost:8787>. Editing a file in `public/` or the catalog
reloads the server; the catalog edit is copied into `public/` first.

## Check

```sh
npm run check
```

It runs `claude plugin validate .`, then `scripts/check.sh`, which fails when:

- a catalog entry has no card on the page, or a card has no entry
- a catalog entry's `path` is not a plugin folder whose `plugin.json` has
  the same `name`
- a card's code element is not exactly
  `/plugin install <name> --marketplace https://themes.whirlwin.io/marketplace.json`
- a `src`, `href`, CSS `url()` or `og:image` points at a file that is not in
  `public/`, or at an `id` the page does not have
- a file in this repo that we write has an en or em dash

The script needs `jq`, which macOS ships with.

## Deploy

```sh
npm run deploy
```

That runs `wrangler deploy`, which copies the catalog into `public/` first.
themes.whirlwin.io is a custom domain on the whirlwin.io zone in the same
Cloudflare account, so the first deploy creates the DNS record and the
certificate. The `*.workers.dev` URL and preview URLs are off. Log in once
with `npx wrangler login`.

## Add a theme

1. Put the plugin in `plugins/<name>/`, where `<name>` is the `name` in its
   own `plugin.json`, with no `marketplace.json` of its own.
2. Add an entry to `.claude-plugin/marketplace.json` with the same `name`.
   Give it a `description`, a `homepage` (the folder on GitHub), a
   `category`, `tags` and a `git-subdir` source with this repo's https clone
   URL and `path` set to `plugins/<name>`. Leave out `version`: the plugin's
   `plugin.json` already has one, and when both are set
   `claude plugin validate` warns that they disagree.
3. Add a card to `public/index.html`. Copy one of the
   `<article class="card theme ...">` elements and set its `id` to the plugin
   name. A card is the window chrome with the theme's name linking to its
   folder, the spinner GIF and the install command. The GIF is the top of the
   plugin's `docs/demo.gif`, a real session recording, cropped to the spinner
   and the first lines under it, 360x88. Run this from the plugin's folder and
   copy the results into `public/images/` (`brew install gifsicle` if you do
   not have it). The PNG is frame 0, shown to people who prefer reduced
   motion:

   ```sh
   gifsicle --crop 0,0+360x88 -O3 docs/demo.gif -o <name>-spinner.gif
   gifsicle --crop 0,0+360x88 docs/demo.gif '#0' -o frame.gif
   sips -s format png frame.gif --out <name>-spinner.png
   ```

   Describe it in the `alt` text. If the theme's text runs past the crop, add
   `shot__frame--cut` to the frame so the right edge fades. Add a `.theme--<name>` rule to `styles.css`
   with its `--accent` color, plus a lighter `--accent-text` if the accent has
   less than 4.5:1 contrast on the dark background.
4. Run `npm run check`, then `npm run deploy`.

People who already added the marketplace see the new theme after
`claude plugin marketplace update claude-themes`.

## Why git-subdir sources

People add this marketplace by its URL, and for a marketplace added that way
Claude Code downloads only `marketplace.json`. A relative source such as
`./plugins/halloween` has nothing to resolve against, so every entry names
this repo again with a `git-subdir` source, which clones only its own folder
(a sparse, partial clone). With the https clone URL of a public repo it needs
no GitHub SSH key.

## Link preview

`og.png` is `og/card.html` screenshotted at exactly 1200x627. The card loads
its pictures from `/og/images/` and its font from `/public/fonts/`, so serve
the repo root, not `public/`:

```sh
python3 -m http.server 8790
```

Open <http://localhost:8790/og/card.html> in a browser with a 1200x627
viewport at 1x, take a screenshot and save it as `public/og.png`.

## Submissions

Third-party themes are deliberately not open yet. The catalog lists only
whirlwin's own themes, and the site has no submission form, sign-in or
database.

Not affiliated with Anthropic, Y Combinator or Hacker News, or VG.

## License

MIT, see [LICENSE](LICENSE).
