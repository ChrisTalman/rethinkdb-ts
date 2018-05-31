import { QueryJson, TermJson } from '../internal-types';
import { Response } from '../proto/ql2';
export interface RebirthDBErrorArgs {
    errorCode?: number;
    term?: TermJson;
    query?: QueryJson;
    backtrace?: Array<number | string>;
    responseType?: Response.ResponseType;
    responseErrorType?: Response.ErrorType;
}
export declare function isRebirthDBError(error: any): boolean;
export declare class RebirthDBError extends Error {
    msg: string;
    errorCode?: number;
    private term?;
    private query?;
    private backtrace?;
    constructor(msg: string, {term, query, errorCode, backtrace, responseType, responseErrorType}?: RebirthDBErrorArgs);
}
