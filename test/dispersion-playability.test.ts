import test from 'node:test';
import assert from 'node:assert/strict';
import { dispersionAt, scatterPoint, sigmaAt } from '../src/sim/ballistics.ts';
import { GUNS } from '../src/sim/guns.ts';
import { TargetLock } from '../src/sim/targetlock.ts';
import { Ship } from '../src/sim/ship.ts';
import { World } from '../src/sim/world.ts';
import { fireTurret, updateTurrets } from '../src/sim/gunnery.ts';

function seeded<T>(fn:()=>T):T {
  const original=Math.random;
  let state=12345;
  Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
  try{return fn();}finally{Math.random=original;}
}

test('primary close-range spread improves, long-range spread still grows, secondary tuning is retained',()=>{
  assert.ok(sigmaAt(GUNS.us406,5000).cross<12);
  assert.deepEqual(sigmaAt(GUNS.us406,10000),{along:56,cross:22});
  assert.ok(sigmaAt(GUNS.us406,20000).cross>45);
  assert.deepEqual(sigmaAt(GUNS.sec127,5000),{along:55,cross:24});
  for(const d of [-1,0,NaN,Infinity]) assert.ok(Object.values(sigmaAt(GUNS.us406,d)).every(Number.isFinite));
});

test('fresh target lock cannot add screen-wide error and effective sea pattern includes the correction',()=>{
  const lock=new TargetLock();
  assert.equal(lock.rangeError(10000),30);
  assert.ok(lock.rangeError(22000)<=45);
  const s=dispersionAt(GUNS.us406,10000,30);
  assert.equal(s.along,Math.hypot(56,30));
  assert.equal(s.cross,Math.hypot(22,15));
  assert.ok(s.cross<28);
});

test('seeded primary salvos remain centre biased and within the shared 2.5-radius outer tail',()=>seeded(()=>{
  const rows=[];
  for(const range of [5000,8000,10000,15000]) {
    const s=dispersionAt(GUNS.us406,range,0);
    let central=0,hits=0,hitSalvos=0,along2=0,cross2=0;
    const count=18000;
    for(let i=0;i<count;i++) {
      const [x,z]=scatterPoint(GUNS.us406,0,0,0,range,0);
      const a=(z-range)/s.along,c=x/s.cross;
      assert.ok(a*a+c*c<=6.25+1e-9);
      if(a*a+c*c<=1)central++;
      along2+=(z-range)**2;cross2+=x*x;
      // Ideal 118 x 10.4m destroyer rectangle, length along fire. This excludes lead/armour.
      if(Math.abs(x)<5.2 && Math.abs(z-range)<59)hits++;
      if(i%9===0) {
        let hit=false;
        for(let tube=0;tube<9;tube++) {
          const [sx,sz]=scatterPoint(GUNS.us406,0,0,0,range,0);
          if(Math.abs(sx)<5.2 && Math.abs(sz-range)<59)hit=true;
        }
        if(hit)hitSalvos++;
      }
    }
    assert.ok(central/count>.38 && central/count<.46);
    assert.ok(Math.sqrt(along2/count)>.85*s.along && Math.sqrt(cross2/count)<1.05*s.cross);
    rows.push({range,perShellHit:hits/count,salvoWithHit:hitSalvos/(count/9),sigma:s});
  }
  assert.ok(rows[1].salvoWithHit>.7,'8km should reward a correctly laid broadside');
  assert.ok(rows[3].salvoWithHit<rows[1].salvoWithHit-.18,'15km must remain less reliable');
  console.log('IDEAL STATIC TARGET DISPERSION',JSON.stringify(rows));
}));

test('each actual reload keeps its own duration and counts down without changing the total',()=>{
  const ship=new Ship(new World(),'us_bb','US','reload check');
  const first=ship.mainTurrets[0],second=ship.mainTurrets[1];
  first.reload=0;
  fireTurret(ship.w,ship,first,ship.x,ship.z+8000,0);
  const total=first.reloadTotal;
  assert.equal(first.reload,total);
  assert.ok(total>=29.1 && total<=31.5);
  const secondTotal=second.reloadTotal;
  updateTurrets(ship,1);
  assert.equal(first.reloadTotal,total);
  assert.ok(Math.abs(first.reload-(total-1))<1e-9);
  assert.equal(second.reloadTotal,secondTotal);
});
