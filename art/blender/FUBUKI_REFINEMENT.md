# 吹雪I型：游戏化独立精修稿

> 历史阶段记录：现已在31版接入游戏并同步甲板/炮位，见 `GAME_MODELS_FIRE_AND_OCEAN.md`。
> 下文“仅预览”描述的是17号原稿保存时的状态。

## 状态与边界

- 华盛顿认可基线 `checkpoint_15_washington_bottom_refined.blend` 不覆盖。
- 吹雪旧稿起点另存 `checkpoint_16_fubuki_start.blend`；新稿保存为 `checkpoint_17_fubuki_refined.blend`。
- 集合 `ship_jp_dd_refined` / `ref_jp_dd_refined` / `preview_jp_dd_refined`。一次只显示一艘。
- **仅Blender预览，没有替换游戏资源，也不修改模拟与碰撞。** 原舰岛和共享炮塔GLB保留。
- 长118m、最大宽10.4m；视觉甲板高度为低甲板约2.35m、艏楼约4.05–4.65m，低于旧通用代理过高的艏楼。三座主炮x/z、朝向与甲板相对高度保留，绝对预览高度随新甲板变化，不声称与当前游戏炮口高度相同。

## 旧稿主要问题及本轮处理

1. 原舰艏统一前移整断面，实际长度超过规格；艏柱接近竖直，船壳有平面带状明暗。改为按高度前倾，闭合索引船壳，渐进上扬艏底，不保留华盛顿旧稿的“鞋头”。
2. 原舰桥是三层重复大出檐叠盘。新建连续下桥楼、紧凑封闭驾驶室、少量桥翼、光学测距设备及支撑桅。
3. 双烟囱改为前粗后细、略后倾的椭圆外形；加入I型弯管式通风筒，取消无依据的中段黑腰带。
4. 保留前一后二、后部前高后低三座主炮，固定炮座有支撑。炮塔继续复用890面/座的已有共享网格，不宣称已精修A型炮架。
5. 三组中线三联鱼雷、艇与吊艇支撑、少量防空代理、艉深弹架、细栏杆与甲板系缆设备。

## 参考及不确定性

- 实舰参考：吹雪号性能改善工程后照片，Commons标注推定1936年3月。
- 图片页：https://commons.wikimedia.org/wiki/File:Fubuki.jpg
- 已核实原图：https://upload.wikimedia.org/wikipedia/commons/e/e0/Fubuki.jpg
- 分型参考：https://en.wikipedia.org/wiki/Fubuki-class_destroyer
- 行动记录：https://www.combinedfleet.com/fubuki_t.htm

照片用于外形识别，不是1942年当月构型的精确证据。不移植战前“20”编号、片假名舰名、烟囱白带；不混入晓型细前烟囱、1943–44年雷达和后期密集防空。保留三座主炮。具体1942轻防空、备雷箱和小件仍是简化，鱼雷的游戏型号也不是历史证明。

## 重建与验收

```python
path=r'D:\warship-game\art\blender\fubuki_refined.py'
exec(compile(open(path,encoding='utf-8').read(),path,'exec'))
build_fubuki()
review_fubuki()
save_fubuki()
```

回看旧稿：载入 `warship_build.py`，调用 `show_ship('jp_dd')`；新稿 `show_ship('jp_dd_refined')`。新key没有注册进manifest，正常 `export_ship` 会拒绝导出。

```text
python -B -m unittest discover -s art/blender -p test_fubuki_profile.py
```

船壳＋甲板目标≤5000三角面；整舰预览≤18000。Blender验证实际尺寸、闭合流形、退化面、正体积、炮塔耳轴位置和单舰可见。`qa/fubuki_before_*` 与 `qa/fubuki_refined_*` 提供前后对照。先验收识别级造型，再考虑游戏侧船壳/甲板/栏杆/泡沫和炮口高度的统一接入；不能仅替换舰岛就宣称所有部位已同步。

## 本轮结果

| 组成 | 三角面 |
|---|---:|
| 船壳＋甲板 | 4056 |
| 舰桥／设备／栏杆等 | 8736 |
| 三座共享主炮 | 2670 |
| 整舰可见稿 | **15462** |

- 吹雪取样器7项测试通过；同时回归华盛顿12项测试，共19项。
- 第一轮视觉复核后，补充了鱼雷回转承座及托架、减小护罩让三管可读、将防空代理置于两舷避免中线穿插；重做开口艇与艇内侧吊艇架/吊索；通风筒改连续圆顺弯头并增加独立基座；腰部栏杆减密，烟囱侧面平滑着色。
- 纯船壳侧视、仰视和无阴影法线图确认：舰体中前部可见的甲板落差是正常艏楼，不是水下船底断裂。新增测试验证艏楼前后水下截面高度无跳变；不磨平舰型特征。
- 第二轮视觉QA通过游戏化主体稿，未见必须返修的明显缺陷。中部设备密集和精确A型炮架仍可后续深化；轻防空位置为避让布局的视觉代理，非1942实舰精确布置。
- 已认可的华盛顿模型不变；本轮未导出、未提交Git，游戏接入仍是后续独立步骤。
