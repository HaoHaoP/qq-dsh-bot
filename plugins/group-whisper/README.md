# group-whisper

消息驱动的 dsh 群聊主动发言门控。群消息先在插件内记录并等待安静窗口，再按在场状态、能量和同话题冷却判断；通过 `analyzerModel` 判定后才让该群已有 Agent 回一轮。

当前版本：`0.1.0`。许可证沿用仓库根目录的 MIT License，本包不重复放置许可证文件。

## 行为

1. 每个群启动时处于离场；普通消息只进入短期观察窗口，点名消息可以进入在场。
2. 在场后，最后一条消息安静达到 `waitingTime` / `secretaryDebounceTime` 的较大值时开始巡检。
3. 巡检输出 `mode=mention|ordinary`、`action=process|skip`，以及 `energy`、`recovered`、`cooldown` 判据。
4. `analyzerModel` 输出 `action=reply|no_reply` 与 `reason`；模型失败或输出无效时静默。
5. 只有 `reply` 才向 `group:<群号>` 的同一个 live Agent 投递主动回合。
6. 回合结束后按最终 assistant 文本结算：`cost = baseReplyCost + 字数 × replyCostPerCharacter`，并把结果写进 SQLite。
7. `observationTimeout` 到期后，下一条消息让该群回到离场；进程重启时所有群也从离场开始。

`enabled: false` 时不解析通道、不打开数据库、不注册事件，也不安装任何包装。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `groups` | `[]` | 生效群；空数组表示全部 QQ 群 |
| `waitingTime` | `6` | 群里安静多少秒后开始巡检 |
| `secretaryDebounceTime` | `6` | 巡检前的最小去抖秒数 |
| `observationTimeout` | `90` | 在场观察窗口秒数 |
| `analyzerModel` | `"deepseek-flash"` | 秘书判定使用的模型 |
| `energy.initialEnergy` | `100` | 每群首次创建时的能量 |
| `energy.maxEnergy` | `100` | 回能上限 |
| `energy.minEnergy` | `-100` | 扣能下限 |
| `energy.recoveryPerSecond` | `0.8` | 每秒惰性回能 |
| `energy.baseReplyCost` | `9` | 每次回复基础消耗 |
| `energy.replyCostPerCharacter` | `0.12` | 每字额外消耗 |
| `leaveReply.echoDetectionThreshold` | `3` | 同文复读达到该次数视为活跃信号 |
| `leaveReply.denseConversationThreshold` | `1` | 观察窗口内达到该消息数视为热聊 |
| `leaveReply.familiarityCooldownDuration` | `1800` | 同话题普通主动发言冷却秒数 |

示例配置：

```yaml
- id: group-whisper
  name: 'group-whisper'
  config:
    enabled: true
    groups: ["GROUP_ID"]
    waitingTime: 6
    secretaryDebounceTime: 6
    observationTimeout: 90
    analyzerModel: deepseek-flash
    energy:
      initialEnergy: 100
      maxEnergy: 100
      minEnergy: -100
      recoveryPerSecond: 0.8
      baseReplyCost: 9
      replyCostPerCharacter: 0.12
    leaveReply:
      echoDetectionThreshold: 3
      denseConversationThreshold: 1
      familiarityCooldownDuration: 1800
```

示例只使用占位群号，不包含真实 QQ 号或 token。

## 数据

默认 SQLite 文件为 `$DSH_HOME/group-whisper/state.db`；未设置 `DSH_HOME` 时使用 `~/.dsh/group-whisper/state.db`。

```sql
energy(chat_id, value, updated_at)
turn(chat_id, at, mode, action, reason, chars, cost)
```

能量按时间差惰性恢复，不靠周期 tick 回能。

## 通道兼容

`dsh-onebot-qq@0.9.6` 没有公开的原始入站事件总线，且会在 `requireMention` 门丢弃非 @ 消息。本插件通过包内解析加载 `ChatBridge`，临时包装其公开声明的 `handleInbound` 方法，并在卸载时恢复。具体源码证据和判定链见 [docs/group-whisper.md](../../docs/group-whisper.md)。

升级 `dsh-onebot-qq` 后必须重新检查这层兼容包装。

## 调频

- 更慢：提高 `waitingTime`、`secretaryDebounceTime`、`energy.baseReplyCost` 或 `leaveReply.familiarityCooldownDuration`。
- 更快：降低上述等待/冷却，或提高 `energy.recoveryPerSecond`。
- 更少主动接话：提高 `energy.replyCostPerCharacter`，降低 `energy.initialEnergy` / `energy.maxEnergy`。

## 验收

```bash
cd plugins/group-whisper
npm test
```

仓库级验收：

```bash
bash tools/verify.sh
```
