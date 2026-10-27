# quota-gate

按群和按人统计 dsh 模型调用的真实 token usage，并在下一次模型调用前拦截超预算消息。

当前版本：`0.2.0`。

数据默认写入 `$DSH_HOME/quota-gate/usage.db`；若当前 Node 运行时没有 `node:sqlite`，自动降级为同目录的 `usage.json` 并输出警告。所有日期按配置时区切日，默认 `Asia/Shanghai` 的 `00:00`。

闸门与记账只依赖 `@deepseek-ai/dsh-llm` 的 `llm/stream` waterfall。由于
`dsh-onebot-qq@0.9.6` 没有公开命令扩展口，本包会探测并包装其固定命令路由，
尝试让 `/quota*` 在 QQ 中可用；该兼容补丁随插件卸载自动还原，不影响普通消息闸门。
它尚未在真实 QQ 通路验证，因此 `onebotCommandBridge` 默认关闭。

## 版本与兼容

`0.2.0` 变更了 `admins` 的语义：旧版的 `admins` 同时拥有管理命令权限和预算豁免，
新版只决定谁可执行 `/quota top` 与 `/quota reset`，不再豁免预算。管理员用量的记账、
群日限制与单人日限制都和普通成员相同。

需要完全不计费、不拦截的测试号或机器人账号，请显式配置 `budgetExempt`；默认不豁免任何人。

## 配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `groupDaily` | `2000000` | 每群每日 token 上限；`0` 关闭群限额 |
| `userDaily` | `300000` | 每人每群每日 token 上限；`0` 关闭个人限额 |
| `resetAt` | `"00:00"` | 本地切日时间，默认时区为上海 |
| `timezone` | `"Asia/Shanghai"` | IANA 时区 |
| `groups` | `[]` | 启用计量的群；空数组表示全部 QQ 群 |
| `overLimit` | `"notify-once"` | `silent` 或 `notify-once` |
| `notifyText` | 见下方 | 超限文案；支持 `{used}`、`{limit}`、`{resetAt}` |
| `admins` | `[]` | 可执行 `/quota top` 与 `/quota reset` 的 QQ 号；仍受全部预算限制 |
| `budgetExempt` | `[]` | 完全不计费、不拦截的 QQ 号；不影响命令权限 |
| `onebotCommandBridge` | `false` | 是否启用未验证的 `dsh-onebot-qq` 命令兼容补丁 |

示例：

```yaml
- id: quota-gate
  name: 'quota-gate'
  config:
    groupDaily: 2000000
    userDaily: 300000
    resetAt: "00:00"
    timezone: Asia/Shanghai
    groups: ["GROUP_ID"]
    overLimit: notify-once
    notifyText: "哼，今天不聊了，尾鳍没力气了。明天再来找我。（{used}/{limit}，{resetAt} 恢复）"
    admins: ["ADMIN_UIN"]
    budgetExempt: []
    onebotCommandBridge: false
```

## 命令

| 命令 | 权限 | 行为 |
| --- | --- | --- |
| `/quota` | 所有人 | 查看本群和本人当日用量、剩余与重置时间 |
| `/quota top` | 管理员 | 查看本群当日消耗前五 |
| `/quota reset` | 管理员 | 清空本群当日用量并立即恢复 |

QQ 内的 `/quota*` 路由依赖默认关闭且尚未真机验证的 `onebotCommandBridge`；宿主命令服务中注册的 `/quota` 不受该开关影响。

## 验收

```bash
bash tools/verify.sh
```

本目录单测也可直接运行：

```bash
cd plugins/quota-gate
node --test tests/
```

## 记账口径

`@deepseek-ai/dsh-llm` 的 `TokenUsage.inputTokens` 不含缓存命中；本插件把
`cacheReadTokens` 单独写入 `cached_tokens`，把 `cacheWriteTokens` 并入
`prompt_tokens`，因此三项之和等于该次调用的完整输入输出 token。只有拿到真实
`usage` 的调用才增加 `requests`。

许可证沿用仓库根目录的 MIT License，本包不重复放置许可证文件。
