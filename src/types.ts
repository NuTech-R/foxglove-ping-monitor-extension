/** パネルの永続化ステート（settings tree の値を含む） */
export interface PingMonitorState {
  latencyTopic: string;
  packetLossTopic: string;
  historySize: number;
  staleTimeoutMs: number;
}

/** std_msgs/Float32 メッセージ */
export interface Float32Message {
  data: number;
}

/** 接続ステータスの種類 */
export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "NO DATA";

/** デフォルト設定 */
export const DEFAULT_STATE: PingMonitorState = {
  latencyTopic: "/ping_latency",
  packetLossTopic: "/ping_packet_loss",
  historySize: 60,
  staleTimeoutMs: 3000,
};
