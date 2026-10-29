/** Barycentric height of the actual graded water mesh, for depth-correct sea decals. */
export function waterTriangleHeight(
  x:number,z:number,time:number,axisX:ArrayLike<number>,axisZ:ArrayLike<number>,
  originX:number,originZ:number,field:(x:number,z:number,time:number)=>number,
):number {
  const locate=(axis:ArrayLike<number>,q:number):number=>{
    let lo=0,hi=axis.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(axis[mid]<=q)lo=mid;else hi=mid;}
    return Math.min(axis.length-2,lo);
  };
  if(![x,z,time,originX,originZ].every(Number.isFinite)||axisX.length<2||axisZ.length<2)return NaN;
  const lx=x-originX,lz=z-originZ;
  if(lx<axisX[0]||lx>axisX[axisX.length-1]||lz<axisZ[0]||lz>axisZ[axisZ.length-1])return field(x,z,time);
  const i=locate(axisX,lx),j=locate(axisZ,lz);
  const x0=axisX[i]+originX,x1=axisX[i+1]+originX,z0=axisZ[j]+originZ,z1=axisZ[j+1]+originZ;
  const u=(x-x0)/(x1-x0),v=(z-z0)/(z1-z0),h10=field(x1,z0,time),h01=field(x0,z1,time);
  if(u+v<=1)return field(x0,z0,time)*(1-u-v)+h10*u+h01*v;
  return field(x1,z1,time)*(u+v-1)+h10*(1-v)+h01*(1-u);
}
