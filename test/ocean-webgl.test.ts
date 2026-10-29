// Optional real WebGL acceptance: OCEAN_WEBGL_URL=http://127.0.0.1:5173 npm test
// Requires an existing Vite server and Edge (or BROWSER). Pure CPU coverage lives in ocean.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import puppeteer from 'puppeteer-core';

test('ocean compiles, stays one draw call, and GPU height/slopes match CPU under salvos', {
  skip: !process.env.OCEAN_WEBGL_URL, timeout: 120000,
}, async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.isNavigationRequest()) void r.respond({ status: 200, contentType: 'text/html',
        body: '<!doctype html><link rel="icon" href="data:,"><body style="margin:0"></body>' });
      else void r.continue();
    });
    await page.goto(process.env.OCEAN_WEBGL_URL!, { waitUntil: 'networkidle0' });
    // Vite resolves these browser imports. Keep them out of Node's TS/module resolution.
    const report = await page.evaluate(async () => {
      const load = (path: string): Promise<any> => import(/* @vite-ignore */ path);
      const src = await (await fetch('/src/render/water.ts')).text();
      const threeURL = src.match(/from\s*["']([^"']*\/three[^"']*)["']/)?.[1];
      if (!threeURL) throw new Error('Cannot find optimized Three URL');
      const [THREE, { createWater }, model] = await Promise.all([
        load(threeURL), load('/src/render/water.ts'), load('/src/render/oceanModel.ts'),
      ]);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1000, 700); document.body.append(renderer.domElement);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const shaderErrors: string[] = [];
      renderer.debug.onShaderError = (gl: any, program: any, vs: any, fs: any) => {
        shaderErrors.push(`${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`);
      };
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa4ad);
      const water = createWater(scene, 0.000075);
      const camera = new THREE.PerspectiveCamera(55, 1000 / 700, 0.3, 90000);
      camera.position.set(105, 32, 140); camera.lookAt(0, 0, 0);
      const pool = new model.OceanBlasts();
      const points = [[0, 0], [4, -3], [11, 0], [17, 5], [28, -3], [74, 10], [500, -330], [-5000, 4321]];
      const probe = new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `precision highp float; ${model.OCEAN_GLSL}
          uniform vec2 uPoints[8];
          void main() {
            vec2 p = uPoints[0];
            for (int i = 0; i < 8; i++) { if (int(gl_FragCoord.x) == i) p = uPoints[i]; }
            vec4 sea = oceanSurface(p), blast = blastSurface(p);
            gl_FragColor = vec4(sea.xyz + blast.xyz, blast.w);
          }`,
        uniforms: { ...water.mesh.material.uniforms,
          uPoints: { value: points.map(([x, z]) => new THREE.Vector2(x, z)) } },
      });
      const probeScene = new THREE.Scene();
      probeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), probe));
      const target = new THREE.WebGLRenderTarget(8, 1, { type: THREE.FloatType, depthBuffer: false });
      const cases: { name: string; error: number; calls: number }[] = [];
      const check = (name: string, t: number) => {
        water.update(t, camera.position); pool.update(t);
        renderer.setRenderTarget(null); renderer.render(scene, camera);
        const calls = renderer.info.render.calls;
        renderer.setRenderTarget(target); renderer.render(probeScene, camera);
        const pixels = new Float32Array(32); renderer.readRenderTargetPixels(target, 0, 0, 8, 1, pixels);
        let error = 0;
        points.forEach(([x, z], i) => {
          const sea = model.sampleOcean(x, z, t), blast = pool.sample(x, z, t);
          const expected = [water.height(x, z, t), sea.dx + blast.dx, sea.dz + blast.dz, blast.foam];
          expected.forEach((v, j) => { error = Math.max(error, Math.abs(v - pixels[i * 4 + j])); });
        });
        cases.push({ name, error, calls });
      };
      check('ambient', 42);
      water.blast(0, 0, 406); pool.blast(0, 0, 406);
      water.blast(4, -3, 356, 7); pool.blast(4, -3, 356, 7);
      check('two muzzles', 42.45);
      for (let i = 0; i < 100; i++) { water.blast(0, 0, 406); pool.blast(0, 0, 406); }
      check('saturated salvo', 42.6);
      check('expired', 46.2);
      check('late game clock', 1e6);
      water.resetBlasts(); pool.reset(); check('reset and rewind', 42.45);
      // Leave a representative close-up with a short-lived pressure disturbance for optional screenshot.
      water.blast(0, 0, 406); water.blast(4, -3, 406);
      water.update(42.8, camera.position);
      renderer.setRenderTarget(null); renderer.render(scene, camera);
      return { cases, shaderErrors, vertices: water.mesh.geometry.attributes.position.count };
    });
    if (process.env.OCEAN_SCREENSHOT) await page.screenshot({ path: process.env.OCEAN_SCREENSHOT });
    assert.deepEqual(errors, []);
    assert.deepEqual(report.shaderErrors, []);
    assert.ok(report.vertices <= 100000);
    for (const c of report.cases) {
      assert.equal(c.calls, 1, c.name);
      assert.ok(Number.isFinite(c.error) && c.error < 0.003, `${c.name}: GPU error ${c.error}`);
    }
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
});
