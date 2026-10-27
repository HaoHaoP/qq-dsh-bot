# qq-meme-pick

`qq_meme` selects 1-3 local meme images and returns their absolute paths. It
does not send anything; pass the returned `files` to `qq_send_image`.

```text
qq_meme({ mood: "happy", keyword: "hug", count: 1, rescan: false })
```

The plugin treats two filesystem roots as containers of meme packages:

- Built-in packages: `<dsh-meme package root>/memes/`, located with
  `import.meta.resolve('dsh-meme/package.json')`.
- User packages: `$DSH_HOME/meme-packs/`, or `~/.dsh/meme-packs/` when
  `DSH_HOME` is unset.

Each immediate child is a package. Image files are collected recursively from
`<package>/memes/` when that directory exists, otherwise from the package root.
This supports `<package>/memes/<emotion>/<file>`, legacy
`<package>/<emotion>/<file>`, and flat `<package>/<file>` layouts. Missing
roots and empty packages are skipped. The plugin does not read dsh-meme's
database or require its pack index to exist.

The plugin writes its own SQLite index to
`$DSH_HOME/qq-meme-pick/index.db` (default `~/.dsh/qq-meme-pick/index.db`).
The first call with an empty index scans every package image. Later calls reuse
the index. `rescan: true` forces a complete scan and refreshes changed files
before selection.

Configuration:

| Key | Default | Meaning |
| --- | --- | --- |
| `packsDir` | `$DSH_HOME/meme-packs` | User image scan root |
| `builtinDir` | dsh-meme package's `memes/` | Optional explicit built-in root override |
| `cooldownSeconds` | `300` | Do not return the same image within this window |

Mood and keyword inference, the index schema, and server verification are
documented in [`docs/qq-meme-pick.md`](../../docs/qq-meme-pick.md).
