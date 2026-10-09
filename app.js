(() => {
  "use strict";

  const UUIDS = Object.freeze({
    service: "651a3000-75e2-4b26-bcc4-6f6970d93dc1",
    rx: "651a3001-75e2-4b26-bcc4-6f6970d93dc1",
    tx: "651a3002-75e2-4b26-bcc4-6f6970d93dc1"
  });
  const COMMAND_TIMEOUT_MS = 6500;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const byId = (id) => document.getElementById(id);
  const ui = {
    compatibility: byId("compatibility"),
    badge: byId("link-badge"),
    linkLabel: byId("link-label"),
    detail: byId("connection-detail"),
    connect: byId("connect-button"),
    disconnect: byId("disconnect-button"),
    refresh: byId("refresh-button"),
    kiloProbe: byId("kilo-probe-button"),
    kiloStatus: byId("kilo-status"),
    kiloDetail: byId("kilo-detail"),
    log: byId("activity-log"),
    build: byId("build-label"),
    offlineNotice: byId("offline-notice"),
    offlineLabel: byId("offline-label"),
    source: byId("solution-source"),
    fields: {
      elevation: byId("status-elevation"),
      range: byId("status-range"),
      target: byId("status-target"),
      cant: byId("status-cant"),
      requestedDa: byId("status-requested-da"),
      tableDa: byId("status-table-da"),
      wind: byId("status-wind"),
      windage: byId("status-windage"),
      rangeState: byId("status-range-state")
    },
    inputs: {
      da: byId("da-input"),
      windSpeed: byId("wind-speed-input"),
      windFrom: byId("wind-from-input"),
      elevation: byId("override-input")
    },
    modeInputs: Array.from(document.querySelectorAll("input[name='hud-mode']")),
    targetRows: Array.from(document.querySelectorAll(".target-row")).map((row) => ({
      selected: row.querySelector(".target-show"),
      id: row.querySelector(".target-id"),
      range: row.querySelector(".target-range")
    }))
  };

  let device = null;
  let server = null;
  let rxCharacteristic = null;
  let txCharacteristic = null;
  let sequence = 1;
  let operationQueue = Promise.resolve();
  const pendingAcks = new Map();
  let pendingStatus = null;
  let pendingPlan = null;
  let pendingKilo = null;

  function addLog(message, kind = "") {
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}  ${message}`;
    if (kind) item.className = kind;
    ui.log.prepend(item);
    while (ui.log.children.length > 20) ui.log.lastElementChild.remove();
  }

  function setLinkState(state, detail) {
    const connected = state === "connected";
    const busy = state === "connecting";
    ui.linkLabel.textContent = connected ? "Connected" : busy ? "Connecting" : "Disconnected";
    ui.detail.textContent = detail;
    ui.badge.className = `badge ${connected ? "badge-online" : busy ? "badge-busy" : "badge-offline"}`;
    ui.connect.disabled = connected || busy;
    ui.disconnect.disabled = !connected;
    ui.refresh.disabled = !connected;
    ui.kiloProbe.disabled = !connected;
    document.querySelectorAll("form button[type='submit']").forEach((button) => {
      button.disabled = !connected;
    });
  }

  function nextSequence() {
    const current = sequence;
    sequence = sequence >= 9999 ? 1 : sequence + 1;
    return current;
  }

  function timeoutPromise(label, milliseconds = COMMAND_TIMEOUT_MS) {
    return new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    });
  }

  async function writeJson(payload) {
    if (!server?.connected || !rxCharacteristic) throw new Error("RifleHUD is not connected");
    const encoded = textEncoder.encode(JSON.stringify(payload));
    if (encoded.byteLength > 240) throw new Error("Command exceeds the HUD's 240-byte limit");
    if (typeof rxCharacteristic.writeValueWithResponse === "function") {
      await rxCharacteristic.writeValueWithResponse(encoded);
    } else {
      await rxCharacteristic.writeValue(encoded);
    }
  }

  async function exchangeCommand(command) {
    const seq = nextSequence();
    const ack = new Promise((resolve, reject) => pendingAcks.set(seq, { resolve, reject }));
    try {
      await writeJson({ ...command, seq });
      const reply = await Promise.race([ack, timeoutPromise(command.type)]);
      if (!reply.ok) throw new Error(reply.error || `${command.type} rejected`);
      addLog(command.type === "kilo_probe" ? "KILO discovery started" : `${command.type} saved`, "success");
      await fetchStatus();
      if (command.type === "plan" || command.type === "select") await fetchPlan();
      return reply;
    } finally {
      pendingAcks.delete(seq);
    }
  }

  async function fetchStatus() {
    if (pendingStatus) return pendingStatus.promise;
    const seq = nextSequence();
    let resolveStatus;
    let rejectStatus;
    const promise = new Promise((resolve, reject) => {
      resolveStatus = resolve;
      rejectStatus = reject;
    });
    pendingStatus = { promise, resolve: resolveStatus, reject: rejectStatus };
    try {
      await writeJson({ type: "status", seq });
      return await Promise.race([promise, timeoutPromise("status")]);
    } finally {
      pendingStatus = null;
    }
  }

  async function fetchPlan() {
    if (pendingPlan) return pendingPlan.promise;
    let resolvePlan;
    let rejectPlan;
    const promise = new Promise((resolve, reject) => {
      resolvePlan = resolve;
      rejectPlan = reject;
    });
    pendingPlan = { promise, resolve: resolvePlan, reject: rejectPlan };
    try {
      await writeJson({ type: "plan_status", seq: nextSequence() });
      return await Promise.race([promise, timeoutPromise("target plan")]);
    } finally {
      pendingPlan = null;
    }
  }

  async function fetchKiloStatus() {
    if (pendingKilo) return pendingKilo.promise;
    let resolveKilo;
    let rejectKilo;
    const promise = new Promise((resolve, reject) => {
      resolveKilo = resolve;
      rejectKilo = reject;
    });
    pendingKilo = { promise, resolve: resolveKilo, reject: rejectKilo };
    try {
      await writeJson({ type: "kilo_status", seq: nextSequence() });
      return await Promise.race([promise, timeoutPromise("KILO status")]);
    } finally {
      pendingKilo = null;
    }
  }

  function enqueue(action) {
    operationQueue = operationQueue
      .catch(() => undefined)
      .then(action)
      .catch((error) => {
        addLog(error.message || String(error), "error");
        ui.detail.textContent = error.message || String(error);
        if (!server?.connected) {
          setLinkState("disconnected", error.message || "Connection failed");
        }
      });
    return operationQueue;
  }

  function handleMessage(dataView) {
    let message;
    try {
      const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
      message = JSON.parse(textDecoder.decode(bytes));
    } catch {
      addLog("Received an unreadable BLE response", "error");
      return;
    }

    if (message.type === "status" || message.t === "s") {
      const status = message.t === "s" ? {
        target: message.id,
        rangeYards: message.r,
        rangeSaved: message.sv === 1,
        rangeSource: message.rs === "b" ? "binocular" : message.rs === "m" ? "manual" : undefined,
        requestedDaFeet: message.da,
        tableDaFeet: message.td,
        elevationMil: message.e,
        windageMil: message.w,
        elevationSource: message.es === "m" ? "manual" : message.es === "t" ? "table" : undefined,
        windMph: message.ws,
        windFromDeg: message.wf,
        cantDeg: message.c,
        activeTarget: message.a,
        targetCount: message.n,
        mode: message.mode === "a" ? "auto" : "card"
      } : message;
      renderStatus(status);
      pendingStatus?.resolve(status);
      return;
    }
    if (message.t === "p") {
      renderPlan(message);
      pendingPlan?.resolve(message);
      return;
    }
    if (message.t === "k") {
      renderKiloStatus(message);
      pendingKilo?.resolve(message);
      return;
    }
    if (typeof message.ok === "boolean" && Number.isInteger(message.seq)) {
      const pending = pendingAcks.get(message.seq);
      if (pending) pending.resolve(message);
      return;
    }
    if (message.ready) addLog("RifleHUD service is ready");
  }

  function formatNumber(value, places, suffix) {
    return Number.isFinite(value) ? `${Number(value).toFixed(places)}${suffix}` : "--";
  }

  function renderStatus(status) {
    ui.fields.target.textContent = status.target || "--";
    ui.fields.range.textContent = Number.isFinite(status.rangeYards) ? `${status.rangeYards} YD` : "--";
    ui.fields.elevation.textContent = formatNumber(status.elevationMil, 2, " MIL");
    ui.fields.cant.textContent = formatNumber(status.cantDeg, 1, "°");
    ui.fields.requestedDa.textContent = Number.isFinite(status.requestedDaFeet) ? `${status.requestedDaFeet} FT` : "--";
    ui.fields.tableDa.textContent = Number.isFinite(status.tableDaFeet) ? `${status.tableDaFeet} FT` : "--";
    ui.fields.wind.textContent = Number.isFinite(status.windMph)
      ? `${status.windMph.toFixed(1)} MPH${Number.isFinite(status.windFromDeg) ? ` @ ${status.windFromDeg.toFixed(0)} DEG REL` : ""}`
      : "--";
    ui.fields.windage.textContent = formatNumber(status.windageMil, 1, " MIL");
    ui.fields.rangeState.textContent = Number.isFinite(status.rangeYards)
      ? (status.rangeSource === "binocular" ? "BINOCULAR" : status.rangeSaved ? "SAVED" : "MANUAL")
      : "--";
    ui.source.textContent = status.elevationSource ? status.elevationSource.toUpperCase() : "NO SOLUTION";

    if (status.mode) {
      const modeInput = ui.modeInputs.find((input) => input.value === status.mode);
      if (modeInput) modeInput.checked = true;
    }
    if (Number.isFinite(status.requestedDaFeet)) ui.inputs.da.value = status.requestedDaFeet;
    if (Number.isFinite(status.windMph)) ui.inputs.windSpeed.value = status.windMph.toFixed(1);
    if (Number.isFinite(status.windFromDeg)) ui.inputs.windFrom.value = status.windFromDeg.toFixed(1);
    if (status.elevationSource === "manual" && Number.isFinite(status.elevationMil)) {
      ui.inputs.elevation.value = status.elevationMil.toFixed(2);
    } else {
      ui.inputs.elevation.value = "";
    }
    addLog("Status updated");
  }

  function renderKiloStatus(status) {
    const state = String(status.s || "unknown");
    ui.kiloStatus.textContent = state.replaceAll("_", " ").toUpperCase();
    const details = [];
    if (status.name) details.push(`${status.name}${Number.isFinite(status.rssi) ? ` at ${status.rssi} dBm` : ""}`);
    if (Number.isFinite(status.svc) && status.svc > 0) details.push(`${status.svc} services, ${status.chr || 0} characteristics`);
    if (Number.isFinite(status.rx) && status.rx > 0) details.push(`${status.rx} captured notifications`);
    if (Number.isFinite(status.adv)) details.push(`${status.adv} advertisements seen`);
    ui.kiloDetail.textContent = details.join(" · ") || {
      idle: "No discovery run yet.",
      scanning: "Scanning for the K3000BDX/K3000BE device name…",
      not_found: "No matching KILO advertisement was found. Confirm ABE/ABX mode and try again.",
      connect_failed: "The binocular was found but the read-only connection failed.",
      disconnected: "The binocular link disconnected. Live range remains disabled."
    }[state] || "Waiting for protocol details.";
  }

  function renderPlan(plan) {
    const targets = Array.isArray(plan.x) ? plan.x : [];
    const shown = Number.isInteger(Number(plan.show))
      ? Number(plan.show)
      : (targets.length > 0 ? (1 << targets.length) - 1 : 0);
    const mode = plan.mode === "auto" ? "auto" : "card";
    const modeInput = ui.modeInputs.find((input) => input.value === mode);
    if (modeInput) modeInput.checked = true;
    ui.targetRows.forEach((row, index) => {
      const target = targets[index];
      row.id.value = Array.isArray(target) ? String(target[0] ?? "") : "";
      row.range.value = Array.isArray(target) && Number.isFinite(Number(target[1]))
        ? Number(target[1]) : "";
      row.selected.checked = (shown & (1 << index)) !== 0;
    });
    if (Number.isFinite(plan.da)) ui.inputs.da.value = plan.da;
    if (Number.isFinite(plan.ws)) ui.inputs.windSpeed.value = Number(plan.ws).toFixed(1);
    if (Number.isFinite(plan.wf)) ui.inputs.windFrom.value = Number(plan.wf).toFixed(1);
    addLog(`Loaded ${targets.length} saved target${targets.length === 1 ? "" : "s"}`);
  }

  function rejectPending(reason) {
    pendingAcks.forEach(({ reject }) => reject(new Error(reason)));
    pendingAcks.clear();
    pendingStatus?.reject(new Error(reason));
    pendingStatus = null;
    pendingPlan?.reject(new Error(reason));
    pendingPlan = null;
    pendingKilo?.reject(new Error(reason));
    pendingKilo = null;
  }

  function handleDisconnected() {
    rejectPending("RifleHUD disconnected");
    server = null;
    rxCharacteristic = null;
    txCharacteristic = null;
    setLinkState("disconnected", "Connection closed. Tap Connect to reconnect.");
    addLog("Disconnected", "error");
  }

  async function connect() {
    if (!navigator.bluetooth) {
      ui.compatibility.classList.remove("hidden");
      throw new Error("Web Bluetooth is unavailable in this browser");
    }
    addLog("Opening Bluetooth device chooser");
    setLinkState("connecting", "Opening the Bluetooth device list. Choose RifleHUD.");
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [UUIDS.service]
    });
    device.addEventListener("gattserverdisconnected", handleDisconnected);
    ui.detail.textContent = "Opening encrypted RifleHUD service…";
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(UUIDS.service);
    [rxCharacteristic, txCharacteristic] = await Promise.all([
      service.getCharacteristic(UUIDS.rx),
      service.getCharacteristic(UUIDS.tx)
    ]);
    txCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      handleMessage(event.target.value);
    });
    await txCharacteristic.startNotifications();
    setLinkState("connected", `Connected to ${device.name || "RifleHUD"}.`);
    addLog("Connected", "success");
    try {
      const initialValue = await txCharacteristic.readValue();
      handleMessage(initialValue);
    } catch {
      // Notifications and commands are sufficient if the initial read is unavailable.
    }
    await fetchStatus();
    await fetchPlan();
    await fetchKiloStatus();
  }

  function disconnect() {
    if (device?.gatt?.connected) device.gatt.disconnect();
    else handleDisconnected();
  }

  function requireInteger(input, minimum, maximum, label) {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}`);
    }
    return value;
  }

  function requireNumber(input, minimum, maximum, label) {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`${label} must be from ${minimum} to ${maximum}`);
    }
    return value;
  }

  function optionalZero(input, minimum, maximum, label) {
    if (input.value.trim() === "") return 0;
    return requireNumber(input, minimum, maximum, label);
  }

  function bindForm(id, buildCommand) {
    byId(id).addEventListener("submit", (event) => {
      event.preventDefault();
      enqueue(async () => exchangeCommand(buildCommand()));
    });
  }

  // Web Bluetooth requires requestDevice() to run directly from the user's
  // tap. Deferring connect through the command queue can lose that activation
  // in Bluefy and prevent its device chooser from opening.
  ui.connect.onclick = () => {
    ui.detail.textContent = "Connect tapped. Opening Bluetooth chooser...";
    connect().catch((error) => {
      const message = error.message || String(error);
      addLog(message, "error");
      setLinkState("disconnected", message || "Connection failed");
    });
  };
  ui.disconnect.addEventListener("click", disconnect);
  ui.refresh.addEventListener("click", () => enqueue(async () => {
    await fetchStatus();
    await fetchPlan();
    await fetchKiloStatus();
  }));
  ui.kiloProbe.addEventListener("click", () => enqueue(async () => {
    await exchangeCommand({ type: "kilo_probe" });
    renderKiloStatus({ s: "scanning" });
    for (let attempt = 0; attempt < 8 && server?.connected; ++attempt) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const status = await fetchKiloStatus();
      if (!["scanning", "found", "connecting"].includes(status.s)) break;
    }
  }));
  byId("clear-log-button").addEventListener("click", () => { ui.log.replaceChildren(); });

  bindForm("plan-form", () => {
    const targets = [];
    let shown = 0;
    let sawEmpty = false;
    ui.targetRows.forEach((row, index) => {
      const id = row.id.value.trim();
      const rangeText = row.range.value.trim();
      if (!id && !rangeText) {
        sawEmpty = true;
        return;
      }
      if (sawEmpty) throw new Error("Fill target rows consecutively without gaps");
      if (!/^[A-Za-z0-9_-]{1,11}$/.test(id)) {
        throw new Error(`Target ${index + 1} ID must use 1-11 letters, numbers, dashes, or underscores`);
      }
      const yards = requireInteger(row.range, 1, 5000, `Target ${index + 1} range`);
      if (targets.some((target) => target[0] === id)) throw new Error(`Target ID ${id} is duplicated`);
      if (row.selected.checked) shown |= 1 << targets.length;
      targets.push([id, yards]);
    });
    const mode = ui.modeInputs.find((input) => input.checked)?.value || "card";
    if (mode === "card" && targets.length === 0) {
      throw new Error("Enter at least one target for DOPE Card mode");
    }
    if (mode === "card" && shown === 0) {
      throw new Error("Check at least one target to show on the DOPE Card");
    }
    const active = shown === 0
      ? 0
      : Math.trunc(Math.log2(shown & -shown));
    const mph = optionalZero(ui.inputs.windSpeed, 0, 20, "Wind speed");
    if (mph > 0 && ui.inputs.windFrom.value.trim() === "") {
      throw new Error("Enter a wind-FROM bearing for nonzero wind");
    }
    return {
      type: "plan",
      mode,
      show: shown,
      x: targets,
      a: active,
      feet: requireInteger(ui.inputs.da, -10000, 30000, "Density altitude"),
      mph,
      from: optionalZero(ui.inputs.windFrom, 0, 359.999, "Wind bearing")
    };
  });
  bindForm("override-form", () => ({
    type: "override",
    mil: requireNumber(ui.inputs.elevation, -20, 40, "Elevation override")
  }));

  if (!navigator.bluetooth) ui.compatibility.classList.remove("hidden");
  setLinkState("disconnected", "Controls loaded. Power on the StickS3, then tap Connect.");
  ui.build.textContent = "Web client v0.11 · controls loaded";
  addLog("Web controls loaded", "success");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          ui.offlineNotice.classList.add("ready");
          ui.offlineLabel.textContent = "Offline access ready";
        })
        .catch((error) => {
          ui.offlineNotice.classList.add("error");
          ui.offlineLabel.textContent = "Offline cache unavailable";
          addLog(`Offline cache: ${error.message || error}`, "error");
        });
    });
  } else {
    ui.offlineNotice.classList.add("error");
    ui.offlineLabel.textContent = "Offline cache unsupported in this browser";
  }
})();
