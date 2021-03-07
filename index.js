'use strict';

const _ = require('lodash');
const { 'default': Sheets } = require('node-sheets');
const weighted = require('weighted');
const { DateTime } = require('luxon');

const fs = require('fs');
const promisify = require('util').promisify;
const stat = promisify(fs.stat);
const zlib = require('zlib');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

/* istanbul ignore next */
const git_version = stat('./git_version.json')
    .then(res => {
        // If we did manage to stat the file, then load it
        return [res, require('./git_version.json')]; // eslint-disable-line node/no-missing-require -- If stat finds the file, it'll be there
    })
    .catch(() => {
        // If we didn't stat the file then hardcode some stuff
        return [{ mtime: new Date() }, { gitVersion: '1.0.0' }];
    });

async function loadData() {
    const sheet = new Sheets(process.env.GOOGLE_SHEET_ID);
    await sheet.authorizeApiKey(process.env.GOOGLE_API_KEY);

    const sheetNames = await sheet.getSheetsNames();

    return sheet.tables(_.map(sheetNames, name => ({ name: name, range: 'A:E' })))
    .then(fetch => {
        const parsed = {};

        _.forEach(fetch, syls => {
            const title = syls.title;
            parsed[title] = {};

            const syllableFrequencyData = _(syls.rows)
                .filter(row => row.Frequency && row.Frequency.value &&
                                row.Syllable && row.Syllable.value)
                .map(row => _.mapValues(row, 'value'))
                .value();

            parsed[title].syllables = _.map(syllableFrequencyData, 'Syllable');
            parsed[title].frequencies = _.map(syllableFrequencyData, 'Frequency');

            const syllablePerWordData = _(syls.rows)
                .filter(row => row.LengthFrequency && row.LengthFrequency.value &&
                                row.SyllablesPerWord && row.SyllablesPerWord.value)
                .map(row => _.mapValues(row, 'value'))
                .value();
            parsed[title].syllableCounts = _.map(syllablePerWordData, 'SyllablesPerWord');
            parsed[title].syllableCountFrequencies = _.map(syllablePerWordData, 'LengthFrequency');
        });

        return parsed;
    });
}

async function lastUpdated() {
    const sheet = new Sheets(process.env.GOOGLE_SHEET_ID);
    return sheet.authorizeApiKey(process.env.GOOGLE_API_KEY)
    .then(() => sheet.getLastUpdateDate())
    .then(res => DateTime.fromISO(res));
}

let lastUpdatePromise = lastUpdated();
let dataPromise = loadData();

// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- complexity is stupid
module.exports.makeLingo = async (event) => {
    const acceptEncoding = event.headers['accept-encoding'];
    const updated = lastUpdated();
    if((await updated) > (await lastUpdatePromise)) {
        console.log(JSON.stringify({ old: (await lastUpdatePromise), 'new': (await updated) }));
        console.log('Refetching data from Google');
        lastUpdatePromise = updated;
        dataPromise = loadData();
    } else {
        console.log(JSON.stringify({ old: (await lastUpdatePromise), 'new': (await updated) }));
    }

    const language = (event.queryStringParameters && event.queryStringParameters.language) ||
                     (event.cookies && _.find(event.cookies, cookie => cookie.match(/^language=(.+)$/))
                       && _.find(event.cookies, cookie => cookie.match(/^language=(.+)$/)).match(/^language=(.+)$/)[1]) ||
                     _.keys(await dataPromise)[0];

    console.log(JSON.stringify({ language: language }));

    const { syllables, frequencies, syllableCounts, syllableCountFrequencies } = (await dataPromise)[language];

    const words = [];
    for(let i = 0; i < (event.queryStringParameters && parseInt(event.queryStringParameters.words) || 100); i++) {
        const syllables_for_this_word = event.queryStringParameters && parseInt(event.queryStringParameters.syllables) || weighted.select(syllableCounts, syllableCountFrequencies);
        let word = '';
        for(let s = 0; s < syllables_for_this_word; s++) {
            word = `${word}${weighted.select(syllables, frequencies)}`;
        }
        words.push(word);
    }

    let maybeZipped = {};
    let base64Encoded = false;
    let body = `<html><head><title>Word generator</title></head>
    <body>
        <h3>Edit <a href="https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit#gid=0">spreadsheet</a></h3>
        <form>
            <label for="language">Language</label>
            <select name="language" id="language">
                ${(await _(await dataPromise).keys().map(key => `<option value="${key}"${key == language ? ' selected' : ''}>${key}</option>`).join('\n                '))}
            </select>
            <label for="words">Words</label>
            <input type="text" id="words" name="words" value="${parseInt(event.queryStringParameters && event.queryStringParameters.words) || 100}" />
            <label for="syllables">Syllables (leave blank for weighted-random)</label>
            <input type="text" id="syllables" name="syllables" value="${parseInt(event.queryStringParameters && event.queryStringParameters.syllables) || ''}" />
            <input type="submit" value="Make more"/>
        </form>
        <div class="words">
            <div class="word">${words.join('</div><div class="word">')}</div>
        </div>
    </body>
</html>`;

    if(/\bbr\b/.test(acceptEncoding)) {
        body = (await brotli(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'br' };
        base64Encoded = true;
    } else if(/\bgzip\b/.test(acceptEncoding)) {
        body = (await gzip(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'gzip' };
        base64Encoded = true;
    } else if(/\deflate\b/.test(acceptEncoding)) {
        body = (await deflate(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'deflate' };
        base64Encoded = true;
    }

    return {
        statusCode: 200,
        cookies: [`language=${language}; Max-Age:${60 * 60 * 24 * 365}`],
        headers: {
            ...maybeZipped,
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
            Vary: 'Accept-Encoding',
        },
        isBase64Encoded: base64Encoded,
        body: body,
    };
};
