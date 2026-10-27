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

任一图库目录不存在时直接跳过，不报错。扫描递归接受
`.jpg/.jpeg/.png/.gif/.webp`，只读取图库里的文件，不写入、移动或删除图库。

## 索引

插件用 `node:sqlite` 自建索引，不读取 dsh-meme 的包内 `index.db`。
索引表至少包含：

| 字段 | 说明 |
| --- | --- |
| `path` | 图片绝对路径，主键，保证唯一 |
| `source` | `builtin` 或 `user` |
| `name` | 由文件名生成的展示名 |
| `keywords` | 目录、文件名、情绪规则命中的可搜索词 |
| `indexed_at` | 本次写入的毫秒时间戳 |

另外保存 `mtime_ms`、`size_bytes`、内容 `hash` 和推断出的 `moods`。首次运行
全量扫描。后续调用会发现新文件，并用 `mtime_ms + size_bytes` 判断是否更新；
未变化文件不重算 hash。`rescan: true` 忽略增量判断，完整重算所有当前文件。
已从目录删除的文件会从插件索引中移除。相同内容 hash 只保留一条候选，避免
同一张图因为位于两个目录而被重复发送。

## 情绪与关键词推断

每条图片的推断输入是相对所属图库根目录的路径和去掉扩展名后的文件名。路径
按非字母、非数字字符切词并转小写。例如
`pack-a/happy/hug_friend.png` 会产生 `happy`、`hug`、`friend` 等关键词。

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
node --input-type=module -e "import { pickMeme } from './plugins/qq-meme-pick/lib/index.js'; const r = pickMeme({ mood: 'happy', rescan: true }); console.log(r.files.join('\n')); if (r.files.length === 0) { console.error(r.caption); process.exitCode = 1 }"
```

完整验收：

```bash
bash tools/verify.sh
```
