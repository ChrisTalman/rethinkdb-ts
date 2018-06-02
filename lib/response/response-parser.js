"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getNativeTypes(obj, { binaryFormat = 'native', groupFormat = 'native', timeFormat = 'native' } = {}) {
    if (Array.isArray(obj)) {
        return obj.map(item => getNativeTypes(item, { binaryFormat, groupFormat, timeFormat }));
    }
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (!!obj.$reql_type$) {
        switch (obj.$reql_type$) {
            case 'TIME':
                if (timeFormat === 'native') {
                    return new Date(obj.epoch_time * 1000);
                }
                else if (timeFormat === 'ISO8601') {
                    return new Date(obj.epoch_time * 1000).toISOString();
                }
                break;
            case 'BINARY':
                if (binaryFormat === 'native') {
                    return Buffer.from(obj.data, 'base64');
                }
                break;
            case 'GROUPED_DATA':
                if (groupFormat === 'native') {
                    return obj.data.map(([group, reduction]) => ({
                        group: getNativeTypes(group, {
                            binaryFormat,
                            groupFormat,
                            timeFormat
                        }),
                        reduction: getNativeTypes(reduction, {
                            binaryFormat,
                            groupFormat,
                            timeFormat
                        })
                    }));
                }
                break;
        }
    }
    return Object.entries(obj).reduce((acc, [key, val]) => (Object.assign({}, acc, { [key]: getNativeTypes(val) })), {});
}
exports.getNativeTypes = getNativeTypes;
