# 华盛顿舰首接入与全舰实体护栏

## 当前状态

用户体验游戏后指出华盛顿舰首上翘和舷边铁栏杆没有体现。本轮已在游戏中修正，不再仅留在Blender预览。

- 起点备份：`checkpoint_26_before_washington_game_hull.blend`。
- 最新存档：`checkpoint_27_washington_game_bow_and_rails.blend`。
- 华盛顿认可线型基线 `checkpoint_15`、雾岛游戏稿 `checkpoint_25` 保留。
- 当前华盛顿集合：`ship_us_bb_game`、`ref_us_bb_game`、`preview_us_bb_game`；按当前游戏13个挂点组装。

## 原因

1. 游戏此前只登记了 `jp_bb_hull`，没有 `us_bb_hull`。华盛顿的改好舰首仍停留在独立草稿，游戏实际使用通用船壳。
2. 原通用护栏是沿两舷生成的两条半透明薄面，没有立柱或横杆，且宽度公式与甲板边缘不同，难以辨认，也容易偏离甲板。
3. 雾岛已有细杆护栏，但中段不完整、杆件偏细。本轮一起换成完整护栏。

## 华盛顿舰首

复用 `washington_bow_profile.py/json` 中的外飘、艏柱后收和圆顺船底；在**游戏版本**中将艏端额外舷弧由0.35m强化为1.0m，仅影响船长最后15%。

- 实际尺度222×33m；艏缘最高甲板约12.05m。
- 主炮、副炮所在位置的甲板高度保持与模拟一致，13个耳轴位置检查通过。
- 水线控制点与原认可线型相同，从同一数据导出泡沫。
- 克隆当前游戏舰岛，只清理原来贴在旧舰首上的代理锚位，按新侧舷重新贴合锚与锚链孔外观。
- 船壳、甲板、护栏一并导出 `ships/us_bb_hull.glb`，加载成功时隐藏旧程序化对应物，不叠加两层船体。

## 实体护栏

外舷护栏使用真实三维杆件：

- 约1.05m高，立柱间距约2.5m；
- 上下两道横杆，杆件直径约9.6cm、立柱直径约12cm，按游戏镜头适度加粗；
- 使用不透明金属材质，船艏、舰艉闭合，沿实际甲板边缘放置；
- 华盛顿185个立柱脚点已对实际船壳射线检查落座；
- 雾岛同样换成全周护栏；其他四舰与资源缺失时的回退，使用通用实体护栏；
- 驱逐舰的艏楼落差处分段收口，不用斜杆跨过空中；
- 通用护栏直接读取与船壳相同的 `hullSection()`，不再维护另一套余弦宽度公式。

Blender生成入口：`game_railings.py`。游戏回退入口：`src/render/deckOutline.ts` 与 `src/render/railings.ts`。两者统一高度、间距、杆件半径；护栏静态合并，每舰仍只占一个护栏材质绘制单元。

## 资源与成本

| 项目 | 华盛顿 | 雾岛 |
|---|---:|---:|
| 舰岛GLB bytes | 1052012 | 1612116 |
| 船壳/甲板/护栏GLB bytes | 266696 | 246260 |
| 全部唯一资源 bytes（含炮塔） | **1457284** | **1966096** |
| 游戏整舰三角面估算（含泡沫） | **36708** | **44814** |
| 单次绘制调用估算 | 31 | 29 |

两艘都在2MiB唯一资源与45000面上限内。模型清单共19项。护栏的成本现在按实际杆件统计，不再沿用旧薄面240三角面的估计。

本轮美日四种已认可炮型的GLB哈希均未改变；主炮45°上限等既有射击设定保留。此处为静态成本，不作为核显帧率实测。

## 验收

- Python建模检查29项通过。
- 游戏测试47项通过：新增甲板贴合、实体杆件、艏楼断阶护栏测试。
- typecheck与build通过；19/19模型、六种ShipView与7张实际游戏截图验收通过。
- 游戏smoke回归通过，驾驶视角中心未被舰体或新护栏挡住。
- 浏览器直接检查已加载华盛顿船壳222×33m、艏部最高甲板超过11.9m，及两艘战列舰实体护栏元数据。
- `model-budget.mjs --check` 0项硬预算超限。

游戏实拍：`qa/verify-washington-bow-rails.png`、`qa/verify-models-broadside.png`、`qa/verify-kirishima-bow-rails.png`。Blender近景：`qa/washington_game_bow.png`、`qa/washington_game_rails.png`。

## 重建

```python
p = r'D:\warship-game\art\blender\washington_game_hull.py'
ns = {'__file__': p}
exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), ns)
ns['build_washington']()
ns['export_washington']()
# 如要同步重新导出当前场景中雾岛的护栏：
ns['update_kirishima_rails']()
ns['api']()['show_ship'](ns['KEY'])
ns['review_washington']()
ns['save_washington']()
```

最新游戏页面需刷新，以清除旧模型的内存缓存；选择美军阵营即可体验华盛顿的新舰首与护栏。
