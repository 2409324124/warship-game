# 华盛顿号舰岛：第一轮实舰照片精修

> 本文记录第一轮形体基线。后续减面及武器精修的当前数据见 `WEAPONS_AND_BATTERY.md`；下文21,320三角面为该基线阶段的记录。

## 目标与边界

以 USS Washington (BB-56) 为目标，主证据为 1942-08-18 塔式前桅近照和 1942-08-21 斜前方航拍。
目标服务于瓜岛1942年关卡，但没有将8月照片冒称为11月现场记录。
本轮没有船厂尺寸图，模型尺寸是与现有222m游戏船体、炮位相容的解释性比例，不是精确复原。

保持 `src/sim/`、程序化船体/甲板/泡沫、所有主副炮安装节点和炮塔GLB不变。
只更新 `public/models/ships/us_bb_super.glb`。

## 基线与本地场景

- 基线：Git `ebfc4c1`，`checkpoint_04_fixed_barbettes.blend`（不覆盖）。
- 开始精修：`checkpoint_05_washington_start.blend`。
- 第一轮形体：`checkpoint_06_washington_blockout.blend`。
- 第二轮形体：`checkpoint_07_washington_refined.blend`。
- 最终检查版本：`checkpoint_08_washington_1942_v1.blend`。

场景保留其他舰型，但工作台只显示华盛顿。两份构建源码也存为 Blender Text 数据块。

## 主要改动与照片对应

| 区域 | 本轮改动 | 参考 |
|---|---|---|
| 下部桥楼 | 宽阔低层甲板室、圆钝前脸、离散圆舷窗和上层矩形桥窗；不再使用粗黑整圈窗带 | 8月21日航拍 |
| 前部司令塔/指挥设备 | 司令塔嵌入桥楼，前上方有局部小指挥仪及短测距臂；保留二号塔固定支撑 | 同上；遮挡部位保持简化 |
| 塔柱 | 连续圆钝塔柱、下部宽肩向上收束，替换原四层等厚出檐盒子 | 8月18日近照 |
| 平台 | 不同高度的桥翼、小观测平台、显著横向多边形上平台；增加与塔身接合的斜撑 | 两张照片互证 |
| 顶部指挥设备 | 圆钝指挥设备、两侧横向测距臂、大型与小型不同姿态的网格天线 | 8月18日近照 |
| SG支架 | 小型天线位于塔正面上平台下方，不把所有雷达泛放到最高点 | 照片来源说明 |
| 近景细节 | 少量塔柱开口、光学罩、爬梯、管线、舷侧椭圆浮具框 | 形态依据照片；简化放置，不声称逐件定位精确 |
| 烟囱 | 保留独立双烟囱，细外翻帽沿与暗色喉口，去掉厚黑色腰箍 | 8月21日航拍 |

## 代码组织与重建

`warship_build.py` 仍是入口；`washington_super.py` 是独立的美术布局。
`build_ship('us_bb')` 调用新布局，其余五舰仍使用现有通用构建器。
坐标始终使用舰体 (x, up, bow)，只在统一 W() 处转到 Blender (x, -bow, up)。

```python
exec(open(r'D:\warship-game\art\blender\warship_build.py').read())
build_ship('us_bb')
preview_turrets('us_bb')
show_ship('us_bb')
bpy.context.view_layer.update()
validate_geometry()
export_ship('us_bb')
```

主体区段实际包围盒写入 `super_us_bb['component_bounds']`。验证的是生成后的顶点，而非仅输入数字。
顶点色材质与单舰出图沿用救援后的稳定管线；舷窗用平面环和暗色面减少隐藏圆柱面开销。

## 验收与仍需改进

- QA图片：`qa/washington_v2_*` 和最终 `qa/washington_final_*`，包括三视图、两舷斜视及舰桥近景。
- 两轮视觉评审认为相较四层叠盘有实质改善，可作为第一轮历史大形稿。
- 游戏截图终检未见旧舰桥叠加、大块缺失、炮管落甲板或主平台漂浮；作为首轮稿保存，不代表历史精度完成。
- 本轮 37/37 测试、typecheck、build、smoke 均通过；加载验收 17/17，六舰覆盖和45个炮塔装配、炮管零姿态及正仰角方向检查通过。
- 华盛顿上层建筑（不含可动炮塔）为21,320个三角面；GLB为1,448,216字节。首次形体稿之后将继续约束细节和远景开销。
- 平台、指挥设备和天线仍是游戏级简化；遮挡侧结构及细小附件有证据缺口。
- 主副炮和轻防空炮的数量/安装点沿用游戏。没有冒称已经完整还原1942年防空配置。
- 当前仍未提供完整LOD与硬件性能基准，精细程度应以游戏近景和帧率继续约束。
- 加载与装配验证：`node tools/verify-models.mjs`；常规验证：`npm test`、`npm run typecheck`、`npm run build`、`npm run smoke`。
