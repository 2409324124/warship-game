# 模型救援检查点

## 当前状态

六艘上层建筑和 11 种舰炮已修复、重新导出并登记。
它们是以现有游戏部件表为基础的低多边形外观模型，不是完成考证的精确历史复原。
船体、甲板、泡沫仍由游戏生成；没有修改 `src/sim/`。

### 本地 Blender 存档（不入 Git）

- `checkpoint_01_before_rescue.blend`：修改前的完整现场。
- `checkpoint_02_north_carolina_repaired.blend`：北卡初步修复阶段。
- `checkpoint_03_all_models_repaired.blend`：六舰全部修复，默认只显示北卡。

注意：第 02 阶段仍包含后续已修正的炮管预览问题，恢复时应优先使用第 03 阶段。

## 根因与修复

1. 舰桥各层主体、窗带、楼板是局部轮廓，旧代码忘记加部件 x/z 平移；栏杆却已在舰体坐标。
   现在在输出轮廓后统一平移，救生艇轮廓同样修正。
2. 六舰、参考船体、源炮塔全部同坐标可见，旧出图仅计算目标对象的取景范围却不隔离渲染。
   现在 `show_ship(key)` 隔离工作台，截图仅渲染明确传入的网格。
3. 炮塔预览覆盖 barrel 自有位移，又读取未更新的矩阵；先更新依赖图，再用安装矩阵乘源矩阵。
   可见炮管轴与耳轴重新重合，不再用网格偏移掩盖预览错误。
4. `Col` 没连到材质；现在白色材质因子配顶点色，Blender 和 glTF 均有窗带/甲板色。
5. 修正部分杆件/炮管封口绕序、相机横向视场和正交画幅、太阳灯方向。
6. 导出角色用对象属性保留，确保重复导出仍得到同级 `base` / `barrel` 节点。

## 重建

先在项目根目录运行（Node 24 支持本项目的 TypeScript 输入）：

```powershell
node tools/export-model-input.mjs
```

这只读取 sim 表，写 `art/blender/ship_input.json`。输入快照跟随代码入库，不再依赖临时目录。

在 Blender Python 控制台执行：

```python
exec(open(r'D:\warship-game\art\blender\warship_build.py').read())
build_turrets(force=True)
for key in SHIPS:
    build_ship(key)
    preview_turrets(key)
bpy.context.view_layer.update()
validate_geometry()
for key in SHIPS:
    export_ship(key)
for kind in TS:
    export_gun(kind)
show_ship('us_bb')
```

切换工作台：`show_ship('jp_dd')` 等。不要同时显示全部舰型。

`validate_geometry()` 检查实际生成顶点的 39 个构筑物中心，以及预览炮塔实际耳轴位置。

## 验收

```powershell
node tools/verify-models.mjs
npm test
npm run typecheck
npm run build
npm run smoke
```

本轮结果：37/37 测试、类型检查、构建、smoke 通过；专用验收确认 17/17 模型、六舰覆盖、45 个炮塔装配通过，浏览器错误为空。
第一关常规 smoke 只会加载北卡、吹雪及三种使用中的炮型；全 17 模型要看专用验收结果。

截图在本地 `art/blender/qa/`：六舰独立斜视、舰桥和副炮近景、两张实际游戏截图。
Luna 复核确认核心错位和多舰叠加问题已消除。桥下小型黑色短炮带基座，是防空炮，不应误删。

## 尚未完成的美术工作

- 通用楼板外伸、栏杆、烟囱及雷达仍偏简化；需要逐舰史实校正而非批量加细节。
- 不更改 sim 武器配置来追历史数量；本轮目标是救回正确坐标与稳定装配。
- 当前模型每舰上层建筑约 4,500–10,700 三角面，不含炮塔；尚未制作 LOD 或做完整性能基准。
