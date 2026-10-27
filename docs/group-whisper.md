# group-whisper 规格与探明结论

把 `astrbot_plugin_angel_heart` 2.2.8 的群聊参与机制移植为 dsh 插件：群消息先经过能量、在场状态和冷却门控，再由 `analyzerModel` 决定是否接话；只有决定回复时才向该群已有 Agent 投递一轮主动回合。额度恢复按时间惰性计算，不运行周期计费定时器。

## 探明结论

探明基线是 `dsh-onebot-qq@0.9.6`、`@deepseek-ai/dsh-agent@0.2.1-rc.2` 和 `@deepseek-ai/dsh-session@0.2.1-rc.2`。以下文件行号均指对应 npm 包内的发布文件。

### 1. 非 @ 群消息：没有公开总线，但存在可包装的原始入站方法

结论：**能拿到非 @ 原始群消息，但依赖 `ChatBridge.handleInbound` 兼容包装，不是公开事件总线或 middleware。**

- `dsh-onebot-qq/lib/index.js:311-313` 把 OneBot 连接的唯一入站回调接到
  `bridge.handleInbound(event)`；该 bridge 在 `lib/index.js:327-420` 内局部构造，没有注册成 host service。
- `dsh-onebot-qq/lib/bridge.js:311-340` 的 `handleInbound` 在规范化后调用完整的
  `handleInboundOnce` / `processInbound` 链，因此它位于“只看得到已放行消息”的 mention 门之前。
- `dsh-onebot-qq/lib/inbound.js:119-124` 正是在入站链内部以
  `requireMention` 丢弃非 @ 群消息；只订阅 Agent/session 事件会漏掉这些消息。
- 源码中提到的“共用总线”是 `dsh-onebot-qq/lib/bridge.js:730-739` 的
  `session/event`，也就是 Agent 会话事件；`lib/types/bridge.d.ts:177-185` 也只暴露
  `session/event` 与 `session/flush`。它不是 OneBot 原始入站事件总线，不能用来判断群是否安静。
- 可用的运行面是 `lib/types/bridge.d.ts:348-355` 公开声明的
  `ChatBridge.handleInbound(event, opts?)`；插件通过 `import.meta.resolve('dsh-onebot-qq/package.json')`
  加载 `lib/bridge.js` 并临时包装原型方法，卸载时恢复。`quota-gate` 已用同一包内解析方式完成过兼容补丁，但本机制仍应视为对通道版本的兼容依赖，升级时需要回归。

### 2. 主动发起回合：Agent 有公开的 followup 入口

结论：**可行。门控通过后，在已解析的群 Agent 上调用 `followup` 即可主动开启一轮。**

- `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:176-205` 声明了
  `Agent.send`、`Agent.followup`、`Agent.steer` 和 `Agent.inject`；其中
  `followup` 明确表示“排队一个普通后续回合并唤醒 driver”。
- `dsh-onebot-qq/lib/bridge.js:372-397` 的 `dispatchFollowup` 也使用
  `chat.agent.followup(...)` 投递正常 QQ 用户消息，说明这条回合入口与通道日常回复一致。
- `dsh-onebot-qq/lib/registry.js:149-162` 的 `ensureChat` 会返回或创建该 chat 的
  live Agent；`registry.js:163-263` 在同一创建事务中登记 `chats` 与 `bySession`。

### 3. 复用群会话：ensureChat 返回该群的同一个 Agent

结论：**可行。主动回复接在该群当前 live Agent 的 session 上，不另建空会话。**

- `dsh-onebot-qq/lib/registry.js:198-208` 先从 `group:<groupId>` 派生稳定 session id，
  已有落盘日志时走 resume，而不是新建一个无关 session。
- `dsh-onebot-qq/lib/registry.js:243-263` 将实际 Agent/session 登记进
  `chats` 与 `bySession`，后续 `dispatchFollowup` 直接使用 `chat.agent`。
- `dsh-onebot-qq/lib/bridge.js:730-745` 从 `session.id` 反查 chat，并在
  `turn/start`、`assistant/message`、`turn/end` 上驱动该群出站；因此主动 followup
  产生的 assistant 消息仍由 QQ 通道发送回该群。

## 判定链落点

门控落在**通道入站方法的兼容包装层**：非命令群消息在 `ChatBridge.handleInbound`
进入 Agent 前被旁路记录，安静窗口到期后由插件执行能量/冷却检查和秘书模型判定。
回复动作落在**会话层**：插件调用同一 QQ chat 的 `ensureChat` + `dispatchFollowup`，
让同一个群 Agent 的 session 产生回合；出站仍由通道的 `session/event` 监听器完成。

## 与 angel_heart 2.2.8 的差异

- 不搬 AstrBot 的 ConversationLedger、历史压缩、图片/语音补全、工具/工作账本和工作区接管；dsh 自身保存完整会话，本移植只保存门控所需的短期群消息窗口。
- 不搬旧版 `SUMMONED` / `GETTING_FAMILIAR` 兼容状态和 AstrBot 事件扣押 Future；只保留离场/在场两态及消息驱动的防抖。
- 不搬“秘书异常时放行主脑”的兜底。本卡要求模型判定不通过时静默，因此分析器异常也按 `no_reply` 收口，避免误刷屏。
- 不搬复读/热聊的离场一次性应答。本卡明确“离场态只认点名”；`leaveReply` 的三个参考值保留在配置中，其中热聊阈值参与在场巡检的活跃度判断，冷却值约束同一话题的普通主动发言。
- 不搬跨重启在场状态。进程启动时所有群都从离场开始；能量值持久化，门控窗口、在场状态和话题冷却只在当前进程内有效。
- 不直接调用 QQ 发送 API。所有发言都经过群 Agent 的 session，因而保留该群上下文和通道既有出站管线。

## 频率调节

- 群里从最后一条消息到开始巡检的主等待时间：`waitingTime`。
- 巡检前的最小去抖时间：`secretaryDebounceTime`；实际生效值是二者中较大的等待约束。
- 在场持续时间：`observationTimeout`；超时后收到下一条消息即回离场。
- 普通主动发言频率：提高 `energy.baseReplyCost` / `energy.replyCostPerCharacter`，或提高 `leaveReply.familiarityCooldownDuration`。
- 恢复速度：`energy.recoveryPerSecond`；每群初始值与上下界分别是
  `energy.initialEnergy`、`energy.minEnergy`、`energy.maxEnergy`。
- 活跃度门槛：`leaveReply.denseConversationThreshold`；默认 `1` 表示在场窗口有一条新消息即可进入巡检。
