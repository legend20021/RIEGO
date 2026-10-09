(() => {
    'use strict';

    const $ = (selector, context = document) => context.querySelector(selector);
    const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
    const state = {
        activeView: 'dashboard',
        telemetryInterval: null,
        sectorTicker: null,
        chart: null,
        appStarted: false,
        telemetryTick: 0,
        todaySeconds: 9000,
        storageDate: '',
        cisternValve: false,
        waterLastTick: Date.now(),
        waterFillAccumulator: 0,
        waterDrainAccumulator: 0,
        weatherLive: null,
        weatherLastFetched: 0,
        weatherRequest: null,
        telemetry: { pressure: .9, soil: 66, temp: 25, flow: 20, cistern: 76, weatherTemp: 24, weatherHumidity: 48, weatherWind: 14, weatherRain: 5, weatherDirection: 'NO' },
        sectors: new Map(),
        logs: [
            ['Hoy · 06:24:36', 'Plataforma iniciada', 'Sistema', 'admin', 'Completado'],
            ['Hoy · 06:20:08', 'Riego finalizado en Sector 2 · Cítricos — Encargada: Ana Torres — Duración real: 60 min', 'Proceso', 'admin', 'Informativo'],
            ['Ayer · 18:42:19', 'Contraseña actualizada', 'Seguridad', 'admin', 'Completado'],
            ['Ayer · 17:05:41', 'Conexión WiFi perdida', 'Sistema', 'Sistema', 'Advertencia'],
        ],
    };

    const iconRefresh = () => window.lucide?.createIcons({ attrs: { 'stroke-width': 1.9 } });

    function toast(message, type = 'success') {
        const region = $('#toast-region');
        if (!region) return;
        const item = document.createElement('div');
        item.className = `toast ${type}`;
        item.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${message}</span>`;
        region.append(item);
        iconRefresh();
        setTimeout(() => item.remove(), 3600);
    }

    function addLog(event, type = 'Proceso', status = 'Completado') {
        const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
        state.logs.unshift([`Hoy · ${time}`, event, type, 'admin', status]);
        renderLogs(true);
    }

    function renderLogs(highlightNewest = false) {
        const body = $('#log-table');
        if (!body) return;
        const query = ($('#log-search')?.value || '').toLowerCase();
        const filter = $('#log-filter')?.value || 'all';
        body.innerHTML = state.logs
            .filter(row => (filter === 'all' || row[2] === filter) && row.join(' ').toLowerCase().includes(query))
            .map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>_<span>${row[2]}</span></td><td>${row[3]}</td><td><b class="status-badge ${row[4] === 'Completado' ? 'success' : row[4] === 'Advertencia' ? 'warning' : ''}">${row[4]}</b></td></tr>`)
            .join('');
        if (highlightNewest) {
            const first = body.querySelector('tr');
            if (first) {
                first.classList.add('row-flash');
                setTimeout(() => first.classList.remove('row-flash'), 1800);
            }
        }
    }

    function updateLiveIndicator() {
        const indicator = $('#logs-live');
        if (!indicator) return;
        indicator.classList.remove('off');
        const label = $('b', indicator);
        if (label) label.textContent = 'Actualizando en vivo';
    }

    function setView(view) {
        if (!$(`[data-view="${view}"]`)) view = 'dashboard';
        state.activeView = view;
        $$('.app-view').forEach(section => section.classList.toggle('active', section.dataset.view === view));
        $$('[data-view-target]').forEach(button => button.classList.toggle('active', button.dataset.viewTarget === view));
        document.title = `${viewTitle(view)} · ZENIT RIEGO`;
        window.history.replaceState(null, '', `#${view}`);
        closeSidebar();
        closeMoreSheet();
        if (view === 'curves') requestAnimationFrame(initChart);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        iconRefresh();
    }

    const viewTitle = view => ({ dashboard: 'Dashboard', recipes: 'Sectores', curves: 'Curvas', wifi: 'WiFi', diagnostics: 'Diagnóstico', help: 'Ayuda', logs: 'Logs', updates: 'Actualizaciones', profile: 'Mi perfil' }[view] || 'Dashboard');

    function openSidebar() { $('#sidebar')?.classList.add('open'); $('#sidebar-backdrop')?.classList.add('open'); }
    function closeSidebar() { $('#sidebar')?.classList.remove('open'); $('#sidebar-backdrop')?.classList.remove('open'); }
    function closeMoreSheet() { $('#more-sheet')?.classList.remove('open'); $('#more-sheet')?.setAttribute('aria-hidden', 'true'); }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('riego-theme', theme);
        $('#theme-toggle')?.classList.toggle('on', theme === 'dark');
        if (state.chart) updateChartTheme();
    }

    function updateClock() {
        const now = new Date();
        const date = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(now);
        const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
        if ($('#current-date')) $('#current-date').textContent = date;
        if ($('#current-time')) $('#current-time').textContent = time;
    }

    function formatClock(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function formatHoursMinutes(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        return `${hours} hrs : ${minutes} min`;
    }

    function localDateKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()); }
    function renderProcessTime() { if ($('#process-time')) $('#process-time').textContent = formatHoursMinutes(state.todaySeconds); }
    function saveLocalState() {
        const sessions = {};
        state.sectors.forEach((sector, id) => { if (sector.running) sessions[id] = { total: sector.total, startedAt: sector.startedAt }; });
        localStorage.setItem('riego-local-state', JSON.stringify({ date: state.storageDate || localDateKey(), todaySeconds: state.todaySeconds, cistern: state.telemetry.cistern, cisternValve: state.cisternValve, waterFillAccumulator: state.waterFillAccumulator, waterDrainAccumulator: state.waterDrainAccumulator, sessions }));
    }
    function loadLocalState() {
        const today = localDateKey();
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem('riego-local-state') || 'null'); } catch { stored = null; }
        state.storageDate = today;
        if (stored?.date === today) {
            state.todaySeconds = Math.max(0, Number(stored.todaySeconds) || 9000);
            state.telemetry.cistern = Math.min(100, Math.max(0, Number(stored.cistern) || 76));
            state.cisternValve = Boolean(stored.cisternValve);
            state.waterFillAccumulator = Number(stored.waterFillAccumulator) || 0;
            state.waterDrainAccumulator = Number(stored.waterDrainAccumulator) || 0;
            Object.entries(stored.sessions || {}).forEach(([id, session]) => state.sectors.set(id, { running: true, total: Number(session.total) || 0, startedAt: Number(session.startedAt) || Date.now(), remaining: 0 }));
        } else { state.todaySeconds = 9000; state.telemetry.cistern = 76; state.cisternValve = false; }
        state.waterLastTick = Date.now();
        renderProcessTime();
    }

    function drift(current, min, max, maxDelta, decimals = 1) {
        let next = current + (Math.random() * 2 - 1) * maxDelta;
        if (next < min) next = min + Math.random() * maxDelta * .5;
        if (next > max) next = max - Math.random() * maxDelta * .5;
        return +next.toFixed(decimals);
    }

    function getSectorCards() { return $$('.recipe-card[data-sector]'); }

    function getSectorRuntime(card) {
        const id = card.dataset.sector;
        if (!state.sectors.has(id)) state.sectors.set(id, { running: false, remaining: 0, total: 0, startedAt: 0 });
        return state.sectors.get(id);
    }

    function sectorInfo(card) {
        const id = card.dataset.sector;
        return {
            id,
            crop: card.dataset.sectorCrop || `Sector ${id}`,
            pump: card.dataset.sectorPump || `Bomba ${id}`,
            encargado: card.dataset.sectorEncargado || 'Sin asignar',
        };
    }

    function updateCisternAndPumps() {
        const telemetry = state.telemetry;
        const activeCount = [...state.sectors.values()].filter(sector => sector.running).length;
        const now = Date.now();
        const elapsed = Math.min(30, Math.max(0, (now - state.waterLastTick) / 1000));
        state.waterLastTick = now;
        if (state.cisternValve && telemetry.cistern < 100) state.waterFillAccumulator += elapsed;
        if (activeCount > 0 && telemetry.cistern > 0) state.waterDrainAccumulator += elapsed;
        while (state.cisternValve && state.waterFillAccumulator >= 30 && telemetry.cistern < 100) { state.waterFillAccumulator -= 30; telemetry.cistern = Math.min(100, telemetry.cistern + 1); }
        while (activeCount > 0 && state.waterDrainAccumulator >= 120 && telemetry.cistern > 0) { state.waterDrainAccumulator -= 120; telemetry.cistern = Math.max(0, telemetry.cistern - 1); }
        if (telemetry.cistern <= 50 && !state.cisternValve) { state.cisternValve = true; toast('Nivel al 50%: válvula principal activada automáticamente.'); }
        if (telemetry.cistern >= 100 && state.cisternValve) { state.cisternValve = false; state.waterFillAccumulator = 0; toast('La cisterna ya está llena. Válvula principal apagada.'); }
        if ($('#cistern-level')) $('#cistern-level').textContent = `${Math.round(telemetry.cistern)}%`;
        if ($('#cistern-fill')) $('#cistern-fill').style.width = `${telemetry.cistern}%`;
        const water = $('#cistern-water');
        if (water) {
            water.style.height = `${Math.max(0, Math.min(100, telemetry.cistern))}%`;
            water.classList.toggle('water-active', activeCount > 0 || state.cisternValve);
            water.classList.toggle('water-filling', state.cisternValve);
        }
        if ($('#pump-summary')) $('#pump-summary').textContent = state.cisternValve ? 'Cisterna en llenado' : activeCount > 0 ? `${activeCount} de 5 bombas activas` : 'Nivel estable';
        if ($('#cistern-valve-toggle')) $('#cistern-valve-toggle').checked = state.cisternValve;
        if ($('#cistern-valve-state')) $('#cistern-valve-state').textContent = state.cisternValve ? 'SÍ' : 'NO';
        $('.level-card')?.classList.toggle('pump-on', activeCount > 0 || state.cisternValve);
        const machine = $('#pump-machine');
        if (machine) machine.setAttribute('aria-label', state.cisternValve ? 'Válvula principal activa' : activeCount > 0 ? `${activeCount} bombas encendidas` : 'Bombas en reposo');
        saveLocalState();
    }

    function updateProcessSummary() {
        const activeCount = [...state.sectors.values()].filter(sector => sector.running).length;
        const label = $('#process-state');
        if (label) label.textContent = `${activeCount} sector${activeCount === 1 ? '' : 'es'} en riego ahora`;
    }

    function renderPumpOverview() {
        const container = $('#pump-overview');
        if (!container) return;
        container.innerHTML = getSectorCards().map(card => {
            const { id, crop, pump } = sectorInfo(card);
            const runtime = state.sectors.get(id) || {};
            const running = Boolean(runtime.running);
            const elapsed = running ? Math.max(0, Math.floor((Date.now() - runtime.startedAt) / 1000)) : 0;
            const pct = running && runtime.total ? Math.min(100, Math.round((elapsed / runtime.total) * 100)) : 0;
            return `<div class="pump-overview-row ${running ? 'on' : ''}"><span class="pump-overview-name"><span class="pump-dot"></span><span>${escapeHtml(pump)}<small>Sector ${id} · ${escapeHtml(crop)}</small></span></span><span class="pump-overview-meta"><b>${running ? `${Math.floor(elapsed / 60)} min` : '—'}</b><span class="pump-mini-track"><i style="width:${pct}%"></i></span><em>${running ? 'Activa' : 'Apagada'}</em></span></div>`;
        }).join('');
    }

    function ensureSectorTicker() {
        if (state.sectorTicker) return;
        state.sectorTicker = setInterval(tickSectors, 1000);
    }

    function tickSectors() {
        let anyRunning = false;
        let runningCount = 0;
        getSectorCards().forEach(card => {
            const sector = state.sectors.get(card.dataset.sector);
            if (!sector || !sector.running) return;
            anyRunning = true;
            runningCount += 1;
            sector.remaining = Math.max(0, sector.remaining - 1);
            const fill = $('[data-sector-fill]', card);
            const pct = sector.total ? Math.min(100, Math.round(((sector.total - sector.remaining) / sector.total) * 100)) : 100;
            if (fill) fill.style.width = `${pct}%`;
            const remainingLabel = $('[data-sector-remaining]', card);
            if (remainingLabel) remainingLabel.textContent = formatClock(sector.remaining);
            if (sector.remaining <= 0) stopSector(card, { auto: true });
        });
        if (runningCount > 0) {
            state.todaySeconds += runningCount;
            renderProcessTime();
        }
        updateCisternAndPumps();
        renderPumpOverview();
        saveLocalState();
        updateProcessSummary();
        if (!anyRunning) { clearInterval(state.sectorTicker); state.sectorTicker = null; }
    }

    function startSector(card) {
        const sector = getSectorRuntime(card);
        if (sector.running) return;
        const { id, crop, pump, encargado } = sectorInfo(card);
        const select = $('[data-sector-duration]', card);
        const minutes = Number(select?.value || 30);
        sector.total = minutes * 60;
        sector.remaining = sector.total;
        sector.startedAt = Date.now();
        sector.running = true;
        card.classList.add('sector-running');
        const badge = $('[data-sector-status]', card);
        if (badge) { badge.textContent = 'Regando'; badge.classList.add('on'); }
        const progress = $('[data-sector-progress]', card);
        if (progress) progress.hidden = false;
        const fill = $('[data-sector-fill]', card);
        if (fill) fill.style.width = '0%';
        const remainingLabel = $('[data-sector-remaining]', card);
        if (remainingLabel) remainingLabel.textContent = formatClock(sector.remaining);
        const startBtn = $('[data-sector-action="start"]', card);
        const stopBtn = $('[data-sector-action="stop"]', card);
        if (startBtn) startBtn.hidden = true;
        if (stopBtn) stopBtn.hidden = false;
        addLog(`Riego iniciado en Sector ${id} · ${crop} — ${pump} — Encargado: ${encargado} — Duración programada: ${minutes} min`, 'Proceso');
        toast(`Riego iniciado en Sector ${id} · ${crop}.`);
        renderPumpOverview();
        updateCisternAndPumps();
        ensureSectorTicker();
        iconRefresh();
    }

    function stopSector(card, { auto = false } = {}) {
        const sector = getSectorRuntime(card);
        if (!sector.running) return;
        const { id, crop, pump, encargado } = sectorInfo(card);
        const elapsedMinutes = Math.max(0, Math.round((sector.total - sector.remaining) / 60));
        sector.running = false;
        sector.remaining = 0;
        sector.startedAt = 0;
        card.classList.remove('sector-running');
        const badge = $('[data-sector-status]', card);
        if (badge) { badge.textContent = 'En espera'; badge.classList.remove('on'); }
        const progress = $('[data-sector-progress]', card);
        if (progress) progress.hidden = true;
        const startBtn = $('[data-sector-action="start"]', card);
        const stopBtn = $('[data-sector-action="stop"]', card);
        if (startBtn) startBtn.hidden = false;
        if (stopBtn) stopBtn.hidden = true;
        const reason = auto ? 'duración programada completada' : 'detenido manualmente';
        addLog(`Riego finalizado en Sector ${id} · ${crop} — ${pump} — Encargado: ${encargado} — Duración real: ${elapsedMinutes} min (${reason})`, 'Proceso', 'Completado');
        toast(auto ? `Riego completado en Sector ${id} · ${crop}.` : `Riego detenido en Sector ${id} · ${crop}.`);
        renderPumpOverview();
        updateCisternAndPumps();
        saveLocalState();
        iconRefresh();
    }

    function initSectors() {
        getSectorCards().forEach(card => {
            const runtime = getSectorRuntime(card);
            if (!runtime.running) return;
            const elapsed = Math.floor((Date.now() - runtime.startedAt) / 1000);
            runtime.remaining = Math.max(0, runtime.total - elapsed);
            if (runtime.remaining <= 0) { runtime.running = false; runtime.startedAt = 0; return; }
            card.classList.add('sector-running');
            const badge = $('[data-sector-status]', card); if (badge) { badge.textContent = 'Regando'; badge.classList.add('on'); }
            const progress = $('[data-sector-progress]', card); if (progress) progress.hidden = false;
            const fill = $('[data-sector-fill]', card); if (fill) fill.style.width = `${runtime.total ? Math.round((runtime.total - runtime.remaining) / runtime.total * 100) : 0}%`;
            const remaining = $('[data-sector-remaining]', card); if (remaining) remaining.textContent = formatClock(runtime.remaining);
            $('[data-sector-action="start"]', card)?.setAttribute('hidden', '');
            $('[data-sector-action="stop"]', card)?.removeAttribute('hidden');
        });
        renderPumpOverview();
        updateProcessSummary();
        if ([...state.sectors.values()].some(sector => sector.running)) ensureSectorTicker();
    }

    function randomBetween(min, max, decimals = 1) { return (Math.random() * (max - min) + min).toFixed(decimals); }
    function randomChoice(list) { return list[Math.floor(Math.random() * list.length)]; }

    const weatherCondition = code => ({ 0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado', 45: 'Niebla', 48: 'Niebla', 51: 'Llovizna ligera', 53: 'Llovizna', 55: 'Llovizna intensa', 61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia intensa', 80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos intensos', 95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta intensa' }[code] || 'Condición actual');
    function renderLiveWeather(live) {
        const telemetry = state.telemetry;
        if ($('#weather-temp')) $('#weather-temp').textContent = `${Number(telemetry.weatherTemp).toFixed(1)}°C`;
        if ($('#weather-condition')) $('#weather-condition').textContent = weatherCondition(live.code);
        if ($('#weather-humidity')) $('#weather-humidity').textContent = `${Math.round(telemetry.weatherHumidity)}%`;
        if ($('#weather-wind')) $('#weather-wind').textContent = `${Math.round(telemetry.weatherWind)} km/h ${telemetry.weatherDirection}`;
        if ($('#weather-rain')) $('#weather-rain').textContent = `${Math.round(telemetry.weatherRain)}%`;
        if ($('#weather-updated')) $('#weather-updated').textContent = live.updatedAt;
    }
    async function fetchLiveWeather() {
        if (state.weatherRequest || Date.now() - state.weatherLastFetched < 10 * 60 * 1000) return;
        state.weatherRequest = fetch('https://api.open-meteo.com/v1/forecast?latitude=30.483&longitude=-115.950&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&timezone=America%2FTijuana&forecast_days=1')
            .then(response => { if (!response.ok) throw new Error('Weather request failed'); return response.json(); })
            .then(data => {
                const current = data.current || {};
                const times = data.hourly?.time || [];
                const index = Math.max(0, times.findIndex(value => value >= current.time));
                const direction = Number(current.wind_direction_10m);
                const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
                state.telemetry.weatherTemp = Number(current.temperature_2m);
                state.telemetry.weatherHumidity = Number(current.relative_humidity_2m);
                state.telemetry.weatherWind = Number(current.wind_speed_10m);
                state.telemetry.weatherRain = Number(data.hourly?.precipitation_probability?.[index] ?? current.precipitation ?? 0);
                state.telemetry.weatherDirection = compass[Math.round(direction / 22.5) % 16] || 'N';
                state.weatherLive = { code: Number(current.weather_code), updatedAt: new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(new Date()) };
                state.weatherLastFetched = Date.now();
                renderLiveWeather(state.weatherLive);
            })
            .catch(() => { state.weatherLastFetched = Date.now() - 9 * 60 * 1000; })
            .finally(() => { state.weatherRequest = null; });
        await state.weatherRequest;
    }

    function updateWeather() {
        if (state.weatherLive) { renderLiveWeather(state.weatherLive); return; }
        const telemetry = state.telemetry;
        telemetry.weatherTemp = drift(telemetry.weatherTemp, 16, 31, .6);
        telemetry.weatherHumidity = drift(telemetry.weatherHumidity, 30, 70, 2, 0);
        telemetry.weatherWind = drift(telemetry.weatherWind, 4, 26, 1.5, 0);
        telemetry.weatherRain = drift(telemetry.weatherRain, 0, 35, 2, 0);
        if (state.telemetryTick % 3 === 0) telemetry.weatherDirection = randomChoice(['NO', 'O', 'N', 'NE', 'SO']);
        const condition = telemetry.weatherRain > 22 ? 'Nublado con lluvia ligera' : telemetry.weatherRain > 12 ? 'Parcialmente nublado' : telemetry.weatherHumidity > 55 ? 'Brisa marina' : 'Despejado';
        const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(new Date());
        if ($('#weather-temp')) $('#weather-temp').textContent = `${telemetry.weatherTemp.toFixed(1)}°C`;
        if ($('#weather-condition')) $('#weather-condition').textContent = condition;
        if ($('#weather-humidity')) $('#weather-humidity').textContent = `${Math.round(telemetry.weatherHumidity)}%`;
        if ($('#weather-wind')) $('#weather-wind').textContent = `${Math.round(telemetry.weatherWind)} km/h ${telemetry.weatherDirection}`;
        if ($('#weather-rain')) $('#weather-rain').textContent = `${Math.round(telemetry.weatherRain)}%`;
        if ($('#weather-updated')) $('#weather-updated').textContent = time;
    }

    function updateTelemetry() {
        const telemetry = state.telemetry;
        telemetry.pressure = drift(telemetry.pressure, .3, 1.8, .08, 2);
        telemetry.soil = drift(telemetry.soil, 55, 78, 1.5, 0);
        telemetry.temp = drift(telemetry.temp, 20, 30, .5, 1);
        telemetry.flow = drift(telemetry.flow, 14, 28, 1, 1);
        const values = {
            '#pressure-value': `${telemetry.pressure.toFixed(2)} PSI`,
            '#ph-value': `${Math.round(telemetry.soil)}%`,
            '#mass-temp': `${telemetry.temp.toFixed(1)}°C`,
            '#leach-temp': `${telemetry.flow.toFixed(1)} L/min`,
        };
        Object.entries(values).forEach(([selector, value]) => { const element = $(selector); if (element) element.textContent = value; });
        $$('.telemetry-card').forEach((card, index) => setTimeout(() => { card.animate([{ transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }], { duration: 300 }); }, index * 45));
        updateWeather();
        updateCisternAndPumps();
        appendChartPoint();
        state.telemetryTick = (state.telemetryTick || 0) + 1;
        if (state.telemetryTick % 3 === 0) {
            addLog(`Lectura de telemetría: ${values['#mass-temp']} · humedad suelo ${values['#ph-value']} · ${values['#pressure-value']}`, 'Sistema', 'Informativo');
        }
    }

    function startTelemetryLoop() {
        clearInterval(state.telemetryInterval);
        updateTelemetry();
        fetchLiveWeather();
        state.telemetryInterval = setInterval(updateTelemetry, 10000);
        updateLiveIndicator();
    }

    const chartData = {
        labels: ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'],
        temperature: [20.8,21.1,22.5,24.8,26.1,27.4,27.2,26.9,25.7,23.6,21.8,20.9],
        soil: [72,70,68,66,63,60,58,61,65,68,71,73],
        pressure: [.1,.2,.3,.6,.8,1.1,1.4,1.3,1.0,.7,.3,.1],
    };

    function initChart() {
        const canvas = $('#process-chart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (state.chart) { state.chart.resize(); return; }
        const dark = document.documentElement.dataset.theme === 'dark';
        state.chart = new Chart(canvas, {
            type: 'line',
            data: { labels: chartData.labels, datasets: [
                { label: 'Temperatura °C', data: chartData.temperature, borderColor: '#f59e42', backgroundColor: 'rgba(245,158,66,.12)', tension: .42, fill: true, pointRadius: 2, yAxisID: 'y' },
                { label: 'Humedad suelo %', data: chartData.soil, borderColor: '#13a777', backgroundColor: 'rgba(19,167,119,.08)', tension: .42, pointRadius: 2, yAxisID: 'y1' },
                { label: 'Presión PSI', data: chartData.pressure, borderColor: '#2a92e8', tension: .42, pointRadius: 2, yAxisID: 'y1' },
            ]},
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: dark ? '#d9e9f4' : '#50677d', usePointStyle: true, boxWidth: 8 } } }, scales: { x: { grid: { color: dark ? 'rgba(150,180,200,.1)' : 'rgba(80,110,140,.08)' }, ticks: { color: dark ? '#9db2c4' : '#607893' } }, y: { position: 'left', grid: { color: dark ? 'rgba(150,180,200,.1)' : 'rgba(80,110,140,.08)' }, ticks: { color: dark ? '#9db2c4' : '#607893' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: dark ? '#9db2c4' : '#607893' } } } }
        });
    }

    function updateChartTheme() {
        if (!state.chart) return;
        const color = document.documentElement.dataset.theme === 'dark' ? '#9db2c4' : '#607893';
        state.chart.options.plugins.legend.labels.color = color;
        Object.values(state.chart.options.scales).forEach(scale => { scale.ticks.color = color; });
        state.chart.update();
    }

    function appendChartPoint() {
        if (!state.chart) return;
        const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(new Date());
        state.chart.data.labels.push(time);
        state.chart.data.datasets[0].data.push(state.telemetry.temp);
        state.chart.data.datasets[1].data.push(state.telemetry.soil);
        state.chart.data.datasets[2].data.push(state.telemetry.pressure);
        if (state.chart.data.labels.length > 14) { state.chart.data.labels.shift(); state.chart.data.datasets.forEach(d => d.data.shift()); }
        state.chart.update('none');
    }

    function openModal(modal) { modal?.classList.add('open'); modal?.setAttribute('aria-hidden', 'false'); }
    function closeModal(modal) { modal?.classList.remove('open'); modal?.setAttribute('aria-hidden', 'true'); }

    function bindEvents() {
        $$('[data-view-target]').forEach(button => button.addEventListener('click', () => setView(button.dataset.viewTarget)));
        $('#cistern-valve-toggle')?.addEventListener('change', event => {
            state.cisternValve = event.currentTarget.checked && state.telemetry.cistern < 100;
            if (state.cisternValve) toast('Válvula principal activada: la cisterna subirá 1% cada 30 segundos.');
            else toast('Válvula principal apagada.');
            updateCisternAndPumps();
        });
        $('#menu-button')?.addEventListener('click', openSidebar);
        $('#sidebar-backdrop')?.addEventListener('click', closeSidebar);
        $('#more-button')?.addEventListener('click', () => { const sheet = $('#more-sheet'); const open = !sheet.classList.contains('open'); sheet.classList.toggle('open', open); sheet.setAttribute('aria-hidden', String(!open)); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSidebar(); closeMoreSheet(); $$('.modal.open').forEach(closeModal); } });
        $('#theme-toggle')?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
        $('#recipe-grid')?.addEventListener('click', event => {
            const button = event.target.closest('[data-sector-action]');
            if (!button) return;
            const card = button.closest('.recipe-card[data-sector]');
            if (!card) return;
            if (button.dataset.sectorAction === 'start') startSector(card); else stopSector(card);
        });
        $('#new-recipe')?.addEventListener('click', () => openModal($('#recipe-modal')));
        $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal'))));
        $$('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
        $('#recipe-form')?.addEventListener('submit', event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const grid = $('#recipe-grid');
            const id = String(grid.children.length + 1);
            const name = escapeHtml(data.get('name'));
            const encargado = escapeHtml(data.get('encargado'));
            const duration = Number(data.get('duration')) || 40;
            const flow = escapeHtml(data.get('temperature'));
            const humidity = escapeHtml(data.get('ph'));
            const article = document.createElement('article');
            article.className = 'recipe-card';
            article.dataset.sector = id;
            article.dataset.sectorCrop = name;
            article.dataset.sectorPump = `Bomba ${id}`;
            article.dataset.sectorEncargado = encargado;
            article.innerHTML = `<div class="recipe-top"><span class="recipe-icon violet"><i data-lucide="sparkles"></i></span><span class="status-badge sector-status" data-sector-status>En espera</span></div><h3>Sector ${id} · ${name}</h3><p>Sector personalizado · 2 ha · Encargado: ${encargado}</p><dl><div><dt>Caudal</dt><dd>${flow} L/min</dd></div><div><dt>Humedad meta</dt><dd>${humidity}%</dd></div><div><dt>Bomba</dt><dd>Bomba ${id}</dd></div></dl><div class="sector-duration"><label>Duración del riego<select data-sector-duration><option value="${duration}" selected>${duration} min</option></select></label></div><div class="sector-progress" data-sector-progress hidden><div class="sector-progress-track"><div class="sector-progress-fill" data-sector-fill></div></div><span data-sector-remaining>00:00</span></div><button class="secondary-button sector-start" data-sector-action="start"><i data-lucide="play"></i>Iniciar riego</button><button class="secondary-button danger sector-stop" data-sector-action="stop" hidden><i data-lucide="square"></i>Detener riego</button>`;
            grid.prepend(article);
            getSectorRuntime(article);
            renderPumpOverview();
            closeModal($('#recipe-modal'));
            iconRefresh();
            toast('Sector creado correctamente.');
            addLog(`Sector creado: Sector ${id} · ${name} — Encargado: ${encargado}`, 'Proceso');
            form.reset();
        });
        $$('.segmented button').forEach(button => button.addEventListener('click', () => { $$('.segmented button').forEach(b => b.classList.remove('active')); button.classList.add('active'); if (state.chart) { const factor = +button.dataset.range / 24; state.chart.data.datasets.forEach((d, index) => d.data = d.data.map(value => +(value + (Math.random() - .5) * factor * (index === 0 ? .5 : .12)).toFixed(2))); state.chart.update(); } }));
        $('#download-chart')?.addEventListener('click', () => { if (!state.chart) return; const link = document.createElement('a'); link.download = 'curvas-riego.png'; link.href = state.chart.toBase64Image('image/png', 1); link.click(); toast('Gráfico exportado como PNG.'); });
        $('#scan-networks')?.addEventListener('click', event => { event.currentTarget.disabled = true; $('#scan-state').textContent = 'Buscando redes…'; $('#network-list').classList.add('is-loading'); setTimeout(() => { event.currentTarget.disabled = false; $('#scan-state').textContent = 'Último escaneo: ahora'; $('#network-list').classList.remove('is-loading'); toast('Escaneo completado: 3 redes encontradas.'); }, 1500); });
        $$('.network').forEach(network => network.addEventListener('click', () => { $$('.network').forEach(n => n.classList.remove('active')); network.classList.add('active'); }));
        $('#wifi-form')?.addEventListener('submit', event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; setTimeout(() => { button.disabled = false; toast('Conectado a RIEGO_PARCELA correctamente.'); $('#connection-pill')?.classList.add('connected'); $('#connection-pill span').textContent = 'RIEGO_PARCELA'; addLog('Conexión WiFi establecida', 'Sistema'); event.currentTarget.reset(); }, 1200); });
        $('#run-diagnostics')?.addEventListener('click', event => {
            const button = event.currentTarget;
            const cards = $$('[data-check]');
            button.disabled = true;
            const activeCount = [...state.sectors.values()].filter(sector => sector.running).length;
            const cisternLevel = state.telemetry.cistern;
            const wifiConnected = Boolean($('#connection-pill')?.classList.contains('connected'));
            const results = [
                { ok: true, desc: 'Lecturas consistentes en ambos canales.' },
                { ok: true, desc: 'Calibración vigente y respuesta normal.' },
                cisternLevel > 32
                    ? { ok: true, desc: activeCount > 0 ? `${activeCount} de 5 bombas de sector respondiendo con normalidad.` : 'Las 5 bombas de sector están en reposo y disponibles.' }
                    : { ok: false, desc: 'Nivel de cisterna bajo: se recomienda posponer nuevos riegos.' },
                wifiConnected
                    ? { ok: true, desc: 'Conexión estable con la red configurada.' }
                    : { ok: false, desc: 'No hay una red configurada.' },
            ];
            cards.forEach((card, index) => {
                const status = $('.check-status', card);
                const desc = $('p', card);
                setTimeout(() => {
                    card.classList.add('running');
                    status.innerHTML = '<i data-lucide="loader-circle"></i>Comprobando';
                    iconRefresh();
                }, index * 420);
                setTimeout(() => {
                    const result = results[index];
                    card.classList.remove('running');
                    status.className = `check-status ${result.ok ? 'success' : 'warning'}`;
                    status.innerHTML = `<i data-lucide="${result.ok ? 'circle-check' : 'triangle-alert'}"></i>${result.ok ? 'Correcto' : 'Atención'}`;
                    if (desc) desc.textContent = result.desc;
                    iconRefresh();
                    if (index === cards.length - 1) {
                        button.disabled = false;
                        toast('Diagnóstico finalizado: sensores analizados.');
                        addLog('Diagnóstico completo ejecutado (sensores analizados)', 'Sistema');
                    }
                }, 650 + index * 420);
            });
        });
        $$('.faq').forEach(faq => faq.addEventListener('click', () => faq.classList.toggle('open')));
        $('#help-search')?.addEventListener('input', event => { const query = event.target.value.toLowerCase(); $$('.faq').forEach(faq => faq.hidden = !faq.textContent.toLowerCase().includes(query)); });
        $('#log-search')?.addEventListener('input', renderLogs); $('#log-filter')?.addEventListener('change', renderLogs);
        $('#export-logs')?.addEventListener('click', exportLogs);
        $('#check-updates')?.addEventListener('click', event => { const original = event.currentTarget.innerHTML; event.currentTarget.innerHTML = '<i data-lucide="loader-circle"></i>Buscando…'; event.currentTarget.disabled = true; iconRefresh(); setTimeout(() => { event.currentTarget.innerHTML = original; event.currentTarget.disabled = false; iconRefresh(); toast('Ya tienes la versión más reciente.'); addLog('Búsqueda de actualizaciones', 'Sistema'); }, 1400); });
        $('#profile-form')?.addEventListener('submit', updateProfile);
        $('#logout-link')?.addEventListener('click', event => { event.preventDefault(); localStorage.removeItem('riego-session'); showLogin(); });
    }

    function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }

    function exportLogs() {
        const rows = [['Fecha y hora','Evento','Tipo','Usuario','Estado'], ...state.logs];
        const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'zenit-riego-logs.csv'; link.click(); URL.revokeObjectURL(url); toast('Registro exportado como CSV.');
    }

    function updateProfile(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const data = Object.fromEntries(new FormData(form).entries());
        button.disabled = true;
        try {
            const currentPassword = localStorage.getItem('riego-password') || 'admin';
            const newPassword = String(data.new_password || '');
            if (newPassword) {
                if (String(data.current_password || '') !== currentPassword) throw new Error('La contraseña actual no es correcta.');
                if (newPassword.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
                if (newPassword !== String(data.confirm_password || '')) throw new Error('Las contraseñas nuevas no coinciden.');
                localStorage.setItem('riego-password', newPassword);
            }
            const displayName = String(data.display_name || 'Administrador').trim() || 'Administrador';
            localStorage.setItem('riego-display-name', displayName);
            $('#profile-summary-name').textContent = displayName;
            $('#profile-avatar').textContent = displayName.charAt(0).toUpperCase();
            $('#profile-initial').textContent = displayName.charAt(0).toUpperCase();
            document.body.dataset.userName = displayName;
            form.querySelector('[name="current_password"]').value = '';
            form.querySelector('[name="new_password"]').value = '';
            form.querySelector('[name="confirm_password"]').value = '';
            toast(newPassword ? 'Perfil y contraseña local actualizados.' : 'Perfil actualizado correctamente.');
            addLog('Perfil actualizado', 'Seguridad');
        } catch (error) { toast(error.message, 'error'); }
        finally { button.disabled = false; }
    }

    // --- Login / vista única dentro de index.html ---

    function showLogin() {
        document.body.classList.add('login-body');
        document.body.classList.remove('app-body');
        const login = $('#login-screen');
        const app = $('#app-screen');
        if (login) login.hidden = false;
        if (app) app.hidden = true;
        iconRefresh();
    }

    function showApp() {
        document.body.classList.remove('login-body');
        document.body.classList.add('app-body');
        const login = $('#login-screen');
        const app = $('#app-screen');
        if (login) login.hidden = true;
        if (app) app.hidden = false;
    }

    function initLoginForm() {
        const form = $('#login-form');
        const alertBox = $('#login-alert');
        const storedPassword = () => localStorage.getItem('riego-password') || 'admin';

        $$('[data-toggle-password]').forEach(button => {
            button.addEventListener('click', () => {
                const input = document.getElementById(button.dataset.togglePassword);
                input.type = input.type === 'password' ? 'text' : 'password';
                button.setAttribute('aria-label', input.type === 'password' ? 'Mostrar contraseña' : 'Ocultar contraseña');
            });
        });

        form?.addEventListener('submit', event => {
            event.preventDefault();
            const data = new FormData(form);
            const valid = String(data.get('username')).trim() === 'admin' && String(data.get('password')) === storedPassword();
            alertBox.hidden = valid;
            if (!valid) {
                form.animate([{ transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }], { duration: 260 });
                return;
            }
            localStorage.setItem('riego-session', 'active');
            showApp();
            startApp();
            window.location.hash = 'dashboard';
        });
    }

    function startApp() {
        if (state.appStarted) return;
        state.appStarted = true;
        const displayName = localStorage.getItem('riego-display-name') || 'Administrador';
        document.body.dataset.userName = displayName;
        $('#profile-summary-name').textContent = displayName;
        $('#profile-avatar').textContent = displayName.charAt(0).toUpperCase();
        $('#profile-initial').textContent = displayName.charAt(0).toUpperCase();
        const nameInput = $('#profile-form [name="display_name"]');
        if (nameInput) nameInput.value = displayName;
        applyTheme(localStorage.getItem('riego-theme') || 'light');
        iconRefresh();
        updateClock();
        setInterval(updateClock, 1000);
        bindEvents();
        loadLocalState();
        window.addEventListener('beforeunload', saveLocalState, { once: true });
        renderLogs();
        initSectors();
        startTelemetryLoop();
        const initial = location.hash.replace('#', '') || 'dashboard';
        setView(initial);
        const cards = $$('[data-animate-card]');
        cards.forEach((card, index) => card.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 460, delay: index * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }));
    }

    function init() {
        iconRefresh();
        initLoginForm();
        if (localStorage.getItem('riego-session') === 'active') {
            showApp();
            startApp();
        } else {
            showLogin();
        }
    }

    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
