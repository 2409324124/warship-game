# 雾岛：炮廓优化、游戏替换与主炮45°上限

> 后续护栏已更新为更清晰的全周实体护栏，最新资源成本与两舰共用存档见 `WASHINGTON_GAME_HULL_AND_RAILS.md`；炮廓、主炮和角度设定沿用本轮。

## 当前版本

- 本轮起点备份：`checkpoint_24_before_game_integration.blend`。
- 当前建模存档：`checkpoint_25_kirishima_game_ready.blend`。
- 用户认可的主炮测距仪与炮管网格不变；本轮精修152mm炮廓炮，正式替换游戏中的雾岛视觉模型。
- 原认可存档15、17、21、23保留。

## 炮廓

旧炮廓是封闭船壳外的代理炮座与装饰方框，内部暗色块并没有实际切开船壳，部分框体还重复生成。本轮改为：

1. 在闭合船壳上用八个切割体生成真实浅炮室，保留内侧背壁；
2. 每炮位只有一组上檐、下槛、侧框及暗色内衬；
3. `jp6c` 改成低矮曲面炮盾与内部炮架，没有外挂小炮塔的高屋顶；
4. 炮管保留原耳轴、炮口与管间距参考，炮口有短内膛；
5. Blender与浏览器分别向八个炮口发射侧向射线，确认凹室并非被旧船壳覆盖。

炮廓炮由558降为 **344三角面/门**。主炮 `jp14d` 仍为1760三角面/座，GLB保持88828 bytes。

## 游戏资源

| 资源 | 内容 | bytes |
|---|---|---:|
| `ships/jp_bb_super.glb` | 粗壮舰岛、烟囱间桅杆、防空塔及其余静态甲板设备 | 1612124 |
| `ships/jp_bb_hull.glb` | 新船壳、甲板、八个炮廓凹室、外舷栏杆及水线数据 | 242892 |
| `guns/jp6c.glb` | 八门炮廓炮复用的单炮资源 | 18892 |
| `guns/jp14d.glb` | 四座主炮复用的认可资源，本轮未改 | 88828 |
| 合计唯一下载 | 约1.87 MiB | **1962736** |

静态舰岛合并成单一顶点色材质网格，炮塔不烘焙进舰岛。主炮与副炮仍各自通过同级 `base` / `barrel` 节点运动。

新增 `ships/jp_bb_hull` 已登记进manifest，共18个模型。成功加载时隐藏旧程序化船壳、甲板和栏杆，不叠加两层模型；文件缺失或水线数据不合格时保留程序化回退。其他五舰仍走原路径。

船壳GLB携带来自同一Blender线型的水线控制点。`src/render/visualHull.ts` 根据它生成两侧泡沫带，不再套用旧通用船型的水线，也不生成横跨整船宽度的泡沫板。

当前游戏整舰估计 **43080三角面、29次单次绘制调用**，在45000面及2MiB唯一资源预算内。静态成本不是GPU帧率保证。

## 仰角与射界

这些是用户要求的游戏设定，不当作1942年实舰机械参数考证。

| 项目 | 游戏设定 |
|---|---|
| 主炮最大仰角 | **45°** |
| 主炮默认最大俯角 | −5° |
| 炮廓炮仰角 | −5°～20° |
| 炮廓炮水平射界 | 对各自舷侧中心线±35° |
| 主炮水平射界 | 保留原有设定 |

- `src/sim/ballistics.ts`：默认角度常量、`GunSpec.elevMin/elevMax`（单位度），`clampElevation()`（输入输出弧度）。
- `src/sim/guns.ts`：日本356mm主炮明确引用45°常量；副炮单独定义上限。
- `updateTurrets()`、`muzzleWorld()`、`ShipView.update()` 与弹道求解使用同一限制。
- 超出机械仰角的射击解标记不可达，不消耗装填；弹道速度自身也受限制，不是只把模型动画截到45°。
- 已看过45°侧视姿态，并在浏览器把主炮状态强制设到90°，确认实际显示仍限制在45°。

主炮伤害、装填、标称射程、初速、炮口参考均未改。舰桥虚拟观察位置更新为舰体Z=48、水线Y=41，避开新舰岛的实体舱室，已检查实际驾驶视角。

## 验收

- 游戏测试44/44；typecheck、build、smoke通过。
- 18/18模型、六种ShipView、炮塔层级、八个实际凹室射线、45°渲染约束通过，浏览器错误0。
- 游戏实拍包括雾岛侧视、环绕、驾驶视角；驾驶视角中心未被新舰岛挡住。
- `node tools/model-budget.mjs --check`：0项硬预算超限。
- 28项现有Python检查，Blender另检查船壳闭合、正体积、炮廓射线、12个防空平台落座和主炮源网格/GLB校验值。

截图：`qa/verify-kirishima-broadside.png`、`qa/verify-kirishima-orbit.png`、`qa/verify-kirishima-bridge.png`、`qa/kirishima_casemates_qbow.png`、`qa/jp14d_before_45.png`。

## 重建与导出

```python
from pathlib import Path
root = Path(r'D:\warship-game\art\blender')
api = {}
p = root/'warship_build.py'
exec(compile(p.read_text(encoding='utf-8'), str(p), 'exec'), api)
api['build_turrets'](['jp6c'], force=True)
p = root/'kirishima_1942_build.py'
ns = {'__file__': str(p)}
exec(compile(p.read_text(encoding='utf-8'), str(p), 'exec'), ns)
ns['build_kirishima']()
api['export_gun']('jp6c')
ns['game_export_module']()['export_kirishima'](
    api, ns['KirishimaProfile'](), ns['detail_material'], ns['KEY'])
ns['save_kirishima']()
```

导出入口为 `kirishima_game_export.py`，只写本舰的生产文件；独立预览key仍不注册为另一个舰种。

刷新游戏页面，选择日军阵营后起锚，即使用这套雾岛模型。
