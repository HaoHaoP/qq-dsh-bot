# 卡：把表情包接进 QQ

## 现状（实测）

`dsh-meme` 装好并加载了，但它的 `send_meme` 只对 **Web 会话** 生效：

```
[dsh-expression] send_meme 已注册(Web通道,/dsh-memes)
```

QQ 群的图必须走 `dsh-onebot-qq` 的 `qq_send_image`（路径或 URL，≤9 张）。两个工具之间没有接线，所以群里说"发张表情包"什么都不会发生。

图库是现成的：`~/.dsh/meme-packs`（内置大肥鱼图库 24 张），索引在 Node 内置 SQLite 里。

## 目标

写一个薄插件 `plugins/qq-meme-pick/`，提供工具 `qq_meme`：**按情绪/关键词从图库里挑一张，返回本地绝对路径与说明**，然后由 agent 用现成的 `qq_send_image` 发出去。

不重复实现传输 —— 传输用 dsh-onebot-qq 现成的工具，本插件只解决"挑哪张、文件在哪"。

## 第一步：探明（硬前置）

1. `~/.dsh/meme-packs` 的目录结构与索引库表结构（找 dsh-meme 的 schema，或直接读它的 sqlite 表）；把表名与关键列写进 `docs/qq-meme-pick.md`
2. 同一张图在多图库时的去重口径（按文件路径还是按 hash）
3. 文件是否直接可读（有些图库可能存的是原图 + 缩略图两套）

探不明就停下报告，不许猜表名。

## 实现要求

- TypeScript，编译到 `lib/`，包名 `qq-meme-pick`，`apply(ctx, config)` 形态（照同仓 `plugins/quota-gate`）
- 工具签名：`qq_meme({ mood?: string, keyword?: string, count?: number })`
  - 返回 `{ files: string[], caption: string }`，`files` 是**绝对路径**，`count` 默认 1、上限 3
  - 挑不到时返回空数组 + 一句`caption`说明，不要报错抛栈
- 匹配优先级：关键词命中 → 情绪命中 → 随机；同一张图在冷却期内不重复返回（冷却默认 300 秒，可配）
- 只读图库，**不许写、不许移动** `~/.dsh/meme-packs` 里的任何文件
- 工具描述里明确写"发出去请配合 qq_send_image 使用"

## 硬约束

- 只许新增 `plugins/qq-meme-pick/**` 与 `docs/qq-meme-pick.md`
- 不许改其它插件、`tools/verify.sh`、`docs/requirements.md`、`docs/persona.md`、根 `README.md`、`LICENSE`
- 不许 git 提交；不许引原生模块依赖
- 示例里不出现真实 QQ 号/群号/路径用户名

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

单测必须覆盖：关键词命中、情绪命中、都未命中时随机兜底、冷却期内不重复、图库为空时返回空数组不抛错。
测试用 `os.tmpdir()` 造假图库，不碰真实 `~/.dsh/meme-packs`。

## 交付说明里必须写

1. 索引库的表结构（实际读到什么，不是推测）
2. 挑图优先级怎么定的
3. 上线后怎么验：给一条具体命令，能打印出它挑到的文件路径
