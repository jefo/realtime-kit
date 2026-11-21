import type { Snippet } from "svelte";
interface Props {
    theme?: "dark" | "light";
    density?: "compact" | "comfortable";
    /** Any CSS color. Overrides `--rtk-accent`. */
    accent?: string;
    class?: string;
    children: Snippet;
}
declare const ThemeProvider: import("svelte").Component<Props, {}, "">;
type ThemeProvider = ReturnType<typeof ThemeProvider>;
export default ThemeProvider;
