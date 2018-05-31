"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const enums_1 = require("../proto/enums");
const query_config_1 = require("../query-builder/query-config");
function backtraceTerm(term, head = true, backtrace) {
    const parseArg = (arg, index, all, forceHead = false) => backtraceTerm(arg, forceHead || (!all && index === 0), nextBacktrace(index, backtrace));
    if (typeof term === 'undefined') {
        return getMarked('');
    }
    if (!Array.isArray(term)) {
        let termStr = ['', ''];
        if (term === null) {
            termStr = getMarked('null');
        }
        else if (typeof term === 'object') {
            termStr = backtraceObject(term, backtrace);
        }
        else if (typeof term === 'string') {
            termStr = getMarked(`"${term}"`);
        }
        else {
            termStr = getMarked(toString());
        }
        return getMarked(head ? combineMarks `r.expr(${termStr})` : termStr, backtrace);
    }
    const [type, args, optarg] = term;
    const hasArgs = !!args && !!args.length;
    switch (type) {
        case enums_1.TermType.MAKE_ARRAY: {
            if (!args) {
                return getMarked('');
            }
            return getMarked(head
                ? combineMarks `r.expr([${args
                    .map(parseArg)
                    .reduce(joinMultiArray, ['', ''])}])`
                : combineMarks `[${args
                    .map(parseArg)
                    .reduce(joinMultiArray, ['', ''])}]`, backtrace);
        }
        case enums_1.TermType.FUNC: {
            const paramsBacktrace = nextBacktrace(0, backtrace);
            const params = args[0][1].map((i) => getMarked(`var${i}`, nextBacktrace(i, paramsBacktrace)));
            return getMarked(combineMarks `(${params.reduce(joinMultiArray, [
                '',
                ''
            ])}) => ${backtraceTerm(args[1], true, nextBacktrace(1, backtrace))}`, backtrace);
        }
        case enums_1.TermType.VAR: {
            return getMarked(`var${args[0]}`, backtrace);
        }
        case enums_1.TermType.FUNCALL: {
            if (!args) {
                return getMarked('');
            }
            const [func, caller, ...params] = args;
            const parsedParams = params
                .map((a, i) => parseArg(a, i + 2))
                .reduce(joinMultiArray, ['', '']);
            const parsedFunc = parseArg(func, 0);
            const parsedCaller = parseArg(caller, 1, undefined, true);
            return getMarked(parsedParams[0]
                ? combineMarks `${parsedCaller}.do(${parsedParams}, ${parsedFunc})`
                : combineMarks `${parsedCaller}.do(${parsedFunc})`, backtrace);
        }
        case enums_1.TermType.BRACKET: {
            if (!args) {
                return getMarked('');
            }
            const [caller, ...params] = args;
            if (Array.isArray(caller)) {
                const parsedParams = [...params]
                    .map((a, i) => parseArg(a, i + 1))
                    .reduce(joinMultiArray, ['', '']);
                return getMarked(combineMarks `${parseArg(caller, 0)}(${parsedParams})`, backtrace);
            }
            return getMarked('');
        }
        default: {
            const c = query_config_1.rConsts.find(co => co[0] === type);
            if (c) {
                return getMarked(`r.${c[1]}`, backtrace);
            }
            const func = query_config_1.termConfig.find(conf => conf[0] === type);
            if (!func) {
                const rfunc = query_config_1.rConfig.find(conf => conf[0] === type);
                if (rfunc) {
                    const rparsedParams = [...(args || [])]
                        .map(parseArg)
                        .reduce(joinMultiArray, ['', '']);
                    return getMarked(optarg
                        ? hasArgs
                            ? combineMarks `r.${rfunc[1]}(${rparsedParams}, ${backtraceObject(optarg, backtrace)})`
                            : combineMarks `r.${rfunc[1]}(${backtraceObject(optarg, backtrace)})`
                        : combineMarks `r.${rfunc[1]}(${rparsedParams})`, backtrace);
                }
                return getMarked('');
            }
            if (!args) {
                return getMarked(combineMarks `r.${func[1]}(${backtraceObject(optarg, backtrace)})`, backtrace);
            }
            const [caller, ...params] = args;
            const hasParams = params.length > 0;
            const parsedParams = [...params]
                .map((a, i) => parseArg(a, i + 1))
                .reduce(joinMultiArray, ['', '']);
            const parsedCaller = parseArg(caller, 0);
            const parsedOptarg = optarg
                ? backtraceObject(optarg, backtrace)
                : undefined;
            return getMarked(parsedOptarg
                ? hasParams
                    ? combineMarks `${parsedCaller}.${func[1]}(${parsedParams}, ${parsedOptarg})`
                    : combineMarks `${parsedCaller}.${func[1]}(${parsedOptarg})`
                : combineMarks `${parsedCaller}.${func[1]}(${parsedParams})`, backtrace);
        }
    }
}
exports.backtraceTerm = backtraceTerm;
function backtraceObject(optarg, backtrace) {
    const [param, ...nextB] = backtrace || [];
    return combineMarks `{ ${Object.entries(optarg)
        .map(([key, val]) => {
        const next = param === key ? nextB : undefined;
        return getMarked(combineMarks `${snakeToCamel(key)}: ${backtraceTerm(val, false, next)}`, next);
    })
        .reduce(joinMultiArray, ['', ''])} }`;
}
function snakeToCamel(name) {
    return name.replace(/(_[a-z])/g, x => x.charAt(1).toUpperCase());
}
function backtraceQuery(query, backtrace) {
    const [type, term, optarg] = query;
    switch (type) {
        case enums_1.QueryType.START:
            return backtraceTerm(term, true); // `${backtraceTerm(term)}.run(${backtraceObject(optarg)})`
        case enums_1.QueryType.SERVER_INFO:
            return ['conn.server()'];
        case enums_1.QueryType.NOREPLY_WAIT:
            return ['conn.noreplyWait()'];
        default:
            return [''];
    }
}
exports.backtraceQuery = backtraceQuery;
function nextBacktrace(i, backtrace) {
    if (backtrace && backtrace[0] === i) {
        return backtrace.slice(1);
    }
}
function joinMultiArray(acc, next) {
    return acc[0]
        ? [`${acc[0]}, ${next[0]}`, `${acc[1]}  ${next[1]}`]
        : [next[0], next[1]];
}
function getMarked(str, backtrace) {
    const s = Array.isArray(str) ? str[0] : str;
    const emptyMarks = Array.isArray(str) ? str[1] : ' '.repeat(str.length);
    return backtrace && backtrace.length === 0
        ? [s, '^'.repeat(s.length)]
        : [s, emptyMarks];
}
function combineMarks(literals, ...placeholders) {
    let result = '';
    let mark = '';
    for (let i = 0; i < placeholders.length; i++) {
        result += literals[i];
        mark += ' '.repeat(literals[i].length);
        if (!Array.isArray(placeholders[i])) {
            result += placeholders[i];
            mark += ' '.repeat(placeholders[i].length);
        }
        else {
            result += placeholders[i][0];
            mark += placeholders[i][1];
        }
    }
    // add the last literal
    result += literals[literals.length - 1];
    mark += ' '.repeat(literals[literals.length - 1].length);
    return [result, mark];
}
