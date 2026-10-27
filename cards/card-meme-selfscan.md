# 卡：qq-meme-pick 改成自扫目录，不再读 dsh-meme 的私有索引

## 现状（实测）

部署后群里/私聊说"发张表情包"没反应，查下来不是接线问题，是**图库索引为空**：

- `~/.dsh/meme-packs` 不存在（`dsh-meme` 的 `packsDir` 要靠它的面板触发扫描才建）
- `~/.dsh` 下没有任何 meme/expression 的 sqlite 库
- 内置 24 张图实际在包内：`node_modules/dsh-meme/memes/`（4.4MB）
- `qq-meme-pick` 现在读的是 `dsh-meme` 的私有表 `memes(path, tag, ...)`，表不存在 → 永远返回空数组

根因是设计上的耦合：**挑图工具不该依赖另一个插件的私有索引**。前两次踩的坑（quota 桥命令的模块解析、group-whisper 的挂载时机）都是同一类病根 —— 寄在别人不保证稳定的内部结构上。

## 目标

`qq-meme-pick` 自己扫目录、自己建索引，只依赖文件系统。

## 要求

1. **扫描两个目录**，任一不存在就跳过、不报错：
   - 内置：`node_modules/dsh-meme/memes/`（用 `import.meta.resolve('dsh-meme/package.json')` 定位包根，别再硬编码路径）
   - 用户图库：`$DSH_HOME/meme-packs/`（DSH_HOME 缺省 `~/.dsh`）
2. **自建索引**：`$DSH_HOME/qq-meme-pick/index.db`，`node:sqlite`，表结构自定但必须含
   `path`（唯一）、`source`（builtin/user）、`name`、`keywords`、`indexed_at`。
   首次运行全量扫，之后按 `mtime` 增量。
3. **挑图优先级不变**：关键词 → 情绪（从目录名/文件名推断，规则写进文档）→ 随机；同图冷却 300 秒。
4. **删掉对 dsh-meme 索引表的读取**，README 与 docs 里写清"本插件不依赖 dsh-meme 的数据库，只读它的 memes/ 目录"。
5. 新增工具参数 `rescan: boolean`，为真时重扫一遍再挑；默认 false。

## 硬约束

- 只许改 `plugins/qq-meme-pick/**` 与 `docs/qq-meme-pick.md`
- 不许改 `tools/verify.sh`、其它插件、`docs/requirements.md`、`docs/persona.md`、根 `README.md`、`LICENSE`
- 不许 git 提交；不许引原生模块依赖
- 只读图库目录，不许写、不许移动里面的文件
- 示例与测试路径里不出现真实用户名

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

单测必须覆盖：两个目录都存在时都扫到、只有一个存在时正常工作、两个都空时返回空数组不抛错、
增量扫描（新增文件后 `rescan` 能捞到）、冷却期内不重复。

## 交付说明里必须写

1. 扫描与索引的实际路径
2. 情绪/关键词是怎么从目录名与文件名推断的
3. 一条能在服务器上直接跑的验证命令，输出它挑到的文件绝对路径
