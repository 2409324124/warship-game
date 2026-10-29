# 雾岛主炮测距仪与舰岛精修

> 后续用户已认可此版主炮，并要求舰岛加粗、加烟囱间桅杆与防空炮塔座。最新见 `KIRISHIMA_ROBUST_UPPERWORKS.md`、`checkpoint_23_kirishima_robust_upperworks.blend`。下文保留测距仪精修记录。

## 当前结果

- 起点另存：`checkpoint_20_before_optics_and_island.blend`。
- 新存档：`checkpoint_21_kirishima_optics_and_island.blend`。
- 主炮资源 `public/models/guns/jp14d.glb` 已更新；新舰岛仍是独立 Blender 稿，没有覆盖游戏舰岛或模拟。
- 华盛顿与吹雪认可存档保持原样。后续以本说明为当前状态，旧 `KIRISHIMA_1942_PLAN.md` 的阶段数字为历史记录。

## 主炮测距仪

用户指出旧测距仪不正确。本轮取消架在塔顶的外露横管、圆环端头与细支架，改为：

- 横向光学基线收进后部装甲壳内；
- 炮塔后肩两侧的装甲耳台与屋顶相接；
- 两端向前的暗色光学窗口、低矮装甲盖与检修舱盖；
- 不把共享网格称为“四塔历史上完全同型”的准确复原，也不再把外形长度称为实测8米。

同时修复真实几何问题：旧装饰腰带横跨炮口，且前面板延伸到侧部倒角之外。腰带已取消，前面板重新对齐倒角，炮孔保持开通，滑动内盾重做。炮管侧面平滑着色，炮口端面保留硬边。

`jp_refined_guns.py` 中 `validate_jp14d_scene(api)` 对**实际网格**检查：

- 六条射线穿过两炮孔，不碰到装饰腰带或重复前面板；
- 两个光学窗口从前方可见；
- 耳轴、管间距、炮口参考与原输入一致；
- `base` / `barrel` 同级，预算≤2500三角面。

当前每座主炮 **1760三角面**，GLB **88828 bytes**。0°与20°出图检查，不把旧版的阴影判断当作当前净空证明。

## 舰岛

对照改装后的雾岛照片，取消原先从甲板一路收分到顶的实心锥塔，改成：

- 连续的下桥楼与司令塔、带独立窗框的航海舰桥；
- 窄的支撑主体、三脚支撑、层间斜撑；
- 大小、间距、前后位置不完全相同的平台；独立观察室和周围可见空隙；
- 上部装甲化指挥／测距装置、望远镜、探照灯、梯子、横桁及少量索具；
- 后部低矮指挥所与开放式三脚主桅，不再做成第二座实心塔；
- 起重臂集中到后部工作区。

另修复了一个直接影响观感的材质错误：旧构建代码用常量单色材质覆盖了 `Buf` 的 `Col` 顶点色，导致窗孔、甲板、支撑、烟囱帽全变成同一种浅色。现在每个组使用专用的顶点色材质，恢复暗窗、深色甲板、黑色烟囱帽与结构明暗层次。

`kirishima_island_refined.py` 所有部件在本地坐标中建好，再由 `Kit.emit()` **统一平移一次**。现有舰桥平移校验升级为逐顶点检查：锚点向艏移动10米时，每个顶点都必须移动相同距离且高度不漂移，而不只是包围盒相符。

## 面数与边界

| 项目 | 三角面 |
|---|---:|
| 船壳＋甲板 | 5344 |
| 上层建筑及现有甲板设备 | 21428 |
| 四座主炮＋八门共享副炮 | 11504 |
| 当前整舰 Blender 稿 | **38276** |

现有游戏内仍使用旧的 `jp_bb_super.glb`，因此 `model-budget.mjs` 对游戏整舰的数字不同，不能混用。新舰岛没有导出，本轮没有改 `src/sim/`。炮塔转动限制由游戏处理，不再作为建模阻碍。

## 参考范围

- 雾岛1937年第二次改装后侧影：`references/kirishima_1942/1937-05-10_Sukumo_Bay_Kirishima.jpg`。
- 武器与同级早期照片：https://www.navweaps.com/Weapons/WNJAP_14-45_t41.php
- 雾岛早1930年代照片：https://www.navweaps.com/Weapons/WNJAP_14-45_t41_Kirishima_pic.jpg
- 同级榛名1931年照片仅作辅助：https://www.navweaps.com/Weapons/WNJAP_14-45_t41_Haruna_pic.jpg

以上能约束大的层级与轮廓，不能证明每个1942年小件的精确形态。炮廓共享炮架、甲板飞机和部分防空代理不是本轮重建目标，仍保留原稿的简化解释。

## 验收与重建

本轮：28项现有Python检查、37项游戏测试、typecheck、build、17个GLB加载及层级检查通过；模型预算0超限。Blender另检查实际炮口开孔、光学窗口、船壳闭合、12挂点耳轴、逐顶点锚点跟随、顶点色材质连接。

```python
p = r'D:\warship-game\art\blender\warship_build.py'
api = {}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), api)
api['build_turrets'](['jp14d'], force=True)
# 此处只重建；需要更新游戏资源时另调用 api['export_gun']('jp14d')。
p = r'D:\warship-game\art\blender\kirishima_1942_build.py'
ns = {'__file__': p}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['build_kirishima']()
ns['review_kirishima']()
ns['save_kirishima']()
```

截图：`qa/jp14d_optics_final.png`、`qa/jp14d_optics_rear_final.png`、`qa/jp14d_optics_elev20_final.png`、`qa/kirishima_bridge.png`、`qa/kirishima_aft.png`。
