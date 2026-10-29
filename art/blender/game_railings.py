"""Opaque perimeter guard: posts, two horizontal tubes, and closed bow/stern ends."""
import math

HEIGHT=1.05
SPACING=2.5
POST_RADIUS=.06
BAR_RADIUS=.048
COLOUR=(.66,.70,.73)


def add_deck_railings(api,buf,edge,length):
    n=math.ceil(length/SPACING)
    stations=[.004+(.998-.004)*i/n for i in range(n+1)]
    feet=[];rods=0
    def tube(a,b,r):
        nonlocal rods
        v,f=api['p_rod'](a,b,r,3)
        buf.emit(v,f[:6],col=COLOUR);rods+=1
    def post(p):
        x,y,z=p;feet.append(p)
        tube((x,y-.03,z),(x,y+HEIGHT,z),POST_RADIUS)
    def bars(p,q):
        for h in (.52,HEIGHT):tube((p[0],p[1]+h,p[2]),(q[0],q[1]+h,q[2]),BAR_RADIUS)
    for side in (-1,1):
        previous=None
        for s in stations:
            x,y,z=edge(s);p=(side*max(.08,x-.08),y,z)
            post(p)
            if previous is not None:
                if not (abs(y-previous[1])>.65 and abs(z-previous[2])<1.5):bars(previous,p)
            previous=p
    for s in (stations[0],stations[-1]):
        x,y,z=edge(s);x=max(.08,x-.08)
        a,b=(-x,y,z),(x,y,z);bars(a,b)
        count=math.ceil(2*x/SPACING)
        for i in range(1,count):post((-x+2*x*i/count,y,z))
    buf.rail_feet=feet
    buf.rail_stats={'height':HEIGHT,'post_spacing':SPACING,'post_diameter':2*POST_RADIUS,
                    'bar_diameter':2*BAR_RADIUS,'posts':len(feet),'rods':rods,'triangles':rods*6}
    return buf.rail_stats
