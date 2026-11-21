import type { ConnectionStatus } from "./types";
interface Props {
    status: ConnectionStatus;
    label?: string;
    latencyMs?: number;
}
declare const ConnectionBadge: import("svelte").Component<Props, {}, "">;
type ConnectionBadge = ReturnType<typeof ConnectionBadge>;
export default ConnectionBadge;
