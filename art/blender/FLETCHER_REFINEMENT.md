# 弗莱彻级驱逐舰：第一版游戏化模型

> 历史记录（checkpoint 28）。最新船体为 `checkpoint_29_fletcher_hull_refined.blend`，
> 见 `FLETCHER_HULL_REFINEMENT.md`。当前脚本已更新至29版；甲板/炮位高度与兼容性
> 以新文档为准，以下旧版检查不代表新版世界坐标仍与模拟完全一致。

## 当前状态

- 存档：`checkpoint_28_fletcher_blockout.blend`。
- 集合：`ship_us_dd_game`、`ref_us_dd_game`、`preview_us_dd_game`。
- **尚未导出到游戏**，未改模拟数据；主炮仍用共享的 `us5s` 炮塔。

## 本轮做法

沿用与雾岛相同的流程：先控制数据，再按锚点构建，最后用实际网格检查。

- `fletcher_profile.json` / `fletcher_profile.py`：114×12m 船体线型。甲板高度在游戏舷弧关键点上与模拟一致，艏段增加视觉上扬；艏柱后收、圆顺船底、上部外飘。
- `fletcher_refined.py`：舰体、甲板室与三层舰桥、指挥仪、桅杆、两座后倾烟囱、两座五联鱼雷发射管、后部甲板室、探照灯、深弹架与舷边护栏。
- 护栏复用 `game_railings.py`，与其他舰型规格一致。

## 锚点

| 部件 | Z |
|---|---:|
| 舰桥 | 22 |
| 前烟囱 | 8 |
| 后烟囱 | −6 |
| 一号鱼雷管 | 1 |
| 二号鱼雷管 | −17.5 |
| 后部甲板室 | −27 |
| 桅杆 | 17 |

每个部件组在本地坐标构建后**整体平移一次**，避免窗、支撑或护罩留在原处。

## 修复的错误

第一版曾把指挥仪和探照灯按错误参数顺序传给了圆柱函数，实际落到舷外约20～31m处。已修正为中线甲板位置，并增加坐标检查：上层建筑最大横向 **5.4m**，小于甲板半宽 **6.0m**，不再有构件飞出船外。

鱼雷管也从原来几乎不可辨的排列，改为明显的五根管、约32°转向、带基座和带支柱的护罩。

## 检查

- 闭合船体、正体积、无退化面；实际 **114×12m**。
- 5个主炮挂点耳轴与模拟一致。
- 整舰预览 **12,690三角面**（驱逐舰目标2万以内）。
- 视觉复核确认：鱼雷管可辨、舰桥与主炮比例基本协调、烟囱后倾可见、原先的悬空小件消失。剩余为观感项：舰桥相对主炮仍略厚重，个别甲板小件贴边需放大核对。

## 重建

```python
p = r'D:\warship-game\art\blender\fletcher_refined.py'
ns = {'__file__': p}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['build_fletcher']()
ns['review_fletcher']()
ns['save_fletcher']()
```

截图：`qa/fletcher_side.png`、`qa/fletcher_qbow.png`、`qa/fletcher_bridge.png`、`qa/fletcher_blockout_final.png`。

## 下一步

- 按1942年弗莱彻照片核对舰桥细节、40mm/20mm防空位置与鱼雷管朝向。
- 确认尺度后导出 `ships/us_dd_hull.glb` 与更新 `us_dd_super.glb`，接入游戏的日军关卡（敌方弗莱彻）。
- 高雄级与新奥尔良级仍为程序化模型，可后续按同样流程处理。
