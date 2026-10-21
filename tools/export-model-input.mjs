// Read-only with respect to simulation: snapshot its tables for the Blender builder.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPECS } from '../src/sim/ships.ts';
import { TS } from '../src/sim/guns.ts';

const ships = Object.fromEntries(Object.entries(SPECS).map(([key, s]) => [key, {
  key, cls: s.cls, nation: s.nation, L: s.L, B: s.B, F: s.F, D: s.D,
  top: s.top, sheer: s.sheer, stem: s.stem,
  deck: s.deck || (s.nation === 'US' ? (s.cls === 'DD' ? 'steel' : 'plank') : 'lino'),
  parts: s.parts, tur: s.tur,
}]));
const path = fileURLToPath(new URL('../art/blender/ship_input.json', import.meta.url));
writeFileSync(path, JSON.stringify({ ships, turrets: TS }, null, 2) + '\n');
console.log(`Exported ${Object.keys(ships).length} ships and ${Object.keys(TS).length} gun types to ${path}`);
