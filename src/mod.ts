import { 
  hasJsonStructure, 
  connectWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  isWebSocketPongEvent
} from './helpers.ts'
import { 
  EventEmitter, 
  v4, 
  serve,
  ServerRequest,
  acceptWebSocket,
  websocketEvents
} from '../deps.ts'

class Dropper extends EventEmitter {
  public uuid: string;
  public _socket: WebSocket | null = null;
  public readonly uri: string | null = null;
  constructor(arg: WebSocket | string, private options?: any) {
    super();
    this.options = Object.assign({
      endpoint: '/dropper',
      uuid: v4.generate()
     }, this.options)
     this.uuid = this.options.uuid
    if (typeof arg === "string" || typeof arg === 'undefined') {
      this.uri = arg ? arg + this.options.endpoint : 'ws://localhost:8080' + this.options.endpoint;
      // Connect WebSocket
      connectWebSocket(this.uri, this.uuid).then((socket:WebSocket) => {
        this._socket = socket;
        this.initClient(this._socket);
      }).catch((err:Error) => {
        this.emit("error", err);
      });
    } else {
      this._socket = arg;
      this.uri = arg.url;
      this.initServeClient(this._socket);
    }
  }

  // Client API

  public async send(evt: string | Uint8Array | object, data?: string | Uint8Array | object): Promise<void> {
    const dataPush: string = data ? JSON.stringify({ evt, data }) : JSON.stringify(evt);    
    if (this._socket !== null && !this._socket.CLOSED) await this._socket?.send(dataPush)
  }

  public async broadcast(evt: string | Uint8Array | object, data?: string | Uint8Array | object): Promise<void> {    
    if (this._socket !== null && !this._socket.CLOSED ) {
      const dataPush: object = data ? { evt, data, client: this.uuid }: { evt: 'message', data: evt, client: this.uuid };
      const broadcast: string = JSON.stringify({evt: '_broadcast_', data: dataPush})
      /* @ts-ignore */ 
    if (this._socket !== null && !this._socket.CLOSED ) await this._socket?.send(broadcast)
    }
  }

  public async close(code = 1005, reason = ""): Promise<void> {
    /* @ts-ignore */ 
    if (this._socket !== null || !this._socket?.isClosed ) {
      return await this._socket?.close(code, reason)
    }
  }

  public async ping(data?: string) {
    await this?._socket?.send(JSON.stringify({ evt: '_ping_', data}))
  }

  // Client side handler

  private async initClient(socket: WebSocket): Promise<void> {
    this.emit("open");
    socket.onclose = (ev) => {
      const { code, reason } = ev;
      this.emit("close", code, reason);
    }
    for await (const  { data: ev  } of websocketEvents(socket)) {
      try {
        if (hasJsonStructure(ev)) {
          let { evt, data, client } = JSON.parse(ev);
          /* @ts-ignore */
          if (evt == '_ping_') if (!this._socket?.isClosed) this._socket?.send(JSON.stringify({ evt: '_pong_', data}))
          if (evt !== '_ping_' && evt !== '_pong_') this.emit("_all_", ev);
          if (client !== this.uuid) this.emit(evt, data)
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

  // Server side client handler

  private async initServeClient(socket: any): Promise<void> {
    this.emit("open");
    for await (const ev of socket) {
      try {
        if (typeof ev === "string") {
          if (hasJsonStructure(ev)) {
            const { evt, data } = JSON.parse(ev);
            /* @ts-ignore */
            if (evt == '_ping_')  if (!this._socket?.isClosed) this._socket?.send(JSON.stringify({ evt: '_pong_', data}))
            if (evt !== '_ping_' && evt !== '_pong_') this.emit("_all_", ev);
            this.emit(evt, data)
          } else {
            this.emit("_all_", ev)
            this.emit('message', ev)
          }
        } else if (ev instanceof Uint8Array) {
          this.emit("_binary_", ev);
        } else if (isWebSocketPingEvent(ev)) { 
          const [, body] = ev;
          this.emit("_ping_", body);
        } else if (isWebSocketCloseEvent(ev)) {
          const { code, reason } = ev;
          this.emit("close", code, reason);
        } else if (isWebSocketPongEvent(ev)) {
          const [, body] = ev;
          this.emit("_pong_", body);
        }
      } catch (e) {
        this.emit("error", e);
        await this.close(1000);
      }
    }
  }
}

 class Server extends EventEmitter {
   private willClose = false;
   public clients: Map<string, Dropper> = new Map();
   private user_agent : any = '';
   constructor(public options?: any) {
     super();
     this.options = Object.assign({
      host: 'localhost',
      port: 8080,
      interval: 3000,
      serve: true,
      endpoint: '/dropper'
     }, this.options)
     if (this.options?.serve) this.serve();
   }

   // Server API

   public async send(evt: string | Uint8Array | object, data ? : string | Uint8Array | object): Promise < void > {
     const dataPush: string = data ? JSON.stringify({
       evt,
       data
     }) : JSON.stringify(evt);
     await this.clients.forEach((client) => {
       if (!client?._socket?.CLOSED) client?._socket?.send(dataPush)
     })
   }

   private async serve(): Promise < void > {
    const server = serve(`${this.options?.host}:${this.options?.port}`);
    for await (const req of server) {
     if (this.willClose) break;
     this.handle(req)
    }
  }

   // Server side handler

   public async handle(req: ServerRequest): Promise <void> {
    const {
      headers,
      conn, 
      url
    } = req;
    this.user_agent = headers.get('user-agent');  
    await acceptWebSocket({
        conn,
        headers,
        bufReader: req.r,
        bufWriter: req.w,
      })
      .then(
        async (socket: any): Promise < void > => {
          let client: Dropper | null = new Dropper(socket, { uuid: new URL(`http://localhost:3000${url}`).searchParams.get('id') });
          const uuid = client.uuid;
          this.clients.set(uuid, client);
          // Connection checker
          let tm: number;
          const ping = () => {              
             if (client != null && !client?._socket?.CLOSED) client.ping()
             tm = setTimeout( () => {
               clearInterval(int || 0);
               this.emit("disconnection", 1001, 'Client is leaving', client)
               this.clients.delete(uuid);
               this.clients.forEach(async (c) => {
                 const sendDisconnection = JSON.stringify({evt: "disconnection", data: uuid})
                 await c?._socket?.send(sendDisconnection)
               })
               client = null;
             }, 1000);
          }

          // Interval initialization

          const userCheck = new RegExp('Deno', 'i');

          const int = userCheck.test(this.user_agent) ? setInterval(ping, this.options.interval) : null;
          client.on('_pong_', () => {               
           clearTimeout(tm);
          })
          client.on("close", (code, reason) => {
            clearInterval(int || 0);
            this.emit("disconnection", code, reason || 'Client is leaving', client)
            this.clients.delete(uuid);
            this.clients.forEach(async (c) => {
             const sendDisconnection = JSON.stringify({evt: "disconnection", data: uuid})
             if (!c?._socket?.CLOSED) await c?._socket?.send(sendDisconnection)
            })
            client = null;
          });
          // Global Events          
          client.on('_all_', ev => {
           this.emit('_all_', ev);
           if (hasJsonStructure(ev)) {
             const { evt, data } = JSON.parse(ev);
             this.emit(evt, data)
           } else {
             this.emit('message', ev)
           }
          })
          // Broadcast
          client.on("_broadcast_", data => {
            const dataSend = JSON.stringify(data)
            this.clients.forEach(async (c) => {
              if (!c?._socket?.CLOSED) await c?._socket?.send(dataSend)
            })
          })
          const allowConnect = this.emit("connection", client, req);
          if (allowConnect !== undefined && !allowConnect) {
            await client.close(1002, "Access Denied");
          }
        }
      )
      .catch((err: Error): void => {
        this.emit("error", err);
      });
   }
 }

export default Dropper;

export {
  Server,
  Dropper
}
