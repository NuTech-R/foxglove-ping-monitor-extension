import { MessageEvent, PanelExtensionContext, Topic } from "@foxglove/extension";

import { buildSettingsTree, handleSettingsAction } from "./settings";
import { ConnectionStatus, DEFAULT_STATE, Float32Message, PingMonitorState } from "./types";

// ---------- ヘルパー ----------

function latencyColor(value: number): string {
  if (value < 0) return "#ef4444";
  if (value <= 50) return "#22c55e";
  if (value <= 150) return "#eab308";
  return "#f97316";
}

function statusColor(status: ConnectionStatus): string {
  switch (status) {
    case "CONNECTED": return "#22c55e";
    case "DISCONNECTED": return "#ef4444";
    case "NO DATA": return "#9ca3af";
  }
}

function computeStats(history: number[]): { min: number; avg: number; max: number } | undefined {
  const valid = history.filter((v) => v >= 0);
  if (valid.length === 0) return undefined;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return { min, avg, max };
}

function computeLossRate(history: number[]): number | undefined {
  if (history.length === 0) return undefined;
  const lost = history.filter((v) => v >= 100).length;
  return (lost / history.length) * 100;
}

function getConnectionStatus(
  latency: number | undefined,
  packetLoss: number | undefined,
  isStale: boolean,
): ConnectionStatus {
  if (latency == undefined && packetLoss == undefined) return "NO DATA";
  // メッセージ自体が途絶した場合も操縦者にとっては切断と同じ
  if (isStale) return "DISCONNECTED";
  if (packetLoss != undefined && packetLoss >= 100) return "DISCONNECTED";
  if (packetLoss != undefined && packetLoss === 0) return "CONNECTED";
  if (latency != undefined && latency >= 0) return "CONNECTED";
  if (latency != undefined && latency < 0) return "DISCONNECTED";
  return "NO DATA";
}

// ---------- スパークライン SVG 生成 ----------

function buildSparklineSvg(data: number[], width: number, height: number, isDark: boolean): string {
  if (data.length < 2) {
    const fill = isDark ? "#616161" : "#9ca3af";
    return `<svg width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" font-size="11">Waiting for data...</text></svg>`;
  }

  const validValues = data.filter((v) => v >= 0);
  const maxVal = validValues.length > 0 ? Math.max(...validValues, 1) : 1;
  const pad = 4;
  const innerH = height - pad * 2;
  const stepX = (width - pad * 2) / (data.length - 1);
  const lineColor = isDark ? "#4fc3f7" : "#3b82f6";
  const gridColor = isDark ? "#2e2e2e" : "#e5e7eb";

  let svg = `<svg width="${width}" height="${height}" style="display:block">`;
  // グリッド
  for (const frac of [0, 0.5, 1]) {
    const y = (pad + innerH * frac).toFixed(1);
    svg += `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="${gridColor}" stroke-width="0.5"/>`;
  }

  // パスと失敗ポイント
  let path = "";
  let dots = "";
  for (let i = 0; i < data.length; i++) {
    const x = pad + i * stepX;
    const v = data[i]!;
    if (v < 0) {
      if (path.length > 0) {
        svg += `<path d="${path}" fill="none" stroke="${lineColor}" stroke-width="1.5"/>`;
        path = "";
      }
      dots += `<circle cx="${x.toFixed(1)}" cy="${(pad + innerH * 0.5).toFixed(1)}" r="2" fill="#ef4444"/>`;
    } else {
      const y = pad + innerH - (v / maxVal) * innerH;
      path += path.length === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`;
    }
  }
  if (path.length > 0) {
    svg += `<path d="${path}" fill="none" stroke="${lineColor}" stroke-width="1.5"/>`;
  }
  svg += dots;
  svg += `</svg>`;
  return svg;
}

// ---------- DOM 構築 ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (style) Object.assign(e.style, style);
  if (text != undefined) e.textContent = text;
  return e;
}

// ---------- メインパネル ----------

export function initPingMonitorPanel(context: PanelExtensionContext): () => void {
  // ステート
  let state: PingMonitorState = { ...DEFAULT_STATE, ...(context.initialState as Partial<PingMonitorState>) };
  let latency: number | undefined;
  let packetLoss: number | undefined;
  const latencyHistory: number[] = [];
  const lossHistory: number[] = [];
  let lastMsgTime = 0;
  let isStale = false;
  let isDark = true;
  let allTopics: readonly Topic[] = [];

  // DOM 要素
  const root = context.panelElement;
  root.style.overflow = "auto";

  const container = el("div", {
    padding: "12px",
    height: "100%",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });
  root.appendChild(container);

  const warningBox = el("div");
  container.appendChild(warningBox);

  const statusBanner = el("div", {
    borderRadius: "8px",
    padding: "12px",
    textAlign: "center",
    fontWeight: "700",
    fontSize: "20px",
    letterSpacing: "0.05em",
    color: "#ffffff",
  });
  container.appendChild(statusBanner);

  // レイテンシカード
  const latencyCard = el("div", { borderRadius: "8px", padding: "12px", textAlign: "center" });
  const latencyLabel = el("div", { fontSize: "11px", marginBottom: "4px" }, "LATENCY");
  const latencyValue = el("div", { fontSize: "36px", fontWeight: "700", fontVariantNumeric: "tabular-nums" });
  const latencyNote = el("div", { fontSize: "12px", color: "#ef4444", marginTop: "2px" });
  latencyCard.append(latencyLabel, latencyValue, latencyNote);
  container.appendChild(latencyCard);

  // 統計カード
  const statsCard = el("div", {
    borderRadius: "8px",
    padding: "10px 12px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr 1fr",
    gap: "8px",
    fontSize: "12px",
  });
  const statEls = ["MIN", "AVG", "MAX", "LOSS"].map((label) => {
    const wrap = el("div", { textAlign: "center" });
    const lbl = el("div", { fontSize: "10px", opacity: "0.7", marginBottom: "2px" }, label);
    const val = el("div", { fontWeight: "600", fontVariantNumeric: "tabular-nums" }, "--");
    wrap.append(lbl, val);
    statsCard.appendChild(wrap);
    return { label: lbl, value: val };
  });
  container.appendChild(statsCard);

  // スパークラインカード
  const sparkCard = el("div", { borderRadius: "8px", padding: "8px" });
  const sparkLabel = el("div", { fontSize: "11px", marginBottom: "4px" });
  const sparkContainer = el("div");
  sparkCard.append(sparkLabel, sparkContainer);
  container.appendChild(sparkCard);

  // ---------- テーマ適用 ----------
  function applyTheme(): void {
    const bg = isDark ? "#121212" : "#ffffff";
    const text = isDark ? "#e0e0e0" : "#1f2937";
    const muted = isDark ? "#757575" : "#6b7280";
    const cardBg = isDark ? "#1e1e1e" : "#f9fafb";
    const border = `1px solid ${isDark ? "#2e2e2e" : "#e5e7eb"}`;

    container.style.background = bg;
    container.style.color = text;
    latencyCard.style.background = cardBg;
    latencyCard.style.border = border;
    latencyLabel.style.color = muted;
    statsCard.style.background = cardBg;
    statsCard.style.border = border;
    sparkCard.style.background = cardBg;
    sparkCard.style.border = border;
    sparkLabel.style.color = muted;

    for (const s of statEls) {
      s.label.style.color = muted;
    }
  }

  // ---------- UI 更新 ----------
  function updateUI(): void {
    const status = getConnectionStatus(latency, packetLoss, isStale);
    const muted = isDark ? "#9ca3af" : "#6b7280";

    // ステータスバナー
    statusBanner.style.background = statusColor(status);
    statusBanner.textContent = status;

    // スキーマ警告
    warningBox.innerHTML = "";
    for (const t of allTopics) {
      if (
        (t.name === state.latencyTopic || t.name === state.packetLossTopic) &&
        t.schemaName !== "std_msgs/Float32" &&
        t.schemaName !== "std_msgs/msg/Float32"
      ) {
        const w = el("div", {
          background: "#fef3c7",
          color: "#92400e",
          padding: "6px 10px",
          borderRadius: "4px",
          fontSize: "12px",
          marginBottom: "4px",
        }, `\u26a0 Topic "${t.name}" のスキーマが "${t.schemaName}" です（期待: std_msgs/Float32）`);
        warningBox.appendChild(w);
      }
    }

    // トピック未設定
    if (state.latencyTopic.length === 0 && state.packetLossTopic.length === 0) {
      latencyValue.textContent = "--";
      latencyValue.style.color = muted;
      latencyNote.textContent = "トピックが設定されていません";
      return;
    }

    // レイテンシ
    if (latency == undefined) {
      latencyValue.textContent = "--";
      latencyValue.style.color = muted;
      latencyNote.textContent = "";
    } else if (latency < 0) {
      latencyValue.textContent = "--";
      latencyValue.style.color = latencyColor(latency);
      latencyNote.textContent = "ping failed";
    } else {
      latencyValue.textContent = `${latency.toFixed(1)} ms`;
      latencyValue.style.color = latencyColor(latency);
      latencyNote.textContent = "";
    }

    // 統計
    const stats = computeStats(latencyHistory);
    const lossRate = computeLossRate(lossHistory);

    statEls[0]!.value.textContent = stats ? `${stats.min.toFixed(1)} ms` : "--";
    statEls[1]!.value.textContent = stats ? `${stats.avg.toFixed(1)} ms` : "--";
    statEls[2]!.value.textContent = stats ? `${stats.max.toFixed(1)} ms` : "--";
    statEls[3]!.value.textContent = lossRate != undefined ? `${lossRate.toFixed(1)}%` : "--";
    statEls[3]!.value.style.color = lossRate != undefined && lossRate > 0 ? "#ef4444" : "";

    // スパークライン
    sparkLabel.textContent = `LATENCY HISTORY (${latencyHistory.length}/${state.historySize})`;
    sparkContainer.innerHTML = buildSparklineSvg(latencyHistory, 320, 60, isDark);
  }

  // ---------- Settings ----------
  function syncSettings(): void {
    context.saveState(state);
    context.updatePanelSettingsEditor({
      actionHandler: (action) => {
        state = handleSettingsAction(state, action);
        syncSettings();
        // トピック変更時は再購読
        subscribe();
        updateUI();
      },
      nodes: buildSettingsTree(state),
    });
  }

  function subscribe(): void {
    const subs: Array<{ topic: string }> = [];
    if (state.latencyTopic.length > 0) subs.push({ topic: state.latencyTopic });
    if (state.packetLossTopic.length > 0) subs.push({ topic: state.packetLossTopic });
    context.subscribe(subs);
  }

  // ---------- Stale タイマー ----------
  const staleTimer = setInterval(() => {
    if (lastMsgTime > 0 && Date.now() - lastMsgTime > state.staleTimeoutMs) {
      if (!isStale) {
        isStale = true;
        updateUI();
      }
    }
  }, 500);

  // ---------- Render ハンドラ ----------
  context.onRender = (renderState, done) => {
    if (renderState.colorScheme) {
      const newDark = renderState.colorScheme === "dark";
      if (newDark !== isDark) {
        isDark = newDark;
        applyTheme();
      }
    }

    if (renderState.topics) {
      allTopics = renderState.topics;
    }

    if (renderState.currentFrame) {
      for (const msg of renderState.currentFrame) {
        const event = msg as MessageEvent<Float32Message>;
        const value = event.message.data;

        if (msg.topic === state.latencyTopic) {
          lastMsgTime = Date.now();
          isStale = false;
          latency = value;
          latencyHistory.push(value);
          while (latencyHistory.length > state.historySize) latencyHistory.shift();
        }

        if (msg.topic === state.packetLossTopic) {
          lastMsgTime = Date.now();
          isStale = false;
          packetLoss = value;
          lossHistory.push(value);
          while (lossHistory.length > state.historySize) lossHistory.shift();
        }
      }
    }

    updateUI();
    done();
  };

  context.watch("topics");
  context.watch("currentFrame");
  context.watch("colorScheme");

  syncSettings();
  subscribe();
  applyTheme();
  updateUI();

  // クリーンアップ
  return () => {
    clearInterval(staleTimer);
    root.innerHTML = "";
  };
}
