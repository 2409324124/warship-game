# 华盛顿武器精修与副炮布局验收稿（核显预算）

## 本轮范围与状态

- 前一基线：Git `4c92ead` / `checkpoint_08_washington_1942_v1.blend`，保留不覆盖。
- 本轮起点：`checkpoint_09_before_weapons_layout.blend`。
- 布局初稿：`checkpoint_10_battery_layout_draft.blend`。
- 当前检查稿：`checkpoint_11_weapons_refined_layout_review.blend`。
- **已用于游戏**：优化后的华盛顿舰岛、精修 `us16t`、精修/减面的共用 `us5d`。
- **仅 Blender 预览、等待用户确认**：副炮十个新安装点及配套错列平台。`src/sim/` 没有修改。
- 因 `us5d` 是共用模型，新奥尔良级也会使用新炮塔外形；安装点和武器参数不变。

不要把 Blender 草稿的正确错列关系误认为已经落入游戏。游戏继续使用原始炮位，所以当前射击计算与画面安装点仍一致。

## 副炮证据与位置草案

主证据：`references/washington_1942/1942-08-21_aerial_BS33803_3840.jpg`。
可辨认的关系：右舷从艏到艉为低—高—低—高—低，低位外侧、高位内侧。第四座有遮挡，置信度较低。
以下米制坐标为适配现有游戏船体的比例解释，不是船厂图实测。左舷暂按镜像草拟，仍需交叉核对。

`washington_battery_draft.json` 是唯一待验收位置表，不被游戏或 sim 导入。
坐标：+Z 朝艏、+X 左舷，y 是高出当地甲板的米数。

| 左舷编号 | 对应 sim 索引 | z | x | 高出甲板 y | 层级 |
|---|---:|---:|---:|---:|---|
| P1 | 3 | 32 | 13.2 | 3.2 | 低、外侧 |
| P2 | 4 | 17 | 9.0 | 6.4 | 高、内侧 |
| P3 | 5 | 3.5 | 13.4 | 3.2 | 低、外侧 |
| P4 | 6 | -10.5 | 9.0 | 6.4 | 高、内侧，待核 |
| P5 | 7 | -25 | 13.2 | 3.2 | 低、外侧 |

右舷 S1–S5 的 x 取负，索引分别为8–12。三座主炮坐标完全保留。

`battery_layout_preview.py` 创建独立 `ship_us_bb_draft` / `preview_us_bb_draft` / `ref_us_bb_draft` 集合：
- 中央甲板室收窄到18.4m，避免低位炮座被旧的宽甲板室吞没。
- 低位舷侧台与中央结构有实际重叠连接；高位平台有固定承座和斜撑。
- 不移动可动炮塔顶点掩盖安装点变化，而是用完整安装变换装配预览。
- 校验10座对应关系、低高序列、耳轴矩阵、炮塔外壳仍在船体横向范围内；不将这些断言当作全射界碰撞检测。
- `export_ship('us_bb_draft')` 会拒绝导出，manifest 不登记草稿。
- 草稿舰岛实测17,852三角面（含新平台和支撑），同样在18k上限内。按同一炮塔和船体成本估算，若后续采用该布局，整舰约33,376三角面；这不是当前游戏的布局统计。

用户确认后，下一步才同步华盛顿的安装坐标与真实开火位置，并重新跑数据/射击测试；不得只改渲染位置而让炮弹从旧位置发出。

## 主炮和副炮造型

入口 `build_turret()` 对 `us16t` / `us5d` 使用 `us_refined_guns.py`：
- 明确斜面与切角的装甲塔体、收分侧壁、薄顶缘和局部观察罩。
- 实际切出的前装甲枪孔、凹入边缘和随耳轴运动的弧形内盾。
- 主炮渐细管身、根部过渡、16段圆周；副炮8段圆周，转盘16段。
- 炮口使用短内膛和深处暗色底面，不在管口贴一块黑盖。
- 主炮侧部测距仪端部、顶部舱盖、后部短梯保留；不做细小螺栓和隐蔽内部机构。
- `base` / `barrel` 两个同级节点保持不变。耳轴、三管/双管间距、18m/5.6m炮口参考保持与游戏一致。
- 对平射和22°抬炮出图；22°覆盖当前主炮射程内虚拟弹道仰角约21.8°，不声称已验证任意现实高仰角。

## 面数与大小

所有面数指**导出的三角形**，不含 Blender quad 的混淆计数。

| 项目 | 本轮前 | 本轮后 |
|---|---:|---:|
| 华盛顿舰岛 | 21,320 tri | 15,500 tri |
| 单座三联主炮 | 1,210 tri | 1,656 tri |
| 单座双联副炮 | 914 tri | 532 tri |
| 整舰（含程序化部分估算） | 39,326 tri | 31,024 tri |
| 华盛顿唯一 GLB 下载 | 1,573,504 bytes | 1,168,192 bytes |

整舰三角形约降21%，唯一模型下载约降26%。31次单通道 primitive 绘制估算未增加，不包含阴影/海水/特效多通道。
三座主炮和十座副炮重复渲染计入面数，但 geometry/material 由缓存克隆共享，不重复下载。

舰岛保留主要轮廓和雷达；减面主要来自连接杆去掉不可见端盖、栏杆按累计弧长等距布柱、浮具截面合理减段。
当前不新增贴图、不新增材质；仍使用顶点色与现有 PBR 材质。

```powershell
node tools/model-budget.mjs --check
```

硬预算：华盛顿舰岛18k、主炮2.5k/座、副炮700/座、BB唯一资源2MiB、整舰45k，建议目标40k。
报告包含导出 POSITION 数和 mesh primitive 数。指标是静态资源估算，**不是核显FPS测试**；尚未制作LOD。

## 验收

- 静态预算：0项硬预算超限。
- `node tools/verify-models.mjs`：17/17 loaded、六舰、45个炮塔层级、旋转约定通过；浏览器错误0。
- `npm test`：37/37；typecheck、build、smoke 通过；`git diff -- src/sim` 为空。
- 视觉QA：平射与22°抬炮没有明显穿塔顶；副炮双管可辨，草稿低高错列可读，未见明显漂浮；游戏无明显破面/旧件叠加。
- 图片：`qa/battery_draft_final_*`、`qa/refined_us16t_final.png`、`qa/refined_us16t_elev22.png`、`qa/refined_us5d_final.png`，另有两张 `verify-models-*` 游戏图。

## 恢复预览

```python
exec(open(r'D:\warship-game\art\blender\warship_build.py').read())
build_turrets(['us16t','us5d'], force=True)
build_ship('us_bb')
preview_turrets('us_bb')
ns = {}
exec(open(r'D:\warship-game\art\blender\battery_layout_preview.py').read(), ns)
draft_spec, draft_audit = ns['make_battery_preview'](globals())
# 看游戏当前布局：show_ship('us_bb')
# 看待验收布局：show_ship('us_bb_draft')
```
