# 弗莱彻船体修型 — checkpoint 29

> 历史阶段记录。最新30版保留本船体，继续修舰炮与舰岛，见 `FLETCHER_GUNS_AND_BRIDGE.md`。
> 当前 `save_fletcher()` 已改存30号文件；重建29版应读取29号blend内嵌脚本，不能用当前脚本冒充29版。

## 范围与状态

用户要求：接手项目，截图后对比弗莱彻舰体造型进行修改。

本轮基于 `checkpoint_28_fletcher_blockout.blend`，另存
`checkpoint_29_fletcher_hull_refined.blend`。没有覆盖28号存档，没有更新
`public/models`、游戏模拟、已认可炮塔几何或旧ZIP。

## 截图与参考

- 修改前：`qa/fletcher_hull_before_side.png`、`qa/fletcher_hull_before_bow.png`。
- 修改后：`qa/fletcher_hull_after_side.png`、`qa/fletcher_hull_after_bow.png`、
  `qa/fletcher_hull_after_stern.png`。
- 隔离船壳：`qa/fletcher_hull_only_top.png`、`*_front.png`、`*_rear.png`、
  `*_bow_detail.png`、`*_stern_detail.png`。
- 实舰：`references/fletcher/fletcher_1942.jpg`，DD445 1942年纽约外海照片。
  来源：https://en.wikipedia.org/wiki/File:USS_Fletcher_(DD-445)_off_New_York,_1942.jpg
- 辅助：`references/fletcher/fletcher_class_plan_1954.jpg`，1954年剖视示意。
  来源：https://en.wikipedia.org/wiki/File:Fletcher-class_destroyer_technical_drawing_1954.jpg
  仅参考结构与总体关系，不作为1942年装备配置证据。

照片可支持细长、低干舷、连续平甲板和向艏上扬的轮廓；水下截面无法从该照片量取。
因此这是一版有资料依据的游戏化视觉修型，不是测绘肋骨线复原。保持项目114×12米尺度，
没有擅自将全舰改为资料中的约114.7米总长。

## 实际修改

1. 中部甲板从水线上4.94米降至2.65米；艉4.68→2.50米，艏7.28→5.10米。
   保留连续平甲板和艏部舷弧，不增加虚构艏楼断阶。
2. 艉部从长距离尖削改为短而宽的圆艉；距艉3%船长处的半宽为4.44米，
   对比艏部对称站位显著更宽，俯视不再两头同样尖。
3. 水线艉端前收2.2米，底端前收6.2米，向中部平顺衰减，形成艉部悬伸，
   消除原先向下汇成垂直尖线的问题。艉底在后24%船长内逐渐上收。
4. 艏下部从圆底逐渐过渡至较细V形截面；艏柱上部采用渐进弯曲，并增加艉端和
   上部截面采样，减少硬折角。保留正常外飘，不做球鼻艏。
5. 船壳补建真实的 `Col` 颜色属性；甲板与舷侧交界设锐边，避免平滑法线抹掉舷缘。
6. 护栏按新甲板边界重建；增加中部甲板室、后鱼雷座基础和高位炮座承托。
   这些是防悬浮的功能性大形，不代表已完成历史上层建筑细节考证。

## 炮位兼容边界（重要）

模拟文件及GLB没有改变。**本版视觉甲板不再与旧模拟干舷一致。**
预览炮塔的整套 base/barrel 仅在垂直方向随甲板下降，前后/左右位置、朝向、
相对甲板高度与炮塔源几何保持原值；不能声称世界坐标耳轴完全不变。
将来接入游戏须同步处理视觉挂点和炮口世界坐标，不能只替换船壳GLB。

## 验证与复核

- 实际网格闭合流形、正体积、无零面积面；114×12米。
- 五座预览炮塔耳轴与视觉甲板相对挂点匹配；BVH射线检查底部承托误差<6厘米。
- 护栏脚点逐个射线检查落在船壳甲板上，误差<4厘米。
- 整舰预览15,316三角面，低于20,000目标。
- Python回归34项通过，其中5项为新弗莱彻线型测试。
- 两轮visual-qa复核。首轮指出艉底尖尾，已修改并补拍纯船壳图；第二轮未发现
  需本轮继续修改的严重船壳造型问题。分面和局部明暗仍可进一步优化，非测量级线型验收。

## 重建

```python
p = r'D:\warship-game\art\blender\fletcher_refined.py'
ns = {'__file__': p}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['build_fletcher']()
ns['review_fletcher_hull']()
ns['save_fletcher']()  # checkpoint_29，拒绝从其他存档覆盖已存在的29号文件
```

后续重点：舰桥/烟囱/鱼雷管的1942年形态，以及完整游戏接入的视觉—弹道坐标契约。
