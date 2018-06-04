import { isBuffer, isDate, isFunction, isUndefined } from 'util';
import { RebirthDBError } from '../error/error';
import { TermJson } from '../internal-types';
import { TermType } from '../proto/enums';
import { globals } from './globals';
import { isQuery, toQuery } from './query';

export function parseParam(
  param: any,
  nestingLevel = globals.nestingLevel
): TermJson {
  if (nestingLevel === 0) {
    throw new RebirthDBError(
      'Nesting depth limit exceeded.\nYou probably have a circular reference somewhere.'
    );
  }
  if (param === null) {
    return null;
  }
  if (isQuery(param)) {
    if (isUndefined(param.term)) {
      throw new RebirthDBError("'r' cannot be an argument");
    }
    return param.term;
  }
  if (Array.isArray(param)) {
    return [
      TermType.MAKE_ARRAY,
      param.map(p => parseParam(p, nestingLevel - 1))
    ];
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
    const { nextVarId } = globals;
    globals.nextVarId = nextVarId + param.length;
    try {
      const funcResult = param(
        ...Array(param.length)
          .fill(0)
          .map((_, i) => toQuery([TermType.VAR, [i + nextVarId]]))
      );
      if (isUndefined(funcResult)) {
        throw new RebirthDBError(
          `Anonymous function returned \`undefined\`. Did you forget a \`return\`? in:\n${param.toString()}`
        );
      }
      const term = [
        TermType.FUNC,
        [
          [
            TermType.MAKE_ARRAY,
            Array(param.length)
              .fill(0)
              .map((_, i) => i + nextVarId)
          ],
          parseParam(funcResult)
        ]
      ];
      return term;
    } finally {
      globals.nextVarId = nextVarId;
    }
  }
  if (typeof param === 'object') {
    return Object.entries(param).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: parseParam(value, nestingLevel - 1)
      }),
      {}
    );
  }
  if (typeof param === 'number' && (isNaN(param) || !isFinite(param))) {
    throw new RebirthDBError(`Cannot convert \`${param}\` to JSON`);
  }
  return param;
}

export function parseOptarg(obj: object) {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [camelToSnake(key)]: parseParam(value)
    }),
    {}
  );
}

function camelToSnake(name: string) {
  return name.replace(/([A-Z])/g, x => `_${x.toLowerCase()}`);
}
