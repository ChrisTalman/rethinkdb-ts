import { EventEmitter } from 'events';
import { Socket, TcpNetConnectOpts, connect as netConnect } from 'net';
import { connect as tlsConnect } from 'tls';
import { isError, isObject } from 'util';
import { RServerConnectionOptions, RebirthDBErrorType } from '..';
import { RebirthDBError } from '../error/error';
import { QueryJson, ResponseJson } from '../internal-types';
import { QueryType, ResponseType } from '../proto/enums';
import {
  NULL_BUFFER,
  buildAuthBuffer,
  compareDigest,
  computeSaltedPassword,
  validateVersion
} from './handshake-utils';

export type RNConnOpts = RServerConnectionOptions & {
  host: string;
  port: number;
};

export class RebirthDBSocket extends EventEmitter {
  public connectionOptions: RNConnOpts;
  public readonly user: string;
  public readonly password: Buffer;
  public lastError?: Error;
  public get status() {
    if (!!this.lastError) {
      return 'errored';
    } else if (!this.isOpen) {
      return 'closed';
    } else if (this.mode === 'handshake') {
      return 'handshake';
    }
    return 'open';
  }
  public socket?: Socket;
  public runningQueries = new Map<
    number,
    {
      resolve: (data: ResponseJson | Error) => void;
      query: QueryJson;
      data: Promise<ResponseJson>;
    }
  >();
  private isOpen = false;
  private nextToken = 0;
  private buffer = new Buffer(0);
  private mode: 'handshake' | 'response' = 'handshake';
  private ca?: Buffer[];

  constructor({
    connectionOptions,
    user = 'admin',
    password = NULL_BUFFER
  }: {
    connectionOptions: RNConnOpts;
    user?: string;
    password?: Buffer;
  }) {
    super();
    this.connectionOptions = setConnectionDefaults(connectionOptions);
    this.user = user;
    this.password = password;
  }

  public eventNames() {
    return ['connect', 'query', 'data', 'release', 'error'];
  }

  public async connect() {
    if (this.socket) {
      throw new RebirthDBError('Socket already connected', {
        type: RebirthDBErrorType.CONNECTION
      });
    }
    const { tls = false, ...options } = this.connectionOptions;
    let socket: Socket = (undefined as any) as Socket;
    try {
      await new Promise((resolve, reject) => {
        socket = tls
          ? tlsConnect(options)
              .once('connect', resolve)
              .once('error', reject)
          : netConnect(options as TcpNetConnectOpts)
              .once('connect', resolve)
              .once('error', reject);
      });
    } catch (err) {
      this.handleError(err);
    }
    socket.removeAllListeners();
    socket
      .on('close', () => this.close())
      .on('error', error => this.handleError(error))
      .on('data', data => {
        try {
          this.buffer = Buffer.concat([this.buffer, data]);
          switch (this.mode) {
            case 'handshake':
              this.handleHandshakeData();
              break;
            case 'response':
              this.handleData();
              break;
          }
        } catch (error) {
          this.handleError(error);
        }
      });
    socket.setKeepAlive(true);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      if (socket.destroyed) {
        socket.removeListener('connect', resolve);
        socket.removeListener('error', reject);
        reject(this.lastError);
      } else if (!socket.connecting) {
        socket.removeListener('connect', resolve);
        socket.removeListener('error', reject);
        resolve();
      }
    });
    this.isOpen = true;
    await this.performHandshake();
    this.emit('connect');
  }

  public sendQuery(query: QueryJson, token = this.nextToken++) {
    if (!this.socket || this.status !== 'open') {
      throw new RebirthDBError(
        '`run` was called with a closed connection after:',
        { query, type: RebirthDBErrorType.CONNECTION }
      );
    }
    const encoded = JSON.stringify(query);
    const querySize = Buffer.byteLength(encoded);
    const buffer = new Buffer(8 + 4 + querySize);
    // tslint:disable-next-line:no-bitwise
    buffer.writeUInt32LE(token & 0xffffffff, 0);
    buffer.writeUInt32LE(Math.floor(token / 0xffffffff), 4);
    buffer.writeUInt32LE(querySize, 8);
    buffer.write(encoded, 12);
    const [type] = query;
    if (type === QueryType.STOP) {
      this.socket.write(buffer);
      const { resolve = null, query: runningQuery = null } =
        this.runningQueries.get(token) || {};
      if (resolve && runningQuery) {
        // Resolving and not rejecting so there won't be "unhandled rejection" if nobody listens
        resolve(
          new RebirthDBError('Query cancelled', {
            query: runningQuery,
            type: RebirthDBErrorType.CANCEL
          })
        );
        this.runningQueries.delete(token);
        this.emit('release', this.runningQueries.size);
      }
      return token;
    }
    const { noreply = false } = query[2] || {};
    if (noreply) {
      this.socket.write(buffer);
      this.emit('query', token);
      return token;
    } else {
      let resolve: any;
      const data = new Promise<ResponseJson>((res, rej) => (resolve = res));
      const { query: runningQuery = query } =
        this.runningQueries.get(token) || {};
      this.runningQueries.set(token, {
        resolve,
        data,
        query: runningQuery
      });
      this.socket.write(buffer);
      if (type !== QueryType.CONTINUE) {
        this.emit('query', token);
      }
      return token;
    }
  }

  public stopQuery(token: number) {
    return this.sendQuery([QueryType.STOP], token);
  }

  public async readNext<T = ResponseJson>(token: number): Promise<T> {
    if (!this.isOpen) {
      throw this.lastError ||
        new RebirthDBError(
          'The connection was closed before the query could be completed',
          {
            type: RebirthDBErrorType.CONNECTION
          }
        );
    }
    if (!this.runningQueries.has(token)) {
      throw new RebirthDBError('Query is not running');
    }
    const { data = null } = this.runningQueries.get(token) || {};
    if (data) {
      const res = await data;
      if (isError(res)) {
        this.runningQueries.delete(token);
        throw res;
      } else if (this.status === 'handshake') {
        this.runningQueries.delete(token);
      } else if (isObject(res) && res.t === ResponseType.SUCCESS_PARTIAL) {
        this.sendQuery([QueryType.CONTINUE], token);
      } else {
        this.runningQueries.delete(token);
        this.emit('release', this.runningQueries.size);
      }
      return res as any;
    }
    return data as any;
  }

  public close() {
    for (const { resolve, query } of this.runningQueries.values()) {
      resolve(
        new RebirthDBError(
          'The connection was closed before the query could be completed',
          {
            query,
            type: RebirthDBErrorType.CONNECTION
          }
        )
      );
    }
    this.runningQueries.clear();
    if (!this.socket) {
      return;
    }
    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = undefined;
    this.isOpen = false;
    this.mode = 'handshake';
    this.removeAllListeners();
    this.nextToken = 0;
  }

  private async performHandshake() {
    let token = 0;
    const generateRunningQuery = () => {
      let resolve: any;
      const data = new Promise<ResponseJson>((res, rej) => (resolve = res));
      this.runningQueries.set(token++, {
        resolve,
        data,
        query: [QueryType.START]
      });
    };
    if (!this.socket || this.status !== 'handshake') {
      throw new RebirthDBError('Connection is not open', {
        type: RebirthDBErrorType.CONNECTION
      });
    }
    const { randomString, authBuffer } = buildAuthBuffer(this.user);
    generateRunningQuery();
    generateRunningQuery();
    this.socket.write(authBuffer);
    validateVersion(await this.readNext<any>(0));
    const { authentication } = await this.readNext<any>(1);
    const { serverSignature, proof } = await computeSaltedPassword(
      authentication,
      randomString,
      this.user,
      this.password
    );
    generateRunningQuery();
    this.socket.write(proof);
    const { authentication: returnedSignature } = await this.readNext<any>(2);
    compareDigest(returnedSignature, serverSignature);
    this.mode = 'response';
  }

  private handleHandshakeData() {
    let index: number = -1;
    while ((index = this.buffer.indexOf(0)) >= 0) {
      const strMsg = this.buffer.slice(0, index).toString('utf8');
      const { resolve = null } =
        this.runningQueries.get(this.nextToken++) || {};
      let err: RebirthDBError | undefined;
      try {
        const jsonMsg = JSON.parse(strMsg);
        if (jsonMsg.success) {
          if (resolve) {
            resolve(jsonMsg as any);
          }
        } else {
          err = new RebirthDBError(jsonMsg.error, {
            errorCode: jsonMsg.error_code
          });
        }
      } catch {
        err = new RebirthDBError(strMsg, { type: RebirthDBErrorType.AUTH });
      }
      if (err) {
        if (resolve) {
          resolve(err);
        }
        this.handleError(err);
      }
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf(0);
    }
  }

  private handleData() {
    while (this.buffer.length >= 12) {
      const token =
        this.buffer.readUInt32LE(0) + 0x100000000 * this.buffer.readUInt32LE(4);
      const responseLength = this.buffer.readUInt32LE(8);

      if (this.buffer.length < 12 + responseLength) {
        break;
      }

      const responseBuffer = this.buffer.slice(12, 12 + responseLength);
      const response: ResponseJson = JSON.parse(
        responseBuffer.toString('utf8')
      );
      this.buffer = this.buffer.slice(12 + responseLength);
      const { resolve = null } = this.runningQueries.get(token) || {};
      if (resolve) {
        resolve(response);
      }
      this.emit('data', response, token);
    }
  }

  private handleError(err: Error) {
    this.close();
    this.lastError = err;
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
  }
}

export function setConnectionDefaults(
  connectionOptions: RServerConnectionOptions
): RNConnOpts {
  connectionOptions.host = connectionOptions.host || 'localhost';
  connectionOptions.port = connectionOptions.port || 28015;
  return connectionOptions as any;
}
