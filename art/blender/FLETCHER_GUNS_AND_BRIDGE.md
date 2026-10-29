# 弗莱彻舰炮与舰岛修型 — checkpoint 30

> 认可原稿阶段记录。现已在31版接入游戏并同步甲板/挂点，见 `GAME_MODELS_FIRE_AND_OCEAN.md`。
> 以下“未接入”仅描述当时状态。

用户要求自行定方案、确认问题并修复。基于29版船体继续，保存为
`checkpoint_30_fletcher_guns_and_bridge.blend`；28、29号文件保留。

## 诊断与方案

修改前截图 `qa/fletcher_upper_before.png`、`qa/fletcher_gun_before.png`：
共享旧单炮为平顶箱体、封闭炮口；舰桥有三条同节奏窗带、桥顶缺有体量的指挥仪；
桅杆天线和烟囱附属结构过简。

以 `references/fletcher/fletcher_1942.jpg` 的早期圆桥总体观感为依据，
构建Mk30单装炮塔、Mk37指挥仪及开放框架雷达的游戏化形象。
不是按原图测绘，不宣称天线或小附件逐件符合1942年某一天的状态。

## 修改

- 五座弗莱彻专用单炮塔：收窄的八面炮壳、倾斜前盾、倒角顶盖、真实炮盾开槽、
  随动弧形盾、根部短套环、127mm炮口和约38cm可见凹深；后门、铰链、瞄准罩和侧百叶。
- 新炮塔只存在 `preview_us_dd_game`，五座共享两份网格，不替换 `gun_us5s` 或其他舰型源炮塔。
- 炮塔原点、耳轴及炮口距离保持原 `us5s` 约定；纵向/横向炮位与29版不变。
  29版视觉甲板与旧模拟不同的兼容边界依旧成立，不能直接当作已接入游戏。
- 舰岛下层改为实体舱室、小舷窗和水密门；上部为收分圆角舱室与前侧驾驶窗，去掉客轮式三层满窗。
- 顶部桥台有实体底板、低挡板、独立栏杆、桥翼斜撑及小型观察设备。
- 桥顶指挥仪有实际承座和舱体、两侧光学端窗、开放框架天线，不再是孤立横管。
- 桅杆有根部支撑、横桁拉撑和小型开放搜索天线；两座烟囱加随倾斜布置的箍圈与管线。

## 自检与修复闭环

1. 首轮visual-qa确认主要形体改善，要求核对炮根拥挤和桥台斜黑块。
2. 扩大随动盾开口，避免粗管根与小横向面几乎接触；加短套环，使接口连续。
3. 炮塔在-5、0、15、30、45度检查炮轴及四周包络射线，固定炮壳不得遮挡。
   同时用BVH检测运动炮管/随动盾与固定炮壳的表面相交，五个角度均通过。
   这不是对舰桥方向所有转角射界的保证，后者仍应由游戏限制。
4. 炮口轴向射线在端面后约38cm命中，外圈射线在端面命中，确认不是黑色封口贴片。
5. 关闭灯光阴影补拍 `fletcher_bridge_connection_check.png`，原炮座后的大三角黑块消失，
   确认是投影而非悬空斜板。桥翼支撑接墙与底板；桅脚落在下层舱室上。
6. 炮壳平面旋转包络检查与甲板舷边保留余量；该检查不等同于所有负仰角的炮管—栏杆净空检查。
7. 保留船壳闭合正体积、五炮座BVH承托和95个护栏脚点检查。
8. 第二轮visual-qa未发现仍需本轮修复的严重形体或连接问题。

单炮塔 **686三角面**；整舰预览 **17,182三角面**，低于20,000目标。
游戏资源、模拟参数和旧ZIP均未更新。

## 代码与复现

`fletcher_upperworks.py`：独立炮塔缓冲、桥岛、桅杆、烟囱细节、炮塔检测及截图。
桥岛和桅杆使用各自局部坐标与一次锚点平移，避免附属物漏移。

```python
p = r'D:\warship-game\art\blender\fletcher_refined.py'
ns = {'__file__': p}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['build_fletcher']()  # 包含几何与炮塔检查
u = {}
q = ns['ROOT'] / 'fletcher_upperworks.py'
exec(compile(q.read_text(encoding='utf-8'), str(q), 'exec'), u)
u['review_upperworks'](ns)
ns['save_fletcher']()
```

## 结果截图

- `qa/fletcher_upper_after.png` — 前部整体近景
- `qa/fletcher_bridge_after.png` — 桥岛细节
- `qa/fletcher_gun_after.png`、`fletcher_gun_front.png` — 炮塔与炮口
- `qa/fletcher_gun_elev45.png` — 正确仰起45度的炮塔
- `qa/fletcher_bridge_connection_check.png` — 无阴影结构诊断
- `qa/fletcher_overall_after.png` — 整舰
