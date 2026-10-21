// Read-only static resource report. Requires Node 24 (native TypeScript stripping).
// node tools/model-budget.mjs [--check] [--island-tri=18000] [--main-tri=2500]
//   [--secondary-tri=700] [--bb-bytes=2097152] [--ship-tri=45000] [--target-tri=40000]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const limits = {
  'island-tri': 18000,
  'main-tri': 2500,
  'secondary-tri': 700,
  'bb-bytes': 2 * 1024 ** 2,
  'ship-tri': 45000,
  'target-tri': 40000,
};
let check = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--check') {
    check = true;
  } else if (arg === '--help') {
    console.log('Node 24: node tools/model-budget.mjs [--check]');
    console.log('Defaults; override with --key=number:');
    console.log(limits);
    console.log('Default: report only. --check: exit 1 for exceeded hard limits; target is advisory.');
    process.exit(0);
  } else {
    const match = /^--([a-z-]+)=(\d+)$/.exec(arg);
    if (!match || !Object.hasOwn(limits, match[1]) || !Number.isSafeInteger(Number(match[2]))) {
      throw new Error(`Unknown/invalid option: ${arg}; use --help`);
    }
    limits[match[1]] = Number(match[2]);
  }
}

const [{ SPECS }, { TS, GUNS }, { RING }] = await Promise.all([
  import(new URL('src/sim/ships.ts', root)),
  import(new URL('src/sim/guns.ts', root)),
  import(new URL('src/sim/hull.ts', root)),
]);
const manifest = JSON.parse(await readFile(new URL('public/models/manifest.json', root), 'utf8'));
if (!Array.isArray(manifest.models)) throw new Error('manifest.models must be an array');
const names = [...new Set(manifest.models)];
const issues = [];
const failures = [];
const sum = (items, key) => items.reduce((n, item) => n + item[key], 0);
const costSum = (items) => ({ triangles: sum(items, 'triangles'), calls: sum(items, 'calls') });
const fmt = (n) => n.toLocaleString('en-US');

async function inspect(name) {
  if (typeof name !== 'string' || !/^[\w-]+(?:\/[\w-]+)*$/.test(name)) {
    throw new Error(`Invalid manifest model name: ${name}`);
  }
  const url = new URL(`public/models/${name}.glb`, root);
  const data = await readFile(url);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2 ||
      data.readUInt32LE(8) !== data.length) throw new Error(`${name}: invalid GLB v2 header`);
  let json;
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error(`${name}: truncated chunk header`);
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    if (offset + 8 + length > data.length) throw new Error(`${name}: truncated chunk`);
    if (type === 0x4e4f534a) json = JSON.parse(data.subarray(offset + 8, offset + 8 + length).toString('utf8').trim());
    offset += 8 + length;
  }
  if (!json) throw new Error(`${name}: no JSON chunk`);
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
    if (entry.uri && !entry.uri.startsWith('data:')) issues.push(`${name}: external URI ${entry.uri}; bytes exclude external payload`);
  }
  const accessors = json.accessors || [];
  const nodes = json.nodes || [];
  const meshes = (json.meshes || []).map((mesh) => (mesh.primitives || []).map((p) => {
    const position = accessors[p.attributes?.POSITION]?.count;
    const count = p.indices === undefined ? position : accessors[p.indices]?.count;
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(count)) throw new Error(`${name}: missing accessor count`);
    const mode = p.mode ?? 4;
    const triangles = mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    if (mode === 4 && count % 3) issues.push(`${name}: triangle index/vertex count is not divisible by 3`);
    return { triangles, calls: 1, position, indices: p.indices === undefined ? 0 : count,
      indexedTriangles: p.indices === undefined ? 0 : triangles };
  }));
  const primitives = meshes.flat();
  const scene = json.scenes?.[json.scene ?? 0];
  const childIds = new Set(nodes.flatMap((n) => n.children || []));
  const roots = scene?.nodes || nodes.map((_, i) => i).filter((i) => !childIds.has(i));
  const reachable = [];
  function walk(id, path = new Set()) {
    if (!nodes[id] || path.has(id)) throw new Error(`${name}: invalid/cyclic node ${id}`);
    const node = nodes[id];
    reachable.push(id);
    if (node.extensions?.EXT_mesh_gpu_instancing) issues.push(`${name}: node GPU instancing not included in estimate`);
    const next = new Set(path).add(id);
    return costSum([
      ...(node.mesh === undefined ? [] : meshes[node.mesh] || []),
      ...(node.children || []).map((child) => walk(child, next)),
    ]);
  }
  const sceneCost = costSum(roots.map((id) => walk(id)));
  const active = [...reachable];
  const find = (label) => active.filter((id) => nodes[id].name === label);
  const base = find('base');
  const barrel = find('barrel');
  const parent = (id) => nodes.findIndex((node) => node.children?.includes(id));
  const describe = (ids) => ids.map((id) => {
    const p = parent(id);
    return `#${id} parent=${p < 0 ? 'scene' : `${nodes[p].name || 'node'}#${p}`} mesh=${nodes[id].mesh ?? '-'} children=${(nodes[id].children || []).length}`;
  }).join('; ') || 'MISSING';
  let mounted = sceneCost;
  if (name.startsWith('guns/')) {
    const valid = base.length === 1 && barrel.length === 1 && parent(base[0]) === parent(barrel[0]);
    if (!valid) issues.push(`${name}: expected unique sibling base/barrel; procedural fallback may remain`);
    mounted = costSum([...base.slice(0, 1), ...barrel.slice(0, 1)].map((id) => walk(id)));
    if (mounted.triangles !== sceneCost.triangles || mounted.calls !== sceneCost.calls) {
      issues.push(`${name}: scene cost differs from mounted base/barrel subtrees`);
    }
  }
  return { name, bytes: data.length, primitives: primitives.length,
    indices: sum(primitives, 'indices'), indexedTriangles: sum(primitives, 'indexedTriangles'),
    position: sum(primitives, 'position'), materials: (json.materials || []).length,
    storedTriangles: sum(primitives, 'triangles'), sceneCost, mounted,
    structure: `base: ${describe(base)} | barrel: ${describe(barrel)}` };
}

// Source-formula estimate, intentionally independent of renderer/canvas imports.
// src/render/shipModel.ts: hullStations/buildHull/buildFoam/buildRails.
function procedural(spec) {
  const stations = Math.round(Math.min(96, Math.max(48, spec.L / 2))) + 1 +
    2 * spec.sheer.filter(([s]) => s > 0.01 && s < 0.99).length;
  const hull = (stations - 1) * (RING * 2) * 2;
  const deck = (stations - 1) * 2;
  const foam = 24 * 4;
  const rail = 60 * 4;
  return { hull, deck, foam, rail, triangles: hull + deck + foam + rail, calls: 4 };
}

const assets = new Map();
for (const name of names) assets.set(name, await inspect(name));
console.log(`MODEL BUDGET — read-only static report (${check ? 'CHECK' : 'REPORT'}), Node ${process.versions.node}`);
console.log(`Root: ${fileURLToPath(root)}`);
console.log('唯一下载 != 重复渲染成本：bytes 为每个唯一 GLB 文件大小；tri/calls 按节点实例及 spec.tur 重复累计。');
console.log('primitive drawcounts 是单次绘制估算，不包含 shadow/pass、剔除、LOD 或驱动合批；未基准实测 GPU。');
console.log('POSITION/indices 为 mesh primitive accessor.count 之和（共享 accessor 可能重复计数，不是唯一顶点/显存）。');
console.log('\nGLB inventory: stored tri = mesh definitions; scene tri/calls = default scene node instances');
for (const asset of assets.values()) {
  console.log(`${asset.name}: bytes=${fmt(asset.bytes)} indices=${fmt(asset.indices)} indexedTri=${fmt(asset.indexedTriangles)} POSITION=${fmt(asset.position)} materials=${asset.materials} primitives=${asset.primitives} storedTri=${fmt(asset.storedTriangles)} sceneTri=${fmt(asset.sceneCost.triangles)} sceneCalls=${asset.sceneCost.calls}`);
  if (asset.name.startsWith('guns/')) console.log(`  ${asset.structure}; mounted tri/calls=${fmt(asset.mounted.triangles)}/${asset.mounted.calls}`);
}
console.log(`Manifest unique GLB download: ${fmt(sum([...assets.values()], 'bytes'))} bytes (${assets.size} files; excludes manifest/network overhead).`);
console.log('\nProcedural estimate: N=round(clamp(L/2,48,96)); S=N+1+2×interior sheer points.');
console.log(`hull=(S-1)×(2×RING=${2 * RING})×2; deck=(S-1)×2; foam=24×4; rail=60×4; 4 single-pass calls.`);
console.log('源码公式快照：src/render/shipModel.ts；不导入 renderer，不创建 canvas。仅适用 GLB 替换成功后的静态整舰。');
console.log('\nShips (current simulation specs; Blender secondary-layout drafts are not applied):');
function budget(label, actual, limit) {
  const over = actual > limit;
  console.log(`  ${over ? 'OVER' : 'OK'} ${label}: ${fmt(actual)} ${over ? '>' : '<='} ${fmt(limit)}`);
  if (over) failures.push(`${label}: ${actual} > ${limit}`);
}
for (const spec of Object.values(SPECS)) {
  const superName = `ships/${spec.key}_super`;
  const island = assets.get(superName);
  const unique = new Set([superName, ...spec.tur.map((t) => `guns/${t.kind}`)]);
  const missing = [...unique].filter((name) => !assets.has(name));
  if (missing.length) {
    issues.push(`${spec.key}: missing manifest assets ${missing.join(', ')}; whole-ship estimate unavailable`);
    console.log(`${spec.key}: INCOMPLETE (${missing.join(', ')})`);
    continue;
  }
  const proc = procedural(spec);
  const counts = new Map();
  for (const mount of spec.tur) {
    if (!TS[mount.kind]) issues.push(`${spec.key}: unknown turret shape ${mount.kind}`);
    const key = `${mount.sec ? 'secondary' : 'main'}:${mount.kind}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const guns = costSum(spec.tur.map((t) => assets.get(`guns/${t.kind}`).mounted));
  const bytes = sum([...unique].map((name) => assets.get(name)), 'bytes');
  const total = island.sceneCost.triangles + guns.triangles + proc.triangles;
  console.log(`${spec.key} ${spec.name} (${spec.cls}): uniqueDownload=${fmt(bytes)} bytes/${unique.size} GLBs; repeated GLB tri=${fmt(island.sceneCost.triangles + guns.triangles)} calls=${island.sceneCost.calls + guns.calls}`);
  console.log(`  procedural ~${fmt(proc.triangles)} tri: hull=${proc.hull} deck=${proc.deck} foam=${proc.foam} rail=${proc.rail}; wholeShip ~${fmt(total)} tri / ${island.sceneCost.calls + guns.calls + proc.calls} calls`);
  for (const [key, count] of counts) {
    const [role, kind] = key.split(':');
    const gun = assets.get(`guns/${kind}`).mounted;
    const gunSpec = GUNS[role === 'secondary' ? spec.sec : spec.gun];
    console.log(`  ${role} ${kind} (${gunSpec?.label || 'unknown gun'}, ${TS[kind]?.n ?? '?'} barrels): ${count} × ${fmt(gun.triangles)} tri/${gun.calls} calls = ${fmt(count * gun.triangles)} tri/${count * gun.calls} calls; download once`);
    if (spec.cls === 'BB' && role === 'main') budget(`${spec.key} ${kind} main/mount tri`, gun.triangles, limits['main-tri']);
    if (spec.cls === 'BB' && role === 'secondary' && TS[kind]?.n === 2) budget(`${spec.key} ${kind} twin secondary/mount tri`, gun.triangles, limits['secondary-tri']);
  }
  if (spec.key === 'us_bb') budget('Washington island (us_bb_super) tri', island.sceneCost.triangles, limits['island-tri']);
  if (spec.cls === 'BB') {
    budget(`${spec.key} unique download bytes`, bytes, limits['bb-bytes']);
    budget(`${spec.key} whole-ship estimated tri`, total, limits['ship-tri']);
    console.log(`  TARGET ${fmt(limits['target-tri'])} tri: ${total <= limits['target-tri'] ? 'met' : `above by ${fmt(total - limits['target-tri'])}`} (advisory)`);
  }
}
if (issues.length) console.log(`\nData/estimate issues:\n${[...new Set(issues)].map((s) => `- ${s}`).join('\n')}`);
console.log(`\n${failures.length} hard-limit exceedance(s). ${check ? 'Check enabled.' : 'Report only: budget exceedances do not change exit status.'}`);
// Incomplete data must not appear to pass validation; reserve exit 1 for budget excess.
if (check) process.exitCode = issues.length ? 2 : failures.length ? 1 : 0;
