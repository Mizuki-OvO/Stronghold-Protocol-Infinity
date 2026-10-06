# 卫戍协议：盟约 · Stronghold Protocol: Infinity

> **本仓库是 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的改版（fork），不是原作。**
>
> **游戏本体、玩法实现、数据与文档全部来自原作者 → [https://github.com/sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)**
> 请去上游仓库了解游戏本身的玩法介绍、安装说明、联机方式与许可条款。

![version](https://img.shields.io/badge/version-0.2.0--infinity.1-8957e5)
![upstream](https://img.shields.io/badge/upstream-sganggs%2FStronghold--Protocol-blue)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)

| | |
|---|---|
| **原作 / 上游** | [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) — 作者 **sganggs** 与各位贡献者 |
| **本改版** | [Mizuki-OvO/Stronghold-Protocol-Infinity](https://github.com/Mizuki-OvO/Stronghold-Protocol-Infinity)，维护者 **Mizuki-OvO** |
| **改版基线** | 上游 **v0.1.3**（2026-10-04） |
| **本版** | **0.2.0-infinity.1** |
| **许可证** | 与上游相同：**GPL-3.0-or-later**（游戏素材不在许可范围内，见 [NOTICE.md](NOTICE.md)） |

**原作的功劳全部归于原作者。** 本仓库只在其基础上增加功能、修复漏洞，并完整保留了上游的版权声明、[NOTICE.md](NOTICE.md)、[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [LICENSE](LICENSE)。本改版同样**完全非商业**，沿用上游的全部声明与免责条款；素材版权归鹰角网络 / Yostar 所有。

本仓库是《明日方舟》限时玩法「卫戍协议：盟约」（官方英文名 *Stronghold Protocol: Alliance*）非官方同人复刻的改版。**「Infinity」是本改版的名字，不是游戏的名字** —— 游戏本体的介绍、玩法、安装与联机说明请见上游仓库。

---

## 本改版新增/修改了什么

游戏本体的规则没有被改写。完整清单见 [CHANGELOG.md](CHANGELOG.md) 的 **0.2.0-infinity.1**。

### 1. 无尽模式（Endless）

通关第 15 回合「**隐秘核心**」后投票决定是否继续（存活玩家过半同意即进入；AI 队友默认同意；30 秒不答视为放弃）。进入后 **6 个精英波 + 1 个领袖波 = 7 波一循环**，无限重复，回合号从第 16 波起；前 6 波的出怪**按顺序对应原第 8–13 波**（第 1 波 = 原第 8 波，…，第 6 波 = 原第 13 波），且每个循环都是同一套组成。

- **敌人属性复利生长**：第 N 波的敌人 = 官方第 15 波数值 **× 生命 `1.10^(N−15)`、攻击 `1.06^(N−15)`、防御 `1.06^(N−15)`**，**法抗每波 +1**（上限 100）。
- **领袖池合并**：「最终攻势」与「隐秘核心」两个首领池一起抽，权重相加；领袖共享血条按同样倍率放大。
- **每波结算的平衡**（从无尽第 2 波起）：每个**存活**玩家层数最高的盟约 **−15 层**（并列时随机取一个，不足 15 层则不动），并 **+1 点目标生命值**（无上限）。已淘汰的玩家不受影响；取最高层不要求该盟约处于激活状态。
- **商店可升到 7 级**：干员与道具的刷新概率与 6 级**完全一致**（不引入新阶），额外多出 **1 个只出特殊道具的栏位**。6→7 的升级价是 **20 资金**，并且和官方各级一样**每回合降 1 块**（第 2 回合起，降到 0 为止），所以打着打着就会变得买得起。
- **机变阶段延续进循环**：每个 7 波循环里，**第 3 波结束后的下一波**开场有一次机变选卡（落点为第 19、22、25、28… 回合）。卡池沿用官方第 11 回合那套（悬赏决策 / 机密商店 / 战术决策混合 + 4~6 阶道具补给）。
- 结果页记录打到的无尽波数。

### 2. 无尽模式的 6 件特殊道具

商店 7 级的特殊栏位专用，**装备即销毁，加成本局永久**：

| 图标 | 名称 | 效果 | 售价 |
|---|---|---|---|
| ❤️ | 无尽核心 | 装备时销毁，携带者生命值 +3% | 3 |
| ⚡ | 超频芯片 | 装备时销毁，携带者攻击速度 +15 | 3 |
| 🛡️ | 壁垒发生器 | 装备时销毁，携带者防御力 +3% | 3 |
| ✨ | 奥术棱镜 | 装备时销毁，携带者法术抗性 +1 | 3 |
| ⚔️ | 猎手瞄准镜 | 装备时销毁，携带者攻击力 +3% | 3 |
| 📜 | **动员令** | 装备时销毁，**最大可部署人数变为 10** | **10** |

「动员令」是这套的终盘件：**只在可部署人数已达到 9 时才会被刷出来** —— 也就是必须先给干员装上官方道具「人事部文档」（`最大可部署人数变为9`）把上限顶到 9。上限是保底式（只升不降），重复获得不会叠到 11。

同名道具**可叠加**（两份「无尽核心」= 生命 +6%）。

### 3. 本地数值修改器（开发 / 测试工具）

一套**纯本地**的实时改数值面板，用来调难度、复现问题、试玩法。改的是运行中进程的内存覆盖层，**不动任何 `data/*.json`**，也不影响 `node server/index.js` 的常规启动。

```bat
双击  开修改器.bat        :: 游戏服 3100 + 面板 3101（自动打开浏览器）
```

面板可以改：

- **全局数值**：起手生命值 / 金币、商店等级上限与价目表、刷新价格、备战席、上场上限、每卡装备数、每回合收入表。
- **敌人倍率**：按难度 × 回合逐格编辑，或填区间批量应用。
- **无尽模式参数**：成长系数、削层起始波、每波削层数与回血、机变间隔。
- **对局中每个座位**：生命值、金币、商店等级、盟约层数（可只改某一人或全体）。
- **回合控制**：**跳到指定回合**（在回合边界生效 —— 下一个回合变成你填的号，下一波的出怪与倍率按新回合号重算，可前进也可回退；跳到无尽回合会自动开启无尽循环）、**跳过当前阶段**（触发它的倒计时到期）、取消排队。
- **自检**：让服务器用**游戏自己的 `GameData`** 解析一遍数值，直接验证覆盖是否真的进了游戏。

详细用法、实现原理（三个生效层次）、HTTP 接口与已知边界见 **[数值修改器说明.md](数值修改器说明.md)**。

### 4. 打字聊天（多人模式）

官方只有 36 个固定表情；同盟模拟里想真的商量打法并不方便，所以加了**打字聊天**：

- 游戏界面右下角多一个**聊天按钮**（带未读角标），点开是消息列表 + 输入框；按 **`T`** 可以随时开关（**任意阶段**都能用，备战和作战中都能聊）。
- 消息**广播给这一局的所有人**，包括观战者；观战者能看但**不能发言**（服务端按座位判定）。
- **单机（独立模拟）没有聊天** —— 没人可聊，服务端也会拒绝，所以按钮在单人模式里根本不显示。
- 发言者名字由**服务端**从座位状态取，客户端无法冒充别人。
- 文本会**去掉首尾空白、合并连续空格、剔除换行等控制字符**，单条上限 **120 字**。
- 防刷屏：可以**连发 5 条**，之后每 **0.7 秒**一条。
- **断线重连 / 中途加入的观战者**会收到最近 **60 条**的历史消息，不会面对一个空面板。

### 5. 修复的问题

- **无尽循环的领袖波（每循环第 7 波）完全打不了**：`prepEnded()` 只判断了官方的两个领袖回合，无尽领袖波落进普通作战流程，而这套流程用的 `this.wave` 在领袖波是 `null`（出怪在 `bossWaves` 里）—— 场上没有敌人，回合永远结算不掉，直接卡死。另外打完领袖后 `_finishFinal()` 会走「解锁隐秘核心」的分支，把回合号拉回第 15 回合，循环作废。两处都已修。
- **特殊道具的属性加成完全不生效**（两处断点）：`Battle._createAllyFromInput` 从战斗输入构造单位时漏拷了 `statBonus`；补上后仍无效，因为 `installStatBonus` 是在**单位部署之前**调用的，`addBuff` 会拒绝未存活的单位并**静默丢弃**增益，需要 `allowDead: true`。5 件属性道具现在都有实测断言（含叠加与永久性）。
- **特殊道具在客户端没有名称和详情**：这类道具只定义在服务端代码里，而客户端的商店卡片与信息弹窗读的是 `data/items.json`，所以之前只显示一串 id、右键也弹不出内容。新增 `tools/sync-endless-items.mjs` 把规格幂等地镜像进该文件（115 件官方道具一个字节不动），并接入 `npm run build-data`。
- **特殊道具的图标显示成问号**：图标原本是「把 emoji 塞进 SVG data URL 再喂给 `<img>`」，Chrome 对 SVG 内文本的 emoji 渲染不可靠，解码失败后 `<Img>` 的兜底又渲染「名字首字」（取不到就是 `?`）。改成统一的 emoji 文本渲染。
- **无尽敌人防御增长"没生效"**：`defMul` 其实一直在生效，但旧值每波只 +3%（第 6 波才 ×1.19），小到看不出来；而且**法抗压根没做**。现在按上面的新数值重做，并补上了法抗的**每波 +1 点**（`resFlat`，单位侧本来就按「基础 + 平添」再乘倍率算，Battle 侧新增了这条路径，上限 100）。

---

## 怎么运行

**本改版没有自己的整合包，请从源码运行**（上游 Release 里的整合包是原版游戏，不含无尽模式与修改器）：

```bash
git clone https://github.com/Mizuki-OvO/Stronghold-Protocol-Infinity.git
cd Stronghold-Protocol-Infinity
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 270 MB 美术 / 音频（可中断，再次运行会续传）
npm start          # 启动服务器：http://localhost:3000
```

需要 **Node.js 22 或 24**。系统要求、端口与配置、局域网联机、操作说明、测试与项目结构等，全部沿用上游文档（本仓库的 `docs/` 与上游一致；本改版新增的功能只写在上面的章节和 [数值修改器说明.md](数值修改器说明.md) 里）。

想玩原版、看完整的玩法介绍与安装说明 → **[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)**

---

## 许可证与致谢

- **代码**：**GPL-3.0-or-later**，全文见 [LICENSE](LICENSE)；本改版沿用上游相同的许可证，并保留上游全部版权声明。另附 GPL 第 7 条附加许可（允许与 pixi-spine 的 Spine Runtimes 组合分发），见 [NOTICE.md](NOTICE.md)。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据版权归原权利人所有，不适用 GPL。本改版沿用上游的全部使用限制，**仅供学习交流与个人非商业使用，严禁任何形式的盈利**。
- **本改版的基础全部来自上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)**：游戏本体、规则实现、数据管线、文档与测试框架均为上游作者与各位贡献者的成果。请优先给上游点 Star。
- 第三方组件与数据来源的完整清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [NOTICE.md](NOTICE.md)。

---

## English

**Stronghold-Protocol-Infinity** is a modified fork of [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) — the original project; see that repository for the game itself, its gameplay documentation and its licence terms. **All credit for the game belongs to the upstream author and contributors.** This fork only adds features, fixes bugs, and keeps every upstream copyright notice, NOTICE file and licence intact.

**What this fork adds:** an **endless mode** (a vote after clearing the Hidden Core; 6 elite waves + 1 boss per cycle, compounding enemy stats, a merged boss pool, a per-wave bond-layer/LP trade, a level-7 shop with one special-item slot, and a 机变 draft once per cycle), **6 endless consumable items** (five permanent stat bonuses, plus 动员令 which raises the deploy cap to 10 and only appears once the cap is already 9), a **local number modifier** for testing (`开修改器.bat` — a web panel that live-edits a running match without touching `data/*.json`, including a jump-to-round and skip-phase control), and fixes for three bugs (the endless cycle boss being unplayable, the special items' stat bonuses never reaching combat, and the special items having no client-side name or tooltip).

**Run from source** (this fork ships no bundle of its own — the upstream Release bundle is the original game):

```bash
git clone https://github.com/Mizuki-OvO/Stronghold-Protocol-Infinity.git
cd Stronghold-Protocol-Infinity
npm install && npm run setup && npm start     # needs Node.js 22 or 24, then open http://localhost:3000
```

**License:** GPL-3.0-or-later, same as upstream, with the upstream copyright notices kept intact ([LICENSE](LICENSE), [NOTICE.md](NOTICE.md)). Game assets are **not** covered by the GPL and remain © Hypergryph / Yostar; non-commercial use only. Not affiliated with or endorsed by Hypergryph or Yostar.
