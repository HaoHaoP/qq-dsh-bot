# 需求文档

项目 QQ 机器人迁移，代号 fuguang。把现役 AstrBot 换成 dsh，协议端沿用 NapCat，保留人格与限额，其余能力分期补回。

| 项 | 值 |
| --- | --- |
| 文档版本 | V0.2 草案 |
| 状态 | 待逐行确认 |
| 目标读者 | 开发 Agent、复核人 |
| 修订 | V0.1 首次成文；V0.2 协议端定为 NapCat、dsh 升到 0.2.1-rc.2、补内存门禁 |

约定 必须为强制，应为推荐，可为可选。P0 是本期必须，P1 次期，P2 后续。

## 现状

所有数字来自本机对 ECS `<ECS_IP>` 的只读巡检，2026-10-27。

| 项 | 实测 |
| --- | --- |
| 实例 | ecs.e-c1m1.large 2 核 2G，40G ESSD Entry，Ubuntu 22.04.5，到期 2027-10-21 |
| 内存 | 总 1736 MB，已用 968 MB，可用 584 MB，swap 2047 MB |
| 磁盘 | 40G 用 16G，41% |
| 容器 | astrbot Up 2 天，占用 383 MB；napcat `Exited (137)` 已 2 天，未重启 |
| 数据 | /opt/qqbot 共 722 MB，其中 QQ 客户端 447 MB、astrbot 275 MB、napcat 44 KB |
| Node | 未安装 |
| 现役组件 | token_controller 0.6.6、angel_heart 2.2.8、meme_gallery 0.1.0、tmemory |
| 本机 dsh | 已从 0.1.5-rc.1 升级到 0.2.1-rc.2，web 可正常启动 |

NapCat 停在 2 天前，137 是 SIGKILL，OOMKilled 标记为 false、宿主 dmesg 无记录，成因未确认。可用余量 584 MB 的事实成立。

## 关键决策

| 编号 | 决策 | 依据 |
| --- | --- | --- |
| D1 | 协议端用 NapCat，SnowLuma 降为备选 | 用户拍板。SnowLuma 是 ptrace 注入真 Linux QQ 加 Xvfb 与 noVNC，比 NapCat 重；同类 2C4G 部署被 QQ 长尾写 I/O 打爆；且没有 macOS 包。NapCat 现役、镜像与数据都在盘上 |
| D2 | 智能体换 dsh，不用 AstrBot | 统一到 dsh 生态，后续要用的记忆、表情包、B 站插件都在 dsh 侧 |
| D3 | 通道插件用 dsh-onebot-qq 0.9.6 | peer 区间覆盖 `>=0.2.0-rc.1 <0.3.0-0`，兼容 dsh 0.2.1-rc.2；纯桥接，自带 qq_send_image 与 qq_group_history |
| D4 | 保留人格与限额，其余能力分期 | 用户决定；主动插话在 dsh 侧无等价物，表情包与记忆有现成插件 |
| D5 | 限额自研薄插件，挂在通道层 | cost-meter 是看账不是闸门，事后告警挡不住烧穿 |
| D6 | 自研插件全部开源 | 用户决定；LICENSE 用 MIT（2026-10-27 拍板，覆盖此前草案里的 AGPL-3.0） |
| D7 | 人格加浮光鲸设定 | 见 docs/persona.md，名字来自 2026-10-26 凌晨群内命名事件 |
| D8 | dsh 升级到 0.2.1-rc.2 | 本机原为 0.1.5-rc.1，已升级并验证插件树正常启动 |
| D9 | 部署走云上原地，先过内存门禁再动手 | 用户拍板。NapCat 与数据都在盘上，dsh 实测常驻 270 MB，两者相加必须留余量 |

## 架构

```
QQ 客户端(Linux) ← NapCat 注入 → OneBot v11 → dsh 宿主 → dsh-onebot-qq → agent
                                              ├ quota-gate 自研插件
                                              └ P1 记忆 / P2 表情包、B站
```

OneBot 只绑 127.0.0.1，公网不暴露；运维面板按需临时放行，用完即撤。

## 部署方案

已定云上原地，不做升配（除非内存门禁不过）。

内存是唯一硬门禁。实测摆在一起：

| 项 | 数值 | 来源 |
| --- | --- | --- |
| 宿主总内存 | 1736 MB | free -m |
| 系统与 Docker 基线 | 约 585 MB | 当前已用 968 MB 减去 astrbot 383 MB |
| dsh 常驻 | 270 MB | 本机 dsh web 实测 RSS，macOS，含 web UI |
| NapCat 峰值 | 未知 | 上次在 584 MB 余量下被杀，Exited 137 |

上线顺序必须先进门禁再装：

1. 只起 NapCat，等 QQ 稳定在线 10 分钟，记 `docker stats` 峰值
2. 峰值加 585 MB 超过 1300 MB，停下，不装 dsh
3. 通过则装 Node 22 与 dsh，只起 headless host，再记一次总量
4. 总量稳定在 1500 MB 以下并留 200 MB 余量，才继续接通 OneBot

任一步不达标就升配，不要靠 swap 硬扛。判错的症状很具体：装完当晚 SSH 变卡、`free` 里 available 掉到两位数，那是 OOM 前兆，不是网络问题。

## 范围

### P0 本期

- NapCat 登录小号并在 OneBot 层暴露 v11
- dsh 宿主 + dsh-onebot-qq 接通，能收发群消息
- 人格切换到浮光鲸，表达质量不低于现役
- quota-gate 自研插件：群日预算、单人日预算、超限不回话、/quota 查用量
- 群聊记录查询：qq_group_history
- 云上数据备份与 AstrBot 下线，保留回滚能力

### P1 次期

- 记忆：memory-eternal 或 sage-mem（纯 Markdown，无 DB 无 worker）
- 主动插话：优先评估 dsh-channel-qq 的事件书机制，不自己另写一套判定

### P2 后续

- 表情包：dsh-meme 的图库能力 + agent 自主发图工具
- 刷 B 站：dsh-bili-scroll
- 语音：edge-tts 或 dsh-tts，QQ 语音需过 silk 转码

### 明确不做

- 不保留 AstrBot 的任何运行时依赖
- 不启用 QQ 官方机器人身份（dsh-qqbot 那条线本期不碰）
- 不做多平台（微信、飞书）接入

## 功能需求

### 通道

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| FR-C01 | NapCat 登录指定小号，保持在线，掉线可自恢复 | P0 | OneBot get_status 返回 online true |
| FR-C02 | OneBot v11 暴露给 dsh，access token 校验 | P0 | 错误 token 被拒 |
| FR-C03 | 群消息收发，含文本、图片、引用、@ | P0 | 群内 @ 有回 |
| FR-C04 | 发送图片与表情包（工具面） | P0 | agent 可主动发图 |
| FR-C05 | 查询群聊记录 | P0 | 能按关键词拉出历史消息 |
| FR-C06 | 私聊与群聊分离会话 | P0 | 同一人两个场景互不串台 |

### 人格

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| FR-P01 | 系统提示装载浮光鲸设定，覆盖现役 persona_v3 全部约束 | P0 | 逐条对照 docs/persona.md 的禁忌项 |
| FR-P02 | 自称规则、被问到才说身份、不列清单、不复述问题 | P0 | 抽样 20 条回复无违反 |
| FR-P03 | 称呼兼容：老群友叫大肥鱼也认 | P0 | 被叫大肥鱼有正常回应 |

### 限额

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| FR-Q01 | 按群统计当日 token，跨日 00:00 Asia/Shanghai 重置 | P0 | 日期回拨测试 |
| FR-Q02 | 群日预算与单人日预算双阈值 | P0 | 触顶后不再调用模型 |
| FR-Q03 | 超限行为可配：静默不回 / 固定提示一次 | P0 | 配置切换生效 |
| FR-Q04 | /quota 返回本群与本人当日用量与剩余 | P0 | 数值与库一致 |
| FR-Q05 | 管理员可 /quota reset 清当日 | P0 | 清后立即可用 |
| FR-Q06 | 记账含 cache 命中的输入 token，分开统计 | P0 | 与模型回包 usage 对得上 |

### 运维

| 编号 | 需求 | 优先级 | 验收 |
| --- | --- | --- | --- |
| FR-O01 | 一键启动栈，重启后状态可复现 | P0 | 整机重启后自动恢复 |
| FR-O02 | 日志轮转，单文件上限 20MB 保留 3 份 | P0 | 磁盘不再增长 |
| FR-O03 | 健康检查：QQ 在线、OneBot 通、agent 可用 | P0 | 一条命令出三个状态 |
| FR-O04 | 备份与回滚脚本 | P0 | 见备份章节 |

## 自研插件 quota-gate

定位 挂在通道层的闸门，不做模型侧代理。

数据 单文件 SQLite，表 usage 字段：day、group_id、user_id、prompt_tokens、completion_tokens、cached_tokens、requests、updated_at。索引 (day, group_id)。

判定 消息进入时先查当日累计，超阈值直接走「超限策略」分支，不进 agent。记账发生在上一轮回复完成后，读模型回包的 usage，因此判定用上一轮的真实数，存在一轮滞后，可接受。

配置

```
limits:
  groupDaily: 2000000
  userDaily: 300000
  resetAt: "00:00"
  timezone: Asia/Shanghai
  groups: [GROUP_ID]
  overLimit: notify-once
  notifyText: "哼，今天不聊了，尾鳍没力气了。明天再来找我。（{used}/{limit}，{resetAt} 恢复）"
bypass:
  admins: [ADMIN_UIN]
```

取值全部照抄现役，已从备份里的 `astrbot_plugin_token_controller_config.json` 逐项核对：群 GROUP_ID 日 200 万、单人日 30 万、00:00 重置、超限 `stop_llm` 且连唤醒词一起挡、超限文案逐字沿用（原文带 `{used}/{limit}` 与 `{refresh_time}` 占位）。改动只有一处：astrbot 用固定文案，这里改成可配。

命令 /quota、/quota reset（限管理员）、/quota top（当日消耗前五）

验收 用固定 prompt 打满预算，第 N 条之后不再产生模型调用；次日 00:00 自动恢复；库内数字与 dsh 侧 usage 对得上。

未验证 dsh 是否把每轮 usage 暴露给插件。若无，退路是读 dsh-cost-meter 同源数据，或包一层 LLM 客户端自记。此项在 P0 第一步就要探明，探明前不排工期。

## 非功能

| 编号 | 项 | 要求 |
| --- | --- | --- |
| NFR-01 | 内存 | 整栈常驻不超过 1.5 GB，且留 200 MB 余量 |
| NFR-02 | 磁盘 IO | 日志轮转 + 降日志等级，避免长尾小写入打爆系统盘 |
| NFR-03 | 安全 | OneBot 只绑 127.0.0.1；安全组只放行必要端口，临时放行用完即撤 |
| NFR-04 | 凭据 | access token 一律环境变量或本机文件，不入库不入仓 |
| NFR-05 | 隐私 | 公开仓与文档中 QQ 号、群号、服务器 IP 全部占位化 |
| NFR-06 | 可回滚 | AstrBot 镜像与配置保留 7 天，回滚时间不超过 30 分钟 |

## 备份与迁移

备份对象与处置

| 对象 | 大小 | 是否备份 | 理由 |
| --- | --- | --- | --- |
| astrbot config、persona*、plugin_data | 数百 KB 到数 MB | 备份 | 人格、限额参数、记忆库，迁移唯一真源 |
| data_v4.db | 数十 MB | 备份 | 对话历史，可查旧账 |
| meme 预览缓存 | 约 80 MB | 不备份 | 会自建 |
| QQ 客户端数据 447 MB | 447 MB | 不备份 | 含登录态，迁移后由 NapCat 自己重建 |
| 容器镜像 | 数 GB | 不备份 | 拉得回来 |

取回方式 云助手单次回体约 16KB，722 MB 不可能走它。做法是服务器上打包 tar.gz 后起一次性 HTTP 服务，安全组临时放行高位端口，本机 curl 取回，取完立刻撤规则。备选是传 OSS 再下载。

迁移顺序 备份并取回 → 内存门禁第一步量 NapCat 峰值 → 装 Node 与 dsh → 接通 OneBot → 切人格与限额 → AstrBot 停容器保留镜像 → 7 天无问题后清理。

## 验收标准

- 群内 @ 机器人 3 秒内出首字
- 抽样 20 轮对话，人格禁忌项零违反
- 连续 24 小时不掉线；模拟断网 1 分钟后自动重连
- 限额：打满后不再产生模型调用，次日自动恢复
- 备份 tar 能在干净机器上解出人格与限额配置
- 公开仓无真实 QQ 号、群号、IP、token

## 开源计划

| 项 | 内容 |
| --- | --- |
| 仓库 | 单仓多包，插件各自独立目录，可单独发 npm |
| 首个包 | quota-gate |
| 许可证 | MIT |
| 脱敏 | 占位符在代码里全部走配置读取，禁止硬编码 |
| 文档 | 每个包一份 README，含配置表与验收脚本 |

## 未决项

| 编号 | 问题 | 我的推荐 |
| --- | --- | --- |
| Q1 | 备份取回走临时 HTTP 端口还是 OSS | 临时端口，用完即撤，不引入外部依赖 |
| Q2 | 门禁期间 astrbot 要不要先停掉，释放 383 MB | 停。它现在连不上 QQ，纯空转；停掉后 NapCat 可用余量从 881 MB 涨到 1264 MB，门禁更容易过，回滚不受影响（镜像与数据都在） |
| Q3 | 群聊记录查询是否要跨协议端保留旧历史 | 要，旧数据从 data_v4.db 导出后单独存一份 |
| Q4 | 已解决：容器废弃，裸机 NapCat 在跑 | 容器 2026-10-24 起就没起来过，实际是 /app/napcat 裸机 + Xvfb 直跑，本次迁移沿用 |

## 未验证项

- dsh 插件能否拿到每轮 usage，决定 quota-gate 的记账方式
- NapCat 在本机的真实内存峰值，这是门禁第一步
- dsh 在 Linux x64 的 RSS 是否与 macOS 的 270 MB 一致
- AstrBot 日志里那 14 条浮光相关记录之外，是否还有更早的命名讨论残留在 data_v4.db

## 上线记录

2026-10-27 当天完成 P0 主干迁移，全部为实测。

| 项 | 结果 |
| --- | --- |
| 协议端 | 裸机 /app/napcat + Xvfb :1，QQ BOT_UIN，systemd 单元 napcat.service 已写 |
| 智能体 | dsh 0.2.1-rc.2，profile qqbot，systemd 单元 dsh-qqbot.service 已启用并在跑 |
| 通道 | dsh-onebot-qq 0.9.6，reverse 127.0.0.1:6199，NapCat 拨入，dsh 重启后能自己重连 |
| 人格 | 骨架写进 system-prompt.personaPrefix（主人 + 禁忌），演化层用 dsh-soul-md 0.10.3 的人设卡 |
| 审计 | /root/qqbot-audit 每日 04:00 git 快照，提交前剔掉 accessToken 行 |
| 内存 | 迁移后 used 820 / available 722，dsh 约 230 MB，比 astrbot 的 383 MB 省 150 MB |
| 回滚 | docker start astrbot 即可回到旧栈，但 6199 同时只能被一方占用，回滚前先停 dsh-qqbot |

踩到并解决的三件事：docker 里的 napcat 容器绑不上 6099（被裸机 qq 占着）；napcat 只在启动时拨一次 WS，端口死久了就不再重试；dsh 的 npm 装插件要加 --legacy-peer-deps，否则会在 @deepseek-ai/schemastery 的 peer 范围上卡住。

限额与命令通路（2026-10-27 补记，全部实测）

| 项 | 结果 |
| --- | --- |
| quota-gate 0.2.0 | 已部署到 /root/.dsh/profiles/qqbot/node_modules/quota-gate，按包名挂载 |
| 记账 | usage 表实测一行：群 GROUP_ID 当日非缓存输入 212、输出 68、缓存读 14336，1 次请求 |
| 预算判定 | 用三者之和，缓存读不会被漏掉（store.totalOf） |
| 拦截 | 把群日预算临时压到 10000 后发消息：usage 不增、quota_notice 记一条、群里只收到提示文案 |
| 提示文案 | 「哼，今天不聊了，没有大米饭了」，notify-once 只发一次 |
| 权限口径 | admins 只解锁 /quota top|reset，不豁免预算；/quota 本体任何人可用（用户选定） |
| 命令通路 | 真机通了。曾因插件装在 profile 之外的绝对路径导致 import.meta.resolve 失败，改按包名挂载后恢复 |
| 日志位置 | 切到 systemd 后 dsh 的日志走 journalctl -u dsh-qqbot，/root/dsh-qqbot.log 是 nohup 时代的遗物 |
| 服务守护 | napcat.service 与 dsh-qqbot.service 均已 enabled + active；NapCat 重启后 quick login 直接进，未再扫码 |
