/// <reference types="node" />
import { EventEmitter } from 'events';
import { TermJson } from '../internal-types';
import { Cursor } from '../response/cursor';
import { Connection, RServerConnectionOptions, RunOptions, ServerInfo } from '../types';
import { RebirthDBSocket } from './socket';
export declare class RebirthDBConnection extends EventEmitter implements Connection {
    private connectionOptions;
    clientPort: number;
    clientAddress: string;
    readonly socket: RebirthDBSocket;
    private options;
    private timeout;
    private pingInterval;
    private silent;
    private log;
    private pingTimer?;
    private db;
    constructor(connectionOptions: RServerConnectionOptions, {db, user, password, timeout, pingInterval, silent, log}?: {
        db?: string;
        user?: string;
        password?: string;
        timeout?: number;
        pingInterval?: number;
        silent?: boolean;
        log?: (message: string) => undefined;
    });
    eventNames(): string[];
    readonly open: boolean;
    readonly numOfQueries: number;
    close({noreplyWait}?: {
        noreplyWait?: boolean;
    }): Promise<void>;
    reconnect(options?: {
        noreplyWait: boolean;
    }): Promise<this>;
    use(db: string): void;
    noreplyWait(): Promise<void>;
    server(): Promise<ServerInfo>;
    query(term: TermJson, globalArgs?: RunOptions): Promise<Cursor | undefined>;
    private findTableTermAndAddDb(term, db);
    private startPinging();
    private stopPinging();
    private reportError(err);
}
