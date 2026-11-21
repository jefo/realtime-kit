interface Props {
    label: string;
    value: string | number;
    /** Percent change, e.g. `1.24` for +1.24%. */
    delta?: number;
    deltaLabel?: string;
    hint?: string;
    trend?: "up" | "down" | "flat";
    prefix?: string;
    suffix?: string;
    decimals?: number;
}
declare const Metric: import("svelte").Component<Props, {}, "">;
type Metric = ReturnType<typeof Metric>;
export default Metric;
