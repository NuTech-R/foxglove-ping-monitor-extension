import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/extension";

import { PingMonitorState } from "./types";

/** Settings tree のノード定義を生成する */
export function buildSettingsTree(state: PingMonitorState): SettingsTreeNodes {
  return {
    general: {
      label: "General",
      fields: {
        latencyTopic: {
          label: "Latency Topic",
          input: "string",
          value: state.latencyTopic,
          help: "RTT (ms) を publish するトピック (std_msgs/Float32)",
        },
        packetLossTopic: {
          label: "Packet Loss Topic",
          input: "string",
          value: state.packetLossTopic,
          help: "パケットロス (0.0 or 100.0) を publish するトピック (std_msgs/Float32)",
        },
        historySize: {
          label: "History Size",
          input: "number",
          value: state.historySize,
          min: 10,
          max: 600,
          step: 10,
          help: "統計・スパークラインに使用するサンプル数",
        },
        staleTimeoutMs: {
          label: "Disconnect Timeout (ms)",
          input: "number",
          value: state.staleTimeoutMs,
          min: 1000,
          max: 30000,
          step: 500,
          help: "この時間メッセージが来なければ DISCONNECTED 表示にする",
        },
      },
    },
  };
}

/** Settings tree のアクションから state を更新する */
export function handleSettingsAction(
  state: PingMonitorState,
  action: SettingsTreeAction,
): PingMonitorState {
  if (action.action !== "update" || action.payload.path.length < 2) {
    return state;
  }

  const field = action.payload.path[1];
  const value = action.payload.value;

  if (field == undefined) {
    return state;
  }

  switch (field) {
    case "latencyTopic":
      return { ...state, latencyTopic: String(value ?? "") };
    case "packetLossTopic":
      return { ...state, packetLossTopic: String(value ?? "") };
    case "historySize":
      return { ...state, historySize: Number(value ?? 60) };
    case "staleTimeoutMs":
      return { ...state, staleTimeoutMs: Number(value ?? 3000) };
    default:
      return state;
  }
}
