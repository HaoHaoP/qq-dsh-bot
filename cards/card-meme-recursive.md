# 卡：qq-meme-pick 扫描要下钻到图库包内部

## 现状（实测）

上一版改成自扫目录后，服务器上索引仍为空，图库文件数统计为 1。查结构后确认原因：

```
node_modules/dsh-meme/memes/
  dafeiyu-001/                 ← 包目录，扫描只看到这一层
    manifest.json
    index.db
    memes/
      morning/zaoshanghao.jpg  ← 情绪 = 目录名
      sad/qiurao.jpg
      ...  共 24 张
```

也就是说 `memes/` 下面是**图库包**，真正的图在 `<pack>/memes/<情绪>/<文件>`。当前实现只看一层，把一个目录当成了内容，结果零入库、索引库没建。

## 要求

1. 扫描分两层：
   - 第一层：`<dsh-meme 包根>/memes/` 与 `$DSH_HOME/meme-packs/` 下的**每个子目录**视为一个图库包
   - 第二层：包内 `memes/<情绪>/<文件>` 递归收集图片，**目录名即情绪标签**，文件名（去扩展名）即关键词
2. 兼容没有 `memes/` 子层的包：若包内直接就是 `<情绪>/<文件>` 或平铺图片，也要能收
3. 索引写入 `$DSH_HOME/qq-meme-pick/index.db`，字段含 `path`（唯一）、`pack`、`source`（builtin/user）、`emotion`、`name`、`mtime`
4. 首次调用 `qq_meme` 时若索引为空，自动全量扫一次再挑；`rescan: true` 强制重扫
5. 图片扩展名认 png/jpg/jpeg/gif/webp；其它文件（manifest/index.db 等）跳过

## 硬约束

- 只许改 `plugins/qq-meme-pick/**` 与 `docs/qq-meme-pick.md`
- 不许改 `tools/verify.sh`、其它插件、`docs/requirements.md`、`docs/persona.md`、根 `README.md`、`LICENSE`
- 不许 git 提交；不许引原生模块依赖；只读图库目录

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

单测必须覆盖：三层结构（包/情绪/文件）能收全、平铺结构也能收、空包不报错、
情绪从目录名正确带出、24 张规模下随机与冷却都正常。

## 交付说明里必须写

一条能在服务器上直接跑的验证命令，输出形如 `挑到: /path/to/dafeiyu-001/memes/morning/zaoshanghao.jpg`，
并贴出它实际跑出来的结果。
