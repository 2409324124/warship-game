# P0 垂直瞄准与舰炮声音修复

## 先复现，再修改

旧版通过原生 pointer lock 和可信鼠标输入复现：默认视角上移150px，实际视线只抬高约0.0906°，
地平线只移动1.40px，射程却增加约10.3km。纵向输入只改 range，镜头又看向固定高度26m，
所以“上下瞄准”主要是数字变化。此前只检查range变量的测试不足以发现此问题。

## P0 修复

- 主瞄准引入独立pitch，上移抬头、下移压低；夹紧在-80°到+65°，不翻转。
- yaw/pitch生成真实视线，有限预算射线求可见海面/地形交点，再驱动P.aimX/Z、炮塔弹道及落点。
  视线pitch不是炮管的弹道仰角，二者职责保持分离。
- 取消镜头固定看向26m的反馈；普通、近景、炮组、三级望远和舰桥均应用真实俯仰。
- 无有效射程内落点时隐藏投影，玩家开火不消耗装填，不向旧目标误发射。
- 右键独立观察保持原枪瞄准点；松开、失焦、暂停均清理观察状态。
- 开镜/换炮组保持原世界瞄准点，在镜头过渡中按当前可见水面重算视角，避免结束时漂移。
- 锁定纵向微调使用目标水面平面，不让前景岛屿抢走测距。实弹仍正常与地形碰撞。
  真实角度输入下，范围修正解锁门槛从12%改35%，避免普通视角1像素即解锁；大幅修正仍解锁。

## 完整输入端到端验证

运行：`node tools/verify-aim-vertical.mjs --expect-fixed`

- 真实浏览器、原生pointer lock、可信mouse.move/左键，不用__cmd.turn替代被测输入。
- World/船位/AI受控，初始化水域可用debug入口；此后输入与开火路径是真实游戏代码。
- level0–5与V舰桥分别验证上下/左右、实际视线pitch、地平线、海面点、炮塔elev。
- 上拉至天空时投影隐藏，左键不消费reload；俯仰极限、无交点均有限。
- 两轮实际左键开火，经原始World.step跑到splash，第二轮下拉后落弹更近。
  当前验收均值约9,314.49m → 5,925.61m；不是承诺所有随机弹群都固定在这些数值。
- Shift/C切换瞄准点漂移约0.018/0.070m（受控固定船位），锁定1px微调保持、RMB独立观察与清理通过。
- 总计144项通过。只生成6张图，report保留历史REPRO摘要并明确其并非当前版本重跑数据。
- 截图经visual-qa复核，上/下画面变化明确，天空无虚假海圈，望远视野无遮挡。
  目标标签与黄色落点文字仍可能有轻微重叠，非此次P0输入阻塞。

报告：`art/blender/qa/verify-aim-vertical-report.json`
截图：`p0-aim-before/up/down.png`、`p0-aim-scope-sea.png`、`p0-aim-sea-first/down.png`。

## P1 声音

不再继续靠加长带通噪声模拟重炮。主音源为授权明确的美国海军Mk45 5英寸实弹录音，
保留爆鸣和自然衰减；BB添加低比例原创压力层与轻微立体声反射。原始音高/速率不变。
这是基于5英寸实录的游戏化组合音，不声称是真实16英寸、356mm或406mm现场录音。

- 音频：`public/audio/navy-mk45-report.wav`，247,244 bytes，异步预加载/解码、开火不联网。
- 署名与CC BY3.0授权、剪辑区间、处理、SHA256：`public/audio/ATTRIBUTION.md`。
- 素材失败才使用合成回退；加载重试次数/间隔、声部/缓存均有界。
- 真实游戏E2E验证HTTP200/WAV解码与两轮main事件：recorded 0→2→4、fallback始终0。
- 真实WebAudio最终混音覆盖44.1/48kHz、单炮/齐射、削波护栏及声部释放。
  验证了素材与输出链，不等于主观听感验收；仍需用户本机扬声器试听。

最终立体声预览位于系统Temp的opencode目录：
`warship-recorded-heavy-finalmix.wav`、`warship-recorded-salvo-finalmix.wav`。

## 最终回归

```powershell
$env:OCEAN_WEBGL_URL = 'http://localhost:5173/'
npm test
npm run typecheck
npm run build
```

132/132通过、无跳过，含实际WebAudio/WebGL；typecheck/build通过。
本机Vite当前绑定localhost，127.0.0.1:5173不一定可达，浏览器验收使用localhost。
音频测试cleanup已改为先关自身浏览器、再清HTTP连接/服务器，避免after钩子阻塞退出。
所有GPU检查为软件渲染正确性验证，不承诺实际硬件FPS。未提交Git或覆盖此前建模归档。
