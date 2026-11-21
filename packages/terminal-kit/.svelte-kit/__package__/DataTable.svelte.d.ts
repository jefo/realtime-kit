import type { Snippet } from "svelte";
import type { Column } from "./types";
export interface Props<Row> {
    rows: Row[];
    columns: Column<Row>[];
    /** Stable identity for rows. Strongly recommended when rows reorder. */
    rowKey?: (row: Row, index: number) => string | number;
    selectedKey?: string | number | null;
    onRowClick?: (row: Row) => void;
    caption?: string;
    empty?: Snippet;
    loading?: boolean;
    density?: "compact" | "comfortable";
    maxHeight?: string;
    stickyHeader?: boolean;
}
declare function $$render<Row>(): {
    props: Props<Row>;
    exports: {};
    bindings: "";
    slots: {};
    events: {};
};
declare class __sveltets_Render<Row> {
    props(): ReturnType<typeof $$render<Row>>['props'];
    events(): ReturnType<typeof $$render<Row>>['events'];
    slots(): ReturnType<typeof $$render<Row>>['slots'];
    bindings(): "";
    exports(): {};
}
interface $$IsomorphicComponent {
    new <Row>(options: import('svelte').ComponentConstructorOptions<ReturnType<__sveltets_Render<Row>['props']>>): import('svelte').SvelteComponent<ReturnType<__sveltets_Render<Row>['props']>, ReturnType<__sveltets_Render<Row>['events']>, ReturnType<__sveltets_Render<Row>['slots']>> & {
        $$bindings?: ReturnType<__sveltets_Render<Row>['bindings']>;
    } & ReturnType<__sveltets_Render<Row>['exports']>;
    <Row>(internal: unknown, props: ReturnType<__sveltets_Render<Row>['props']> & {}): ReturnType<__sveltets_Render<Row>['exports']>;
    z_$$bindings?: ReturnType<__sveltets_Render<any>['bindings']>;
}
declare const DataTable: $$IsomorphicComponent;
type DataTable<Row> = InstanceType<typeof DataTable<Row>>;
export default DataTable;
