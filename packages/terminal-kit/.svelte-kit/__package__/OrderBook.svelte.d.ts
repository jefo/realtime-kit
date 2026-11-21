import type { OrderBookLevel } from "./types";
interface Props {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    maxRows?: number;
    priceDecimals?: number;
    sizeDecimals?: number;
    /** Aggregate levels into buckets of this size. */
    tickSize?: number;
    showSpread?: boolean;
    title?: string;
}
declare const OrderBook: import("svelte").Component<Props, {}, "">;
type OrderBook = ReturnType<typeof OrderBook>;
export default OrderBook;
