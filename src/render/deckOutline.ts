import { deckY, hullSection, RING } from '../sim/hull.ts';
import type { ShipSpec } from '../sim/ships.ts';

export type DeckPoint = [number, number, number];
export interface RailPlan { runs: DeckPoint[][]; caps: [DeckPoint, DeckPoint][] }
export const RAIL_SPACING = 2.5;
export const RAIL_HEIGHT = 1.05;

export function bowRake(spec: ShipSpec, s: number): number {
  return spec.stem === 'clipper' && s > .9 ? (s - .9) / .1 * spec.B * .14 : 0;
}

/** Exactly the deck-edge section used by buildHull, not a second width formula. */
export function proceduralDeckPoint(spec: ShipSpec, s: number, side: number): DeckPoint {
  const z=(s-.5)*spec.L;
  const top=deckY(spec,z);
  const half=hullSection(spec,s,top)[RING-1][0];
  return [side*Math.max(.08,half-.08),top,z+bowRake(spec,s)];
}

export function proceduralRailPlan(spec: ShipSpec): RailPlan {
  const n=Math.ceil(spec.L/RAIL_SPACING);
  const stations=new Set<number>();
  for(let i=0;i<=n;i++)stations.add(.004+(.998-.004)*i/n);
  for(const [s] of spec.sheer)if(s>.004&&s<.998)stations.add(s);
  const sorted=[...stations].sort((a,b)=>a-b);
  const runs: DeckPoint[][]=[];
  for(const side of [-1,1]){
    let run: DeckPoint[]=[];
    for(const s of sorted){
      const point=proceduralDeckPoint(spec,s,side);
      const last=run.at(-1);
      // End the guard at a forecastle bulkhead instead of slanting it through air.
      if(last&&Math.abs(point[1]-last[1])>.65&&Math.abs(point[2]-last[2])<1.5){
        if(run.length>1)runs.push(run);run=[];
      }
      run.push(point);
    }
    if(run.length>1)runs.push(run);
  }
  return {runs,caps:[
    [proceduralDeckPoint(spec,.004,-1),proceduralDeckPoint(spec,.004,1)],
    [proceduralDeckPoint(spec,.998,-1),proceduralDeckPoint(spec,.998,1)],
  ]};
}

export function railPlanCost(plan: RailPlan): number {
  let rods=0;
  for(const run of plan.runs)rods+=run.length+2*(run.length-1);
  for(const [a,b] of plan.caps){
    rods+=2+Math.max(0,Math.ceil(Math.hypot(a[0]-b[0],a[2]-b[2])/RAIL_SPACING)-1);
  }
  return rods*6; // three sides, two triangles per side; joints cover open ends
}
