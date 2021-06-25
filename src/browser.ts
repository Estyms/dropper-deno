import { 
  hasJsonStructure,
  connectWebSocket
 } from './helpers.ts'
import { 
  EventEmitter,
  v4,
  websocketEvents
} from '../deps.ts'

export default class Dropper extends EventEmitter {
  public uuid: string;
  public _socket: WebSocket | null = null;
  public readonly uri: string | null = null;
  constructor(arg?: string, private options?: any) {
    super();
    this.options = Object.assign({
      endpoint: '/dropper',
      uuid: v4.generate()
     }, this.options)
    this.uuid = this.options.uuid
    this.uri = this.uri = arg ? arg + this.options.endpoint : 'ws://localhost:8080' + this.options.endpoint;
    connectWebSocket(this.uri, this.uuid).then((socket:WebSocket) => {
      this._socket = socket;
      this.init(this._socket);
    }).catch((err:any) => {
      console.log(err);
      this.emit("error", err);
    });
  }

  // Client API

  public async send(evt: string | Uint8Array | object, data?: string | Uint8Array | object): Promise<void> {
    const dataPush : string = data ? JSON.stringify({ evt, data }) : JSON.stringify(evt);   
    if (this._socket !== null && !this._socket.CLOSED ) await this._socket.send(dataPush)
  }

  public async broadcast(evt: string | Uint8Array | object, data?: string | Uint8Array | object): Promise<void> {    
    if (this._socket !== null) {
      const dataPush : object = data ? { evt, data, client: this.uuid }: { evt: 'message', data: evt, client: this.uuid };
      const broadcast: string = JSON.stringify({evt: '_broadcast_', data: dataPush})
      if (this._socket !== null && !this._socket.CLOSED ) await this._socket.send(broadcast)
    }
  }

  public async close(code = 1005, reason = ""): Promise<void> {
    if (this._socket !== null && !this._socket.CLOSED) {
      return await this._socket.close(code, reason);
    }
  }

  public async ping(data?: string) {
    await this?._socket?.send(JSON.stringify({ evt: '_ping_', data}))
  }

  // Client side handler

  private async init(socket: WebSocket): Promise<void> {
    this.emit("open");
    socket.onclose = (ev) => {
      const { code, reason } = ev;
      this.emit("close", code, reason);
    }
    for await (const  { data: ev  } of websocketEvents(socket)) {
      try {
        if (hasJsonStructure(ev)) {
          const { evt, data, client } = JSON.parse(ev);
          /* @ts-ignore */
          if (!this?._socket?.isClosed) this._socket?.send(JSON.stringify({ evt: '_pong_', data}))
          if (evt !== '_ping_' && evt !== '_pong_') this.emit("_all_", ev);
          if (client !== this.uuid) this.emit(evt, data);
        } else {
           this.emit("_all_", ev);
           this.emit('message', ev)
        }
      } catch (e) {
        this.emit("error", e);
        await this.close(1000);
      }
    }
  }
}