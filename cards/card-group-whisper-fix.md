# 卡：修 group-whisper 的挂载时机，让它真生效

## 现状（实测）

插件已装进 profile（`npm install file:` 依赖）、dsh 启动无报错、`dump-config` 里能看到 `group-whisper`，但：

- 群里 @ 一次，`followup from group` 与 `turn/end` 各 1 条（说明入站是通的、agent 回了）
- **group-whisper 零判定日志**
- **状态库根本没被创建**

即：插件被加载了，但它的入站包装从头到尾没被调用过一次。

## 根因假设（要你验证，不要直接照抄）

`dsh-onebot-qq@0.9.6` 构造 `ChatBridge` 时，把实例方法用**箭头闭包装进 inbound 管线**：
`lib/bridge.js:136` 附近 `tryHandleCommand: (...) => this.tryHandleCommand(...)`，
`inbound.js:150` 通过 `this.ctx.tryHandleCommand(...)` 调用那个闭包。
箭头闭包在构造那一刻就固定了，所以事后在 `ChatBridge.prototype` 上打补丁**对这个实例无效**。

本卡要你做的是：验证这个假设，并给出真能生效的接法。

## 实现要求

1. **验证假设**：用假 ChatBridge 复现 —— 构造实例 → 在 prototype 上打补丁 → 调用 inbound 管线 → 看补丁有没有被调用。把结论写进 `docs/group-whisper.md` 新的一节「挂载时机」。
2. **换接法**：任选可行的一种，写明为什么选它：
   - 在实例上包装（拿到实例后替换该实例的属性，而不是 prototype）
   - 用 dsh 的依赖/顺序机制抢在 ChatBridge 构造之前注册
   - 换到别的可订阅面（若发现更合适的事件总线，用它）
3. **配置键对齐**：`waitingTime` / `observationTimeout` / `secretaryDebounceTime` 都是**顶层**键，
   不是 `timing` 下的子键。以 `src/config.ts` 的 `DEFAULT_CONFIG` 为准，把 README 与示例配置改对。
4. **加一个自检**：`tools/self-check.mjs`（放在插件目录内），用假 ChatBridge 跑一遍
   "构造 → 包装 → 触发一次群消息 → 断言产生了判定记录"，机器可判。

## 硬约束

- 只许改 `plugins/group-whisper/**` 与 `docs/group-whisper.md`
- 不许改 `tools/verify.sh`、其它插件、`docs/requirements.md`、`docs/persona.md`、根 `README.md`、`LICENSE`
- 不许 git 提交
- 不许引原生模块依赖
- 示例里的 QQ 号、群号、token 一律占位符

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

新增测试必须覆盖：**实例构造之后再包装，仍能被调用**（就是这次的真实缺陷）。
`tools/self-check.mjs` 要能单独跑通并退出 0。

## 交付说明里必须写

1. 假设成立与否，证据是什么（文件与行号）
2. 最终选的接法，以及为什么它不会被"构造时闭包"这个问题绕过
3. 上线后怎么判它真的在跑：给出**一条具体的观察判据**（例如某个日志字段、某张表的第一行）
