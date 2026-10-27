# 卡：实现 dsh quota-gate 插件

## 目标

在 `plugins/quota-gate/` 下实现一个 dsh 插件：按群与按人的日 token 预算闸门，超预算的消息不进模型。开源，MIT。

## 必读

- 规格（含配置、命令、验收）：`/Users/haohaop/Documents/Personal/qq-dsh-bot/docs/quota-gate.md`
- 人格与权限背景：`/Users/haohaop/Documents/Personal/qq-dsh-bot/docs/persona.md`
- dsh 本体的类型定义：`/Users/haohaop/.nvm/versions/node/v22.20.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
  （重点看 `dsh-llm`、`dsh-session`、`dsh-tools`、`dsh-agent` 的 `.d.ts`）
- 通道插件源码：先 `npm pack dsh-onebot-qq` 解到 `/tmp` 再读 `package/lib/*.js`（0.9.6）
- 宿主版本 0.2.1-rc.2，Node 22.20.0

## 第一步：探明挂载面（硬前置，没结论不许写实现）

规格里给了三条候选。按 A→B→C 顺序验证可行性，选第一条真正跑得通的，把结论写进
`docs/quota-gate.md` 末尾新增的「探明结论」小节，写清：选了哪条、凭什么、另两条为什么不行（带文件名与行号）。

判据：

- A 通道前闸：dsh-onebot-qq 有没有对外可注册的入站中间件 / seam（源码里 `interceptBusyTurn` 之类）
- B 模型中间件：能不能包住 `@deepseek-ai/dsh-llm` 的调用点，并在回包拿到 usage（prompt/completion/cached tokens）
- C OneBot 反代：一定能做，但拿不到 token，只作兜底

## 实现要求

- 语言 TypeScript，编译到 `lib/`，包名 `quota-gate`，入口按 dsh 插件约定（参考 dsh-onebot-qq 的 `cordis.patch.yml` 与 `apply(ctx, config)`）
- 存储用 Node 22 内置 `node:sqlite`（无原生依赖、无 npm 原生编译）；若运行时不可用，退化为 JSON 文件并打日志说明
- 记账字段与表结构照规格；日期按 Asia/Shanghai 切日，00:00 重置
- 超限行为两种：`silent` / `notify-once`，文案可配，默认沿用规格里那句原文
- 命令 `/quota`、`/quota top`、`/quota reset`，权限按规格
- 不得引入任何原生模块依赖；除 dsh 的 peer 外尽量零运行时依赖

## 硬约束

- 只允许改 `plugins/quota-gate/**` 与 `docs/quota-gate.md`（只追加「探明结论」小节）
- 不许改 `docs/requirements.md`、`docs/persona.md`、`README.md`、`LICENSE`
- 不许 `npm install` 任何会编译原生扩展的包
- 不许提交到 git（主智能体负责提交）
- 示例配置里的 QQ 号、群号、token 一律占位符（`ADMIN_UIN` / `GROUP_ID` / `<onebot-token>`）
- 仓库根 `LICENSE` 是 MIT，插件目录不要再放别的许可证

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

要求：

- `plugins/quota-gate/package.json` 存在
- `node --test tests/` 全绿，且至少覆盖：正常记账、触顶拦截、跨日重置、notify-once 只提示一次、/quota 数值与库一致
- 单测不许连真实 QQ、不许读真实配置文件、不许写仓库外路径（用 `os.tmpdir()`）

## 交付说明里必须写

1. 选了哪条挂载面，依据是哪个文件的哪几行
2. 记账用的是哪个事件/返回值的 usage 字段名
3. 跨日重置怎么测的
4. 有没有未覆盖的边界（例如流式回包中断时 usage 拿不到）
