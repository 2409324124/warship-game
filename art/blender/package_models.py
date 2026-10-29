"""Create a non-destructive, checksummed modelling delivery through checkpoint 30."""
import hashlib
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'art'
PREFIX = 'warship_models'


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    assert (ART / 'blender' / 'checkpoint_30_fletcher_guns_and_bridge.blend').is_file()
    files = set()
    allowed = {'.blend', '.py', '.json', '.md', '.txt', '.png', '.jpg', '.jpeg', '.webp', '.pdf', '.svg'}
    for p in (ART / 'blender').rglob('*'):
        if p.is_file() and p.suffix.lower() in allowed and '__pycache__' not in p.parts:
            files.add(p)
    for p in ART.iterdir():
        if p.is_file() and p.suffix.lower() in {'.md', '.png', '.jpg', '.jpeg', '.webp'}:
            files.add(p)
    # Freeze the corresponding runtime geometry and integration source, not only blend files.
    for dirname in ('public/models', 'src', 'test', 'tools'):
        for p in (ROOT / dirname).rglob('*'):
            if p.is_file() and p.suffix.lower() in {'.glb', '.json', '.ts', '.mjs', '.js', '.css', '.svg', '.png'}:
                files.add(p)
    for name in ('README.md', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json',
                 'vite.config.ts', '.gitignore'):
        p = ROOT / name
        if p.is_file():
            files.add(p)
    files = sorted(files, key=lambda p: p.relative_to(ROOT).as_posix())
    checkpoints = [p for p in files if p.suffix == '.blend']
    models = [p for p in files if p.suffix == '.glb']
    assert len(checkpoints) == 30, len(checkpoints)
    assert len(models) == 19, len(models)

    delivery_root = ART / 'deliveries'
    delivery_root.mkdir(exist_ok=True)
    label = '2026-10-26_fletcher_approved'
    dest = delivery_root / label
    counter = 1
    while dest.exists():
        dest = delivery_root / (label + '_' + str(counter).zfill(2))
        counter += 1
    dest.mkdir()
    archive = dest / 'warship_models_through_checkpoint_30.zip'
    inventory = []
    for p in files:
        inventory.append({'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size,
                          'sha256': sha256(p)})
    readme = f'''# 战舰建模交付包 — 弗莱彻已认可版

用户认可：“特别好 这个驱逐舰也做的很好”。归档批次：{label}。

## 先打开这些文件
- 最新认可弗莱彻：art/blender/checkpoint_30_fletcher_guns_and_bridge.blend
- 弗莱彻说明：art/blender/FLETCHER_GUNS_AND_BRIDGE.md
- 华盛顿/北卡罗来纳级游戏版：art/blender/checkpoint_27_washington_game_bow_and_rails.blend
- 雾岛游戏版：art/blender/checkpoint_25_kirishima_game_ready.blend
- 吹雪精修预览：art/blender/checkpoint_17_fubuki_refined.blend
- 总体说明：art/blender/README.md

## 范围
- 全部{len(checkpoints)}个阶段blend存档，包括原六舰、炮塔和历次修型阶段。
- Blender重建脚本、控制JSON、测试、阶段文档、参考照片和现有QA截图。
- public/models：当前游戏使用的{len(models)}份GLB及manifest。
- src、test、tools及项目基础配置：对应的游戏集成源码快照，方便追溯挂点和导出约定。
- INVENTORY.json：逐文件大小和SHA-256；目录外的SHA256SUMS.txt提供整包校验值。

## 重要状态
- 弗莱彻30版与吹雪17版仍为精修预览，未替换当前游戏中的旧驱逐舰GLB。
- 弗莱彻视觉甲板高度不同于旧模拟；接入时必须处理炮位、耳轴和炮口坐标，不能只换船壳。
- 弗莱彻约17,182三角面，单炮686；已完成炮口和五个仰角几何检查，用户已认可。
- 华盛顿和雾岛已接入游戏；华盛顿副炮错列布局仍是草稿，没有同步模拟。
- 高雄和新奥尔良保留此前版本，本批次未重新精修。
- 不覆盖、不移动原文件，也不覆盖旧warship_model_bundle.zip。
- 不收录旧ZIP、blend1自动备份、缓存、node_modules、.git或本机鉴权配置。

## 使用
解压后保留warship_models目录结构，用Blender打开上述blend即可查看。
重建脚本中存在原工作区D:\\warship-game的绝对路径；更换目录后需先调整ROOT/输出路径，
不要直接运行旧脚本覆盖其他项目的文件。源码快照用于留档，不含node_modules，
重新运行游戏需要自行安装依赖。本交付包不是宣称所有历史草稿均为最终成品。
'''
    manifest = {'batch': label, 'latest_approved': 'art/blender/checkpoint_30_fletcher_guns_and_bridge.blend',
                'source_file_count': len(files), 'blend_count': len(checkpoints), 'glb_count': len(models),
                'files': inventory}
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2)
    (dest / 'DELIVERY_README.md').write_text(readme, encoding='utf-8')
    (dest / 'INVENTORY.json').write_text(manifest_text, encoding='utf-8')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        z.writestr(PREFIX + '/DELIVERY_README.md', readme)
        z.writestr(PREFIX + '/INVENTORY.json', manifest_text)
        for p in files:
            z.write(p, PREFIX + '/' + p.relative_to(ROOT).as_posix())
    # Check every archived byte against the original manifest, not just member count.
    with zipfile.ZipFile(archive) as z:
        assert len(z.namelist()) == len(files) + 2
        for entry in inventory:
            h = hashlib.sha256()
            size = 0
            with z.open(PREFIX + '/' + entry['path']) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    size += len(block)
                    h.update(block)
            assert size == entry['bytes'] and h.hexdigest() == entry['sha256'], entry['path']
    digest = sha256(archive)
    (dest / 'SHA256SUMS.txt').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
    report = {'archive': str(archive), 'bytes': archive.stat().st_size,
              'MiB': round(archive.stat().st_size / 1024 ** 2, 2),
              'source_file_count': len(files), 'archive_members': len(files) + 2,
              'blend_count': len(checkpoints), 'glb_count': len(models),
              'sha256': digest, 'verification': 'All source entries SHA-256 and sizes verified after decompression'}
    (dest / 'VERIFICATION.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
