'use strict';

const _ = require('lodash');
const { 'default': Sheets } = require('node-sheets');
const weighted = require('weighted');

const fs = require('fs');
const promisify = require('util').promisify;
const stat = promisify(fs.stat);

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

let dataPromise = loadData();

module.exports.makeLingo = async (event) => {
    if(event.queryStringParameters && event.queryStringParameters.reload === 'true') {
        dataPromise = loadData();
    }

    const language = (event.queryStringParameters && event.queryStringParameters.language) ||
                     (event.cookies && _.find(event.cookies, cookie => cookie.match(/^language=(.+)$/))
                       && _.find(event.cookies, cookie => cookie.match(/^language=(.+)$/)).match(/^language=(.+)$/)[1]) ||
                     _.keys(await dataPromise)[0];

    console.log('Language:', language);

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

    return {
        statusCode: 200,
        cookies: [`language=${language}; Max-Age:${60 * 60 * 24 * 365}`],
        headers: {
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
        },
        body: `<html><head><title>Word generator</title></head>
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
            <label for="reload">Reload from sheet</label>
            <input type="checkbox" name="reload" id="reload" value="true" />
            <input type="submit" value="Make more"/>
        </form>
        <div class="words">
	        <div class="word">${words.join('</div><div class="word">')}</div>
        </div>
    </body>
</html>`,
    };
};
