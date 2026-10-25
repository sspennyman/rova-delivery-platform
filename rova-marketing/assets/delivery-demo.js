// A self-contained product illustration. It never connects to live workspace data.
(() => {
  document.querySelectorAll('.delivery-demo').forEach(root => {
    let phase = 0, timer = null, visible = false, userPaused = false;
    const steps = [...root.querySelectorAll('[data-demo-step]')];
    const play = root.querySelector('[data-demo-play]');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const find = selector => root.querySelector(selector);
    const route = find('[data-tour-route]');
    const vehicle = find('.tour-vehicle');
    let vehicleProgress = 0, vehicleFrame = null;
    function placeVehicle(progress) {
      vehicleProgress = progress;
      const point = route.getPointAtLength(route.getTotalLength() * progress);
      vehicle.setAttribute('transform', `translate(${point.x} ${point.y})`);
    }
    function moveVehicle(target) {
      cancelAnimationFrame(vehicleFrame);
      if (motion.matches || target <= vehicleProgress) { placeVehicle(target); return; }
      const from = vehicleProgress, started = performance.now();
      function frame(now) {
        const elapsed = Math.min(1, (now - started) / 2500);
        // Sample the drawn route itself: never interpolate across street corners.
        placeVehicle(from + (target - from) * elapsed);
        if (elapsed < 1) vehicleFrame = requestAnimationFrame(frame);
      }
      vehicleFrame = requestAnimationFrame(frame);
    }
    placeVehicle(0);
    const labels = ['Order arrives', 'Assign driver', 'Track trip', 'Delivery proof', 'Trip & mileage'];
    const states = [
      { status:'Queued', distance:'0.0', duration:'0', trip:'Trip not started', location:'Ready to assign', queue:'3', road:'0', delivered:'0', title:'An order arrives in your queue.', copy:'Choose the order and assign it to your driver.', action:'Assign to Ava' },
      { status:'Assigned', distance:'0.0', duration:'0', trip:'Ready to start', location:'Ava · Route assigned', queue:'2', road:'0', delivered:'0', title:'Ava receives the assigned stop.', copy:'The address, delivery window and route stay together.', action:'Start sample trip' },
      { status:'On the way', distance:'3.2', duration:'9', trip:'Trip in progress', location:'Ava · GPS connected', queue:'2', road:'1', delivered:'0', title:'Follow the delivery as it happens.', copy:'See trip distance, elapsed time and live delivery progress.', action:'Save delivery proof' },
      { status:'Delivered', distance:'6.4', duration:'18', trip:'Trip completed', location:'Received by Sam', queue:'2', road:'0', delivered:'1', title:'Delivery proof stays with the order.', copy:'The recipient and completed outcome are saved in history.', action:'Review trip & mileage' },
      { title:'The drive is saved to a private trip log.', copy:'Review each trip, choose Business or Personal, then submit business mileage.', action:'Replay delivery tour' }
    ];
    function show(index, announce = false) {
      phase = (index + states.length) % states.length;
      const state = states[phase], mileage = phase === 4;
      root.dataset.phase = String(phase);
      moveVehicle(phase >= 3 ? 1 : phase === 2 ? .69 : 0);
      steps.forEach((button, i) => button.setAttribute('aria-pressed', String(i === phase)));
      root.querySelectorAll('[data-tour-view]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.tourView === 'mileage') === mileage)));
      find('.tour-dispatch-view').hidden = mileage;
      find('.tour-mileage-view').hidden = !mileage;
      find('[data-tour-title]').textContent = mileage ? 'My Mileage' : 'Today';
      find('[data-tour-eyebrow]').textContent = mileage ? 'YOUR PRIVATE TRIP LOG' : 'YOUR DELIVERY DAY';
      find('[data-tour-subtitle]').textContent = mileage ? 'Review your drives. Submit business mileage once a week.' : 'Orders, drivers and the next stop. All in view.';
      find('[data-tour-story-title]').textContent = state.title;
      find('[data-tour-story-copy]').textContent = state.copy;
      find('[data-tour-next]').replaceChildren(document.createTextNode(state.action + ' '));
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = mileage ? '↻' : '↗';
      find('[data-tour-next]').append(arrow);
      if (!mileage) {
        const status = find('[data-tour-status]'); status.textContent = state.status;
        status.classList.toggle('is-moving', phase === 1 || phase === 2);
        status.classList.toggle('is-complete', phase === 3);
        find('[data-trip-distance]').innerHTML = state.distance + ' <small>km</small>';
        find('[data-trip-duration]').innerHTML = state.duration + ' <small>min</small>';
        find('[data-trip-state]').textContent = state.trip;
        find('[data-tour-location]').textContent = state.location;
        ['queue','road','delivered'].forEach(key => find('[data-tour-' + key + ']').textContent = state[key]);
      }
      const announcement = find('[data-tour-announcement]');
      // Auto rotation updates the visible caption without repeatedly interrupting screen readers.
      announcement.setAttribute('aria-live', announce ? 'polite' : 'off');
      announcement.textContent = 'Step ' + (phase + 1) + ' of 5 · ' + labels[phase];
    }
    function stop() {
      clearInterval(timer); timer = null;
      play.textContent = 'Play tour'; play.setAttribute('aria-pressed', 'false');
      root.classList.add('motion-paused');
    }
    function start() {
      clearInterval(timer);
      play.textContent = 'Pause tour'; play.setAttribute('aria-pressed', 'true');
      root.classList.remove('motion-paused');
      timer = setInterval(() => { if (!document.hidden && visible) show(phase + 1); }, 5500);
    }
    function choose(index) { userPaused = true; stop(); show(index, true); }
    steps.forEach((button, i) => button.addEventListener('click', () => choose(i)));
    find('[data-tour-next]').addEventListener('click', () => choose(phase + 1));
    root.querySelectorAll('[data-tour-view]').forEach(button => button.addEventListener('click', () => choose(button.dataset.tourView === 'mileage' ? 4 : 0)));
    root.querySelectorAll('[data-tour-classify]').forEach(button => button.addEventListener('click', () => {
      const business = button.dataset.tourClassify === 'business';
      root.querySelectorAll('[data-tour-classify]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
      find('[data-tour-classification]').textContent = business ? 'Business' : 'Personal';
      find('[data-tour-privacy]').textContent = business ? 'Ready for your weekly business report' : 'Private trip · Excluded from business reports';
    }));
    play.addEventListener('click', () => { userPaused = Boolean(timer); if (timer) stop(); else start(); });
    motion.addEventListener('change', () => { if (motion.matches) { stop(); moveVehicle(phase >= 3 ? 1 : phase === 2 ? .69 : 0); } else if (visible && !userPaused) start(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible && !userPaused && !motion.matches) start(); });
    new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible && !motion.matches && !userPaused && !document.hidden) start(); else if (!visible) stop();
    }, { threshold:.15 }).observe(root);
    if (new URLSearchParams(location.search).get("tour") === "mileage") choose(4);
    else { show(0); stop(); }
  });
})();
