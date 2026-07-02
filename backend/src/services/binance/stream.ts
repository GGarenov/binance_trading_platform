import { Spot, SpotWebsocketStreams } from "@binance/spot";

export type PriceListener = (price: number, eventTimeMs: number) => void;

/**
 * Shared WebSocket connection to Binance with one miniTicker subscription per
 * symbol, fanned out to any number of listeners. Paper trading sessions
 * (Phase 6) register listeners here instead of each opening its own socket.
 */
class PriceStream {
  private client = new Spot({ configurationWebsocketStreams: {} });
  private connection: SpotWebsocketStreams.WebsocketStreamsConnection | null = null;
  private streams = new Map<
    string,
    { stream: { unsubscribe: () => void }; listeners: Set<PriceListener> }
  >();

  private async getConnection() {
    if (!this.connection) {
      this.connection = await this.client.websocketStreams.connect();
    }
    return this.connection;
  }

  /** Returns an unsubscribe function for this listener. */
  async subscribe(symbol: string, listener: PriceListener): Promise<() => void> {
    const key = symbol.toUpperCase();
    let entry = this.streams.get(key);

    if (!entry) {
      const connection = await this.getConnection();
      // miniTicker: one compact update per second per symbol — plenty for
      // paper trading, far less traffic than the raw trade stream.
      const stream = connection.miniTicker({ symbol: key.toLowerCase() });
      const listeners = new Set<PriceListener>();
      stream.on("message", (data: SpotWebsocketStreams.MiniTickerResponse) => {
        const price = Number(data.c);
        const eventTime = Number(data.E);
        for (const l of listeners) l(price, eventTime);
      });
      entry = { stream, listeners };
      this.streams.set(key, entry);
    }

    entry.listeners.add(listener);

    return () => {
      const current = this.streams.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        current.stream.unsubscribe();
        this.streams.delete(key);
      }
    };
  }
}

export const priceStream = new PriceStream();
