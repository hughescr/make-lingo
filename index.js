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
        return Promise.resolve([res, require('./git_version.json')]); // eslint-disable-line node/no-missing-require
    })
    .catch(() => {
        // If we didn't stat the file then hardcode some stuff
        return Promise.resolve([{ mtime: new Date() }, { gitVersion: '1.0.0' }]);
    });

async function loadData() {
    const sheet = new Sheets(process.env.SHEET_ID || '1kgbgBHRPOegL_fpQMn37UEsMk0h3OXfSbutV8UJZtYw');
    await sheet.authorizeApiKey(process.env.API_KEY || 'AIzaSyCp94EJsdc1J-vDwEuW_PGeQekPL8o9k-0');
    const syllableFrequencyData =  _.chain((await sheet.tables('A:B')).rows)
        .filter(row => row.Frequency && row.Frequency.value &&
                        row.Syllable && row.Syllable.value)
        .map(row => _.mapValues(row, v => v.value))
        .value();
    const syllables = _.map(syllableFrequencyData, 'Syllable');
    const frequencies = _.map(syllableFrequencyData, 'Frequency');

    const syllablePerWordData = _.chain((await sheet.tables('D:E')).rows)
        .filter(row => row.Frequency && row.Frequency.value &&
                        row.SyllablesPerWord && row.SyllablesPerWord.value)
        .map(row => _.mapValues(row, v => v.value))
        .value();
    const syllableCounts = _.map(syllablePerWordData, 'SyllablesPerWord');
    const syllableCountFrequencies = _.map(syllablePerWordData, 'Frequency');

    return { syllables, frequencies, syllableCounts, syllableCountFrequencies };
}

let dataPromise = loadData();

module.exports.makeLingo = async (event) => {
    if(event.queryStringParameters && event.queryStringParameters.reload === 'true') {
        dataPromise = loadData();
    }

    const { syllables, frequencies, syllableCounts, syllableCountFrequencies } = await dataPromise;

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
        headers: {
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
        },
        body: `<html><head><title>Word generator</title></head>
    <body>
        <form>
            <label for="words">Words</label>
            <input type="text" id="words" name="words" value="${parseInt(event.queryStringParameters && event.queryStringParameters.words) || 100}" />
            <label for="syllables">Syllables</label>
            <input type="text" id="syllables" name="syllables" value="${parseInt(event.queryStringParameters && event.queryStringParameters.syllables) || ''}" />
            <label for="reload">Reload from sheet</label>
            <input type="checkbox" name="reload" id="reload" value="true" />
            <input type="submit" value="Make more"/>
        </form>
        ${words.join('<br />')}
    </body>
</html>`,
    };
};
