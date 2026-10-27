# 卡：quota-gate 拆开「能执行命令」与「免预算」

## 背景

第一版把 `admins` 当成完全豁免：`evaluate()` 里 `allowedByAdmin` 为真就直接放行，连记账都不挡。这在实际部署里是错的 —— 群主是群里说话最多的人，豁免等于闸门只挡别人，预算数字也失真。

现状代码：`plugins/quota-gate/src/core.ts` 的 `evaluate()`（约 110-145 行），`store.ts` 的 `totalOf()`。

## 要改成什么

职责拆成两件互不相干的事：

| 概念 | 配置键 | 含义 |
| --- | --- | --- |
| 权限 | `admins` | 只决定谁能执行 `/quota reset`、`/quota top`。不再影响预算判定 |
| 免预算 | `budgetExempt`（新增，默认空数组） | 谁的消息完全不计费、不拦截。默认没人 |

硬要求：

- `admins` 里的人**照样受群日与单人日预算约束**，超了就被拦、被记 notice
- `budgetExempt` 里的人跳过记账与拦截（这是给「测试号」或「机器人自己」留的口子，默认空）
- 两者互不影响，也不许有隐含的交集逻辑
- 老的 `admins` 语义变更要在 README 里写明，并升 minor 版本号

## 顺带验证一件事

第一版给 `/quota` 系列命令加了一层「窄兼容补丁」，去桥接 `dsh-onebot-qq` 的内部 `ChatBridge`。这条路径**从未在真实 dsh 上验证过**。

本卡要求：在 `docs/quota-gate.md` 的「探明结论」后面补一节「命令通路验证」，写清三选一：

1. 真机验通了（贴命令与回执关键行，脱敏）
2. 验不通，并说明卡在哪（例如 `import.meta.resolve` 在宿主里解析不到，或 ChatBridge 的构造参数不对）
3. 决定删掉这层补丁，改成只提供 `/quota` 的只读 HTTP 端点或干脆只留日志

不许含糊带过。验不通就把该补丁降级为「默认关闭」并在 README 标注未验证。

## 硬约束

- 只许改 `plugins/quota-gate/**` 与 `docs/quota-gate.md`
- 不许改 `docs/requirements.md`、`docs/persona.md`、`README.md`（仓库根那份）、`LICENSE`
- 不许 git 提交
- 不许引原生模块；不许 `npm install` 会编译原生扩展的包
- 真实 QQ 号、群号、token 一律占位符

## 验收

`bash /Users/haohaop/Documents/Personal/qq-dsh-bot/tools/verify.sh`

新增用例必须覆盖：

- admin 在预算耗尽时**被拦**（不再豁免）
- admin 仍能执行 `/quota reset`
- `budgetExempt` 里的人不被拦、不计费
- 两者都为空时行为与第一版一致（除 admin 豁免被移除）

## 交付说明里必须写

1. admin 豁免是怎么拆的（文件与行号）
2. 命令通路的验证结论属于上面三选一的哪一种
3. 版本号改成了多少，README 里怎么描述的
