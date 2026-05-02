import { ExtensionContext } from "@foxglove/extension";

import { initPingMonitorPanel } from "./PingMonitorPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "ping-monitor",
    initPanel: initPingMonitorPanel,
  });
}
