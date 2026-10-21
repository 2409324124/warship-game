// A tiny, dependency-free index of which Blender models actually exist.
//
// Without it the game would have to ask the server for `ships/<key>_super.glb`, `guns/<kind>.glb`
// and so on for every ship and every turret - a dozen 404s a battle, and GLTFLoader pulled in for
// nothing. With it, an empty or missing manifest means the loader is never even imported.
//
// public/models/manifest.json:
//   { "models": ["ships/us_bb_super", "guns/us16t", "landmarks/palm"] }
// (names without the .glb)

let available: Set<string> | null = null;
let pending: Promise<void> | null = null;

export function loadModelManifest(): Promise<void> {
  if (!pending) {
    pending = fetch('/models/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list: string[] = Array.isArray(j?.models) ? j.models : [];
        available = new Set(list);
      })
      .catch(() => {
        available = new Set();
      });
  }
  return pending;
}

/** False until the manifest has been read, so nothing tries to load too early. */
export function hasModel(name: string): boolean {
  return available ? available.has(name) : false;
}

export function anyModel(): boolean {
  return !!available && available.size > 0;
}

export function modelList(): string[] {
  return available ? [...available] : [];
}
