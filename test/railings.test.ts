import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECS } from '../src/sim/ships.ts';
import { deckY, hullSection, RING } from '../src/sim/hull.ts';
import { proceduralDeckPoint, proceduralRailPlan, railPlanCost } from '../src/render/deckOutline.ts';
import { buildTubeRailings } from '../src/render/railings.ts';

test('rail bases follow the same section edge and sheer as the procedural deck',()=>{
  for(const spec of Object.values(SPECS))for(const s of [.05,.25,.5,.7,.95]){
    const y=deckY(spec,(s-.5)*spec.L);
    const edge=hullSection(spec,s,y)[RING-1][0];
    const point=proceduralDeckPoint(spec,s,1);
    assert.equal(point[1],y);
    assert.ok(Math.abs(point[0]-(edge-.08))<1e-8);
  }
});

test('guards are three-dimensional tubes with real gaps, not side curtains',()=>{
  for(const spec of Object.values(SPECS)){
    const plan=proceduralRailPlan(spec);const geo=buildTubeRailings(plan);
    const p=geo.getAttribute('position');const idx=geo.getIndex()!;
    assert.equal(idx.count/3,railPlanCost(plan));
    assert.ok(idx.count/3>1000);
    // Three radial points in the first ring have distinct horizontal positions.
    assert.ok(new Set([0,1,2].map(i=>`${p.getX(i)},${p.getZ(i)}`)).size===3);
    assert.equal(geo.userData.physicalRailings,true);
    assert.ok([...p.array].every(Number.isFinite));
  }
});

test('guards stop at the destroyer forecastle step rather than crossing the bulkhead diagonally',()=>{
  const plan=proceduralRailPlan(SPECS.jp_dd);
  assert.equal(plan.runs.length,4);
  for(const run of plan.runs)for(let i=1;i<run.length;i++){
    assert.ok(Math.abs(run[i][1]-run[i-1][1])<.65);
  }
});
