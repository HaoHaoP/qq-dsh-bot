# qq-meme-pick

`qq_meme` selects 1-3 local meme images and returns their absolute paths. It
does not send anything; pass the returned `files` to `qq_send_image`.

```text
qq_meme({ mood: "happy", keyword: "hug", count: 1, rescan: false })
```

The plugin scans two filesystem roots on each call:

- Built-in images: `<dsh-meme package root>/memes/`, located with
  `import.meta.resolve('dsh-meme/package.json')`.
- User images: `$DSH_HOME/meme-packs/`, or `~/.dsh/meme-packs/` when
  `DSH_HOME` is unset.

A missing root is skipped. The plugin does not read dsh-meme's database and
does not require dsh-meme's pack index to exist. It only reads images from the
two directories.

The plugin writes its own SQLite index to
`$DSH_HOME/qq-meme-pick/index.db` (default `~/.dsh/qq-meme-pick/index.db`).
The first call indexes every image. Later calls reuse unchanged rows and
refresh files whose modification time or size changed. `rescan: true` forces
a complete refresh before selection.

Configuration:

| Key | Default | Meaning |
| --- | --- | --- |
| `packsDir` | `$DSH_HOME/meme-packs` | User image scan root |
| `builtinDir` | dsh-meme package's `memes/` | Optional explicit built-in root override |
| `cooldownSeconds` | `300` | Do not return the same image within this window |

Mood and keyword inference, the index schema, and server verification are
documented in [`docs/qq-meme-pick.md`](../../docs/qq-meme-pick.md).
