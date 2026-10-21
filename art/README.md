# Blender 建模工作区

只放**文件位置、命名、单位、坐标、导出设置**和**游戏侧的接口**。
这里没有任何模型，也没有改任何舰船数据——建模内容和挂载位置全部留给你在 Blender 里决定。

## 目录

```
art/
  blender/      ← .blend 工作文件放这里（二进制，不入库）
public/models/
  props/        ← 挂在船上的小件，导出到这
  landmarks/    ← 摆在岛上的地标，导出到这
src/render/assets.ts   ← 唯一接口：GLTF 加载（当前没有任何地方 import，不进包、不生效）
```

游戏从 `/models/<路径>.glb` 加载，即 `public/models/props/xxx.glb` → `props/xxx`。

## 坐标（重要，先读这个）

世界是 three.js 右手系：**+Y 上，+Z 船首（北），+X 西**。
（因为 `(+x) × (+z) = −y ≠ 上`，所以 +x 不可能是东；舵向、航向、海图都已经按这个对齐过。）

Blender 也是右手系但 **Z 上**。官方 glTF 导出器做 Z-up → Y-up：
`(x, y, z)_blender → (x, z, −y)_gltf`

| Blender | 导出的 glTF / 世界 | 含义 |
|---|---|---|
| +X | +X | 西（左舷） |
| **−Y** | **+Z** | **船首方向** |
| +Z | +Y | 上 |

**在 Blender 里把模型朝 −Y 建模**（默认前视图正对你的方向），导出后就是船首朝 +Z，与程序化船体一致。

## 其它约定

- **1 单位 = 1 米**（`scene.unit_settings.scale_length = 1`）
- **原点**：船用件放在水线面、船体中心——和程序化船体一致，`y = 0` 是水线
- 上船的小件只带**位移**，朝向在 Blender 里摆好（机头 −Y），不要在导出后再转
- 导出前 Apply Transform；导出勾 **+Y up**（导出器默认）；格式 **glTF Binary (.glb)**
- 材质用 Principled BSDF → 游戏侧是 `MeshStandardMaterial`，PBR 直接对应
- 贴图尽量嵌进 .glb，避免多文件

## 命名

```
props/      <舰名>_<部件>.glb      例：us_bb_floatplane.glb
landmarks/  <类型>.glb             例：lighthouse.glb / palm.glb
```

## 接入（等你放好 .glb 之后再做，现在不用动）

游戏侧加载器已经备好：

```ts
import { loadModel, mountProps } from './render/assets';
```

`mountProps(parent, props, deckAt)` 接受 `{ model, z, y?, x?, ry?, scale? }`，
其中 `z / x` 是船体局部坐标（+Z 船首、+X 左舷），`y` 是离水线米数（省略则取该站甲板 +1）。

在 `sim/ships.ts` 的舰船数据里加一行 `props: [...]` 即可挂载，**命中盒不受影响**
（命中判定仍由程序化船体负责，装饰件纯外观）。

## 不入库

`.blend` / `.blend1` 已在 `.gitignore` 中排除——工作文件是二进制，只保留导出结果与约定文档。
