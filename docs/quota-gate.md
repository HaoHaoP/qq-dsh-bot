# quota-gate 规格

按群与按人的日 token 预算闸门。开源，MIT。

## 目标

一条消息进来时先判定预算，超了就不进模型；记账发生在回复完成后，用模型回包的真实 usage。判定允许一轮滞后。

## 挂载面待探明

三条候选，按优先级试，谁先跑通用谁。这一步是硬前置，没探明不写代码。

| 候选 | 做法 | 判据 |
| --- | --- | --- |
| A 通道前闸 | 在 dsh-onebot-qq 分发入站前拦一层 | 插件是否暴露可注册的入站 middleware 或 seam（源码里已有 interceptBusyTurn 这类缝） |
| B 模型中间件 | 包住 @deepseek-ai/dsh-llm，计数并拒绝超预算调用 | dsh-llm 的调用点是否可被插件包装，且能拿到 usage |
| C OneBot 代理 | quota-gate 自己当反代，超预算直接不回 | 一定能做，但拿不到 token，只能按条数或估算，精度差 |

探明产物：一份 `docs/seam.md`，写清选哪条、为什么、以及被否决两条的具体原因。

## 数据

单文件 SQLite，位于 `$DSH_HOME/quota-gate/usage.db`。

```
usage(day, group_id, user_id, prompt_tokens, completion_tokens, cached_tokens, requests, updated_at)
PRIMARY KEY (day, group_id, user_id)
```

## 配置

```yaml
- id: quota-gate
  name: 'quota-gate'
  config:
    groupDaily: 2000000
    userDaily: 300000
    resetAt: "00:00"
    timezone: Asia/Shanghai
    groups: ["GROUP_ID"]
    overLimit: notify-once        # silent | notify-once
    notifyText: "哼，今天不聊了，尾鳍没力气了。明天再来找我。（{used}/{limit}，{resetAt} 恢复）"
    admins: ["ADMIN_UIN"]
```

阈值与文案沿用现役 astrbot 配置，不新造。

## 命令

| 命令 | 权限 | 行为 |
| --- | --- | --- |
| /quota | 所有人 | 本群与本人当日用量、剩余、重置时间 |
| /quota top | 管理员 | 当日消耗前五 |
| /quota reset | 管理员 | 清当日，立即恢复 |

## 验收

- 固定 prompt 打满群预算，之后不再产生模型调用（用 usage 表与 dsh 会话日志双向核对）
- 次日 00:00 自动恢复，不依赖重启
- /quota 输出与库内数字一致
- cache 命中的输入 token 单独计数，与回包 usage 对得上
- 关闭插件后行为回到无闸门，不留残留状态

## 开源要求

- LICENSE MIT，仓库根一份
- README 含：一句话定位、配置表、命令表、验收脚本用法
- 示例配置里 QQ 号、群号、token 全部占位符
- 附一个 `tools/verify.sh`，用假数据跑通判定与跨日重置

## 探明结论

选择 **B 模型中间件**。

依据：`@deepseek-ai/dsh-llm` 的 `lib/types/index.d.ts:32-45` 公开声明了
`llm/stream` waterfall，说明它包住每一次流式模型调用，可用 `next()` 放行或
直接产出分片；`lib/types/index.js:949-956` 的实际分发确实经过
`ctx.waterfall(this, 'llm/stream', options, ...)`。请求在
`lib/types/types.d.ts:506-547` 中带有 `messages` 与 `sessionId`，响应流在
`lib/types/types.d.ts:426-464` 中先发出 `usage` chunk、再发出终止 `finish`；
`TokenUsage` 在 `lib/types/types.d.ts:152-173` 明确给出互不重叠的
`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`。因此
B 既能在调用 adapter 前拦截，又能从真实回包取得 prompt、completion 与 cache
计数。

A 不可行：`dsh-onebot-qq@0.9.6` 的 `lib/inbound.js:196-208` 会调用
`ctx.interceptBusyTurn`，但该 `ctx` 不是插件上下文；`lib/bridge.js:126-144`
显示它是 `ChatBridge` 构造时写死的内部回调，`lib/bridge.js:598-631` 也只是
类上的私有流程。插件入口 `lib/index.js:327-420` 局部构造 `ChatBridge` 后只启动
生命周期，没有把 bridge 或 middleware 注册成 host service/event，故其他插件
没有可注册的入站 seam。其命令表同样是包内固定的
`lib/commands.js:13-37` 与 `lib/commands.js:118-145`，不能作为公开扩展面。

C 只作兜底：自建 OneBot 反代可以拦截消息，但 NapCat 的 OneBot 事件与回执不含
模型 token usage；要得到 prompt/completion/cache 就只能再做估算或旁路，达不到
本规格“真实 usage 对得上”的硬验收。它还会把已稳定的通道连接拆成自维护代理，
因此不作为本轮主方案。
