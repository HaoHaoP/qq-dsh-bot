# qq-meme-pick

Thin bridge for the QQ meme workflow: `qq_meme` picks a local meme from
`~/.dsh/meme-packs` and returns absolute paths. It does not send anything.
Pass the returned `files` to `qq_send_image`.

```text
qq_meme({ mood: "happy", keyword: "干饭", count: 1 })
```

Result:

```json
{
  "files": ["/absolute/path/to/meme.jpg"],
  "caption": "捧着蓝碗干饭，星星眼吃得很香"
}
```

Configuration:

| Key | Default | Meaning |
| --- | --- | --- |
| `packsDir` | `$DSH_HOME/meme-packs` or `~/.dsh/meme-packs` | dsh-meme pack root |
| `extraPackDirs` | `[]` | Additional pack roots |
| `cooldownSeconds` | `300` | Do not return the same image within this window |

The plugin opens every `index.db` in read-only mode. It never writes, moves, or
deletes anything in the meme library.
