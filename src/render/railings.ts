import * as THREE from 'three';
import { RAIL_HEIGHT, RAIL_SPACING, type DeckPoint, type RailPlan } from './deckOutline.ts';

/** Opaque low-poly tubes: real posts and two horizontal rails, not solid side curtains. */
export function buildTubeRailings(plan: RailPlan): THREE.BufferGeometry {
  const positions:number[]=[],indices:number[]=[];
  function tube(p:DeckPoint,q:DeckPoint,radius:number){
    const a=new THREE.Vector3(...p),b=new THREE.Vector3(...q);
    const axis=b.clone().sub(a).normalize();
    const ref=Math.abs(axis.y)>.95?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
    const u=new THREE.Vector3().crossVectors(axis,ref).normalize();
    const v=new THREE.Vector3().crossVectors(axis,u).normalize();
    const start=positions.length/3;
    for(const end of [a,b])for(let i=0;i<3;i++){
      const angle=i*Math.PI*2/3;
      const point=end.clone().addScaledVector(u,Math.cos(angle)*radius).addScaledVector(v,Math.sin(angle)*radius);
      positions.push(point.x,point.y,point.z);
    }
    for(let i=0;i<3;i++){
      const j=(i+1)%3;
      indices.push(start+i,start+j,start+3+j,start+i,start+3+j,start+3+i);
    }
  }
  function post(p:DeckPoint){tube([p[0],p[1]-.03,p[2]],[p[0],p[1]+RAIL_HEIGHT,p[2]],.06);}
  function bars(a:DeckPoint,b:DeckPoint){
    for(const h of [.52,RAIL_HEIGHT])tube([a[0],a[1]+h,a[2]],[b[0],b[1]+h,b[2]],.048);
  }
  for(const run of plan.runs){
    run.forEach(post);
    for(let i=1;i<run.length;i++)bars(run[i-1],run[i]);
  }
  for(const [a,b] of plan.caps){
    bars(a,b);
    const n=Math.ceil(Math.hypot(a[0]-b[0],a[2]-b[2])/RAIL_SPACING);
    for(let i=1;i<n;i++)post([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,a[2]+(b[2]-a[2])*i/n]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData={physicalRailings:true,height:RAIL_HEIGHT,postSpacing:RAIL_SPACING};
  return geometry;
}
