# 战舰建模交付包 — 弗莱彻已认可版

用户认可：“特别好 这个驱逐舰也做的很好”。归档批次：2026-10-26_fletcher_approved。

## 先打开这些文件
- 最新认可弗莱彻：art/blender/checkpoint_30_fletcher_guns_and_bridge.blend
- 弗莱彻说明：art/blender/FLETCHER_GUNS_AND_BRIDGE.md
- 华盛顿/北卡罗来纳级游戏版：art/blender/checkpoint_27_washington_game_bow_and_rails.blend
- 雾岛游戏版：art/blender/checkpoint_25_kirishima_game_ready.blend
- 吹雪精修预览：art/blender/checkpoint_17_fubuki_refined.blend
- 总体说明：art/blender/README.md

## 范围
- 全部30个阶段blend存档，包括原六舰、炮塔和历次修型阶段。
- Blender重建脚本、控制JSON、测试、阶段文档、参考照片和现有QA截图。
- public/models：当前游戏使用的19份GLB及manifest。
- src、test、tools及项目基础配置：对应的游戏集成源码快照，方便追溯挂点和导出约定。
- INVENTORY.json：逐文件大小和SHA-256；目录外的SHA256SUMS.txt提供整包校验值。

## 重要状态
- 弗莱彻30版与吹雪17版仍为精修预览，未替换当前游戏中的旧驱逐舰GLB。
- 弗莱彻视觉甲板高度不同于旧模拟；接入时必须处理炮位、耳轴和炮口坐标，不能只换船壳。
- 弗莱彻约17,182三角面，单炮686；已完成炮口和五个仰角几何检查，用户已认可。
- 华盛顿和雾岛已接入游戏；华盛顿副炮错列布局仍是草稿，没有同步模拟。
- 高雄和新奥尔良保留此前版本，本批次未重新精修。
- 不覆盖、不移动原文件，也不覆盖旧warship_model_bundle.zip。
- 不收录旧ZIP、blend1自动备份、缓存、node_modules、.git或本机鉴权配置。

## 使用
解压后保留warship_models目录结构，用Blender打开上述blend即可查看。
重建脚本中存在原工作区D:\warship-game的绝对路径；更换目录后需先调整ROOT/输出路径，
不要直接运行旧脚本覆盖其他项目的文件。源码快照用于留档，不含node_modules，
重新运行游戏需要自行安装依赖。本交付包不是宣称所有历史草稿均为最终成品。
