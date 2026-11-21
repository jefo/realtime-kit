interface Props {
    values: number[];
    width?: number;
    height?: number;
    stroke?: string;
    fill?: string;
    area?: boolean;
    min?: number;
    max?: number;
    label?: string;
}
declare const Sparkline: import("svelte").Component<Props, {}, "">;
type Sparkline = ReturnType<typeof Sparkline>;
export default Sparkline;
