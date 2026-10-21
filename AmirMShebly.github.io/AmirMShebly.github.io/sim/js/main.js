/* ============================================================================
   main.js — bootstrap, animation loop and mouse interaction.
   ============================================================================ */
(function () {
  const canvas = document.getElementById('canvas');
  const renderer = new Renderer(canvas);
  const sim = new Simulation();
  const ui = new UI(sim);
  window.FNC = { sim, renderer, ui };

  function onResize() { renderer.resize(); }
  window.addEventListener('resize', onResize);

  /* ---- mouse: hover tooltip + click-to-select ---- */
  let mouse = null;
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = renderer.s2w(mouse);
    const a = sim.pick(world);
    sim.hoverId = a ? a.id : null;
    canvas.style.cursor = a ? 'pointer' : 'crosshair';
    if (a) ui.showTooltip(a, mouse.x, mouse.y); else ui.hideTooltip();
  });
  canvas.addEventListener('mouseleave', () => { sim.hoverId = null; ui.hideTooltip(); mouse = null; });
  /* ---- touch: a fingertip is less precise than a cursor, so taps accept agents within 22 px ---- */
  let pointerType = 'mouse';
  canvas.addEventListener('pointerdown', e => { pointerType = e.pointerType; });
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const world = renderer.s2w({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const a = sim.pick(world, pointerType === 'touch' ? 22 / renderer.scale : 0);
    if (a) {
      sim.select(a.id); ui._card(a);
      // phones stack the panel under the stage with the card first (see css): bring it into view
      if (window.matchMedia('(max-width: 760px)').matches) document.getElementById('panel').scrollTop = 0;
    }
    else ui.hideCard();
  });

  /* ---- loop ---- */
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = clamp(dt, 0, 0.05);

    const steps = ui.speed >= 1 ? Math.round(ui.speed) : 1;
    const sdt = ui.speed >= 1 ? dt : dt * ui.speed;
    for (let i = 0; i < steps; i++) sim.step(sdt);

    renderer.draw(sim, dt);
    ui.refresh();

    // keep the tooltip tracking the hovered agent as it moves
    if (mouse && sim.hoverId) {
      const a = sim.byId(sim.hoverId);
      if (a) ui.showTooltip(a, mouse.x, mouse.y); else ui.hideTooltip();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
