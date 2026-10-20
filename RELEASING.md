# Releasing

The plugin is submitted to Obsidian's community list from **this** repository
(not the vault repo, which holds personal notes).

## One-time setup

1. Push this repo to GitHub as a public repository, e.g. `<user>/language-trainer-cards`.
2. Replace `YOUR_USERNAME` in `manifest.json` (`authorUrl`) with your GitHub username.
3. Submit a PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
   adding `"<user>/language-trainer-cards"` to the end of `community-plugins.json`.

## Cutting a release

1. Bump `version` in `manifest.json` (semver, no leading `v`).
2. Add the matching entry to `versions.json`: `"<version>": "<minAppVersion>"`.
3. Commit, then create and push a tag **identical to the version**:
   ```sh
   git tag 0.1.0
   git push origin 0.1.0
   ```
   The `Release` workflow then publishes a GitHub release with `main.js`,
   `manifest.json`, and `styles.css` attached as assets.
4. Obsidian installs the plugin from those release assets.

## Requirements checklist

- `manifest.json` fields complete; `id` lowercase and not containing "obsidian".
- `description` short, no trailing period, no "Obsidian" in it.
- Release tag exactly equals `manifest.json` version (no `v` prefix).
- Release assets include `main.js`, `manifest.json`, and `styles.css`.
- `versions.json` maps every released version to its `minAppVersion`.

## Keeping the vault in sync

The vault's installed copy lives at
`<vault>/.obsidian/plugins/language-trainer/`.
After changing the source here, copy `main.js`, `manifest.json`, and
`styles.css` into that folder and reload Obsidian.
