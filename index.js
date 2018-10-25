'use strict';

const _ = require('lodash');
const { 'default': Sheets } = require('node-sheets');
const weighted = require('weighted');

const nconf = require('nconf');

// Read defaults
nconf.argv(require('yargs') // eslint-disable-line node/no-extraneous-require
        .wrap(null)
        .help('help')
        .alias('help', 'h')
        .example('node index.js -n 10', 'Generate 10 random words with varying lengths')
        .example('node index.js -n 20 -s 3', 'Generate 20 random words each of which has 3 syllables')
        .options({
            numWords: {
                alias: ['n'],
                describe: 'The number of words to generate',
                parseValues: true,
                'default': 1,
            },
            forceSyllables: {
                alias: ['s', 'numSyllables'],
                describe: 'Force all words to use this syllable count (optional: if not specified, use distribution of syllable counts',
                parseValues: true,
            },
        })
        .required('numWords'));

async function loadData() {
    const sheet = new Sheets('1kgbgBHRPOegL_fpQMn37UEsMk0h3OXfSbutV8UJZtYw');
    await sheet.authorizeApiKey('AIzaSyCp94EJsdc1J-vDwEuW_PGeQekPL8o9k-0');
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

(async () => {
    const { syllables, frequencies, syllableCounts, syllableCountFrequencies } = await loadData();
    for(let i = 0; i < nconf.get('numWords'); i++) {
        const syllables_for_this_word = nconf.get('numSyllables') || weighted.select(syllableCounts, syllableCountFrequencies);
        let word = '';
        for(let s = 0; s < syllables_for_this_word; s++) {
            word = `${word}${weighted.select(syllables, frequencies)}`;
        }
        console.log(word);
    }
})();
