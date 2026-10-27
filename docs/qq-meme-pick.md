# qq-meme-pick

## 探明结论

### 1. 图库目录与索引

dsh-meme 的一个标准图库包位于 `~/.dsh/meme-packs/<pack-id>/`，实际布局如下：

```text
~/.dsh/meme-packs/
└── <pack-id>/
    ├── manifest.json
    ├── index.db
    └── memes/
        └── <tag>/
            └── <image>.jpg|jpeg|png|gif|webp
```

大肥鱼 `dafeiyu-001` v1.3.0 的发布包实测有 24 个索引行和 24 个对应图片文件。`path` 是相对包根的路径，使用 `/`，例如 `memes/happy/deyi.jpg`。

实际读取 `index.db` 得到的表和列如下：

```sql
CREATE TABLE memes (
  path TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  caption TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  mtime REAL,
  captioned_at REAL
);
```

这是实际读出的 schema，不是推测。SQLite 中只有 `memes` 这一张业务表，没有独立的情绪表或图片表。

### 2. 去重口径

上游 dsh-meme 当前把单个包内的 `path` 作为主键去重。跨图库合并候选时，它给非当前库的路径加包前缀，但没有用 `file_hash` 合并相同内容，因此同一字节的图片放在两个包里会被上游视为两条记录。

`qq-meme-pick` 对跨库选图采用内容口径：优先使用索引里的 `file_hash`；旧索引没有 hash 时实时计算 SHA-1。最终按该 hash 去重，所以同一张图即使在两个包、两个路径下，本次调用也只会返回一次。文件不可读时直接跳过，不会因为坏行导致整个工具报错。

### 3. 文件可读性

图库里的图片文件可以直接读取，`path` 能直接解析为 `join(packDir, path)`。索引没有原图和缩略图两套字段；市场预览图是图库市场展示资源，不在包内 `memes/` 的发送路径里。QQ 应发送这里索引到的实际图片文件。

插件以 `readOnly: true` 打开每个 `index.db`，只读取图片内容用于必要时的 hash 计算，不写、不移动、不删除图库文件。

## 实现说明

工具签名：

```text
qq_meme({ mood?: string, keyword?: string, count?: number })
  -> { files: string[], caption: string }
```

`files` 是绝对路径。`count` 默认 1，限制在 1 到 3。

选图顺序：

1. 先找关键词命中的图片。关键词在分类、说明、关键词、文件名和目录名里匹配；整串命中优先于拆词命中。
2. 关键词没有命中时，按情绪桶找图。支持 `happy/angry/sad/shy/confused/daily`，也支持开心、生气、无语、害羞、困惑、日常等中文说法。
3. 关键词和情绪都没有命中时，从所有可用图片里随机挑。
4. 需要多张时先取高优先级结果，不足再从后续范围补齐。

同一内容 hash 在 `cooldownSeconds` 内不会重复返回，默认 300 秒。冷却按插件进程全局计算。全部候选都在冷却期时返回空数组和一句说明，不抛出异常。

工具本身不实现 QQ 传输。工具描述明确要求：**发出去请配合 `qq_send_image` 使用**，把返回的 `files` 交给现成的 `qq_send_image`。

## 配置

`cordis.patch.yml` 中可配置：

```yaml
- insert:
  - id: qq-meme-pick
    name: 'qq-meme-pick'
    config:
      packsDir: "~/.dsh/meme-packs"
      cooldownSeconds: 300
      extraPackDirs: []
```

默认 `packsDir` 会使用 `$DSH_HOME/meme-packs`；未设置 `DSH_HOME` 时使用 `~/.dsh/meme-packs`。

## 上线验证

在仓库根目录执行下面这条命令，它会读取真实图库并打印挑到的绝对路径与说明：

```bash
node --input-type=module -e "import { pickMeme } from './plugins/qq-meme-pick/lib/index.js'; console.log(await pickMeme({ mood: 'happy', keyword: '干饭' }))"
```

预期输出形态：

```json
{
  "files": ["/absolute/path/to/meme.jpg"],
  "caption": "捧着蓝碗干饭，星星眼吃得很香"
}
```

拿到路径后，在 QQ 会话中让 agent 调用 `qq_send_image` 并传入该路径即可完成发送。
