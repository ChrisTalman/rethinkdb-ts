/// <reference types="node" />
import { EventEmitter } from 'events';
import { TermJson } from '../internal-types';
import { ConnectionPool, RConnectionOptions, RServerConnectionOptions, RunOptions } from '../types';
import { RebirthDBConnection } from './connection';
import { RNConnOpts } from './socket';
export declare class ServerConnectionPool extends EventEmitter implements ConnectionPool {
    readonly server: RNConnOpts;
    private healthy;
    private buffer;
    private max;
    private timeoutError;
    private timeoutGb;
    private maxExponent;
    private silent;
    private log;
    private connParam;
    private connections;
    private timers;
    constructor(connectionOptions: RServerConnectionOptions, {db, user, password, buffer, max, timeout, pingInterval, timeoutError, timeoutGb, maxExponent, silent, log}?: RConnectionOptions);
    eventNames(): string[];
    initConnections(): Promise<void>;
    readonly isHealthy: boolean;
    waitForHealthy(): Promise<{}>;
    updateBufferMax({buffer, max}: {
        buffer: number;
        max: number;
    }): void;
    drain({noreplyWait}?: {
        noreplyWait?: boolean;
    }, emit?: boolean): Promise<void>;
    getConnections(): RebirthDBConnection[];
    getLength(): number;
    getAvailableLength(): number;
    getNumOfRunningQueries(): number;
    queue(term: TermJson, globalArgs?: RunOptions): Promise<any>;
    private setHealthy(healthy);
    private createConnection();
    private subscribeToConnection(conn);
    private closeConnection(conn);
    private checkIdle(conn);
    private removeIdleTimer(conn);
    private persistConnection(conn);
    private reportError(err);
    private getOpenConnections();
    private getIdleConnections();
}
