import { inspect, isBuffer, isDate, isFunction } from 'util';
import { funcConfig } from './config';
import { RebirthDBConnection } from './connection';
import { RebirthdbError } from './error';
import { camelToSnake } from './helper';
import { ComplexTermJson, TermJson } from './internal-types';
import { Term } from './proto/ql2';
import { ConnectionOptions, R, RunOptions } from './types';

const reversedDo = queryTermBuilder(Term.TermType.FUNCALL, 1, -1, false);
const rSymbol = Symbol('r');
const isQueryBuilder = (arg: any) => typeof arg === 'object' && rSymbol in arg;
const queryBuilderProto = Object.assign(
  funcConfig
    .map(([termType, funcName, minArg, maxArg, hasOptarg]) => ({
      [funcName]: queryTermBuilder(termType, minArg, maxArg, hasOptarg)
    }))
    .reduce((acc, next) => ({ ...acc, ...next })),
  {
    [rSymbol]: true,
    do(this: { term?: TermJson }, ...args: any[]) {
      const last = args.pop();
      if (this.term) {
        args.unshift(this.term);
      }
      return reversedDo.call({}, last, ...args);
    },
    async run(
      this: { term: TermJson },
      conn?: RebirthDBConnection | RunOptions,
      options?: RunOptions
    ) {
      const c = conn instanceof RebirthDBConnection ? conn : undefined;
      if (!c) {
        throw new RebirthdbError('No connection');
      }
      return c.query(this.term, options);
    }
  }
);
// this may cause a performance issue, but this is how it's done in rethinkdbdash to support bracket operation
function getQueryBuilder(term?: TermJson) {
  const qb: any = queryTermBuilder(Term.TermType.BRACKET, 1, 1, false, term);
  qb.__proto__ = queryBuilderProto;
  qb.term = term;
  return qb;
}

export function parseParam(param: any): TermJson {
  if (isQueryBuilder(param)) {
    if (!param.term) {
      throw new RebirthdbError("'r' cannot be an argument");
    }
    return param.term;
  }
  if (Array.isArray(param)) {
    return [Term.TermType.MAKE_ARRAY, param.map(p => parseParam(p))];
  }
  if (isDate(param)) {
    return {
      $reql_type$: 'TIME',
      epochTime: param.getTime(),
      timezone: '+00:00'
    };
  }
  if (isBuffer(param)) {
    return {
      $reql_type$: 'BINARY',
      data: param.toString('base64')
    };
  }
  if (isFunction(param)) {
    return [
      Term.TermType.FUNC,
      [
        [
          Term.TermType.MAKE_ARRAY,
          Array(param.length)
            .fill(0)
            .map((_, i) => i + 1)
        ],
        param(
          ...Array(param.length)
            .fill(0)
            .map((_, i) => getQueryBuilder([Term.TermType.VAR, [i + 1]]))
        ).term as ComplexTermJson
      ]
    ];
  }
  return param;
}

function queryTermBuilder(
  termType: Term.TermType,
  minArgs: number,
  maxArgs: number,
  hasOptarg: boolean,
  t?: TermJson
) {
  return function(this: { term?: TermJson }, ...args: any[]) {
    const currentTerm: TermJson | undefined = (t || (this && this.term)) as any;
    const argsLength = args.length;
    let localMaxArgs = maxArgs;
    if (!currentTerm) {
      localMaxArgs++;
    }
    if (argsLength < minArgs) {
      throw new RebirthdbError(`Expecting at least ${minArgs} arguments`);
    }
    const maxArgsPlusOptarg =
      hasOptarg && localMaxArgs >= 0 ? localMaxArgs + 1 : localMaxArgs;
    if (maxArgs !== -1 && argsLength > maxArgsPlusOptarg) {
      throw new RebirthdbError(
        `Expecting at most ${maxArgsPlusOptarg} arguments`
      );
    }
    const params: TermJson[] = currentTerm ? [currentTerm] : [];
    const maybeOptarg = args.length ? args.pop() : undefined;
    const optarg =
      hasOptarg &&
      (argsLength >= maxArgsPlusOptarg ||
        (!Array.isArray(maybeOptarg) &&
          typeof maybeOptarg === 'object' &&
          !(rSymbol in maybeOptarg)))
        ? maybeOptarg
        : undefined;
    if (maybeOptarg && !optarg) {
      args.push(maybeOptarg);
    }
    params.push(...args.map(parseParam));
    const term: ComplexTermJson = [termType];
    if (params.length > 0) {
      term[1] = params;
    }
    if (optarg) {
      term[2] = Object.entries(maybeOptarg).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [camelToSnake(key)]: parseParam(value)
        }),
        {}
      );
      console.log(inspect(term[2]));
    }
    return getQueryBuilder(term);
  };
}

export const r: R = Object.assign(getQueryBuilder() as any, {
  minval: { [rSymbol]: true, term: [Term.TermType.MINVAL] },
  maxval: { [rSymbol]: true, term: [Term.TermType.MAXVAL] },
  // row : { [rSymbol]: true, term: [Term.TermType.MINVAL] },
  monday: { [rSymbol]: true, term: [Term.TermType.MONDAY] },
  tuesday: { [rSymbol]: true, term: [Term.TermType.TUESDAY] },
  wednesday: { [rSymbol]: true, term: [Term.TermType.WEDNESDAY] },
  thursday: { [rSymbol]: true, term: [Term.TermType.THURSDAY] },
  friday: { [rSymbol]: true, term: [Term.TermType.FRIDAY] },
  saturday: { [rSymbol]: true, term: [Term.TermType.SATURDAY] },
  sunday: { [rSymbol]: true, term: [Term.TermType.SUNDAY] },
  january: { [rSymbol]: true, term: [Term.TermType.JANUARY] },
  february: { [rSymbol]: true, term: [Term.TermType.FEBRUARY] },
  march: { [rSymbol]: true, term: [Term.TermType.MARCH] },
  april: { [rSymbol]: true, term: [Term.TermType.APRIL] },
  may: { [rSymbol]: true, term: [Term.TermType.MAY] },
  june: { [rSymbol]: true, term: [Term.TermType.JUNE] },
  july: { [rSymbol]: true, term: [Term.TermType.JULY] },
  august: { [rSymbol]: true, term: [Term.TermType.AUGUST] },
  september: { [rSymbol]: true, term: [Term.TermType.SEPTEMBER] },
  october: { [rSymbol]: true, term: [Term.TermType.OCTOBER] },
  november: { [rSymbol]: true, term: [Term.TermType.NOVEMBER] },
  december: { [rSymbol]: true, term: [Term.TermType.DECEMBER] },
  expr: (arg: any) => {
    if (isQueryBuilder(arg)) {
      return arg;
    }
    if (Array.isArray(arg)) {
      return getQueryBuilder(parseParam(arg));
    }
    return getQueryBuilder([Term.TermType.DATUM, [arg]]);
  },
  connect: async (options: ConnectionOptions) => {
    if (!options.pool) {
      const c = new RebirthDBConnection(
        options.servers && options.servers.length
          ? options.servers[0]
          : ({} as any),
        options as any
      );
      await c.reconnect();
      return c;
    }
  }
});
