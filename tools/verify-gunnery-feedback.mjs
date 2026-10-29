// Focused acceptance only. Run: node tools/verify-gunnery-feedback.mjs
// After inspecting the six PNGs: node tools/verify-gunnery-feedback.mjs --review '<JSON array of {name,finding}>'
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'art/blender/qa');
const RESULT = resolve(OUT, 'verify-gunnery-feedback-report.json');
const ORIGIN = 'http://localhost:5173/';
const NAMES = ['gunnery-reload-states.png', 'gunnery-reload-later.png', 'gunnery-scope-sea.png',
  'gunnery-land-hidden.png', 'gunnery-free-look.png', 'gunnery-compact.png'];
if (process.argv[2] === '--review') {
  const report = JSON.parse(readFileSync(RESULT, 'utf8'));
  const images = JSON.parse(process.argv[3]);
  assert.ok(Array.isArray(images) && images.length === 6 && new Set(images.map(x => x.name)).size === 6);
  assert.ok(images.every(x => NAMES.includes(x.name) && typeof x.finding === 'string' && existsSync(resolve(OUT, x.name))));
  const issues = images.filter(x => x.issue === true);
  report.automatedPassed ??= report.passed;
  report.failures = report.failures.filter(x => !x.startsWith('Visual review:'));
  for (const item of issues) report.failures.push(`Visual review: ${item.name}: ${item.finding}`);
  report.visualReview = { status: issues.length ? 'six images inspected; visual issues remain' : 'six images inspected',
    passed: issues.length === 0, images, reviewedAt: new Date().toISOString() };
  report.passed = report.automatedPassed && report.visualReview.passed;
  writeFileSync(RESULT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: RESULT, passed: report.passed, visualReview: report.visualReview }, null, 2));
  process.exit(report.passed ? 0 : 1);
}
const priorReport = existsSync(RESULT) ? JSON.parse(readFileSync(RESULT, 'utf8')) : null;
const previousVisualReviews = [...(priorReport?.previousVisualReviews || []),
  ...(priorReport?.visualReview?.images ? [priorReport.visualReview] : [])];
const report = { startedAt: new Date().toISOString(), origin: ORIGIN, checks: [], failures: [], screenshots: [], previousVisualReviews,
  snapshots: {}, console: [], pageErrors: [], networkErrors: [], visualReview: { status: 'pending image inspection' },
  limitations: [
    'Controlled fixture in a new isolated headless Edge process; no connection to or changes to the user browser/tab.',
    'Real Vite game modules, native player, Hud, Overlay, AimMarker and renderer. RAF is manually gated at 50ms.',
    'World.step is intercepted in this test page only to capture the native player and freeze simulation during fixture screenshots. Two countdown intervals invoke the ORIGINAL World.step, without changing its dt or reload implementation.',
    'First row is fired through __cmd.fire after runtime-only readiness/pointing setup; half-loaded/ready rows and differing reloadTotal values are controlled fixture data, not evidence of a natural 30-second battle.',
    'Headless ANGLE SwiftShader: no hardware performance claim. Separate main-agent pure-fire/reload tests are not run by this focused browser check.',
  ] };
const check = (passed, name, evidence = null) => {
  report.checks.push({ name, passed: !!passed, evidence });
  if (!passed) report.failures.push(name);
};
const sourceHashes = () => {
  const files = [];
  const visit = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name); if (e.isDirectory()) visit(p); else files.push(p);
  } };
  visit(resolve(ROOT, 'src')); files.push(resolve(ROOT, 'index.html'));
  return Object.fromEntries(files.sort().map(p => [relative(ROOT, p), createHash('sha256').update(readFileSync(p)).digest('hex')]));
};
const beforeHashes = sourceHashes();
let browser, page;
try {
  assert.ok(existsSync(resolve(ROOT, 'art/blender')), 'Missing output parent');
  mkdirSync(OUT, { recursive: true });
  assert.ok((await fetch(ORIGIN, { signal: AbortSignal.timeout(5000) })).ok, 'Existing Vite is unavailable');
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, protocolTimeout: 180000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio'] });
  page = await browser.newPage(); page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', m => report.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('requestfailed', r => report.networkErrors.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) report.networkErrors.push({ url: r.url(), status: r.status() }); });
  await page.evaluateOnNewDocument(() => {
    const pending = new Map(); let id = 0, clock = performance.now();
    window.requestAnimationFrame = fn => { pending.set(++id, fn); return id; };
    window.cancelAnimationFrame = key => pending.delete(key);
    window.__gunneryQA = { frozen: true, originalSteps: 0, simulatedDt: 0, frames: 0,
      draw: { calls: 0, ellipse: 0, sigmaText: [], maskFills: 0, maskArcs: 0, cross: 0 },
      step(n) { for (let i = 0; i < n; i++) {
        clock += 50; const batch = [...pending.values()]; pending.clear();
        for (const fn of batch) fn(clock); this.frames++;
      } } };
  });
  await page.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => !!window.__debug && !!window.__cmd);
  await page.evaluate(async () => {
    const q = window.__gunneryQA;
    // Reuse Vite's exact executed URLs, including HMR timestamps: importing the
    // bare path can create a different module/prototype in an already-running Vite.
    const moduleUrl = path => {
      const entries = performance.getEntriesByType('resource').filter(e => new URL(e.name).pathname === path);
      return entries.at(-1)?.name || path;
    };
    const [{ World }, { Overlay }, { AimMarker }, ballistics, terrain, { muzzleWorld }, projection] = await Promise.all([
      import(moduleUrl('/src/sim/world.ts')), import(moduleUrl('/src/ui/overlay.ts')), import(moduleUrl('/src/render/aimMarker.ts')),
      import(moduleUrl('/src/sim/ballistics.ts')), import(moduleUrl('/src/sim/terrain.ts')), import(moduleUrl('/src/sim/gunnery.ts')),
      import(moduleUrl('/src/render/aimProjection.ts')),
    ]);
    q.ballistics = ballistics; q.terrain = terrain; q.muzzleWorld = muzzleWorld; q.projection = projection;
    const nativeStep = World.prototype.step;
    World.prototype.step = function(dt, play) {
      const p = this.ships.find(s => s.isPlayer);
      if (p) { q.world = this; q.player = p; }
      if (p && q.frozen) return;
      if (p) { q.originalSteps++; q.simulatedDt += dt; }
      return nativeStep.call(this, dt, play);
    };
    const nativeDraw = Overlay.prototype.draw;
    Overlay.prototype.draw = function(s) {
      q.inDraw = true; q.draw.calls++;
      try { return nativeDraw.call(this, s); } finally { q.inDraw = false; }
    };
    const nativeCross = Overlay.prototype.drawCrosshair;
    Overlay.prototype.drawCrosshair = function(...args) {
      q.draw.cross++;
      q.draw.lastCross = { x:args[1], y:args[2], width:innerWidth, height:innerHeight };
      q.draw.maxCrossCenterError = Math.max(q.draw.maxCrossCenterError || 0, Math.hypot(args[1]-innerWidth/2,args[2]-innerHeight/2));
      return nativeCross.apply(this, args);
    };
    for (const method of ['ellipse', 'fillText', 'strokeText', 'arc', 'fill']) {
      const native = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function(...args) {
        if (q.inDraw) {
          if (method === 'ellipse') q.draw.ellipse++;
          if ((method === 'fillText' || method === 'strokeText') && /σ|sigma/i.test(String(args[0]))) q.draw.sigmaText.push(String(args[0]));
          if (method === 'arc' && args[2] > 100) q.draw.maskArcs++;
          if (method === 'fill' && this.fillStyle === 'rgba(2, 3, 5, 0.94)') q.draw.maskFills++;
        }
        return native.apply(this, args);
      };
    }
    const nativeUpdate = AimMarker.prototype.update;
    AimMarker.prototype.update = function(...args) {
      q.marker = this; q.markerArgs = args;
      return nativeUpdate.apply(this, args);
    };
    const badge = document.createElement('div'); badge.textContent = 'CONTROLLED FIXTURE · Gunnery QA';
    badge.style.cssText = 'position:fixed;top:72px;left:12px;z-index:10000;background:#101820dd;color:#e3c77e;font:11px monospace;padding:5px;pointer-events:none';
    document.body.appendChild(badge);
  });
  await page.click('#startBtn');
  const step = async n => { for (let i = 0; i < n; i += 4) await page.evaluate(k => window.__gunneryQA.step(k), Math.min(4, n - i)); };
  await step(1);
  await page.waitForFunction(() => window.__debug().models.loaded.includes('ships/us_bb_hull')
    && window.__debug().models.loaded.includes('ships/us_bb_super') && window.__debug().models.loaded.includes('guns/us16t'), { polling: 200 });
  const snap = async label => {
    const s = await page.evaluate(() => {
      const q = window.__gunneryQA, p = q.player;
      const rows = [...document.querySelectorAll('#wGunPips .reload-row')].map(row => {
        const fill = row.querySelector('.reload-fill'), time = row.querySelector('.reload-time'), aim = row.querySelector('.reload-aim');
        const rect = row.getBoundingClientRect();
        return { text: row.textContent, time: time.textContent, aim: aim.textContent,
          scale: Number(/scaleX\(([^)]+)\)/.exec(fill.style.transform)?.[1]), computed: getComputedStyle(fill).transform,
          fontSize: getComputedStyle(time).fontSize, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible: !!row.getClientRects().length && rect.width > 0 && rect.height > 0,
          inside: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          partsInside: [...row.children].every(el => { const b = el.getBoundingClientRect(); return b.x >= rect.x - 1 && b.right <= rect.right + 1; }) };
      });
      let maxHeightError = 0, maxPatternError = 0;
      const args = q.markerArgs, a = q.marker.geometry.attributes.position.array;
      const [ax, az, fx, fz, sigma, water, time] = args;
      const heightOffset = q.projection.AIM_PROJECTION_HEIGHT_OFFSET;
      const surfaceHeight = (x,z) => water.renderHeight?.(x,z,time) ?? water.height(x,z,time);
      let maxContinuousFieldDifference=0,minClearance=Infinity,maxClearance=-Infinity;
      const projectedVertices=[],projectedWidths=[];
      const d = Math.hypot(ax-fx, az-fz), ux=(ax-fx)/d, uz=(az-fz)/d;
      for (let i = 0; i < q.marker.stats.segments * 6; i += 3) {
        maxHeightError = Math.max(maxHeightError, Math.abs(a[i+1] - surfaceHeight(a[i], a[i+2]) - heightOffset));
        maxContinuousFieldDifference=Math.max(maxContinuousFieldDifference,Math.abs(surfaceHeight(a[i],a[i+2])-water.height(a[i],a[i+2],time)));
        const dx=a[i]-ax, dz=a[i+2]-az;
        maxPatternError = Math.max(maxPatternError, Math.abs(((dx*ux+dz*uz)/sigma.along)**2 + ((-dx*uz+dz*ux)/sigma.cross)**2-1));
      }
      const mesh=q.marker.group.children[0], outline=q.marker.group.children[1], ribbon=q.marker.ribbonGeometry;
      const r=ribbon.attributes.position.array, count=q.marker.stats.ribbonSegments;
      let finite=true,maxWidthError=0,maxRibbonHeightError=0,maxMidpointError=0,maxDuplicateError=0;
      for(let i=0;i<count;i++) {
        const off=i*18;
        for(let j=0;j<18;j++) finite &&= Number.isFinite(r[off+j]);
        for(const [left,right] of [[0,3],[6,15]]) {
          const l=off+left,h=off+right;
          maxWidthError=Math.max(maxWidthError,Math.abs(Math.hypot(r[l]-r[h],r[l+2]-r[h+2])-q.projection.AIM_PROJECTION_RIBBON_WIDTH));
        }
        const screen=[];
        for(let j=off;j<off+18;j+=3) {
          const clearance=r[j+1]-surfaceHeight(r[j],r[j+2]);
          minClearance=Math.min(minClearance,clearance);maxClearance=Math.max(maxClearance,clearance);
          maxRibbonHeightError=Math.max(maxRibbonHeightError,Math.abs(clearance-heightOffset));
          const v=window.__cmd.screenOf(r[j],r[j+1],r[j+2]);screen.push(v);projectedVertices.push(v);
        }
        const [al,ar,bl,,,br]=screen;
        const dx=(bl[0]+br[0]-al[0]-ar[0])/2,dy=(bl[1]+br[1]-al[1]-ar[1])/2,len=Math.hypot(dx,dy);
        if(len>1e-8) projectedWidths.push((Math.abs((al[0]-ar[0])*dy-(al[1]-ar[1])*dx)
          +Math.abs((bl[0]-br[0])*dy-(bl[1]-br[1])*dx))/(2*len));
        for(let k=0;k<3;k++) maxDuplicateError=Math.max(maxDuplicateError,Math.abs(r[off+6+k]-r[off+9+k]),Math.abs(r[off+3+k]-r[off+12+k]));
        // In open sea no strips are rejected: midpoints must preserve the sigma centerline.
        if(count===q.marker.stats.segments) {
          maxMidpointError=Math.max(maxMidpointError,
            Math.hypot((r[off]+r[off+3])/2-a[i*6],(r[off+2]+r[off+5])/2-a[i*6+2]),
            Math.hypot((r[off+6]+r[off+15])/2-a[i*6+3],(r[off+8]+r[off+17])/2-a[i*6+5]));
        }
      }
      projectedWidths.sort((a,b)=>a-b);
      const screenBounds=projectedVertices.length ? {
        minX:Math.min(...projectedVertices.map(v=>v[0])),maxX:Math.max(...projectedVertices.map(v=>v[0])),
        minY:Math.min(...projectedVertices.map(v=>v[1])),maxY:Math.max(...projectedVertices.map(v=>v[1])),
        allInClip:projectedVertices.every(v=>v[2]>=-1&&v[2]<=1),
      } : null;
      if(screenBounds) {screenBounds.width=screenBounds.maxX-screenBounds.minX;screenBounds.height=screenBounds.maxY-screenBounds.minY;}
      const ribbonEvidence={finite,maxWidthError,maxRibbonHeightError,maxMidpointError,maxDuplicateError,
        usesRenderHeight:typeof water.renderHeight==='function',maxContinuousFieldDifference,minClearance,maxClearance,
        screenBounds,projectedWidthPx:{min:projectedWidths[0],median:projectedWidths[Math.floor(projectedWidths.length/2)],max:projectedWidths.at(-1)},
        segments:count,vertexCount:ribbon.drawRange.count,centerlineVertexCount:q.marker.geometry.drawRange.count,
        meshName:mesh.name,isMesh:mesh.isMesh,renderedChildren:q.marker.group.children.length,
        usesRibbon:mesh.geometry===ribbon,
        centerlineBufferMatches:q.marker.geometry.attributes.position.array===q.marker.positions,
        outline:{name:outline?.name,isLineSegments:!!outline?.isLineSegments,
          usesExactCenterlineGeometry:outline?.geometry===q.marker.geometry,
          usesExactCenterlineBuffer:outline?.geometry?.attributes.position.array===q.marker.positions,
          vertexCount:outline?.geometry?.drawRange.count,materialType:outline?.material.type,
          depthTest:outline?.material.depthTest,depthWrite:outline?.material.depthWrite,fog:outline?.material.fog,
          linewidth:outline?.material.linewidth,sameMetricBias:outline?.material.onBeforeCompile===mesh.material.onBeforeCompile,
          sameColour:outline?.material.color.equals(mesh.material.color)},
        materialType:mesh.material.type,fog:mesh.material.fog,depthTest:mesh.material.depthTest,depthWrite:mesh.material.depthWrite,
        emissive:!!mesh.material.emissive,widthConstant:q.projection.AIM_PROJECTION_RIBBON_WIDTH};
      return { debug: window.__debug(), rows, main: p.mainTurrets.map(t => ({ reload:t.reload, reloadTotal:t.reloadTotal,
        inArc:t.inArc, onTarget:t.onTarget, sec:t.sec })), secondary: p.secTurrets.length,
        timerCount: document.querySelectorAll('.reload-time').length, gunPanelText:document.getElementById('wGun').textContent,
        draw: structuredClone(q.draw), maxHeightError, maxPatternError, actualSigma:sigma,heightOffset,ribbon:ribbonEvidence,
        projectedAim:window.__cmd.screenOf(ax,surfaceHeight(ax,az)+heightOffset,az),
        scopeMinimumY:p.bob+p.spec.F+p.spec.top+14,
        originalSteps:q.originalSteps, simulatedDt:q.simulatedDt, frozen:q.frozen };
    });
    if (label) report.snapshots[label] = s;
    return s;
  };
  const validateRows = (s, label) => {
    check(s.main.length === 3 && s.secondary === 10 && s.rows.length === 3 && s.timerCount === 3,
      `${label}: three main-only rows, no timers for thirteen combined mounts`, { mains:s.main.length, secondary:s.secondary, rows:s.rows.length, timers:s.timerCount });
    check(!/副炮/.test(s.gunPanelText), `${label}: no secondary battery HUD text`);
    check(s.rows.every((r,i) => {
      const t=s.main[i], expected=Math.max(0,Math.min(1,1-Math.max(0,t.reload)/t.reloadTotal));
      // CSSOM serializes transform numbers to about six significant digits.
      return Math.abs(r.scale-expected)<1e-6 && (t.reload<=0 ? r.time==='就绪' : r.time===`${Math.max(.1,t.reload).toFixed(1)}s`)
        && r.aim===(!t.inArc?'不在射界':!t.onTarget?'转向中':'已对准');
    }), `${label}: independent remaining/total, countdown and aim labels match native turret data`, s.rows);
    check(s.rows.every(r=>r.visible && r.inside && r.partsInside), `${label}: all row contents fit viewport`, s.rows);
  };
  const shot = async name => {
    const state = await snap(name);
    const png=await page.screenshot({ path:resolve(OUT,name), timeout:180000 });
    if(name==='gunnery-scope-sea.png' && state.ribbon.screenBounds) {
      // Inspect the already captured PNG, not another screenshot; never alter the rendered scene.
      report.scopePixels=await page.evaluate(async ({base64,bounds})=>{
        const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
        const x0=Math.max(0,Math.floor(bounds.minX)-2),y0=Math.max(0,Math.floor(bounds.minY)-2);
        const x1=Math.min(image.width,Math.ceil(bounds.maxX)+3),y1=Math.min(image.height,Math.ceil(bounds.maxY)+3);
        const w=x1-x0,h=y1-y0;if(w<=0||h<=0)return {region:{x0,y0,x1,y1},amberPixels:0};
        const {data}=c.getImageData(x0,y0,w,h),samples=[];let amberPixels=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
          const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];
          if(r>140&&g>90&&r>g*1.1&&g>b*1.3){amberPixels++;if(samples.length<24)samples.push({x:x0+x,y:y0+y,rgb:[r,g,b]});}
        }
        return {region:{x0,y0,x1,y1},amberPixels,samples,
          note:'Colour threshold is diagnostic only; visual review still decides ring readability.'};
      },{base64:Buffer.from(png).toString('base64'),bounds:state.ribbon.screenBounds});
    }
    report.screenshots.push({ name, path:resolve(OUT,name), controlledFixture:true, viewport:page.viewport(), rows:state.rows });
    console.log(`Captured ${name}`); return state;
  };
  report.fixture = await page.evaluate(() => {
    const q=window.__gunneryQA,p=q.player;
    // Choose a wet, in-range point with a wet outline, preferring broadside.
    let sea;
    for (let i=0;i<32&&!sea;i++) {
      const yaw=p.heading+Math.PI/2+i*Math.PI/16, x=p.x+Math.sin(yaw)*3000,z=p.z+Math.cos(yaw)*3000;
      if ([0,1,2,3,4,5,6,7].every(k=>q.terrain.terrainH(x+Math.cos(k*Math.PI/4)*350,z+Math.sin(k*Math.PI/4)*350)<-10)) sea={x,z};
    }
    if(!sea) throw Error('No suitable sea fixture'); q.sea=sea;
    window.__cmd.aimAt(sea.x,sea.z);
    p.mainTurrets.forEach((t,i)=>{t.reload=i?10:0;t.rel=Math.atan2(sea.x-p.x,sea.z-p.z)-p.heading;t.onTarget=true;t.inArc=true;});
    const before=q.world.shells.length; window.__cmd.fire();
    q.fire={newShells:q.world.shells.length-before,reload:p.mainTurrets[0].reload,reloadTotal:p.mainTurrets[0].reloadTotal};
    p.mainTurrets[1].reloadTotal=22;p.mainTurrets[1].reload=11;
    p.mainTurrets[2].reloadTotal=37;p.mainTurrets[2].reload=0;
    return { sea,fire:q.fire,player:{x:p.x,z:p.z},mainCount:p.mainTurrets.length,secondaryCount:p.secTurrets.length };
  });
  check(report.fixture.fire.newShells === 3 && report.fixture.fire.reload > 25
    && report.fixture.fire.reload === report.fixture.fire.reloadTotal, 'Real __cmd.fire creates shells and records actual reloadTotal for first controlled mount',report.fixture.fire);
  await step(100);
  const initial=await shot(NAMES[0]); validateRows(initial,'initial');
  check(initial.rows[0].scale===0 && initial.rows[1].scale===.5 && initial.rows[2].scale===1,
    'Controlled fixture shows just-fired, half-loaded and ready simultaneously',initial.main);
  const ticks=[initial];
  for(let i=0;i<2;i++) {
    await page.evaluate(()=>{window.__gunneryQA.frozen=false;}); await step(12);
    await page.evaluate(()=>{window.__gunneryQA.frozen=true;}); ticks.push(await snap(`native-tick-${i+1}`));
  }
  for(let i=1;i<ticks.length;i++) {
    validateRows(ticks[i],`native-tick-${i}`);
    check([0,1].every(j=>parseFloat(ticks[i].rows[j].time)<parseFloat(ticks[i-1].rows[j].time)
      && ticks[i].rows[j].scale>ticks[i-1].rows[j].scale),`Original World.step interval ${i}: text decreases and continuous fill increases`,
    {before:ticks[i-1].rows,after:ticks[i].rows,steps:ticks[i].originalSteps,dt:ticks[i].simulatedDt});
  }
  await shot(NAMES[1]);
  await page.evaluate(()=>{const q=window.__gunneryQA;window.__cmd.aimAt(q.sea.x,q.sea.z);window.__cmd.zoom(1);}); await step(80);
  const sea=await shot(NAMES[2]),sp=sea.debug.seaProjection;
  check(sp.valid && sp.visible && sp.segments>0 && sp.depthTest===true && sp.depthWrite===false,'Sea projection valid, visible, depth-tested and non-depth-writing',sp);
  check(Number.isFinite(sea.heightOffset) && sea.maxHeightError<.002 && sea.maxPatternError<.002,
    'Debug centerline follows rendered water surface plus imported height offset and unchanged effective world sigma',
    {heightOffset:sea.heightOffset,maxHeightError:sea.maxHeightError,maxPatternError:sea.maxPatternError,sigma:sea.actualSigma});
  const ribbon=sea.ribbon;
  check(sp.ribbonSegments>0 && sp.ribbonSegments===sp.segments && sp.ribbonWidth===1 && sp.fog===false,
    'Open-sea stats expose all surviving strips, one-metre width and no fog',sp);
  check(ribbon.isMesh && ribbon.meshName==='aim-sea-ribbon' && ribbon.renderedChildren===2 && ribbon.usesRibbon
    && ribbon.centerlineBufferMatches && ribbon.vertexCount===sp.ribbonSegments*6
    && ribbon.centerlineVertexCount===sp.segments*2,
    'Exactly ribbon mesh plus centreline stroke: six ribbon vertices and two centreline vertices per segment',ribbon);
  const outline=ribbon.outline;
  check(outline.name==='aim-sea-outline' && outline.isLineSegments && outline.usesExactCenterlineGeometry
    && outline.usesExactCenterlineBuffer && outline.vertexCount===sp.segments*2 && outline.linewidth===1,
    'One-pixel world outline renders the exact sigma geometry and buffer, not a second radius',outline);
  check(outline.materialType==='LineBasicMaterial' && outline.depthTest===true && outline.depthWrite===false
    && outline.fog===false && outline.sameMetricBias && outline.sameColour,
    'Outline and ribbon share metric bias and colour; both retain depth testing and disable fog/depth writes',outline);
  check(ribbon.finite && ribbon.maxWidthError<.002 && ribbon.maxRibbonHeightError<.002
    && ribbon.maxMidpointError<.002 && ribbon.maxDuplicateError===0 && ribbon.widthConstant===1,
    'Actual ribbon has finite vertices, one-metre world width, wave-following corners and unchanged sigma midpoints',ribbon);
  check(ribbon.materialType==='MeshBasicMaterial' && !ribbon.emissive && ribbon.fog===false
    && ribbon.depthTest===true && ribbon.depthWrite===false,'Actual ribbon material is unlit, fog-free and depth-tested',ribbon);
  check(ribbon.usesRenderHeight && Math.abs(ribbon.minClearance-sea.heightOffset)<.002
    && Math.abs(ribbon.maxClearance-sea.heightOffset)<.002,
    'Actual ribbon stays at configured clearance above raster water surface, not arbitrarily airborne',ribbon);
  check(sea.debug.camera.y>=sea.scopeMinimumY-.01,'Scope camera clears hull top plus fourteen metres including bob',
    {cameraY:sea.debug.camera.y,minimumY:sea.scopeMinimumY});
  check(sea.draw.maxCrossCenterError===0 && sea.draw.cross>0,'Instrumented crosshair stays at screen centre',sea.draw);
  check(Math.hypot(sea.projectedAim[0]-720,sea.projectedAim[1]-450)>5,
    'Actual sea impact projection is separate from fixed screen-centre crosshair',sea.projectedAim);
  check(['along','cross'].every(k=>Math.round(sea.actualSigma[k])===sea.debug.overlay.sigma[k]),'Overlay debug sigma is the effective projected pattern',sea.debug.overlay.sigma);
  const mask = await page.evaluate(() => {
    const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===innerWidth && c.getContext('2d'));
    if(!cv)return null;
    const c=cv.getContext('2d'),pixel=(x,y)=>[...c.getImageData(x,y,1,1).data];
    return {corner:pixel(8,8),centre:pixel(Math.floor(innerWidth/2+20),Math.floor(innerHeight/2+20))};
  });
  check(sea.draw.maskArcs>0 && sea.draw.maskFills>0 && mask?.corner[3]>220 && mask?.corner.slice(0,3).every(v=>v<10)
    && mask?.centre[3]<100,'Binocular circular black field stop remains, with transparent viewing centre',{draw:sea.draw,pixels:mask});
  const land=await page.evaluate(()=>{
    const q=window.__gunneryQA,p=q.player;
    const island=q.terrain.ISL.find(i=>Math.hypot(i.x-p.x,i.z-p.z)<p.gun.range);
    if(!island)throw Error('No in-range land fixture');
    window.__cmd.aimAt(island.x,island.z);
    return {x:island.x,z:island.z,height:q.terrain.terrainH(island.x,island.z),range:Math.hypot(island.x-p.x,island.z-p.z),max:p.gun.range};
  }); await step(60);
  const landState=await shot(NAMES[3]);
  check(land.height>10 && land.range<land.max && !landState.debug.seaProjection.valid && !landState.debug.seaProjection.visible,
    'In-range land aim hides projection (not just a range failure)',{land,projection:landState.debug.seaProjection});
  await page.evaluate(()=>{const q=window.__gunneryQA,p=q.player;window.__cmd.aimAt(p.x+2*p.gun.range,p.z);}); await step(1);
  const range=await snap('out-of-range');
  check(!range.debug.seaProjection.valid && !range.debug.seaProjection.visible,'Out-of-range aim hides projection',range.debug.seaProjection);
  await page.evaluate(()=>{const q=window.__gunneryQA;window.__cmd.aimAt(q.sea.x,q.sea.z);window.__cmd.freeLook(1);}); await step(65);
  const free=await shot(NAMES[4]);
  check(free.debug.cameraControl.freeLook && free.debug.overlay.observing && free.debug.seaProjection.valid && !free.debug.seaProjection.visible,
    'Free look hides otherwise valid sea projection',free.debug.seaProjection);
  await page.evaluate(()=>{window.__cmd.freeLook(0);window.__cmd.zoom(0);});
  await page.setViewport({width:960,height:640,deviceScaleFactor:1}); await step(80);
  const compact=await shot(NAMES[5]); validateRows(compact,'960x640 compact');
  check(compact.debug.seaProjection.visible,'Compact view restores sea projection',compact.debug.seaProjection);
  check(compact.draw.calls>100 && compact.draw.ellipse===0 && compact.draw.sigmaText.length===0 && compact.draw.cross>0,
    'Instrumented real Overlay.draw: cross present, zero Canvas2D ellipse / sigma text calls',compact.draw);
  await page.evaluate(()=>window.__cmd.aimAtNearest());
  await page.keyboard.press('KeyX'); await step(1);
  const locked=await snap('fresh-live-lock');
  check(!!locked.debug.lock && locked.debug.lock.err<=45 && locked.debug.seaProjection.valid,
    'Real game fresh target lock has bounded rangefinder penalty',locked.debug.lock);
  const lockPattern=await page.evaluate(()=>{
    const q=window.__gunneryQA,p=q.player,d=Math.hypot(p.aimX-p.x,p.aimZ-p.z);
    // Actual projection receives the unrounded live error; debug err is rounded.
    const base=q.ballistics.sigmaAt(p.gun,d),s=q.markerArgs[4];
    return {base,effective:s,inferredError:Math.sqrt(Math.max(0,s.along*s.along-base.along*base.along)),
      overlay:window.__debug().overlay.sigma};
  });
  check(lockPattern.inferredError<=45.000001 && ['along','cross'].every(k=>Math.round(lockPattern.effective[k])===lockPattern.overlay[k]),
    'Fresh live lock: effective penalty reaches actual sea projection and overlay debug',lockPattern);
  await step(40); const settled=await snap('settled-live-lock');
  check(!!settled.debug.lock && settled.debug.lock.err<locked.debug.lock.err,
    'Live lock penalty converges downward after two seconds of normal frame time',
    {fresh:locked.debug.lock,settled:settled.debug.lock});
  const overlay=readFileSync(resolve(ROOT,'src/ui/overlay.ts'),'utf8');
  const ballistics=readFileSync(resolve(ROOT,'src/sim/ballistics.ts'),'utf8');
  const lock=readFileSync(resolve(ROOT,'src/sim/targetlock.ts'),'utf8');
  check(!/drawEllipse\s*\(/.test(overlay) && !/\.ellipse\s*\(/.test(overlay),'Read-only source support: no legacy overlay ellipse path');
  check(/const s = dispersionAt\(gun, d, err\)/.test(ballistics),'Read-only source support: real scatter sampler shares effective pattern');
  report.dispersionEvidence=await page.evaluate(()=>{
    const q=window.__gunneryQA,g=q.player.gun,d=3000;
    const base=q.ballistics.sigmaAt(g,d),effective=q.ballistics.dispersionAt(g,d,100);
    const samples=Array.from({length:256},()=>q.ballistics.scatterPoint(g,0,0,d,0,100));
    return {gun:g.id,reference:g.disp,base,effective,maxNormalizedRadius:Math.max(...samples.map(([x,z])=>Math.hypot((x-d)/effective.along,z/effective.cross))),
      note:'Actual imported sampler, 256 points; bounded-tail check, not a statistical accuracy benchmark or historical comparison.'};
  });
  check(report.dispersionEvidence.maxNormalizedRadius<=2.500001,'Real main scatter sampler respects tightened 2.5-sigma tail bound',report.dispersionEvidence);
  report.lockPenaltySource=lock.split('\n').filter(l=>/rangeError|\.0[0-9]|\.1[0-9]|err|penalty/i.test(l));
} catch(error) { report.failures.push(error.stack || String(error)); }
finally {
  if(browser)await browser.close();
  check(report.pageErrors.length===0,'No browser page errors',report.pageErrors);
  const errors=report.console.filter(m=>m.type==='error');
  check(errors.length===0,'No console/shader errors',errors);
  report.shaderMessages=report.console.filter(m=>/shader|webgl|GL_INVALID|THREE.*Error/i.test(m.text));
  check(!report.shaderMessages.some(m=>/error|failed|GL_INVALID/i.test(m.text)),'No shader compilation/WebGL errors',report.shaderMessages);
  check(report.networkErrors.length===0,'No failed network requests',report.networkErrors);
  check(JSON.stringify(sourceHashes())===JSON.stringify(beforeHashes),'All src files and index.html hashes unchanged');
  check(report.screenshots.length===6 && report.screenshots.every((s,i)=>s.name===NAMES[i]),'Exactly the six requested screenshots saved',report.screenshots.map(s=>s.name));
  report.finishedAt=new Date().toISOString();report.passed=report.failures.length===0;report.automatedPassed=report.passed;
  if(existsSync(OUT))writeFileSync(RESULT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,report:RESULT,checks:report.checks.length,failures:report.failures},null,2));
}
process.exitCode=report.passed?0:1;
