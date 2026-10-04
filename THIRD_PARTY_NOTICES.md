# 第三方组件与素材说明

荒野象棋的程序源码、引擎、模型权重和主题图像具有不同的许可或权利范围。仓库根目录的 `LICENSE` 不替换第三方许可，也不表示整个便携发行包可以按同一条款使用。

## 本项目源码

本项目自行编写的应用程序、规则、混合揭棋搜索、音效合成、分析界面与构建脚本按 **GNU General Public License version 3 only（GPL-3.0-only）** 提供，见 [LICENSE](LICENSE)。除单独标注或第三方内容外，本项目文档采用同一许可。

这一声明不对以下第三方引擎、模型、运行时、角色权利或图像重新授权。贡献者仅应提交自己有权提供的内容。

## Pikafish 引擎

| 项目 | 来源 |
| :-- | :-- |
| 上游项目 | [official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish) |
| 随包版本 | `Pikafish-2026-09-06` |
| 官方发行 | [Pikafish 2026-09-06](https://github.com/official-pikafish/Pikafish/releases/tag/Pikafish-2026-09-06) |
| 原始归档 | `Pikafish.2026-09-06.7z` |
| 对应源码 | [固定版本源码](https://github.com/official-pikafish/Pikafish/tree/Pikafish-2026-09-06) |
| 许可 | GNU GPL version 3，全文见 [Pikafish-GPL-3.0.txt](docs/Pikafish-GPL-3.0.txt) |

本发行使用上游 Windows x86-64 universal 可执行文件，打包时命名为 `pikafish.exe`，未修改引擎算法。`pikafish.nnue` 与该发行匹配。获取脚本记录固定来源与 SHA-256，不以另一版本权重静默替换。

本项目发行页同时提供 `Pikafish-source-2026-09-06.zip`，保存产生该版本引擎的对应上游源码，包括上游作者信息、许可证、构建文件与说明。便携包亦保留引擎许可证。引擎 GPL 范围不等于下面权重文件的许可范围。

Pikafish 继承了 Stockfish 等上游项目的工作，详细作者与致谢见该固定版本的 `AUTHORS`、源码头注释和 README。本项目未将上游引擎称为自行训练的模型。

## Pikafish NNUE 权重

`pikafish.nnue` 受 Pikafish 单独的 NNUE 许可约束。与所用发行保留的许可全文见 [Pikafish-NNUE-License.md](docs/Pikafish-NNUE-License.md)，官方说明见 [official-pikafish/Networks](https://github.com/official-pikafish/Networks)。

该许可要求合法使用，且**未经许可不得商用**。本仓库的 GPL 声明不对该文件及其派生权重重新授权。需要商业使用时，应向权利人确认授权；不能把包含该模型的发行包描述成“所有内容均可自由商用”。

上游针对其他项目发布的权重可能使用不同许可；它们的条款不会自动适用于本包中的 `pikafish.nnue`。

## Electron 与运行时组件

桌面运行环境来自 [Electron](https://www.electronjs.org/)，其源代码采用 [MIT 许可](https://github.com/electron/electron/blob/main/LICENSE)。Electron 还包含 Chromium、Node.js、V8 等各自许可的组件。

便携包在 `runtime/LICENSE` 和 `runtime/LICENSES.chromium.html` 保留 Electron 发行内的原始通知，请同时阅读。具体 Electron 版本由仓库 `package-lock.json` 锁定。构建和测试依赖的许可按各自包说明保留；它们不因此成为本项目原创代码。

## 棋子、图标与主题美术

- `app/assets/characters.png`：14 类红黑棋子与统一暗子背面的图集。
- `app/assets/design-sheet.png`：完整棋子概念图。
- `app/assets/app-icon.png` / `.ico`：应用主题图标。
- `app/assets/generation.txt` 及同目录的图标生成记录：素材生成过程与提示词。

这些图像为使用内置图像生成工具制作的**饥荒风格粉丝设计**，并非从《饥荒》游戏文件中提取的官方素材。部分棋子视觉设计借鉴 Wilson、Wendy、Maxwell、Wickerbottom、Chester、Koalefant 等角色或生物。

《饥荒》/ Don't Starve、相关角色、名称、标识及其知识产权属于 Klei Entertainment 及相应权利人。荒野象棋是独立粉丝项目，**没有 Klei 官方授权、合作或背书的声明**。AI 生成过程不代表取得这些角色的知识产权，本项目也不声称独占图像中的既有角色设计。

图像未被作为可任意再许可、出售或用于商业宣传的独立素材包授权。本项目源码 GPL 许可不授予相关角色权利。若复用或商用主题美术，应自行取得所需权利；也可以为自己的派生程序替换成拥有合适许可的素材。

## 音效

落子、吃子、揭子、将军与终局提示在 `app/audio.mjs` 中通过 Web Audio 在本地合成。本项目没有分发从其他象棋游戏录制或提取的音频文件。

## 规则与研究参考

混合揭棋搜索由本项目实现，未分发官方 Pikafish `jieqi` 分支的二进制，也不以普通 Pikafish 的评级代表其棋力。[Pikafish `jieqi` 分支](https://github.com/official-pikafish/Pikafish/tree/jieqi) 作为实现适配性的研究参考。

普通模式胜 / 和 / 负显示基于所用引擎的原生 `UCI_ShowWDL` 输出，相关上游实现见固定版本的 [uci.cpp](https://github.com/official-pikafish/Pikafish/blob/Pikafish-2026-09-06/src/uci.cpp) 与 [search.cpp](https://github.com/official-pikafish/Pikafish/blob/Pikafish-2026-09-06/src/search.cpp)。混揭指数为本项目启发式估计，不冒称上游模型胜率。
