# group-whisper 规格与探明结论

把 `astrbot_plugin_angel_heart` 2.2.8 的群聊参与机制移植为 dsh 插件：群消息先经过能量、在场状态和冷却门控，再由 `analyzerModel` 决定是否接话；只有决定回复时才向该群已有 Agent 投递一轮主动回合。额度恢复按时间惰性计算，不运行周期计费定时器。

## 探明结论

探明基线是 `dsh-onebot-qq@0.9.6`、`@deepseek-ai/dsh-agent@0.2.1-rc.2` 和 `@deepseek-ai/dsh-session@0.2.1-rc.2`。以下文件行号均指对应 npm 包内的发布文件。

### 1. 非 @ 群消息：没有公开总线，但存在可包装的原始入站方法

结论：**能拿到非 @ 原始群消息，但依赖包内 `InboundPipeline.processInbound` 兼容接入，不是公开事件总线或 middleware。**

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
  加载包内模块并安装兼容入口，卸载时恢复。最终入口不在 `handleInbound`，而是在桥每次动态调用的
  `InboundPipeline.processInbound`；原因和构造后再包装的验证见下文「挂载时机」。本机制仍应视为对通道版本的兼容依赖，升级时需要回归。

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

## 挂载时机

### 假设核验：箭头闭包没有固定 `tryHandleCommand` 的方法目标

`dsh-onebot-qq@0.9.6` 的 `lib/bridge.js:126-144` 在构造 `InboundPipeline` 时，确实传入了
`tryHandleCommand: (...) => this.tryHandleCommand(...)` 这个箭头闭包（`:136`）；入站管线再在
`lib/inbound.js:150` 通过 `this.ctx.tryHandleCommand(...)` 调用它。

但箭头捕获的是桥实例 `this`，不是调用发生时的具体方法函数。闭包体内的
`this.tryHandleCommand` 仍会在每次调用时沿实例、prototype 重新查找。因此“实例构造后修改
`ChatBridge.prototype.tryHandleCommand` 一定无效”这个结论不成立。

单元测试用一个同样形状的假桥核验：先构造实例，此时管线保存
`tryHandleCommand: (...args) => this.tryHandleCommand(...args)`；随后替换
`FakeChatBridge.prototype.tryHandleCommand`，再触发一次入站管线。替换后的方法实际被调用一次。
如果构造器改为先保存函数值（例如 `const target = this.tryHandleCommand`）再闭包调用，才会与上述
现象一致；当前 0.9.6 源码不是这种写法。

所以本卡给出的箭头闭包链路可以证明“**捕获函数值**的补丁会失效”，但不能单独解释线上
`group-whisper` 对 `handleInbound` 的包装为何零调用。后者还可能来自插件解析到与正在运行的
通道不同的模块副本，或包装根本没有执行到注册点；仅凭零日志无法区分。新实现因此不再依赖这个
无法由伪桥单独证实的因果推断，并新增启动日志
`[group-whisper] inbound hook mounted on InboundPipeline.processInbound` 来区分“未挂载”和“已挂载但无消息命中”。

### 最终接法：在动态分派的 `InboundPipeline.processInbound` 上安装入口

桥的 `lib/bridge.js:369-371` 每次都以 `this.inbound.processInbound(inbound)` 动态调用当前
管线实例的方法；`lib/inbound.js:94` 才是处理统一入站对象的实际入口。它位于
`lib/inbound.js:119-124` 的 `requireMention` 丢弃逻辑之前，适合记录所有群消息。

插件在包内解析 `lib/inbound.js`，先改 `InboundPipeline.prototype.processInbound` 作为发现入口；第一条
消息到达时用 `this` 拿到**已经构造完成**的管线实例，在该实例上安装 own-property 包装。之后桥继续
动态读取同一个实例属性，因此不会再受构造时回调快照影响。包装先让插件记录群消息；命令、私聊和
调试注入事件则调用原方法放行。卸载时同时删除实例包装并恢复 prototype。

这条路径比直接猜 `ChatBridge` 实例更可控：0.9.6 的 bridge 在
`lib/index.js:327-420` 内由局部变量构造并立即启动，没有注册成宿主 service，插件拿不到公开实例；
而 `processInbound` 是桥在**每条事件发生时**读取的动态方法。测试覆盖了“先构造假桥，再安装包装，
再触发群消息”，并断言消息仍进入包装、原始入站方法未被调用。

配置的等待键保持顶层：

```yaml
config:
  waitingTime: 6
  secretaryDebounceTime: 6
  observationTimeout: 90
```

不要把这三项写成 `timing.waitingTime`、`timing.secretaryDebounceTime` 或
`timing.observationTimeout`；`src/config.ts` 的 `DEFAULT_CONFIG` 与 `normalizeConfig` 只读取顶层键。

### 上线判据

重启后，在配置允许的群里 @ 机器人一次，无需等模型回答，日志应立即出现一行：

```json
{"plugin":"group-whisper","stage":"presence","chat_id":"group:<群号>","state":"present","reason":"mentioned"}
```

看到 `stage=presence` 且 `reason=mentioned` 就说明入站包装真的执行并进入了门控；若仍只有通道的
`followup from group` / `turn/end` 而没有这一行，说明运行中的 dsh-onebot 与插件解析到的不是同一模块副本，
或新版本尚未加载，而不是模型或能量判定问题。安静窗口结束后还应出现
`stage=patrol`、`mode=mention` 的判定行。

## 判定链落点

门控落在**通道动态分派的管线入口包装层**：非命令群消息在 `InboundPipeline.processInbound`
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
