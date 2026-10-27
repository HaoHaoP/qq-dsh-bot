# qq-meme-pick

## 设计边界

`qq-meme-pick` 不依赖 dsh-meme 的数据库，只读它的 `memes/` 目录。内置图库
目录通过 Node 包解析定位：

```ts
import.meta.resolve('dsh-meme/package.json')
```

取该 URL 的包根后拼接 `memes/`，不硬编码 `node_modules/dsh-meme` 路径。
用户图库和插件索引都跟随 `DSH_HOME`：

| 用途 | 实际路径 |
| --- | --- |
| 内置图库（只读） | `<dsh-meme 包根>/memes/` |
| 用户图库（只读） | `$DSH_HOME/meme-packs/`，缺省 `~/.dsh/meme-packs/` |
| 本插件索引（读写） | `$DSH_HOME/qq-meme-pick/index.db`，缺省 `~/.dsh/qq-meme-pick/index.db` |

两个图库路径都是“包根目录”，不是直接放图片的目录。根目录下每个一级子目录
视为一个图库包。例如内置包的实际结构是：

```text
<dsh-meme 包根>/memes/
  dafeiyu-001/
    manifest.json
    index.db
    memes/
      morning/zaoshanghao.jpg
      sad/qiurao.jpg
```

扫描时先发现 `dafeiyu-001` 这个包，再优先进入包内的 `memes/` 收集图片。兼容
没有这一层的旧包：

```text
legacy-pack/
  angry/shengqi.jpg       # 直接是 <情绪>/<文件>
flat-pack/
  hello.webp              # 平铺图片
```

包内图片递归接受 `.png/.jpg/.jpeg/.gif/.webp`；`manifest.json`、`index.db`
等其它文件跳过。任一图库目录或空包不存在可用图片时直接跳过，不报错。扫描
只读取图库里的文件，不写入、移动或删除图库。

## 索引

插件用 `node:sqlite` 自建索引，不读取 dsh-meme 的包内 `index.db`。
索引表至少包含：

| 字段 | 说明 |
| --- | --- |
| `path` | 图片绝对路径，主键，保证唯一 |
| `pack` | 一级包目录名，例如 `dafeiyu-001` |
| `source` | `builtin` 或 `user` |
| `emotion` | 包内容根下的情绪目录名；平铺图片为空字符串 |
| `name` | 由文件名生成的展示名 |
| `keywords` | 目录、文件名、情绪规则命中的可搜索词 |
| `mtime` | 文件修改时间（毫秒） |
| `indexed_at` | 本次写入的毫秒时间戳 |

另外保存 `mtime_ms`、`size_bytes`、内容 `hash` 和推断出的 `moods`。首次调用
`qq_meme` 且索引为空时自动全量扫描一次；后续调用直接复用索引。
`rescan: true` 强制重扫全部当前文件，并重新计算内容 hash。已从目录删除的
文件会从插件索引中移除。相同内容 hash 只保留一条候选，避免同一张图因为
位于两个目录而被重复发送。旧版索引会自动补齐 `pack`、`emotion`、`mtime`
字段并重建一次。

## 情绪与关键词推断

每条图片的推断输入包含包名、包内相对路径和去掉扩展名后的文件名。路径按
非字母、非数字字符切词并转小写。例如
`dafeiyu-001/memes/morning/zaoshanghao.jpg` 会产生 `dafeiyu`、`001`、
`morning`、`zaoshanghao` 等关键词。情绪目录取包内容根下的第一级目录名，
因此上例的 `emotion` 是 `morning`，平铺包的 `emotion` 是空字符串。

情绪按以下规则从路径与文件名推断：

| 情绪 | 目录名/文件名命中示例 |
| --- | --- |
| `happy` | `happy`, `joy`, `smile`, `laugh`, `meow`, `开心`, `高兴`, `笑`, `好耶` |
| `angry` | `angry`, `rage`, `mad`, `生气`, `愤怒`, `恼火`, `气鼓鼓` |
| `sad` | `sad`, `cry`, `sigh`, `难过`, `伤心`, `哭`, `委屈`, `无语` |
| `shy` | `shy`, `blush`, `害羞`, `脸红` |
| `confused` | `confused`, `surprised`, `question`, `困惑`, `疑惑`, `惊讶`, `震惊` |
| `daily` | `daily`, `sleep`, `morning`, `work`, `ganfan`, `日常`, `睡觉`, `上班`, `摸鱼`, `干饭` |

英文词按完整切词匹配，中文按子串匹配。匹配到某个情绪后会同时写入该情绪的
常用关键词，所以用户用中文情绪词也能选到英文目录中的图片。

## 选图顺序

工具签名：

```text
qq_meme({
  mood?: string,
  keyword?: string,
  count?: number,
  rescan?: boolean
}) -> { files: string[], caption: string }
```

`count` 默认 1，限制在 1 到 3；`rescan` 默认 `false`。候选按以下优先级选择：

1. 关键词命中目录名、文件名、推断关键词以及情绪别名。
2. 关键词未命中时，按情绪命中推断结果。
3. 两者都未命中时，从全部可用图片随机挑。
4. 多张时先选高优先级范围，不足再从后续范围补齐。

同一内容 hash 在 `cooldownSeconds` 内不会再次返回，默认 300 秒。冷却按插件
进程内记录；全部候选都在冷却期时返回空数组和说明，不抛异常。

工具只返回绝对路径，不负责 QQ 传输。把 `files` 原样交给 `qq_send_image`。

## 配置

`cordis.patch.yml` 默认无需配置。需要覆盖用户目录时可写：

```yaml
- insert:
  - id: qq-meme-pick
    name: 'qq-meme-pick'
    config:
      packsDir: "~/.dsh/meme-packs"
      cooldownSeconds: 300
```

`builtinDir` 是测试或特殊部署使用的内置目录覆盖项；正常部署使用包解析结果。

## 服务器验证

在仓库根目录执行下面这条命令。它会强制重扫、挑一张，并打印挑到文件的绝对路径；
没有可用图片时以非零状态退出：

```bash
node --input-type=module -e "import { pickMeme } from './plugins/qq-meme-pick/lib/index.js'; const r = pickMeme({ rescan: true }); if (r.files.length === 0) { console.error(r.caption); process.exit(1) } for (const file of r.files) console.log('挑到: ' + file)"
```

完整验收：

```bash
bash tools/verify.sh
```
