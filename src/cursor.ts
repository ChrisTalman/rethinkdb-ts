import { inspect } from 'util';
import { RebirthdbError } from './error';
import { Query, Response } from './proto/ql2';
import { getNativeTypes } from './response-parser';
import { RebirthDBSocket } from './socket';
import { RunOptions } from './types';

export class Cursor {
  private position = 0;
  private responseType?: Response.ResponseType;
  private profile: any;
  constructor(
    private conn: RebirthDBSocket,
    private token: number,
    private runOptions: Pick<
      RunOptions,
      'binaryFormat' | 'groupFormat' | 'timeFormat'
    >,
    private results?: any[],
    private hasNext?: boolean
  ) {}

  public async close() {
    this.conn.sendQuery([Query.QueryType.STOP], this.token);
    await this.conn.readNext(this.token);
  }

  public async next() {
    if (!this.results) {
      await this.resolve();
    } else if (this.hasNext && this.position >= this.results.length) {
      this.conn.sendQuery([Query.QueryType.CONTINUE], this.token);
      await this.resolve();
    }
    if (this.profile) {
      this.position = this.results ? this.results.length : 0;
      return {
        profile: this.profile,
        result:
          this.responseType === Response.ResponseType.SUCCESS_ATOM &&
          this.results
            ? this.results[0]
            : this.results
      };
    }
    return this.results ? this.results[this.position++] : undefined;
  }

  public async toArray() {
    if (!this.results) {
      await this.resolve();
    }
    const fullResultSet = this.results || [];
    while (this.hasNext) {
      await this.next();
      fullResultSet.push(...(this.results || []));
    }
    return fullResultSet;
  }

  public async eachAsync(rowHandler: (row: any) => Promise<void>) {
    let nextRow = await this.next();
    while (typeof nextRow !== 'undefined') {
      await rowHandler(nextRow);
      nextRow = await this.next();
    }
  }

  public async resolve() {
    const response = await this.conn.readNext(this.token);
    const { t: type, r: results, p: profile } = response;
    switch (type) {
      case Response.ResponseType.CLIENT_ERROR:
      case Response.ResponseType.COMPILE_ERROR:
      case Response.ResponseType.RUNTIME_ERROR:
        console.error(inspect(response));
        throw new RebirthdbError('Query error');
      case Response.ResponseType.SUCCESS_ATOM:
      case Response.ResponseType.SUCCESS_PARTIAL:
      case Response.ResponseType.SUCCESS_SEQUENCE:
        this.hasNext = type === Response.ResponseType.SUCCESS_PARTIAL;
        this.profile = profile;
        this.results = getNativeTypes(results, this.runOptions);
        this.position = 0;
        break;
      default:
        throw new RebirthdbError('Unexpected return value');
    }
    this.responseType = type;
    return type;
  }
}
