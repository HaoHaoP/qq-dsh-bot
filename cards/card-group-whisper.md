# 卡：把 angel_heart 的群聊门控移植成 dsh 插件 group-whisper

## 目标

在 `plugins/group-whisper/` 实现一个 dsh 插件：**消息驱动的主动发言门控**。群消息进来先判「现在该不该说话」，通过了才让 agent 回一轮；额度靠能量值与冷却控制，不靠定时器。

这是 AstrBot 的 `astrbot_plugin_angel_heart` 2.2.8 的行为移植。原实现为 Python，本卡用 TypeScript 重写，不搬代码只搬机制。

## 参考参数（现役真实配置，照抄作默认值）

```
waiting_time            6.0      # 群里安静几秒后开始巡检
secretary_debounce_time 6.0      # 巡检判定去抖
observation_timeout     90       # 观察窗口
energy.initial_energy   100.0
energy.max_energy       100.0
energy.min_energy       -100.0
energy.recovery_per_second 0.8   # 每秒回能
energy.base_reply_cost  9.0      # 一次回复的基础消耗
energy.reply_cost_per_character 0.12
leave_reply.echo_detection_threshold 3
leave_reply.dense_conversation_threshold 1
leave_reply.familiarity_cooldown_duration 1800
```

行为链（原实现的日志顺序，照它抄）：

1. **巡检**：群里安静到 `waiting_time` 后触发，输出 `mode`（mention / ordinary）与 `action`（process / skip），带 `energy`、`recovered`、`cooldown` 三个判据
2. **秘书决策**：再问一次模型该不该开口，输出 `action=reply|no_reply` 与 `reason`
3. **回复结算**：`mode`、字数、`cost`、`energy 前→后`，字数按 `base_reply_cost + 字数 × reply_cost_per_character` 扣
4. **在场/离场**：离场态只认点名，在场态才巡检；重启回到离场
5. **冷却**：同一话题反复开口要受 `familiarity_cooldown_duration` 约束

## 第一步：探明三件事（硬前置，没结论不写实现）

写进 `docs/group-whisper.md` 的「探明结论」小节，每条带文件名与行号：

1. **能不能收到非 @ 的群消息**：`dsh-onebot-qq@0.9.6` 只把 @ 的消息交给 agent，但要判「群里安不安静」必须看到全部消息。查它有没有对外事件总线/middleware 能订阅原始入站（源码里 `pipeline-hooks.md #20` 提到过一条共用总线）。
2. **能不能主动发起一个回合**：通过门控后要能让 agent 在群里说一句。查 `sessions`、`agents`、`tools` 服务里有没有可编程触发的手段。
3. **能不能让这次发言走群会话上下文**：主动开口必须接在该群的会话上，不能另开一个空会话。

任一条不成立，就在文档里写清卡点并**停下来报告**，不要用模拟数据糊过去。

## 实现要求

- TypeScript，编译到 `lib/`，包名 `group-whisper`，`apply(ctx, config)` 形态（参考同仓 `plugins/quota-gate` 已跑通的写法）
- 状态存 `node:sqlite`（Node 22 内置），表：`energy(chat_id, value, updated_at)`、`turn(chat_id, at, mode, action, reason, chars, cost)`
- 所有阈值走配置，默认值照上面那张表；`enabled: false` 时完全不介入
- 判定用模型时走 `analyzerModel` 配置（默认 `deepseek-flash`），**不通过就静默**，不刷屏
- 每条判定都打一行结构化日志，字段名与上面行为链一致，便于和旧日志对比

## 硬约束

- 只许改 `plugins/group-whisper/**` 与新增 `docs/group-whisper.md`
- 不许改其它插件、`tools/verify.sh`、`docs/requirements.md`、`docs/persona.md`、仓库根 `README.md`、`LICENSE`
- 不许 git 提交
- LICENSE 用 MIT（仓库根已有一份，插件目录不再放别的许可证）
- 示例配置里的 QQ 号、群号、token 一律占位符
- 不引原生模块依赖

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`（该脚本现在会自动遍历 `plugins/*/` 跑各自测试）

单测必须覆盖：

- 能量扣减与按秒回能，边界在 `min_energy` / `max_energy` 截断
- 冷却期内不重复开口
- 离场态只响应点名
- `enabled: false` 时零介入
- 判定被拒（no_reply）时不产生任何出站

## 交付说明里必须写

1. 三个探明项的结论，各自的文件与行号
2. 判定链落在哪一层（通道事件 / 会话 / 工具）
3. 与 angel_heart 的差异清单（哪些机制没搬、为什么）
4. 频率怎么调、调哪个键
