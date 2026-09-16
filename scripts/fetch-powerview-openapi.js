#!/usr/bin/env node
/**
 * PowerView Gen3 serves Swagger UI on port 3002, but the OpenAPI document is
 * embedded inside swagger-ui-init.js (not a separate /swagger.json).
 *
 * Run on a machine that can reach the gateway (your Mac on the same LAN):
 *   node scripts/fetch-powerview-openapi.js 192.168.1.169
 *   npm run fetch-openapi -- 192.168.1.169
 *
 * Writes docs/powerview-gateway-openapi.json for offline use / AI tools / diffing.
 *
 * Optional: REDACT_SERVER=1 replaces servers[].url with http://GATEWAY_IP before save.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const gatewayIp = (process.argv[2] || process.env.POWERVIEW_GATEWAY_IP || '').trim();
if (!gatewayIp) {
    console.error('Usage: node scripts/fetch-powerview-openapi.js <gateway-ipv4>');
    console.error('   or: POWERVIEW_GATEWAY_IP=192.168.1.169 npm run fetch-openapi');
    process.exit(1);
}

/** Extract JSON object value of "swaggerDoc" from the gateway’s swagger-ui-init.js */
function extractSwaggerDocJson(jsText) {
    const key = '"swaggerDoc":';
    const i = jsText.indexOf(key);
    if (i < 0) {
        throw new Error('"swaggerDoc" not found (unexpected swagger-ui-init.js format)');
    }
    let j = i + key.length;
    while (j < jsText.length && /\s/.test(jsText[j])) {
        j += 1;
    }
    if (jsText[j] !== '{') {
        throw new Error('Expected { after "swaggerDoc":');
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    const start = j;
    for (; j < jsText.length; j += 1) {
        const ch = jsText[j];
        if (inStr) {
            if (esc) {
                esc = false;
                continue;
            }
            if (ch === '\\') {
                esc = true;
                continue;
            }
            if (ch === '"') {
                inStr = false;
            }
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return jsText.slice(start, j + 1);
            }
        }
    }
    throw new Error('Unclosed JSON object for swaggerDoc');
}

const url = `http://${gatewayIp}:3002/swagger-ui-init.js`;
const outPath = path.join(__dirname, '..', 'docs', 'powerview-gateway-openapi.json');

http
    .get(url, (res) => {
        if (res.statusCode !== 200) {
            console.error(`HTTP ${res.statusCode} from ${url}`);
            process.exit(1);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
            try {
                const body = Buffer.concat(chunks).toString('utf8');
                const jsonStr = extractSwaggerDocJson(body);
                const spec = JSON.parse(jsonStr);
                if (process.env.REDACT_SERVER === '1' && Array.isArray(spec.servers)) {
                    spec.servers = [{ url: 'http://GATEWAY_IP' }];
                }
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf8');
                console.log(`Wrote ${outPath}`);
                console.log(`OpenAPI ${spec.openapi || '?'} — ${spec.info && spec.info.title}`);
            } catch (e) {
                console.error(e.message || e);
                process.exit(1);
            }
        });
    })
    .on('error', (e) => {
        console.error(e.message || e);
        process.exit(1);
    });
